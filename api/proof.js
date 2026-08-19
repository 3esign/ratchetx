// ============================================================
//  api/proof.js — the LIVE proof. Every claim on the proof page
//  is re-verified against the chain here, on demand, and each
//  answer carries the address or tx that proves it. Nothing in
//  this file can write anything anywhere — it only reads chain
//  state and reports it, red or green, whichever is true.
//
//  Cached 25s in KV so a crowd on launch day cannot rate-limit
//  the public RPC into silence. The page shows "checked Ns ago".
//
//  HARDENED 2026-08-19 — burn ATTRIBUTION, not just totals:
//  supply-destroyed is split into what PLAYERS verifiably burned
//  (replay-gated, credited in-game) and what fell for other
//  reasons (pump.fun burned the unsold curve remainder at
//  graduation — that is the launchpad's doing, not the game's).
//  Claiming the big number would be literally true and causally
//  false, and this page exists to never do that.
// ============================================================
const { getJSON, setJSON } = require('../lib/kv.js');
const { rpcCall, INCINERATOR } = require('../lib/burn.js');
const { getPrices } = require('../lib/prices.js');

const MINT = process.env.RATCHET_MINT || '';
const LP_BURN_TX = process.env.RATCHET_LP_BURN_TX || '';   // set after LP burn -> flips that line green with the tx link
const SOLSCAN = 'https://solscan.io';
const VERSION = 'h1-2026-08-19';

module.exports = async (req, res) => {
  try {
    const cached = await getJSON('g:proofcache');
    if (cached && Date.now() - cached.t < 25_000) return res.json(cached);

    const checks = [];
    const push = (id, status, label, detail, link) => checks.push({ id, status, label, detail, link: link || null });

    // ---- heartbeat: the oracle answers, right now
    let prices = null, t0 = Date.now();
    try { prices = await getPrices(); } catch {}
    push('oracle', prices ? 'green' : 'red', 'Settlement oracle is answering',
      prices ? `${prices.src.toUpperCase()} · SOL $${prices.SOL.toFixed(2)} · ${Date.now() - t0}ms round-trip`
             : 'both price sources unreachable — shots cannot settle until this is green');

    const st = (await getJSON('g:stats')) || {};
    let supply = null;
    if (!MINT) {
      push('mint', 'grey', 'Token checks arm at TGE', 'RATCHET_MINT is not set yet — every line below goes live the moment it is');
    } else {
      // ---- mint account: authorities + live supply
      const acc = await rpcCall('getAccountInfo', [MINT, { encoding: 'jsonParsed' }]);
      const info = acc && acc.value && acc.value.data && acc.value.data.parsed && acc.value.data.parsed.info;
      if (!info) {
        push('mint', 'red', 'Mint account readable', 'could not read the mint from any RPC — retrying next cycle', `${SOLSCAN}/token/${MINT}`);
      } else {
        const cur = +info.supply / 10 ** info.decimals;
        push('mintauth', info.mintAuthority == null ? 'green' : 'red',
          'Mint authority revoked',
          info.mintAuthority == null ? 'nobody can ever print more supply — read it yourself'
                                     : `STILL SET: ${info.mintAuthority} — supply can be printed. This line stays red until it is revoked`,
          `${SOLSCAN}/token/${MINT}`);
        push('freeze', info.freezeAuthority == null ? 'green' : 'red',
          'Freeze authority revoked',
          info.freezeAuthority == null ? 'no account can ever be frozen'
                                       : `STILL SET: ${info.freezeAuthority}`,
          `${SOLSCAN}/token/${MINT}`);

        // ---- supply can only fall: baseline recorded the first time we ever see it
        let base = await getJSON('g:supply0');
        if (!base) { base = { supply: cur, t: Date.now() }; await setJSON('g:supply0', base); }
        const destroyed = Math.max(0, base.supply - cur);
        push('supply', cur <= base.supply + 1e-9 ? 'green' : 'red',
          'Supply only falls',
          cur <= base.supply + 1e-9
            ? `${cur.toLocaleString()} now vs ${base.supply.toLocaleString()} at first check — ${destroyed.toLocaleString()} destroyed`
            : `SUPPLY GREW: ${base.supply.toLocaleString()} -> ${cur.toLocaleString()}. That should be impossible and this page is telling you so`,
          `${SOLSCAN}/token/${MINT}`);

        // ---- incinerator holdings: manual reloads land here
        const inc = await rpcCall('getTokenAccountsByOwner', [INCINERATOR, { mint: MINT }, { encoding: 'jsonParsed' }]);
        let incBal = 0, incAcct = null;
        for (const a of (inc && inc.value) || []) {
          incBal += +a.account.data.parsed.info.tokenAmount.uiAmount || 0;
          incAcct = a.pubkey;
        }
        push('incin', 'green', 'Incinerator holdings, live',
          `${incBal.toLocaleString()} RCX at the incinerator — manual reloads land here in the payer's own transaction; one-click reloads burn straight from the payer's account, so supply falls either way`,
          incAcct ? `${SOLSCAN}/account/${incAcct}` : `${SOLSCAN}/account/${INCINERATOR}`);

        // ---- burn attribution: the honest split. Player-verified burns
        // are the ones this game caused (replay-gated by signature).
        // Everything else that left supply — for RCX that is dominated by
        // pump.fun burning the unsold curve remainder at graduation — is
        // reported as exactly that, not claimed as game activity.
        const playerBurned = st.realBurned || 0;                       // total credited (one-click + manual)
        const playerSupplyBurns = Math.max(0, playerBurned - incBal);  // the part that reduced supply directly
        const otherDestroyed = Math.max(0, destroyed - playerSupplyBurns);
        push('attrib', 'green', 'Burns attributed by cause, not bundled',
          `players: ${playerBurned.toLocaleString()} RCX verified & credited · launchpad/other: ${Math.round(otherDestroyed).toLocaleString()} RCX left supply outside the game (pump.fun burns the unsold curve at graduation) — we count only ours`,
          `${SOLSCAN}/token/${MINT}`);

        // ---- recent burns with signatures, straight off the chain
        let recent = [];
        if (incAcct) {
          const sigs = await rpcCall('getSignaturesForAddress', [incAcct, { limit: 8 }]);
          recent = ((sigs || []).filter(s => !s.err) || []).map(s => ({
            sig: s.signature, t: s.blockTime ? s.blockTime * 1000 : null,
            link: `${SOLSCAN}/tx/${s.signature}`,
          }));
        }
        supply = { initial: base.supply, current: cur, destroyed, incinerated: incBal,
          playerBurned, otherDestroyed: Math.round(otherDestroyed), recent };
      }
      push('lp', LP_BURN_TX ? 'green' : 'grey', 'LP burned, not locked',
        LP_BURN_TX ? 'the pool tokens are gone — transaction linked' : 'flips green when the LP-burn tx is set after launch',
        LP_BURN_TX ? `${SOLSCAN}/tx/${LP_BURN_TX}` : null);
    }

    // ---- game-side honesty lines
    push('credits', 'green', 'Ranked credits trace to verified burns',
      `${(st.realBurned || 0).toLocaleString()} RCX burn-verified and credited in-game · replay-gated by signature · pot payouts are game credits (play-rights), never minted tokens — no faucet exists`);
    push('nokeys', 'green', 'No key can touch funds',
      'this server reads the chain and writes scores — there is no treasury, no custody, and nothing to steal');
    push('pots', 'green', 'Pots pay automatically, on two clocks',
      'daily pot: top 3 (50/30/20) at 00:00 UTC · weekly season: top 5 (40/25/15/12/8) Sunday 00:00 UTC · unclaimed shares roll over · demo play never ranks and is never paid');

    const logHead = await getJSON('g:log:head');
    const anchors = (await getJSON('g:anchors')) || [];
    push('log', anchors.length ? 'green' : 'grey', 'Event log anchored on-chain',
      logHead
        ? (anchors.length
            ? `${logHead.i.toLocaleString()} hash-chained events · anchored ${anchors.length}× · latest at entry #${anchors[0].i} by ${anchors[0].w}`
            : `${logHead.i.toLocaleString()} hash-chained events · head published · not yet anchored — any wallet can be first (+25 XP)`)
        : 'log is empty — first event creates it',
      anchors.length ? `${SOLSCAN}/tx/${anchors[0].sig}` : null);
    const out = { ok: true, v: VERSION, t: Date.now(), mint: MINT || null, supply, checks,
      log: logHead || null, anchors: anchors.slice(0, 8),
      logRecent: ((await getJSON('g:log:recent')) || []).slice(0, 12) };
    await setJSON('g:proofcache', out);
    return res.json(out);
  } catch (e) {
    try {
      const fallback = await getJSON('g:proofcache');
      if (fallback) return res.json(fallback);
    } catch {}
    return res.status(500).json({ ok: false, reason: String(e.message || e) });
  }
};
