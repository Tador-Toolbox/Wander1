const router = require('express').Router();
const auth   = require('../middleware/auth');
const Place  = require('../models/Place');

router.use(auth);

// GET /api/places
// Same place = same Google placeId, or same name within ~60 m
function samePlace(a, b) {
  if (a.placeId && b.placeId) return a.placeId === b.placeId;
  const n = x => String(x || '').toLowerCase().trim();
  if (n(a.name) !== n(b.name)) return false;
  return Math.abs((a.lat || 0) - (b.lat || 0)) < 0.0006 && Math.abs((a.lng || 0) - (b.lng || 0)) < 0.0006;
}
// Places with no trip ("My map"): keep one copy of each — the visited / rated / noted one wins
async function dedupeMyMap(userId) {
  const loose = await Place.find({ user: userId, trip: null }).sort({ createdAt: 1 });
  const score = p => (p.status === 'been' ? 4 : 0) + (p.rating ? 2 : 0) + (p.notes ? 1 : 0);
  const keep = [], drop = [];
  for (const p of loose) {
    const k = keep.findIndex(x => samePlace(x, p));
    if (k < 0) { keep.push(p); continue; }
    if (score(p) > score(keep[k])) { drop.push(keep[k]._id); keep[k] = p; } else drop.push(p._id);
  }
  if (drop.length) { await Place.deleteMany({ _id: { $in: drop }, user: userId }); console.log('[places] removed', drop.length, 'duplicate(s) from My map'); }
  return drop.length;
}

router.get('/', async (req, res) => {
  try {
    if (!req.query.trip) await dedupeMyMap(req.userId).catch(e => console.log('[places] dedupe error', e.message));
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
    // No duplicates: same place already in this trip → return it; already on My map (no trip) → move it into this trip
    const cands = await Place.find({ user: req.userId, $or: [placeId ? { placeId } : null, { name }].filter(Boolean) });
    const same = cands.filter(p => samePlace(p, { name, placeId, lat, lng }));
    const inTrip = same.find(p => String(p.trip || '') === String(trip || ''));
    if (inTrip) return res.status(200).json(inTrip);
    const loose = trip && same.find(p => !p.trip);
    if (loose) {
      loose.trip = trip;
      if (notes && !loose.notes) loose.notes = notes;
      await loose.save();
      return res.status(200).json(loose);
    }
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

router.dedupeMyMap = dedupeMyMap;
module.exports = router;
