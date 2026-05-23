const express = require('express');
const router = express.Router();
const { Server, User, Activity, FileData } = require('../models');
const { requireAuth, logActivity, sanitize } = require('../middleware');

const MAX_SERVERS = 4;
const MAX_DAILY_CREATES = 2;
const WA_CHANNEL = 'https://whatsapp.com/channel/0029Vb89VkwLNSZyIqpdbX3t';
const TIKTOK_URL = 'https://www.tiktok.com/@rayapp_host'; // sesuaikan

// ─── GET ALL MY SERVERS ───────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const servers = await Server.find({ owner: req.user._id })
      .select('-files')
      .sort({ createdAt: -1 });
    res.json({ servers });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── GET REDIRECT LINKS (sebelum create) ─────────────────
router.get('/prereq-links', requireAuth, (req, res) => {
  res.json({ wa: WA_CHANNEL, tiktok: TIKTOK_URL });
});

// ─── CREATE SERVER ────────────────────────────────────────
router.post('/create', requireAuth, async (req, res) => {
  try {
    let { name, waConfirmed, tiktokConfirmed } = req.body;

    // Require both confirmations
    if (!waConfirmed || !tiktokConfirmed) {
      return res.status(400).json({ error: 'PREREQ_REQUIRED', message: 'Kamu harus follow WA Channel dan TikTok terlebih dahulu.' });
    }

    // Validate folder name
    if (!name) return res.status(400).json({ error: 'MISSING_NAME', message: 'Nama folder wajib diisi.' });
    name = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!/^[a-z0-9\-_]{3,30}$/.test(name)) {
      return res.status(400).json({ error: 'INVALID_NAME', message: 'Nama folder hanya boleh huruf kecil, angka, strip, underscore. 3-30 karakter.' });
    }

    // Reserved names
    const reserved = ['api', 'admin', 'dashboard', 'login', 'register', 'static', 's', 'assets', 'public', 'system', 'rayapp'];
    if (reserved.includes(name)) {
      return res.status(400).json({ error: 'RESERVED_NAME', message: 'Nama folder tersebut tidak bisa digunakan.' });
    }

    // Check global uniqueness
    const existing = await Server.findOne({ name });
    if (existing) return res.status(409).json({ error: 'NAME_TAKEN', message: 'Nama folder sudah dipakai orang lain.' });

    // Refresh user data
    const user = await User.findById(req.user._id);

    // Check max servers
    if (user.serverCount >= MAX_SERVERS) {
      return res.status(400).json({ error: 'MAX_SERVERS', message: `Maksimal ${MAX_SERVERS} server per akun.` });
    }

    // Reset daily counter if needed
    const now = new Date();
    const resetTime = new Date(user.dailyCreatesReset);
    if (now - resetTime > 24 * 60 * 60 * 1000) {
      user.dailyCreates = 0;
      user.dailyCreatesReset = now;
    }

    // Check daily limit
    if (user.dailyCreates >= MAX_DAILY_CREATES) {
      const nextReset = new Date(resetTime.getTime() + 24 * 60 * 60 * 1000);
      return res.status(429).json({
        error: 'DAILY_LIMIT',
        message: `Kamu sudah membuat ${MAX_DAILY_CREATES} server hari ini. Coba lagi ${nextReset.toLocaleTimeString('id-ID')}.`,
        nextReset
      });
    }

    // Create server
    const server = await Server.create({
      name,
      owner: user._id,
      ownerUsername: user.username
    });

    user.serverCount += 1;
    user.dailyCreates += 1;
    await user.save();

    await logActivity(user._id, user.username, 'CREATE_SERVER', name, req);

    const baseUrl = process.env.BASE_URL || 'https://rayapp.vercel.app';
    res.status(201).json({
      success: true,
      server: {
        id: server._id,
        name: server.name,
        url: `${baseUrl}/s/${server.name}/`,
        createdAt: server.createdAt
      }
    });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'NAME_TAKEN', message: 'Nama folder sudah dipakai.' });
    console.error(e);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── GET SERVER DETAIL ────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.id, owner: req.user._id });
    if (!server) return res.status(404).json({ error: 'NOT_FOUND', message: 'Server tidak ditemukan.' });

    const files = await FileData.find({ serverId: server._id }).select('filePath size mimeType uploadedAt -data');
    const baseUrl = process.env.BASE_URL || 'https://rayapp.vercel.app';

    res.json({
      server: {
        id: server._id,
        name: server.name,
        url: `${baseUrl}/s/${server.name}/`,
        createdAt: server.createdAt,
        lastRequest: server.lastRequest,
        totalRequests: server.totalRequests,
        totalSize: server.totalSize,
        isActive: server.isActive,
        files
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── DELETE SERVER ────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.id, owner: req.user._id });
    if (!server) return res.status(404).json({ error: 'NOT_FOUND', message: 'Server tidak ditemukan.' });

    await FileData.deleteMany({ serverId: server._id });
    await Server.deleteOne({ _id: server._id });
    await User.updateOne({ _id: req.user._id }, { $inc: { serverCount: -1 } });

    await logActivity(req.user._id, req.user.username, 'DELETE_SERVER', server.name, req);

    res.json({ success: true, message: 'Server berhasil dihapus.' });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── GET FILE TREE ────────────────────────────────────────
router.get('/:id/filetree', requireAuth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.id, owner: req.user._id });
    if (!server) return res.status(404).json({ error: 'NOT_FOUND' });

    const files = await FileData.find({ serverId: server._id }).select('filePath size mimeType uploadedAt -data');

    // Build tree structure
    const tree = buildTree(files.map(f => ({ path: f.filePath, size: f.size, mimeType: f.mimeType, uploadedAt: f.uploadedAt, _id: f._id })));

    res.json({ tree, totalSize: server.totalSize });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

function buildTree(files) {
  const root = { name: '/', type: 'folder', children: [], path: '' };
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let folder = current.children.find(c => c.name === parts[i] && c.type === 'folder');
      if (!folder) {
        folder = { name: parts[i], type: 'folder', children: [], path: parts.slice(0, i + 1).join('/') };
        current.children.push(folder);
      }
      current = folder;
    }
    const fname = parts[parts.length - 1];
    current.children.push({
      name: fname,
      type: 'file',
      path: file.path,
      size: file.size,
      mimeType: file.mimeType,
      uploadedAt: file.uploadedAt,
      _id: file._id
    });
  }
  return root;
}

module.exports = router;
