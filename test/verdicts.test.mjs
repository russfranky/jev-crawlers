import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExpired, verdictDate, loadVerdicts, FINGERPRINT_RE } from '../lib/verdicts.mjs';

test('isExpired is false without expires and true when past', () => {
  assert.equal(isExpired({}), false);
  assert.equal(isExpired({ expires: null }), false);
  assert.equal(isExpired({ expires: '2000-01-01T00:00:00.000Z' }), true);
  assert.equal(isExpired({ expires: '2999-01-01T00:00:00.000Z' }), false);
});

test('verdictDate prefers created over date', () => {
  assert.equal(verdictDate({ created: 'A', date: 'B' }), 'A');
  assert.equal(verdictDate({ date: 'B' }), 'B');
  assert.equal(verdictDate({}), '');
});

test('loadVerdicts returns [] for a missing file', () => {
  assert.deepEqual(loadVerdicts('/no/such/fp-verdicts.json'), []);
});

test('fingerprint regex matches sha256 hex', () => {
  assert.ok(FINGERPRINT_RE.test('sha256:' + 'ab'.repeat(32)));
  assert.ok(!FINGERPRINT_RE.test('sha256:xyz'));
  assert.ok(!FINGERPRINT_RE.test('ab'.repeat(32)));
});
