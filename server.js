require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
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

// Routes
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/places', require('./routes/places'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Wandr running on http://localhost:${PORT}`));
