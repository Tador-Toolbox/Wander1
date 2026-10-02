// Weather for trip dates via Open-Meteo (free, no key).
// ≤15 days ahead → real forecast; further → typical weather from the same dates in the last 3 years.
const getJSON = async (url, ms = 8000) => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); return r.ok ? await r.json() : null; } catch { return null; } finally { clearTimeout(t); }
};
const ICON = c => c == null ? '' : c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 67 ? '🌧️' : c <= 77 ? '❄️' : c <= 82 ? '🌦️' : '⛈️';

async function locate(city) {
  const name = String(city || '').split(',')[0].trim();
  const d = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en`);
  const r = d?.results?.[0];
  return r ? { lat: r.latitude, lng: r.longitude, tz: r.timezone || 'auto' } : null;
}

/** dates: ['YYYY-MM-DD', ...] → { kind:'forecast'|'typical', days:{date:{max,min,rain,icon}}, summary } */
async function tripWeather(city, dates) {
  try {
    const loc = await locate(city);
    if (!loc || !dates.length) return null;
    const from = dates[0], to = dates[dates.length - 1];
    const daysAhead = (new Date(to) - new Date()) / 86400000;
    const days = {};
    let kind;
    if (daysAhead <= 15) {
      kind = 'forecast';
      const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&start_date=${from}&end_date=${to}`);
      if (!d?.daily) return null;
      d.daily.time.forEach((t, i) => { days[t] = { max: Math.round(d.daily.temperature_2m_max[i]), min: Math.round(d.daily.temperature_2m_min[i]), rain: d.daily.precipitation_probability_max?.[i] ?? null, icon: ICON(d.daily.weather_code?.[i]) }; });
    } else {
      kind = 'typical';
      const y = new Date().getFullYear();
      const years = [y - 1, y - 2, y - 3];
      const shift = (s, yr) => yr + s.slice(4);
      const res = await Promise.all(years.map(yr => getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${loc.lat}&longitude=${loc.lng}&start_date=${shift(from, yr)}&end_date=${shift(to, yr)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto`)));
      dates.forEach((date, i) => {
        const vals = res.filter(r => r?.daily?.time?.[i] != null).map(r => ({ max: r.daily.temperature_2m_max[i], min: r.daily.temperature_2m_min[i], rain: r.daily.precipitation_sum[i], code: r.daily.weather_code?.[i] }));
        if (!vals.length) return;
        const avg = k => vals.reduce((a, v) => a + (v[k] || 0), 0) / vals.length;
        const rainyYears = vals.filter(v => (v.rain || 0) >= 1).length;
        days[date] = { max: Math.round(avg('max')), min: Math.round(avg('min')), rain: Math.round(rainyYears / vals.length * 100), icon: rainyYears * 2 > vals.length ? '🌦️' : avg('max') >= 18 ? '☀️' : '🌤️' };
      });
    }
    const vals = Object.values(days);
    if (!vals.length) return null;
    const hi = Math.max(...vals.map(v => v.max)), lo = Math.min(...vals.map(v => v.min));
    const rainyDays = vals.filter(v => (v.rain || 0) >= 50).length;
    const summary = `${lo}–${hi}°C` + (rainyDays ? ` · rain likely on ${rainyDays} day${rainyDays > 1 ? 's' : ''}` : ' · mostly dry');
    return { kind, days, summary };
  } catch (e) { console.log('[weather] error', e.message); return null; }
}

module.exports = { tripWeather };
