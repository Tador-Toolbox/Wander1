const mongoose = require('mongoose');

const PlaceSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  trip:      { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', default: null },
  name:      { type: String, required: true, trim: true },
  location:  { type: String, trim: true, default: '' },
  placeId:   { type: String, default: '' },
  notes:     { type: String, default: '' },
  link:      { type: String, default: '' },
  tags:      { type: [String], enum: ['Food','Beach','Nightlife','Nature','Culture'], default: [] },
  lat:       { type: Number, required: true },
  lng:       { type: Number, required: true },
  rating:    { type: Number, min: 0, max: 5, default: 0 },
  isPublic:  { type: Boolean, default: false },
  visibility:{ type: String, enum: ['private','public','both'], default: 'private' },
  coverPhoto:{ type: String, default: '' },
  photos:    { type: [String], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Place', PlaceSchema);
