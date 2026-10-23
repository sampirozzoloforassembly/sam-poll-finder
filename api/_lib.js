/* Shared helpers for the Sam Pirozzolo poll finder (Vercel serverless functions).
 * Files in /api that start with "_" are not exposed as routes. */

/* The endorsed slate. "match" decides who sees each race:
 *   state  = every New York voter
 *   island = every Staten Island voter
 *   [field, value] = only voters whose district matches */
const SLATE = [
  { office: 'Governor', name: 'Bruce Blakeman', img: 'blakeman', match: 'state' },
  { office: 'Attorney General', name: 'Saritha Komatireddy', img: 'komatireddy', match: 'state' },
  { office: 'Comptroller', name: 'Joseph Hernandez', img: 'hernandez', match: 'state' },
  { office: 'Congress · NY-11', name: 'Nicole Malliotakis', img: 'malliotakis', match: ['cd', 11] },
  { office: 'State Senate · District 23', name: 'Ruslan Shamal', img: 'shamal', match: ['sd', 23] },
  { office: 'State Senate · District 24', name: 'Andrew Lanza', img: 'lanza', match: ['sd', 24] },
  { office: 'Assembly · District 61', name: 'Casey O’Connor Manasia', img: 'casey', match: ['ad', 61] },
  { office: 'Assembly · District 62', name: 'Michael Reilly', img: 'reilly', match: ['ad', 62] },
  { office: 'Assembly · District 63', name: 'Sam Pirozzolo', img: 'pirozzolo', match: ['ad', 63] },
  { office: 'Assembly · District 64', name: 'Michael Tannousis', img: 'tannousis', match: ['ad', 64] },
  { office: 'Justice of the Supreme Court', name: 'Michael Pinto', img: 'pinto', match: 'island' },
  { office: 'Judge of the Civil Court · Islandwide', name: 'Glenn Yost', img: 'yost', match: 'island' },
  { office: 'Judge of the Civil Court · 1st Municipal Court District', name: 'Carrie Low', img: 'low', match: ['mcd', 1] }
];

function out(c) { return { office: c.office, name: c.name, img: '/assets/heads/' + c.img + '.jpg' }; }

function ticketFromDistricts(d) {
  return SLATE.filter((c) => {
    const m = c.match;
    if (m === 'state') return true;
    if (m === 'island') return !!d.staten_island;
    return Number(d[m[0]]) === Number(m[1]);
  }).map(out);
}

function norm(s) { return String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

/* Backup when Geoclient is unavailable: match our candidates against the contests Google lists for the address. */
function ticketFromContests(g) {
  const names = [];
  ((g && g.contests) || []).forEach((c) => (c.candidates || []).forEach((k) => names.push(norm(k.name))));
  if (!names.length) return null;
  const hit = SLATE.filter((s) => {
    const p = norm(s.name).split(' ');
    return names.some((n) => n.includes(p[p.length - 1]) && n.includes(p[0]));
  });
  if (hit.length < 4 || !hit.some((s) => Array.isArray(s.match) && s.match[0] !== 'cd')) return null;
  return SLATE.filter((s) => hit.includes(s) || s.match === 'island').map(out);
}

function ticketIslandwide() { return SLATE.filter((s) => s.match === 'state' || s.match === 'island' || (Array.isArray(s.match) && s.match[0] === 'cd')).map(out); }

function site(loc) {
  const a = (loc && loc.address) || {};
  const street = [a.line1, a.line2, a.line3].filter(Boolean).join(', ');
  const city = [a.city, a.state].filter(Boolean).join(', ') + (a.zip ? ' ' + a.zip : '');
  return {
    name: a.locationName || loc.name || 'Poll site',
    address: [street, city].filter(Boolean).join(', '),
    hours: String(loc.pollingHours || '').split(/;\s*/).map((s) => s.trim()).filter(Boolean)
  };
}

async function getJson(url, headers, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 10000);
  try {
    const r = await fetch(url, { headers: headers || {}, signal: ctl.signal });
    let j = null;
    try { j = await r.json(); } catch (e) { /* not JSON */ }
    return { status: r.status, j };
  } finally { clearTimeout(t); }
}

/* ---------- tiny Upstash Redis client (REST). Works with the env vars Vercel adds when you connect Upstash. */
function redisConf() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}
async function redis(commands) {
  const c = redisConf();
  if (!c) return null;
  const r = await fetch(c.url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return r.json();
}

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return {}; }
}

module.exports = { SLATE, ticketFromDistricts, ticketFromContests, ticketIslandwide, site, getJson, redis, redisConf, json, readBody };
