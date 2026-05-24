const router = require('express').Router();
const { User, Server, File, Activity, BlockedIP } = require('../models');
const { adminAuth, log, getIP } = require('../middleware');

// GET /api/admin/stats
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [users, servers, files, ips] = await Promise.all([
      User.countDocuments(), Server.countDocuments(), File.countDocuments(), BlockedIP.countDocuments()
    ]);
    const agg = await File.aggregate([{ $group: { _id: null, total: { $sum: '$size' } } }]);
    const storage = agg[0]?.total || 0;
    const activity = await Activity.find().sort({ createdAt: -1 }).limit(30).lean();
    res.json({ ok: true, stats: { users, servers, files, ips, storage }, activity });
  } catch (_) { res.json({ ok: false, msg: 'Gagal.' }); }
});

// GET /api/admin/users
router.get('/users', adminAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const q    = req.query.q || '';
    const filter = q ? { username: { $regex: q, $options: 'i' } } : {};
    const [users, total] = await Promise.all([
      User.find(filter).select('-password').sort({ createdAt: -1 }).skip((page-1)*20).limit(20).lean(),
      User.countDocuments(filter)
    ]);
    res.json({ ok: true, users, total, pages: Math.ceil(total/20), page });
  } catch (_) { res.json({ ok: false }); }
});

// GET /api/admin/servers
router.get('/servers', adminAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const q    = req.query.q || '';
    const filter = q ? { $or: [{ name: { $regex: q, $options: 'i' } }, { ownerUsername: { $regex: q, $options: 'i' } }] } : {};
    const [servers, total] = await Promise.all([
      Server.find(filter).sort({ createdAt: -1 }).skip((page-1)*20).limit(20).lean(),
      Server.countDocuments(filter)
    ]);
    const base = process.env.BASE_URL || 'https://rayapp.vercel.app';
    res.json({ ok: true, servers: servers.map(s => ({ ...s, url: `${base}/s/${s.name}/` })), total, pages: Math.ceil(total/20), page });
  } catch (_) { res.json({ ok: false }); }
});

// GET /api/admin/server/:id/files
router.get('/server/:id/files', adminAuth, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id).lean();
    if (!server) return res.json({ ok: false, msg: 'Tidak ditemukan.' });
    const files = await File.find({ serverId: server._id }).select('filePath size mimeType createdAt').lean();
    res.json({ ok: true, server, files });
  } catch (_) { res.json({ ok: false }); }
});

// DELETE /api/admin/server/:id
router.delete('/server/:id', adminAuth, async (req, res) => {
  try {
    const s = await Server.findById(req.params.id);
    if (!s) return res.json({ ok: false, msg: 'Tidak ditemukan.' });
    await File.deleteMany({ serverId: s._id });
    await User.updateOne({ _id: s.owner }, { $inc: { serverCount: -1 } });
    await Server.deleteOne({ _id: s._id });
    await log(req.user.username, 'ADMIN_DEL_SERVER', s.name, getIP(req));
    res.json({ ok: true });
  } catch (_) { res.json({ ok: false }); }
});

// PUT /api/admin/user/:id/block
router.put('/user/:id/block', adminAuth, async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.json({ ok: false, msg: 'User tidak ditemukan.' });
    if (u.role === 'admin') return res.json({ ok: false, msg: 'Tidak bisa blokir admin.' });
    u.isBlocked = !u.isBlocked;
    await u.save();
    await log(req.user.username, u.isBlocked ? 'BLOCK_USER' : 'UNBLOCK_USER', u.username, getIP(req));
    res.json({ ok: true, isBlocked: u.isBlocked });
  } catch (_) { res.json({ ok: false }); }
});

// DELETE /api/admin/user/:id
router.delete('/user/:id', adminAuth, async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.json({ ok: false, msg: 'User tidak ditemukan.' });
    if (u.role === 'admin') return res.json({ ok: false, msg: 'Tidak bisa hapus admin.' });
    const srvs = await Server.find({ owner: u._id });
    for (const s of srvs) await File.deleteMany({ serverId: s._id });
    await Server.deleteMany({ owner: u._id });
    await User.deleteOne({ _id: u._id });
    await log(req.user.username, 'ADMIN_DEL_USER', u.username, getIP(req));
    res.json({ ok: true });
  } catch (_) { res.json({ ok: false }); }
});

// POST /api/admin/block-ip
router.post('/block-ip', adminAuth, async (req, res) => {
  try {
    const { ip, reason } = req.body || {};
    if (!ip) return res.json({ ok: false, msg: 'IP wajib diisi.' });
    await BlockedIP.findOneAndUpdate({ ip }, { ip, reason: reason || 'Diblokir admin', blockedBy: req.user.username }, { upsert: true });
    await log(req.user.username, 'BLOCK_IP', ip, getIP(req));
    res.json({ ok: true });
  } catch (_) { res.json({ ok: false }); }
});

// DELETE /api/admin/block-ip/:ip
router.delete('/block-ip/:ip', adminAuth, async (req, res) => {
  try {
    await BlockedIP.deleteOne({ ip: req.params.ip });
    res.json({ ok: true });
  } catch (_) { res.json({ ok: false }); }
});

// GET /api/admin/blocked-ips
router.get('/blocked-ips', adminAuth, async (req, res) => {
  try {
    const ips = await BlockedIP.find().sort({ createdAt: -1 }).lean();
    res.json({ ok: true, ips });
  } catch (_) { res.json({ ok: false }); }
});

// GET /api/admin/activity
router.get('/activity', adminAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const q = req.query.q || '';
    const filter = q ? { $or: [{ action: { $regex: q, $options: 'i' } }, { username: { $regex: q, $options: 'i' } }] } : {};
    const [logs, total] = await Promise.all([
      Activity.find(filter).sort({ createdAt: -1 }).skip((page-1)*50).limit(50).lean(),
      Activity.countDocuments(filter)
    ]);
    res.json({ ok: true, logs, total, pages: Math.ceil(total/50), page });
  } catch (_) { res.json({ ok: false }); }
});

module.exports = router;
