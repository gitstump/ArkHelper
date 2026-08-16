# ArkHelper — Project Status

*Update this file whenever a phase completes or priorities shift. Any new agent session should read this first.*

## Success bar

Full feature parity with arkstatus.com is the **neutral baseline**, not the goal — falling short is failure, matching it is neutral, exceeding it (without degrading anything) is success. Full parity checklist context lives in the original planning doc if you need the exhaustive arkstatus.com feature inventory; this file tracks what's actually built.

## What's built and working (live-verified, not just tested)

- **Discovery** (`discovery/`) — full official ARK:SA roster (~3,189 servers as of last live run), no API key needed, refreshing on a schedule, history recording (uptime tracking, wipe/version change detection, peak-time and downtime-pattern heatmaps).
- **Accounts** (`accounts/`) — real Discord OAuth login, SQLite-backed accounts/sessions.
- **Homepage** — login state, live roster stats.
- **Server browser** (`/servers`) — search, filter (map/mode/password/player range), sort, pagination.
- **Server detail pages** (`/servers/:id`) — full facts, uptime %, history table, activity log (wipe/version changes), peak-time & downtime heatmaps (inline SVG), embeddable live-status badge (`/servers/:id/badge.svg`) with markdown/HTML snippets.
- **Favorites** — add/remove per account, `/favorites` page. This is the actual point of having accounts at all — confirmed working end to end.
- **Stats & leaderboards** (`/stats`) — network breakdowns (mode/map/platform/cluster), most-populated-servers leaderboard, uptime leaderboard, and a composite ranking algorithm (45% reliability/uptime + 35% activity/relative players + 20% connection stability/ping consistency).

## Explicitly paused (not forgotten, not blocking)

- **Alert dispatch** — settings UI + storage exist (notify on down/back-online, capacity threshold, min free slots), but nothing sends anything yet. Deliberately held pending a multi-channel design (Discord, email, SMS, in-page) instead of building Discord-only and having to redo it.

## Known real gaps vs. arkstatus.com (confirmed via a live re-scan, not guessed)

- Rank/percentile display on individual detail pages (the discovery endpoint exists — `/rankings/:id` — just not wired into the UI yet)
- Full leaderboard suite: per-map and per-region leaderboard variants (we have one global ranked list, not the "leaderboards for every map/region" pattern arkstatus uses)
- Incident/status monitoring pages (`/status/`-style dashboard, `/is-ark-down/`-style explainer) — not started
- Saved filter presets (local + account-tied) — filters are currently just live query strings, nothing persists
- Compare tool (multi-select servers side by side)
- Wider filter set in the browser UI: country/region (GeoLite2 is built but not configured — see below), ping range, min uptime %, cluster ID filter
- News mirror, rates poller, mod-adoption aggregation, derived lists (Ready to Join / Available Now / Recently Wiped) — all confirmed to be data-engineering, not writing, when researched; still unbuilt
- Public API docs, theme toggle (dark-only currently), i18n (English-only)
- Unofficial server tracking — explicitly deferred as a stretch goal, not baseline
- Guides content — the one genuinely-writing (not coding) piece of the whole project, separate track

## Infrastructure not yet done

- **Deployment** — DigitalOcean droplet ("ArkHelper") is provisioned and reachable, but the app has never actually been deployed to it. Everything has run on a local machine so far.
- **GeoLite2** — `geo_lookup.js` is built and tested, but needs a MaxMind account + license key + downloaded `.mmdb` file to actually activate. Not done yet.

## Recently fixed (worth knowing about, not re-introducing)

- A real production crash in `/stats`: a leaderboard entry with a missing/malformed `serverId` threw inside a template string (`.slice()` on `undefined`), and because `res.writeHead()` had already run, the error handler couldn't even send a clean fallback response. Fixed with a `displayNameFor()` helper that never throws, plus restructuring routes to compute the full body before `writeHead()`. See `external-integrations.mdc` and the core rule for the general lessons.
