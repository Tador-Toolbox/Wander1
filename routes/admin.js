const router   = require('express').Router();
const User     = require('../models/User');
const Place    = require('../models/Place');
const Trip     = require('../models/Trip');
const ErrorLog = require('../models/ErrorLog');

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

/* ─────────────────────────────────────────
   GET /api/admin/errors — list error logs
───────────────────────────────────────── */
router.get('/errors', adminAuth, async (req, res) => {
  try {
    const { level, route, limit = 100, skip = 0 } = req.query;
    const filter = {};
    if (level) filter.level = level;
    if (route) filter.route = { $regex: route, $options: 'i' };

    const [errors, total] = await Promise.all([
      ErrorLog.find(filter)
        .sort({ timestamp: -1 })
        .limit(Number(limit))
        .skip(Number(skip))
        .lean(),
      ErrorLog.countDocuments(filter)
    ]);

    res.json({ errors, total, limit: Number(limit), skip: Number(skip) });
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* DELETE /api/admin/errors — clear all logs */
router.delete('/errors', adminAuth, async (req, res) => {
  try {
    const { before } = req.query;
    const filter = before ? { timestamp: { $lt: new Date(before) } } : {};
    const result = await ErrorLog.deleteMany(filter);
    res.json({ deleted: result.deletedCount });
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* DELETE /api/admin/errors/:id — delete single log */
router.delete('/errors/:id', adminAuth, async (req, res) => {
  try {
    await ErrorLog.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* POST /api/admin/errors/log — manually log a frontend error */
router.post('/errors/log', adminAuth, async (req, res) => {
  try {
    const { message, stack, route, level = 'error' } = req.body;
    await ErrorLog.create({ message, stack, route, level, method: 'FRONTEND' });
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
