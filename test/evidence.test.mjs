import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachEvidence } from '../lib/evidence.mjs';

test('attachEvidence keeps code/pattern lines and symbolLine', () => {
  const items = attachEvidence({
    file: 'a.js', symbolLine: 4,
    evidence: [
      { kind: 'code', file: 'a.js', line: 4, text: 'foo()' },
      { kind: 'context', file: 'a.js', line: 4, text: 'noise' },
      { kind: 'pattern', file: 'b.js', line: 9, text: 'eval(' },
    ],
  });
  assert.deepEqual(items.map((i) => `${i.kind}:${i.file}:${i.line}`), [
    'code:a.js:4',
    'pattern:b.js:9',
  ]);
});

test('attachEvidence accepts numeric strings and drops junk', () => {
  const items = attachEvidence({
    file: 'a.js', symbolLine: '3',
    evidence: [{ kind: 'code', file: 'a.js', line: '3', text: 'x' }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].line, 3);
});

test('invalid lines are dropped', () => {
  assert.deepEqual(
    attachEvidence({ file: 'a.js', symbolLine: 0, evidence: [{ kind: 'code', file: 'a.js', line: -1 }] }),
    [],
  );
});
