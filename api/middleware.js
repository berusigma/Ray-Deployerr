const jwt = require('jsonwebtoken');
const { User, BlockedIP, Activity } = require('./models');

const JWT_SECRET = process.env.JWT_SECRET || 'rayapp_secret_change_in_prod';

// ─── IP Blocker Middleware ────────────────────────────────
async function ipBlocker(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  req.clientIP = ip;
  try {
    const blocked = await BlockedIP.findOne({ ip });
    if (blocked) {
      return res.status(403).json({ error: 'IP_BLOCKED', message: 'Akses ditolak. IP kamu telah diblokir.' });
    }
    next();
  } catch (e) {
    next();
  }
}

// ─── JWT Auth Middleware ──────────────────────────────────
async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
    if (!token) return res.status(401).json({ error: 'NO_TOKEN', message: 'Token tidak ditemukan.' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Token tidak valid.' });
    if (user.isBlocked) return res.status(403).json({ error: 'USER_BLOCKED', message: 'Akun kamu telah diblokir.' });

    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Sesi habis, silakan login ulang.' });
  }
}

// ─── Admin Middleware ─────────────────────────────────────
async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Akses admin diperlukan.' });
    }
    next();
  });
}

// ─── Activity Logger ──────────────────────────────────────
async function logActivity(userId, username, action, target, req) {
  try {
    await Activity.create({
      userId,
      username,
      action,
      target,
      ip: req?.clientIP || 'unknown',
      userAgent: req?.headers?.['user-agent']?.substring(0, 200) || 'unknown'
    });
  } catch (e) { /* silent */ }
}

// ─── XSS Sanitizer ───────────────────────────────────────
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

function generateToken(user) {
  return jwt.sign({ id: user._id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { ipBlocker, requireAuth, requireAdmin, logActivity, sanitize, generateToken };
