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
const { getJSON, scanKeys, durable } = require('../lib/kv.js');

const VERSION = 'h14-2026-08-20';
const MINT = process.env.RATCHET_MINT || '';

const memo = globalThis.__ratchet_snap || (globalThis.__ratchet_snap = { t: 0, body: null });

module.exports = async (req, res) => {
  try {
    if (memo.body && Date.now() - memo.t < 300_000) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(memo.body);
    }

    // ---- the full log, from the retention chunks
    const head = (await getJSON('g:log:head')) || null;
    const log = [];
    if (head) {
      const chunks = Math.ceil(head.i / 500);
      for (let c = 0; c < chunks; c++) {
        const part = (await getJSON(`g:log:c:${c}`)) || [];
        for (const e of part) log.push(e);
      }
    }

    // ---- every player, every replay gate, every game singleton
    const players = {};
    for (const k of await scanKeys('u:*')) {
      const p = await getJSON(k);
      // SEALED means sealed, even in the Black Box: open shots export
      // WITHOUT side/salt (the commit stays, so seals remain verifiable).
      // A machine resurrected from a snapshot therefore VOID-REFUNDS any
      // still-open shots — restore.mjs does this and says so.
      if (p) players[k.slice(2)] = { ...p, open: (p.open || []).map(({ side, salt, ...rest }) => rest) };
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
    const boards = {};
    for (const k of [...await scanKeys('lb:*'), ...await scanKeys('lbd:*')]) {
      const v = await getJSON(k);
      if (v) boards[k] = v;
    }

    const state = {
      mint: MINT || null,
      stats: (await getJSON('g:stats')) || null,
      season: (await getJSON('g:season')) || null,
      day: (await getJSON('g:day')) || null,
      podium: (await getJSON('g:podium')) || null,
      podiumPrev: (await getJSON('g:podium:prev')) || null,
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
      boards, players, sigs, hists,
      logHead: head,
      log,
    };

    const canonical = JSON.stringify(state);
    const out = {
      ok: true, v: VERSION, t: Date.now(), durable,
      note: 'This is the whole machine. Verify: replay `log` from sha256("ratchet-genesis") — it must reach `logHead`, whose anchors live on Solana. Restore: see RESURRECTION.md in the repo.',
      sha256: crypto.createHash('sha256').update(canonical).digest('hex'),
      logComplete: !!head && log.length === head.i,
      state,
    };
    memo.t = Date.now(); memo.body = JSON.stringify(out);
    res.setHeader('Content-Type', 'application/json');
    return res.end(memo.body);
  } catch (e) {
    return res.status(500).json({ ok: false, reason: String(e.message || e) });
  }
};
