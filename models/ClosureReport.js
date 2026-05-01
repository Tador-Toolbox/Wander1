const mongoose = require('mongoose');

const ClosureReportSchema = new mongoose.Schema({
  venueName:  { type: String, required: true },
  city:       { type: String, default: '' },
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reporterHandle: { type: String, default: '' },
  status:     { type: String, enum: ['pending','blacklisted','dismissed'], default: 'pending' },
  createdAt:  { type: Date, default: Date.now }
});

module.exports = mongoose.model('ClosureReport', ClosureReportSchema);
