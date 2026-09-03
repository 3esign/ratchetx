// The inspector's job is to let a stranger check the game without asking us
// anything. These are the parts of that claim that can be tested without a
// network: what it says about which chain it is on, and whether two endpoints
// agreeing is something it can actually determine.
//
// The full inspectCore path against a real deployment is the P1 gate itself and
// needs an RPC; this file covers the logic that decides what that run MEANS.
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { GENESIS, noticeFor, readCluster, canonicalContent, reconcileReports, DEVNET_NOTICE }
  from '../onchain/ratchet-core/client/inspect.mjs';

let checks = 0;

// ---- 1. the cluster is read from the chain, not assumed from a flag --------
{
  const devnetHash = Object.keys(GENESIS).find(h => GENESIS[h] === 'devnet');
  const mainnetHash = Object.keys(GENESIS).find(h => GENESIS[h] === 'mainnet-beta');
  checks++; assert.ok(devnetHash && mainnetHash, 'both well-known genesis hashes are listed');

  checks++;
  assert.deepEqual(await readCluster({ getGenesisHash: async () => mainnetHash }),
    { genesisHash: mainnetHash, cluster: 'mainnet-beta' });
  checks++;
  assert.match(noticeFor('mainnet-beta'), /MAINNET-BETA/, 'mainnet must announce itself as live');
  checks++;
  assert.equal(noticeFor('devnet'), DEVNET_NOTICE);

  // The failure that mattered: a devnet-shaped URL serving mainnet data used to
  // print "DEVNET — NOT LIVE CREDITS" over live state.
  const disguised = await readCluster({ getGenesisHash: async () => mainnetHash });
  checks++;
  assert.notEqual(noticeFor(disguised.cluster), DEVNET_NOTICE,
    'the banner follows the genesis hash, not the endpoint URL');

  checks++;
  const strange = await readCluster({ getGenesisHash: async () => 'SomeOtherChain11111111111111111111111111111' });
  assert.equal(strange.cluster, 'unknown');
  checks++;
  assert.match(noticeFor(strange.cluster), /UNKNOWN CLUSTER/, 'an unrecognised chain is named as unrecognised');

  // An endpoint that will not answer must not throw the whole inspection away.
  checks++;
  const refused = await readCluster({ getGenesisHash: async () => { throw new Error('nope'); } });
  assert.equal(refused.cluster, 'unknown');
  assert.equal(refused.genesisHash, null);
  assert.match(refused.error, /nope/);
}

// ---- 2. content comparison ignores order and volatility, not substance ----
const base = () => ({
  notice: 'anything',
  cluster: 'devnet',
  genesisHash: 'G',
  contextSlots: { deployment: 100, podium: 100, allShots: 100 },
  program: { id: new PublicKey('11111111111111111111111111111111'), immutable: false },
  podium: { period: 'day', list: [{ w: 'a', xp: 3 }, { w: 'b', xp: 1 }] },
  shotCount: 2,
  shots: [{ nonce: 1n, state: 1 }, { nonce: 2n, state: 2 }],
});
{
  const a = base();
  const b = base();
  b.contextSlots = { deployment: 812, podium: 813, allShots: 814 };   // pure lag
  b.notice = 'a different banner';
  b.shots.reverse();                                                   // RPC ordering
  b.podium.list.reverse();
  checks++;
  assert.equal(canonicalContent(a), canonicalContent(b),
    'lag, banners and array order are not disagreements');
  const r = reconcileReports(a, b);
  checks++; assert.equal(r.agree, true);
  checks++; assert.equal(r.sameCluster, true);
  checks++; assert.deepEqual(r.differing, []);
  checks++; assert.equal(r.slots.first.deployment, 100);
  checks++; assert.equal(r.slots.second.deployment, 812, 'both slots are reported so lag is visible');
}

// ---- 3. a real contradiction is named ------------------------------------
{
  const a = base(), b = base();
  b.podium.list[0].xp = 999;
  const r = reconcileReports(a, b);
  checks++; assert.equal(r.agree, false);
  checks++; assert.deepEqual(r.differing, ['podium'], 'the disagreeing field is named, not just flagged');
}
{
  const a = base(), b = base();
  b.shots.push({ nonce: 3n, state: 1 });
  b.shotCount = 3;
  const r = reconcileReports(a, b);
  checks++; assert.equal(r.agree, false);
  checks++; assert.deepEqual(r.differing.sort(), ['shotCount', 'shots'],
    'an endpoint hiding a shot is exactly what this is for');
}
{
  const a = base(), b = base();
  b.cluster = 'mainnet-beta'; b.genesisHash = 'H';
  const r = reconcileReports(a, b);
  checks++; assert.equal(r.sameCluster, false, 'two chains are not two opinions about one chain');
}

// ---- 4. bigints survive the comparison -----------------------------------
{
  const a = base(), b = base();
  b.shots[0] = { nonce: 1n, state: 1 };
  checks++; assert.equal(canonicalContent(a), canonicalContent(b), 'a bigint compares by value');
  const c = base(); c.shots[0] = { nonce: 7n, state: 1 };
  checks++; assert.notEqual(canonicalContent(a), canonicalContent(c), 'and a different bigint does not');
}

console.log(`PASS  inspector: ${checks} checks — the cluster is measured, and two endpoints can be told apart from two moments`);
