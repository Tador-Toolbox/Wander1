// European Coffee Trip (europeancoffeetrip.com) — specialty cafés per European city.
// The city page (e.g. /athens/) lists the guide's cafés as links to /cafe/<slug>/ with an <h3> name.
// We read that list once per city, find each café on Google (location, rating), and cache it for 7 days.
const CoffeeGuide = require('../models/CoffeeGuide');
const BASE = 'https://europeancoffeetrip.com';
const WEEK = 7 * 86400000;

const slugCity = c => String(c || '').split(',')[0].trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const decode = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&#8211;/g, '–').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function fetchList(slug) {
  const r = await fetch(`${BASE}/${slug}/`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept-Language': 'en' } });
  if (r.status === 404) return null;
  if (!r.ok) { console.log(`[coffeeTrip] ${slug}: guide page HTTP ${r.status}`); return []; }
  const html = await r.text();
  const out = [], seen = new Set();
  const re = /href="(?:https?:\/\/europeancoffeetrip\.com)?\/cafe\/([a-z0-9-]+)\/?"/gi;
  let m;
  while ((m = re.exec(html))) {
    const slugC = m[1];
    if (seen.has(slugC)) continue;
    const after = html.slice(m.index, m.index + 2500);
    const h = after.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i);
    const name = h ? decode(h[1]) : '';
    if (!name || name.length > 80) continue;
    seen.add(slugC);
    const win = after.slice(0, 1500).match(/(20\d\d)\s*WINNER/i);
    out.push({ name, slug: slugC, url: `${BASE}/cafe/${slugC}/`, winner: win ? win[1] : '', rank: out.length + 1 });
  }
  console.log(`[coffeeTrip] ${slug}: ${out.length} cafés on the guide page`);
  return out;
}

// Fallback when the site blocks our server or the page layout changed: ask Gemini (with Google Search) for the guide's cafés
async function listViaWeb(cityName, slug) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return [];
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: `Search the web for the European Coffee Trip city guide for ${cityName} (${BASE}/${slug}/). List the specialty cafés featured in that guide, best first (up to 30). Mark award winners with the year. Reply ONLY JSON: [{"name":"exact café name","winner":"2024 or empty"}]. If there is no guide for this city reply [].` }] }],
        tools: [{ googleSearch: {} }], generationConfig: { temperature: 0, maxOutputTokens: 4000 } })
    });
    const d = await r.json();
    const txt = (d.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('');
    const arr = JSON.parse((txt.match(/\[[\s\S]*\]/) || ['[]'])[0]);
    const out = (Array.isArray(arr) ? arr : []).filter(x => x && x.name).slice(0, 30)
      .map((x, i) => ({ name: String(x.name).slice(0, 80), slug: '', url: `${BASE}/${slug}/`, winner: String(x.winner || '').slice(0, 4), rank: i + 1 }));
    console.log(`[coffeeTrip] ${slug}: ${out.length} cafés via web search`);
    return out;
  } catch (e) { console.log('[coffeeTrip] web fallback error', e.message); return []; }
}

async function resolve(cafes, city, key) {
  const get = async u => { try { return await (await fetch(u)).json(); } catch { return {}; } };
  let next = 0;
  const one = async c => {
    const d = await get(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(c.name + ' ' + city)}&key=${key}`);
    const hit = (d.results || [])[0];
    if (hit && hit.business_status !== 'CLOSED_PERMANENTLY') Object.assign(c, { placeId: hit.place_id, address: hit.formatted_address || '', lat: hit.geometry.location.lat, lng: hit.geometry.location.lng, rating: hit.rating || null, reviews: hit.user_ratings_total || 0 });
  };
  await Promise.all(Array.from({ length: 8 }, async () => { while (next < cafes.length) await one(cafes[next++]); }));
  return cafes.filter(c => c.lat != null);
}

/** city name (English) → { city, found, cafes[] } */
async function cityGuide(cityName) {
  const slug = slugCity(cityName);
  if (!slug) return { city: '', found: false, cafes: [] };
  const cached = await CoffeeGuide.findOne({ city: slug }).lean().catch(() => null);
  if (cached && cached.ver === 2 && Date.now() - new Date(cached.fetchedAt).getTime() < WEEK) return cached; // older entries may be wrong 'not found'
  let list = await fetchList(slug).catch(e => { console.log('[coffeeTrip] fetch error', e.message); return []; });
  if (list === null) { // 404 = the guide has no page for this city
    await CoffeeGuide.updateOne({ city: slug }, { city: slug, found: false, cafes: [], ver: 2, fetchedAt: new Date() }, { upsert: true });
    return { city: slug, found: false, cafes: [] };
  }
  if (!list.length) list = await listViaWeb(cityName, slug);
  if (!list.length) return { city: slug, found: false, cafes: [], error: 'Could not read the guide right now' }; // not cached — try again later
  const cafes = await resolve(list.slice(0, 60), cityName, process.env.GOOGLE_MAPS_API_KEY);
  await CoffeeGuide.updateOne({ city: slug }, { city: slug, found: true, cafes, ver: 2, fetchedAt: new Date() }, { upsert: true });
  console.log(`[coffeeTrip] ${slug}: ${cafes.length} cafés found on Google`);
  return { city: slug, found: true, cafes };
}

module.exports = { cityGuide, slugCity };
