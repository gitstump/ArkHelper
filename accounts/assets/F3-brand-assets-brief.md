# BUILDER BRIEF — F3: Serve brand assets (favicon, touch icons, social card)

You are the Builder in the TRIO protocol. Read `PROJECT_STATUS.md` and
`ARCHITECTURE.md` first, honor `.cursor/rules/` at all times, and follow
this brief exactly. Produce a COMPLETION REPORT in the required format
(TESTS / BUILT / DECISIONS / BLOCKED-UNCERTAIN / COMMIT) when done.

## PRECONDITION (verify before doing anything)

The Owner has placed eight binary files in `accounts/assets/`:
`favicon.ico`, `favicon-16.png`, `favicon-32.png`,
`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`,
`og-image.png`, `logo-full.png`.
If that directory or any file is missing, STOP and report BLOCKED —
do not generate, download, or substitute any image.

## Context

ArkHelper now has an original logo (Owner-produced, consistent with
the imagery policy: original brand assets). The accounts service
currently serves no static files and the page shell emits no favicon
or social-card tags. This brief adds a strict whitelist static
handler and the corresponding `<head>` tags. The favicon files use a
tighter "A" mark for legibility; larger icons and the social card use
the full logo — do not swap them.

Full-tree sweep (done at prep): no existing tests assert favicon,
og:, or `/assets` anything; `accounts/layout.js` head currently has
only charset, viewport, title, and optional description; no
readFile/static machinery exists in `accounts/auth_service.js`.

## Part 1 — Static handler (`accounts/auth_service.js`)

- At startup, load the eight files SYNCHRONOUSLY into an in-memory
  Map keyed by URL path (total ~2MB — acceptable). Whitelist EXACT
  paths only; nothing is read from the filesystem per-request and no
  user input ever touches a filesystem path:
  - `/favicon.ico` → `favicon.ico`, `image/x-icon`
  - `/assets/favicon-16.png` → `image/png`
  - `/assets/favicon-32.png` → `image/png`
  - `/assets/apple-touch-icon.png` → `image/png`
  - `/assets/icon-192.png` → `image/png`
  - `/assets/icon-512.png` → `image/png`
  - `/assets/og-image.png` → `image/png`
  - `/assets/logo-full.png` → `image/png`
- Responses: 200 with correct `Content-Type`,
  `Cache-Control: public, max-age=86400`, and `Content-Length`.
- Any other `/assets/...` path: the existing 404 handling.
- Asset directory path resolved relative to the module
  (`path.join(__dirname, 'assets')`), overridable via an injectable
  option (e.g. `assetsDir`) consistent with the DI convention, so
  tests can point at a fixture dir if they need to — default remains
  the real directory.

## Part 2 — Head tags (`accounts/layout.js`)

In the `<head>` block, after the viewport meta, add (order fixed):

```
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
<meta property="og:site_name" content="ArkHelper">
<meta property="og:type" content="website">
<meta property="og:title" content="<PAGE TITLE, escaped>">
<meta property="og:image" content="<ORIGIN>/assets/og-image.png">
<meta name="twitter:card" content="summary_large_image">
```

- `<PAGE TITLE>` is the same value already used for `<title>`.
- `<ORIGIN>` comes from the existing `origin.js` helper — og:image
  must be an absolute URL. If the page has a meta description, also
  emit it as `og:description` beside the existing description meta.
- SVG endpoints (badges, heatmaps) don't use the shell and are
  untouched.

## Part 3 — Tests

In `accounts/auth_service.test.js`:
- `GET /favicon.ico` → 200, `image/x-icon` content type, non-empty
  body, cache header present.
- `GET /assets/og-image.png` → 200, `image/png`.
- `GET /assets/does-not-exist.png` → 404.
- Any HTML page contains the `rel="icon"` link, the
  `apple-touch-icon` link, an `og:image` whose value starts with the
  configured origin, and the twitter card meta.

In `accounts/layout.test.js`:
- The rendered head contains the favicon links and og:title matching
  the page title.

## NON-GOALS (binding)

- No image generation or modification — the eight files are used
  byte-for-byte as provided.
- No web app manifest / PWA wiring (icons are served for future use
  only).
- No replacement of the text wordmark in the header nav — the nav
  keeps the current text link; the logo is not inserted into page
  bodies anywhere in this brief.
- No generic static-file middleware, directory listing, or serving
  of anything outside the eight whitelisted paths.
- No new dependencies, no client JS.
- No changes to any file other than `accounts/auth_service.js`,
  `accounts/layout.js`, their two test files, and
  `PROJECT_STATUS.md`.

## DONE MEANS

- All eight assets served at the exact whitelisted paths with correct
  types and cache headers; everything else under `/assets` 404s.
- Every HTML page carries the favicon/touch-icon links and og/twitter
  tags with an absolute og:image URL.
- `node --test` fully green.
- `PROJECT_STATUS.md`: "Logo and original brand assets" moves from
  open items to done — one line added under the Shared UI bullet
  (original logo; favicon/touch icons/social card served from a
  whitelisted static handler); last-updated date and test count
  updated.
- Completion report in the required format, including the COMMIT
  line.
