const router = require('express').Router();
const Trip   = require('../models/Trip');
const Place  = require('../models/Place');
const auth   = require('../middleware/auth');

// GET /api/share/:token — public, no auth
router.get('/:token', async (req, res) => {
  try {
    const trip = await Trip.findOne({ shareToken: req.params.token });
    if (!trip) return res.status(404).json({ error: 'Trip not found or link expired' });
    const places = await Place.find({ trip: trip._id });
    res.json({ trip: { _id: trip._id, name: trip.name, emoji: trip.emoji, color: trip.color }, places });
  } catch(e) {
    console.error('[share/get]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/share/:token/import — authenticated
router.post('/:token/import', auth, async (req, res) => {
  console.log('[share/import] request received, token:', req.params.token, 'user:', req.userId);
  try {
    const sourceTripDoc = await Trip.findOne({ shareToken: req.params.token });
    if (!sourceTripDoc) {
      console.log('[share/import] trip not found for token:', req.params.token);
      return res.status(404).json({ error: 'Trip not found' });
    }

    const sourcePlaces = await Place.find({ trip: sourceTripDoc._id });
    console.log('[share/import] found', sourcePlaces.length, 'places to copy');

    const newTrip = await Trip.create({
      user:  req.userId,
      name:  sourceTripDoc.name + ' (shared)',
      emoji: sourceTripDoc.emoji,
      color: sourceTripDoc.color
    });
    console.log('[share/import] new trip created:', newTrip._id);

    // Build place docs — skip any with missing required fields
    const placeDocs = sourcePlaces
      .filter(p => p.name && p.lat != null && p.lng != null)
      .map(p => ({
        user:       req.userId,
        trip:       newTrip._id,
        name:       p.name,
        location:   p.location   || '',
        notes:      p.notes      || '',
        link:       p.link       || '',
        tags:       p.tags       || [],
        lat:        p.lat,
        lng:        p.lng,
        rating:     p.rating     || 0,
        status:     p.status     || 'none',
        coverPhoto: p.coverPhoto || '',
        photos:     p.photos     || [],
        videos:     p.videos     || [],
        source:     'shared'
      }));

    console.log('[share/import] inserting', placeDocs.length, 'valid places');
    const newPlaces = await Place.insertMany(placeDocs, { ordered: false });
    console.log('[share/import] inserted', newPlaces.length, 'places OK');

    res.status(201).json({ trip: newTrip, places: newPlaces });
  } catch(e) {
    console.error('[share/import] ERROR:', e.message, e.stack);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

module.exports = router;
