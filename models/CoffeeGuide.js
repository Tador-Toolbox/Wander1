const mongoose = require('mongoose');

// European Coffee Trip city guide, resolved to Google places (cached per city)
const coffeeGuideSchema = new mongoose.Schema({
  city:      { type: String, required: true, unique: true }, // site slug, e.g. "athens"
  found:     { type: Boolean, default: true },               // false = no guide for this city
  cafes: [{
    name: String, slug: String, url: String, winner: String, rank: Number,
    placeId: String, address: String, lat: Number, lng: Number, rating: Number, reviews: Number,
    _id: false
  }],
  fetchedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CoffeeGuide', coffeeGuideSchema);
