const mongoose = require('mongoose');

const PlaceSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:     { type: String, required: true, trim: true },
  location: { type: String, trim: true, default: '' },
  placeId:  { type: String, default: '' },   // Google Place ID for future use
  notes:    { type: String, default: '' },
  link:     { type: String, default: '' },
  tags:     { type: [String], enum: ['Food','Beach','Nightlife','Nature','Culture'], default: [] },
  lat:      { type: Number, required: true },
  lng:      { type: Number, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Place', PlaceSchema);
