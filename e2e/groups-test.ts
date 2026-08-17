// The GROUP membership rules, offline: no Plex, no Kavita, no network, no browser.
//
// Two things are pinned here and they fail in opposite directions, which is why both are.
//
// 1. EXPLICIT BEATS DERIVED, and the order is the whole feature. Nearly every curated queue
//    in the live config is gated to `sawtaytoes`, so an account-first rule sweeps
//    `Kevin & Ashlee — Anime`, `Kevin & Xander — Anime` and `Family — Anime` into "Kevin" and
//    the audience distinction — the entire point — silently disappears. That failure looks
//    like a working feature with an over-full first chip, which is exactly the kind nobody
//    notices for a month.
//
// 2. DERIVATION STILL HAS TO FIRE for a set no group named, or `Kids` and `Demo` — which are
//    defined by ACCOUNTS ALONE and name no set ids at all — come out empty. That failure is
//    loud, but only if something checks it.
//
// Plus the writer's contract: ids are immutable across a rename, a duplicate label gets a
// de-duplicated id rather than a failed save, and hand-written comments survive a write
// (this file is edited over SMB as often as it is saved from the app).
//
// Run:  server/node_modules/.bin/tsx e2e/groups-test.ts   (repo root; non-zero on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { errMessage } from '../server/src/errors.js';

const SCRATCH = mkdtempSync(path.join(tmpdir(), 'qpgroups-'));
const GROUPS_PATH = path.join(SCRATCH, 'groups.yaml');
const SETS_PATH = path.join(SCRATCH, 'sets.yaml');
process.env.GROUPS_PATH = GROUPS_PATH;
process.env.SETS_PATH = SETS_PATH;
process.env.QUEUES_PATH = path.join(SCRATCH, 'queues.yaml');
process.env.CACHE_PATH = path.join(SCRATCH, 'cache.sqlite');
process.env.PROVIDERS_PATH = path.join(SCRATCH, 'providers.yaml');
process.env.PROVIDERS_SECRETS_PATH = path.join(SCRATCH, 'providers.secrets.yaml');

// A miniature of the live registry, with the one shape that matters: three curated queues
// that ALL play as `sawtaytoes`, and two rotation pools bound to the kid accounts.
writeFileSync(
  SETS_PATH,
  `sets:
- id: kevin_anime
  label: Kevin — Anime
  kind: anime
  source: queue
  requires_profile: sawtaytoes
  sections: [11]
- id: kevin_ashlee_anime
  label: Kevin & Ashlee — Anime
  kind: anime
  source: queue
  requires_profile: sawtaytoes
  sections: [11]
- id: family_anime
  label: Family — Anime
  kind: anime
  source: queue
  requires_profile: sawtaytoes
  sections: [11]
- id: shows
  label: Shows
  kind: cartoons
  source: rotation
  sections: [5]
  profiles:
  - plex_user: Younger Kids
    account_id: 220339333
- id: shows_shorts
  label: Shows & Shorts
  kind: cartoons
  source: rotation
  sections: [5]
  profiles:
  - plex_user: Older Kids
    account_id: 348723892
- id: retired
  label: Retired tier
  kind: cartoons
  source: rotation
  sections: [5]
  superseded_by: shows
  profiles:
  - plex_user: Younger Kids
    account_id: 220339333
`,
);

const HEADER = '# hand-written header nobody should lose\n';
writeFileSync(
  GROUPS_PATH,
  `${HEADER}
groups:
- id: kevin
  label: Kevin
  accounts:
    plex: [sawtaytoes]
    kavita: [Kevin]
  sets: [kevin_anime]
- id: kevin-ashlee
  label: Kevin & Ashlee
  sets: [kevin_ashlee_anime]
- id: kids
  label: Kids
  accounts:
    plex: [Older Kids, Younger Kids]
`,
);

const groups = await import('../server/src/groups.js');
const sets = await import('../server/src/sets.js');

let failures = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL ${name}  -- ${errMessage(e)}`);
  }
}

const resolve = async () => {
  // Re-read from disk every time: the registry memo is stat-keyed and the writer below
  // changes the file under it, so a cached read here would test the previous state.
  const reg = await sets.getRegistry();
  const byId = new Map(groups.resolveGroups(reg.sets).map((g) => [g.id, g]));
  return byId;
};

await check('a named set goes to the group that named it, not to the account match', async () => {
  const byId = await resolve();
  // `kevin_ashlee_anime` plays as sawtaytoes, which "Kevin" claims by account — but
  // "Kevin & Ashlee" NAMES it, so only Kevin & Ashlee gets it.
  assert.deepEqual(byId.get('kevin-ashlee')?.setIds, ['kevin_ashlee_anime']);
  assert.ok(!byId.get('kevin')?.setIds.includes('kevin_ashlee_anime'));
});

await check('an UNnamed set falls to whichever group claims its account', async () => {
  const byId = await resolve();
  // `family_anime` is named by nobody and plays as sawtaytoes, so it derives into Kevin.
  assert.ok(byId.get('kevin')?.setIds.includes('family_anime'));
  // …and the two kid pools derive into Kids, which names no set ids at all.
  assert.deepEqual(byId.get('kids')?.setIds, ['shows', 'shows_shorts']);
});

await check('a superseded tier is in no group and in no count', async () => {
  const byId = await resolve();
  for (const g of byId.values()) assert.ok(!g.setIds.includes('retired'), `${g.id} holds it`);
});

await check('`all` holds everything visible and is not editable', async () => {
  const byId = await resolve();
  const all = byId.get(groups.ALL_ID);
  assert.equal(all?.isAll, true);
  assert.equal(all?.setIds.length, 5); // six sets, one superseded
});

await check('nothing is left unfiled in this fixture', async () => {
  const reg = await sets.getRegistry();
  assert.deepEqual(groups.unassignedSetIds(reg.sets), []);
});

await check('a rename keeps the id — the URL is a promise', async () => {
  await groups.updateGroup('kevin-ashlee', { label: 'Kevin and Ashlee' });
  const stored = groups.storedGroups().find((g) => g.id === 'kevin-ashlee');
  assert.equal(stored?.label, 'Kevin and Ashlee');
  assert.deepEqual(stored?.sets, ['kevin_ashlee_anime']);
});

await check('a PATCH that omits a field leaves it alone', async () => {
  await groups.updateGroup('kevin', { label: 'Kevin' });
  const stored = groups.storedGroups().find((g) => g.id === 'kevin');
  // Neither accounts nor sets were in the body, so both survive.
  assert.deepEqual(stored?.accounts.plex, ['sawtaytoes']);
  assert.deepEqual(stored?.sets, ['kevin_anime']);
});

await check('an explicitly empty sets[] does clear it', async () => {
  await groups.updateGroup('kevin', { sets: [] });
  assert.deepEqual(groups.storedGroups().find((g) => g.id === 'kevin')?.sets, []);
  await groups.updateGroup('kevin', { sets: ['kevin_anime'] });
});

await check('a duplicate label gets a de-duplicated id rather than failing', async () => {
  const made = await groups.createGroup({ label: 'Kevin' });
  assert.equal(made.id, 'kevin-2');
  await groups.deleteGroup('kevin-2');
});

await check('`all` cannot be created', async () => {
  await assert.rejects(() => groups.createGroup({ label: 'All' }), /reserved/);
});

await check('a label with nothing to slugify is refused, not silently id-less', async () => {
  await assert.rejects(() => groups.createGroup({ label: '—' }), /no letters or digits/);
  await assert.rejects(() => groups.createGroup({ label: '   ' }), /needs a label/);
});

await check('reorder never drops a group the caller did not mention', async () => {
  const { order } = await groups.reorderGroups(['kids']);
  assert.equal(order[0], 'kids');
  assert.equal(order.length, groups.storedGroups().length);
  assert.deepEqual([...order].sort(), ['kevin', 'kevin-ashlee', 'kids']);
});

await check('the hand-written header survives every write', () => {
  assert.ok(readFileSync(GROUPS_PATH, 'utf8').startsWith(HEADER), 'header gone');
});

await check('deleting something already gone is not an error', async () => {
  const out = await groups.deleteGroup('never-existed');
  assert.deepEqual(out, { ok: true, deleted: false });
});

console.log(failures ? `\n${failures} FAILED` : '\nall group checks passed');
process.exit(failures ? 1 : 0);
