# ArkHelper — Project Status

Last updated: 2026-08-16 — 520 tests passing — In flight: none

*Update this file whenever a phase completes or priorities shift. Any new agent session should read this first. Keep the "Last updated" line current at every update.*

## Success bar

Full public-feature parity with arkstatus.com is the neutral baseline — falling short is failure, matching is neutral. Success additionally means: parity with BattleMetrics' PUBLIC pages (server stats/graphs; their RCON/admin suite is explicitly OUT of scope), and parity with the ARK wiki's TOOLS (calculators, reference data, maps) built clean-room from game facts and original assets — the wiki's CC BY-NC-SA license means we never copy its text or images. Exceeding all of this without degrading anything is the actual goal.

Live wild/tamed dino counts on official servers are **not** a parity item — arkstatus.com does not show them (they need RCON/admin access, which neither they nor we have on official). Their taming/breeding calculators are static creature-stat tools, not live in-server counts. Those calculators belong under the wiki-tools success bar above, built clean-room.

## What's built and working (live-verified, not just tested)

- **Discovery** (`discovery/`) — full official ARK:SA roster (~3,189 servers as of last live run), no API key needed, refreshing on a schedule, history recording (uptime tracking, wipe/version change detection, peak-time and downtime-pattern heatmaps).
- **Accounts** (`accounts/`) — real Discord OAuth login, SQLite-backed accounts/sessions.
- **Shared UI** — one dark design system (`accounts/theme.js`) and a common page shell (`accounts/layout.js`: header nav, login state, footer sitemap). Every HTML page uses it; badge/heatmap SVG endpoints do not.
- **Homepage** (`/`) — the server browser itself, with a hero stat band (official servers online, players online, 24h network uptime, network status). `/servers` is the same page.
- **Server browser** (`/servers`) — search, filter (map/mode/platform/password/player range), sort, pagination; compact rows with status, capacity bar, ping, uptime, rank, and a platform badge (PC / Console / PC+Console from the roster `platformType` field).
- **Derived server lists** (`/lists/official-pve`, `/lists/official-pvp`, `/lists/low-ping`, `/lists/most-populated`, `/lists/recently-wiped`, `/lists/available-now`) — canonical pre-filtered/pre-sorted views that reuse the browser pipeline. Recently-wiped reads the existing history change log (14-day window). Available-now labels slot counts as observed, not reserved.
- **Nav** — Servers and Stats are CSS `details` dropdowns (hover/focus-within plus tap-to-open); Favorites stays a plain link. Stats dropdown: Rankings, Leaderboards, Map Uptime, PvE vs PvP, Is ARK Down. Footer sitemap matches. The ArkHelper wordmark links home (`/`).
- **Filter presets** — named snapshots of the current browser query string. Logged-out: up to 3 in an HttpOnly cookie (~2KB guard). Logged-in: up to 15 in SQLite, cookie presets migrate on login (name collisions skipped), shareable via public `/p/<token>` → `/servers?...` redirects.
- **Server detail pages** (`/servers/:id`) — full facts, uptime %, history table, activity log (wipe/version changes), peak-time & downtime heatmaps (inline SVG), embeddable live-status badge (`/servers/:id/badge.svg`) with markdown/HTML snippets.
- **Favorites** — add/remove per account, `/favorites` page. This is the actual point of having accounts at all — confirmed working end to end.
- **Stats** (`/stats`) — network breakdowns (mode/map/platform/cluster) and a most-populated snapshot. Ranked-list previews link into the leaderboard suite instead of duplicating tables.
- **Leaderboard suite** (`/leaderboards`) — index of Rankings, Map Uptime, PvE vs PvP, Top 100, and Bottom 100. Map uptime is every map's server count, avg 7-day uptime, and avg population %, from history stamped onto the roster. PvE vs PvP is a two-column comparison with deltas. Top 100 reuses `/rankings`. Bottom 100 is the lowest rankScores among servers with a full week of history (thin-history servers excluded).
- **Rankings** (`/rankings`) — composite rank score 0–100 per official server, recomputed every discovery cycle (40% 7-day uptime + 25% ping quality + 25% mean population % + 10% history-age confidence). Surfaced as a Rank sort in the server browser, a rank badge on each detail page, and a top-100 leaderboard with score breakdowns. Pure scorer lives in `discovery/ranking.js`; scores **and 7-day uptime %** are stamped onto the roster feed so accounts doesn't need a second query.
- **Incident detection & status** (`/is-ark-down`, alias `/status`) — each discovery cycle classifies the official network as NORMAL / DEGRADED / OUTAGE / UPDATE_ROLLOUT from roster presence, 24h offline baseline, version-change coverage, and consecutive CDN fetch failures. Incidents persist in the history SQLite (hysteresis: 3 consecutive NORMAL cycles to close). The public page renders the latest stored snapshot (`Cache-Control: public, max-age=30`), not a per-request recompute.

## Explicitly paused (not forgotten, not blocking)

- **Alert dispatch** — settings UI + storage exist (notify on down/back-online, capacity threshold, min free slots), but nothing sends anything yet. Deliberately held pending a multi-channel design (Discord, email, SMS, in-page) instead of building Discord-only and having to redo it.

## Known real gaps vs. arkstatus.com (confirmed via a live re-scan, not guessed)

- Rank/percentile neighborhood on individual detail pages (the discovery endpoint exists — `/rankings/:id` — the detail page now shows a rank-score badge, but not the nearby-ranked-servers table)
- Per-map leaderboard pages and a regional leaderboard (map-uptime aggregate exists; per-map pages are next; regional needs GeoLite2)
- Compare tool (multi-select servers side by side)
- Wider filter set in the browser UI: country/region (GeoLite2 is built but not configured — see below), ping range, min uptime %, cluster ID filter
- News mirror, rates poller, mod-adoption aggregation — all confirmed to be data-engineering, not writing, when researched; still unbuilt
- Public API docs, theme toggle (dark-only currently), i18n (English-only)
- Unofficial server tracking — explicitly deferred as a stretch goal, not baseline
- Guides content (and short per-map blurbs) — the one genuinely-writing (not coding) piece of the whole project, separate track

## Production deployment

LIVE at https://arkhelper.info since 2026-08-16. DigitalOcean droplet (2GB, NYC, Ubuntu 24.04, IP 159.223.188.54). Code at `/opt/arkhelper`, cloned from the public GitHub repo. Two systemd services: `arkhelper-discovery.service` and `arkhelper-accounts.service` (`Restart=always`, enabled at boot). Secrets in `/etc/arkhelper.env` (`EnvironmentFile`; the code itself has no `.env` loader). Caddy reverse-proxies arkhelper.info and www → localhost:8793 with automatic Let's Encrypt HTTPS; discovery :8792 is internal-only (firewall allows only SSH/80/443). 2GB swap file enabled. Weekly DigitalOcean droplet backups enabled. Updates ship via `/root/deploy.sh` on the droplet (pull → npm install → `node --test` → restart; aborts if tests fail).

## Infrastructure not yet done

- **GeoLite2** — `geo_lookup.js` is built and tested, but needs a MaxMind account + license key + downloaded `.mmdb` file to actually activate. Not done yet.

## Recently fixed (worth knowing about, not re-introducing)

- A real production crash in `/stats`: a leaderboard entry with a missing/malformed `serverId` threw inside a template string (`.slice()` on `undefined`), and because `res.writeHead()` had already run, the error handler couldn't even send a clean fallback response. Fixed with a `displayNameFor()` helper that never throws, plus restructuring routes to compute the full body before `writeHead()`. See `external-integrations.mdc` and the core rule for the general lessons.
- Browser Uptime column rendered "—" on every row: ranking stamped `rankScore` onto the roster but not `uptimePercent`, so row rendering had nothing to show. Fixed by stamping 7-day uptime (and avg population %) in the same ranking pass. A regression test fails if a history-backed row renders an em-dash uptime.
