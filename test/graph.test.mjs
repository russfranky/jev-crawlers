import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeId, withId, Frontier, childPriority } from '../lib/graph.mjs';

test('nodeId is file::scope::symbol', () => {
  assert.equal(nodeId({ file: 'a.js', scope: 'foo', symbol: 'bar' }), 'a.js::foo::bar');
  assert.equal(nodeId({}), '?::<file>::?');
});

test('withId is idempotent', () => {
  const n = withId({ file: 'a.js', symbol: 'x', scope: 's' });
  assert.equal(n.id, 'a.js::s::x');
  assert.equal(withId(n).id, n.id);
});

test('Frontier pops higher priority first, then shallower depth', () => {
  const f = new Frontier();
  f.push({ id: 'low', priority: 0.2, depth: 0 });
  f.push({ id: 'high-deep', priority: 1, depth: 3 });
  f.push({ id: 'high-shallow', priority: 1, depth: 0 });
  assert.equal(f.size, 3);
  assert.equal(f.pop().id, 'high-shallow');
  assert.equal(f.pop().id, 'high-deep');
  assert.equal(f.pop().id, 'low');
  assert.equal(f.pop(), null);
});

test('childPriority decays and boosts on expand+bug_likely', () => {
  const parent = { priority: 1, depth: 0 };
  const p = childPriority(parent, {
    routing: 'expand-node',
    answers: { bug_likely: { probability: 1 } },
  }, 0.5);
  assert.equal(p, 1);
  const capped = childPriority({ priority: 2 }, {
    routing: 'expand-node',
    answers: { bug_likely: { probability: 1 } },
  }, 1);
  assert.equal(capped, 2);
});
