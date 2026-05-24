const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { User } = require('../models');
const { makeToken, log, getIP } = require('../middleware');

const SECRET = () => process.env.JWT_SECRET || 'rayapp_dev_secret_change_me';

// Emoji pool
const EMOJIS = [
  { id:'wave',     e:'🌊' }, { id:'fish',    e:'🐠' },
  { id:'anchor',   e:'⚓' }, { id:'shell',   e:'🐚' },
  { id:'whale',    e:'🐋' }, { id:'dolphin', e:'🐬' },
  { id:'crab',     e:'🦀' }, { id:'octopus', e:'🐙' },
  { id:'turtle',   e:'🐢' }, { id:'shark',   e:'🦈' },
  { id:'star',     e:'⭐' }, { id:'rocket',  e:'🚀' },
  { id:'fire',     e:'🔥' }, { id:'gem',     e:'💎' },
];

// GET /api/auth/captcha
router.get('/captcha', (req, res) => {
  const pool = [...EMOJIS].sort(() => Math.random() - 0.5).slice(0, 5);
  const target = pool[Math.floor(Math.random() * pool.length)];
  // Grid = 5 unique + 3 more copies of target = 8 cells total
  const grid = [...pool, target, target, target].sort(() => Math.random() - 0.5);
  const token = jwt.sign({ tid: target.id, ts: Date.now() }, SECRET(), { expiresIn: '10m' });
  res.json({ ok: true, grid: grid.map(g => ({ id: g.id, e: g.e })), target: target.e, token });
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, password, captchaToken, captchaAnswer } = req.body || {};

    // Basic validation
    if (!username || !password || !captchaToken || !captchaAnswer)
      return res.json({ ok: false, msg: 'Semua field wajib diisi.' });

    const uname = String(username).trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(uname))
      return res.json({ ok: false, msg: 'Username: 3–20 karakter, huruf kecil/angka/underscore.' });

    const pwd = String(password);
    if (pwd.length < 6 || pwd.length > 72)
      return res.json({ ok: false, msg: 'Password: 6–72 karakter.' });

    // Verify captcha
    let payload;
    try { payload = jwt.verify(String(captchaToken), SECRET()); }
    catch (_) { return res.json({ ok: false, msg: 'Captcha kadaluarsa. Refresh dan coba lagi.', captchaExpired: true }); }
    if (payload.tid !== String(captchaAnswer))
      return res.json({ ok: false, msg: 'Verifikasi emoji salah.', captchaWrong: true });

    // Check duplicate
    const exists = await User.findOne({ username: uname });
    if (exists) return res.json({ ok: false, msg: 'Username sudah dipakai.' });

    const hash = await bcrypt.hash(pwd, 12);
    const user = await User.create({ username: uname, password: hash });
    await log(uname, 'REGISTER', null, getIP(req));
    res.json({ ok: true, token: makeToken(user), username: user.username, role: user.role });
  } catch (e) {
    console.error(e);
    res.json({ ok: false, msg: 'Server error, coba lagi.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.json({ ok: false, msg: 'Isi username dan password.' });

    const user = await User.findOne({ username: String(username).trim().toLowerCase() });
    if (!user) return res.json({ ok: false, msg: 'Username atau password salah.' });
    if (user.isBlocked) return res.json({ ok: false, msg: 'Akun kamu diblokir.' });

    const match = await bcrypt.compare(String(password), user.password);
    if (!match) return res.json({ ok: false, msg: 'Username atau password salah.' });

    user.lastLoginAt = new Date();
    await user.save();
    await log(user.username, 'LOGIN', null, getIP(req));
    res.json({ ok: true, token: makeToken(user), username: user.username, role: user.role });
  } catch (e) {
    res.json({ ok: false, msg: 'Server error.' });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware').auth, async (req, res) => {
  const u = req.user;
  // Reset daily counter if > 24h
  const now = Date.now();
  const resetAt = new Date(u.dailyResetsAt).getTime();
  const dailyCreates = (now - resetAt > 86400000) ? 0 : u.dailyCreates;
  res.json({ ok: true, user: { id: u._id, username: u.username, role: u.role, serverCount: u.serverCount, dailyCreates, createdAt: u.createdAt } });
});

module.exports = router;
