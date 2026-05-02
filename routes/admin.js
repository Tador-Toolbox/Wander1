const router         = require('express').Router();
const User           = require('../models/User');
const Place          = require('../models/Place');
const Trip           = require('../models/Trip');
const ErrorLog       = require('../models/ErrorLog');
const ClosureReport  = require('../models/ClosureReport');
const VenueBlacklist = require('../models/VenueBlacklist');

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
   POST /api/admin/users/:id/send-reset
   Send password reset email to a user
───────────────────────────────────────── */
router.post('/users/:id/send-reset', adminAuth, async (req, res) => {
  try {
    const crypto = require('crypto');
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.verifyToken = resetToken;
    user.verifyExpires = new Date(Date.now() + 3600000); // 1 hour
    await user.save();

    const resetUrl = `${process.env.APP_URL || 'https://wander1.onrender.com'}/reset-password?token=${resetToken}`;

    // Send via Resend (same as forgot-password route)
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Wandr <noreply@yovix.com>',
      to: user.email,
      subject: 'Reset your Wandr password',
      html: `<p>Hi ${user.firstName || 'there'},</p>
             <p>An admin has sent you a password reset link for your Wandr account.</p>
             <p><a href="${resetUrl}" style="background:#1D9E75;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password</a></p>
             <p>This link expires in 1 hour.</p>
             <p>If you did not request this, you can ignore this email.</p>`
    });

    console.log(`Admin sent password reset to ${user.email}`);
    res.json({ ok: true, message: `Reset link sent to ${user.email}` });
  } catch(err) {
    console.error('Admin reset error:', err.message);
    res.status(500).json({ error: 'Failed to send reset email: ' + err.message });
  }
});

/* ─────────────────────────────────────────
   CLOSURE REPORTS
───────────────────────────────────────── */

// GET /api/admin/closure-reports
router.get('/closure-reports', adminAuth, async (req, res) => {
  try {
    const reports = await ClosureReport.find()
      .sort({ createdAt: -1 })
      .populate('reportedBy', 'firstName lastName handle')
      .lean();
    res.json(reports);
  } catch(err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/admin/closure-reports/:id/blacklist — approve + add to blacklist
router.post('/closure-reports/:id/blacklist', adminAuth, async (req, res) => {
  try {
    const report = await ClosureReport.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    // Add to blacklist if not already there
    const existing = await VenueBlacklist.findOne({
      venueName: { $regex: new RegExp('^' + report.venueName + '$', 'i') },
      city: report.city
    });
    if (!existing) {
      await VenueBlacklist.create({
        venueName: report.venueName,
        city: report.city,
        reason: 'Permanently closed — reported by user'
      });
    }

    report.status = 'blacklisted';
    await report.save();
    res.json({ ok: true, message: `${report.venueName} added to blacklist` });
  } catch(err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/admin/closure-reports/:id/dismiss
router.post('/closure-reports/:id/dismiss', adminAuth, async (req, res) => {
  try {
    await ClosureReport.findByIdAndUpdate(req.params.id, { status: 'dismissed' });
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: 'Server error' }); }
});

/* ─────────────────────────────────────────
   VENUE BLACKLIST
───────────────────────────────────────── */

// GET /api/admin/blacklist
router.get('/blacklist', adminAuth, async (req, res) => {
  try {
    const list = await VenueBlacklist.find().sort({ addedAt: -1 }).lean();
    res.json(list);
  } catch(err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/admin/blacklist — manually add
router.post('/blacklist', adminAuth, async (req, res) => {
  try {
    const { venueName, city, reason } = req.body;
    if (!venueName) return res.status(400).json({ error: 'venueName required' });
    const entry = await VenueBlacklist.create({ venueName, city: city||'', reason: reason||'Permanently closed' });
    res.json(entry);
  } catch(err) { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/admin/blacklist/:id
router.delete('/blacklist/:id', adminAuth, async (req, res) => {
  try {
    await VenueBlacklist.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
