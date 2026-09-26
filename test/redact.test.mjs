import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactText, redactNode, REDACTED_MARKER } from '../lib/redact.mjs';

test('key-name assignment redacts only the value', () => {
  const { text, count } = redactText('const api_key = "EXAMPLE_KEY_NOT_REAL_12345";');
  assert.equal(count, 1);
  assert.match(text, /api_key = "/);
  assert.ok(text.includes(REDACTED_MARKER));
  assert.ok(!text.includes('EXAMPLE_KEY_NOT_REAL_12345'));
});

test('PEM private key is redacted; certificate is not', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3examplebase64payloadnotarealkey0123456789ABCDEF\n-----END RSA PRIVATE KEY-----';
  const { text, count } = redactText(pem);
  assert.equal(count, 1);
  assert.ok(text.includes('BEGIN RSA PRIVATE KEY'));
  assert.ok(text.includes(REDACTED_MARKER));
  assert.ok(!text.includes('MIIEowIBAAKCAQEA0Z3example'));
  const cert = '-----BEGIN CERTIFICATE-----\nMIIDexamplecert\n-----END CERTIFICATE-----';
  assert.equal(redactText(cert).count, 0);
});

test('well-known GitHub token prefix is redacted', () => {
  const raw = 'ghp_abcdefghijklmnopqrstuvwxyz012345';
  const { text, count } = redactText('token = ' + raw);
  assert.ok(count >= 1);
  assert.ok(!text.includes(raw));
  assert.ok(text.includes(REDACTED_MARKER));
});

test('sk-ant- Anthropic key prefix is redacted', () => {
  const raw = 'sk-ant-abcdefghijklmnopqrstuvwxyz0123456789ABCD';
  const { text, count } = redactText('found ' + raw + ' in logs');
  assert.ok(count >= 1);
  assert.ok(!text.includes(raw));
  assert.ok(text.includes(REDACTED_MARKER));
});

test('bare sk- OpenAI key prefix is redacted', () => {
  const raw = 'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD';
  const { text, count } = redactText('found ' + raw + ' in logs');
  assert.ok(count >= 1);
  assert.ok(!text.includes(raw));
  assert.ok(text.includes(REDACTED_MARKER));
});

test('short sk- fragment is not redacted', () => {
  const src = 'the sk-abc fragment is too short to be a key';
  const { text, count } = redactText(src);
  assert.equal(count, 0);
  assert.equal(text, src);
});

test('prose mention of secret is untouched', () => {
  const src = 'a comment mentioning secret without a value';
  const { count, text } = redactText(src);
  assert.equal(count, 0);
  assert.equal(text, src);
});

test('redactNode copies the node and records count', () => {
  const node = { excerpt: 'const password = "hunter2hunter2hunter2abcd";', evidence: [] };
  const { node: out, redactions } = redactNode(node);
  assert.ok(node.excerpt.includes('hunter2'));
  assert.ok(out.excerpt.includes(REDACTED_MARKER));
  assert.ok(!out.excerpt.includes('hunter2hunter2hunter2abcd'));
  assert.equal(redactions[0].class, 'credential');
  assert.ok(redactions[0].count >= 1);
});
