'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  contentHash,
  hashedFileName,
  publishStaticAsset,
  loadStaticData,
  resolveDataUrl,
  MANIFEST_NAME,
  HASH_LENGTH,
} = require('./static_data.js');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arkhelper-static-'));
}

test('identical content yields the same hashed filename', () => {
  const a = Buffer.from('{"ok":true}\n');
  const b = Buffer.from('{"ok":true}\n');
  assert.equal(hashedFileName('crafting-costs', a), hashedFileName('crafting-costs', b));
  assert.equal(contentHash(a), contentHash(b));
  assert.equal(contentHash(a).length, HASH_LENGTH);
  assert.match(hashedFileName('crafting-costs', a), /^crafting-costs\.[a-f0-9]{12}\.json$/);
});

test('a one-byte change yields a different hashed filename', () => {
  const a = Buffer.from('{"ok":true}\n');
  const b = Buffer.from('{"ok":truE}\n');
  assert.notEqual(hashedFileName('crafting-costs', a), hashedFileName('crafting-costs', b));
});

test('publish writes the hashed file and the manifest entry', () => {
  const dir = tempDir();
  const content = Buffer.from('{"items":[]}\n');
  const published = publishStaticAsset({
    dir,
    logicalName: 'crafting-costs',
    content,
  });
  assert.equal(published.filename, hashedFileName('crafting-costs', content));
  assert.equal(fs.readFileSync(published.filePath).equals(content), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_NAME), 'utf8'));
  assert.equal(manifest['crafting-costs'], published.filename);
});

test('publish updates only the requested key and keeps sibling entries', () => {
  const dir = tempDir();
  const first = publishStaticAsset({
    dir,
    logicalName: 'crafting-costs',
    content: Buffer.from('craft-v1\n'),
  });
  const second = publishStaticAsset({
    dir,
    logicalName: 'demolish-refunds',
    content: Buffer.from('demo-v1\n'),
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_NAME), 'utf8'));
  assert.equal(manifest['crafting-costs'], first.filename);
  assert.equal(manifest['demolish-refunds'], second.filename);
});

test('cleanup removes superseded hashed files and keeps the current one', () => {
  const dir = tempDir();
  const first = publishStaticAsset({
    dir,
    logicalName: 'crafting-costs',
    content: Buffer.from('v1\n'),
  });
  const second = publishStaticAsset({
    dir,
    logicalName: 'crafting-costs',
    content: Buffer.from('v2\n'),
  });
  assert.deepEqual(second.deleted, [first.filename]);
  assert.equal(fs.existsSync(second.filePath), true);
  assert.equal(fs.existsSync(first.filePath), false);
  const leftover = fs.readdirSync(dir).filter((name) => name.startsWith('crafting-costs.'));
  assert.deepEqual(leftover, [second.filename]);
});

test('cleanup does not delete unhashed files or other logical names', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'crafting_costs.json'), 'legacy\n');
  const other = publishStaticAsset({
    dir,
    logicalName: 'demolish-refunds',
    content: Buffer.from('demo\n'),
  });
  publishStaticAsset({
    dir,
    logicalName: 'crafting-costs',
    content: Buffer.from('v1\n'),
  });
  publishStaticAsset({
    dir,
    logicalName: 'crafting-costs',
    content: Buffer.from('v2\n'),
  });
  assert.equal(fs.existsSync(path.join(dir, 'crafting_costs.json')), true);
  assert.equal(fs.existsSync(other.filePath), true);
});

test('loadStaticData fails clearly when the manifest is missing', () => {
  const dir = tempDir();
  assert.throws(
    () => loadStaticData(dir),
    /static data manifest missing:/
  );
});

test('loadStaticData fails clearly when a required key is absent', () => {
  const dir = tempDir();
  publishStaticAsset({
    dir,
    logicalName: 'crafting-costs',
    content: Buffer.from('only-one\n'),
  });
  assert.throws(
    () => loadStaticData(dir),
    /static data manifest missing key "demolish-refunds"/
  );
});

test('resolveDataUrl matches the manifest entry', () => {
  const dir = tempDir();
  const published = publishStaticAsset({
    dir,
    logicalName: 'crafting-costs',
    content: Buffer.from('{"ok":1}\n'),
  });
  publishStaticAsset({
    dir,
    logicalName: 'demolish-refunds',
    content: Buffer.from('{"ok":2}\n'),
  });
  const loaded = loadStaticData(dir);
  assert.equal(resolveDataUrl('crafting-costs', loaded), `/data/${published.filename}`);
  assert.equal(loaded.assets.get('crafting-costs').url, `/data/${published.filename}`);
});
