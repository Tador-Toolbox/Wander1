const mongoose = require('mongoose');

// Cached venue facts (capacity) so every lookup shows the same number
const venueInfoSchema = new mongoose.Schema({
  key:       { type: String, required: true, unique: true }, // "name|city" lowercased
  name:      String,
  city:      String,
  raId:      String,
  capacity:  Number,
  source:    { type: String, enum: ['sources', 'ai'], default: 'ai' },
  isClosed:  Boolean,
  website:   String,
  phone:     String,
  instagram: String,
  nextEvent: { title: String, date: Date, startTime: Date, url: String },
  eventsCheckedAt: Date,
  lookupVer: Number,
  checkedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('VenueInfo', venueInfoSchema);
