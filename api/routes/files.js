const router  = require('express').Router();
const multer  = require('multer');
const AdmZip  = require('adm-zip');
const archiver = require('archiver');
const path    = require('path');
const { Server, File, User } = require('../models');
const { auth, log, getIP } = require('../middleware');

const MAX_FILE_SIZE  = 10 * 1024 * 1024;  // 10 MB per file
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;  // 50 MB per server

const BLOCKED_EXT = new Set(['.php','.py','.rb','.sh','.bash','.exe','.bat','.cmd','.ps1','.jar','.dll','.msi','.cgi','.pl','.asp','.aspx']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 30 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXT.has(ext)) return cb(new Error(`Tipe file ${ext} tidak diizinkan.`));
    cb(null, true);
  }
});

function cleanPath(p) {
  return path.posix.normalize(String(p || '').replace(/\\/g,'/')).replace(/^\.+\//,'').replace(/^\//,'');
}

function mime(name) {
  const ext = path.extname(name).toLowerCase();
  const map = { '.html':'text/html','.htm':'text/html','.css':'text/css','.js':'application/javascript','.mjs':'application/javascript','.json':'application/json','.xml':'application/xml','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon','.txt':'text/plain','.md':'text/markdown','.csv':'text/csv','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.eot':'application/vnd.ms-fontobject','.mp3':'audio/mpeg','.mp4':'video/mp4','.webm':'video/webm','.ogg':'audio/ogg','.pdf':'application/pdf','.zip':'application/zip' };
  return map[ext] || 'application/octet-stream';
}

async function recalcSize(serverId) {
  const agg = await File.aggregate([{ $match: { serverId } }, { $group: { _id: null, total: { $sum: '$size' } } }]);
  const total = agg[0]?.total || 0;
  await Server.updateOne({ _id: serverId }, { totalSize: total });
  return total;
}

// POST /api/file/upload/:serverId
router.post('/upload/:serverId', auth, (req, res, next) => {
  upload.array('files', 30)(req, res, err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.json({ ok: false, msg: 'Ukuran file maks 10 MB.' });
      return res.json({ ok: false, msg: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.json({ ok: false, msg: 'Server tidak ditemukan.' });

    const folder = cleanPath(req.body.folder || '');
    const files  = req.files || [];
    if (!files.length) return res.json({ ok: false, msg: 'Tidak ada file.' });

    // Pre-check total size
    const totalNew = files.reduce((s, f) => s + f.size, 0);
    if (server.totalSize + totalNew > MAX_TOTAL_SIZE)
      return res.json({ ok: false, msg: 'Storage server penuh (maks 50 MB).' });

    const results = [];

    for (const f of files) {
      const fname = f.originalname;
      const ext   = path.extname(fname).toLowerCase();

      if (ext === '.zip') {
        // Extract zip
        try {
          const zip = new AdmZip(f.buffer);
          for (const entry of zip.getEntries()) {
            if (entry.isDirectory) continue;
            const ep  = cleanPath(entry.entryName);
            if (!ep || ep.includes('..')) continue;
            const eext = path.extname(ep).toLowerCase();
            if (BLOCKED_EXT.has(eext)) continue;
            const data = entry.getData();
            const fp   = folder ? `${folder}/${ep}` : ep;
            await File.findOneAndUpdate(
              { serverId: server._id, filePath: fp },
              { serverId: server._id, filePath: fp, data, mimeType: mime(ep), size: data.length, createdAt: new Date() },
              { upsert: true }
            );
            results.push({ name: ep, path: fp, size: data.length });
          }
        } catch (_) { results.push({ name: fname, error: 'Gagal extract ZIP.' }); }
        continue;
      }

      const fp = folder ? `${folder}/${fname}` : fname;
      await File.findOneAndUpdate(
        { serverId: server._id, filePath: fp },
        { serverId: server._id, filePath: fp, data: f.buffer, mimeType: mime(fname), size: f.size, createdAt: new Date() },
        { upsert: true }
      );
      results.push({ name: fname, path: fp, size: f.size });
    }

    const newTotal = await recalcSize(server._id);
    await log(req.user.username, 'UPLOAD', `${server.name}: ${files.map(f=>f.originalname).join(', ')}`, getIP(req));
    res.json({ ok: true, results, totalSize: newTotal });
  } catch (e) {
    console.error(e);
    res.json({ ok: false, msg: 'Upload gagal.' });
  }
});

// DELETE /api/file/delete/:serverId
router.delete('/delete/:serverId', auth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.json({ ok: false, msg: 'Server tidak ditemukan.' });

    const { filePath } = req.body || {};
    if (!filePath) return res.json({ ok: false, msg: 'Path wajib diisi.' });

    const fp = cleanPath(filePath);
    const del = await File.deleteOne({ serverId: server._id, filePath: fp });
    if (!del.deletedCount) return res.json({ ok: false, msg: 'File tidak ditemukan.' });

    await recalcSize(server._id);
    await log(req.user.username, 'DELETE_FILE', `${server.name}:${fp}`, getIP(req));
    res.json({ ok: true });
  } catch (_) { res.json({ ok: false, msg: 'Gagal hapus.' }); }
});

// DELETE /api/file/delete-folder/:serverId
router.delete('/delete-folder/:serverId', auth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.json({ ok: false, msg: 'Server tidak ditemukan.' });

    const { folderPath } = req.body || {};
    if (!folderPath) return res.json({ ok: false, msg: 'Path wajib diisi.' });

    const fp = cleanPath(folderPath);
    const result = await File.deleteMany({ serverId: server._id, filePath: new RegExp(`^${fp.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(/|$)`) });
    await recalcSize(server._id);
    await log(req.user.username, 'DELETE_FOLDER', `${server.name}:${fp}`, getIP(req));
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (_) { res.json({ ok: false, msg: 'Gagal hapus folder.' }); }
});

// PUT /api/file/rename/:serverId
router.put('/rename/:serverId', auth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.json({ ok: false, msg: 'Server tidak ditemukan.' });

    const { oldPath, newName } = req.body || {};
    if (!oldPath || !newName) return res.json({ ok: false, msg: 'Path dan nama baru wajib diisi.' });

    const old  = cleanPath(oldPath);
    const safe = String(newName).replace(/[^a-zA-Z0-9.\-_ ]/g, '_').trim();
    const dir  = old.includes('/') ? old.substring(0, old.lastIndexOf('/')) : '';
    const newP = dir ? `${dir}/${safe}` : safe;

    const conflict = await File.findOne({ serverId: server._id, filePath: newP });
    if (conflict) return res.json({ ok: false, msg: 'Nama sudah ada.' });

    const f = await File.findOne({ serverId: server._id, filePath: old });
    if (!f) return res.json({ ok: false, msg: 'File tidak ditemukan.' });

    f.filePath = newP;
    f.mimeType = mime(safe);
    await f.save();
    res.json({ ok: true, newPath: newP });
  } catch (_) { res.json({ ok: false, msg: 'Gagal rename.' }); }
});

// GET /api/file/content/:serverId?path=xxx  - read text file
router.get('/content/:serverId', auth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.json({ ok: false, msg: 'Server tidak ditemukan.' });

    const fp = cleanPath(req.query.path || '');
    const f  = await File.findOne({ serverId: server._id, filePath: fp });
    if (!f) return res.json({ ok: false, msg: 'File tidak ditemukan.' });

    const isText = f.mimeType.startsWith('text/') || ['application/javascript','application/json','application/xml','image/svg+xml'].includes(f.mimeType);
    if (!isText) return res.json({ ok: false, msg: 'File bukan teks.' });

    res.json({ ok: true, content: f.data.toString('utf8'), mimeType: f.mimeType });
  } catch (_) { res.json({ ok: false, msg: 'Gagal baca file.' }); }
});

// PUT /api/file/save/:serverId  - save edited text file
router.put('/save/:serverId', auth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.json({ ok: false, msg: 'Server tidak ditemukan.' });

    const { filePath, content } = req.body || {};
    if (!filePath) return res.json({ ok: false, msg: 'Path wajib diisi.' });

    const fp  = cleanPath(filePath);
    const buf = Buffer.from(String(content || ''), 'utf8');
    if (buf.length > MAX_FILE_SIZE) return res.json({ ok: false, msg: 'File terlalu besar.' });

    await File.findOneAndUpdate(
      { serverId: server._id, filePath: fp },
      { data: buf, mimeType: mime(fp), size: buf.length, createdAt: new Date() },
      { upsert: true }
    );
    await recalcSize(server._id);
    await log(req.user.username, 'SAVE_FILE', `${server.name}:${fp}`, getIP(req));
    res.json({ ok: true });
  } catch (_) { res.json({ ok: false, msg: 'Gagal simpan.' }); }
});

// GET /api/file/download/:serverId?path=xxx
router.get('/download/:serverId', auth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.status(404).end();
    const fp = cleanPath(req.query.path || '');
    const f  = await File.findOne({ serverId: server._id, filePath: fp });
    if (!f) return res.status(404).end();
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fp)}"`);
    res.setHeader('Content-Type', f.mimeType);
    res.send(f.data);
  } catch (_) { res.status(500).end(); }
});

// GET /api/file/download-all/:serverId
router.get('/download-all/:serverId', auth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.status(404).end();
    const files = await File.find({ serverId: server._id });
    res.setHeader('Content-Disposition', `attachment; filename="${server.name}.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    const arc = archiver('zip', { zlib: { level: 6 } });
    arc.on('error', () => res.status(500).end());
    arc.pipe(res);
    for (const f of files) arc.append(f.data, { name: f.filePath });
    await arc.finalize();
  } catch (_) { res.status(500).end(); }
});

// POST /api/file/mkdir/:serverId
router.post('/mkdir/:serverId', auth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.json({ ok: false, msg: 'Server tidak ditemukan.' });
    const { folderPath } = req.body || {};
    if (!folderPath) return res.json({ ok: false, msg: 'Path wajib diisi.' });
    const fp = cleanPath(folderPath) + '/.keep';
    await File.findOneAndUpdate(
      { serverId: server._id, filePath: fp },
      { serverId: server._id, filePath: fp, data: Buffer.from(''), mimeType: 'text/plain', size: 0 },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (_) { res.json({ ok: false, msg: 'Gagal buat folder.' }); }
});

module.exports = router;
