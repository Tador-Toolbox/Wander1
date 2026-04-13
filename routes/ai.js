const router = require('express').Router();
const auth   = require('../middleware/auth');
const Trip   = require('../models/Trip');
const Place  = require('../models/Place');

// POST /api/ai/trip-plan/:tripId
router.post('/trip-plan/:tripId', auth, async (req, res) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.tripId, user: req.userId });
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    const places = await Place.find({ trip: req.params.tripId, user: req.userId })
      .select('name location address lat lng tags notes rating');

    if (!places.length) return res.status(400).json({ error: 'No places in this trip' });

    const days = Math.max(1, Math.ceil(places.length / 4));

    const placesText = places.map((p, i) => {
      const loc  = p.location || p.address || '';
      const tags = p.tags?.length ? ` [${p.tags.join(', ')}]` : '';
      const note = p.notes ? ` (note: ${p.notes})` : '';
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

module.exports = router;
