const router  = require('express').Router();
const auth    = require('../middleware/auth');
const Trip    = require('../models/Trip');
const Place   = require('../models/Place');
const crypto  = require('crypto');

router.use(auth);

// GET /api/trips — own trips + accepted shared trips
router.get('/', async (req, res) => {
  try {
    const [ownTrips, sharedTrips] = await Promise.all([
      Trip.find({ user: req.userId }).sort({ createdAt: -1 }),
      Trip.find({
        'collaborators.user': req.userId,
        'collaborators.status': 'accepted'
      }).populate('user', 'firstName lastName handle').sort({ createdAt: -1 })
    ]);
    // Mark shared trips so frontend can distinguish them
    const marked = sharedTrips.map(t => {
      const obj = t.toObject();
      obj.isShared = true;
      return obj;
    });
    res.json([...ownTrips, ...marked]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/trips
router.post('/', async (req, res) => {
  try {
    const { name, emoji, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const trip = await Trip.create({ user: req.userId, name, emoji: emoji||'✈️', color: color||'#4a9eff' });
    res.status(201).json(trip);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/trips/:id
router.put('/:id', async (req, res) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, user: req.userId });
    if (!trip) return res.status(404).json({ error: 'Not found' });
    const { name, emoji, color } = req.body;
    if (name)  trip.name  = name;
    if (emoji) trip.emoji = emoji;
    if (color) trip.color = color;
    await trip.save();
    res.json(trip);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/trips/:id
router.delete('/:id', async (req, res) => {
  try {
    const trip = await Trip.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!trip) return res.status(404).json({ error: 'Not found' });
    // Remove trip reference from places
    await Place.updateMany({ trip: req.params.id }, { $set: { trip: null } });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/trips/:id/share — generate share link
router.post('/:id/share', async (req, res) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, user: req.userId });
    if (!trip) return res.status(404).json({ error: 'Not found' });
    if (!trip.shareToken) {
      trip.shareToken = crypto.randomBytes(16).toString('hex');
      trip.sharedAt   = new Date();
      await trip.save();
    }
    res.json({ token: trip.shareToken });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/trips/:id/share — revoke share link
router.delete('/:id/share', async (req, res) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.id, user: req.userId });
    if (!trip) return res.status(404).json({ error: 'Not found' });
    trip.shareToken = null; trip.sharedAt = null;
    await trip.save();
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;

/* ─────────────────────────────────────────
   GET /api/trips/pending-invites
   Get trips where current user has a pending invite
───────────────────────────────────────── */
router.get('/pending-invites', auth, async (req, res) => {
  try {
    const trips = await Trip.find({
      'collaborators.user': req.userId,
      'collaborators.status': 'pending'
    }).populate('user', 'firstName lastName handle').lean();

    const invites = trips.map(t => ({
      tripId: t._id,
      tripName: t.name,
      tripEmoji: t.emoji,
      invitedBy: t.user
    }));
    res.json(invites);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─────────────────────────────────────────
   POST /api/trips/:id/decline-invite
───────────────────────────────────────── */
router.post('/:id/decline-invite', auth, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    trip.collaborators = trip.collaborators.filter(
      c => c.user.toString() !== req.userId.toString()
    );
    await trip.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─────────────────────────────────────────
   POST /api/trips/:id/leave
   Member leaves a shared trip
───────────────────────────────────────── */
router.post('/:id/leave', auth, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    if (trip.user.toString() === req.userId.toString())
      return res.status(400).json({ error: 'Owner cannot leave — delete the trip instead' });
    trip.collaborators = trip.collaborators.filter(
      c => c.user.toString() !== req.userId.toString()
    );
    await trip.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─────────────────────────────────────────
   POST /api/trips/:id/invite
   Invite a Wandr user to collaborate on a trip
───────────────────────────────────────── */
router.post('/:id/invite', auth, async (req, res) => {
  try {
    const { handle } = req.body;
    if (!handle) return res.status(400).json({ error: 'Handle required' });

    const trip = await Trip.findOne({ _id: req.params.id, user: req.userId });
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    const User = require('../models/User');
    const invitee = await User.findOne({ handle: handle.replace('@','') }).select('_id handle firstName lastName');
    if (!invitee) return res.status(404).json({ error: `User @${handle} not found` });

    // Check not already a collaborator
    const already = trip.collaborators.find(c => c.user.toString() === invitee._id.toString());
    if (already) return res.status(400).json({ error: 'User already invited' });

    trip.collaborators.push({
      user: invitee._id,
      handle: invitee.handle,
      name: `${invitee.firstName||''} ${invitee.lastName||''}`.trim(),
      status: 'pending'
    });
    await trip.save();

    res.json({ ok: true, collaborator: { handle: invitee.handle, name: invitee.firstName } });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─────────────────────────────────────────
   GET /api/trips/shared-with-me
   Get trips the current user is a collaborator on
───────────────────────────────────────── */
router.get('/shared-with-me', auth, async (req, res) => {
  try {
    const trips = await Trip.find({
      'collaborators.user': req.userId,
      'collaborators.status': 'accepted'
    }).lean();
    res.json(trips);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─────────────────────────────────────────
   POST /api/trips/:id/accept-invite
   Accept a collaboration invite
───────────────────────────────────────── */
router.post('/:id/accept-invite', auth, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    const collab = trip.collaborators.find(c => c.user.toString() === req.userId.toString());
    if (!collab) return res.status(403).json({ error: 'No invite found' });

    collab.status = 'accepted';
    await trip.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─────────────────────────────────────────
   POST /api/trips/:id/collab-place
   Collaborator adds a place to a shared trip
───────────────────────────────────────── */
router.post('/:id/collab-place', auth, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    // Must be owner or accepted collaborator
    const isOwner = trip.user.toString() === req.userId.toString();
    const isCollab = trip.collaborators.some(c =>
      c.user.toString() === req.userId.toString() && c.status === 'accepted'
    );
    if (!isOwner && !isCollab) return res.status(403).json({ error: 'Not authorized' });

    const Place = require('../models/Place');
    const place = await Place.create({
      ...req.body,
      user: req.userId,
      trip: trip._id
    });
    res.json(place);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
