const router = require('express').Router();
const auth   = require('../middleware/auth');
const Place  = require('../models/Place');

router.use(auth);

// POST /api/photos/like — like/unlike a photo by URL
router.post('/like', async (req, res) => {
  try {
    const { photoUrl, placeId } = req.body;
    if (!photoUrl || !placeId) return res.status(400).json({ error: 'Missing params' });

    const place = await Place.findById(placeId);
    if (!place) return res.status(404).json({ error: 'Place not found' });

    // Store likes as array of {url, userId} in place.photoLikes
    if (!place.photoLikes) place.photoLikes = [];
    const existing = place.photoLikes.find(l => l.url === photoUrl && l.user.toString() === req.userId.toString());
    if (existing) {
      place.photoLikes = place.photoLikes.filter(l => !(l.url === photoUrl && l.user.toString() === req.userId.toString()));
    } else {
      place.photoLikes.push({ url: photoUrl, user: req.userId });
    }
    await place.save();
    const count = place.photoLikes.filter(l => l.url === photoUrl).length;
    const liked = !existing;
    res.json({ liked, count });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/photos/likes?placeId=X — get all likes for a place's photos
router.get('/likes', async (req, res) => {
  try {
    const place = await Place.findById(req.query.placeId).select('photoLikes');
    if (!place) return res.status(404).json({ error: 'Not found' });
    res.json(place.photoLikes || []);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
