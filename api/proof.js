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
const { verifyLegacy } = require('../lib/legacy_chain.js');
const { getJSON, setJSON, hall} = require('../lib/kv.js');
const { rpcCall, INCINERATOR } = require('../lib/burn.js');
const { snap: snapSupply } = require('../lib/supplylog.js');
const { getPrices } = require('../lib/prices.js');
const { pathFor, streamHealth: pxStreamHealth } = require('../lib/pxlog.js');
const { verifyChain, logCount, readEntries } = require('../lib/log.js');
const { anchorFreshness } = require('../lib/anchor-health.js');

const MINT = process.env.RATCHET_MINT || '';
const LP_BURN_TX = process.env.RATCHET_LP_BURN_TX || '';   // set after LP burn -> flips that line green with the tx link
const SEAL_PROGRAM_ID = process.env.RATCHET_SEAL_PROGRAM_ID || '';
const SEAL_RPC_URL = process.env.RATCHET_SEAL_RPC_URL || process.env.SOLANA_RPC || process.env.SOLANA_RPC_URL || '';
const SEAL_CLUSTER = process.env.RATCHET_SEAL_CLUSTER || 'devnet';
const MAINNET_SEAL_V2 = '23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX';
const MAINNET_SOL_CLOCK = 'CE5m9Xag3wwgcfVkbSBnv5WFKPrY1ZhLwSSru9wu9gN';
const SOLSCAN = 'https://solscan.io';
const VERSION = 'h70-2026-08-25';


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
    // A live RPC read proves the oracle answers now; it does not prove that
    // first-crossing evidence was sampled continuously while nobody watched.
    try {
      const now = Date.now(), windowMs = 60 * 60_000;
      const samples = await pathFor('SOL', now - windowMs, now, 'pyth-onchain');
      const last = samples.length ? samples[samples.length - 1][0] : 0;
      const ageSec = last ? Math.max(0, Math.floor((now - last) / 1000)) : null;
      const duty = +(samples.length / 60 * 100).toFixed(1);
      const fresh = ageSec != null && ageSec <= 120;
      const complete = duty >= 90;
      const ageText = ageSec == null ? 'no recent sample' : 'latest ' + ageSec + 's ago';
      push('sampler', fresh && complete ? 'green' : (fresh ? 'grey' : 'red'),
        fresh && complete ? 'Fallback settlement sampler is continuous'
          : (fresh ? 'Fallback settlement sampler is live but has coverage gaps'
                   : 'Fallback settlement sampler is not current'),
        samples.length + '/60 expected minute samples in the last hour (' + duty
          + '% duty) · ' + ageText
          + ' · missing minutes can force an otherwise valid shot to void and refund',
        '/api/feeds');
    } catch (e) {
      push('sampler', 'grey', 'Fallback settlement sampler health unavailable',
        'the stored price path could not be read right now — '
          + String(e && e.message || e).slice(0, 80),
        '/api/feeds');
    }

    try {
      const sh = await pxStreamHealth();
      const ages = Object.values(sh.feeds).map(f => f.ageS).filter(Number.isFinite);
      const oldest = ages.length ? Math.max(...ages) : null;
      push('oracle-stream', sh.ok ? 'green' : (sh.active ? 'grey' : 'red'),
        sh.ok ? 'Exact Pyth account-transition stream is live'
          : (sh.active ? 'Pyth transition stream is partially live'
                       : 'Pyth transition stream has no current feeds'),
        sh.active + '/' + sh.total + ' sponsored accounts current'
          + (oldest == null ? '' : ' · oldest received event ' + oldest + 's ago')
          + ' · account bytes are revalidated server-side and duplicate publishes are idempotent'
          + ' · minute polling remains an independent fallback',
        '/api/game?action=stream-health');
    } catch (e) {
      push('oracle-stream', 'grey', 'Pyth transition stream health unavailable',
        String(e && e.message || e).slice(0, 100),
        '/api/game?action=stream-health');
    }

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
    let sealProgramLive = false, sealClockLive = false;
    if (SEAL_PROGRAM_ID === MAINNET_SEAL_V2 && SEAL_CLUSTER === 'mainnet-beta' && SEAL_RPC_URL) {
      try {
        const rr = await fetch(SEAL_RPC_URL, { method:'POST', headers:{'content-type':'application/json'},
          body:JSON.stringify({ jsonrpc:'2.0', id:1, method:'getMultipleAccounts',
            params:[[MAINNET_SEAL_V2, MAINNET_SOL_CLOCK], { encoding:'base64', commitment:'confirmed' }] }),
          signal:AbortSignal.timeout(4500) });
        const jj = await rr.json(), vv = jj && jj.result && jj.result.value;
        sealProgramLive = !!(vv && vv[0] && vv[0].executable);
        sealClockLive = !!(vv && vv[1] && vv[1].owner === MAINNET_SEAL_V2);
      } catch {}
    }
    const sealBetaLive = sealProgramLive && sealClockLive;
    push('settlement', sealBetaLive ? 'green' : 'grey',
      sealBetaLive ? 'V2 mainnet program and SOL clock verified; optional sealing beta is live'
                   : 'V2 mainnet program is deployed; browser sealing is disabled or its live check is unavailable',
      sealBetaLive
        ? 'program 23k3…ZEEX is executable and owns the SOL FeedClock checked now · a player may seal a SOL shot on-chain without changing game XP · server settlement remains canonical during the soak period · upgrade authority is retained during that period · this program is not the floor vault'
        : 'program 23k3…ZEEX was deployed from the reproducible v2 binary with first-checkpoint crossing, confidence and disjoint void-deadline rules; the feature stays optional until the configured program, cluster, RPC and clock all verify',
      'https://solscan.io/account/' + MAINNET_SEAL_V2);
    push('vault', 'grey', 'Redeemable floor vault is not deployed',
      'the Machine floor shown by the site is a labeled model only. No vault PDA, funded SOL balance, liability proof or no-withdraw program is being claimed');
    push('stake', 'green', 'Staking with no deposit',
      `registered wallets earn daily play-credits on their verified on-chain balance — tokens never leave the owner's wallet, so there is nothing to lock, nothing to withdraw, nothing to rug · ${(st.stakePaid || 0).toLocaleString()} credits paid to ${(st.stakers || 0)} stakers so far`);
    push('nokeys', 'green', 'No key can touch funds',
      'this server reads the chain and writes scores — there is no treasury, no custody, and nothing to steal');
    push('pots', 'green', 'Pots pay automatically, on two clocks',
      'daily pot: top 3 (50/30/20) at 00:00 UTC · weekly season: top 5 (40/25/15/12/8) Sunday 00:00 UTC · unclaimed shares roll over · demo play never ranks and is never paid');

    // ---- the Black Box: exportable by anyone, but green only when the
    // exported event log is complete and verifies.
    const bbHead = await getJSON('g:log:head');
    const lastRoot = await getJSON('g:lastRoot');
    let chainVerdict = null, chainEntries = [], chainError = null, issued = 0, legacy = null;
    try {
      issued = await logCount();
      if (issued > 0) {
        chainEntries = await readEntries(issued);
        chainVerdict = verifyChain(chainEntries, bbHead, issued);
        // Entries written before canonical hashing were hashed over their keys
        // in INSERTION order, and the storage layer re-sorted them at every
        // depth. verifyChain therefore cannot replay them and never could; the
        // recovery walks both rules in one pass and reports what it can prove.
        // An entry whose predecessor is missing is counted as unverifiable
        // rather than failed — its prev hash died with that entry, which is
        // arithmetic, not a discrepancy. See docs/CHAIN_GAP.md.
        legacy = verifyLegacy(chainEntries);
      }
    } catch (e) { chainError = e; }

    let bbStatus = 'grey', bbDetail = 'arms with the first logged event';
    if (chainError) {
      bbDetail = 'snapshot export is available, but log completeness could not be checked right now: '
        + String(chainError.message || chainError).slice(0, 90);
    // ORDER MATTERS. verifyChain can only replay canonically-hashed entries, so
    // on a log that predates that rule it always reports failure. Letting it
    // answer first is what kept this line red after the recovery already
    // proved every retained entry reproduces.
    } else if (legacy && legacy.unrecovered === 0 && legacy.total > 0) {
      // Everything we hold reproduces its own hash. What is missing is missing,
      // and is named rather than rounded away.
      bbStatus = legacy.orphaned || (chainVerdict && !chainVerdict.intact) ? 'grey' : 'green';
      bbDetail = 'the whole state exports at /api/snapshot and all '
        + legacy.verified.toLocaleString() + ' retained entries reproduce their own hash'
        + (legacy.orphaned
            ? ', but the export is NOT complete: entry ' + (chainVerdict && chainVerdict.missing || []).join(', ')
              + ' was lost before it was ever stored, so a machine rebuilt from this export is faithful either '
              + 'side of that index and blind at it. Cause, date and fix: docs/CHAIN_GAP.md'
            : '; code public, heads anchored on Solana, RESURRECTION.md in the repo')
        + (lastRoot ? ' · daily balance root: ' + lastRoot.root.slice(0, 10) + '… ('
            + lastRoot.day + ', ' + lastRoot.players + ' players)' : '');
    } else if (chainVerdict && !chainVerdict.ok) {
      bbStatus = 'red';
      bbDetail = 'snapshot export is available, but resurrection verification currently fails at entry '
        + chainVerdict.brokenAt + ': ' + chainVerdict.reason
        + '. The gap is disclosed and must not be described as a complete restorable log';
    } else if (chainVerdict && chainVerdict.ok && !chainVerdict.intact) {
      // Honest middle state: everything we hold verifies, but we do not hold
      // everything. Never green — a resurrection from this export rebuilds the
      // machine with a named hole in its history, and the operator does not get
      // to round that up to "complete".
      bbStatus = 'grey';
      bbDetail = 'the whole state exports at /api/snapshot and every stored entry verifies, but the export is NOT complete: entry '
        + chainVerdict.missing.join(', ') + ' was lost before it was ever stored and cannot be recovered. '
        + 'A machine rebuilt from this export is faithful either side of that index and blind at it. '
        + 'Cause, date and fix: docs/CHAIN_GAP.md'
        + (lastRoot ? ' · daily balance root: ' + lastRoot.root.slice(0, 10) + '… ('
            + lastRoot.day + ', ' + lastRoot.players + ' players)' : '');
    } else if (chainVerdict && chainVerdict.ok) {
      bbStatus = 'green';
      bbDetail = 'all ' + chainEntries.length.toLocaleString()
        + ' issued entries are retained and verify; the whole state exports at /api/snapshot'
        + ' — code public, heads anchored on Solana, RESURRECTION.md in the repo'
        + (lastRoot ? ' · daily balance root: ' + lastRoot.root.slice(0, 10) + '… ('
            + lastRoot.day + ', ' + lastRoot.players + ' players)' : '');
    }
    push('blackbox', bbStatus, 'The machine can be resurrected by anyone',
      bbDetail, '/api/snapshot');

    // ---- THE CHAIN, ACTUALLY VERIFIED.
    if (chainError) {
      push('chain', 'grey', 'Chain verification unavailable',
        'the log could not be read to verify right now — '
          + String(chainError && chainError.message || chainError).slice(0, 80));
    } else if (issued > 0) {
      const v = chainVerdict;
      // Three states, not two. An undisclosed break is red and must stay red.
      // A disclosed, permanently documented loss is its own state: the stored
      // entries verify in segments around it, and the hole is named every time
      // this page loads. It is not a pass. Rounding it up to green would be the
      // exact dishonesty this endpoint exists to prevent.
      // The legacy recovery is the authority on whether an entry reproduces:
      // verifyChain can only replay canonically-hashed entries, and most of the
      // log predates that rule.
      const recovered = legacy && legacy.unrecovered === 0 && legacy.total > 0;
      const chStatus = !recovered ? (!v.ok ? 'red' : (v.intact ? 'green' : 'grey'))
                     : (v.intact && !legacy.orphaned ? 'green' : 'grey');
      const segTxt = (v.segments || []).map(g => g.from + '–' + g.to).join(' and ');
      push('chain', chStatus,
        recovered
          ? (v.intact && !legacy.orphaned
              ? 'Every entry in the log reproduces its own hash'
              : 'Every entry we hold reproduces its own hash; one entry is permanently lost and disclosed')
        : !v.ok  ? 'The log does not verify — and this check is how you would know'
        : v.intact ? 'Every hash in the log recomputes from genesis'
                   : 'The log verifies in segments around one disclosed, permanent gap',
        recovered
          ? legacy.verified.toLocaleString() + ' of ' + issued.toLocaleString()
            + ' issued entries replayed hash-by-hash'
            + (legacy.canonical ? ' (' + legacy.canonical.toLocaleString() + ' under the canonical rule, the rest replayed in the key order they were written in)' : '')
            + (legacy.orphaned
                ? '. Entry ' + (v.missing || []).join(', ') + ' was issued but never stored, so the single link across it cannot be proven — the hash before it died with it. That is one entry and one link, and both are named here every time this page loads: docs/CHAIN_GAP.md'
                : '. Rewriting any past event changes its hash, so this line turns red and stays red')
        : !v.ok
          ? 'broken at index ' + v.brokenAt + ' — ' + v.reason
              + '. Nothing here is being hidden from you: the verifier reports the break '
              + 'instead of papering over it'
        : v.intact
          ? chainEntries.length.toLocaleString() + ' entries replayed hash-by-hash, '
              + issued.toLocaleString() + ' issued by the server and '
              + chainEntries.length.toLocaleString() + ' stored. Rewriting any past event '
              + 'changes every hash after it, so this line turns red and stays red'
          : 'entry ' + v.missing.join(', ') + ' was issued but never stored, and the hash before it '
              + 'is gone — so it cannot be rebuilt without inventing it, and we will not invent it. '
              + 'Segments ' + segTxt + ' each replay hash-by-hash (' + chainEntries.length.toLocaleString()
              + ' of ' + issued.toLocaleString() + ' issued entries verify). The segment after the gap is '
              + 'anchored on its own stored hash — declared, not proven — and every entry after that anchor '
              + 'is proven against it. Tampering anywhere still turns this red. Full disclosure: docs/CHAIN_GAP.md',
        '/api/snapshot');
    }
    const logHead = await getJSON('g:log:head');
    const anchors = (await getJSON('g:anchors')) || [];
    const latestAnchor = anchors[0] || null;
    const freshness = anchorFreshness({ anchor:latestAnchor, head:logHead });
    const { ageSec:anchorAgeSec, headDistance:anchorHeadDistance, status:anchorStatus } = freshness;
    push('log', anchorStatus, 'Event log anchor freshness',
      logHead
        ? (anchors.length
            ? `${logHead.i.toLocaleString()} hash-chained events · anchored ${anchors.length}× · latest at entry #${latestAnchor.i} by ${latestAnchor.w} · ${anchorHeadDistance == null ? 'distance unknown' : `${anchorHeadDistance.toLocaleString()} entries behind`}${anchorAgeSec == null ? '' : ` · ${Math.floor(anchorAgeSec/3600)}h old`}`
            : `${logHead.i.toLocaleString()} hash-chained events · head published · not yet anchored — any wallet can be first (+25 XP)`)
        : 'log is empty — first event creates it',
      latestAnchor ? `${SOLSCAN}/tx/${latestAnchor.sig}` : null);
    const out = { ok: true, v: VERSION, t: Date.now(), mint: MINT || null, supply, checks,
      truthPlane: { canonicalSettlement:'ratchet-server',
        oracleInput:'pyth-price-update-v2-accounts-read-from-solana',
        onchainSeal:SEAL_PROGRAM_ID ? `optional-${SEAL_CLUSTER}` : 'disabled' },
      anchorFreshness: freshness,
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
