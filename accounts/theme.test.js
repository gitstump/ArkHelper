'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { THEME_CSS, escapeHtml } = require('./theme.js');

test('THEME_CSS defines the dark palette, accent, and status tokens', () => {
  assert.match(THEME_CSS, /--bg:\s*#101417/);
  assert.match(THEME_CSS, /--surface:/);
  assert.match(THEME_CSS, /--border:/);
  assert.match(THEME_CSS, /--text:/);
  assert.match(THEME_CSS, /--muted:/);
  assert.match(THEME_CSS, /--accent:\s*#2ec4b6/);
  assert.match(THEME_CSS, /--online:/);
  assert.match(THEME_CSS, /--offline:/);
  assert.match(THEME_CSS, /--degraded:/);
});

test('THEME_CSS two-column nav menus wrap map links', () => {
  assert.match(THEME_CSS, /\.nav-menu\.nav-menu-cols/);
  assert.match(THEME_CSS, /flex:\s*0 0 50%/);
});

test('THEME_CSS uses a system font for prose and a mono stack for figures', () => {
  assert.match(THEME_CSS, /--font:\s*system-ui/);
  assert.match(THEME_CSS, /--font-mono:\s*ui-monospace/);
  assert.match(THEME_CSS, /font-variant-numeric:\s*tabular-nums/);
});

test('THEME_CSS hides the header tagline below 1280px', () => {
  assert.match(THEME_CSS, /@media \(max-width: 1280px\)[\s\S]*?\.tagline \{ display: none; \}/);
});

test('THEME_CSS defines the spacing scale and one radius token', () => {
  assert.match(THEME_CSS, /--space-1:\s*4px/);
  assert.match(THEME_CSS, /--space-2:\s*8px/);
  assert.match(THEME_CSS, /--space-3:\s*12px/);
  assert.match(THEME_CSS, /--space-4:\s*16px/);
  assert.match(THEME_CSS, /--space-5:\s*24px/);
  assert.match(THEME_CSS, /--space-6:\s*32px/);
  assert.match(THEME_CSS, /--radius:\s*6px/);
});

test('escapeHtml from theme matches the homepage helper contract', () => {
  assert.equal(escapeHtml(`<script>alert('x')</script>`), '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
  assert.equal(escapeHtml(undefined), '');
});
