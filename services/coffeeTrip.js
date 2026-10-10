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
  if (!r.ok) throw new Error('guide page ' + r.status);
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
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < WEEK) return cached;
  const list = await fetchList(slug);
  if (!list || !list.length) {
    await CoffeeGuide.updateOne({ city: slug }, { city: slug, found: false, cafes: [], fetchedAt: new Date() }, { upsert: true });
    return { city: slug, found: false, cafes: [] };
  }
  const cafes = await resolve(list.slice(0, 60), cityName, process.env.GOOGLE_MAPS_API_KEY);
  await CoffeeGuide.updateOne({ city: slug }, { city: slug, found: true, cafes, fetchedAt: new Date() }, { upsert: true });
  console.log(`[coffeeTrip] ${slug}: ${cafes.length} cafés found on Google`);
  return { city: slug, found: true, cafes };
}

module.exports = { cityGuide, slugCity };
