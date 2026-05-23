require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const path = require('path');
const { ipBlocker } = require('./middleware');

const app = express();

// ─── CONNECT MONGODB ─────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/rayapp')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(e => console.error('❌ MongoDB error:', e.message));

// ─── SECURITY HEADERS ────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// ─── RATE LIMITERS ───────────────────────────────────────
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'RATE_LIMIT', message: 'Terlalu banyak percobaan, coba lagi 15 menit.' } });
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

app.use(globalLimiter);
app.use(cors({ origin: process.env.BASE_URL || '*', credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(mongoSanitize());
app.use(ipBlocker);

// ─── STATIC FILES ────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ─── ROUTES ──────────────────────────────────────────────
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/servers', require('./routes/servers'));
app.use('/api/files', uploadLimiter, require('./routes/files'));
app.use('/api/admin', require('./routes/admin'));

// ─── SERVE HOSTED WEBSITES ───────────────────────────────
// GET /s/foldername/path  → serve user's file
const { Server, FileData } = require('./models');

app.get('/s/:serverName/*', async (req, res) => {
  try {
    const serverName = req.params.serverName.toLowerCase();
    const filePath = req.params[0] || 'index.html';

    const server = await Server.findOne({ name: serverName, isActive: true });
    if (!server) return res.status(404).send(notFoundPage(serverName));

    // Update traffic
    await Server.updateOne({ _id: server._id }, {
      $inc: { totalRequests: 1 },
      lastRequest: new Date()
    });

    const targetPath = filePath || 'index.html';
    const fileData = await FileData.findOne({ serverId: server._id, filePath: targetPath });

    if (!fileData) {
      // Try index.html
      const indexFile = await FileData.findOne({ serverId: server._id, filePath: 'index.html' });
      if (indexFile) {
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('X-Frame-Options', 'SAMEORIGIN');
        return res.send(indexFile.data);
      }
      return res.status(404).send(notFoundPage(serverName));
    }

    res.set('Content-Type', fileData.mimeType);
    res.set('X-Content-Type-Options', 'nosniff');
    if (fileData.mimeType.startsWith('text/')) {
      res.set('Content-Type', fileData.mimeType + '; charset=utf-8');
    }
    res.send(fileData.data);
  } catch (e) {
    res.status(500).send('<h1>Server Error</h1>');
  }
});

app.get('/s/:serverName', async (req, res) => {
  res.redirect(`/s/${req.params.serverName}/`);
});

// ─── AUTO-DELETE INACTIVE SERVERS (run every hour) ───────
const { Activity } = require('./models');
setInterval(async () => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const inactiveServers = await Server.find({ lastRequest: { $lt: sevenDaysAgo }, isActive: true });
    for (const srv of inactiveServers) {
      await FileData.deleteMany({ serverId: srv._id });
      await Server.deleteOne({ _id: srv._id });
      await Activity.create({
        username: 'SYSTEM',
        action: 'AUTO_DELETE_SERVER',
        target: srv.name,
        ip: 'system'
      });
      // Update owner serverCount
      const { User } = require('./models');
      await User.updateOne({ _id: srv.owner }, { $inc: { serverCount: -1 } });
      console.log(`🗑️ Auto-deleted inactive server: ${srv.name}`);
    }
  } catch (e) { /* silent */ }
}, 60 * 60 * 1000);

// ─── SPA FALLBACK ────────────────────────────────────────
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../public/dashboard.html')));
app.get('/filemanager', (req, res) => res.sendFile(path.join(__dirname, '../public/filemanager.html')));
app.get('/admin-panel', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, '../public/register.html')));

// ─── 404 ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
});

// ─── ERROR HANDLER ───────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'SERVER_ERROR', message: 'Terjadi kesalahan server.' });
});

function notFoundPage(name) {
  return `<!DOCTYPE html><html><head><title>404 - Ray App</title><style>body{font-family:sans-serif;background:#0a1628;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column}h1{font-size:4rem;margin:0}p{color:#64b5f6}</style></head><body><h1>404</h1><p>Server <strong>${name}</strong> tidak ditemukan atau sudah dihapus.</p><a href="/" style="color:#4dd0e1;margin-top:1rem">Kembali ke Ray App</a></body></html>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Ray App running on port ${PORT}`));
module.exports = app;
