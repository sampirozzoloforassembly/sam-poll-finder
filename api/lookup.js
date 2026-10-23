/* POST /api/lookup  { house, street, zip }  ->  { districts, early, eday, ticket, partial }
 * Keys live in Vercel environment variables, never in the page:
 *   GEOCLIENT_KEY      NYC Geoclient subscription key (api-portal.nyc.gov)
 *   GOOGLE_CIVIC_KEY   Google Civic Information API key
 *   GOOGLE_REFERER     (optional) referrer the Google key is restricted to, default https://samforstatenisland.com/
 *   ELECTION_ID        (optional) Google election id; blank = next upcoming election
 * The voter's address is used only for the two lookups and is never stored.
 * Counts kept (when Upstash Redis is connected): total lookups, ZIP codes, early voting sites, per day. */
const crypto = require('crypto');
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return L.json(res, 405, { error: 'Use POST.' });
  const b = await L.readBody(req);
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const house = clean(b.house, 12), street = clean(b.street, 80), zip = clean(b.zip, 5);
  if (!house || !street || !/^\d{5}$/.test(zip)) return L.json(res, 400, { error: 'Fill in your house number, street name and 5-digit ZIP code.' });

  /* light rate limit: 30 lookups per 10 minutes per visitor (IP is hashed, expires on its own) */
  try {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
    const key = 'sppf:rl:' + crypto.createHash('sha256').update(ip + (process.env.GEOCLIENT_KEY || '')).digest('hex').slice(0, 24);
    const r = await L.redis([['INCR', key], ['EXPIRE', key, 600, 'NX']]);
    if (r && r[0] && r[0].result > 30) return L.json(res, 429, { error: 'Too many searches. Please wait a few minutes.' });
  } catch (e) { /* no rate limit if Redis is down */ }

  const gcKey = process.env.GEOCLIENT_KEY, gKey = process.env.GOOGLE_CIVIC_KEY;
  if (!gKey && !gcKey) return L.json(res, 503, { error: 'The lookup is not set up yet.' });

  /* 1) NYC Geoclient: exact districts */
  let d = null, full = `${house} ${street}, Staten Island, NY ${zip}`;
  if (gcKey) {
    try {
      const r = await L.getJson('https://api.nyc.gov/geo/geoclient/v2/search.json?input=' + encodeURIComponent(`${house} ${street} ${zip}`),
        { 'Ocp-Apim-Subscription-Key': gcKey, Accept: 'application/json' });
      const hit = r.status === 200 && r.j && (r.j.results || []).find((x) => x.response && x.response.assemblyDistrict);
      if (hit) {
        const g = hit.response;
        const boro = String(g.firstBoroughName || g.boroughName || '').toUpperCase();
        const si = boro.includes('STATEN') || String(g.boroughCode1In || g.boroughCode || '') === '5';
        d = {
          ad: parseInt(g.assemblyDistrict, 10) || 0,
          sd: parseInt(g.stateSenatorialDistrict, 10) || 0,
          cd: parseInt(g.congressionalDistrict, 10) || 0,
          mcd: si ? parseInt(g.civilCourtDistrict, 10) || 0 : 0,
          zip: String(g.zipCode || zip).replace(/\D/g, '') || zip,
          staten_island: si
        };
        const h = String(g.houseNumber || g.houseNumberIn || '').trim();
        const st = String(g.firstStreetNameNormalized || g.boePreferredStreetName || g.streetName1In || '').trim();
        if (h && st) full = `${h} ${st}, ${si ? 'Staten Island' : 'New York'}, NY ${d.zip}`;
      }
    } catch (e) { /* fall through to Google */ }
  }

  /* 2) Google Civic: early voting site (and Election Day site when Google has it) */
  let early = null, eday = null, g = null;
  if (gKey) {
    try {
      const url = 'https://www.googleapis.com/civicinfo/v2/voterinfo?key=' + encodeURIComponent(gKey) + '&address=' + encodeURIComponent(full) +
        (process.env.ELECTION_ID ? '&electionId=' + encodeURIComponent(process.env.ELECTION_ID) : '');
      const r = await L.getJson(url, { Referer: process.env.GOOGLE_REFERER || 'https://samforstatenisland.com/' });
      g = r.j;
      if (g && g.earlyVoteSites && g.earlyVoteSites[0]) early = L.site(g.earlyVoteSites[0]);
      if (g && g.pollingLocations && g.pollingLocations[0]) eday = L.site(g.pollingLocations[0]);
    } catch (e) { /* sites stay null; page links to vote.nyc */ }
  }

  if (!d && !early && !eday) {
    try { await L.redis([['HINCRBY', 'sppf:totals', 'failed', 1]]); } catch (e) {}
    return L.json(res, 404, { error: 'We couldn’t match that address. Check the house number, street name and ZIP code.' });
  }

  /* 3) the ticket */
  let ticket, partial = false;
  if (d) ticket = L.ticketFromDistricts(d);
  else ticket = L.ticketFromContests(g) || (/^103\d\d$/.test(zip) ? (partial = true, L.ticketIslandwide()) : []);

  /* 4) counts only: ZIP code, early voting site, day. No addresses. */
  try {
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const cmds = [['HINCRBY', 'sppf:totals', 'lookups', 1], ['HINCRBY', 'sppf:zips', (d && d.zip) || zip, 1], ['HINCRBY', 'sppf:days', day, 1]];
    if (early) cmds.push(['HINCRBY', 'sppf:early', early.name + ' — ' + early.address, 1]);
    await L.redis(cmds);
  } catch (e) { /* never block the voter on stats */ }

  return L.json(res, 200, { districts: d || { zip }, early, eday, ticket, partial });
};
