#!/usr/bin/env node
'use strict';

/**
 * theme.js
 *
 * Shared design tokens and base stylesheet. Every HTML page injects
 * THEME_CSS; page modules add only the rules they uniquely need.
 * Tokens live as CSS variables so a later tweak is one edit.
 */

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const THEME_CSS = `
:root {
  --bg: #101417;
  --surface: #181d21;
  --border: #2a3238;
  --text: #e8eef2;
  --muted: #8b97a3;
  --accent: #2ec4b6;
  --online: #3dd68c;
  --offline: #e85d4c;
  --degraded: #e6a23c;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --radius: 6px;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  line-height: 1.5;
  min-height: 100vh;
}
a { color: var(--accent); }
a:hover { color: #5ee0d4; }
h1, h2, h3 { font-weight: 650; line-height: 1.25; }
h1 { font-size: 1.35rem; margin: 0 0 var(--space-4); }
h2 { font-size: 1.05rem; margin: var(--space-5) 0 var(--space-3); color: var(--text); }
h1 a, h2 a { text-decoration: none; }
.site { min-height: 100vh; display: flex; flex-direction: column; }
.site-header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: var(--space-3) var(--space-5);
}
.header-inner {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-5);
}
.brand { display: flex; flex-direction: column; gap: 2px; min-width: 12rem; }
.wordmark {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--text);
  text-decoration: none;
  display: inline-block;
  line-height: 0;
}
.wordmark:hover { color: var(--accent); }
.wordmark-logo { display: block; border-radius: 6px; }
.wordmark:hover .wordmark-logo { filter: brightness(1.12); }
.tagline { margin: 0; color: var(--muted); font-size: 0.78rem; }
.nav { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); align-items: center; flex: 1; }
.nav a, .nav summary {
  color: var(--muted);
  text-decoration: none;
  font-size: 0.92rem;
  padding: var(--space-1) 0;
  border-bottom: 2px solid transparent;
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
  font-family: inherit;
}
.nav a:hover, .nav summary:hover { color: var(--text); }
.nav a.active, .nav summary.active { color: var(--accent); border-bottom-color: var(--accent); }
.nav-drop { position: relative; }
.nav-drop > summary {
  list-style: none;
  cursor: pointer;
}
.nav-drop > summary::-webkit-details-marker { display: none; }
.nav-drop > summary::marker { content: none; }
.nav-drop > summary::after { content: " \\25BE"; font-size: 0.75em; }
.nav-menu {
  display: none;
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  min-width: 13rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-2);
  z-index: 40;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
  flex-direction: column;
  gap: 2px;
}
.nav-drop:hover > .nav-menu,
.nav-drop:focus-within > .nav-menu,
.nav-drop[open] > .nav-menu {
  display: flex;
}
.nav-menu a {
  display: block;
  padding: var(--space-2) var(--space-3);
  border-bottom: none;
  border-radius: 4px;
  white-space: nowrap;
}
.nav-menu a:hover { background: var(--bg); color: var(--text); }
.nav-menu a.active { border-bottom: none; background: var(--bg); }
.nav-menu.nav-menu-cols {
  flex-wrap: wrap;
  min-width: 22rem;
  max-width: 28rem;
}
.nav-menu.nav-menu-cols a {
  flex: 0 0 50%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.platform-badge {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 7px;
  margin-left: var(--space-2);
  vertical-align: middle;
  white-space: nowrap;
}
.auth { margin-left: auto; display: flex; align-items: center; gap: var(--space-3); font-size: 0.88rem; }
.auth form { margin: 0; }
.site-main {
  flex: 1;
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
  padding: var(--space-5) var(--space-5) var(--space-6);
}
.site-footer {
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding: var(--space-5);
  color: var(--muted);
  font-size: 0.85rem;
}
.footer-inner { max-width: 1100px; margin: 0 auto; }
.footer-cols {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-5);
}
.footer-cols h2 { margin: 0 0 var(--space-3); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text); }
.footer-cols ul { list-style: none; margin: 0; padding: 0; }
.footer-cols li { margin: 0 0 var(--space-2); }
.footer-cols a { color: var(--muted); text-decoration: none; }
.footer-cols a:hover { color: var(--accent); }
.footer-attrib { margin: var(--space-3) 0 0; font-size: 0.72rem; color: var(--muted); line-height: 1.4; }
.footer-attrib a { color: var(--muted); }
.footer-disclaimer { margin: var(--space-5) 0 0; padding-top: var(--space-4); border-top: 1px solid var(--border); font-size: 0.78rem; color: var(--muted); }
.footer-disclaimer p { margin: 0; }
.footer-disclaimer p + p { margin-top: var(--space-2); }
table { width: 100%; border-collapse: collapse; margin-top: var(--space-3); }
th, td { text-align: left; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 600; font-size: 0.82rem; }
th a { color: var(--text); text-decoration: none; }
td.num, th.num, .num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.note { color: var(--muted); font-size: 0.9rem; }
.counters { color: var(--muted); }
button, .btn {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 0.95rem;
  font-family: inherit;
}
button:hover { border-color: var(--accent); color: var(--accent); }
input, select {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  padding: var(--space-2);
  border-radius: var(--radius);
  font-family: inherit;
}
@media (max-width: 1280px) {
  .tagline { display: none; }
}
@media (max-width: 700px) {
  .footer-cols { grid-template-columns: repeat(2, 1fr); gap: var(--space-4); }
  .auth { margin-left: 0; width: 100%; }
  .nav-menu.nav-menu-cols { min-width: 16rem; max-width: calc(100vw - 2rem); }
}
@media (max-width: 480px) {
  .footer-cols { grid-template-columns: 1fr; }
}
`.trim();

module.exports = { THEME_CSS, escapeHtml };
