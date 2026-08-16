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
      .select('email firstName lastName handle avatar verified verifyToken verifyExpires createdAt aiProfile')
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


/* GET /api/admin/users/pending — unverified users only */
router.get('/pending', adminAuth, async (req, res) => {
  try {
    const now = new Date();
    const users = await User.find({ verified: false })
      .select('email firstName lastName verified verifyToken verifyExpires createdAt')
      .sort({ createdAt: -1 }).lean();

    const result = users.map(u => ({
      ...u,
      emailSent: !!u.verifyToken,
      linkExpired: u.verifyExpires ? u.verifyExpires < now : false
    }));

    res.json(result);
  } catch(err) { res.status(500).json({ error: 'Server error' }); }
});


/* ─────────────────────────────────────────
   POST /api/admin/invite — send invite email
───────────────────────────────────────── */
router.post('/invite', adminAuth, async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const appUrl = process.env.APP_URL || 'https://wander1.onrender.com';
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: 'Wander <noreply@yovix.com>',
      to: email,
      subject: "You're invited to Wander ✈️",
      html: `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
          <div style="background:linear-gradient(135deg,#1a1a2e,#4a9eff);padding:40px 32px;text-align:center;">
            <div style="font-size:40px;margin-bottom:8px;">✦</div>
            <div style="color:#fff;font-size:26px;font-weight:800;letter-spacing:-0.5px;">Wander</div>
            <div style="color:rgba(255,255,255,.7);font-size:14px;margin-top:4px;">your social AI travel app</div>
          </div>
          <div style="padding:36px 32px;">
            <p style="font-size:18px;font-weight:700;color:#1a1a2e;margin:0 0 12px;">
              Hi${name ? ' ' + name : ''}! 👋
            </p>
            <p style="font-size:15px;color:#555;line-height:1.6;margin:0 0 24px;">
              You've been invited to join <strong>Wander</strong> — save your favourite places, build travel maps, and share trips with friends.
            </p>
            <a href="${appUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#4a9eff,#764ba2);color:#fff;text-decoration:none;padding:15px 24px;border-radius:14px;font-size:16px;font-weight:800;">
              Join Wander ✈️
            </a>
            <p style="font-size:12px;color:#aaa;text-align:center;margin-top:20px;">
              Tap the button above to create your free account.
            </p>
          </div>
        </div>
      `
    });

    console.log('[admin/invite] sent invite to:', email);
    res.json({ ok: true, message: 'Invite sent to ' + email });
  } catch(err) {
    console.error('[admin/invite] failed:', err.message);
    res.status(500).json({ error: 'Failed to send: ' + err.message });
  }
});

/* POST /api/admin/create-user — create account without email */
router.post('/create-user', adminAuth, async (req, res) => {
  try {
    const { handle, firstName, email, password } = req.body;
    if (!handle || !firstName || !password)
      return res.status(400).json({ error: 'handle, firstName and password required' });
    const existing = await User.findOne({ $or: [{ handle }, ...(email ? [{ email }] : [])] });
    if (existing) return res.status(409).json({ error: 'Handle or email already taken' });
    const user = await User.create({
      handle, firstName, lastName: '',
      email: email || (handle + '@wander.local'),
      password,
      verified: true,
      verifyToken: null,
      verifyExpires: null
    });
    console.log('[admin/create-user] created:', handle, user._id);
    res.status(201).json({ ok: true, userId: user._id, handle });
  } catch(e) {
    console.error('[admin/create-user]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
