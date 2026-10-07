// Shared "is this a real, open, correct place?" check used by every V2 AI feature.
// Combines the accuracy rules from the first Wander version:
// blacklist → quoted Google search → name match → web-search fallback (closure / real name)
// → business_status → wrong-type check → nightlife check (incl. club listing) → open-that-day check.
const vc = require('./venueCapacity');

const GOOGLE = 'https://maps.googleapis.com/maps/api/place';
const WRONG_TYPES = ['gym', 'sports_complex', 'health', 'fitness_center', 'stadium', 'storage', 'car_repair', 'car_dealer', 'real_estate_agency', 'insurance_agency', 'lawyer', 'accounting', 'dentist', 'doctor', 'hospital'];
const NIGHT_RE = /club|techno|party|disco|\bdj\b|nightlife|rave|dance floor|trance|house music/i;
const STOP = ['the', 'bar', 'club', 'cafe', 'restaurant', 'tlv', 'tel', 'aviv', 'and'];

// Greek → Latin so "ΚΛΑΚΑΖ" matches "Klakaz"
const GREEK = { α:'a',β:'v',γ:'g',δ:'d',ε:'e',ζ:'z',η:'i',θ:'th',ι:'i',κ:'k',λ:'l',μ:'m',ν:'n',ξ:'x',ο:'o',π:'p',ρ:'r',σ:'s',ς:'s',τ:'t',υ:'y',φ:'f',χ:'ch',ψ:'ps',ω:'o',ά:'a',έ:'e',ή:'i',ί:'i',ό:'o',ύ:'y',ώ:'o',ϊ:'i',ϋ:'y' };
const latin = n => String(n || '').toLowerCase().normalize('NFC').replace(/[α-ωάέήίόύώϊϋς]/g, c => GREEK[c] || c);
const squash = n => latin(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\u0590-\u05ff]/g, '');
const tokens = n => latin(n).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9֐-׿ㄱ-힝 ]+/g, ' ').split(/\s+/).filter(t => t.length > 2 && !STOP.includes(t));
function sameName(a, b) {
  // "IT Athens" vs "ITAthens", "Kíkí" vs "Kiki": compare with spaces/accents removed
  const sa = squash(a), sb = squash(b);
  if (sa && sb && (sa === sb || (sa.length > 4 && sb.includes(sa)) || (sb.length > 4 && sa.includes(sb)))) return true;
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return String(a).toLowerCase().trim() === String(b).toLowerCase().trim();
  return A.some(t => B.includes(t) || B.some(u => (t.length > 4 && u.startsWith(t)) || (u.length > 4 && t.startsWith(u))));
}

async function getJSON(url, ms = 7000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  try { const r = await fetch(url, { signal: ctrl.signal }); return await r.json(); }
  catch { return {}; } finally { clearTimeout(t); }
}
const textSearch = (q, key, c) => getJSON(`${GOOGLE}/textsearch/json?query=${encodeURIComponent(q)}${c ? `&location=${c.lat},${c.lng}&radius=40000` : ''}&key=${key}`).then(d => d.results || []);

// City centre (cached) — results must be near the trip city (e.g. "Wagyu House" in Athens ≠ Houston)
const cityCache = new Map();
async function cityCenter(city, key) {
  const k = String(city || '').toLowerCase().trim();
  if (!k) return null;
  if (cityCache.has(k)) return cityCache.get(k);
  const d = await getJSON(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(city)}&key=${key}`);
  let loc = d?.results?.[0]?.geometry?.location || null;
  if (!loc) {
    // Geocoding API may be off for this key — fall back to Places text search (always on)
    if (d?.status && d.status !== 'OK') console.log('[verifyPlace] geocode', d.status, '→ using Places for', city);
    const t = await getJSON(`${GOOGLE}/textsearch/json?query=${encodeURIComponent(city)}&key=${key}`);
    loc = t?.results?.[0]?.geometry?.location || null;
  }
  cityCache.set(k, loc);
  return loc;
}
function km(a, b) {
  const R = 6371, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const MAX_KM = 80;
const details = (id, key) => getJSON(`${GOOGLE}/details/json?place_id=${id}&fields=name,formatted_address,geometry,business_status,types,opening_hours,place_id,website,url&key=${key}`).then(d => d.result || null);

// Gemini with Google Search grounding: is it closed, and what is it called on Google Maps?
async function webCheck(name, city) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Search the web: is "${name}" in ${city} currently operating or permanently closed? Look for closure news and recent reviews. Reply ONLY as: STATUS|NAME where STATUS is OPEN, CLOSED or UNKNOWN and NAME is its exact current name on Google Maps (or - if unknown).` }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0, maxOutputTokens: 512 }
      })
    }).finally(() => clearTimeout(t));
    const d = await r.json();
    const txt = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    const line = (txt.split('\n').find(l => l.includes('|')) || txt).trim();
    const [st, nm] = line.split('|').map(s => (s || '').trim());
    const status = /CLOSED/i.test(st) ? 'CLOSED' : /OPEN/i.test(st) ? 'OPEN' : 'UNKNOWN';
    return { status, name: nm && nm !== '-' ? nm : '' };
  } catch (e) { console.log('[verifyPlace] web check error', e.message); return null; }
}

function openOnDate(d, date) {
  const periods = d.opening_hours?.periods;
  if (!date || !periods || !periods.length) return true;      // unknown hours → don't block
  if (periods.length === 1 && !periods[0].close) return true;  // open 24/7
  const day = new Date(date + 'T12:00:00').getDay();
  return periods.some(p => p.open?.day === day);
}

/**
 * @param {object} o { name, city, why?, date?: 'YYYY-MM-DD', night?: bool, closed?: string[] }
 * @returns {Promise<{ok:boolean, reason?:string, place?:object}>}
 */
async function verifyPlace(o) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const { name, city = '' } = o;
  if (!name) return { ok: false, reason: 'no name' };
  if ((o.closed || []).some(n => sameName(n, name))) return { ok: false, reason: 'blacklisted (closed)' };
  if (!key) return { ok: false, reason: 'no maps key' };

  // 1. quoted search for an exact match, then plain search — biased to the city and within MAX_KM of it
  const center = await cityCenter(city, key);
  const near = c => !center || !c.geometry?.location || km(center, c.geometry.location) <= MAX_KM;
  let cands = await textSearch(`"${name}" ${city}`, key, center);
  let hit = cands.find(c => sameName(name, c.name) && near(c));
  if (!hit) { cands = await textSearch(`${name} ${city}`, key, center); hit = cands.find(c => sameName(name, c.name) && near(c)); }

  // 2. not found / name mismatch → web search: closed? real current name?
  let web = null;
  if (!hit) {
    web = await webCheck(name, city);
    if (web?.status === 'CLOSED') return { ok: false, reason: 'web: permanently closed' };
    if (web?.name) {
      const re = await textSearch(`"${web.name}" ${city}`, key, center);
      hit = re.find(c => sameName(web.name, c.name) && near(c)) || null;
    }
    if (!hit) {
      const far = cands.find(c => sameName(name, c.name) && !near(c));
      return { ok: false, reason: far ? `only found far away: "${far.name}", ${far.formatted_address || ''}` : `not found on Google (got "${cands[0]?.name || '-'}")` };
    }
  }

  const d = await details(hit.place_id, key) || hit;
  const status = d.business_status || hit.business_status;
  if (status === 'CLOSED_PERMANENTLY' || d.permanently_closed || hit.permanently_closed) return { ok: false, reason: 'Google: permanently closed' };
  if (status === 'CLOSED_TEMPORARILY') return { ok: false, reason: 'Google: temporarily closed' };
  // No opening hours on Google is a common sign of a dead listing → double-check on the web
  if (!d.opening_hours && !web) {
    web = await webCheck(d.name, city);
    if (web?.status === 'CLOSED') return { ok: false, reason: 'no hours on Google + web: closed' };
  }
  if ((o.closed || []).some(n => sameName(n, d.name))) return { ok: false, reason: 'blacklisted (closed)' };

  const types = d.types || hit.types || [];
  const night = o.night || NIGHT_RE.test(`${name} ${o.why || ''}`);
  if (WRONG_TYPES.some(t => types.includes(t)) && !types.includes('night_club') && !types.includes('bar'))
    return { ok: false, reason: `wrong type (${types.slice(0, 3).join(',')})` };
  if (night) {
    const listed = await vc.getVenueInfo(d.name, city, null).catch(() => null);
    if (listed?.isClosed) return { ok: false, reason: 'club listing: closed' };
    if (!types.includes('night_club') && !types.includes('bar') && !listed?.raId)
      return { ok: false, reason: `not a nightlife venue (${types.slice(0, 3).join(',')})` };
  }
  if (!night && !openOnDate(d, o.date)) return { ok: false, reason: `closed on ${o.date}` };

  const loc = d.geometry?.location || hit.geometry?.location;
  return {
    ok: true,
    place: { name: d.name, address: d.formatted_address || hit.formatted_address || '', lat: loc.lat, lng: loc.lng, placeId: d.place_id || hit.place_id, types, website: d.website || '' },
    webChecked: !!web
  };
}

// Photo scan: is this AI-read name a real, open place right where the photo was taken?
async function verifyNear(o) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  // With GPS: must be within 1 km of the photo. Without GPS: within MAX_KM of the city the AI recognised.
  const { name } = o;
  if (!name || !key) return { ok: false, reason: 'missing data' };
  if ((o.closed || []).some(n => sameName(n, name))) return { ok: false, reason: 'blacklisted (closed)' };
  let here = o.lat != null ? { lat: +o.lat, lng: +o.lng } : null, maxKm = 1, radius = 500, extra = '';
  if (!here) {
    // No GPS: use the address/city read from the photo (e.g. an Instagram caption) to bias the search
    const hint = [o.address, o.city].filter(Boolean).join(' ');
    here = hint ? (await cityCenter(o.address && o.city ? `${o.address}, ${o.city}` : hint, key)) || (o.city ? await cityCenter(o.city, key) : null) : null;
    maxKm = here ? MAX_KM : Infinity; radius = 40000; extra = o.city ? ` ${o.city}` : '';
  }
  const search = q => getJSON(`${GOOGLE}/textsearch/json?query=${encodeURIComponent(q)}${here ? `&location=${here.lat},${here.lng}&radius=${radius}` : ''}&key=${key}`).then(d => d.results || []);
  const close = c => c.geometry?.location && (!here || km(here, c.geometry.location) <= maxKm);
  let cands = await search(`"${name}"${extra}`);
  let hit = cands.find(c => sameName(name, c.name) && close(c));
  if (!hit) { cands = await search(name + extra); hit = cands.find(c => sameName(name, c.name) && close(c)); }
  if (!hit) return { ok: false, reason: `not found within ${maxKm} km (got "${cands[0]?.name || '-'}")` };
  const d = await details(hit.place_id, key) || hit;
  const status = d.business_status || hit.business_status;
  if (status === 'CLOSED_PERMANENTLY' || d.permanently_closed) return { ok: false, reason: 'Google: permanently closed' };
  if (status === 'CLOSED_TEMPORARILY') return { ok: false, reason: 'Google: temporarily closed' };
  if ((o.closed || []).some(n => sameName(n, d.name))) return { ok: false, reason: 'blacklisted (closed)' };
  const loc = d.geometry?.location || hit.geometry?.location;
  return { ok: true, place: { name: d.name, address: d.formatted_address || hit.formatted_address || '', lat: loc.lat, lng: loc.lng, placeId: d.place_id || hit.place_id, types: d.types || [], distM: here ? Math.round(km(here, loc) * 1000) : null } };
}

async function closedList(city) {
  try {
    const VenueBlacklist = require('../models/VenueBlacklist');
    const c = String(city || '').toLowerCase().split(',')[0].trim();
    return (await VenueBlacklist.find({}).lean())
      .filter(v => !v.city || !c || String(v.city).toLowerCase().includes(c) || c.includes(String(v.city).toLowerCase()))
      .map(v => v.venueName);
  } catch { return []; }
}

module.exports = { cityCenter, verifyPlace, verifyNear, closedList, sameName, openOnDate };
