const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  place:     { type: mongoose.Schema.Types.ObjectId, ref: 'Place', required: true },
  // Snapshot of place data at time of posting
  placeName: { type: String, required: true },
  location:  { type: String, default: '' },
  notes:     { type: String, default: '' },
  coverPhoto:{ type: String, default: '' },
  rating:    { type: Number, default: 0 },
  tags:      { type: [String], default: [] },
  status:    { type: String, default: 'none' },
  lat:       { type: Number },
  lng:       { type: Number },
  // Author snapshot
  authorName:  { type: String, default: '' },
  authorHandle:{ type: String, default: '' },
  authorAvatar:{ type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Post', PostSchema);
