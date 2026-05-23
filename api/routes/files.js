const express = require('express');
const router = express.Router();
const multer = require('multer');
const AdmZip = require('adm-zip');
const archiver = require('archiver');
const path = require('path');
const { Server, FileData, User } = require('../models');
const { requireAuth, logActivity, sanitize } = require('../middleware');

const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB per server total
const MAX_FILE_SIZE = 10 * 1024 * 1024;  // 10MB per file

// Multer in-memory
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 20 },
  fileFilter: (req, file, cb) => {
    // Block dangerous extensions
    const dangerous = ['.php', '.py', '.rb', '.sh', '.bash', '.exe', '.bat', '.cmd', '.ps1', '.jar', '.msi', '.dll'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (dangerous.includes(ext)) {
      return cb(new Error(`File ${ext} tidak diizinkan.`));
    }
    cb(null, true);
  }
});

function getMime(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.html': 'text/html', '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.xml': 'application/xml',
    '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
    '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
    '.zip': 'application/zip',
    '.pdf': 'application/pdf'
  };
  return map[ext] || 'application/octet-stream';
}

function sanitizePath(p) {
  // Prevent path traversal
  const clean = path.normalize(p).replace(/^(\.\.(\/|\\|$))+/, '');
  return clean.replace(/\\/g, '/');
}

// ─── UPLOAD FILES ─────────────────────────────────────────
router.post('/upload/:serverId', requireAuth, upload.array('files', 20), async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.status(404).json({ error: 'NOT_FOUND', message: 'Server tidak ditemukan.' });

    const folderPath = sanitizePath(req.body.folderPath || '');
    const files = req.files;
    if (!files || files.length === 0) return res.status(400).json({ error: 'NO_FILES', message: 'Tidak ada file yang diupload.' });

    // Check total size won't exceed limit
    const currentSize = server.totalSize || 0;
    const newFilesSize = files.reduce((sum, f) => sum + f.size, 0);
    if (currentSize + newFilesSize > MAX_TOTAL_SIZE) {
      return res.status(400).json({ error: 'SIZE_LIMIT', message: `Total ukuran melebihi batas 50MB.` });
    }

    const uploaded = [];
    let totalAdded = 0;

    for (const file of files) {
      const filename = sanitize(file.originalname);
      const filePath = folderPath ? `${folderPath}/${filename}` : filename;
      const mimeType = getMime(filename);

      // If it's a zip, extract
      if (path.extname(filename).toLowerCase() === '.zip') {
        try {
          const zip = new AdmZip(file.buffer);
          const entries = zip.getEntries();
          for (const entry of entries) {
            if (entry.isDirectory) continue;
            const entryName = sanitizePath(entry.entryName);
            if (!entryName || entryName.includes('..')) continue;

            // Check dangerous extensions in zip
            const entExt = path.extname(entryName).toLowerCase();
            const dangerous = ['.php', '.py', '.rb', '.sh', '.bash', '.exe', '.bat'];
            if (dangerous.includes(entExt)) continue;

            const entryData = entry.getData();
            const entryPath = folderPath ? `${folderPath}/${entryName}` : entryName;
            const entryMime = getMime(entryName);

            await FileData.findOneAndUpdate(
              { serverId: server._id, filePath: entryPath },
              { serverId: server._id, serverName: server.name, filePath: entryPath, data: entryData, mimeType: entryMime, size: entryData.length, uploadedAt: new Date() },
              { upsert: true, new: true }
            );
            totalAdded += entryData.length;
            uploaded.push({ name: entryName, path: entryPath, extracted: true });
          }
        } catch (zipErr) {
          uploaded.push({ name: filename, error: 'Gagal extract ZIP.' });
        }
        continue;
      }

      await FileData.findOneAndUpdate(
        { serverId: server._id, filePath },
        { serverId: server._id, serverName: server.name, filePath, data: file.buffer, mimeType, size: file.size, uploadedAt: new Date() },
        { upsert: true, new: true }
      );
      totalAdded += file.size;
      uploaded.push({ name: filename, path: filePath, size: file.size });
    }

    // Recalculate total size
    const allFiles = await FileData.find({ serverId: server._id }).select('size');
    const newTotal = allFiles.reduce((s, f) => s + (f.size || 0), 0);
    await Server.updateOne({ _id: server._id }, { totalSize: newTotal, lastActivity: new Date() });

    await logActivity(req.user._id, req.user.username, 'UPLOAD_FILES', server.name + ': ' + uploaded.map(u => u.name).join(', '), req);

    res.json({ success: true, uploaded, totalSize: newTotal });
  } catch (e) {
    if (e.message && e.message.includes('tidak diizinkan')) {
      return res.status(400).json({ error: 'INVALID_FILE', message: e.message });
    }
    if (e.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'FILE_TOO_LARGE', message: 'Ukuran file melebihi batas 10MB.' });
    }
    console.error(e);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── DELETE FILE ──────────────────────────────────────────
router.delete('/file/:serverId', requireAuth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.status(404).json({ error: 'NOT_FOUND' });

    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'MISSING_PATH' });

    const clean = sanitizePath(filePath);
    const result = await FileData.deleteOne({ serverId: server._id, filePath: clean });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'FILE_NOT_FOUND', message: 'File tidak ditemukan.' });

    // Recalculate
    const allFiles = await FileData.find({ serverId: server._id }).select('size');
    await Server.updateOne({ _id: server._id }, { totalSize: allFiles.reduce((s, f) => s + (f.size || 0), 0) });

    await logActivity(req.user._id, req.user.username, 'DELETE_FILE', server.name + ':' + clean, req);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── DELETE FOLDER ────────────────────────────────────────
router.delete('/folder/:serverId', requireAuth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.status(404).json({ error: 'NOT_FOUND' });

    const { folderPath } = req.body;
    const clean = sanitizePath(folderPath || '');
    if (!clean) return res.status(400).json({ error: 'MISSING_PATH' });

    const result = await FileData.deleteMany({ serverId: server._id, filePath: { $regex: `^${clean}/` } });
    const allFiles = await FileData.find({ serverId: server._id }).select('size');
    await Server.updateOne({ _id: server._id }, { totalSize: allFiles.reduce((s, f) => s + (f.size || 0), 0) });

    await logActivity(req.user._id, req.user.username, 'DELETE_FOLDER', server.name + ':' + clean, req);
    res.json({ success: true, deleted: result.deletedCount });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── RENAME FILE ──────────────────────────────────────────
router.put('/rename/:serverId', requireAuth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.status(404).json({ error: 'NOT_FOUND' });

    const { oldPath, newName } = req.body;
    if (!oldPath || !newName) return res.status(400).json({ error: 'MISSING_FIELDS' });

    const cleanOld = sanitizePath(oldPath);
    const safeName = sanitize(newName).replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const dir = cleanOld.includes('/') ? cleanOld.substring(0, cleanOld.lastIndexOf('/')) : '';
    const newPath = dir ? `${dir}/${safeName}` : safeName;

    // Check no conflict
    const conflict = await FileData.findOne({ serverId: server._id, filePath: newPath });
    if (conflict) return res.status(409).json({ error: 'NAME_CONFLICT', message: 'Nama file sudah ada.' });

    const file = await FileData.findOne({ serverId: server._id, filePath: cleanOld });
    if (!file) return res.status(404).json({ error: 'FILE_NOT_FOUND' });

    file.filePath = newPath;
    file.mimeType = getMime(safeName);
    await file.save();

    await logActivity(req.user._id, req.user.username, 'RENAME_FILE', `${server.name}: ${cleanOld} → ${newPath}`, req);
    res.json({ success: true, newPath });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── DOWNLOAD SINGLE FILE ─────────────────────────────────
router.get('/download/:serverId', requireAuth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.status(404).json({ error: 'NOT_FOUND' });

    const filePath = sanitizePath(req.query.path || '');
    const file = await FileData.findOne({ serverId: server._id, filePath });
    if (!file) return res.status(404).json({ error: 'FILE_NOT_FOUND' });

    const filename = path.basename(filePath);
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.set('Content-Type', file.mimeType);
    res.send(file.data);
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── DOWNLOAD ALL AS ZIP ─────────────────────────────────
router.get('/download-all/:serverId', requireAuth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.status(404).json({ error: 'NOT_FOUND' });

    const files = await FileData.find({ serverId: server._id });
    if (files.length === 0) return res.status(404).json({ error: 'NO_FILES', message: 'Server kosong.' });

    res.set('Content-Disposition', `attachment; filename="${server.name}.zip"`);
    res.set('Content-Type', 'application/zip');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', () => res.status(500).end());
    archive.pipe(res);

    for (const file of files) {
      archive.append(file.data, { name: file.filePath });
    }
    await archive.finalize();
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── VIEW FILE CONTENT (for editor) ──────────────────────
router.get('/view/:serverId', requireAuth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.status(404).json({ error: 'NOT_FOUND' });

    const filePath = sanitizePath(req.query.path || '');
    const file = await FileData.findOne({ serverId: server._id, filePath });
    if (!file) return res.status(404).json({ error: 'FILE_NOT_FOUND' });

    const textTypes = ['text/', 'application/javascript', 'application/json', 'application/xml', 'image/svg'];
    const isText = textTypes.some(t => file.mimeType.startsWith(t));

    if (!isText) return res.status(400).json({ error: 'BINARY_FILE', message: 'File tidak bisa ditampilkan sebagai teks.' });

    res.json({ content: file.data.toString('utf8'), mimeType: file.mimeType });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── SAVE FILE CONTENT (editor) ──────────────────────────
router.put('/edit/:serverId', requireAuth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.status(404).json({ error: 'NOT_FOUND' });

    const { filePath, content } = req.body;
    if (!filePath || content === undefined) return res.status(400).json({ error: 'MISSING_FIELDS' });

    const clean = sanitizePath(filePath);
    const buf = Buffer.from(content, 'utf8');

    await FileData.findOneAndUpdate(
      { serverId: server._id, filePath: clean },
      { data: buf, size: buf.length, uploadedAt: new Date() },
      { new: true }
    );

    const allFiles = await FileData.find({ serverId: server._id }).select('size');
    await Server.updateOne({ _id: server._id }, { totalSize: allFiles.reduce((s, f) => s + (f.size || 0), 0) });

    await logActivity(req.user._id, req.user.username, 'EDIT_FILE', server.name + ':' + clean, req);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── CREATE NEW FOLDER ───────────────────────────────────
router.post('/newfolder/:serverId', requireAuth, async (req, res) => {
  try {
    const server = await Server.findOne({ _id: req.params.serverId, owner: req.user._id });
    if (!server) return res.status(404).json({ error: 'NOT_FOUND' });

    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'MISSING_PATH' });

    const clean = sanitizePath(folderPath).replace(/[^a-zA-Z0-9.\-_/]/g, '_');
    const placeholderPath = `${clean}/.gitkeep`;

    await FileData.findOneAndUpdate(
      { serverId: server._id, filePath: placeholderPath },
      { serverId: server._id, serverName: server.name, filePath: placeholderPath, data: Buffer.from(''), mimeType: 'text/plain', size: 0 },
      { upsert: true }
    );

    await logActivity(req.user._id, req.user.username, 'CREATE_FOLDER', server.name + ':' + clean, req);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
