import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { asArray, readFileSafe } from '../lib/io.mjs';

test('asArray wraps scalars and treats null as empty', () => {
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(asArray({ a: 1 }), [{ a: 1 }]);
  assert.deepEqual(asArray([1, 2]), [1, 2]);
});

test('readFileSafe returns null on missing and truncates long files', () => {
  assert.equal(readFileSafe('/no/such/file'), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-io-'));
  const f = path.join(dir, 't.txt');
  fs.writeFileSync(f, 'abcdefghij');
  assert.equal(readFileSafe(f, 4), 'abcd');
  assert.equal(readFileSafe(f), 'abcdefghij');
});
