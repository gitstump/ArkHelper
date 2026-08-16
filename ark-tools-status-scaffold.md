# Ark Tools — Status & Alerts Module: Project Scaffold

Sibling tool to the spam-key map console. Together they make up **Ark Tools**.
This doc is the working spec — I'll build phase by phase against it and flag
anything that needs your input or an outside decision.

**v3 note:** Checked the actual pages instead of guessing. Your hunch about
the content was mostly right: News is a cached mirror of Wildcard's own
patch-note feed (with attribution), Rates is a poller against Wildcard's
published config, and Mods is just an aggregation of data the historian
already collects (server queries already return active mod IDs). None of
that is writing — it's the same kind of engineering as the rest of this
doc. The one piece that IS genuine original writing is the Guides section
(Beginner's, Boss Strategies, etc.) — real strategy content, confirmed by
reading it. You said content is "possibly" in scope — given most of it
turned out to be data engineering rather than writing, I'm treating it as
in scope by default now, with Guides broken out as its own phase since
it's a different kind of work.

## Success bar

- **Failure**: shipping with any capability gap vs. arkstatus.com's actual feature set.
- **Neutral baseline**: full feature parity, covering the **entire official ARK network — both PvP and PvE**.
- **Success**: baseline met, plus added functionality, with nothing degraded. Your + friends' servers, favorites, and per-user alerts sit on top of the full official list — same relationship arkstatus.com has between "browse everything" and "your favorites."

**On dino counts specifically**: I checked — arkstatus.com doesn't actually show live wild/tamed dino counts per server. That data requires RCON/admin access, which they don't have on official servers (they're not affiliated with Wildcard). Their "Taming Calculator" / "Breeding Calculator" are static game-data tools (stat math for any of 323 creatures), not live in-server counts. So this isn't a gap — it's not part of their feature set to match. It *would* be possible for servers you or friends actually own/admin (you'd have RCON there), as a Phase 9 stretch beyond arkstatus.com parity, not baseline.

## Parity checklist (from a direct pass over arkstatus.com)

### Server list / browser
- Live counters: online servers, players online, average ping, official server count
- Filters: map (huge list incl. modded maps), game mode (PvE/PvP), country/region, status (online/offline), platform (PC/Xbox/PlayStation/Windows Store/Console Only), transfers (char/item/all/none), server type (official/unofficial), server access (public/passworded), player count range, ping range, min uptime %, cluster ID, hide temporary/seasonal servers
- Sort: rank, name, players (asc/desc), ping (asc/desc)
- Presets: built-in (Low Ping, High Pop, PvP Only, PvE Only) + custom, saved locally or to account
- Favorites tabs (All/Official/Unofficial)
- Multi-select compare tool
- Pagination at full network scale

### Per-server detail page
- Live status, in-game day count, version, IP:port
- Favorite / Watchlist / Share / "Report issue"
- **Per-user watch alerts**: notify when online, notify on down/restart, under-capacity-% alert, min-free-slots alert — each independently toggleable
- Global rank + percentile, out of the full tracked network
- Player & latency timeline chart, multiple windows (12h/24h/48h/3d/7d), with typical-range band, capacity line, offline/no-response markers
- Peak-times weekly heatmap
- Downtime-patterns weekly heatmap + list of longest recent outages
- Rank-neighborhood table (closest-ranked servers, with 7d trend)
- Server facts panel (mode, platform, transfers, current uptime streak, average session length, server ID)
- Embeddable live status badge (SVG, auto-refreshing) + markdown snippet
- Activity/change log: version bumps, transfer-setting changes, **wipe detection** (day-count reset to 1 after day 3+)
- Same-cluster browsing, "nearby outposts" (same map/mode/region)

### Ranking algorithm
- Composite score per server: Reliability 45% (uptime), Community Activity 35% (7-day avg players + peak influence), Connection Stability 20% (ping jitter)
- Password-protected servers excluded from ranking; updates hourly over a rolling 7-day window; servers need minimum history before being ranked

### Network-wide stats & leaderboards
- Official/unofficial statistics pages (server count, mode/map/platform distribution)
- Game Mode Leaderboard, Regional Leaderboard, Map Uptime Leaderboard, general Leaderboards
- Player Statistics, Population Trends, API Statistics

### Incident / status
- "Is ARK Down?" page distinguishing Wildcard/Nitrado/Epic-wide incidents from single-server issues
- Official network status page (active incidents, regional availability bars, pipeline-freshness indicator)

### Accounts & platform
- Discord OAuth login
- Per-account saved presets and favorites, shareable
- Public REST API + documentation
- Dark/light/system theme toggle
- Multi-language UI (EN/ES/FR/DE)
- Optional analytics consent banner

### "Content" section — checked each piece directly, it's not one bucket

Your hunch was right for most of it, wrong for one part. Checked actual pages:

**Data-sourced, not authored (this is engineering, not writing):**
- ASA News — explicitly labelled "cached for fast page loads," RSS-fed, every entry tagged "Official source: survivetheark." This is mirroring Wildcard's own forum feed with attribution, not original writing.
- Mods listing — this isn't sourced externally at all. Server queries already return each server's active mod IDs as part of the same data your historian already polls; the "Mod Observatory" is just aggregating counts (servers/players/clusters per mod) from data you're already collecting. Pure derived analytics.
- Rates page — explicitly labelled "fetched from the official configuration," auto-updates every 5 minutes, flags deviations ("8 of 8 multipliers above baseline — likely an official event"). A polling job against Wildcard's published rates, not content.
- "Ready to Join," "Available Now," "Recently Wiped" — all derived from data already being tracked (free slots, day-count resets).
- Per-map pages — mostly live telemetry widgets plus one short descriptive paragraph per map (10 official maps — trivial writing lift).

**Genuinely authored (real writing effort, checked and confirmed):**
- Guides — Beginner's, Boss Strategies, Breeding & Mutations, Genesis Part 1, Resource Locations, Settings & Performance, Taming. These are real original strategy content — checklists, per-boss tactics, skill-tree breakdowns — not thin wrapper pages. This part is genuinely a writing project, separate from the engineering.
- About, FAQ, Content Policy, Privacy Policy, Terms of Service — standard boilerplate, low effort.
- Breeding Calculator, Taming Calculator — static game-data tools (creature stat math), not live tracking — a data table + formula, not writing.

## Architecture

**Reused as-is (already built, tested):**
- `population_historian.js` — polling, reconciliation, per-server history/baseline
- `source_a2s.js` + BattleMetrics reconciler — data sources
- Console visual language (`population_console.html` dark theme) — carries into the new frontend

**New — core tracking:**
- **Server discovery**: BattleMetrics' server-list API enumerates the full official roster (PvP + PvE) on a schedule, feeding the historian a live roster instead of a hardcoded list
- **Polling at scale**: historian's existing staggered polling extends to the full official roster (low thousands of servers); respects BattleMetrics/A2S rate limits
- **Change/wipe detection**: diff each poll against last-known state (version, transfer settings, day count) to log changes and infer wipes (day count 3+ → 1)
- **Ranking engine**: scheduled job computing the composite score (reliability/activity/stability) over a rolling 7-day window
- **Cluster grouping**: group servers sharing a cluster ID for the "same cluster" panel

**New — platform:**
- **Auth**: Discord OAuth2
- **DB**: SQLite — accounts, favorites, per-user alert config, filter presets, change log. Existing JSON/ring-buffer history stays as-is, joined by server ID.
- **Backend**: small Node REST API + auth middleware, same zero-dependency style as the rest of the toolkit; this API can also be the public API surface if you want that later
- **Incident detector**: poller against Epic/Nitrado public status endpoints, separating "your server is down" from "ARK itself is down"
- **Badge generator**: small endpoint rendering a live SVG status badge per server
- **Frontend**: multi-page app — browser/list, server detail, leaderboards/stats, incident page, account/alerts settings
- **Hosting**: needs to be reachable outside your LAN — VPS, or home server behind a tunnel + domain

**New — content-as-data feeds (engineering, not writing):**
- **News mirror**: poll Wildcard's official patch-note feed/forum, cache with attribution, RSS out
- **Rates poller**: poll official rate configuration, diff against baseline to detect events, auto-refresh
- **Mod adoption**: derive mod-usage aggregates from mod IDs already present in server query responses — no new data source needed
- **Derived lists**: Ready to Join / Available Now / Recently Wiped — filters over data already tracked

**New — genuinely authored (writing effort, separate track from engineering):** the Guides section and per-map descriptive blurbs. Real content work, worth scheduling as its own phase since it doesn't block or get blocked by the engineering phases.

## Phases

0. **Decisions needed from you** (blocking, see below)
1. Server discovery — full official roster (PvP + PvE) via BattleMetrics, staggered polling at that scale
2. Auth + DB foundation
3. Server browser / list page (filters, sort, presets, compare)
4. Server detail page + uptime history + peak/downtime heatmaps
5. Change/wipe detection + ranking engine + cluster grouping
6. Leaderboards & network stats pages
7. Incident/status page
8. Favorites + per-user watch alerts (online/down/capacity/slots) + badge generator
9. News mirror + Rates poller + Mod adoption + derived lists (Ready to Join/Available Now/Recently Wiped) — all data-engineering, same track as 1–8
10. Hosting + deployment
11. Guides + map blurbs — real writing, runs independently of 1–10, can start anytime
12. Stretch (success-tier, only after 0–11 are solid): unofficial servers too, dino/tame counts for servers you actually admin, cross-link into the map console and raid-watch stack, mobile-friendly layout, public API docs

I'll build in that order, testing each phase the same way as the rest of the toolkit (unit tests, no game/live dependency required until final wiring).

## What I need from you (Phase 0)

- **Discord OAuth app** — has to be created under your Discord account; I can walk you through it but can't create it myself
- **Hosting call** — VPS vs. home server + tunnel + domain; I'll size the recommendation once discovery (Phase 1) tells us the actual official server count
- **Friend servers list** — host:port or BattleMetrics ID for each, for favoriting once accounts exist
- **Domain name** (if you want one) — purchase is on you, DNS setup I can help with

## Honest timeline note

The v1 estimate ("about a week") was based on an undersized picture of the site. With the real feature list — ranking algorithm, wipe/change detection, cluster grouping, heatmaps, badges, leaderboards, full official-network scale — this is a genuinely multi-week build even before any editorial content. I'd rather say that plainly now than have the estimate quietly slip later.

## Autonomy model

I'll work through the phases without stopping for approval at each step, and only surface things that are genuinely blocking (an account I can't create, a payment/purchase decision, a design choice with real tradeoffs). Everything else — code, schema, UI — I'll just build and show you finished.
