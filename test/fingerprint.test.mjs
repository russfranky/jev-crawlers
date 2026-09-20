import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingFingerprint, fingerprintPreimage, normRepoPath } from '../lib/fingerprint.mjs';

test('normRepoPath strips leading ./ and backslashes', () => {
  assert.equal(normRepoPath('./src/a.js'), 'src/a.js');
  assert.equal(normRepoPath('src\\a.js'), 'src/a.js');
  assert.equal(normRepoPath(null), '');
});

test('same claim yields same fingerprint; status does not matter', () => {
  const finding = {
    status: 'bug',
    node: {
      file: 'a.js',
      symbolLine: 12,
      evidence: [
        { kind: 'code', file: 'a.js', line: 12, text: 'x' },
        { kind: 'code', file: 'b.js', line: 2, text: 'y' },
      ],
    },
    judgment: { answers: { verdict: { choice: 'report' } } },
  };
  const flipped = {
    ...finding,
    status: 'unverified-lead',
    node: { ...finding.node, evidence: [...finding.node.evidence].reverse() },
  };
  const a = findingFingerprint(finding);
  const b = findingFingerprint(flipped);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  assert.equal(a, b);
  assert.ok(fingerprintPreimage(finding).startsWith('fingerprint-v1\n'));
});

test('different location yields different fingerprint', () => {
  const mk = (file) => findingFingerprint({
    node: { file, symbolLine: 1, evidence: [] },
    judgment: { answers: { verdict: { choice: 'report' } } },
  });
  assert.notEqual(mk('a.js'), mk('b.js'));
});
