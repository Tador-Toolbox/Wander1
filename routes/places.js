const router = require('express').Router();
const auth   = require('../middleware/auth');
const Place  = require('../models/Place');

router.use(auth);

// GET /api/places
router.get('/', async (req, res) => {
  try {
    if (req.query.trip && req.query.trip !== 'none') {
      // For a specific trip — fetch all places from all members
      const Trip = require('../models/Trip');
      const trip = await Trip.findById(req.query.trip);
      if (!trip) return res.json([]);

      // Check user is owner or accepted collaborator
      const isOwner = trip.user.toString() === req.userId.toString();
      const isCollab = trip.collaborators.some(c =>
        c.user.toString() === req.userId.toString() && c.status === 'accepted'
      );
      if (!isOwner && !isCollab) return res.json([]);

      // Fetch ALL places for this trip regardless of who added them
      const places = await Place.find({ trip: req.query.trip })
        .populate('addedBy', 'firstName lastName handle avatar')
        .sort({ createdAt: -1 });
      return res.json(places);
    }

    // Default — own places only
    const filter = { user: req.userId };
    if (req.query.trip === 'none') filter.trip = null;
    const places = await Place.find(filter)
      .populate('addedBy', 'firstName lastName handle avatar')
      .sort({ createdAt: -1 });
    res.json(places);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/places
router.post('/', async (req, res) => {
  try {
    const { name, location, placeId, notes, link, tags, lat, lng, trip, rating, isPublic, visibility, status } = req.body;
    if (!name || lat == null || lng == null)
      return res.status(400).json({ error: 'name, lat, lng are required' });

    // If adding to a shared trip, verify user is a member
    if (trip) {
      const Trip = require('../models/Trip');
      const tripDoc = await Trip.findById(trip);
      if (tripDoc) {
        const isOwner = tripDoc.user.toString() === req.userId.toString();
        const isCollab = tripDoc.collaborators.some(c =>
          c.user.toString() === req.userId.toString() && c.status === 'accepted'
        );
        if (!isOwner && !isCollab) return res.status(403).json({ error: 'Not a member of this trip' });
      }
    }

    const place = await Place.create({
      user: req.userId,
      addedBy: req.userId,
      trip: trip||null, name, location, placeId, notes, link, tags, lat, lng,
      rating: Number(rating)||0, isPublic: !!isPublic,
      visibility: visibility||'private', status: status||'none'
    });
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
    if (req.body.rating   !== undefined) place.rating   = Number(req.body.rating) || 0;
    if (req.body.isPublic   !== undefined) place.isPublic   = !!req.body.isPublic;
    if (req.body.visibility !== undefined) place.visibility = req.body.visibility||'private';
    if (req.body.status     !== undefined) place.status     = req.body.status||'none';
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
