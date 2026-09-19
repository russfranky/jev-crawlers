// lib/graph.mjs — node identity, visited set, priority frontier.
// Canonical node identity: file + symbol + enclosing scope. Two leads that
// point at the same identity are the same node, which prevents cycles and
// duplicate work across seeds and expansions.
export function nodeId(node) {
  const file = node.file || '?';
  const symbol = node.symbol || '?';
  const scope = node.scope || '<file>';
  return `${file}::${scope}::${symbol}`;
}

export function withId(node) {
  node.id = node.id || nodeId(node);
  return node;
}

// Max-heap priority frontier. Higher priority pops first. Ties break toward
// shallower depth (breadth bias keeps the crawl near the seed).
export class Frontier {
  constructor() {
    this.heap = [];
  }
  get size() { return this.heap.length; }
  push(node) {
    const key = [node.priority ?? 0, -(node.depth ?? 0)];
    this.heap.push({ node, key });
    this._up(this.heap.length - 1);
  }
  pop() {
    if (!this.heap.length) return null;
    const top = this.heap[0].node;
    const last = this.heap.pop();
    if (this.heap.length) {
      this.heap[0] = last;
      this._down(0);
    }
    return top;
  }
  _cmp(a, b) {
    if (a[0] !== b[0]) return a[0] - b[0];
    return a[1] - b[1];
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._cmp(this.heap[i].key, this.heap[p].key) <= 0) break;
      [this.heap[i], this.heap[p]] = [this.heap[p], this.heap[i]];
      i = p;
    }
  }
  _down(i) {
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let best = i;
      if (l < this.heap.length && this._cmp(this.heap[l].key, this.heap[best].key) > 0) best = l;
      if (r < this.heap.length && this._cmp(this.heap[r].key, this.heap[best].key) > 0) best = r;
      if (best === i) break;
      [this.heap[i], this.heap[best]] = [this.heap[best], this.heap[i]];
      i = best;
    }
  }
}

// Child priority: parent priority decays with depth; a judge that says
// "expand, likely a bug" boosts the branch. Tune via --decay.
export function childPriority(parent, judge, decay = 0.85) {
  let p = (parent.priority ?? 1) * decay;
  const bugP = judge?.answers?.bug_likely?.probability ?? 0;
  if (judge?.routing === 'expand-node') p += bugP * 0.5;
  return Math.max(0, Math.min(2, p));
}
