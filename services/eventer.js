// Israeli parties from Eventer (eventer.co.il) — static category feeds the site loads:
// GET /sliders/categories/<category>/events.js  → base64 JSON { slides:[{ title, subTitle:"DD.MM.YYYY HH:MM | venue, city, ישראל", url, images }] }
const BASE = 'https://www.eventer.co.il';
const CATEGORIES = ['tel_aviv_nights', 'tel_aviv_nightlife', 'parties', 'party', 'north_nightlife', 'weekend_events_guide'];
const HEADERS = { referer: BASE + '/', 'accept-language': 'he-IL,he;q=0.9,en;q=0.8',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
const TTL = 30 * 60 * 1000;
let cache = { at: 0, events: [] };

const CITY_ALIASES = {
  'tel aviv': ['tel aviv', 'תל אביב', 'tel-aviv', 'jaffa', 'יפו'], 'jerusalem': ['jerusalem', 'ירושלים'], 'haifa': ['haifa', 'חיפה'],
  'eilat': ['eilat', 'אילת'], 'ashkelon': ['ashkelon', 'אשקלון'], 'herzliya': ['herzliya', 'הרצליה'], 'beer sheva': ['beer sheva', "be'er sheva", 'באר שבע'],
  'rishon lezion': ['rishon', 'ראשון לציון'], 'netanya': ['netanya', 'נתניה'], 'ramat gan': ['ramat gan', 'רמת גן'], 'ashdod': ['ashdod', 'אשדוד'], 'caesarea': ['caesarea', 'קיסריה']
};
function cityTerms(city) {
  const c = String(city || '').toLowerCase().split(',')[0].trim();
  for (const [k, v] of Object.entries(CITY_ALIASES)) if (v.some(a => c.includes(a)) || c.includes(k)) return v;
  return c ? [c] : [];
}
const isIsraelCity = city => /israel|ישראל/i.test(city) || Object.values(CITY_ALIASES).some(v => v.some(a => String(city).toLowerCase().includes(a)));

async function category(name) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${BASE}/sliders/categories/${name}/events.js`, { headers: HEADERS, signal: ctrl.signal });
    if (!r.ok) { console.log('[eventer]', name, 'status', r.status); return []; }
    const txt = (await r.text()).trim();
    const json = txt.startsWith('{') ? JSON.parse(txt) : JSON.parse(Buffer.from(txt, 'base64').toString('utf8'));
    return json.slides || [];
  } catch (e) { console.log('[eventer]', name, 'error', e.message); return []; }
  finally { clearTimeout(t); }
}

function parse(s) {
  // "08.10.2026 22:30 | Moonchild - מון צ'ילד, Tel Aviv-Yafo, ישראל"
  const [when = '', where = ''] = String(s.subTitle || '').split('|').map(x => x.trim());
  const m = when.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const time = m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : '';
  const venue = where.split(',')[0].trim();
  return {
    title: String(s.title || '').replace(/\s+/g, ' ').trim(), date, startTime: time ? `${date}T${time}:00` : date,
    venue: /\d|ישראל$/.test(venue) ? '' : venue, address: where, artists: [],
    url: s.url ? (s.url.startsWith('http') ? s.url : BASE + s.url) : '',
    image: s.images?.imageDefault || '', source: 'eventer'
  };
}

async function all() {
  if (Date.now() - cache.at < TTL && cache.events.length) return cache.events;
  const lists = await Promise.all(CATEGORIES.map(category));
  const seen = new Set(), events = [];
  lists.flat().forEach(s => { const e = parse(s); if (!e) return; const k = e.url || e.title + e.date; if (seen.has(k)) return; seen.add(k); events.push(e); });
  console.log(`[eventer] loaded ${events.length} events from ${lists.map((l, i) => CATEGORIES[i] + ':' + l.length).join(', ')}`);
  if (events.length) cache = { at: Date.now(), events };
  return events;
}

/** Parties in an Israeli city between from/to (YYYY-MM-DD) */
async function cityEvents(city, from, to, limit = 20) {
  if (!isIsraelCity(city)) return [];
  const terms = cityTerms(city);
  const evs = await all();
  const out = evs.filter(e => e.date >= from && e.date <= to && (!terms.length || terms.some(t => e.address.toLowerCase().includes(t))))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  console.log(`[eventer] ${city} ${from}..${to}: ${out.length} events`);
  return out.slice(0, limit);
}

module.exports = { cityEvents, isIsraelCity };
