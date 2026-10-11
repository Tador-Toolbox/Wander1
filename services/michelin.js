// MICHELIN Guide restaurants — read from the guide's own search service (Algolia), the same one guide.michelin.com uses.
// Public search-only key taken from the site (HAR). Results are matched to Google for photos, hours and ratings.
const APP = '8NVHRD7ONV', KEY = '3222e669cf890dc73fa5f38241117ba5';
const URL = `https://${APP.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`;
const INDEXES = ['prod-restaurants-en', 'prod-restaurants-en_sort_geo', 'prod-restaurants'];
let goodIndex = null;
const DAY = 864e5, cache = new Map(), googleCache = new Map();

async function query(params) {
  const tries = goodIndex ? [goodIndex] : INDEXES;
  for (const indexName of tries) {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'x-algolia-api-key': KEY, 'x-algolia-application-id': APP, 'content-type': 'application/json', Origin: 'https://guide.michelin.com', Referer: 'https://guide.michelin.com/' },
      body: JSON.stringify({ requests: [{ indexName, ...params }] })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { console.log('[michelin]', indexName, r.status, (d.message || '').slice(0, 120)); continue; }
    const res = (d.results || [])[0] || {};
    if (!goodIndex) { goodIndex = indexName; const h = (res.hits || [])[0]; console.log('[michelin] using index', indexName, h ? 'fields: ' + Object.keys(h).join(',') : '(no hits)'); }
    return res.hits || [];
  }
  throw new Error('Michelin search unavailable');
}

// rank: 3/2/1 stars, 0.5 Bib Gourmand, 0 Selected
function award(h) {
  const t = JSON.stringify([h.michelin_award, h.distinction, h.award]).toLowerCase();
  if (/\bthree[\s_-]?stars?|3[\s_-]?stars?/.test(t)) return { rank: 3, label: '⭐⭐⭐ 3 stars' };
  if (/\btwo[\s_-]?stars?|2[\s_-]?stars?/.test(t)) return { rank: 2, label: '⭐⭐ 2 stars' };
  if (/\bone[\s_-]?stars?|1[\s_-]?stars?/.test(t)) return { rank: 1, label: '⭐ 1 star' };
  if (/bib/.test(t)) return { rank: 0.5, label: '😋 Bib Gourmand' };
  return { rank: 0, label: 'Regular restaurant' };
}
const lbl = x => (x && typeof x === 'object' ? (x.label || x.name || '') : (x || ''));

function shape(h) {
  const a = award(h), g = h._geoloc || {};
  const cuisines = (Array.isArray(h.cuisines) ? h.cuisines : []).map(lbl).filter(Boolean);
  const green = JSON.stringify(h.green_star || '').toLowerCase().includes('green') || h.green_star === true;
  return {
    id: h.objectID, name: h.name, lat: g.lat, lng: g.lng,
    rank: a.rank, award: a.label, green,
    cuisine: cuisines.slice(0, 2).join(', ') || lbl(h.cuisine_type),
    price: lbl(h.price_category) || (typeof h.price === 'string' ? h.price : ''),
    city: lbl(h.city),
    url: h.url ? (String(h.url).startsWith('http') ? h.url : 'https://guide.michelin.com' + h.url) : '',
    photo: (h.main_image && h.main_image.url) || ''
  };
}

async function google(r, key) {
  if (googleCache.has(r.id)) return Object.assign(r, googleCache.get(r.id));
  try {
    const u = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(r.name + ' ' + (r.city || ''))}&location=${r.lat},${r.lng}&radius=300&key=${key}`;
    const d = await (await fetch(u)).json();
    const hit = (d.results || []).find(x => Math.abs(x.geometry.location.lat - r.lat) < 0.005 && Math.abs(x.geometry.location.lng - r.lng) < 0.005);
    const g = hit ? { placeId: hit.place_id, address: hit.formatted_address || '', rating: hit.rating || null, reviews: hit.user_ratings_total || 0, closed: hit.business_status === 'CLOSED_PERMANENTLY' } : {};
    googleCache.set(r.id, g);
    return Object.assign(r, g);
  } catch { return r; }
}

/** restaurants around a point. radiusM: search radius. */
async function around(lat, lng, radiusM) {
  const k = `${lat.toFixed(3)},${lng.toFixed(3)},${radiusM}`;
  const c = cache.get(k);
  if (c && Date.now() - c.at < DAY) return c.list;
  const hits = await query({ query: '', aroundLatLng: `${lat},${lng}`, aroundRadius: radiusM, hitsPerPage: 300 });
  const list = hits.map(shape).filter(r => r.name && r.lat != null);
  cache.set(k, { at: Date.now(), list });
  return list;
}

module.exports = { around, google };
