# ArkHelper — Architecture

## The two services

```
discovery/    — port 8792. Pulls the live official ARK:SA roster, records history, computes
                 uptime/rankings/heatmaps/incidents. Has no UI — it's a data/API layer other things read from.
accounts/     — port 8793. Everything a browser actually loads: login, homepage, server
                 browser, detail pages,                  favorites, alerts (settings only), stats, rankings,
                 status ("Is ARK down?"), derived server lists, leaderboard suite,
                 maps index and per-map pages.
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
| `history.js` | SQLite (`node:sqlite`) — snapshot recording, uptime, wipe/version detection, heatmaps; gathers ranking inputs and stamps scores onto the roster; records network incidents |
| `ranking.js` | Pure composite rank scorer (no DB / network / clock) — weights live here |
| `incidents.js` | Pure incident classifier (thresholds, hysteresis, consecutive-fetch-failure counting) |
| `geo_lookup.js` | GeoLite2/MaxMind country lookups — built, not yet configured (see `PROJECT_STATUS.md`) |

**Discovery HTTP endpoints:** `/roster`, `/roster/meta`, `/history/:id`, `/history/wipes`, `/leaderboards/uptime`, `/rankings`, `/rankings/:id`, `/incidents/status`

## accounts/

| File | Role |
|---|---|
| `db.js` | SQLite (`node:sqlite`) — accounts, sessions, favorites, alert settings, filter presets |
| `discord_oauth.js` | Discord OAuth2 request-building/parsing |
| `auth_service.js` | The actual HTTP server — every route lives here |
| `theme.js` | Shared design tokens and base stylesheet (CSS variables) |
| `layout.js` | Shared page shell — header nav, footer sitemap, document wrapper |
| `home_page.js` | Homepage is the server browser + hero stats; still exports `escapeHtml` |
| `server_browser.js` | Filter/sort/paginate + the `/` and `/servers` list page |
| `server_lists.js` | Canonical derived list pages (`/lists/...`) — pre-filtered views that reuse the browser pipeline |
| `presets.js` | Named filter snapshots — query sanitization, cookie cap/size guards; share tokens live in db.js |
| `server_detail.js` | The `/servers/:id` page — facts, uptime, history, activity log, heatmaps, badge embed |
| `favorites_page.js` | The `/favorites` page |
| `rankings_page.js` | The `/rankings` page — top 100 with score breakdowns |
| `leaderboards_page.js` | The `/leaderboards` suite — index, map uptime, PvE vs PvP, top-100 alias, bottom-100 |
| `stats_page.js` | The `/stats` page — network breakdowns; leaderboard previews link into the suite |
| `status_page.js` | The `/is-ark-down` (alias `/status`) page — renders the stored incident snapshot |
| `maps.js` | Official-map registry (id → display name / slug / blurb) plus unknown-id fallback |
| `maps_page.js` | `/maps` index and `/maps/:slug` per-map telemetry pages |
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
