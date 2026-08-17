# ArkHelper

ArkHelper tracks the official ARK: Survival Ascended server network: it pulls Wildcard's public roster, records history, and serves a dark, server-rendered site for browsing, ranking, and watching those servers — with Discord login for favorites and saved filters. Full public-feature parity with arkstatus.com is the baseline; unofficial servers and RCON/admin tools are out of scope.

## Production

Live at **https://arkhelper.info**. It runs on a DigitalOcean droplet behind Caddy/HTTPS as two systemd services. Deployment details live in `PROJECT_STATUS.md`.

## Features

- **Server browser** (`/servers`) — search, filter, sort, and paginate the live official roster
- **Rankings** (`/rankings`) — composite 0–100 rank per official server, plus a Rank sort in the browser
- **Filter presets** — named snapshots of the current browser query (cookie while logged out, SQLite once logged in), shareable via `/p/<token>`
- **Incidents / Is ARK down?** (`/is-ark-down`, alias `/status`) — NORMAL / DEGRADED / OUTAGE / UPDATE_ROLLOUT from discovery-cycle snapshots
- **Rates** (`/rates`) — live official-network multipliers and recent changes
- **News** (`/news`) — launcher news as text and links (no Wildcard imagery)
- **Favorites** — per-account add/remove and a `/favorites` page
- **Alerts** — per-server settings, an in-page `/alerts` feed, and optional Discord webhook delivery (email/SMS dropped)
- **Badges** — embeddable live-status SVG at `/servers/:id/badge.svg`

## Setup

Requires **Node 22+** (uses the built-in `node:sqlite` module).

```
npm install
```

That installs `maxmind` (GeoLite2 lookups) at the repo root. Country enrichment is optional until a GeoLite2 `.mmdb` file is configured.

### Environment variables

Names only — never commit values. The services read `process.env` directly (no `.env` loader).

**Required to start the accounts service:**

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`

**Also read by the code (optional; defaults in parentheses):**

- `AUTH_PORT` (8793)
- `DISCORD_REDIRECT_URI` (`http://localhost:<AUTH_PORT>/auth/discord/callback`)
- `ARK_TOOLS_DB_PATH` (`ark_tools.db`)
- `ALERTS_ENGINE` (unset = off; `1` starts the alert evaluator + Discord webhook dispatcher on a 75s timer — set this in the prod env file)
- `SITE_ORIGIN` (`https://arkhelper.info` — used in Discord webhook message footers)
- `HISTORY_DB_PATH` (`ark_history.db`)
- `GEOLITE2_DB_PATH` (unset — discovery runs without country fields)
- `UNOFFICIAL_INTERVAL_MS` / `UNOFFICIAL_DB_PATH` (15 minutes / `unofficial.sqlite`)
- `INFO_INTERVAL_MS` / `INFO_DB_PATH` (10 minutes / `feeds.sqlite`)

Discovery's HTTP port and refresh interval are CLI flags, not env vars (`--port`, `--interval-minutes`, `--info-interval`).

## Running

Two processes. From the repo root:

```
node discovery/discovery_service.js run
node accounts/auth_service.js
```

- Discovery listens on **8792** (roster, history, rankings, incident snapshot). One-shot: `node discovery/discovery_service.js discover-once`.
- Accounts listens on **8793** (or `AUTH_PORT`). Open `http://localhost:8793/`. It fetches discovery at `http://localhost:8792` and degrades if that service is down.

## Tests

From the repo root:

```
node --test
```
