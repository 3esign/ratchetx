// ============================================================
//  lib/onchain_px.js — prices read straight off Solana.
//
//  WHY THIS FILE EXISTS.
//  Pyth's Core upgrade requires authentication for direct Hermes HTTP calls.
//  RATCHET has a key for that failover, but does not need Hermes for its
//  primary route because sponsored push accounts are readable on Solana.
//
//  But Pyth also PUSHES sponsored price feeds onto Solana as ordinary
//  accounts, and reading a Solana account is not something anyone can bill
//  for. Those accounts hold the same PriceUpdateV2 struct, signed by the
//  same publishers, that the pull oracle hands you. They cover every feed
//  this game trades. They are the feeds our own settlement program already
//  validates on-chain.
//
//  So we read the oracle where it actually lives. This is cheaper (free),
//  more honest (the site now reads the same account the program reads),
//  and strictly harder to take away.
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

// Set SOLANA_RPC to your own endpoint (QuickNode/Helius/Triton) — it is one
// env var and it is the difference between "works" and "works under load".
// Unset, we rotate public endpoints so the game still runs out of the box.
const PRIVATE_RPC = process.env.SOLANA_RPC || process.env.SOLANA_RPC_URL;
const ENDPOINTS = (PRIVATE_RPC ? [PRIVATE_RPC] : [
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com',
  'https://solana.drpc.org',
]);
let epIdx = 0;   // sticky: stay on whatever answered last

// Anchor discriminator: sha256("account:PriceUpdateV2")[..8]
const DISC = Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]);

// Any of Pyth's own programs may own a price account. Both generations are
// accepted for the same reason the on-chain program accepts both: an account
// posted before the upgrade must stay readable after it.
const PYTH_OWNERS = new Set([
  'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ',   // receiver v1
  'pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT',   // push oracle v1
  'rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp',   // receiver v2
  'pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou',   // price feed v2
]);

// symbol -> [ sponsored feed account, expected feed id ]
const ACCOUNTS = {
  SOL:  ['7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE', 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'],
  BTC:  ['4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo', 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'],
  ETH:  ['42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC', 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'],
  BONK: ['DBE3N8uNjhKPRHfANdwGvCZghWXyLPdqdSbEW2XFwBiX', '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419'],
  PUMP: ['HMm3GPbdnqGwbkTnUUqCFsH8AMHDdEC3Lg8gcPD3HJSH', '7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9'],
  JUP:  ['7dbob1psH1iZBS7qPsm3Kwbf5DzSXK8Jyg31CTgTnxH5', '0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996'],
  WIF:  ['6B23K3tkb51vLZA14jcEQVCA1pfHptzEHFA93V5dYwbT', '4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc'],
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
  o += 16;                                          // ema_price + ema_conf
  const postedSlot = Number(d.readBigUInt64LE(o));
  const px = Number(price) * 10 ** expo;
  if (!Number.isFinite(px) || px <= 0) throw new Error('bad price');
  if (!Number.isSafeInteger(publishTime) || !Number.isSafeInteger(prevPublishTime)
      || !Number.isSafeInteger(postedSlot))
    throw new Error('bad publish time');
  return { px, publishTime, prevPublishTime, postedSlot,
    conf: Number(conf) * 10 ** expo };
}

async function onchainPrices() {
  const syms = Object.keys(ACCOUNTS);
  const keys = syms.map(s => ACCOUNTS[s][0]);
  const infos = [];
  for (let i = 0; i < keys.length; i += BATCH) {
    const res = await rpc('getMultipleAccounts',
      [keys.slice(i, i + BATCH), { encoding: 'base64', commitment: 'confirmed' }]);
    infos.push(...(res.value || []));
  }

  const now = Math.floor(Date.now() / 1000);
  // ages/confs/pubs are not decoration. They are the telemetry the observatory
  // publishes: how old the price was when we read it, how wide the publishers'
  // confidence band was, and the publish_time itself (which is what lets us
  // measure the OBSERVED heartbeat rather than repeat the advertised one).
  const out = { src: 'pyth-onchain', ages: {}, confs: {}, pubs: {}, prevPubs: {}, postedSlots: {} };
  const dropped = [];

  syms.forEach((s, i) => {
    const inf = infos[i];
    try {
      if (!inf) throw new Error('account missing');
      if (!PYTH_OWNERS.has(inf.owner)) throw new Error('owner ' + inf.owner);
      const { px, publishTime, prevPublishTime, postedSlot, conf } = decode(inf.data[0], ACCOUNTS[s][1]);
      const age = now - publishTime;
      if (age < -5) throw new Error(`future ${-age}s`); // small clock-skew allowance only
      if (age > MAX_AGE_S) throw new Error(`stale ${age}s`);
      const confBps = px > 0 ? (conf / px) * 10000 : Infinity;
      if (!Number.isFinite(confBps) || confBps > MAX_CONF_BPS)
        throw new Error(`confidence ${confBps.toFixed(3)}bps`);
      out[s] = px;
      out.ages[s] = age < 0 ? 0 : age;
      out.confs[s] = +confBps.toFixed(3);   // bps
      out.pubs[s] = publishTime;
      out.prevPubs[s] = prevPublishTime;
      out.postedSlots[s] = postedSlot;
    } catch (e) {
      // A bad or missing optional feed just removes its targets from the
      // board. It never settles a shot on a number we do not trust.
      dropped.push(`${s}:${e.message}`);
    }
  });

  for (const c of CORE) {
    if (!out[c]) throw new Error('onchain incomplete — ' + dropped.join(', '));
  }
  if (dropped.length) out.partial = dropped.join(', ').slice(0, 140);
  return out;
}

module.exports = { onchainPrices, ACCOUNTS, MAX_AGE_S, MAX_CONF_BPS, ENDPOINTS, PYTH_OWNERS, decode };
