
# HANDOFF.md — Architect session bootstrap
Read TRIO.md + PROJECT_STATUS.md first. This file covers what they don't.

## State (2026-08-17)
LIVE at https://arkhelper.info (Cloudflare proxied, SSL Full-strict).
652 tests passing. Owner: Brian (gitstump on GitHub, ebtstumps on
Discord). Repo public: github.com/gitstump/ArkHelper (master).

## Recently shipped (all live)
Maps suite; unofficial servers Phase A (~56k tracked, aggregate
counters, source= browser toggle, five-card hero band with combined
players); nav dropdown close fix (the project's only client-side JS);
CDN info feeds (rates + news pages, rate-change log); GeoLite2
country enrichment (Region column/filter, /leaderboards/regions,
MaxMind footer attribution).

## Queue
1. Mods Phase 1 brief is WRITTEN (self-sourced ModIDs adoption
   leaderboard, no external API) — held until the CurseForge API key
   application resolves so Phases 1+2 can batch. Applied via
   console.curseforge.com; human-reviewed, takes days.
2. Guides — the writing track.
3. Alerts multi-channel design — Architect+Owner design session
   BEFORE any Builder work. Flagship Tier 2 differentiator.
4. Tier 4 wiki tools — reference bar is wikily.gg/ark-survival-
   ascended (commands/items/dinos/interactive maps); clean-room from
   game-file facts only; needs a dedicated research pass. Long-term
   play: merge our live server layer with a game-data map layer —
   nobody in the space has both.
5. Unofficials Phase B — per-cycle history for favorited/viewed
   unofficials only.
Also pending: logo; Wildcard fan-content policy check before ANY game
imagery (news page is text-only until then); cheap follow-up —
officialserverstatus.ini cross-check on /is-ark-down (feeds infra
exists).

## Ops (not in repo docs)
- Droplet: DO "ArkHelper", 159.223.188.54, Ubuntu 24.04, 2GB + 2GB
  swap, weekly DO backups ON. Code at /opt/arkhelper. Memory after
  unofficial pipeline: ~616Mi used, 0 swap — healthy, ~3x headroom.
- Both systemd units use EnvironmentFile=/etc/arkhelper.env
  (discovery gained it for GEOLITE2_DB_PATH, 2026-08-17).
- GeoLite2: geoipupdate configured (/etc/GeoIP.conf), weekly cron
  Wed 05:00; db at /var/lib/GeoIP/GeoLite2-Country.mmdb.
- SSH from Brian's PC: `ssh arkhelper` (config alias, key
  arkhelper_ed25519). Deploy: accept -> git add . -> commit -> push
  -> ssh arkhelper -> /root/deploy.sh (pull, install, test, restart;
  aborts on test failure).
- Caddy proxies arkhelper.info + www -> :8793; discovery :8792
  internal-only; UFW SSH/80/443. Discord OAuth redirect:
  https://arkhelper.info/auth/discord/callback

## Hard-won context
- Owner is learning git/ops: exact commands, one line at a time,
  short lines, spell out -m; paste-mangling is common.
- Wiki content is CC BY-NC-SA: NEVER reuse wiki text/images.
  Clean-room data + original prose/assets only.
- Bar: arkstatus.com full public parity = neutral; BattleMetrics
  PUBLIC pages; wiki TOOLS at Wikily-class quality, clean-room.
  RCON permanently out of scope.
- Dark theme, teal accent #2ec4b6 is permanent identity — do not
  converge with competitors.
- Verify external endpoints live before speccing; live formats drift
  from wiki docs (news.ini did). Builder discover-then-build works
  well for data questions.
- Architect should clone the public repo in its sandbox, run the
  suite, and review real code before verdicting anything substantial.
## Ops

Both systemd units use EnvironmentFile=/etc/arkhelper.env (discovery gained it for GEOLITE2_DB_PATH, 2026-08-17).
