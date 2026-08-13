const router = require('express').Router();
const User   = require('../models/User');
const Trip   = require('../models/Trip');
const Place  = require('../models/Place');

const ADMIN_KEY = process.env.ADMIN_KEY || 'wander-admin-2026';

function authAdmin(req, res, next) {
  if (req.query.key !== ADMIN_KEY) return res.status(401).send('Unauthorized');
  next();
}

// GET /api/admin/users?key=...
router.get('/users', authAdmin, async (req, res) => {
  try {
    const users = await User.find({}, 'email firstName lastName verified verifyToken verifyExpires createdAt').sort({ createdAt: -1 });
    const [tripCount, placeCount] = await Promise.all([
      Trip.countDocuments(), Place.countDocuments()
    ]);
    res.json({ users, stats: { users: users.length, trips: tripCount, places: placeCount } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /admin?key=... — HTML dashboard
router.get('/', authAdmin, (req, res) => {
  const key = req.query.key;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wander Admin</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', sans-serif; background: #f0f2f5; min-height: 100vh; }
  .header { background: linear-gradient(135deg,#1a1a2e,#4a9eff); color: #fff; padding: 24px 32px; }
  .header h1 { font-size: 22px; font-weight: 800; }
  .header p  { font-size: 13px; opacity: .7; margin-top: 4px; }
  .stats { display: flex; gap: 16px; padding: 24px 32px; flex-wrap: wrap; }
  .stat { background: #fff; border-radius: 16px; padding: 20px 28px; flex: 1; min-width: 140px;
          box-shadow: 0 2px 10px rgba(0,0,0,.06); text-align: center; }
  .stat .n { font-size: 36px; font-weight: 900; color: #1a1a2e; }
  .stat .l { font-size: 12px; color: #888; font-weight: 700; margin-top: 4px; }
  .users { padding: 0 32px 32px; }
  .users h2 { font-size: 16px; font-weight: 800; color: #1a1a2e; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; background: #fff;
          border-radius: 16px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,.06); }
  th { background: #f8f8fc; padding: 12px 16px; text-align: left; font-size: 12px;
       font-weight: 800; color: #888; text-transform: uppercase; letter-spacing: .5px; }
  td { padding: 13px 16px; font-size: 14px; border-top: 1px solid #f0f0f4; color: #1a1a2e; }
  tr:hover td { background: #fafafe; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 800; }
  .verified   { background: #d1fae5; color: #065f46; }
  .pending    { background: #fef3c7; color: #92400e; }
  .expired    { background: #fee2e2; color: #991b1b; }
  .email-sent { color: #4a9eff; font-size: 12px; }
  .refresh { float: right; padding: 8px 16px; background: #4a9eff; color: #fff;
             border: none; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer; }
</style>
</head>
<body>
<div class="header">
  <h1>✦ Wander Admin</h1>
  <p id="ts">Loading...</p>
</div>
<div class="stats" id="statsRow"></div>
<div class="users">
  <h2>👥 Users <button class="refresh" onclick="load()">↻ Refresh</button></h2>
  <table>
    <thead><tr>
      <th>Name</th><th>Email</th><th>Status</th><th>Email</th><th>Registered</th>
    </tr></thead>
    <tbody id="tbody"><tr><td colspan="5" style="text-align:center;color:#aaa;padding:30px;">Loading...</td></tr></tbody>
  </table>
</div>
<script>
const KEY = '${key}';
async function load(){
  const r = await fetch('/api/admin/users?key=' + KEY);
  const d = await r.json();
  document.getElementById('ts').textContent = 'Updated: ' + new Date().toLocaleTimeString();

  // Stats
  const verified = d.users.filter(u => u.verified).length;
  const pending  = d.users.filter(u => !u.verified && u.verifyToken).length;
  const noEmail  = d.users.filter(u => !u.verified && !u.verifyToken).length;
  document.getElementById('statsRow').innerHTML =
    stat(d.stats.users, 'Total Users') +
    stat(verified, 'Verified ✅') +
    stat(pending, 'Pending 📧') +
    stat(d.stats.trips, 'Trips') +
    stat(d.stats.places, 'Places');

  // Table
  document.getElementById('tbody').innerHTML = d.users.map(u => {
    const now = Date.now();
    let statusBadge, emailBadge;

    if (u.verified) {
      statusBadge = '<span class="badge verified">✅ Verified</span>';
      emailBadge  = '<span style="color:#888;font-size:12px;">—</span>';
    } else if (u.verifyToken && u.verifyExpires && new Date(u.verifyExpires) > now) {
      statusBadge = '<span class="badge pending">⏳ Pending</span>';
      emailBadge  = '<span class="email-sent">📧 Sent</span>';
    } else if (u.verifyToken) {
      statusBadge = '<span class="badge expired">⚠️ Link Expired</span>';
      emailBadge  = '<span class="email-sent">📧 Sent (expired)</span>';
    } else {
      statusBadge = '<span class="badge expired">❌ No Email</span>';
      emailBadge  = '<span style="color:#e63946;font-size:12px;">Not sent</span>';
    }

    const name = (u.firstName + ' ' + (u.lastName||'')).trim() || '—';
    const date = new Date(u.createdAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    return '<tr><td><strong>' + name + '</strong></td><td>' + u.email + '</td><td>' +
           statusBadge + '</td><td>' + emailBadge + '</td><td style="color:#888;font-size:12px;">' + date + '</td></tr>';
  }).join('');
}
function stat(n, l){ return '<div class="stat"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }
load();
setInterval(load, 30000);
</script>
</body>
</html>`);
});

module.exports = router;
