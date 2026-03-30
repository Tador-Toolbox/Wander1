const router = require('express').Router();
const auth   = require('../middleware/auth');
const Place  = require('../models/Place');

router.use(auth);

// GET /api/places
router.get('/', async (req, res) => {
  try {
    const filter = { user: req.userId };
    if (req.query.trip) filter.trip = req.query.trip === 'none' ? null : req.query.trip;
    const places = await Place.find(filter).sort({ createdAt: -1 });
    res.json(places);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/places
router.post('/', async (req, res) => {
  try {
    const { name, location, placeId, notes, link, tags, lat, lng, trip, rating } = req.body;
    if (!name || lat == null || lng == null)
      return res.status(400).json({ error: 'name, lat, lng are required' });
    const place = await Place.create({ user: req.userId, trip: trip||null, name, location, placeId, notes, link, tags, lat, lng, rating: Number(rating)||0 });
    res.status(201).json(place);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/places/:id
router.put('/:id', async (req, res) => {
  try {
    const place = await Place.findOne({ _id: req.params.id, user: req.userId });
    if (!place) return res.status(404).json({ error: 'Not found' });
    const fields = ['name','location','placeId','notes','link','tags','lat','lng','trip'];
    fields.forEach(f => { if (req.body[f] !== undefined) place[f] = req.body[f] === '' ? null : req.body[f]; });
    // Handle rating separately (0 is valid)
    if (req.body.rating !== undefined) place.rating = Number(req.body.rating) || 0;
    await place.save();
    res.json(place);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/places/:id
router.delete('/:id', async (req, res) => {
  try {
    const place = await Place.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!place) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
