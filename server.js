require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: 'Look at this image. Extract the place name and address/location if visible. Reply ONLY with JSON like this: {"name":"Place Name","location":"City, Country","address":"full address if visible"} - if you cannot find a place name or location, reply with {"name":"","location":"","address":""}' }
          ]
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: 'Scan failed' });
  }
});

// Routes
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/places', require('./routes/places'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Wandr running on http://localhost:${PORT}`));
