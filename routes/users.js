const router  = require('express').Router();
const auth    = require('../middleware/auth');
const User    = require('../models/User');
const Place   = require('../models/Place');
const Post    = require('../models/Post');
const Follow  = require('../models/Follow');

router.use(auth);

// GET /api/users — all users (for discovery)
router.get('/', async (req, res) => {
  try {
    const users = await User.find({}, 'firstName lastName handle avatar email').lean();
    // Add follower counts
    const ids = users.map(u => u._id);
    const follows = await Follow.find({ following: { $in: ids } });
    const myFollowing = await Follow.find({ follower: req.userId }).select('following');
    const myFollowingIds = myFollowing.map(f => f.following.toString());
    const result = users.map(u => ({
      ...u,
      followersCount: follows.filter(f => f.following.toString() === u._id.toString()).length,
      isFollowing: myFollowingIds.includes(u._id.toString()),
      isMe: u._id.toString() === req.userId.toString()
    }));
    res.json(result);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/users/:id — user profile
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id, 'firstName lastName handle avatar email').lean();
    if (!user) return res.status(404).json({ error: 'Not found' });
    const [followers, following, placesCount, posts, isFollowing] = await Promise.all([
      Follow.countDocuments({ following: req.params.id }),
      Follow.countDocuments({ follower: req.params.id }),
      Place.countDocuments({ user: req.params.id }),
      Post.find({ user: req.params.id }).sort({ createdAt: -1 }).limit(50),
      Follow.findOne({ follower: req.userId, following: req.params.id })
    ]);
    const places = await Place.find({ user: req.params.id }, 'name location coverPhoto photos tags rating status photoLikes').sort({ createdAt: -1 });
    res.json({
      user: { ...user, followersCount: followers, followingCount: following, placesCount },
      places, posts,
      isFollowing: !!isFollowing,
      isMe: req.params.id === req.userId.toString()
    });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/users/:id/follow — toggle follow
router.post('/:id/follow', async (req, res) => {
  try {
    if (req.params.id === req.userId.toString()) return res.status(400).json({ error: "Can't follow yourself" });
    const existing = await Follow.findOne({ follower: req.userId, following: req.params.id });
    if (existing) {
      await existing.deleteOne();
      res.json({ following: false });
    } else {
      await Follow.create({ follower: req.userId, following: req.params.id });
      res.json({ following: true });
    }
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
