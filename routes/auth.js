const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const User   = require('../models/User');

const sign = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6)  return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (await User.findOne({ email })) return res.status(409).json({ error: 'Email already registered' });
    const user = await User.create({ email, password });
    res.status(201).json({ token: sign(user), email: user.email });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ token: sign(user), email: user.email });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
