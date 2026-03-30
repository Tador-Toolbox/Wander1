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
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/share/:token/import — authenticated, import to my account
router.post('/:token/import', auth, async (req, res) => {
  try {
    const sourceTripDoc = await Trip.findOne({ shareToken: req.params.token });
    if (!sourceTripDoc) return res.status(404).json({ error: 'Trip not found' });
    const sourcePlaces = await Place.find({ trip: sourceTripDoc._id });

    // Create a new trip in the importer's account
    const newTrip = await Trip.create({
      user:  req.userId,
      name:  sourceTripDoc.name + ' (shared)',
      emoji: sourceTripDoc.emoji,
      color: sourceTripDoc.color
    });

    // Copy all places
    const newPlaces = await Place.insertMany(
      sourcePlaces.map(p => ({
        user:     req.userId,
        trip:     newTrip._id,
        name:     p.name,
        location: p.location,
        notes:    p.notes,
        link:     p.link,
        tags:     p.tags,
        lat:      p.lat,
        lng:      p.lng
      }))
    );

    res.status(201).json({ trip: newTrip, places: newPlaces });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
