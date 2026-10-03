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
    const { name, location, placeId, notes, link, tags, lat, lng, trip, rating, isPublic, visibility, status, source } = req.body;
    if (!name || lat == null || lng == null)
      return res.status(400).json({ error: 'name, lat, lng are required' });
    const place = await Place.create({ user: req.userId, trip: trip||null, name, location, placeId, notes, link, tags, lat, lng, rating: Number(rating)||0, isPublic: !!isPublic, visibility: visibility||'private', status: status||'none', source: source||'' });
    res.status(201).json(place);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

const SKIP_TYPES = ['point_of_interest', 'establishment', 'food', 'store', 'premise', 'political', 'locality', 'geocode'];
async function googleTags(placeId) {
  try {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) return [];
    const d = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=types&key=${key}`).then(r => r.json());
    const tags = (d.result?.types || []).filter(t => !SKIP_TYPES.includes(t)).map(t => t.replace(/_/g, '-')).slice(0, 4);
    console.log('[places] tags from Google', placeId, tags);
    return tags;
  } catch (e) { console.log('[places] google tags error', e.message); return []; }
}

// PUT /api/places/:id
router.put('/:id', async (req, res) => {
  try {
    const place = await Place.findOne({ _id: req.params.id, user: req.userId });
    if (!place) return res.status(404).json({ error: 'Not found' });
    const fields = ['name','location','placeId','notes','link','tags','lat','lng','trip'];
    fields.forEach(f => { if (req.body[f] !== undefined) place[f] = req.body[f] === '' ? null : req.body[f]; });
    const oldRating = place.rating || 0;
    if (req.body.rating   !== undefined) place.rating   = Number(req.body.rating) || 0;
    if (req.body.isPublic   !== undefined) place.isPublic   = !!req.body.isPublic;
    if (req.body.visibility !== undefined) place.visibility = req.body.visibility||'private';
    if (req.body.status     !== undefined) place.status     = req.body.status||'none';
    // Rated a place with no tags (V2 adds places without tags) → take its type from Google so the AI can learn
    if (req.body.rating !== undefined && place.rating !== oldRating && !(place.tags || []).length && place.placeId) {
      place.tags = await googleTags(place.placeId);
    }
    await place.save();
    if (req.body.rating !== undefined && place.rating !== oldRating && (place.tags || []).length) {
      try { await require('./ai').updateFeedbackLoop(req.userId, place.tags, place.rating, oldRating); }
      catch (e) { console.log('[places] feedback loop error', e.message); }
    }
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
