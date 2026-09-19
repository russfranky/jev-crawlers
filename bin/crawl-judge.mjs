#!/usr/bin/env node
// crawl-judge — one Jev judgment per node.
// Reads a node (or array of nodes) from stdin, writes a JSON array of
// { node, judgment } objects. The judgment carries the typed answers
// (verdict choice, bug_likely boolean, severity score, artifact_stated
// boolean), the policy routing, and latency/usage.
//
// Exit codes mirror jev-decide: 0 = judged (routing in JSON), 3 = scorer
// error. The repo never holds a key: set AI_GATEWAY_API_KEY.
// --dry-run returns a deterministic stub judgment without calling Jev
// (for pipeline tests; never for real verdicts).
import { readStdinJson, asArray, writeJson, fail } from '../lib/io.mjs';
import { loadConfig, judgeNode } from '../lib/jev.mjs';

const args = process.argv.slice(2);
let configPath = null, setName = 'crawl-judge', dryRun = false, maxStateChars = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--config' && args[i + 1]) configPath = args[++i];
  else if (a === '--set' && args[i + 1]) setName = args[++i];
  else if (a === '--max-state-chars' && args[i + 1]) maxStateChars = parseInt(args[++i], 10);
  else if (a === '--dry-run') dryRun = true;
  else if (a === '--help' || a === '-h') {
    console.log('usage: crawl-judge [--config PATH] [--set NAME] [--max-state-chars N] [--dry-run] < node.json');
    process.exit(0);
  } else fail(`unknown arg ${a}`, 64);
}

const input = await readStdinJson();
if (!input) fail('no node on stdin', 64);

if (dryRun) {
  const out = asArray(input).map((node) => ({
    node,
    judgment: {
      dryRun: true,
      answers: {
        verdict: { choice: 'expand', probabilities: { expand: 1 }, top_probability: 1 },
        bug_likely: { probability: 0.5 },
        severity: { score: 0.3 },
        artifact_stated: { probability: 0 },
      },
      routing: 'expand-node',
      meaning: 'dry-run stub: always expand',
      latencyMs: 0,
    },
  }));
  writeJson(out);
  process.exit(0);
}

let config;
try { config = loadConfig(configPath); }
catch (e) { fail(`cannot read config: ${e.message}`, 3); }
const set = config.sets?.[setName];
if (!set) fail(`unknown set "${setName}"`, 3);

const out = [];
for (const node of asArray(input)) {
  try {
    const judgment = await judgeNode(node, set, {
      setName, maxStateChars, model: config.model, providerOptions: config.providerOptions,
    });
    out.push({ node, judgment });
  } catch (e) {
    writeJson({ set: setName, status: set.status || 'active', routing: 'review', error: String(e.message || e).slice(0, 300) });
    process.stderr.write(`crawl-judge ERROR: ${String(e.message || e).slice(0, 200)} -> treat as review\n`);
    process.exit(3);
  }
}
writeJson(out);
process.exit(0);
