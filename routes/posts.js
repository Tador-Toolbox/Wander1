const router = require('express').Router();
const auth   = require('../middleware/auth');
const Post   = require('../models/Post');
const Place  = require('../models/Place');
const User   = require('../models/User');

// GET /api/posts — social feed (all users, newest first)
router.get('/', auth, async (req, res) => {
  try {
    const posts = await Post.find()
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(posts);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/posts — create a post from a place
router.post('/', auth, async (req, res) => {
  try {
    const { placeId } = req.body;
    const place = await Place.findOne({ _id: placeId, user: req.userId });
    if (!place) return res.status(404).json({ error: 'Place not found' });

    const user = await User.findById(req.userId);
    const authorName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;

    // Check if already posted this place
    const existing = await Post.findOne({ user: req.userId, place: placeId });
    if (existing) {
      // Update existing post
      existing.placeName   = place.name;
      existing.location    = place.location;
      existing.notes       = place.notes;
      existing.coverPhoto  = place.coverPhoto;
      existing.rating      = place.rating;
      existing.tags        = place.tags;
      existing.status      = place.status;
      existing.lat         = place.lat;
      existing.lng         = place.lng;
      existing.authorName  = authorName;
      existing.authorHandle= user.handle || '';
      existing.authorAvatar= user.avatar  || '';
      await existing.save();
      return res.json(existing);
    }

    const post = await Post.create({
      user:         req.userId,
      place:        place._id,
      placeName:    place.name,
      location:     place.location,
      notes:        place.notes,
      coverPhoto:   place.coverPhoto,
      rating:       place.rating,
      tags:         place.tags,
      status:       place.status,
      lat:          place.lat,
      lng:          place.lng,
      authorName,
      authorHandle: user.handle || '',
      authorAvatar: user.avatar  || '',
    });
    res.status(201).json(post);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/posts/:id — remove a post
router.delete('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!post) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/posts/:id/like — toggle like
router.post('/:id/like', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });
    const uid = req.userId.toString();
    const liked = post.likes.map(l => l.toString()).includes(uid);
    if (liked) {
      post.likes = post.likes.filter(l => l.toString() !== uid);
    } else {
      post.likes.push(req.userId);
    }
    await post.save();
    res.json({ likes: post.likes.length, liked: !liked });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
