const router  = require('express').Router();
const User    = require('../models/User');
const Place   = require('../models/Place');
const Trip    = require('../models/Trip');

// Simple middleware — checks ADMIN_PASSWORD env var
function adminAuth(req, res, next){
  const pwd = req.headers['x-admin-password'];
  if(!pwd || pwd !== process.env.ADMIN_PASSWORD){
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/* GET /api/admin/users — list all users */
router.get('/users', adminAuth, async (req, res) => {
  try {
    const users = await User.find({})
      .select('email firstName lastName handle avatar verified createdAt aiProfile')
      .sort({ createdAt: -1 })
      .lean();

    const withCounts = await Promise.all(users.map(async u => {
      const [placeCount, tripCount] = await Promise.all([
        Place.countDocuments({ user: u._id }),
        Trip.countDocuments({ user: u._id })
      ]);
      return { ...u, placeCount, tripCount };
    }));

    res.json(withCounts);
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* DELETE /api/admin/users/:id — delete user + all their data */
router.delete('/users/:id', adminAuth, async (req, res) => {
  try {
    const userId = req.params.id;

    // Delete all user data
    await Promise.all([
      Place.deleteMany({ user: userId }),
      Trip.deleteMany({ user: userId }),
      User.findByIdAndDelete(userId)
    ]);

    // Try delete posts and messages if models exist
    try {
      const Post = require('../models/Post');
      await Post.deleteMany({ user: userId });
    } catch {}
    try {
      const Message = require('../models/Message');
      await Message.deleteMany({ $or: [{ sender: userId }, { receiver: userId }] });
    } catch {}

    res.json({ ok: true });
  } catch(err) {
    console.error('Admin delete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* GET /api/admin/stats — quick dashboard stats */
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [users, places, trips] = await Promise.all([
      User.countDocuments(),
      Place.countDocuments(),
      Trip.countDocuments()
    ]);
    res.json({ users, places, trips });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
