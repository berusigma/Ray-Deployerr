const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { User, Activity } = require('../models');
const { requireAuth, logActivity, generateToken, sanitize } = require('../middleware');

// ─── EMOJI CAPTCHA DATA ───────────────────────────────────
const EMOJI_PAIRS = [
  { id: 'wave', symbol: '🌊' }, { id: 'fish', symbol: '🐠' },
  { id: 'anchor', symbol: '⚓' }, { id: 'shell', symbol: '🐚' },
  { id: 'whale', symbol: '🐋' }, { id: 'dolphin', symbol: '🐬' },
  { id: 'crab', symbol: '🦀' }, { id: 'octopus', symbol: '🐙' },
  { id: 'coral', symbol: '🪸' }, { id: 'turtle', symbol: '🐢' },
  { id: 'shark', symbol: '🦈' }, { id: 'jellyfish', symbol: '🪼' }
];

function generateCaptcha() {
  const shuffled = [...EMOJI_PAIRS].sort(() => Math.random() - 0.5).slice(0, 6);
  const target = shuffled[Math.floor(Math.random() * shuffled.length)];
  // Grid: 6 unique emojis + 2 duplicates of target = 8 items, clean 4x2 grid
  const grid = [...shuffled, { ...target }, { ...target }].sort(() => Math.random() - 0.5);
  return { grid, targetId: target.id, targetSymbol: target.symbol };
}

// ─── GET CAPTCHA ──────────────────────────────────────────
router.get('/captcha', (req, res) => {
  const captcha = generateCaptcha();
  // Store answer in a simple signed way (production: use server-side session or signed JWT)
  const token = require('jsonwebtoken').sign(
    { targetId: captcha.targetId, ts: Date.now() },
    process.env.JWT_SECRET || 'rayapp_secret',
    { expiresIn: '5m' }
  );
  res.json({
    grid: captcha.grid,
    targetSymbol: captcha.targetSymbol,
    captchaToken: token
  });
});

// ─── REGISTER ─────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    let { username, password, captchaToken, captchaAnswer } = req.body;

    // Validate input
    if (!username || !password || !captchaToken || !captchaAnswer) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Semua field wajib diisi.' });
    }

    username = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'INVALID_USERNAME', message: 'Username hanya boleh huruf kecil, angka, underscore. 3-20 karakter.' });
    }
    username = sanitize(username);
    if (password.length < 6 || password.length > 64) {
      return res.status(400).json({ error: 'INVALID_PASSWORD', message: 'Password minimal 6 karakter, maksimal 64.' });
    }

    // Verify captcha
    let captchaValid = false;
    try {
      const decoded = require('jsonwebtoken').verify(captchaToken, process.env.JWT_SECRET || 'rayapp_secret');
      captchaValid = decoded.targetId === captchaAnswer;
    } catch (e) {
      return res.status(400).json({ error: 'CAPTCHA_EXPIRED', message: 'Captcha kadaluarsa, refresh halaman.' });
    }
    if (!captchaValid) {
      return res.status(400).json({ error: 'CAPTCHA_WRONG', message: 'Verifikasi emoji salah, coba lagi.' });
    }

    // Check duplicate username
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(409).json({ error: 'USERNAME_TAKEN', message: 'Username sudah dipakai.' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({ username, password: hashed });

    await logActivity(user._id, username, 'REGISTER', null, req);

    const token = generateToken(user);
    res.status(201).json({ success: true, token, username: user.username, role: user.role });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Gagal register.' });
  }
});

// ─── LOGIN ────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    let { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Username dan password wajib diisi.' });
    }

    username = username.trim().toLowerCase();
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: 'INVALID_CREDS', message: 'Username atau password salah.' });
    if (user.isBlocked) return res.status(403).json({ error: 'BLOCKED', message: 'Akun kamu telah diblokir.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'INVALID_CREDS', message: 'Username atau password salah.' });

    user.lastLogin = new Date();
    await user.save();

    await logActivity(user._id, username, 'LOGIN', null, req);

    const token = generateToken(user);
    res.json({ success: true, token, username: user.username, role: user.role });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Gagal login.' });
  }
});

// ─── ME ───────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const user = req.user;
  res.json({
    id: user._id,
    username: user.username,
    role: user.role,
    serverCount: user.serverCount,
    dailyCreates: user.dailyCreates,
    dailyCreatesReset: user.dailyCreatesReset,
    createdAt: user.createdAt
  });
});

// ─── CHANGE PASSWORD ──────────────────────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Field tidak boleh kosong.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'WEAK_PASSWORD', message: 'Password baru minimal 6 karakter.' });

    const user = await User.findById(req.user._id);
    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) return res.status(400).json({ error: 'WRONG_PASSWORD', message: 'Password lama salah.' });

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    await logActivity(user._id, user.username, 'CHANGE_PASSWORD', null, req);

    res.json({ success: true, message: 'Password berhasil diubah.' });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
