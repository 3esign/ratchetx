// ============================================================
//  lib/burn.js — real burn verification, keyless, zero deps.
//
//  The user "reloads" by sending RATCHET from their own wallet
//  to the incinerator address — a plain transfer any wallet UI
//  can do, no custom transaction building, no dApp approval —
//  then pastes the transaction signature here. The server reads
//  the transaction from the chain and credits the game balance
//  if and only if:
//    · the tx EXISTS and SUCCEEDED
//    · it is RECENT (blockTime within 24h)
//    · the paying wallet's RATCHET balance FELL by the amount
//    · the tokens LEFT CIRCULATION: the incinerator received
//      them, or total supply across accounts fell (a true burn)
//    · the signature was NEVER USED before (replay gate in KV)
//
//  Activated by env RATCHET_MINT after the token exists.
//  Nothing here can move funds: it only reads and refuses.
// ============================================================
const INCINERATOR = '1nc1nerator11111111111111111111111111111111';
const RPCS = () => [
  process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC,
  'https://solana-rpc.publicnode.com',
  'https://rpc.ankr.com/solana',
  'https://api.mainnet-beta.solana.com',
].filter(Boolean);

async function rpcCall(method, params) {
  for (const url of RPCS()) {
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(6000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await r.json();
      if (j && 'result' in j) return j.result;
    } catch { /* try next rpc */ }
  }
  return undefined;
}

async function getTx(sig) {
  for (const url of RPCS()) {
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(6000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction',
          params: [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }] }),
      });
      const j = await r.json();
      if (j && 'result' in j) return j.result;
    } catch { /* try next rpc */ }
  }
  return undefined; // all RPCs unreachable — distinct from "tx not found" (null)
}

/** Pure decision over a parsed tx — unit-testable without a network.
 *  h3, THE CHAMPION'S CUT: a reload may now carry CHAMPION LEGS —
 *  transfers to the published daily podium's wallets, capped at
 *  `podiumPct` of the payer's outflow. Everything that leaves the payer
 *  must either verifiably leave circulation or land on the podium; a
 *  transfer to ANY other wallet refuses the whole reload. Value flows
 *  player -> supply and player -> champions. Never to us. */
function decideBurn(tx, { wallet, mint, minAmount = 1, nowMs = Date.now(), maxAgeSec = 86400,
  podium = [], podiumSets = null, podiumPct = 0 }) {
  if (tx === undefined) return { ok: false, reason: 'RPC unreachable — try again in a minute' };
  if (!tx || !tx.meta) return { ok: false, reason: 'transaction not found — wait for confirmation and paste the exact signature' };
  if (tx.meta.err !== null && tx.meta.err !== undefined) return { ok: false, reason: 'that transaction failed on-chain: ' + JSON.stringify(tx.meta.err) };
  const bt = +tx.blockTime;
  if (!Number.isFinite(bt)) return { ok: false, reason: 'no block time yet — try again in a few seconds' };
  if (nowMs / 1000 - bt > maxAgeSec) return { ok: false, reason: 'transaction older than 24 hours' };
  if (bt * 1000 - nowMs > 5 * 60e3) return { ok: false, reason: 'transaction from the future — refusing' };
  const pre = tx.meta.preTokenBalances || [], post = tx.meta.postTokenBalances || [];
  const byOwner = new Map();
  const add = (o, v) => byOwner.set(o, (byOwner.get(o) || 0) + v);
  // `uiAmount` is allowed to be null for large values. Treating that as zero
  // can turn an unreadable account row into a fake supply reduction. Parse the
  // raw integer amount instead and refuse any relevant row we cannot account.
  const tokenAmount = b => {
    const u = b && b.uiTokenAmount;
    if (!u || !/^\d+$/.test(String(u.amount ?? '')) || !Number.isInteger(+u.decimals)
        || +u.decimals < 0 || +u.decimals > 30) return null;
    const n = Number(u.amount) / (10 ** +u.decimals);
    return Number.isFinite(n) ? n : null;
  };
  for (const [sign, rows] of [[-1, pre], [1, post]]) {
    for (const b of rows) {
      if (b.mint !== mint) continue;
      const amount = tokenAmount(b);
      if (!b.owner || amount == null)
        return { ok: false, reason: 'transaction contains an unreadable token balance — refusing rather than guessing' };
      add(b.owner, sign * amount);
    }
  }
  const walletDelta = byOwner.get(wallet) || 0;
  const incinDelta = Math.max(0, byOwner.get(INCINERATOR) || 0);
  let total = 0; for (const v of byOwner.values()) total += v;
  const destroyed = Math.max(incinDelta, total < 0 ? -total : 0);
  // Champion legs may pay the live set or a recently replaced set whose
  // signing grace is still valid. Exact seat amounts are checked below.
  const strictSets = Array.isArray(podiumSets) ? podiumSets.filter(x => x && Array.isArray(x.list)) : null;
  const allowedOwners = strictSets
    ? strictSets.flatMap(x => x.list.map(y => y && y.w).filter(Boolean))
    : podium;
  const podiumSet = new Set(allowedOwners);
  let champPaid = 0; const champLegs = [];
  for (const [o, v] of byOwner) {
    if (v <= 1e-9 || o === wallet || o === INCINERATOR) continue;
    if (!podiumSet.has(o)) return { ok: false, reason: 'that transaction moves tokens to a wallet outside the published podium — a reload may only burn and pay the champions' };
    champPaid += v; champLegs.push({ w: o, amt: Math.floor(v) });
  }
  const outflow = Math.max(0, -walletDelta);
  if (outflow < minAmount) return { ok: false, reason: `that wallet paid ${outflow.toLocaleString()} RCX — minimum is ${minAmount}` };
  if (champPaid > outflow * Math.max(0, podiumPct) + 1) return { ok: false, reason: 'champion legs exceed the published 30% cut — rebuild the reload from the site' };
  if (destroyed + champPaid + 1e-6 < outflow) return { ok: false, reason: 'part of that transaction neither burned nor reached the incinerator/champions — send the burn to ' + INCINERATOR };

  // A reloader may also be a champion. The site's transaction then contains a
  // transferChecked from the player's token account back to that same account:
  // it is a visible routing instruction, but creates no balance delta. Keep it
  // out of credits and `champPaid`, while exposing it as `selfRouted` so the UI
  // can say "stayed in your wallet" instead of the misleading "earned 0".
  let selfRouted = 0;
  if (podiumSet.has(wallet)) {
    const outer = (tx.transaction && tx.transaction.message && tx.transaction.message.instructions) || [];
    const inner = (tx.meta.innerInstructions || []).flatMap(x => x.instructions || []);
    for (const ix of [...outer, ...inner]) {
      const parsed = ix && ix.parsed, info = parsed && parsed.info;
      if (!info || parsed.type !== 'transferChecked' || info.authority !== wallet
          || info.source !== info.destination || info.mint !== mint) continue;
      const u = info.tokenAmount || {};
      const raw = /^\d+$/.test(String(u.amount ?? '')) && Number.isInteger(+u.decimals)
        ? Number(u.amount) / (10 ** +u.decimals) : Number(u.uiAmount);
      if (Number.isFinite(raw) && raw > 0) selfRouted += raw;
    }
  }
  // The self route is receipt metadata, not economic authorization. Ignore a
  // decorative self-transfer if it would make the published total cut exceed
  // 30%; it must never let a transaction manufacture a fake podium benefit.
  if (champPaid + selfRouted > (outflow + selfRouted) * Math.max(0, podiumPct) + 1)
    selfRouted = 0;

  // Dynamic podium safety: a transaction must match one complete published
  // snapshot exactly. The block time selects the eligible snapshots, so a
  // leaderboard change while a wallet is signing cannot redirect or reject
  // the already-built transaction, and an old set cannot be paid forever.
  let podiumVersion = null;
  if (strictSets) {
    const txMs = bt * 1000, gross = Math.floor(outflow + selfRouted);
    const observed = new Map(champLegs.map(x => [x.w, Math.floor(x.amt)]));
    if (selfRouted > 0) observed.set(wallet, Math.floor(selfRouted));
    const close = (a, b) => Math.abs(Math.floor(a) - Math.floor(b)) <= 1;
    for (const snap of strictSets) {
      const starts = Number(snap.t) || 0;
      const until = Number.isFinite(+snap.until) ? +snap.until : Number.POSITIVE_INFINITY;
      if (txMs + 5000 < starts || txMs > until) continue;
      const expected = new Map();
      for (const seat of snap.list) {
        if (!seat || !seat.w || !Number.isFinite(+seat.pct)) continue;
        const amt = Math.floor(gross * Math.max(0, podiumPct) * +seat.pct);
        if (amt > 0) expected.set(seat.w, amt);
      }
      if (expected.size !== observed.size) continue;
      let same = true;
      for (const [owner, amt] of expected)
        if (!observed.has(owner) || !close(observed.get(owner), amt)) { same = false; break; }
      const routed = [...expected.values()].reduce((a, b) => a + b, 0);
      if (!same || !close(destroyed, gross - routed)) continue;
      podiumVersion = snap.v || snap.t || 'published';
      break;
    }
    if (podiumVersion == null)
      return { ok:false, reason:'reload split does not match a podium snapshot valid when this transaction landed — rebuild it from the live site' };
  }

  return { ok: true, amount: Math.floor(Math.min(outflow, destroyed + champPaid)),
    burned: Math.floor(destroyed), champPaid: Math.floor(champPaid), champLegs,
    selfRouted: Math.floor(selfRouted), podiumVersion };
}

module.exports = { getTx, decideBurn, rpcCall, INCINERATOR };
