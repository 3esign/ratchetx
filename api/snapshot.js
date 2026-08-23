// ============================================================
//  api/snapshot.js — THE BLACK BOX. The machine's entire soul,
//  downloadable by anyone, at any time, for free.
//
//  Why this exists: the token is unkillable (authorities revoked)
//  and the code is unkillable (public repo). The STATE was the
//  one mortal part — players' credits, the ladder, the log all
//  lived in one database. This endpoint removes that mortality:
//  anyone holding a snapshot + the public repo can resurrect the
//  machine on their own hosting, and the hash chain inside the
//  snapshot verifies against the heads anchored on Solana — so a
//  resurrected history is PROVABLY the real one, not a story.
//
//  See RESURRECTION.md for the stranger's guide. Killing our
//  hosting now pauses the game; it can no longer end it.
//
//  Read-only. Cached 5 minutes per instance. The sha256 covers
//  the canonical JSON of `state` so mirrors can be compared.
// ============================================================
const crypto = require('node:crypto');
const { getJSON, getManyJSON, scanKeys, scanZKeys, ztop, durable, backend, hall} = require('../lib/kv.js');

const VERSION = 'h66-2026-08-23';
const MINT = process.env.RATCHET_MINT || '';

const memo = globalThis.__ratchet_snap || (globalThis.__ratchet_snap = { t: 0, body: null });

module.exports = async (req, res) => {
  try {
    if (memo.body && Date.now() - memo.t < 300_000) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(memo.body);
    }

    // ---- the full log: legacy chunks plus authoritative immutable entries
    const head = (await getJSON('g:log:head')) || null;
    // The server-issued index count travels with the export, so an outside
    // verifier can tell a complete log from a truncated one.
    const issued = Number(await getJSON('g:log:n')) || (head ? head.i : 0);
    const logSlots = [];
    if (head) {
      const chunks = Math.ceil(Math.max(head.i, issued) / 500);
      for (let c = 0; c < chunks; c++) {
        const part = (await getJSON(`g:log:c:${c}`)) || [];
        for (const e of part) if (e && e.i) logSlots[e.i - 1] = e;
      }
      // New entries are stored one writer per key. Read them in bounded MGETs
      // and let them repair any chunk entry lost to a historical RMW race.
      for (let start = 1; start <= issued; start += 500) {
        const end = Math.min(issued, start + 499);
        const keys = Array.from({length:end-start+1}, (_,n)=>`g:log:e:${start+n}`);
        const rows = await getManyJSON(keys);
        rows.forEach((e,n)=>{ if(e) logSlots[start+n-1]=e; });
      }
    }
    const log = logSlots.filter(Boolean);

    const _sh = await hall('h:stats');
    const statsOut = Object.keys(_sh).length ? _sh : ((await getJSON('g:stats')) || null);

    // ---- every player, every replay gate, every game singleton
    const players = {};
    for (const k of await scanKeys('u:*')) {
      const p = await getJSON(k);
      // SEALED means sealed, even in the Black Box: open shots export
      // WITHOUT side/salt (the commit stays, so seals remain verifiable).
      // A machine resurrected from a snapshot therefore VOID-REFUNDS any
      // still-open shots — restore.mjs does this and says so.
      if (p) players[k.slice(2)] = { ...p, open: (p.open || []).map(({ side, salt, xp, ...rest }) => rest) };
    }
    const sigs = {};
    for (const k of await scanKeys('sig:*')) {
      const v = await getJSON(k);
      if (v) sigs[k.slice(4)] = v;
    }
    const hists = {};
    for (const k of await scanKeys('hist:*')) {
      const v = await getJSON(k);
      if (v) hists[k.slice(5)] = v;
    }
    const championHists = {};
    for (const k of await scanKeys('chist:*')) {
      const v = await getJSON(k);
      if (v) championHists[k.slice(6)] = v;
    }
    // Credits and champion receipts may be banked while a wallet is idle.
    // Omitting these queues made "whole machine" snapshots silently lose
    // already-earned value on restore.
    const pending = {};
    for (const k of await scanKeys('pend:*')) {
      const v = Number(await getJSON(k)) || 0;
      if (v) pending[k.slice(5)] = v;
    }
    const championPending = {};
    for (const k of await scanKeys('c7:*')) {
      const v = Number(await getJSON(k)) || 0;
      if (v) championPending[k.slice(3)] = v;
    }
    const championSelfPending = {};
    for (const k of await scanKeys('cs7:*')) {
      const v = Number(await getJSON(k)) || 0;
      if (v) championSelfPending[k.slice(4)] = v;
    }
    const boards = {};
    for (const k of [...await scanKeys('lb:*'), ...await scanKeys('lbd:*')]) {
      const v = await getJSON(k);
      if (v) boards[k] = v;
    }
    // Atomic ladders live in Redis sorted sets, not the legacy JSON keys above.
    // Export every row explicitly or a resurrection silently loses live XP.
    const sortedBoards = {};
    const zkeys = [...new Set([
      ...await scanZKeys('z:lb:*'),
      ...await scanZKeys('z:lbd:*'),
      ...await scanZKeys('z:lba:*'),
    ])];
    for (const k of zkeys) {
      const rows = await ztop(k);
      if (rows.length) sortedBoards[k] = rows;
    }

    const state = {
      mint: MINT || null,
      stats: statsOut,
      season: (await getJSON('g:season')) || null,
      day: (await getJSON('g:day')) || null,
      podium: (await getJSON('g:podium')) || null,
      podiumPrev: (await getJSON('g:podium:prev')) || null,
      podiumFallback: (await getJSON('g:podium:fallback')) || null,
      podiumHistory: (await getJSON('g:podium:history')) || [],
      feed: (await getJSON('g:feed')) || [],
      anchors: (await getJSON('g:anchors')) || [],
      warden: {
        rec: (await getJSON('g:warden:rec')) || null,
        hist: (await getJSON('g:warden:hist')) || [],
        open: (await getJSON('g:warden:open')) || [],
      },
      results: {
        day: (await getJSON('g:dayResults')) || null,
        season: (await getJSON('g:seasonResults')) || null,
      },
      supply0: (await getJSON('g:supply0')) || null,
      boards, sortedBoards, players, sigs, hists, championHists, pending, championPending, championSelfPending,
      logHead: head,
      log,
      logIssued: issued,
    };

    const canonical = JSON.stringify(state);
    const out = {
      ok: true, v: VERSION, t: Date.now(), durable, storage:backend,
      note: 'This is the whole machine. Verify: replay `log` from sha256("ratchet-genesis") — it must reach `logHead`, whose anchors live on Solana. Restore: see RESURRECTION.md in the repo.',
      sha256: crypto.createHash('sha256').update(canonical).digest('hex'),
      logComplete: !!head && issued === head.i && log.length === issued,
      state,
    };
    memo.t = Date.now(); memo.body = JSON.stringify(out);
    res.setHeader('Content-Type', 'application/json');
    return res.end(memo.body);
  } catch (e) {
    return res.status(500).json({ ok: false, reason: String(e.message || e) });
  }
};
