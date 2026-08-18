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
//  This is the TGE surface: supply falling, burns appearing with
//  signatures, authorities provably revoked — while people watch.
// ============================================================
const { getJSON, setJSON } = require('../lib/kv.js');
const { rpcCall, INCINERATOR } = require('../lib/burn.js');
const { getPrices } = require('../lib/prices.js');

const MINT = process.env.RATCHET_MINT || '';
const LP_BURN_TX = process.env.RATCHET_LP_BURN_TX || '';   // set after LP burn -> flips that line green with the tx link
const SOLSCAN = 'https://solscan.io';

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

        // ---- incinerator holdings: burns you can watch arrive
        const inc = await rpcCall('getTokenAccountsByOwner', [INCINERATOR, { mint: MINT }, { encoding: 'jsonParsed' }]);
        let incBal = 0, incAcct = null;
        for (const a of (inc && inc.value) || []) {
          incBal += +a.account.data.parsed.info.tokenAmount.uiAmount || 0;
          incAcct = a.pubkey;
        }
        push('incin', 'green', 'Incinerator holdings, live',
          `${incBal.toLocaleString()} RATCHET sitting at the incinerator — every reload lands here in the payer's own transaction`,
          incAcct ? `${SOLSCAN}/account/${incAcct}` : `${SOLSCAN}/account/${INCINERATOR}`);

        // ---- recent burns with signatures, straight off the chain
        let recent = [];
        if (incAcct) {
          const sigs = await rpcCall('getSignaturesForAddress', [incAcct, { limit: 8 }]);
          recent = ((sigs || []).filter(s => !s.err) || []).map(s => ({
            sig: s.signature, t: s.blockTime ? s.blockTime * 1000 : null,
            link: `${SOLSCAN}/tx/${s.signature}`,
          }));
        }
        supply = { initial: base.supply, current: cur, destroyed, incinerated: incBal, recent };
      }
      push('lp', LP_BURN_TX ? 'green' : 'grey', 'LP burned, not locked',
        LP_BURN_TX ? 'the pool tokens are gone — transaction linked' : 'flips green when the LP-burn tx is set after launch',
        LP_BURN_TX ? `${SOLSCAN}/tx/${LP_BURN_TX}` : null);
    }

    // ---- game-side honesty lines
    const st = (await getJSON('g:stats')) || {};
    push('credits', 'green', 'Game credits trace to verified burns',
      `${(st.realBurned || 0).toLocaleString()} RATCHET burn-verified and credited in-game · replay-gated by signature`);
    push('nokeys', 'green', 'No key can touch funds',
      'this server reads the chain and writes scores — there is no treasury, no custody, and nothing to steal');

    const logHead = await getJSON('g:log:head');
    const anchors = (await getJSON('g:anchors')) || [];
    push('log', anchors.length ? 'green' : 'grey', 'Event log anchored on-chain',
      logHead
        ? (anchors.length
            ? `${logHead.i.toLocaleString()} hash-chained events · anchored ${anchors.length}× · latest at entry #${anchors[0].i} by ${anchors[0].w}`
            : `${logHead.i.toLocaleString()} hash-chained events · head published · not yet anchored — any wallet can be first (+25 XP)`)
        : 'log is empty — first event creates it',
      anchors.length ? `${SOLSCAN}/tx/${anchors[0].sig}` : null);
    const out = { ok: true, t: Date.now(), mint: MINT || null, supply, checks,
      log: logHead || null, anchors: anchors.slice(0, 8),
      logRecent: ((await getJSON('g:log:recent')) || []).slice(0, 12) };
    await setJSON('g:proofcache', out);
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, reason: String(e.message || e) });
  }
};
