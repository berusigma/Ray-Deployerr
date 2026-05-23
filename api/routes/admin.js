const express = require('express');
const router = express.Router();
const { User, Server, Activity, BlockedIP, FileData } = require('../models');
const { requireAdmin, logActivity } = require('../middleware');

// ─── STATS ────────────────────────────────────────────────
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const [totalUsers, totalServers, totalFiles, blockedIPs, recentActivity] = await Promise.all([
      User.countDocuments(),
      Server.countDocuments(),
      FileData.countDocuments(),
      BlockedIP.countDocuments(),
      Activity.find().sort({ timestamp: -1 }).limit(20)
    ]);

    // Total storage
    const storageAgg = await FileData.aggregate([{ $group: { _id: null, total: { $sum: '$size' } } }]);
    const totalStorage = storageAgg[0]?.total || 0;

    res.json({ totalUsers, totalServers, totalFiles, blockedIPs, totalStorage, recentActivity });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── LIST USERS ───────────────────────────────────────────
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const search = req.query.search || '';

    const query = search ? { username: { $regex: search, $options: 'i' } } : {};
    const users = await User.find(query).select('-password').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    const total = await User.countDocuments(query);

    res.json({ users, total, page, pages: Math.ceil(total / limit) });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── LIST SERVERS ─────────────────────────────────────────
router.get('/servers', requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const search = req.query.search || '';

    const query = search ? { $or: [{ name: { $regex: search, $options: 'i' } }, { ownerUsername: { $regex: search, $options: 'i' } }] } : {};
    const servers = await Server.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    const total = await Server.countDocuments(query);

    const baseUrl = process.env.BASE_URL || 'https://rayapp.vercel.app';
    const serversWithUrl = servers.map(s => ({ ...s.toObject(), url: `${baseUrl}/s/${s.name}/` }));

    res.json({ servers: serversWithUrl, total, page, pages: Math.ceil(total / limit) });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── GET SERVER FILES (admin) ─────────────────────────────
router.get('/servers/:id/files', requireAdmin, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) return res.status(404).json({ error: 'NOT_FOUND' });
    const files = await FileData.find({ serverId: server._id }).select('filePath size mimeType uploadedAt -data');
    res.json({ server, files });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── DELETE SERVER (admin) ────────────────────────────────
router.delete('/servers/:id', requireAdmin, async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);
    if (!server) return res.status(404).json({ error: 'NOT_FOUND' });

    await FileData.deleteMany({ serverId: server._id });
    await User.updateOne({ _id: server.owner }, { $inc: { serverCount: -1 } });
    await Server.deleteOne({ _id: server._id });

    await logActivity(req.user._id, req.user.username, 'ADMIN_DELETE_SERVER', server.name, req);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── BLOCK / UNBLOCK USER ─────────────────────────────────
router.put('/users/:id/block', requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'NOT_FOUND' });
    if (user.role === 'admin') return res.status(400).json({ error: 'CANNOT_BLOCK_ADMIN' });

    user.isBlocked = !user.isBlocked;
    await user.save();

    await logActivity(req.user._id, req.user.username, user.isBlocked ? 'BLOCK_USER' : 'UNBLOCK_USER', user.username, req);
    res.json({ success: true, isBlocked: user.isBlocked });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── DELETE USER ──────────────────────────────────────────
router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'NOT_FOUND' });
    if (user.role === 'admin') return res.status(400).json({ error: 'CANNOT_DELETE_ADMIN' });

    // Delete all servers and files
    const servers = await Server.find({ owner: user._id });
    for (const srv of servers) {
      await FileData.deleteMany({ serverId: srv._id });
    }
    await Server.deleteMany({ owner: user._id });
    await User.deleteOne({ _id: user._id });

    await logActivity(req.user._id, req.user.username, 'ADMIN_DELETE_USER', user.username, req);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── BLOCK IP ─────────────────────────────────────────────
router.post('/block-ip', requireAdmin, async (req, res) => {
  try {
    const { ip, reason } = req.body;
    if (!ip) return res.status(400).json({ error: 'MISSING_IP' });

    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^[a-f0-9:]+$/i;
    if (!ipRegex.test(ip)) return res.status(400).json({ error: 'INVALID_IP', message: 'Format IP tidak valid.' });

    await BlockedIP.findOneAndUpdate(
      { ip },
      { ip, reason: reason || 'Diblokir oleh admin', blockedBy: req.user.username },
      { upsert: true }
    );

    await logActivity(req.user._id, req.user.username, 'BLOCK_IP', ip, req);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── UNBLOCK IP ───────────────────────────────────────────
router.delete('/block-ip/:ip', requireAdmin, async (req, res) => {
  try {
    await BlockedIP.deleteOne({ ip: req.params.ip });
    await logActivity(req.user._id, req.user.username, 'UNBLOCK_IP', req.params.ip, req);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── LIST BLOCKED IPs ─────────────────────────────────────
router.get('/blocked-ips', requireAdmin, async (req, res) => {
  try {
    const ips = await BlockedIP.find().sort({ blockedAt: -1 });
    res.json({ ips });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── ACTIVITY LOG ─────────────────────────────────────────
router.get('/activity', requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const filter = req.query.filter || '';
    const query = filter ? { $or: [{ action: { $regex: filter, $options: 'i' } }, { username: { $regex: filter, $options: 'i' } }] } : {};
    const logs = await Activity.find(query).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit);
    const total = await Activity.countDocuments(query);
    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── MAKE ADMIN ───────────────────────────────────────────
router.put('/users/:id/make-admin', requireAdmin, async (req, res) => {
  try {
    const { secret } = req.body;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'WRONG_SECRET' });
    await User.updateOne({ _id: req.params.id }, { role: 'admin' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
