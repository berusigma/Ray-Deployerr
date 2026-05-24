require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const path = require('path');
const { ipGuard } = require('./middleware');

const app = express();

// ── DB connection (cached for serverless) ──────────────
let dbConn = null;
async function connectDB() {
  if (dbConn && mongoose.connection.readyState === 1) return;
  dbConn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/rayapp');
  console.log('MongoDB connected');
}
connectDB().catch(e => console.error('MongoDB error:', e.message));

// ── Security ───────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      frameSrc:   ["'none'"],
      objectSrc:  ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(rateLimit({ windowMs: 15*60*1000, max: 500, standardHeaders: true, legacyHeaders: false }));
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));
app.use(mongoSanitize());
app.use(ipGuard);

// ── Static files ───────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ── API routes ─────────────────────────────────────────
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 30 });
app.use('/api/auth',   authLimiter, require('./routes/auth'));
app.use('/api/server', require('./routes/servers'));
app.use('/api/file',   require('./routes/files'));
app.use('/api/admin',  require('./routes/admin'));

// ── Serve hosted sites:  /s/sitename/path ─────────────
const { Server, File } = require('./models');
app.use('/s/:site', async (req, res) => {
  try {
    await connectDB();
    const siteName = req.params.site.toLowerCase();
    const server = await Server.findOne({ name: siteName });
    if (!server) return res.status(404).send(page404(siteName));

    await Server.updateOne({ _id: server._id }, { $inc: { totalRequests: 1 }, lastRequestAt: new Date() });

    let filePath = req.path.replace(/^\//, '') || 'index.html';
    if (filePath.endsWith('/')) filePath += 'index.html';

    let file = await File.findOne({ serverId: server._id, filePath });
    if (!file) file = await File.findOne({ serverId: server._id, filePath: 'index.html' });
    if (!file) return res.status(404).send(page404(siteName));

    res.setHeader('Content-Type', file.mimeType + (file.mimeType.startsWith('text/') ? '; charset=utf-8' : ''));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.data);
  } catch (e) {
    res.status(500).send('<h1>Error</h1>');
  }
});

// ── Auto-delete inactive servers (hourly) ─────────────
setInterval(async () => {
  try {
    await connectDB();
    const cutoff = new Date(Date.now() - 7*24*60*60*1000);
    const dead = await Server.find({ lastRequestAt: { $lt: cutoff } });
    for (const s of dead) {
      await File.deleteMany({ serverId: s._id });
      await Server.deleteOne({ _id: s._id });
      const { User } = require('./models');
      await User.updateOne({ _id: s.owner }, { $inc: { serverCount: -1 } });
      console.log('Auto-deleted inactive server:', s.name);
    }
  } catch (_) {}
}, 60*60*1000);

// ── SPA routes ─────────────────────────────────────────
const pages = ['dashboard','filemanager','admin-panel','login','register'];
pages.forEach(p => {
  app.get('/' + p, (_, res) => res.sendFile(path.join(__dirname, `../public/${p}.html`)));
});
app.get('/', (_, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.use((_, res) => res.status(404).sendFile(path.join(__dirname, '../public/404.html')));

// ── Error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, msg: 'Server error.' });
});

function page404(name) {
  return `<!DOCTYPE html><html><head><title>404</title><style>body{font-family:system-ui;background:#f1f5f9;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;gap:12px}h1{font-size:4rem;margin:0;color:#2563eb}p{color:#64748b}</style></head><body><h1>404</h1><p>Site <b>${name}</b> tidak ditemukan.</p><a href="/" style="color:#2563eb">Kembali</a></body></html>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ray App running on :${PORT}`));
module.exports = app;
