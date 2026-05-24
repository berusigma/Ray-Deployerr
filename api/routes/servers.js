const router = require('express').Router();
const { Server, File, User } = require('../models');
const { auth, log, getIP } = require('../middleware');

const MAX_SERVERS = 4;
const MAX_DAILY   = 2;
const WA_URL      = 'https://whatsapp.com/channel/0029Vb89VkwLNSZyIqpdbX3t';
const TT_URL      = 'https://www.tiktok.com/@rayapp_host'; // ganti sesuai akun

const RESERVED = new Set(['api','admin','s','static','public','login','register','dashboard','filemanager','system','rayapp','null','undefined']);

// GET /api/server/prereq
router.get('/prereq', auth, (_, res) => res.json({ ok: true, wa: WA_URL, tt: TT_URL }));

// GET /api/server/list
router.get('/list', auth, async (req, res) => {
  try {
    const servers = await Server.find({ owner: req.user._id }).sort({ createdAt: -1 });
    const base = process.env.BASE_URL || 'https://rayapp.vercel.app';
    res.json({ ok: true, servers: servers.map(s => ({
      id: s._id, name: s.name,
      url: `${base}/s/${s.name}/`,
      totalSize: s.totalSize,
      totalRequests: s.totalRequests,
      lastRequestAt: s.lastRequestAt,
      createdAt: s.createdAt
    }))});
  } catch (e) { res.json({ ok: false, msg: 'Gagal memuat server.' }); }
});

// POST /api/server/create
router.post('/create', auth, async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.json({ ok: false, msg: 'Nama server wajib diisi.' });

    const slug = String(name).trim().toLowerCase().replace(/\s+/g, '-');
    if (!/^[a-z0-9][a-z0-9\-_]{1,28}[a-z0-9]$/.test(slug))
      return res.json({ ok: false, msg: 'Nama: 3–30 karakter, huruf kecil/angka/strip/underscore.' });
    if (RESERVED.has(slug))
      return res.json({ ok: false, msg: 'Nama tersebut tidak bisa digunakan.' });

    const user = await User.findById(req.user._id);
    if (user.serverCount >= MAX_SERVERS)
      return res.json({ ok: false, msg: `Maksimal ${MAX_SERVERS} server per akun.` });

    // Daily limit
    const now = Date.now();
    const resetAt = new Date(user.dailyResetsAt).getTime();
    if (now - resetAt > 86400000) { user.dailyCreates = 0; user.dailyResetsAt = new Date(); }
    if (user.dailyCreates >= MAX_DAILY)
      return res.json({ ok: false, msg: `Batas harian ${MAX_DAILY}x pembuatan server. Coba besok.` });

    // Unique name
    const exists = await Server.findOne({ name: slug });
    if (exists) return res.json({ ok: false, msg: 'Nama server sudah dipakai orang lain.' });

    const server = await Server.create({ name: slug, owner: user._id, ownerUsername: user.username });
    user.serverCount += 1;
    user.dailyCreates += 1;
    await user.save();
    await log(user.username, 'CREATE_SERVER', slug, getIP(req));

    const base = process.env.BASE_URL || 'https://rayapp.vercel.app';
    res.json({ ok: true, server: { id: server._id, name: server.name, url: `${base}/s/${server.name}/` } });
  } catch (e) {
    if (e.code === 11000) return res.json({ ok: false, msg: 'Nama server sudah dipakai.' });
    res.json({ ok: false, msg: 'Gagal membuat server.' });
  }
});

// DELETE /api/server/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.id, owner: req.user._id });
    if (!server) return res.json({ ok: false, msg: 'Server tidak ditemukan.' });
    await File.deleteMany({ serverId: server._id });
    await Server.deleteOne({ _id: server._id });
    await User.updateOne({ _id: req.user._id }, { $inc: { serverCount: -1 } });
    await log(req.user.username, 'DELETE_SERVER', server.name, getIP(req));
    res.json({ ok: true });
  } catch (_) { res.json({ ok: false, msg: 'Gagal menghapus.' }); }
});

// GET /api/server/:id/files  - flat file list
router.get('/:id/files', auth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.id, owner: req.user._id });
    if (!server) return res.json({ ok: false, msg: 'Server tidak ditemukan.' });
    const files = await File.find({ serverId: server._id }).select('filePath mimeType size createdAt').lean();
    const base = process.env.BASE_URL || 'https://rayapp.vercel.app';
    res.json({ ok: true,
      server: { id: server._id, name: server.name, url: `${base}/s/${server.name}/`, totalSize: server.totalSize, totalRequests: server.totalRequests, lastRequestAt: server.lastRequestAt },
      files
    });
  } catch (_) { res.json({ ok: false, msg: 'Gagal memuat.' }); }
});

module.exports = router;
