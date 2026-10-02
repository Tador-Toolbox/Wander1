// Israeli parties & nightlife from Go-Out (go-out.co) — same request the website makes.
// Response is base64-encoded JSON: { status, events:[{ _id, Title, StartingDate, EndingDate, Adress, EnglishAddress, EventType, MusicType, Url, CoverImageTimestamp }] }
const URL_ = 'https://www.go-out.co/endOne/getEventsByTypeNew?';
const HEADERS = {
  'content-type': 'application/json', origin: 'https://go-out.co', referer: 'https://go-out.co/',
  'accept-language': 'he-IL,he;q=0.9,en;q=0.8',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
};
const PAGE = 40, MAX_PAGES = 10, TTL = 30 * 60 * 1000;
let cache = { at: 0, events: [] };

// English ↔ Hebrew city names so "Tel Aviv" matches "תל אביב-יפו"
const CITY_ALIASES = {
  'tel aviv': ['tel aviv', 'תל אביב', 'tel-aviv', 'jaffa', 'יפו'], 'jerusalem': ['jerusalem', 'ירושלים'], 'haifa': ['haifa', 'חיפה'],
  'eilat': ['eilat', 'אילת'], 'ashkelon': ['ashkelon', 'אשקלון'], 'herzliya': ['herzliya', 'הרצליה'], 'beer sheva': ['beer sheva', "be'er sheva", 'באר שבע'],
  'rishon lezion': ['rishon', 'ראשון לציון'], 'netanya': ['netanya', 'נתניה'], 'ramat gan': ['ramat gan', 'רמת גן'], 'ashdod': ['ashdod', 'אשדוד']
};
function cityTerms(city) {
  const c = String(city || '').toLowerCase().split(',')[0].trim();
  for (const [k, v] of Object.entries(CITY_ALIASES)) if (v.some(a => c.includes(a)) || c.includes(k)) return v;
  return c ? [c] : [];
}
const isIsraelCity = city => /israel|ישראל/i.test(city) || Object.values(CITY_ALIASES).some(v => v.some(a => String(city).toLowerCase().includes(a)));

async function page(skip) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(URL_, { method: 'POST', headers: HEADERS, signal: ctrl.signal,
      body: JSON.stringify({ skip, Types: ['אירועים', 'מועדוני לילה'], limit: PAGE, recivedDate: new Date().toISOString(), location: 'IL' }) });
    if (!r.ok) { console.log('[goOut] status', r.status); return null; }
    const txt = (await r.text()).trim();
    const json = txt.startsWith('{') ? JSON.parse(txt) : JSON.parse(Buffer.from(txt, 'base64').toString('utf8'));
    return json.events || [];
  } catch (e) { console.log('[goOut] error', e.message); return null; }
  finally { clearTimeout(t); }
}

// All upcoming events (date-sorted), fetched until `until` (YYYY-MM-DD) or MAX_PAGES; cached 30 min
async function upcoming(until) {
  if (Date.now() - cache.at < TTL && cache.events.length && (cache.until || '') >= until) return cache.events;
  const all = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const evs = await page(i * PAGE);
    if (!evs || !evs.length) break;
    all.push(...evs);
    const last = evs[evs.length - 1].StartingDate || '';
    if (last.slice(0, 10) > until || evs.length < PAGE) break;
  }
  if (all.length) cache = { at: Date.now(), events: all, until };
  return all;
}

/** Events in an Israeli city between from/to (YYYY-MM-DD), same shape as the club listing */
async function cityEvents(city, from, to, limit = 15) {
  if (!isIsraelCity(city)) return [];
  const terms = cityTerms(city);
  const evs = await upcoming(to);
  const seen = new Set();
  return evs.filter(e => {
    const d = String(e.StartingDate || '').slice(0, 10);
    const addr = `${e.EnglishAddress || ''} ${e.Adress || ''}`.toLowerCase();
    const key = String(e.Title || '').trim().toLowerCase();
    if (d < from || d > to || seen.has(key)) return false;
    if (terms.length && !terms.some(t => addr.includes(t))) return false;
    seen.add(key); return true;
  }).slice(0, limit).map(e => ({
    title: String(e.Title || '').trim(),
    date: String(e.StartingDate).slice(0, 10),
    startTime: e.StartingDate,
    venue: (() => { const f = String(e.EnglishAddress || e.Adress || '').split(',')[0].trim(); return /\d|post box|^israel$/i.test(f) ? '' : f; })(),
    artists: [],
    music: e.MusicType || [],
    url: e.Url ? `https://www.go-out.co/event/${e.Url}` : '',
    image: e._id && e.CoverImageTimestamp ? `https://images.go-out.co/events/${e._id}${e.CoverImageTimestamp}_whatsappImage.jpg` : '',
    source: 'goout'
  }));
}

module.exports = { cityEvents, isIsraelCity };
