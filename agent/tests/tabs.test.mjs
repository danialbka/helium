import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connectCode, reuseCode, recordCode, sameUrl } from '../lib/tabs.mjs';

test('sameUrl ignores only a trailing slash', () => {
  assert.equal(sameUrl('https://example.com', 'https://example.com/'), true);
  assert.equal(sameUrl('https://example.com/a/', 'https://example.com/a'), true);
  assert.equal(sameUrl('https://example.com/a?b=1', 'https://example.com/a'), false);
  assert.equal(sameUrl('https://example.com/#one', 'https://example.com/#two'), false);
  assert.equal(sameUrl('https://example.com/a', 'https://example.org/a'), false);
});

test('generated browser code parses and keeps awkward text literal', () => {
  const awkward = 'https://example.com/?q=`${process.exit(1)}`\'"';
  for (const code of [connectCode('a`b${c}', [1, 2]), reuseCode('s', awkward), recordCode('s', awkward)])
    assert.equal(typeof new Function(`return (${code})`)(), 'function');
  assert.ok(reuseCode('s', awkward).includes(JSON.stringify(awkward)));
});

test('connect housekeeping keeps its safety conditions', () => {
  const code = connectCode('s');
  // Never touch a tab a live connection is driving, and close only helper tabs.
  assert.match(code, /getConnectionStatus/);
  assert.match(code, /chrome\.debugger\.getTargets/);
  assert.match(code, /candidates\.filter\(isHelper\)/);
  assert.match(code, /s\.id===t\.id&&s\.url===t\.url/);
});

test('launcher works in the background by default and reuses tabs', () => {
  const source = readFileSync(new URL('../bin/helium-playwright-visible.mjs', import.meta.url), 'utf8');
  assert.match(source, /HELIUM_PLAYWRIGHT_FOREGROUND!=='1'\)env\.HELIUM_PLAYWRIGHT_BACKGROUND='1'/);
  assert.match(source, /args\[0\]==='tab-new'\)tabNew/);
});
