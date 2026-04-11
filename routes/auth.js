const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { Resend } = require('resend');
const User    = require('../models/User');
const auth    = require('../middleware/auth');

const resend = new Resend(process.env.RESEND_API_KEY);
const sign   = (user) => jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
const publicUser = (u) => ({
  email: u.email, firstName: u.firstName, lastName: u.lastName,
  handle: u.handle, avatar: u.avatar, verified: u.verified
});

// Send verification email
async function sendVerificationEmail(user, token) {
  const verifyUrl = `${process.env.APP_URL || 'https://wander1.onrender.com'}/api/auth/verify/${token}`;
  await resend.emails.send({
    from: 'Wandr <onboarding@resend.dev>',
    to:   user.email,
    subject: '✈️ Verify your Wandr account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
        <h1 style="font-size:28px;color:#1a1a2e;margin-bottom:8px;">Welcome to Wandr ✈️</h1>
        <p style="color:#6b6880;font-size:15px;line-height:1.6;">
          Thanks for signing up! Please verify your email address to activate your account.
        </p>
        <a href="${verifyUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#4a9eff;color:#fff;text-decoration:none;border-radius:12px;font-size:15px;font-weight:700;">
          ✓ Verify Email
        </a>
        <p style="color:#a09cb0;font-size:12px;">
          This link expires in 24 hours. If you didn't sign up for Wandr, ignore this email.
        </p>
      </div>
    `
  });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, handle } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const existing = await User.findOne({ email });
    if (existing) {
      // If exists but not verified, resend verification email
      if (!existing.verified && existing.verifyToken) {
        const verifyToken   = crypto.randomBytes(32).toString('hex');
        const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        existing.verifyToken   = verifyToken;
        existing.verifyExpires = verifyExpires;
        await existing.save();
        try { await sendVerificationEmail(existing, verifyToken); } catch(e) { console.error('Email send error:', e); }
        return res.status(201).json({ message: 'Verification email resent! Please check your inbox.' });
      }
      return res.status(409).json({ error: 'Email already registered' });
    }

    const verifyToken   = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await User.create({
      email, password,
      firstName: firstName || '', lastName: lastName || '', handle: handle || '',
      verified: false, verifyToken, verifyExpires
    });

    // Send verification email
    try { await sendVerificationEmail(user, verifyToken); } catch(e) { console.error('Email send error:', e); }

    res.status(201).json({ message: 'Registration successful! Please check your email to verify your account.' });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/auth/verify/:token
router.get('/verify/:token', async (req, res) => {
  try {
    const user = await User.findOne({
      verifyToken: req.params.token,
      verifyExpires: { $gt: new Date() }
    });
    if (!user) return res.status(400).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;">
        <h2>❌ Invalid or expired link</h2>
        <p>Please register again at <a href="https://wander1.onrender.com">wander1.onrender.com</a></p>
      </body></html>
    `);

    user.verified = true;
    user.verifyToken = null;
    user.verifyExpires = null;
    await user.save();

    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#f7f4ef;">
        <div style="max-width:400px;margin:0 auto;background:#fff;border-radius:24px;padding:40px;box-shadow:0 8px 30px rgba(0,0,0,.08);">
          <div style="font-size:48px;margin-bottom:16px;">✅</div>
          <h2 style="color:#1a1a2e;">Email Verified!</h2>
          <p style="color:#6b6880;">Your Wandr account is now active. You can close this tab and sign in.</p>
          <a href="https://wander1.onrender.com" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#4a9eff;color:#fff;text-decoration:none;border-radius:12px;font-weight:700;">Open Wandr ✈️</a>
        </div>
      </body></html>
    `);
  } catch(e) { res.status(500).send('Server error'); }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ error: 'Invalid credentials' });
    // Allow users created before verification was added (no verifyToken means old user)
    if (!user.verified && user.verifyToken)
      return res.status(403).json({ error: 'Please verify your email first. Check your inbox.' });
    res.json({ token: sign(user), user: publicUser(user) });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(publicUser(user));
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/auth/profile
router.put('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const { firstName, lastName, handle } = req.body;
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName  !== undefined) user.lastName  = lastName;
    if (handle    !== undefined) user.handle    = handle.toLowerCase().replace(/[^a-z0-9_]/g, '');
    await user.save();
    res.json(publicUser(user));
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user || user.verified) return res.json({ message: 'If this email exists and is unverified, a new link was sent.' });
    const verifyToken   = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    user.verifyToken = verifyToken;
    user.verifyExpires = verifyExpires;
    await user.save();
    await sendVerificationEmail(user, verifyToken);
    res.json({ message: 'Verification email sent!' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});


// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    // Always return success to prevent email enumeration
    if (!user) return res.json({ message: 'If this email exists, a reset link was sent.' });

    const resetToken   = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    user.verifyToken   = resetToken;
    user.verifyExpires = resetExpires;
    await user.save();

    const resetUrl = `${process.env.APP_URL || 'https://wander1.onrender.com'}/reset-password?token=${resetToken}`;

    await resend.emails.send({
      from: 'Wandr <onboarding@resend.dev>',
      to:   user.email,
      subject: '🔑 Reset your Wandr password',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
          <h1 style="font-size:28px;color:#1a1a2e;margin-bottom:8px;">Reset your password 🔑</h1>
          <p style="color:#6b6880;font-size:15px;line-height:1.6;">
            We received a request to reset your Wandr password.
            Click the button below to choose a new one.
          </p>
          <a href="${resetUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#4a9eff;color:#fff;text-decoration:none;border-radius:12px;font-size:15px;font-weight:700;">
            🔑 Reset Password
          </a>
          <p style="color:#a09cb0;font-size:12px;">
            This link expires in 1 hour. If you didn't request this, ignore this email.
          </p>
        </div>
      `
    });

    res.json({ message: 'Password reset email sent!' });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const user = await User.findOne({
      verifyToken:   token,
      verifyExpires: { $gt: new Date() }
    });
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link' });

    user.password      = password;
    user.verifyToken   = null;
    user.verifyExpires = null;
    user.verified      = true;
    await user.save();

    res.json({ message: 'Password changed successfully! You can now sign in.' });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
