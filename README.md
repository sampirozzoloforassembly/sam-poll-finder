# Sam Pirozzolo · Find Your Poll Site

Staten Island poll-site finder. The page is in `public/` and three small serverless functions are in `api/`.

- `api/lookup.js` – address → districts (NYC Geoclient) + early voting / Election Day site (Google Civic) + the endorsed candidates on that voter's ballot
- `api/track.js` – counts "Directions" and vote.nyc clicks
- `api/stats.js` – report page at `/api/stats?key=STATS_PASSWORD` (add `&format=csv` for a spreadsheet)

Addresses are never stored. Only counts are kept: lookups, ZIP codes, early voting sites, and lookups per day.

## Settings (Vercel → Project → Settings → Environment Variables)

| Name | What |
|---|---|
| `GEOCLIENT_KEY` | NYC Geoclient subscription key |
| `GOOGLE_CIVIC_KEY` | Google Civic Information API key |
| `STATS_PASSWORD` | password for the stats page |
| `GOOGLE_REFERER` | optional; the site your Google key is restricted to (default `https://samforstatenisland.com/`) |
| `ELECTION_ID` | optional Google election id |

Stats storage: Vercel → Project → Storage → connect **Upstash for Redis** (free tier). It adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Without it the page still works; it just doesn't count.

## Changing things later
- Candidates: `SLATE` in `api/_lib.js`, photos in `public/assets/heads/`
- Early voting day strip: the `DAYS` list near the bottom of `public/index.html`
