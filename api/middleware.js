const jwt = require('jsonwebtoken');
const { User, BlockedIP, Activity } = require('./models');

const SECRET = () => process.env.JWT_SECRET || 'rayapp_dev_secret_change_me';

function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

async function ipGuard(req, res, next) {
  req.ip2 = getIP(req);
  try {
    const blocked = await BlockedIP.findOne({ ip: req.ip2 });
    if (blocked) return res.status(403).json({ ok: false, msg: 'IP kamu diblokir.' });
  } catch (_) {}
  next();
}

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ ok: false, msg: 'Token tidak ada.' });
  try {
    const payload = jwt.verify(token, SECRET());
    const user = await User.findById(payload.id).select('-password');
    if (!user) return res.status(401).json({ ok: false, msg: 'User tidak ditemukan.' });
    if (user.isBlocked) return res.status(403).json({ ok: false, msg: 'Akun diblokir.' });
    req.user = user;
    next();
  } catch (_) {
    return res.status(401).json({ ok: false, msg: 'Token tidak valid atau expired.' });
  }
}

async function adminAuth(req, res, next) {
  await auth(req, res, () => {
    if (req.user?.role !== 'admin') return res.status(403).json({ ok: false, msg: 'Admin only.' });
    next();
  });
}

function makeToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, SECRET(), { expiresIn: '30d' });
}

async function log(username, action, detail, ip) {
  try { await Activity.create({ username, action, detail, ip }); } catch (_) {}
}

function xss(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[<>"'&]/g, c => ({ '<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;' }[c]));
}

module.exports = { ipGuard, auth, adminAuth, makeToken, log, xss, getIP };
