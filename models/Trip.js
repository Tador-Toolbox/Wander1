const mongoose = require('mongoose');

const TripSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:       { type: String, required: true, trim: true },
  emoji:      { type: String, default: '✈️' },
  color:      { type: String, default: '#4a9eff' },
  shareToken: { type: String, default: null, index: true },
  sharedAt:   { type: Date, default: null },
  // Collaborative trip support
  collaborators: [{
    user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    handle:    { type: String },
    name:      { type: String },
    status:    { type: String, enum: ['pending','accepted'], default: 'pending' },
    invitedAt: { type: Date, default: Date.now }
  }],
  // Plan by days (V2): real dates, places per day in order
  startDate: { type: String, default: '' },   // YYYY-MM-DD
  plan: {
    summary:   { type: String, default: '' },
    city:      { type: String, default: '' },
    days: [{
      date:   String,
      theme:  String,
      places: [{ place: { type: mongoose.Schema.Types.ObjectId, ref: 'Place' }, time: String, duration: String, tip: String, _id: false }],
      events: [{ title: String, venue: String, startTime: String, url: String, match: Number, why: String, _id: false }],  // parties that night
      eventsCheckedAt: Date,
      _id: false
    }],
    createdAt: Date
  },
  story: {
    orderedPlaces: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Place' }],
    narrations:    [{ type: String }],
    createdAt:     { type: Date }
  }
}, { timestamps: true });

module.exports = mongoose.model('Trip', TripSchema);
