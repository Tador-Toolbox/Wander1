const router = require('express').Router();
const auth   = require('../middleware/auth');
const Trip   = require('../models/Trip');
const Place  = require('../models/Place');

/* ─────────────────────────────────────────
   POST /api/ai/trip-plan/:tripId
───────────────────────────────────────── */
router.post('/trip-plan/:tripId', auth, async (req, res) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.tripId, user: req.userId });
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    const places = await Place.find({ trip: req.params.tripId, user: req.userId })
      .select('name location address lat lng tags notes rating');

    if (!places.length) return res.status(400).json({ error: 'No places in this trip' });

    const days = Math.max(1, Math.ceil(places.length / 4));

    const placesText = places.map((p, i) => {
      const loc    = p.location || p.address || '';
      const tags   = p.tags?.length ? ` [${p.tags.join(', ')}]` : '';
      const note   = p.notes ? ` (note: ${p.notes})` : '';
      const coords = (p.lat && p.lng) ? ` (lat:${p.lat.toFixed(3)},lng:${p.lng.toFixed(3)})` : '';
      return `${i + 1}. id:${p._id} | ${p.name} — ${loc}${coords}${tags}${note}`;
    }).join('\n');

    const prompt = `You are a travel planner. Create a ${days}-day itinerary for the trip "${trip.name}".

Places (use the exact id values in your response):
${placesText}

Rules:
- Group geographically close places on the same day to minimize travel
- Max 5 places per day
- Assign a logical time slot: morning, afternoon, or evening
- If tags include restaurant, cafe, bar — schedule at a meal/evening time
- Write a short practical tip per place (1 sentence, helpful to a tourist)
- Suggest a visit duration (e.g. "1 hour", "2-3 hours")

Reply ONLY with valid JSON, no extra text, no markdown fences:
{
  "title": "short catchy trip title",
  "summary": "one sentence overview of the trip",
  "days": [
    {
      "day": 1,
      "theme": "short theme for the day (3-5 words)",
      "places": [
        {
          "placeId": "<exact id from above>",
          "name": "<place name>",
          "time": "morning|afternoon|evening",
          "duration": "X hours",
          "tip": "practical tip"
        }
      ]
    }
  ]
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const plan = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(plan);

  } catch (err) {
    console.error('AI trip plan error:', err);
    res.status(500).json({ error: 'Failed to generate trip plan' });
  }
});

/* ─────────────────────────────────────────
   POST /api/ai/story/:tripId
───────────────────────────────────────── */
router.post('/story/:tripId', auth, async (req, res) => {
  try {
    const { orderedPlaceIds } = req.body;
    if (!orderedPlaceIds || orderedPlaceIds.length < 2)
      return res.status(400).json({ error: 'Need at least 2 places' });

    const trip = await Trip.findOne({ _id: req.params.tripId, user: req.userId });
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    const places = await Place.find({
      _id: { $in: orderedPlaceIds },
      user: req.userId
    }).select('name location address tags notes rating status');

    const ordered = orderedPlaceIds
      .map(id => places.find(p => p._id.toString() === id))
      .filter(Boolean);

    if (ordered.length < 2) return res.status(400).json({ error: 'Could not find enough places' });

    const placesText = ordered.map((p, i) => {
      const loc    = p.location || p.address || '';
      const tags   = p.tags?.length ? ` [${p.tags.join(', ')}]` : '';
      const note   = p.notes ? `. Personal note: "${p.notes}"` : '';
      const rating = p.rating ? ` (rated ${p.rating}/5)` : '';
      const been   = p.status === 'been' ? ' (visited)' : '';
      return `${i + 1}. ${p.name}${loc ? ' in ' + loc : ''}${tags}${rating}${been}${note}`;
    }).join('\n');

    const prompt = `You are narrating a personal travel story for someone's trip called "${trip.name}".

These are the places they visited, in order:
${placesText}

Write a short, warm, personal narration sentence for EACH place — as if you are the traveller recalling the memory.
- First person ("I", "we")
- Evocative and specific, reference the location or tags if possible
- 1-2 sentences max per place
- Natural storytelling tone, not a tour guide

Reply ONLY with valid JSON, no extra text, no markdown fences:
{
  "narrations": [
    "narration for place 1",
    "narration for place 2"
  ]
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    const story = {
      orderedPlaces: orderedPlaceIds,
      narrations: parsed.narrations || [],
      createdAt: new Date()
    };
    trip.story = story;
    await trip.save();

    res.json({ story });

  } catch (err) {
    console.error('AI story error:', err);
    res.status(500).json({ error: 'Failed to generate story' });
  }
});

module.exports = router;

/* ─────────────────────────────────────────
   POST /api/ai/build-profile
   Analyzes up to 20 uploaded images,
   extracts interests + locations, saves aiProfile to User
───────────────────────────────────────── */
router.post('/build-profile', auth, async (req, res) => {
  try {
    const { images } = req.body;
    // images = array of { base64, mediaType, filename }
    if (!images || !images.length)
      return res.status(400).json({ error: 'No images provided' });

    const limited = images.slice(0, 20);

    // Build multi-image message for Claude Vision
    const imageContent = limited.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.base64 }
    }));

    const prompt = `You are analyzing a person's personal photos to understand who they are and what they love.

Look at ALL the photos carefully. Extract:
1. INTERESTS & HOBBIES — what activities, foods, places, sports, passions do you see? (e.g. coffee, hiking, football, sushi, nightlife, museums, beaches, dogs, photography)
2. TRAVEL LOCATIONS — any identifiable cities, countries, landmarks, or region types (mountains, coast, jungle, urban)
3. LIFESTYLE — are they adventurous, relaxed, social, foodie, sporty, cultural?
4. GPS/LOCATION HINTS — if any photo has visible location text, signs, or recognizable landmarks, name them

Reply ONLY with valid JSON, no markdown, no extra text:
{
  "tags": ["coffee", "hiking", "beach", "street-food", "dogs"],
  "summary": "A one sentence personality summary like: Adventurous traveler who loves street food, coffee, and outdoor sports.",
  "locations": ["Vietnam", "Thailand", "Tel Aviv beach"]
}

Tags should be lowercase, 2-15 items, specific and useful for place recommendations.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            ...imageContent,
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const profile = JSON.parse(text.replace(/```json|```/g, '').trim());

    // Save to User
    const User = require('../models/User');
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.aiProfile = {
      tags:       profile.tags || [],
      summary:    profile.summary || '',
      locations:  profile.locations || [],
      analyzedAt: new Date()
    };
    await user.save();

    res.json({ profile: user.aiProfile });

  } catch (err) {
    console.error('Build profile error:', err);
    res.status(500).json({ error: 'Failed to build profile' });
  }
});

/* ─────────────────────────────────────────
   GET /api/ai/profile
   Returns current user's aiProfile
───────────────────────────────────────── */
router.get('/profile', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.userId).select('aiProfile');
    res.json({ profile: user?.aiProfile || null });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─────────────────────────────────────────
   POST /api/ai/geo-suggestions
   Takes GPS coords from photos, reverse-geocodes them,
   returns suggested places to add as "been there"
───────────────────────────────────────── */
router.post('/geo-suggestions', auth, async (req, res) => {
  try {
    const { locations } = req.body; // [{lat, lng, filename}]
    if (!locations || !locations.length)
      return res.status(400).json({ error: 'No locations provided' });

    const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!mapsKey) return res.status(500).json({ error: 'Maps key missing' });

    // Reverse geocode each unique location
    const unique = locations.slice(0, 10); // max 10
    const suggestions = await Promise.all(unique.map(async loc => {
      try {
        const r = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${loc.lat},${loc.lng}&key=${mapsKey}`
        );
        const d = await r.json();
        if (!d.results || !d.results[0]) return null;
        const result = d.results[0];
        // Find a good place name — prefer establishment/point_of_interest over street address
        const name = result.address_components.find(c =>
          c.types.includes('point_of_interest') ||
          c.types.includes('establishment') ||
          c.types.includes('premise')
        )?.long_name || result.address_components[0]?.long_name || 'Unknown Place';
        const city = result.address_components.find(c => c.types.includes('locality'))?.long_name || '';
        const country = result.address_components.find(c => c.types.includes('country'))?.long_name || '';
        return {
          name,
          location: [city, country].filter(Boolean).join(', '),
          address: result.formatted_address,
          lat: loc.lat,
          lng: loc.lng,
          filename: loc.filename
        };
      } catch { return null; }
    }));

    res.json({ suggestions: suggestions.filter(Boolean) });
  } catch (err) {
    console.error('Geo suggestions error:', err);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

/* ─────────────────────────────────────────
   DELETE /api/ai/profile
   Resets the user's aiProfile
───────────────────────────────────────── */
router.delete('/profile', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.userId, {
      $set: { aiProfile: { tags: [], summary: '', locations: [], analyzedAt: null } }
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─────────────────────────────────────────
   POST /api/ai/trip-suggest
   Uses user's AI profile to suggest places for a specific trip
───────────────────────────────────────── */
router.post('/trip-suggest', auth, async (req, res) => {
  try {
    const { tripName, tripPlaces = [], allSavedPlaces = [], visitMonth = '' } = req.body;
    if (!tripName) return res.status(400).json({ error: 'Trip name required' });

    // Load user's AI profile
    const User = require('../models/User');
    const user = await User.findById(req.userId).select('aiProfile');
    const profile = user?.aiProfile;

    if (!profile || !profile.analyzedAt)
      return res.status(400).json({ error: 'No AI profile found. Build your profile first.' });

    const alreadyHas = tripPlaces.length
      ? `The user already has these places in this trip, do NOT suggest them: ${tripPlaces.join(', ')}.`
      : '';

    // Build a compact summary of saved places for context
    const beenPlaces = allSavedPlaces.filter(p => p.status === 'been');
    const highRated  = allSavedPlaces.filter(p => p.rating >= 4);
    const allTags    = allSavedPlaces.flatMap(p => p.tags);
    const tagFreq    = allTags.reduce((acc, t) => { acc[t] = (acc[t]||0)+1; return acc; }, {});
    const topTags    = Object.entries(tagFreq).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([t])=>t);

    const savedContext = allSavedPlaces.length ? `
The user has ${allSavedPlaces.length} saved places on their map. Key signals:
- Top tags across all their places: ${topTags.join(', ')}
- Places they've been to: ${beenPlaces.slice(0,8).map(p=>p.name+(p.location?' ('+p.location+')':'')).join(', ')||'none yet'}
- Highest rated places (4-5★): ${highRated.slice(0,6).map(p=>p.name).join(', ')||'none yet'}
Use this to reinforce their taste patterns when making suggestions.` : '';

    const seasonalNote = visitMonth
      ? `The user plans to visit in ${visitMonth}. Factor in seasonal availability, weather, and events. Avoid suggesting places that are closed or unpleasant in ${visitMonth}.`
      : '';

    const prompt = `You are a travel recommendation engine.

The user is planning a trip to: "${tripName}"

Their AI taste profile (from photo analysis):
- Summary: ${profile.summary}
- Interests & tags: ${(profile.tags || []).join(', ')}
- Previously visited regions: ${(profile.locations || []).join(', ')}
${savedContext}

${alreadyHas}
${seasonalNote}

Return exactly 10 suggestions total, split as follows:

PART 1 — 8 CURATED PICKS (isGem: false):
- Must be in or near "${tripName}" destination
- Strongly match their taste profile
- Balanced mix — include at least: 2 restaurants/food spots, 1 cafe, 2 landmarks/attractions, 1 nature/outdoor spot, 1 market/shopping, 1 nightlife/bar (adjust based on their interests)
- Well-known quality places, not random tourist traps

PART 2 — 2 HIDDEN GEMS (isGem: true):
- Truly off the beaten path — places most tourists never find
- Loved by locals, not in mainstream travel guides
- Could be: a tiny family-run restaurant, a secret viewpoint, a neighborhood market, an underground bar, a little-known temple or gallery
- Must still match their taste profile

For each place provide accurate real coordinates (lat/lng).

Reply ONLY with valid JSON, no markdown, no extra text:
{
  "suggestions": [
    {
      "name": "Place Name",
      "location": "City, Country",
      "lat": 12.345,
      "lng": 67.890,
      "why": "One sentence explaining why this matches their taste",
      "tags": ["coffee", "cozy", "local"],
      "isGem": false
    }
  ]
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());

    res.json(result);
  } catch (err) {
    console.error('Trip suggest error:', err);
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});
