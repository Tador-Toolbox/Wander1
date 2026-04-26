const router = require('express').Router();
const auth   = require('../middleware/auth');
const Trip   = require('../models/Trip');
const Place  = require('../models/Place');

/* ─────────────────────────────────────────
   TAG CATEGORY MAP
   Groups related tags so one bad rating at
   one place doesn't penalise the whole category
───────────────────────────────────────── */
const TAG_CATEGORIES = {
  coffee:    ['coffee','specialty-coffee','cafe','espresso','latte','cappuccino'],
  food:      ['food','street-food','restaurant','dining','brunch','breakfast','lunch','dinner','local-food'],
  fineDining:['fine-dining','michelin','omakase','tasting-menu','wagyu','steak','beef'],
  japanese:  ['japanese','sushi','ramen','izakaya','yakitori','tempura','anime','manga','japan'],
  nature:    ['nature','hiking','mountains','forest','waterfall','national-park','outdoor','trekking'],
  beach:     ['beach','ocean','sea','snorkeling','surfing','island','coast'],
  nightlife: ['nightlife','night-club','dancing','club','dj','rave'],
  bar:       ['bar','cocktails','wine-bar','craft-beer','pub','drinks','whiskey'],
  culture:   ['culture','museum','gallery','art','history','heritage','temple','church','monument'],
  shopping:  ['shopping','market','boutique','luxury','vintage','mall','bazaar'],
  beauty:    ['beauty','spa','wellness','salon','massage','yoga','gym'],
  sports:    ['sports','football','basketball','cycling','climbing','diving','extreme'],
  social:    ['social','rooftop','brunch-spot','trendy','instagram','popular']
};

function getCategory(tag){
  const t = tag.toLowerCase().replace(/\s+/g,'-');
  for(const [cat, tags] of Object.entries(TAG_CATEGORIES)){
    if(tags.includes(t)) return cat;
  }
  return t; // use tag itself as category if no match
}

/* ─────────────────────────────────────────
   FEEDBACK LOOP
   Called after every rating change on a place
   Requires 3+ ratings in a category before
   drawing any conclusion
───────────────────────────────────────── */
async function updateFeedbackLoop(userId, tags, newRating, oldRating){
  const User = require('../models/User');
  const user = await User.findById(userId);
  if(!user) return;

  if(!user.feedbackLoop) user.feedbackLoop = { categories: new Map() };
  const cats = user.feedbackLoop.categories;

  // Get unique categories for this place's tags
  const categories = [...new Set(tags.map(getCategory))];

  for(const cat of categories){
    const current = cats.get(cat) || { totalRating:0, count:0, lastUpdated:null };

    // Subtract old rating if this is an update (not a new rating)
    if(oldRating && oldRating > 0){
      current.totalRating -= oldRating;
      current.count = Math.max(0, current.count - 1);
    }

    // Add new rating (only if it's a real rating, not clearing)
    if(newRating && newRating > 0){
      current.totalRating += newRating;
      current.count += 1;
    }

    current.lastUpdated = new Date();
    cats.set(cat, current);
  }

  user.markModified('feedbackLoop.categories');
  await user.save();
}

function buildFeedbackContext(feedbackLoop){
  if(!feedbackLoop || !feedbackLoop.categories) return '';
  const MIN_RATINGS = 3; // need at least 3 ratings to draw conclusions
  const strong = [], positive = [], negative = [], avoid = [];

  for(const [cat, data] of feedbackLoop.categories.entries()){
    if(data.count < MIN_RATINGS) continue; // not enough data yet
    const avg = data.totalRating / data.count;
    if(avg >= 4.5) strong.push(cat);
    else if(avg >= 3.5) positive.push(cat);
    else if(avg <= 1.5) avoid.push(cat);
    else if(avg <= 2.5) negative.push(cat);
    // 2.5–3.5 = neutral, ignore
  }

  if(!strong.length && !positive.length && !negative.length && !avoid.length) return '';

  let ctx = '\nUser rating patterns (based on actual visits, minimum 3 ratings per category):';
  if(strong.length)   ctx += `\n- STRONGLY loves: ${strong.join(', ')} (consistently 4.5+ stars)`;
  if(positive.length) ctx += `\n- Generally enjoys: ${positive.join(', ')} (3.5-4.5 stars average)`;
  if(negative.length) ctx += `\n- Mixed feelings about: ${negative.join(', ')} (below 2.5 average)`;
  if(avoid.length)    ctx += `\n- Tends to dislike: ${avoid.join(', ')} (consistently under 1.5 stars — weight heavily against these)`;
  ctx += '\nUse this to prioritise or deprioritise suggestions accordingly.';
  return ctx;
}

module.exports.updateFeedbackLoop = updateFeedbackLoop;

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
        max_tokens: 3000,
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
    const { images, isOnboarding = false } = req.body;
    // images = array of { base64, mediaType, filename }
    if (!images || !images.length)
      return res.status(400).json({ error: 'No images provided' });

    const limited = images.slice(0, 20);

    // Build multi-image message for Claude Vision
    const imageContent = limited.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.base64 }
    }));

    const prompt = isOnboarding
      ? `You are a travel intelligence system analyzing a new user's personal photos to build their taste and personality profile.

Study EVERY photo intensely. For each photo consider:

FOOD & DRINK:
- What specific food is it? (sushi, wagyu, pad thai, shakshuka, pasta, burger, etc.)
- Is it street food or fine dining?
- What coffee/drink? (ice latte, espresso, black coffee, cocktail, beer, wine)
- Is it a specialty cafe or chain?

PLACES & TRAVEL:
- What type of place? (urban street, beach, mountain, jungle, desert, market, restaurant, museum, club)
- Which city/country if identifiable from signs, architecture, or landmarks?
- Urban or rural? Tourist area or local neighborhood?
- Indoor or outdoor?

SOCIAL CONTEXT:
- Is the person alone or with many people?
- Is it a big crowded nightclub with dancing or a quiet bar with conversation?
- Daytime activity or nightlife?
- Luxury/high-end or budget/local?

ACTIVITIES & INTERESTS:
- Sports? (surfing, hiking, football, gym, extreme sports)
- Arts/culture? (museums, galleries, street art, concerts)
- Nature? (specific: beach, mountains, forest, desert, waterfalls)
- Shopping? (luxury brands, local markets, vintage)
- Beauty/wellness? (spas, salons, wellness centers)

PERSONALITY SIGNALS:
- Adventurous or comfort-seeking?
- Social or solitary?
- Foodie, explorer, party person, culture lover, nature person?

Reply ONLY with valid JSON, no markdown, no extra text:
{
  "tags": ["specialty-coffee", "wagyu", "street-food", "hiking", "nightlife", "beach", "anime", "museums"],
  "aestheticTags": ["minimalist", "high-end", "industrial", "warm-tones", "dark-moody"],  // visual aesthetic style from photos
  "summary": "A vivid one-sentence profile like: A Japan-obsessed foodie who hunts specialty coffee by day, explores local street food markets at night, and balances culture with outdoor hikes.",
  "locations": ["Tokyo", "Vietnam", "Tel Aviv beach promenade"],
  "dietaryStyle": "meat-lover|vegetarian|vegan|omnivore",
  "travelStyle": "luxury|budget|backpacker|mid-range",
  "socialStyle": "solo|social|group",
  "timeOfDay": "day-person|night-person|both"
}

Tags: 5-15 items, specific and lowercase. Use precise terms (wagyu not just beef, espresso not just coffee).`
      : `You are analyzing a person's personal photos to understand who they are and what they love.

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

    const { answers = {} } = req.body;
    user.aiProfile = {
      tags:         profile.tags || [],
      summary:      profile.summary || '',
      locations:    profile.locations || [],
      analyzedAt:   new Date(),
      aestheticTags: profile.aestheticTags || [],
      ...(isOnboarding && {
        dietaryStyle: profile.dietaryStyle || '',
        travelStyle:  profile.travelStyle  || '',
        socialStyle:  profile.socialStyle  || '',
        timeOfDay:    profile.timeOfDay    || ''
      }),
      // Music & event preferences from questionnaire
      ...(answers.music?.length    && { musicGenres: answers.music }),
      ...(answers.goal             && { eventGoal:   answers.goal }),
      ...(answers.atmosphere       && { atmosphere:  answers.atmosphere }),
      ...(answers.soundVibe        && { soundVibe:   answers.soundVibe })
    };
    // Upload photos to Cloudinary and save URLs
    try {
      const cloudinary = require('cloudinary').v2;
      const uploadedPhotos = [];
      for (const img of images.slice(0, 20)) {
        const result = await cloudinary.uploader.upload(
          `data:${img.mediaType};base64,${img.base64}`,
          { folder: 'wandr_ai_photos', resource_type: 'image',
            transformation: [{ width: 400, height: 400, crop: 'fill', quality: 'auto' }] }
        );
        uploadedPhotos.push({ url: result.secure_url, publicId: result.public_id });
      }
      if (isOnboarding) {
        user.aiPhotos = uploadedPhotos;
      } else {
        user.aiPhotos = [...(user.aiPhotos || []), ...uploadedPhotos].slice(-20);
      }
    } catch(photoErr) {
      console.error('Photo upload error:', photoErr.message);
    }

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

    // Build feedback context from user's rating patterns
    const feedbackUser = await User.findById(req.userId).select('feedbackLoop');
    const feedbackContext = buildFeedbackContext(feedbackUser?.feedbackLoop);

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
${savedContext}${feedbackContext}

${alreadyHas}
${seasonalNote}

Return exactly 11 suggestions total, split as follows:

PART 1 — 8 CURATED PICKS (isGem: false, isMichelin: false):
- Must be in or near "${tripName}" destination
- Strongly match their taste profile
- Balanced mix — include at least: 2 restaurants/food spots, 1 cafe, 2 landmarks/attractions, 1 nature/outdoor spot, 1 market/shopping, 1 nightlife/bar (adjust based on their interests)
- Well-known quality places, not random tourist traps

PART 2 — 2 HIDDEN GEMS (isGem: true, isMichelin: false):
- Truly off the beaten path — places most tourists never find
- Loved by locals, not in mainstream travel guides
- Could be: a tiny family-run restaurant, a secret viewpoint, a neighborhood market, an underground bar, a little-known temple or gallery
- Must still match their taste profile

PART 3 — 1 MICHELIN PICK (isMichelin: true, isGem: false):
- Must be a REAL Michelin-listed restaurant in or near "${tripName}" that you are CONFIDENT exists in the Michelin Guide
- Prefer Bib Gourmand (great value) if user profile suggests budget/mid-range, otherwise 1-2 Star
- Set michelinDistinction to exactly one of: "Bib Gourmand", "1 Star", "2 Stars", "3 Stars"
- ONLY include if you are genuinely confident it is Michelin listed — do NOT guess or invent
- The why field must mention the Michelin distinction and what makes it exceptional

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
      "isGem": false,
      "isMichelin": false,
      "michelinDistinction": ""
    }
  ],
  "holidays": [
    {
      "name": "Festival or Holiday Name",
      "dates": "April 13-15",
      "emoji": "🎉",
      "note": "One sentence about what it is and why it matters for a visitor"
    }
  ]
}

For holidays: include 2-5 major festivals, public holidays, or culturally significant events happening in "${tripName}" during ${visitMonth || 'the visit period'}. If visitMonth is unknown, list the 3 most iconic annual events. If there are no notable events, return an empty array.`;

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
    const rawText = data.content?.filter(b=>b.type==='text').map(b=>b.text).join('') || '{}';
    const jsonMatchRn = rawText.match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatchRn ? jsonMatchRn[0] : '{}');

    res.json(result);
  } catch (err) {
    console.error('Trip suggest error:', err);
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

/* ─────────────────────────────────────────
   POST /api/ai/right-now
   Returns 2 personalized activity suggestions
   based on time of day, location, and user profile
───────────────────────────────────────── */
router.post('/right-now', auth, async (req, res) => {
  try {
    const { lat, lng, locationStr, timeLabel, hour } = req.body;

    // Load user's AI profile for taste context
    const User = require('../models/User');
    const user = await User.findById(req.userId).select('aiProfile');
    const profile = user?.aiProfile;

    const tasteContext = profile?.tags?.length
      ? `User taste profile: ${profile.tags.join(', ')}`
      : 'No taste profile yet — suggest universally appealing ideas';

    const locationContext = locationStr && locationStr !== 'your current location'
      ? `User is currently in: ${locationStr}`
      : lat && lng
        ? `User coordinates: ${lat.toFixed(3)}, ${lng.toFixed(3)}`
        : 'Location unknown — give general ideas';

    const prompt = `You are a spontaneous activity advisor. Give exactly 2 ideas for what this person should do RIGHT NOW.

Current time: ${timeLabel} (hour: ${hour}:00)
${locationContext}
${tasteContext}

Rules:
- Ideas must be appropriate for ${timeLabel} (e.g. don't suggest coffee at midnight, don't suggest bars at 8am)
- Must be specific and actionable — not vague like "go for a walk"
- Must match their taste profile
- If location is known, ideas should be relevant to that city/country
- One idea can be indoor, one outdoor (adjust based on time)
- Make them feel spontaneous and exciting, not boring

Reply ONLY with valid JSON, no markdown:
{
  "ideas": [
    {
      "emoji": "☕",
      "title": "Short catchy title (4-6 words)",
      "description": "2 sentences — what to do and why it's great right now at this time",
      "why": "One sentence: why this matches their taste",
      "searchQuery": "Google Maps search query to find this type of place nearby (e.g. 'specialty coffee Tel Aviv')"
    },
    {
      "emoji": "🍜",
      "title": "Second idea title",
      "description": "2 sentences description",
      "why": "Why it matches their taste",
      "searchQuery": "Google Maps search query"
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
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());

    res.json(result);
  } catch (err) {
    console.error('Right now error:', err);
    res.status(500).json({ error: 'Failed to get ideas' });
  }
});

/* ─────────────────────────────────────────
   POST /api/ai/event-discover
   Identity Cube event matching:
   Phase 2 (Search) + Phase 3 (Score) + Phase 4 (Timing)
───────────────────────────────────────── */
router.post('/event-discover', auth, async (req, res) => {
  try {
    const { locationStr, timeLabel, hour, dayOfWeek, dateStr, lat, lng } = req.body;

    // Load full Identity Cube from DB
    const User = require('../models/User');
    const user = await User.findById(req.userId).select('aiProfile feedbackLoop');
    const profile = user?.aiProfile;

    if (!profile?.analyzedAt)
      return res.status(400).json({ error: 'Build your AI profile first to use Event Discover.' });

    // ── PHASE 1: Build Identity Cube ──
    const aestheticTags  = profile.aestheticTags || profile.tags || [];
    const musicGenres    = profile.musicGenres || [];
    const eventGoal      = profile.eventGoal || '';
    const atmosphere     = profile.atmosphere || '';
    const soundVibe      = profile.soundVibe || '';
    const interests      = profile.tags || [];
    const summary        = profile.summary || '';
    const locations      = profile.locations || [];

    // Time context
    const now = new Date();
    const deadline48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    // ── PHASE 2+3+4: Claude with web_search finds AND scores events ──
    const prompt = `You are an elite personal concierge AI for a discerning traveler.

== IDENTITY CUBE ==
Visual Aesthetic Tags: ${aestheticTags.slice(0,8).join(', ')}
Personality Summary: "${summary}"
Interests & Hobbies: ${interests.join(', ')}
Music Genres: ${musicGenres.join(', ') || 'not specified'}
Event Mission: ${eventGoal || 'not specified'}
Atmosphere Preference: ${atmosphere || 'not specified'}
Sound/Audio Preference: ${soundVibe || 'not specified'}
Previously Visited: ${locations.join(', ')}

== CURRENT CONTEXT ==
Location: ${locationStr}
Date & Time: ${dateStr}, ${timeLabel} (${hour}:00), ${dayOfWeek}
Next 48h deadline: ${deadline48h.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'})}

== YOUR TASK ==
1. SEARCH the web for real events happening in ${locationStr} in the next 7 days. Look for:
   - Nightlife events, club nights, DJ sets matching their music taste
   - Networking events, business mixers (if Goal = Network)
   - Rooftop bars, lounges, fine dining (if Atmosphere = Top-Shelf)
   - Underground/boutique venues (if Atmosphere = Main Street)
   - Live music, concerts, acoustic sessions (based on Sound preference)
   Use search queries like: "events ${locationStr} this weekend", "${musicGenres[0]||'music'} event ${locationStr}", "nightlife ${locationStr} ${dayOfWeek}"

2. SCORE each found event against the Identity Cube (0-100%):
   - +30pts: matches their music genre
   - +25pts: matches their atmosphere preference (Top-Shelf/Electric/Main Street)  
   - +20pts: matches their event goal (Network/Vibe/Low-Key)
   - +15pts: matches sound preference (Background/Front&Center/Acoustic)
   - +10pts: matches aesthetic/vibe tags

3. TIMING RULE:
   - Events in next 48h: boost score by 1.5x (max 100%)
   - Events 3-7 days out: only include if score >= 95% (Unmissable tier)
   - Mark hoursUntil: approximate hours from now

4. Write a CONCIERGE NOTE for each — be specific and personal:
   Bad: "This event matches your music taste"
   Good: "Since you love Deep House and prefer high-end venues, this rooftop set by a Berlin-based DJ is exactly the sound + setting your profile signals — and it's only 6 hours away"

Return ONLY valid JSON, top 3 events after scoring and filtering:
{
  "events": [
    {
      "name": "Event name",
      "venueName": "Venue name",
      "date": "Sat 3 May",
      "time": "10pm",
      "price": "Free / ₪80 / etc",
      "matchScore": 94,
      "hoursUntil": 18,
      "tags": ["deep-house", "rooftop"],
      "conciergeNote": "Personal explanation referencing their specific profile",
      "ticketUrl": "url or empty string"
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
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    // Extract the final text response (after tool use)
    const textBlock = data.content?.filter(b => b.type === 'text').map(b => b.text).join('');
    if (!textBlock) return res.status(500).json({ error: 'No response from AI' });

    // Extract JSON robustly — find first { to last }
    const jsonMatch = textBlock.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'No events found in this area. Try again.' });
    const result = JSON.parse(jsonMatch[0]);

    // Apply timing boost on backend as safety
    if (result.events) {
      result.events = result.events.map(ev => {
        if (ev.hoursUntil !== undefined && ev.hoursUntil <= 48) {
          ev.matchScore = Math.min(100, Math.round(ev.matchScore * 1.5));
        }
        return ev;
      }).sort((a,b) => b.matchScore - a.matchScore).slice(0,3);
    }

    res.json(result);

  } catch (err) {
    console.error('Event discover error:', err);
    res.status(500).json({ error: 'Failed to discover events. Try again.' });
  }
});


/* ─────────────────────────────────────────
   GET /api/ai/photos
───────────────────────────────────────── */
router.get('/photos', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.userId).select('aiPhotos');
    res.json({ photos: user?.aiPhotos || [] });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

/* ─────────────────────────────────────────
   DELETE /api/ai/photo/:publicId
───────────────────────────────────────── */
router.delete('/photo/:publicId', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const cloudinary = require('cloudinary').v2;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const publicId = decodeURIComponent(req.params.publicId);
    try { await cloudinary.uploader.destroy(publicId); } catch {}
    user.aiPhotos = (user.aiPhotos || []).filter(p => p.publicId !== publicId);
    await user.save();
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});
/* ─────────────────────────────────────────
   POST /api/ai/preferences
   Save music + event preferences without re-analyzing photos
───────────────────────────────────────── */
router.post('/preferences', auth, async (req, res) => {
  try {
    const { music, goal, atmosphere, soundVibe } = req.body;
    const User = require('../models/User');
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (music?.length)    user.aiProfile.musicGenres = music;
    if (goal)             user.aiProfile.eventGoal   = goal;
    if (atmosphere)       user.aiProfile.atmosphere  = atmosphere;
    if (soundVibe)        user.aiProfile.soundVibe   = soundVibe;

    user.markModified('aiProfile');
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
