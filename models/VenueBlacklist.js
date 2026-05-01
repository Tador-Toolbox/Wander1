const mongoose = require('mongoose');

const VenueBlacklistSchema = new mongoose.Schema({
  venueName:  { type: String, required: true },
  city:       { type: String, default: '' },
  addedAt:    { type: Date, default: Date.now },
  addedBy:    { type: String, default: 'admin' },
  reason:     { type: String, default: 'Permanently closed' }
});

// Index for fast lookup
VenueBlacklistSchema.index({ venueName: 1, city: 1 });

module.exports = mongoose.model('VenueBlacklist', VenueBlacklistSchema);
