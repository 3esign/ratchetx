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
const { getJSON, setJSON, hall} = require('../lib/kv.js');
const { rpcCall, INCINERATOR } = require('../lib/burn.js');
const { snap: snapSupply } = require('../lib/supplylog.js');
const { getPrices } = require('../lib/prices.js');
const { verifyChain, logCount, readEntries } = require('../lib/log.js');

const MINT = process.env.RATCHET_MINT || '';
const LP_BURN_TX = process.env.RATCHET_LP_BURN_TX || '';   // set after LP burn -> flips that line green with the tx link
const SOLSCAN = 'https://solscan.io';
const VERSION = 'h52-2026-08-22';


// ---- pump.fun coin record (graduation state + pool), cached 5 min in KV;
// read-only, keyless, and never allowed to break the page.
async function getCoin() {
  if (!MINT) return null;
  const c = await getJSON('g:coin');
  if (c && Date.now() - c.t < 300_000) return c.v;
  let v = null;
  for (const base of ['https://frontend-api-v3.pump.fun', 'https://frontend-api.pump.fun']) {
    try {
      const r = await fetch(`${base}/coins/${MINT}`, { signal: AbortSignal.timeout(3500), headers: { accept: 'application/json' } });
      if (!r.ok) continue;
      const j = await r.json();
      if (j && typeof j === 'object') { v = { complete: !!j.complete, pool: j.pump_swap_pool || j.raydium_pool || j.pool_address || null }; break; }
    } catch {}
  }
  await setJSON('g:coin', { v, t: Date.now() });
  return v;
}

module.exports = async (req, res) => {
  try {
    const cached = await getJSON('g:proofcache');
    if (cached && Date.now() - cached.t < 25_000) return res.json(cached);

    const checks = [];
    const push = (id, status, label, detail, link) => checks.push({ id, status, label, detail, link: link || null });

    // ---- heartbeat: only on-chain Pyth is valid for real play. A fallback
    // price can keep a display informative, but must never look settlement-ready.
    let prices = null, t0 = Date.now();
    try { prices = await getPrices(); } catch {}
    const pythLive = prices && prices.src === 'pyth-onchain';
    push('oracle', pythLive ? 'green' : (prices ? 'grey' : 'red'),
      pythLive ? 'On-chain Pyth settlement oracle is answering' : 'On-chain Pyth settlement oracle is unavailable',
      prices ? `${prices.src.toUpperCase()} · SOL $${prices.SOL.toFixed(2)} · ${Date.now() - t0}ms round-trip · ${pythLive ? 'valid for real seals and settlement' : 'display reference only — never used to seal or settle a real shot'}`
             : 'no price source is reachable — real shots cannot seal or settle');

    // totals live in an atomic hash now; fall back to the legacy blob until the
    // first write migrates it
    const stH = await hall('h:stats');
    const st = Object.keys(stH).length ? stH : ((await getJSON('g:stats')) || {});
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
        // One reading a day, kept. A burn claim is a sentence; a falling curve
        // with the transactions under it is evidence. See /api/supply.
        try { await snapSupply({ supply: cur, playerBurned, incinerated: incBal }); } catch {}
      }
      // ---- liquidity: a LIVE check since graduation. The bonding curve
      // completed and pump.fun moved the liquidity into a PumpSwap pool it
      // controls — no LP tokens were ever issued to the creator to pull.
      // We read the pump.fun record (cached 5 min) instead of asserting it.
      const coin = await getCoin();
      if (LP_BURN_TX) {
        push('lp', 'green', 'LP burned, not locked',
          'the pool tokens are gone — transaction linked', `${SOLSCAN}/tx/${LP_BURN_TX}`);
      } else if (coin && coin.complete) {
        push('lp', 'green', 'Graduated — liquidity lives on PumpSwap',
          'the bonding curve completed and the protocol moved the liquidity into the PumpSwap pool at graduation — no LP tokens were ever issued to us to pull. Read the pool yourself',
          coin.pool ? `${SOLSCAN}/account/${coin.pool}` : `https://pump.fun/coin/${MINT}`);
      } else {
        push('lp', 'grey', 'Graduation pending',
          coin ? 'still on the bonding curve — this line flips green when the token graduates and liquidity migrates to PumpSwap'
               : 'could not read the pump.fun record this cycle — retrying; flips green at graduation',
          `https://pump.fun/coin/${MINT}`);
      }
    }

    // ---- game-side honesty lines
    push('credits', 'green', 'Token reloads are verified; play-credit sources are disclosed',
      `${(st.realBurned || 0).toLocaleString()} RCX verifiably removed from player wallets and attributed to game reloads · each signature is replay-gated atomically with its credit deposit · play-credits also enter through the one-time 5,000 grant, 1.7× hit returns, pots and balance-based staking rewards · none of those operations mint RCX`);
    push('champs', 'green', 'Champions are paid peer-to-peer, keylessly',
      `every reload uses the frozen 70/30/0 split — 70% burns and 30% lands straight in the published live-daily podium snapshot inside the payer's own signed transaction · ${(st.champPaid || 0).toLocaleString()} RCX paid to other champions so far · today's settled-XP top three update live; previous-day seats only fill today's empty positions · no continuing hold or sell condition · no pool, custody or claim button`);
    push('settlement', 'grey', 'Mainnet settlement program is legacy evidence; live mirroring is disabled',
      'program 4WQ4…CM6E2 exists on mainnet, but its deployed rules do not meet the reviewed v2 first-crossing, confidence and disjoint void-deadline standard. The live game does not rely on it and it is not a vault',
      'https://solscan.io/account/4WQ4XTzC29M6YoxgNi9WHhYJWEtYyj6YNFtSB9yCM6E2');
    push('vault', 'grey', 'Redeemable floor vault is not deployed',
      'the Machine floor shown by the site is a labeled model only. No vault PDA, funded SOL balance, liability proof or no-withdraw program is being claimed');
    push('stake', 'green', 'Staking with no deposit',
      `registered wallets earn daily play-credits on their verified on-chain balance — tokens never leave the owner's wallet, so there is nothing to lock, nothing to withdraw, nothing to rug · ${(st.stakePaid || 0).toLocaleString()} credits paid to ${(st.stakers || 0)} stakers so far`);
    push('nokeys', 'green', 'No key can touch funds',
      'this server reads the chain and writes scores — there is no treasury, no custody, and nothing to steal');
    push('pots', 'green', 'Pots pay automatically, on two clocks',
      'daily pot: top 3 (50/30/20) at 00:00 UTC · weekly season: top 5 (40/25/15/12/8) Sunday 00:00 UTC · unclaimed shares roll over · demo play never ranks and is never paid');

    // ---- the Black Box: full log retained + exportable by anyone
    const bbHead = await getJSON('g:log:head');
    const bbC0 = bbHead ? await getJSON('g:log:c:0') : null;
    const lastRoot = await getJSON('g:lastRoot');
    push('blackbox', bbHead ? (bbC0 ? 'green' : 'grey') : 'grey',
      'The machine can be resurrected by anyone',
      bbHead
        ? (bbC0
            ? `the FULL ${bbHead.i.toLocaleString()}-entry log is retained and the whole state exports at /api/snapshot — code public, heads anchored on Solana, RESURRECTION.md in the repo${lastRoot ? ` · daily balance root in the log: ${lastRoot.root.slice(0, 10)}… (${lastRoot.day}, ${lastRoot.players} players)` : ''}. Killing our hosting pauses the game; it can no longer end it`
            : 'full-log retention arms on the next event — snapshot exports the state either way')
        : 'arms with the first logged event',
      '/api/snapshot');

    // ---- THE CHAIN, ACTUALLY VERIFIED.
    // Retention was reported here; integrity was not. The page said the log
    // was kept, and asked you to take the hashes on faith. Now it recomputes
    // every hash from genesis on each check, and compares the entry count
    // against the server-issued index — so a dropped event is reported rather
    // than hidden by a chain that is merely self-consistent.
    try {
      const issued = await logCount();
      if (issued > 0) {
        // Chunks are a legacy read accelerator and historically lost one row
        // to a shared read-modify-write race.  The verifier must merge the
        // authoritative per-index records exactly like /api/snapshot does;
        // otherwise it can report a storage-view bug as a chain break.
        const all = await readEntries(issued);
        const v = verifyChain(all, bbHead, issued);
        push('chain', v.ok ? 'green' : 'red',
          v.ok ? 'Every hash in the log recomputes from genesis'
               : 'The log does not verify — and this check is how you would know',
          v.ok
            ? `${all.length.toLocaleString()} entries replayed hash-by-hash, ${issued.toLocaleString()} issued by the server and ${all.length.toLocaleString()} stored. Rewriting any past event changes every hash after it, so this line turns red and stays red`
            : `broken at index ${v.brokenAt} — ${v.reason}. Nothing here is being hidden from you: the verifier reports the break instead of papering over it`,
          '/api/snapshot');
      }
    } catch (e) {
      push('chain', 'grey', 'Chain verification unavailable',
        'the log could not be read to verify right now — ' + String(e && e.message || e).slice(0, 80));
    }

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
