const router   = require('express').Router();
const auth     = require('../middleware/auth');
const multer   = require('multer');
const { v2: cloudinary } = require('cloudinary');
const Place    = require('../models/Place');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer – store in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

router.use(auth);

// POST /api/upload/cover/:placeId
// Upload or replace cover photo
router.post('/cover/:placeId', upload.single('photo'), async (req, res) => {
  try {
    const place = await Place.findOne({ _id: req.params.placeId, user: req.userId });
    if (!place) return res.status(404).json({ error: 'Place not found' });
    if (!req.file)  return res.status(400).json({ error: 'No file uploaded' });

    // Delete old cover from Cloudinary if exists
    if (place.coverPhoto) {
      const publicId = extractPublicId(place.coverPhoto);
      if (publicId) await cloudinary.uploader.destroy(publicId).catch(() => {});
    }

    // Upload new cover
    const result = await uploadBuffer(req.file.buffer, `wandr/covers/${req.userId}`);
    place.coverPhoto = result.secure_url;
    await place.save();
    res.json({ url: result.secure_url });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// POST /api/upload/photo/:placeId
// Add a photo to the gallery
router.post('/photo/:placeId', upload.single('photo'), async (req, res) => {
  try {
    const place = await Place.findOne({ _id: req.params.placeId, user: req.userId });
    if (!place) return res.status(404).json({ error: 'Place not found' });
    if (!req.file)  return res.status(400).json({ error: 'No file uploaded' });
    if (place.photos.length >= 10) return res.status(400).json({ error: 'Max 10 photos per place' });

    const result = await uploadBuffer(req.file.buffer, `wandr/photos/${req.userId}`);
    place.photos.push(result.secure_url);
    await place.save();
    res.json({ url: result.secure_url, photos: place.photos });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// DELETE /api/upload/photo/:placeId
// Remove a specific photo from gallery
router.delete('/photo/:placeId', async (req, res) => {
  try {
    const { url } = req.body;
    const place = await Place.findOne({ _id: req.params.placeId, user: req.userId });
    if (!place) return res.status(404).json({ error: 'Place not found' });

    const publicId = extractPublicId(url);
    if (publicId) await cloudinary.uploader.destroy(publicId).catch(() => {});

    place.photos = place.photos.filter(p => p !== url);
    await place.save();
    res.json({ photos: place.photos });
  } catch {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── Helpers ──
function uploadBuffer(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', transformation: [{ quality: 'auto', fetch_format: 'auto' }] },
      (err, result) => err ? reject(err) : resolve(result)
    );
    stream.end(buffer);
  });
}

function extractPublicId(url) {
  if (!url) return null;
  // e.g. https://res.cloudinary.com/cloud/image/upload/v123/wandr/covers/abc.jpg
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
  return match ? match[1] : null;
}

module.exports = router;

// POST /api/upload/avatar — upload profile picture
router.post('/avatar', upload.single('photo'), async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Delete old avatar
    if (user.avatar) {
      const publicId = extractPublicId(user.avatar);
      if (publicId) await cloudinary.uploader.destroy(publicId).catch(() => {});
    }

    const result = await uploadBuffer(req.file.buffer, `wandr/avatars`);
    user.avatar = result.secure_url;
    await user.save();
    res.json({ url: result.secure_url });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});
