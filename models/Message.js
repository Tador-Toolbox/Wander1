const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  from:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text:    { type: String, required: true, trim: true, maxlength: 1000 },
  read:    { type: Boolean, default: false }
}, { timestamps: true });

// Index for fast conversation queries
MessageSchema.index({ from: 1, to: 1, createdAt: -1 });

module.exports = mongoose.model('Message', MessageSchema);
