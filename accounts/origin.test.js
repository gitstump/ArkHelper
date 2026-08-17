'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { siteOrigin, DEFAULT_ORIGIN } = require('./origin.js');

test('siteOrigin defaults to https://arkhelper.info', () => {
  assert.equal(DEFAULT_ORIGIN, 'https://arkhelper.info');
  assert.equal(siteOrigin(null), DEFAULT_ORIGIN);
  assert.equal(siteOrigin(''), DEFAULT_ORIGIN);
  assert.equal(siteOrigin(undefined, {}), DEFAULT_ORIGIN);
});

test('siteOrigin honors SITE_ORIGIN and strips a trailing slash', () => {
  assert.equal(siteOrigin(undefined, { SITE_ORIGIN: 'https://custom.example/' }), 'https://custom.example');
  assert.equal(siteOrigin('https://staging.example/'), 'https://staging.example');
  assert.equal(siteOrigin('https://arkhelper.info/'), DEFAULT_ORIGIN);
});

test('siteOrigin strips multiple trailing slashes and treats slash-only as the default', () => {
  assert.equal(siteOrigin('https://example.test///'), 'https://example.test');
  assert.equal(siteOrigin('/'), DEFAULT_ORIGIN);
});
