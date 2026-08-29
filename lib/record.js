// ============================================================
//  lib/record.js — THE RECORD.
//
//  WHAT THIS IS.
//  Every time anyone plays RATCHET, the game produces one thing that did not
//  exist before: a prediction that was SEALED before the outcome, SETTLED by
//  a deterministic oracle rule, and BACKED by a stake. Commit hash first,
//  reveal after, exit price pinned to the first fully validated transition
//  captured by RATCHET at or after expiry. The capture duty is public because
//  the server settlement plane cannot honestly claim a transition it missed.
//
//  WHY IT MATTERS MORE THAN THE GAME.
//  That combination is rare. Prediction markets publish prices, not who said
//  what. Social media is full of calls with no seal, no stake, and no
//  settlement. Trading firms have the records and will never publish them.
//  A public, continuously growing, tamper-evident corpus of "this identity
//  claimed this, with money on it, before it happened, and here is whether
//  they were right" is a research object, an agent benchmark, and a
//  calibration dataset all at once.
//
//  AND IT COMPOUNDS. Every shot adds a row for free, as a by-product of
//  someone enjoying themselves. The corpus is worth more the longer it runs
//  and cannot be back-filled by anyone starting later — its value is the one
//  thing here that is genuinely un-copyable.
//
//  So it is open. The export is CORS-open, paginated, unauthenticated, and
//  free, and the schema is documented in DATASET.md. Nothing about it is a
//  funnel back to the site.
//
//  IDENTITY. Registered agents are exported by the name they chose, because
//  a public accuracy record is the entire point of registering. Everyone
//  else gets a stable pseudonym, sha256("ratchet-record-v1|" + wallet), so
//  the rows of one player can be joined without this becoming a bulk dump of
//  wallet addresses. The salt is public and stated: that is a join key, not
//  anonymity, and it is described as exactly that.
// ============================================================
const crypto = require('node:crypto');
const { getJSON, getJSONStrict, getManyJSON } = require('./kv.js');
const { CHUNK, logCount, readEntries } = require('./log.js');
const { verifyCommit } = require('./commit.js');

const SALT = 'ratchet-record-v1|';
const SCHEMA = 4;
const MAX_LIMIT = 1000;

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const pseudo = w => sha(SALT + w).slice(0, 12);

/** Registered agents, by wallet. Bounded by the arena registry, so this is
 *  one small read rather than a lookup per row. */
async function agentNames() {
  const reg = (await getJSON('g:arena')) || [];
  const out = {};
  for (const w of reg.slice(0, 200)) {
    const p = await getJSON(`u:${w}`);
    if (p && p.agent && p.agent.name) out[w] = String(p.agent.name).slice(0, 40);
  }
  return out;
}

/** Raw log entries from index `after+1` onward, in order. */
async function entriesAfter(after, want) {
  const byIndex = new Map();
  let c = Math.floor(Math.max(0, after) / CHUNK);
  while (byIndex.size < want) {
    const chunk = await getJSON(`g:log:c:${c}`);
    if (!chunk || !chunk.length) break;
    for (const e of chunk) {
      if (!e || e.i <= after) continue;
      byIndex.set(e.i,e);
      if (byIndex.size >= want) break;
    }
    c++;
  }
  const issued = Number(await getJSON('g:log:n')) || 0;
  const end = Math.min(issued, after + want);
  for (let start = after + 1; start <= end; start += 500) {
    const stop = Math.min(end,start+499);
    const keys = Array.from({length:stop-start+1},(_,n)=>`g:log:e:${start+n}`);
    const rows = await getManyJSON(keys);
    rows.forEach((e,n)=>{ if(e) byIndex.set(start+n,e); });
  }
  return [...byIndex.values()].sort((a,b)=>a.i-b.i).slice(0,want);
}

/**
 * Settled predictions, oldest first, as flat rows.
 *
 * A row is emitted only when a shot has SETTLED, because an open shot's side
 * is sealed and exporting it would be the hole in that promise. The seal
 * event supplies entry price, stake and expiry; the settle event supplies the
 * reveal and the outcome. They are joined on (wallet, shot id).
 */
async function rows({ after = 0, limit = 200 } = {}) {
  const want = Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit) || 200));
  const names = await agentNames();

  // Scan forward from the cursor. Seals almost always precede their settle in
  // the same neighbourhood of the log, so a modest look-ahead joins nearly
  // everything; a seal that fell before the cursor is looked up in the
  // player's own record rather than dropped.
  const scan = await entriesAfter(after, want * 6);
  const seals = new Map();
  const out = [];
  let cursor = after;

  for (const e of scan) {
    const ev = e && e.ev;
    if (!ev) continue;
    if (ev.k === 'seal') { seals.set(`${ev.w}|${ev.id}`, { e, ev }); continue; }
    if (ev.k !== 'settle') continue;

    cursor = e.i;
    const key = `${ev.w}|${ev.id}`;
    const s = seals.get(key);
    const commit = ev.commit || (s && s.ev.commit) || null;
    const commitVersion = Number(ev.commitV || (s && s.ev.commitV) || 1);
    const proof = verifyCommit({ version: commitVersion, wallet: ev.w,
      shotId: ev.id, side: ev.side, salt: ev.salt, commit });

    out.push({
      schema: SCHEMA,
      i: e.i,                                   // position in the hash chain
      id: ev.id,
      who: names[ev.w] ? null : pseudo(ev.w),   // pseudonym, or null for a named agent
      agent: names[ev.w] || null,               // opted in to a public record
      feed: (s && s.ev.feed) || null,
      feed2: (s && s.ev.feed2) || null,
      kind: (s && s.ev.kind) || null,
      stake: (s && s.ev.stake) != null ? s.ev.stake : null,
      entry: (s && s.ev.entry) != null ? s.ev.entry : null,
      entry2: (s && s.ev.entry2) != null ? s.ev.entry2 : null,
      threshold: (s && s.ev.thresh) != null ? s.ev.thresh : null,
      pct: (s && s.ev.pct) != null ? s.ev.pct : null,
      statedProbability: ev.sp != null ? ev.sp : null,
      sealedAt: s ? s.e.t : null,
      expiry: (s && s.ev.exp) != null ? s.ev.exp : null,
      side: ev.side || null,                    // revealed only now, never before
      result: ev.res || null,                   // hit | miss | void
      exit: ev.exitPx != null ? ev.exitPx : null,
      exitAt: ev.exitAt != null ? ev.exitAt : null,
      exit2: ev.exitPx2 != null ? ev.exitPx2 : null,
      exitAt2: ev.exitAt2 != null ? ev.exitAt2 : null,
      previousExitAt: ev.prevExitAt != null ? ev.prevExitAt : null,
      previousExitAt2: ev.prevExitAt2 != null ? ev.prevExitAt2 : null,
      exitConfidenceBps: ev.exitConfBps != null ? ev.exitConfBps : null,
      settledAt: e.t,
      settlementAuthority: 'ratchet-server',
      oracleSource: 'pyth-price-update-v2-accounts-read-from-solana',
      commit,
      commitVersion,
      salt: ev.salt || null,
      settleRule: ev.settleRuleApplied || ev.settleRule
        || (s && s.ev.settleRule) || null,
      outcomeRule: ev.outcomeRule || (s && s.ev.outcomeRule) || null,
      // Whether this row carries a commitment at all. The earliest rows in the
      // log predate commit-reveal: they are honest history, but they are not
      // sealed calls, and a consumer filtering for "sealed before the outcome"
      // must be able to say so without inspecting nulls and guessing why.
      sealed: !!(commit && ev.side && ev.salt),
      // Recomputed here so a consumer sees the seal verified rather than
      // asserted. null when the row predates commit-reveal or is a void.
      commitVerified: (commit && proof.recomputed) ? proof.matches : null,
      reason: ev.reason || null,                // why a void was a void
    });
    if (out.length >= want) break;
  }

  // Nothing joined and nothing settled: still advance so a caller polling for
  // new rows does not spin on a stretch of the log with no predictions in it.
  if (!out.length && scan.length) cursor = scan[scan.length - 1].i;

  return { rows: out, cursor, schema: SCHEMA };
}

/** Internal exact lookup for paid proof generation. The raw wallet never
 * leaves this module's caller unless that caller explicitly serializes it.
 * Player state is used only to supplement legacy log rows that predate the
 * additive kind/threshold fields; the hash-chained seal and settle events
 * remain the authority for every field they carry. */
async function findSettledShot(id) {
  const shotId = String(id || '').trim();
  if (!/^[A-Za-z0-9:_-]{1,80}$/.test(shotId)) return null;
  const list = await readEntries(await logCount());
  const settlements = list.filter(e => e && e.ev && e.ev.k === 'settle'
    && e.ev.id === shotId);
  if (settlements.length !== 1) return null;
  const settled = settlements[0];
  const ev = settled.ev;
  const sealed = list.find(e => e && e.ev && e.ev.k === 'seal'
    && e.ev.id === shotId && e.ev.w === ev.w && e.i < settled.i) || null;
  if (!sealed) return null;

  const player = await getJSONStrict(`u:${ev.w}`);
  const historic = player && [...(player.closed || []), ...(player.open || []),
    ...(player.history || [])].find(s => s && s.id === shotId);
  const shot = { ...(historic || {}), ...sealed.ev, ...ev,
    id: shotId, wallet: ev.w, sealedAt: sealed.t, settledAt: settled.t,
    expiry: sealed.ev.exp, result: ev.res, side: ev.side,
    exit: ev.exitPx, exit2: ev.exitPx2, exitAt: ev.exitAt,
    exitAt2: ev.exitAt2, statedProbability: ev.sp == null ? null : ev.sp,
    settleRule: ev.settleRuleApplied || ev.settleRule || sealed.ev.settleRule,
    outcomeRule: ev.outcomeRule || sealed.ev.outcomeRule };
  return { shot, sealEntry: sealed, settlementEntry: settled,
    chain: { sealIndex: sealed.i, sealHash: sealed.h,
      settlementIndex: settled.i, settlementHash: settled.h } };
}

const COLUMNS = ['schema', 'i', 'id', 'who', 'agent', 'feed', 'feed2', 'kind',
  'stake', 'entry', 'entry2', 'threshold', 'pct', 'statedProbability',
  'sealedAt', 'expiry', 'side', 'result', 'exit', 'exitAt', 'exit2', 'exitAt2',
  'previousExitAt', 'previousExitAt2', 'exitConfidenceBps', 'settledAt',
  'settlementAuthority', 'oracleSource',
  'commit', 'commitVersion', 'salt', 'settleRule', 'outcomeRule',
  'sealed', 'commitVerified', 'reason'];

function toCsv(list) {
  const cell = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [COLUMNS.join(',')]
    .concat(list.map(r => COLUMNS.map(c => cell(r[c])).join(',')))
    .join('\n') + '\n';
}

module.exports = { rows, findSettledShot, toCsv, pseudo, COLUMNS, SCHEMA, SALT, MAX_LIMIT };
