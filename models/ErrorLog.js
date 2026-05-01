const mongoose = require('mongoose');

const ErrorLogSchema = new mongoose.Schema({
  timestamp:  { type: Date, default: Date.now, index: true },
  route:      { type: String, default: '' },
  method:     { type: String, default: '' },
  statusCode: { type: Number, default: 500 },
  message:    { type: String, default: '' },
  stack:      { type: String, default: '' },
  userId:     { type: String, default: '' },
  userHandle: { type: String, default: '' },
  body:       { type: String, default: '' }, // sanitized JSON
  level:      { type: String, enum: ['error','warn','info'], default: 'error' }
}, { timestamps: false });

module.exports = mongoose.model('ErrorLog', ErrorLogSchema);
