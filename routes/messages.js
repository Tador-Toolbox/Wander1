const router  = require('express').Router();
const auth    = require('../middleware/auth');
const Message = require('../models/Message');
const User    = require('../models/User');

router.use(auth);

// GET /api/messages — list all conversations (inbox)
router.get('/', async (req, res) => {
  try {
    const uid = req.userId;
    // Get all messages involving this user
    const msgs = await Message.find({ $or: [{ from: uid }, { to: uid }] })
      .sort({ createdAt: -1 });
    
    // Group by conversation partner
    const convMap = {};
    msgs.forEach(m => {
      const partner = m.from.toString() === uid.toString() ? m.to.toString() : m.from.toString();
      if (!convMap[partner]) convMap[partner] = { lastMsg: m, unread: 0 };
      if (!m.read && m.to.toString() === uid.toString()) convMap[partner].unread++;
    });

    // Get partner user info
    const partnerIds = Object.keys(convMap);
    const users = await User.find({ _id: { $in: partnerIds } }, 'firstName lastName handle avatar email');
    const userMap = {};
    users.forEach(u => userMap[u._id.toString()] = u);

    const conversations = partnerIds.map(pid => ({
      partner: userMap[pid],
      lastMsg: convMap[pid].lastMsg,
      unread:  convMap[pid].unread
    })).sort((a, b) => new Date(b.lastMsg.createdAt) - new Date(a.lastMsg.createdAt));

    res.json(conversations);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/messages/:userId — get conversation with a user
router.get('/:userId', async (req, res) => {
  try {
    const uid = req.userId;
    const msgs = await Message.find({
      $or: [
        { from: uid, to: req.params.userId },
        { from: req.params.userId, to: uid }
      ]
    }).sort({ createdAt: 1 }).limit(100);

    // Mark as read
    await Message.updateMany(
      { from: req.params.userId, to: uid, read: false },
      { $set: { read: true } }
    );

    const partner = await User.findById(req.params.userId, 'firstName lastName handle avatar email');
    res.json({ messages: msgs, partner });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/messages/:userId — send a message
router.post('/:userId', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Empty message' });
    if (req.params.userId === req.userId.toString()) return res.status(400).json({ error: "Can't message yourself" });

    const msg = await Message.create({
      from: req.userId,
      to:   req.params.userId,
      text: text.trim()
    });
    res.status(201).json(msg);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/messages/unread/count — total unread count
router.get('/unread/count', async (req, res) => {
  try {
    const count = await Message.countDocuments({ to: req.userId, read: false });
    res.json({ count });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
