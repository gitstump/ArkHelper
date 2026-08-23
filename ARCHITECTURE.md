# ArkHelper — Architecture

## The two services

```
discovery/    — port 8792. Pulls the live official ARK:SA roster, records history, computes
                 uptime/rankings/heatmaps/incidents. Has no UI — it's a data/API layer other things read from.
accounts/     — port 8793. Everything a browser actually loads: login, homepage, server
                 browser, detail pages, favorites, alerts (settings, in-page feed, Discord
                 webhook), stats, rankings, status ("Is ARK down?"), derived server lists,
                 leaderboard suite, maps index and per-map pages, guides index and per-guide
                 pages, official rates, launcher news, unofficial mod adoption,
                 demolish-refund calculator, crafting-cost calculator.
```

They're separate Node processes, talking over plain local HTTP — `accounts/` fetches from
`discovery/`'s endpoints (`http://localhost:8792/...`) via `local_fetch.js`'s `fetchJsonSafe`,
which never throws. If discovery is down or slow, accounts degrades gracefully instead of
crashing — every page has a tested "roster unavailable" fallback state.

## discovery/

| File | Role |
|---|---|
| `ark_official_api.js` | Fetches Wildcard's own official server list (no key needed) |
| `unofficial_api.js` | Fetches Wildcard's unofficial list, trims immediately (including `modIds` from `ModIDs` and `day` from `DayTime`), rejects oversized bodies |
| `unofficial_store.js` | Separate SQLite (`unofficial.sqlite`) — latest trimmed fields + first_seen/last_seen/cycles_seen; `server_mods` / `mods` for CurseForge-backed adoption |
| `curseforge_api.js` | Batch-resolves CurseForge project IDs (`POST /v1/mods`); key is passed in, never read from env here |
| `info_feeds.js` | Fetches/parses Wildcard CDN rate INIs and news.ini (injectable fetch) |
| `info_store.js` | Separate SQLite (`feeds.sqlite`) — current rates per variant + change log; news entries hashed by imagePath+action |
| `discovery_service.js` | CLI + scheduler + the HTTP server exposing everything below |
| `history.js` | SQLite (`node:sqlite`) — snapshot recording, uptime, version `change_log` (incident input), two-cycle `server_change_events` (official + unofficial cycles; `probable_wipe` is the wipe source of truth), heatmaps; gathers ranking inputs and stamps scores onto the roster; records network incidents |
| `ranking.js` | Pure composite rank scorer (no DB / network / clock) — weights live here |
| `incidents.js` | Pure incident classifier (thresholds, hysteresis, consecutive-fetch-failure counting) |
| `geo_lookup.js` | GeoLite2/MaxMind country lookups — optional via `GEOLITE2_DB_PATH`; stamps `country` / `countryName` on the official roster |

**Discovery HTTP endpoints:** `/roster`, `/roster/meta`, `/unofficial/roster`, `/unofficial/meta`, `/history/:id`, `/history/wipes`, `/leaderboards/uptime`, `/rankings`, `/rankings/:id`, `/incidents/status`, `/rates`, `/news`, `/mods/summary`, `/mods/:id`

## accounts/

| File | Role |
|---|---|
| `db.js` | SQLite (`node:sqlite`) — accounts, sessions, favorites, alert settings, alert state/events, webhooks, deliveries, filter presets |
| `discord_oauth.js` | Discord OAuth2 request-building/parsing |
| `auth_service.js` | The actual HTTP server — every route lives here |
| `theme.js` | Shared design tokens and base stylesheet (CSS variables) |
| `layout.js` | Shared page shell — header nav, footer sitemap, document wrapper |
| `origin.js` | Public site origin from `SITE_ORIGIN` (default `https://arkhelper.info`, trailing slash stripped) |
| `home_page.js` | Homepage is the server browser + hero stats; still exports `escapeHtml` |
| `server_browser.js` | Filter/sort/paginate + the `/` and `/servers` list page |
| `server_lists.js` | Canonical derived list pages (`/lists/...`) — pre-filtered views that reuse the browser pipeline |
| `presets.js` | Named filter snapshots — query sanitization, cookie cap/size guards; share tokens live in db.js |
| `server_detail.js` | The `/servers/:id` page — facts, uptime, history, activity log, heatmaps, badge embed |
| `compare_page.js` | The `/compare` page — URL-as-state side-by-side comparison (cap 4 servers), add-a-server search, best-value highlights |
| `favorites_page.js` | The `/favorites` page |
| `alert_engine.js` | Pure alert evaluator (hysteresis, latches, cooldown) plus a timer wrapper; no HTTP of its own |
| `alert_dispatch.js` | Discord webhook delivery for pending `alert_events` (URL allowlist, batching, drop-not-queue) |
| `alerts_page.js` | The `/alerts` in-page feed and per-account Discord webhook form |
| `rankings_page.js` | The `/rankings` page — top 100 with score breakdowns |
| `leaderboards_page.js` | The `/leaderboards` suite — index, map uptime, PvE vs PvP, regions, top-100 alias, bottom-100 |
| `country.js` | ISO-code flag emoji, country dropdown helpers, region labels |
| `stats_page.js` | The `/stats` page — network breakdowns; leaderboard previews link into the suite |
| `status_page.js` | The `/is-ark-down` (alias `/status`) page — renders the stored incident snapshot |
| `rates_page.js` | The `/rates` page — per-network multipliers, bonus-rate banner, change history |
| `news_page.js` | The `/news` page — text, links, and official announcement thumbnails hotlinked from Wildcard's CDN (imagery policy) |
| `mods_page.js` | `/mods` and `/mods/:id` — unofficial mod adoption (CurseForge metadata, allowlisted ForgeCDN thumbs) |
| `maps.js` | Official-map registry (id → display name / slug / blurb) plus unknown-id fallback |
| `maps_page.js` | `/maps` index and `/maps/:slug` per-map telemetry pages |
| `guides.js` | Static guide registry (slug → title / sections / related); unknown slugs return null |
| `guides_page.js` | `/guides` index and `/guides/:slug` article pages |
| `demolish_refund.js` | Pure demolish-refund filter, math, and dataset builder |
| `demolish_refund_page.js` | `/tools/demolish-refund` calculator shell (vanilla JS + static JSON) |
| `crafting_cost.js` | Pure crafting-cost filter, math, and dataset builder |
| `crafting_cost_page.js` | `/tools/crafting-cost` calculator shell (vanilla JS + static JSON) |
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
Wildcard's official server list          Wildcard's unofficial server list
        |                                          |
        v                                          v
ark_official_api.js                    unofficial_api.js (trim + byte cap)
        |                                          |
        v                                          v
discovery_service.js  ->  roster.json    unofficial_store.js (unofficial.sqlite)
        |                     |                    |
        v                     v                    v
  history.js (SQLite;     GET /roster         GET /unofficial/roster
   official snapshots +                       unofficial cycle also
   two-cycle events)                          calls detectStableChanges
        |
        +-- info_feeds.js -> info_store.js (feeds.sqlite) -> GET /rates, GET /news
        +-- curseforge_api.js (keyed) -> unofficial_store mods tables -> GET /mods/summary, GET /mods/:id
        |
        +---------------------+--------------------+
                              |
                              v
              accounts/auth_service.js fetches both,
              renders pages, serves to the browser
```
