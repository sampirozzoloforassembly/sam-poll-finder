/* POST /api/track { event: "directions" }  — counts clicks only, nothing personal. */
const L = require('./_lib');
const OK = ['directions', 'vote_nyc'];
module.exports = async (req, res) => {
  if (req.method !== 'POST') return L.json(res, 405, { error: 'Use POST.' });
  const b = await L.readBody(req);
  if (OK.includes(b.event)) { try { await L.redis([['HINCRBY', 'sppf:totals', b.event, 1]]); } catch (e) {} }
  return L.json(res, 200, { ok: true });
};
