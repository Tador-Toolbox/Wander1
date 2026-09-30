// Venue capacity lookup: external listing first, AI estimate as fallback, cached in DB.
const VenueInfo = require('../models/VenueInfo');

const RA_URL = 'https://ra.co/graphql';
const HEADERS = {
  'content-type': 'application/json',
  'origin': 'https://ra.co',
  'referer': 'https://ra.co/',
  'ra-content-language': 'en',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
};
const REFRESH_MS = 60 * 24 * 3600 * 1000; // re-check external data every 60 days

async function gql(body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(RA_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok) { console.log('[venueCapacity] RA status', r.status); return null; }
    return await r.json();
  } catch (e) { console.log('[venueCapacity] RA error', e.message); return null; }
  finally { clearTimeout(t); }
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9֐-׿]+/g, ' ').trim();

async function lookupRA(name, city) {
  const s = await gql({
    operationName: 'GET_GLOBAL_SEARCH_RESULTS',
    variables: { searchTerm: name, indices: ['CLUB'] },
    query: 'query GET_GLOBAL_SEARCH_RESULTS($searchTerm: String!, $indices: [IndexType!]) { search(searchTerm: $searchTerm, limit: 10, indices: $indices, includeNonLive: false) { searchType id value areaName countryName } }'
  });
  const clubs = (s?.data?.search || []).filter(x => x.searchType === 'CLUB');
  if (!clubs.length) return null;
  const n = norm(name), c = norm(city).split(' ')[0];
  const pick = clubs.find(x => norm(x.value) === n && (!c || norm(x.areaName + ' ' + x.countryName).includes(c)))
            || clubs.find(x => norm(x.value).includes(n) && (!c || norm(x.areaName + ' ' + x.countryName).includes(c)));
  if (!pick) return null;
  const v = await gql({
    operationName: 'GET_VENUE',
    variables: { id: String(pick.id) },
    query: 'query GET_VENUE($id: ID!) { venue(id: $id) { id name capacity isClosed } }'
  });
  const venue = v?.data?.venue;
  if (!venue) return null;
  const cap = parseInt(String(venue.capacity || '').replace(/[^0-9]/g, ''), 10);
  return { raId: String(venue.id), capacity: cap > 0 ? cap : null, isClosed: !!venue.isClosed };
}

// Returns { capacity, source: 'sources'|'ai', isClosed } or null
async function getCapacity(name, city, aiEstimate) {
  if (!name) return null;
  const key = norm(name) + '|' + norm(city);
  let doc = await VenueInfo.findOne({ key }).catch(() => null);
  const fresh = doc && (doc.source === 'sources' ? Date.now() - doc.checkedAt < REFRESH_MS : Date.now() - doc.checkedAt < 7 * 24 * 3600 * 1000);
  if (doc && fresh) return { capacity: doc.capacity, source: doc.source, isClosed: doc.isClosed };

  const ra = await lookupRA(name, city);
  const update = { key, name, city, checkedAt: new Date() };
  if (ra && ra.capacity) {
    Object.assign(update, { raId: ra.raId, capacity: ra.capacity, source: 'sources', isClosed: ra.isClosed });
  } else if (doc && doc.capacity) {
    Object.assign(update, { isClosed: ra ? ra.isClosed : doc.isClosed }); // keep the first AI number
  } else if (aiEstimate) {
    Object.assign(update, { capacity: Number(aiEstimate) || null, source: 'ai', isClosed: ra ? ra.isClosed : undefined });
  } else {
    return null;
  }
  doc = await VenueInfo.findOneAndUpdate({ key }, update, { upsert: true, new: true }).catch(() => null);
  return doc ? { capacity: doc.capacity, source: doc.source, isClosed: doc.isClosed } : null;
}

// Mutates events: sets estimatedCapacity + capacitySource
async function enrichEvents(events, city) {
  await Promise.all((events || []).map(async ev => {
    try {
      const r = await getCapacity(ev.venueName || ev.name, city, ev.estimatedCapacity);
      if (r && r.capacity) { ev.estimatedCapacity = r.capacity; ev.capacitySource = r.source; }
      else if (ev.estimatedCapacity) ev.capacitySource = 'ai';
      if (r && r.isClosed) ev.listedClosed = true;
    } catch (e) { console.log('[venueCapacity] enrich error', e.message); }
  }));
}

module.exports = { getCapacity, enrichEvents };
