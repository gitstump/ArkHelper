# ArkHelper — Architecture

## The two services

```
discovery/    — port 8792. Pulls the live official ARK:SA roster, records history, computes
                 uptime/rankings/heatmaps. Has no UI — it's a data/API layer other things read from.
accounts/     — port 8793. Everything a browser actually loads: login, homepage, server
                 browser, detail pages, favorites, alerts (settings only), stats.
```

They're separate Node processes, talking over plain local HTTP — `accounts/` fetches from
`discovery/`'s endpoints (`http://localhost:8792/...`) via `local_fetch.js`'s `fetchJsonSafe`,
which never throws. If discovery is down or slow, accounts degrades gracefully instead of
crashing — every page has a tested "roster unavailable" fallback state.

## discovery/

| File | Role |
|---|---|
| `ark_official_api.js` | Fetches Wildcard's own official server list (no key needed) |
| `discovery_service.js` | CLI + scheduler + the HTTP server exposing everything below |
| `history.js` | SQLite (`node:sqlite`) — snapshot recording, uptime, wipe/version detection, heatmaps, ranking |
| `geo_lookup.js` | GeoLite2/MaxMind country lookups — built, not yet configured (see `PROJECT_STATUS.md`) |

**Discovery HTTP endpoints:** `/roster`, `/roster/meta`, `/history/:id`, `/leaderboards/uptime`, `/rankings`, `/rankings/:id`

## accounts/

| File | Role |
|---|---|
| `db.js` | SQLite (`node:sqlite`) — accounts, sessions, favorites, alert settings |
| `discord_oauth.js` | Discord OAuth2 request-building/parsing |
| `auth_service.js` | The actual HTTP server — every route lives here |
| `home_page.js` | Homepage rendering + `escapeHtml` (imported everywhere else too) |
| `server_browser.js` | Filter/sort/paginate + the `/servers` list page |
| `server_detail.js` | The `/servers/:id` page — facts, uptime, history, activity log, heatmaps, badge embed |
| `favorites_page.js` | The `/favorites` page |
| `stats_page.js` | The `/stats` page — network breakdowns + leaderboards + ranking |
| `heatmap_svg.js` | Renders peak-time/downtime grids as inline SVG |
| `badge.js` | The embeddable live-status SVG badge |
| `local_fetch.js` | Shared "fetch JSON from discovery, never throw" helper |

## Design conventions (see `.cursor/rules/` for the enforced version)

- **Zero-dependency by default.** Node built-ins only. The one exception is `maxmind` (parsing
  MaxMind's binary `.mmdb` format isn't worth hand-rolling) — any new dependency needs an
  equally clear reason.
- **No client-side JS framework.** Every page is a server-rendered template string. Filters/sort
  are just query params, so every view is a bookmarkable/shareable URL. Forms POST directly.
- **Dependency injection everywhere.** `httpGet`, `sleep`, `now`, random-token generation — all
  injectable, so the full test suite runs with zero real network access and zero real waiting.
- **Defensive by default.** External data (API responses, DB rows, even our own history data)
  is never trusted to have the expected shape. Missing/malformed fields degrade to a sensible
  fallback, never a crash.

## Data flow (the short version)

```
Wildcard's official server list
        |
        v
ark_official_api.js  ->  discovery_service.js  ->  roster.json (atomic write)
                                |                        |
                                v                        v
                          history.js (SQLite)      GET /roster (HTTP)
                                |                        |
                                v                        |
                   GET /history/:id, /rankings, etc  ----+
                                |
                                v
                    accounts/auth_service.js fetches both,
                    renders pages, serves to the browser
```
