const router  = require('express').Router();
const auth    = require('../middleware/auth');
const Trip    = require('../models/Trip');
const Place   = require('../models/Place');
const crypto  = require('crypto');

router.use(auth);

// GET /api/trips
router.get('/', async (req, res) => {
  try {
    const trips = await Trip.find({ user: req.userId }).sort({ createdAt: -1 });
    res.json(trips);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/trips
router.post('/', async (req, res) => {
  try {
    const { name, emoji, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const trip = await Trip.create({ user: req.userId, name, emoji: emoji||'✈️', color: color||'#4a9eff' });
    res.status(201).json(trip);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/trips/:id
router.put('/:id', async (req, res) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, user: req.userId });
    if (!trip) return res.status(404).json({ error: 'Not found' });
    const { name, emoji, color } = req.body;
    if (name)  trip.name  = name;
    if (emoji) trip.emoji = emoji;
    if (color) trip.color = color;
    await trip.save();
    res.json(trip);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/trips/:id
router.delete('/:id', async (req, res) => {
  try {
    const trip = await Trip.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!trip) return res.status(404).json({ error: 'Not found' });
    // Remove trip reference from places
    await Place.updateMany({ trip: req.params.id }, { $set: { trip: null } });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/trips/:id/share — generate share link
router.post('/:id/share', async (req, res) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, user: req.userId });
    if (!trip) return res.status(404).json({ error: 'Not found' });
    if (!trip.shareToken) {
      trip.shareToken = crypto.randomBytes(16).toString('hex');
      trip.sharedAt   = new Date();
      await trip.save();
    }
    res.json({ token: trip.shareToken });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/trips/:id/share — revoke share link
router.delete('/:id/share', async (req, res) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, user: req.userId });
    if (!trip) return res.status(404).json({ error: 'Not found' });
    trip.shareToken = null; trip.sharedAt = null;
    await trip.save();
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
