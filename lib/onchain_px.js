// ============================================================
//  lib/onchain_px.js — prices read straight off Solana.
//
//  WHY THIS FILE EXISTS.
//  Pyth publishes sponsored PriceUpdateV2 accounts on Solana as a first-class
//  oracle surface. They hold the publisher aggregate, confidence interval,
//  EMA, publish cadence and posted slot used by this game. Ratchet reads and
//  validates those accounts so play, measurement and proof all start from the
//  same Pyth state that the settlement program understands.
//
//  Sponsored feeds run a 1-minute heartbeat with a 0.5% deviation trigger:
//  in a moving market they update constantly, and in a dead-flat market
//  they stop — which is fine, because the shortest chamber on the board is
//  five minutes. We surface the publish age so the page can say how old a
//  price is instead of pretending every tick is live.
//
//  Addresses below are the shard-0 push-feed PDAs, derived from
//  [u16le(0), feed_id] under the Pyth push oracle program and checked
//  against Pyth's published sponsored-feed table.
// ============================================================

// Set SOLANA_RPC to your own endpoint(s) - Helius / QuickNode / Triton. You may
// list several (comma / space / newline separated, and/or across SOLANA_RPC and
// SOLANA_RPCS): the best-of reader fans out across them and keeps the freshest
// valid print per feed, so two free keys back each other up. Public nodes are
// ALWAYS kept as a last-resort net, reached only after every private one lags -
// a healthy private key early-stops the walk before a public is ever touched, so
// one slow key can never blank the oracle. Unset, we run on public nodes alone.
const PRIVATE_RPCS = [process.env.SOLANA_RPC, process.env.SOLANA_RPC_URL, process.env.SOLANA_RPCS]
  .filter(Boolean)
  .join(' ')
  .replace(/(.)(https?:\/\/)/gi, '$1 $2')   // break a run-together paste: ...key1https://... -> ...key1 https://...
  .split(/[\s,]+/)
  .map((s) => s.trim())
  .filter((s) => /^https?:\/\//i.test(s));
const PUBLIC_RPCS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com',
  'https://solana.drpc.org',
];
// privates first (tried first -> early-stop when fresh); publics as the net.
const ENDPOINTS = [...new Set([...PRIVATE_RPCS, ...PUBLIC_RPCS])];
let epIdx = 0;   // sticky: stay on whatever answered last

// Anchor discriminator: sha256("account:PriceUpdateV2")[..8]
const DISC = Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]);

// Any of Pyth's own programs may own a price account, and this reader accepts
// all four generations because an account posted before an upgrade must stay
// readable after it.
//
// The frozen Seal v2 program does NOT do this, and the difference is
// deliberate rather than an oversight. `load_push_price_update` has exactly one
// owner comparison -- `*ai.owner == PYTH_RECEIVER_ID` -- and that constant is
// receiver v2 alone (`rec2HHDD...`); anything else is `BadPriceAccount`. So this
// reader is strictly more permissive than the thing that settles. That is the
// safe direction, but it is a real divergence: a price this file is happy to
// display can be one the chain would refuse to settle on, and after 2026-09-08
// the program's side of it can never be widened.
//
// Note also that the two ids play different roles in that check: ownership must
// be the RECEIVER, while the account address is derived from the PUSH ORACLE
// id (`find_program_address([shard_0, feed_id], PYTH_PUSH_ORACLE_ID)`). Deriving
// the address from the receiver, or the owner from the push oracle, produces a
// valid-looking account that the program rejects -- which is exactly how the
// 2026-08-27 mainnet exercise earned its `BadPriceAccount` in simulation.
const PYTH_OWNERS = new Set([
  'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ',   // receiver v1
  'pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT',   // push oracle v1
  'rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp',   // receiver v2
  'pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou',   // price feed v2
]);

// symbol -> [ sponsored feed account, expected feed id ]
const ACCOUNTS = {
  SOL:  ['7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE', 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'],
  BTC:  ['APgzQGGdv2qCgBkX6aHVkrGePtBVDDg68GiqaM7rmtf5', 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'],
  ETH:  ['7odryi4WfoMFHtv2eubdMgP1pqQMmdiXSK1N2tqZ2nRH', 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'],
  BONK: ['3nMpgBXnjBSDYupQQEVR7DZM65zkJCdKy1Up7nkqp99w', '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419'],
  PUMP: ['4KL8nVtrXmLjbbHtrDz5YCHNqmii62oHfr9bsUtx1bgi', '7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9'],
  JUP:  ['EitcZS5LtbR4EyNhCSy56vvUHPhsifSfWFG5gwSkjNpV', '0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996'],
  WIF:  ['9Sn9FVu6WpufA8yZFSRuxYyFgpBrhc5PpTgB3mq2DcsG', '4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc'],
};
const CORE = ['SOL', 'BTC', 'ETH'];

// A price older than this is not a price, it is a memory. Two heartbeats of
// headroom: past that we would rather fall through to another source than
// settle a shot on something stale.
const MAX_AGE_S = 120;
// Match the reviewed v1 settlement program: a band wider than 2% of price is
// not a deterministic-enough print for an economic outcome.
const MAX_CONF_BPS = 200;

// QuickNode's free plan caps getMultipleAccounts at 5 keys per call. Every
// provider caps it somewhere; 5 is the smallest cap we have actually hit.
const BATCH = 5;

async function one(url, method, params) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`rpc ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error('rpc ' + (j.error.message || JSON.stringify(j.error)));
  return j.result;
}

// Try the sticky endpoint first, then the rest once each. A public RPC that
// rate-limits us is a bad minute, not a broken game.
async function rpc(method, params) {
  let last;
  for (let n = 0; n < ENDPOINTS.length; n++) {
    const i = (epIdx + n) % ENDPOINTS.length;
    try {
      const out = await one(ENDPOINTS[i], method, params);
      epIdx = i;
      return out;
    } catch (e) { last = e; }
  }
  throw last || new Error('no rpc endpoint answered');
}

// PriceUpdateV2, borsh:
//   8  discriminator
//   32 write_authority
//   1  verification_level  (0 = Partial + u8 payload, 1 = Full)
//   -- PriceFeedMessage --
//   32 feed_id | 8 price(i64) | 8 conf(u64) | 4 exponent(i32)
//    8 publish_time(i64) | 8 prev_publish_time(i64)
//    8 ema_price(i64) | 8 ema_conf(u64)
//   8  posted_slot
function decode(b64, wantFeedId) {
  const d = Buffer.from(b64, 'base64');
  if (d.length < 133) throw new Error('short account');
  if (!d.subarray(0, 8).equals(DISC)) throw new Error('not a PriceUpdateV2');
  let o = 40;                                     // 8 disc + 32 write_authority
  const level = d[o];
  o += level === 0 ? 2 : 1;                       // Partial carries num_signatures
  if (level !== 1) throw new Error('not fully verified');
  const feedId = d.subarray(o, o + 32).toString('hex'); o += 32;
  if (feedId !== wantFeedId) throw new Error('feed id mismatch');
  const price = d.readBigInt64LE(o); o += 8;
  const conf = d.readBigUInt64LE(o); o += 8;
  const expo = d.readInt32LE(o); o += 4;
  const publishTime = Number(d.readBigInt64LE(o)); o += 8;
  const prevPublishTime = Number(d.readBigInt64LE(o)); o += 8;
  const emaPrice = d.readBigInt64LE(o); o += 8;
  const emaConf = d.readBigUInt64LE(o); o += 8;
  const postedSlot = Number(d.readBigUInt64LE(o));
  const px = Number(price) * 10 ** expo;
  const emaPx = Number(emaPrice) * 10 ** expo;
  const emaConfPx = Number(emaConf) * 10 ** expo;
  if (!Number.isFinite(px) || px <= 0) throw new Error('bad price');
  if (!Number.isFinite(emaPx) || emaPx <= 0 || !Number.isFinite(emaConfPx))
    throw new Error('bad ema');
  if (!Number.isSafeInteger(publishTime) || !Number.isSafeInteger(prevPublishTime)
      || !Number.isSafeInteger(postedSlot))
    throw new Error('bad publish time');
  return { px, publishTime, prevPublishTime, postedSlot, emaPx, emaConf:emaConfPx,
    conf: Number(conf) * 10 ** expo };
}

// Read every sponsored account from ONE endpoint. Returns the raw rows and the
// slot the node answered at; a decode/validate pass happens in onchainPrices so
// the freshness clock is the same for every endpoint we compare.
async function readAccounts(endpointIndex) {
  const keys = Object.keys(ACCOUNTS).map(s => ACCOUNTS[s][0]);
  const rows = [];
  let slot = 0;
  for (let i = 0; i < keys.length; i += BATCH) {
    const res = await one(ENDPOINTS[endpointIndex], 'getMultipleAccounts',
      [keys.slice(i, i + BATCH), { encoding: 'base64', commitment: 'confirmed' }]);
    rows.push(...(res.value || []));
    slot = Number(res.context && res.context.slot) || slot;
  }
  return { rows, slot };
}

// The intelligence: don't trust the first node that answers — take the BEST
// data on offer. A public RPC that has fallen minutes behind returns every feed
// stale at once; instead of degrading the whole game for one slow node, we walk
// the endpoints and keep, per feed, the print with the newest publish_time that
// still passes owner / feed-id / confidence / freshness. We stop the instant
// every core feed is fresh, so a healthy node costs one pass and a lagging one
// escalates to the next automatically. This is the layer that keeps the page on
// "READ ON-CHAIN" instead of flickering to a fallback whenever a public node lags.
async function onchainPrices() {
  const syms = Object.keys(ACCOUNTS);
  const now = Math.floor(Date.now() / 1000);
  const best = {};   // sym -> the freshest validated decode seen across endpoints
  const why = {};    // sym -> last reason it was dropped (telemetry, not fatal)

  const walkStarted = Date.now();
  const WALK_BUDGET_MS = 7000;   // hard cap: never let the whole endpoint walk block the API past this
  for (let n = 0; n < ENDPOINTS.length; n++) {
    if (n > 0 && Date.now() - walkStarted > WALK_BUDGET_MS) break;   // budget spent — stop escalating, use best-so-far
    const i = ((PRIVATE_RPCS.length ? 0 : epIdx) + n) % ENDPOINTS.length;
    let read;
    try { read = await readAccounts(i); }
    catch (e) { why.__rpc = `ep${i}:${e.message}`; continue; }   // node didn't answer — next
    epIdx = i;                                                   // stick to one that talks
    syms.forEach((s, k) => {
      const inf = read.rows[k];
      try {
        if (!inf) throw new Error('account missing');
        if (!PYTH_OWNERS.has(inf.owner)) {
          console.error(`[ALERT] Pyth feed migrated to UNKNOWN owner: ${inf.owner}. On-chain settlement will break if this isn't added to the program!`);
          throw new Error('owner ' + inf.owner);
        }
        const dec = decode(inf.data[0], ACCOUNTS[s][1]);
        const age = now - dec.publishTime;
        if (age < -5) throw new Error(`future ${-age}s`);        // small clock-skew allowance only
        if (age > MAX_AGE_S) throw new Error(`stale ${age}s`);
        const confBps = dec.px > 0 ? (dec.conf / dec.px) * 10000 : Infinity;
        if (!Number.isFinite(confBps) || confBps > MAX_CONF_BPS) throw new Error(`confidence ${confBps.toFixed(3)}bps`);
        if (!best[s] || dec.publishTime > best[s].publishTime)   // keep only the freshest print
          best[s] = { ...dec, age: age < 0 ? 0 : age, confBps: +confBps.toFixed(3), slot: read.slot };
      } catch (e) { why[s] = e.message; }
    });
    if (CORE.every(c => best[c])) break;                         // healthy — no need to poll more nodes
  }

  // ages/confs/pubs are the telemetry the observatory publishes: how old the
  // price was when we read it, how wide the publishers' band was, and the
  // publish_time that lets us measure the OBSERVED heartbeat.
  const out = { src: 'pyth-onchain', ages: {}, confs: {}, pubs: {}, prevPubs: {},
    slots: {}, postedSlots: {}, emaPrices: {}, emaConfs: {} };
  for (const s of syms) {
    const b = best[s]; if (!b) continue;
    out[s] = b.px;
    out.ages[s] = b.age;
    out.confs[s] = b.confBps;
    out.pubs[s] = b.publishTime;
    out.prevPubs[s] = b.prevPublishTime;
    out.slots[s] = b.slot;
    out.postedSlots[s] = b.postedSlot;
    out.emaPrices[s] = b.emaPx;
    out.emaConfs[s] = +(b.emaConf / b.emaPx * 10000).toFixed(3);
  }
  const dropped = syms.filter(s => !best[s]).map(s => `${s}:${why[s] || 'no data'}`);
  for (const c of CORE) {
    if (!out[c]) throw new Error('onchain incomplete — ' + dropped.join(', '));
  }
  if (dropped.length) out.partial = dropped.join(', ').slice(0, 140);
  return out;
}

module.exports = { onchainPrices, ACCOUNTS, MAX_AGE_S, MAX_CONF_BPS, ENDPOINTS, PYTH_OWNERS, decode };
