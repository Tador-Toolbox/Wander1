const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const User   = require('../models/User');
const auth   = require('../middleware/auth');

const sign = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

const publicUser = (u) => ({
  email: u.email, firstName: u.firstName, lastName: u.lastName,
  handle: u.handle, avatar: u.avatar
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, handle } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6)  return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (await User.findOne({ email })) return res.status(409).json({ error: 'Email already registered' });
    const user = await User.create({ email, password, firstName: firstName||'', lastName: lastName||'', handle: handle||'' });
    res.status(201).json({ token: sign(user), user: publicUser(user) });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ error: 'Invalid credentials' });
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
    if (handle    !== undefined) user.handle    = handle.toLowerCase().replace(/[^a-z0-9_]/g,'');
    await user.save();
    res.json(publicUser(user));
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
