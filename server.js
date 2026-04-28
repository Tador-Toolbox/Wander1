require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// Expose Maps API key to frontend (authenticated requests only)
// The key is never hard-coded in public HTML
app.get('/api/config/maps-key', require('./middleware/auth'), (req, res) => {
  res.json({ key: process.env.GOOGLE_MAPS_API_KEY });
});

// Expose Anthropic key to frontend (authenticated requests only)
app.get('/api/config/anthropic-key', require('./middleware/auth'), (req, res) => {
  res.json({ key: process.env.ANTHROPIC_API_KEY });
});

// Server-side image scan using Anthropic
app.post('/api/scan-image', require('./middleware/auth'), async (req, res) => {
  try {
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const prompt = `Look at this image carefully. Try to identify the place using TWO methods:
1. TEXT: Read any visible text, signs, address, location tags, or captions in the image.
2. VISUAL: If you recognize the place visually (famous landmark, restaurant, beach, etc.), identify it.

Reply ONLY with JSON in this exact format:
{"name":"Place Name","location":"City, Country","address":"full address if visible","method":"text"}
- method should be "text" if you found it from text/signs in the image
- method should be "visual" if you recognized it visually without text
- method should be "both" if both methods confirmed it
- If you cannot identify any place at all, reply: {"name":"","location":"","address":"","method":"none"}`;

    let text = null;
    const models = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash-lite'];
    for (const model of models) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: mediaType || 'image/jpeg', data: imageBase64 } },
                { text: prompt }
              ]
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
          })
        });
        const data = await response.json();
        if (data.error) { console.log('Gemini scan', model, 'failed:', data.error.message); continue; }
        text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (text) { console.log('✅ Gemini scan used:', model); break; }
      } catch(e) { console.log('Gemini scan error:', e.message); }
    }

    if (!text) return res.status(500).json({ error: 'Could not analyze image' });

    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    // If we got a location, geocode it to lat/lng
    if (parsed.name || parsed.location || parsed.address) {
      const searchQuery = parsed.address || parsed.name + ' ' + parsed.location;
      try {
        const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchQuery)}&key=${process.env.GOOGLE_MAPS_API_KEY}`);
        const geoData = await geoRes.json();
        if (geoData.results && geoData.results[0]) {
          parsed.lat = geoData.results[0].geometry.location.lat;
          parsed.lng = geoData.results[0].geometry.location.lng;
          parsed.formattedAddress = geoData.results[0].formatted_address;
        }
      } catch(e) { /* geocode failed, frontend will handle */ }
    }
    
    res.json(parsed);

  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: 'Scan failed' });
  }
});

// Public explore – no auth needed
app.get('/api/explore', async (req, res) => {
  try {
    const Place = require('./models/Place');
    const places = await Place.find({ $or: [{ isPublic: true }, { visibility: { $in: ['public','both'] } }] })
      .select('name location lat lng tags rating coverPhoto notes')
      .sort({ createdAt: -1 })
      .limit(500);
    res.json(places);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
// Routes
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/places', require('./routes/places'));
app.use('/api/trips',  require('./routes/trips'));
app.use('/api/share',  require('./routes/share'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/posts',    require('./routes/posts'));
app.use('/api/users',    require('./routes/users'));
app.use('/api/photos',   require('./routes/photos'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/ai',       require('./routes/ai'));
app.use('/api/admin',    require('./routes/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Reset password page
app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

// Serve index-new.html directly (new design preview)
app.get('/index-new.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index-new.html'));
});

// SPA fallback - serves index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Wandr running on http://localhost:${PORT}`));
