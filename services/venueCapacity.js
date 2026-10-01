// Venue enrichment from an external club listing (RA): capacity, closed flag,
// website, phone, Instagram (found on the venue website) and the next listed event.
// Results are cached per venue in MongoDB so numbers stay consistent.
const VenueInfo = require('../models/VenueInfo');

const RA_URL = 'https://ra.co/graphql';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const HEADERS = { 'content-type': 'application/json', origin: 'https://ra.co', referer: 'https://ra.co/', 'ra-content-language': 'en', 'user-agent': UA };
const LOOKUP_VER = 4;                       // bump to force re-check of cached entries
const DAY = 24 * 3600 * 1000;
const VENUE_TTL = 60 * DAY;                 // capacity / website / closed flag
const AI_ONLY_TTL = 7 * DAY;                // venues not found externally
const EVENTS_TTL = 0.5 * DAY;               // upcoming events change often

async function timedFetch(url, opts, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function gql(body) {
  try {
    const r = await timedFetch(RA_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
    if (!r.ok) { console.log('[venueCapacity] RA status', r.status, body.operationName); return null; }
    return await r.json();
  } catch (e) { console.log('[venueCapacity] RA error', body.operationName, e.message); return null; }
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9֐-׿]+/g, ' ').trim();

async function findVenueId(name, city) {
  const s = await gql({
    operationName: 'GET_GLOBAL_SEARCH_RESULTS',
    variables: { searchTerm: name, indices: ['CLUB'] },
    query: 'query GET_GLOBAL_SEARCH_RESULTS($searchTerm: String!, $indices: [IndexType!]) { search(searchTerm: $searchTerm, limit: 16, indices: $indices, includeNonLive: false) { searchType id value areaName countryName } }'
  });
  const clubs = (s?.data?.search || []).filter(x => x.searchType === 'VENUE' || x.searchType === 'CLUB');
  const n = norm(name), c = norm(city).split(' ')[0];
  const inCity = x => !c || norm((x.areaName || '') + ' ' + (x.countryName || '')).includes(c);
  const pick = clubs.find(x => norm(x.value) === n && inCity(x)) || clubs.find(x => norm(x.value).includes(n) && inCity(x));
  return pick ? String(pick.id) : null;
}

async function getVenue(id) {
  const v = await gql({
    operationName: 'GET_VENUE',
    variables: { id },
    query: 'query GET_VENUE($id: ID!) { venue(id: $id) { id name capacity isClosed website phone } }'
  });
  return v?.data?.venue || null;
}

async function getNextEvent(id) {
  const from = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const f = [{ type: 'CLUB', value: id }, { type: 'DATERANGE', value: JSON.stringify({ gte: from }) }];
  const r = await gql({
    operationName: 'GET_DEFAULT_EVENTS_LISTING',
    variables: { indices: ['EVENT'], pageSize: 3, page: 1, filters: f, sortOrder: 'ASCENDING', sortField: 'DATE' },
    query: 'query GET_DEFAULT_EVENTS_LISTING($indices: [IndexType!], $filters: [FilterInput], $pageSize: Int, $page: Int, $sortField: FilterSortFieldType, $sortOrder: FilterSortOrderType) { listing(indices: $indices, aggregations: [], filters: $filters, pageSize: $pageSize, page: $page, sortField: $sortField, sortOrder: $sortOrder) { data { ... on Event { id title date startTime contentUrl } } totalResults } }'
  });
  const ev = (r?.data?.listing?.data || [])[0];
  if (!ev) return null;
  return { title: ev.title, date: ev.date, startTime: ev.startTime, url: ev.contentUrl ? 'https://ra.co' + ev.contentUrl : '' };
}

const IG_SKIP = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'about', 'legal', 'developer', 'direct', 'resident_advisor', 'instagram', 'share', 'sharer']);
async function instagramFromWebsite(url) {
  if (!url) return '';
  try {
    if (/instagram\.com\//i.test(url)) {
      const m = url.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
      return m && !IG_SKIP.has(m[1].toLowerCase()) ? m[1] : '';
    }
    const r = await timedFetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' }, 6000);
    if (!r.ok) return '';
    const html = (await r.text()).slice(0, 800000);
    const counts = {};
    for (const m of html.matchAll(/instagram\.com\/([A-Za-z0-9_.]{2,30})/gi)) {
      const h = m[1].replace(/\.$/, '');
      if (!IG_SKIP.has(h.toLowerCase())) counts[h] = (counts[h] || 0) + 1;
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
  } catch (e) { console.log('[venueCapacity] website error', url, e.message); return ''; }
}

async function googleTypes(name, city) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return [];
  try {
    const r = await timedFetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(name + ' ' + (city || ''))}&key=${key}`, {});
    const d = await r.json();
    return (d.results && d.results[0] && d.results[0].types) || [];
  } catch (e) { console.log('[venueCapacity] google types error', e.message); return []; }
}

// Returns cached/fresh venue info (or null)
async function getVenueInfo(name, city, aiEstimate) {
  if (!name) return null;
  const key = norm(name) + '|' + norm(city);
  let doc = await VenueInfo.findOne({ key }).catch(() => null);
  const age = doc ? Date.now() - new Date(doc.checkedAt).getTime() : Infinity;
  const fresh = doc && doc.lookupVer === LOOKUP_VER && age < (doc.raId ? VENUE_TTL : AI_ONLY_TTL);

  const update = {};
  if (!fresh) {
    Object.assign(update, { key, name, city, checkedAt: new Date(), lookupVer: LOOKUP_VER });
    const id = await findVenueId(name, city);
    const v = id ? await getVenue(id) : null;
    if (v) {
      const cap = parseInt(String(v.capacity || '').replace(/[^0-9]/g, ''), 10);
      Object.assign(update, { raId: id, isClosed: !!v.isClosed, website: v.website || '', phone: v.phone || '' });
      if (cap > 0) Object.assign(update, { capacity: cap, source: 'sources' });
      update.instagram = await instagramFromWebsite(v.website);
    }
    update.googleTypes = await googleTypes(name, city);
    if (!update.capacity && !(doc && doc.capacity) && aiEstimate) Object.assign(update, { capacity: Number(aiEstimate) || null, source: 'ai' });
  }
  const raId = update.raId || (doc && doc.raId);
  const evAge = doc && doc.eventsCheckedAt ? Date.now() - new Date(doc.eventsCheckedAt).getTime() : Infinity;
  if (raId && (!fresh || evAge > EVENTS_TTL)) {
    update.nextEvent = await getNextEvent(raId);
    update.eventsCheckedAt = new Date();
  }
  if (Object.keys(update).length) {
    doc = await VenueInfo.findOneAndUpdate({ key }, { $set: { key, ...update } }, { upsert: true, new: true }).catch(e => { console.log('[venueCapacity] db', e.message); return doc; });
  }
  return doc;
}

// Mutates events in place; returns events with venues listed as closed removed
async function enrichEvents(events, city) {
  await Promise.all((events || []).map(async ev => {
    try {
      const d = await getVenueInfo(ev.venueName || ev.name, city, ev.estimatedCapacity);
      if (!d) { if (ev.estimatedCapacity) ev.capacitySource = 'ai'; return; }
      if (d.capacity) { ev.estimatedCapacity = d.capacity; ev.capacitySource = d.source || 'ai'; }
      else if (ev.estimatedCapacity) ev.capacitySource = 'ai';
      if (d.isClosed) ev.listedClosed = true;
      const types = d.googleTypes || [];
      if (!d.raId && !types.includes('night_club')) {
        ev.partyUnconfirmed = true;
        ev.venueKind = types.includes('restaurant') ? 'restaurant' : types.includes('bar') ? 'bar' : 'venue';
      }
      if (!ev.websiteUrl && d.website && !/instagram\.com/i.test(d.website)) ev.websiteUrl = d.website;
      if (d.instagram) { ev.instagramHandle = d.instagram; ev.instagramUrl = 'https://www.instagram.com/' + d.instagram; }
      if (d.phone && !ev.phone) ev.phone = d.phone;
      if (d.nextEvent && d.nextEvent.title) ev.nextEvent = d.nextEvent;
    } catch (e) { console.log('[venueCapacity] enrich error', e.message); }
  }));
  // confirmed party venues first, "may turn into a party" after
  return (events || []).filter(ev => !ev.listedClosed).sort((a, b) => (a.partyUnconfirmed ? 1 : 0) - (b.partyUnconfirmed ? 1 : 0));
}

module.exports = { getVenueInfo, enrichEvents };
