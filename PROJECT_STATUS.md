# ArkHelper — Project Status

Last updated: 2026-08-16 — 457 tests passing — In flight: none

*Update this file whenever a phase completes or priorities shift. Any new agent session should read this first. Keep the "Last updated" line current at every update.*

## Success bar

Full public-feature parity with arkstatus.com is the neutral baseline — falling short is failure, matching is neutral. Success additionally means: parity with BattleMetrics' PUBLIC pages (server stats/graphs; their RCON/admin suite is explicitly OUT of scope), and parity with the ARK wiki's TOOLS (calculators, reference data, maps) built clean-room from game facts and original assets — the wiki's CC BY-NC-SA license means we never copy its text or images. Exceeding all of this without degrading anything is the actual goal.

Live wild/tamed dino counts on official servers are **not** a parity item — arkstatus.com does not show them (they need RCON/admin access, which neither they nor we have on official). Their taming/breeding calculators are static creature-stat tools, not live in-server counts. Those calculators belong under the wiki-tools success bar above, built clean-room.

## What's built and working (live-verified, not just tested)

- **Discovery** (`discovery/`) — full official ARK:SA roster (~3,189 servers as of last live run), no API key needed, refreshing on a schedule, history recording (uptime tracking, wipe/version change detection, peak-time and downtime-pattern heatmaps).
- **Accounts** (`accounts/`) — real Discord OAuth login, SQLite-backed accounts/sessions.
- **Homepage** — login state, live roster stats.
- **Server browser** (`/servers`) — search, filter (map/mode/password/player range), sort, pagination.
- **Filter presets** — named snapshots of the current browser query string. Logged-out: up to 3 in an HttpOnly cookie (~2KB guard). Logged-in: up to 15 in SQLite, cookie presets migrate on login (name collisions skipped), shareable via public `/p/<token>` → `/servers?...` redirects.
- **Server detail pages** (`/servers/:id`) — full facts, uptime %, history table, activity log (wipe/version changes), peak-time & downtime heatmaps (inline SVG), embeddable live-status badge (`/servers/:id/badge.svg`) with markdown/HTML snippets.
- **Favorites** — add/remove per account, `/favorites` page. This is the actual point of having accounts at all — confirmed working end to end.
- **Stats & leaderboards** (`/stats`) — network breakdowns (mode/map/platform/cluster), most-populated-servers leaderboard, uptime leaderboard, and a preview of the composite ranking (see Rankings below).
- **Rankings** (`/rankings`) — composite rank score 0–100 per official server, recomputed every discovery cycle (40% 7-day uptime + 25% ping quality + 25% mean population % + 10% history-age confidence). Surfaced as a Rank sort in the server browser, a rank badge on each detail page, and a top-100 leaderboard with score breakdowns. Pure scorer lives in `discovery/ranking.js`; scores are stamped onto the roster feed so accounts doesn't need a second query.
- **Incident detection & status** (`/is-ark-down`, alias `/status`) — each discovery cycle classifies the official network as NORMAL / DEGRADED / OUTAGE / UPDATE_ROLLOUT from roster presence, 24h offline baseline, version-change coverage, and consecutive CDN fetch failures. Incidents persist in the history SQLite (hysteresis: 3 consecutive NORMAL cycles to close). The public page renders the latest stored snapshot (`Cache-Control: public, max-age=30`), not a per-request recompute.

## Explicitly paused (not forgotten, not blocking)

- **Alert dispatch** — settings UI + storage exist (notify on down/back-online, capacity threshold, min free slots), but nothing sends anything yet. Deliberately held pending a multi-channel design (Discord, email, SMS, in-page) instead of building Discord-only and having to redo it.

## Known real gaps vs. arkstatus.com (confirmed via a live re-scan, not guessed)

- Rank/percentile neighborhood on individual detail pages (the discovery endpoint exists — `/rankings/:id` — the detail page now shows a rank-score badge, but not the nearby-ranked-servers table)
- Full leaderboard suite: per-map and per-region leaderboard variants (we have one global ranked list, not the "leaderboards for every map/region" pattern arkstatus uses)
- Compare tool (multi-select servers side by side)
- Wider filter set in the browser UI: country/region (GeoLite2 is built but not configured — see below), ping range, min uptime %, cluster ID filter
- News mirror, rates poller, mod-adoption aggregation, derived lists (Ready to Join / Available Now / Recently Wiped) — all confirmed to be data-engineering, not writing, when researched; still unbuilt
- Public API docs, theme toggle (dark-only currently), i18n (English-only)
- Unofficial server tracking — explicitly deferred as a stretch goal, not baseline
- Guides content (and short per-map blurbs) — the one genuinely-writing (not coding) piece of the whole project, separate track

## Infrastructure not yet done

- **Deployment** — DigitalOcean droplet ("ArkHelper") is provisioned and reachable, but the app has never actually been deployed to it. Everything has run on a local machine so far.
- **GeoLite2** — `geo_lookup.js` is built and tested, but needs a MaxMind account + license key + downloaded `.mmdb` file to actually activate. Not done yet.

## Recently fixed (worth knowing about, not re-introducing)

- A real production crash in `/stats`: a leaderboard entry with a missing/malformed `serverId` threw inside a template string (`.slice()` on `undefined`), and because `res.writeHead()` had already run, the error handler couldn't even send a clean fallback response. Fixed with a `displayNameFor()` helper that never throws, plus restructuring routes to compute the full body before `writeHead()`. See `external-integrations.mdc` and the core rule for the general lessons.
