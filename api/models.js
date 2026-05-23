const mongoose = require('mongoose');

// ─── USER ───────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isBlocked: { type: Boolean, default: false },
  blockedIPs: [String],
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date },
  serverCount: { type: Number, default: 0 },
  dailyCreates: { type: Number, default: 0 },
  dailyCreatesReset: { type: Date, default: Date.now }
});

// ─── SERVER (FOLDER) ────────────────────────────────────
const serverSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, lowercase: true, match: /^[a-z0-9\-_]+$/ },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ownerUsername: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  lastActivity: { type: Date, default: Date.now },
  lastRequest: { type: Date, default: Date.now },
  totalRequests: { type: Number, default: 0 },
  totalSize: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  files: [{
    name: { type: String },
    path: { type: String },
    size: { type: Number },
    type: { type: String },
    uploadedAt: { type: Date, default: Date.now }
  }]
});

// ─── ACTIVITY LOG ────────────────────────────────────────
const activitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username: { type: String },
  action: { type: String, required: true },
  target: { type: String },
  ip: { type: String },
  userAgent: { type: String },
  timestamp: { type: Date, default: Date.now }
});

// ─── BLOCKED IP ──────────────────────────────────────────
const blockedIPSchema = new mongoose.Schema({
  ip: { type: String, required: true, unique: true },
  reason: { type: String },
  blockedBy: { type: String },
  blockedAt: { type: Date, default: Date.now }
});

// ─── FILE STORAGE (GridFS-like, base64 in mongo for small files) ──
const fileDataSchema = new mongoose.Schema({
  serverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Server', required: true },
  serverName: { type: String, required: true },
  filePath: { type: String, required: true },
  data: { type: Buffer, required: true },
  mimeType: { type: String, default: 'application/octet-stream' },
  size: { type: Number },
  uploadedAt: { type: Date, default: Date.now }
});

fileDataSchema.index({ serverId: 1, filePath: 1 }, { unique: true });

module.exports = {
  User: mongoose.model('User', userSchema),
  Server: mongoose.model('Server', serverSchema),
  Activity: mongoose.model('Activity', activitySchema),
  BlockedIP: mongoose.model('BlockedIP', blockedIPSchema),
  FileData: mongoose.model('FileData', fileDataSchema)
};
