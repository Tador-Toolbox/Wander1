const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:   { type: String, required: true, minlength: 6 },
  firstName:  { type: String, default: '', trim: true },
  lastName:   { type: String, default: '', trim: true },
  handle:     { type: String, default: '', trim: true, lowercase: true },
  avatar:       { type: String, default: '' },
  verified:     { type: Boolean, default: false },
  verifyToken:  { type: String, default: null },
  verifyExpires:{ type: Date, default: null },
  aiProfile: {
    tags:        { type: [String], default: [] },
    summary:     { type: String, default: '' },
    locations:   { type: [String], default: [] },
    analyzedAt:  { type: Date, default: null }
  }
}, { timestamps: true });

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

UserSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', UserSchema);
