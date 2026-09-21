import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packState } from '../lib/jev.mjs';

test('packState keeps a deep-hit excerpt when excerptStartLine is set', () => {
  const excerpt = Array.from({ length: 61 }, (_, i) => `HIT-${470 + i}`).join('\n');
  const { state } = packState({
    id: 'f.js::<file>::?',
    file: 'f.js',
    symbol: '?',
    excerpt,
    symbolLine: 500,
    excerptStartLine: 470,
    evidence: [{ kind: 'code', file: 'f.js', line: 500, text: 'HIT-500' }],
  });
  assert.match(state, /EXCERPT:/);
  assert.match(state, /HIT-500/);
  assert.doesNotMatch(state, /HIT-1\b/);
});

test('packState still shows an excerpt when excerptStartLine is missing', () => {
  const { state } = packState({
    file: 'a.js',
    excerpt: 'first\nTODO: later\nthird',
    symbolLine: 2,
  });
  assert.match(state, /TODO: later/);
});

test('packState redacts credentials before they reach the judge state', () => {
  const { state, redactions } = packState({
    file: 'a.js',
    excerpt: 'const api_key = "EXAMPLE_KEY_NOT_REAL_12345";',
  });
  assert.ok(!state.includes('EXAMPLE_KEY_NOT_REAL_12345'));
  assert.ok(state.includes('[REDACTED:credential]'));
  assert.equal(redactions[0].class, 'credential');
});
