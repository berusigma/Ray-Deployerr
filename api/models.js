const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:         { type: String, required: true },
  role:             { type: String, enum: ['user','admin'], default: 'user' },
  isBlocked:        { type: Boolean, default: false },
  serverCount:      { type: Number, default: 0 },
  dailyCreates:     { type: Number, default: 0 },
  dailyResetsAt:    { type: Date, default: Date.now },
  createdAt:        { type: Date, default: Date.now },
  lastLoginAt:      { type: Date }
});

const ServerSchema = new mongoose.Schema({
  name:             { type: String, required: true, unique: true, lowercase: true, trim: true },
  owner:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ownerUsername:    { type: String, required: true },
  totalSize:        { type: Number, default: 0 },
  totalRequests:    { type: Number, default: 0 },
  lastRequestAt:    { type: Date, default: Date.now },
  createdAt:        { type: Date, default: Date.now }
});

const FileSchema = new mongoose.Schema({
  serverId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Server', required: true },
  filePath:   { type: String, required: true },
  data:       { type: Buffer, required: true },
  mimeType:   { type: String, default: 'application/octet-stream' },
  size:       { type: Number, default: 0 },
  createdAt:  { type: Date, default: Date.now }
});
FileSchema.index({ serverId: 1, filePath: 1 }, { unique: true });

const ActivitySchema = new mongoose.Schema({
  username:  { type: String },
  action:    { type: String, required: true },
  detail:    { type: String },
  ip:        { type: String },
  createdAt: { type: Date, default: Date.now }
});

const BlockedIPSchema = new mongoose.Schema({
  ip:        { type: String, required: true, unique: true },
  reason:    { type: String },
  blockedBy: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = {
  User:      mongoose.model('User', UserSchema),
  Server:    mongoose.model('Server', ServerSchema),
  File:      mongoose.model('File', FileSchema),
  Activity:  mongoose.model('Activity', ActivitySchema),
  BlockedIP: mongoose.model('BlockedIP', BlockedIPSchema)
};
