/* GET /api/stats?key=YOUR_STATS_PASSWORD            -> simple report page
 * GET /api/stats?key=YOUR_STATS_PASSWORD&format=csv -> spreadsheet download
 * Set STATS_PASSWORD in Vercel environment variables. */
const L = require('./_lib');

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function pairs(arr) { const o = []; for (let i = 0; i + 1 < (arr || []).length; i += 2) o.push([arr[i], Number(arr[i + 1])]); return o; }

module.exports = async (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const pw = process.env.STATS_PASSWORD;
  if (!pw || q.get('key') !== pw) { res.statusCode = 401; res.setHeader('Content-Type', 'text/plain'); return res.end('Add ?key=YOUR_STATS_PASSWORD to the address.'); }
  if (!L.redisConf()) { res.statusCode = 503; res.setHeader('Content-Type', 'text/plain'); return res.end('Stats storage is not connected yet (add Upstash Redis in the Vercel project’s Storage tab).'); }

  const r = await L.redis([['HGETALL', 'sppf:totals'], ['HGETALL', 'sppf:zips'], ['HGETALL', 'sppf:early'], ['HGETALL', 'sppf:days']]);
  const totals = Object.fromEntries(pairs(r[0].result));
  const zips = pairs(r[1].result).sort((a, b) => b[1] - a[1]);
  const early = pairs(r[2].result).sort((a, b) => b[1] - a[1]);
  const days = pairs(r[3].result).sort((a, b) => (a[0] < b[0] ? -1 : 1));

  res.setHeader('Cache-Control', 'no-store');
  if (q.get('format') === 'csv') {
    const cell = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const rows = [['section', 'item', 'count']];
    Object.entries(totals).forEach(([k, v]) => rows.push(['total', k, v]));
    zips.forEach(([k, v]) => rows.push(['zip', k, v]));
    early.forEach(([k, v]) => rows.push(['early voting site', k, v]));
    days.forEach(([k, v]) => rows.push(['day', k, v]));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="poll-finder-stats.csv"');
    return res.end(rows.map((x) => x.map(cell).join(',')).join('\n'));
  }
  const table = (title, rows, a, b) => '<h2>' + title + '</h2><table><tr><th>' + a + '</th><th>' + b + '</th></tr>' +
    (rows.length ? rows.map(([k, v]) => '<tr><td>' + esc(k) + '</td><td>' + v + '</td></tr>').join('') : '<tr><td colspan="2">None yet</td></tr>') + '</table>';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Poll finder stats</title>' +
    '<style>body{font:16px/1.5 -apple-system,Segoe UI,Arial,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#0b1638}h1{margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-bottom:20px}td,th{border-bottom:1px solid #dde3ef;padding:6px 8px;text-align:left}td:last-child,th:last-child{text-align:right;width:90px}.k{display:flex;gap:24px;flex-wrap:wrap}.k div{background:#f2f5fb;border-radius:10px;padding:10px 14px}.k b{display:block;font-size:26px}a{color:#e3262f}</style>' +
    '<h1>Poll finder stats</h1><p><a href="?key=' + encodeURIComponent(q.get('key')) + '&format=csv">Download CSV</a></p>' +
    '<div class="k"><div><b>' + (totals.lookups || 0) + '</b>lookups</div><div><b>' + (totals.failed || 0) + '</b>not found</div><div><b>' + (totals.directions || 0) + '</b>directions clicks</div></div>' +
    table('ZIP codes', zips, 'ZIP', 'Lookups') + table('Early voting sites', early, 'Site', 'Lookups') + table('By day', days, 'Day', 'Lookups'));
};
