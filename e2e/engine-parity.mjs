// D3 engine parity: prove server/src/engine/select.js computes the unwatched-buckets pool the
// same as queue_builder/plex.py, by diffing both over the SYNTHETIC corpus (owner decision,
// docs/d3-engine-parity-corpus.md — no real library data). The Python side is the oracle:
//   python -m queue_builder.cli buckets kids <profile>   (replaying the corpus)
// vs the Node engine replaying the same corpus files. Parity is on the DETERMINISTIC pool
// (episodic buckets in allLeaves order; the shuffled shorts bucket compared as a sorted set) —
// the RNG shuffle/weighted-pick is out of scope by design (see the doc's RNG caveat).
//
// Run locally: PYTHONPATH=/tmp/pylibs:. node e2e/engine-parity.mjs   (needs ruamel importable).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(REPO, 'e2e', 'fixtures');
const CORPUS = path.join(FIX, 'engine-corpus');
const SETS = path.join(FIX, 'engine.sets.yaml');

// (Re)generate the synthetic corpus + its sets.yaml — hermetic, pure Python (no ruamel/network).
execFileSync('python3', ['e2e/gen-synthetic-corpus.py', CORPUS], { cwd: REPO, stdio: 'inherit' });

// env.js reads process.env at module-eval → set SETS_PATH before importing the port.
process.env.SETS_PATH = SETS;
const routing = await import('../server/src/engine/routing.js');
const select = await import('../server/src/engine/select.js');
const { replayClient } = await import('../server/src/engine/plex-replay.js');

const PY_ENV = {
  ...process.env,
  SETS_PATH: SETS,
  PLEX_REPLAY_DIR: CORPUS,
  PLEX_API_SERVER_URL: 'https://plex.invalid', // guarantee no live call slips through
  PLEX_TOKEN: 'WRONG',
};
const pyBuckets = (profile) =>
  JSON.parse(execFileSync('python3', ['-m', 'queue_builder.cli', 'buckets', 'kids', profile],
    { cwd: REPO, env: PY_ENV, encoding: 'utf8' }).trim());

const client = replayClient(CORPUS);
const reg = routing.loadSets(SETS);
const cfg = reg.sets.kids;

// Node buckets, normalized to the Python `_buckets` shape (episodes as ratingKeys; shorts sorted).
function nodeBuckets(profile) {
  const binding = routing.bindingFor(cfg, profile);
  return select.unwatchedBuckets(client, cfg, binding).map((bk) => {
    let eps = bk.episodes.map((e) => e.ratingKey);
    if (String(bk.ratingKey).startsWith('section-')) eps = [...eps].sort();
    return { show: bk.show, ratingKey: bk.ratingKey, multi_season: Boolean(bk.multi_season), episodes: eps };
  });
}

let failures = 0;
console.log('=== engine parity: unwatched_buckets (Node select.js ↔ python cli buckets) ===');
for (const profile of ['Younger', 'Older']) {
  const want = pyBuckets(profile);
  const got = nodeBuckets(profile);
  if (JSON.stringify(want) === JSON.stringify(got)) {
    console.log(`  ✓ ${profile}: ${got.map((b) => `${b.show}[${b.episodes.join(',')}]`).join('  ')}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${profile}\n      python: ${JSON.stringify(want)}\n      node:   ${JSON.stringify(got)}`);
  }
}
console.log(failures ? `\nFAILED: ${failures} mismatch(es)` : '\nOK: Node engine matches the Python oracle');
process.exit(failures ? 1 : 0);
