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
  process.env.SOLANA_RPC_URL,
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
function decideBurn(tx, { wallet, mint, minAmount = 1, nowMs = Date.now(), maxAgeSec = 86400, podium = [], podiumPct = 0 }) {
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
  for (const b of pre)  if (b.mint === mint && b.owner) add(b.owner, -(+b.uiTokenAmount?.uiAmount || 0));
  for (const b of post) if (b.mint === mint && b.owner) add(b.owner, +(+b.uiTokenAmount?.uiAmount || 0));
  const walletDelta = byOwner.get(wallet) || 0;
  const incinDelta = Math.max(0, byOwner.get(INCINERATOR) || 0);
  let total = 0; for (const v of byOwner.values()) total += v;
  const destroyed = Math.max(incinDelta, total < 0 ? -total : 0);
  // champion legs: positive deltas to podium wallets. Anything else refuses.
  const podiumSet = new Set(podium);
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
  return { ok: true, amount: Math.floor(Math.min(outflow, destroyed + champPaid)),
    burned: Math.floor(destroyed), champPaid: Math.floor(champPaid), champLegs };
}

module.exports = { getTx, decideBurn, rpcCall, INCINERATOR };
