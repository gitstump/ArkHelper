# HANDOFF.md — Architect session bootstrap
Read TRIO.md + PROJECT_STATUS.md first. This file covers what they
don't. Test count and feature state live in PROJECT_STATUS.md — this
file deliberately does not duplicate them.

## State
LIVE at https://arkhelper.info (Cloudflare proxied, SSL Full-strict).
Owner: Brian (gitstump on GitHub, ebtstumps on Discord). Repo public:
github.com/gitstump/ArkHelper (master). Full feature inventory,
success bar, imagery policy, coordinate-data policy, and the gap list
vs arkstatus.com: PROJECT_STATUS.md.

## Ops (not in repo docs)
- Droplet: DO "ArkHelper", 159.223.188.54, Ubuntu 24.04, 2GB + 2GB
  swap, weekly DO backups ON. Code at /opt/arkhelper.
- Both systemd units use EnvironmentFile=/etc/arkhelper.env.
- GeoLite2: geoipupdate configured (/etc/GeoIP.conf), weekly cron
  Wed 05:00; db at /var/lib/GeoIP/GeoLite2-Country.mmdb.
- SSH from Brian's PC: `ssh arkhelper` (config alias, key
  arkhelper_ed25519; the raw-IP form fails). Deploy: accept ->
  git add . -> commit -> push -> ssh arkhelper -> /root/deploy.sh
  (pull, install, test, restart; aborts on test failure).
- Caddy proxies arkhelper.info + www -> :8793; discovery :8792
  internal-only; UFW SSH/80/443. Discord OAuth redirect:
  https://arkhelper.info/auth/discord/callback
- Docs-only commits need no deploy; deploy.sh pulls before the next
  real deploy anyway.

## Working style (matters)
- Owner is learning git/ops: exact commands, one line at a time,
  short lines, spell out flags. Windows/PowerShell: grep is
  Select-String, quoting is hazardous, prefer two -m flags for
  commits. Paste-mangling is common.
- Architect: clone the public repo in sandbox, run the suite, review
  real code before verdicting anything substantial. Verify
  adjacent-system claims (whitelists, invariants, endpoints) by
  grepping code during brief prep — never assert from memory.
- When a brief modifies a shared function or publishes a previously
  planted identifier, grep the WHOLE tree (code and tests) for every
  consumer/reference and name each one in the brief — misses here
  caused the only Builder-side scope surprises to date.
- Parallel Builder sessions ONLY for file-disjoint briefs; flag
  parallel-safe pairs explicitly.
- Content briefs: verbatim prose is the source of truth; test wording
  bends to prose, never the reverse. HTTP coverage lives in
  auth_service.test.js; registry/renderer tests in the module's own
  test files.
- Verify external endpoints live before speccing; live formats drift
  from wiki docs. Scale competitor scans to the task.

## Standing constraints (details in PROJECT_STATUS.md)
- Wiki content is CC BY-NC-SA: NEVER reuse wiki text/images.
  Clean-room data + original prose/assets only. No coordinates
  transcribed from wiki or competitor sites, ever.
- RCON permanently out of scope. BattleMetrics parity = public pages.
- Dark theme, teal accent #2ec4b6 is permanent identity.
- Zero runtime deps (maxmind excepted), no client JS beyond the nav
  script, server-rendered, DI everywhere so tests never touch
  network/clock.
