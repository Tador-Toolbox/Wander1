const mongoose = require('mongoose');

const TripSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:        { type: String, required: true, trim: true },
  emoji:       { type: String, default: '✈️' },
  color:       { type: String, default: '#4a9eff' },
  shareToken:  { type: String, default: null, index: true },
  sharedAt:    { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Trip', TripSchema);
