// Merge party lists from several ticket sites without showing the same party twice.
// "CAPPELLA FRIDAY MAINSTREAM / 2.10" == "Friday Mainstream I CAPPELLA 02.10"
const STOP = new Set(['the', 'x', 'and', 'at', 'w', 'with', 'presents', 'pres', 'prs', 'night', 'party', 'tel', 'aviv', 'tlv', 'edition', 'i', 'l']);
function tokens(title) {
  return new Set(String(title || '').toLowerCase()
    .replace(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g, ' ')      // dates like 2.10 / 02.10.2026 / 2/10
    .replace(/[^a-z0-9֐-׿]+/g, ' ')
    .split(' ').filter(t => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t)));
}
const hhmm = e => (String(e.startTime || '').match(/T(\d{2}:\d{2})/) || [])[1] || '';
function same(a, b) {
  if (a.date !== b.date) return false;
  const A = tokens(a.title), B = tokens(b.title);
  if (!A.size || !B.size) return false;
  const inter = [...A].filter(t => B.has(t)).length;
  if (inter === A.size && inter === B.size) return true;                          // same words, any order
  const small = Math.min(A.size, B.size);
  const sameTime = hhmm(a) && hhmm(a) === hhmm(b);
  return inter === small && small >= 2 && Math.abs(A.size - B.size) <= 1 && sameTime; // near-identical titles at the same start time
}
/** Keep the first occurrence (put the richest source first) and fill missing fields from duplicates */
function mergeEvents(...lists) {
  const out = [];
  lists.flat().filter(e => e && e.title).forEach(e => {
    const dup = out.find(o => same(o, e));
    if (!dup) { out.push({ ...e }); return; }
    if (!dup.venue && e.venue) dup.venue = e.venue;
    if (!dup.url && e.url) dup.url = e.url;
    if ((!dup.artists || !dup.artists.length) && e.artists?.length) dup.artists = e.artists;
  });
  return out;
}
module.exports = { mergeEvents };
