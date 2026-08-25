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
const { getJSON, getManyJSON } = require('./kv.js');
const { CHUNK } = require('./log.js');
const { verifyCommit } = require('./commit.js');

const SALT = 'ratchet-record-v1|';
const SCHEMA = 3;
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
      stake: (s && s.ev.stake) != null ? s.ev.stake : null,
      entry: (s && s.ev.entry) != null ? s.ev.entry : null,
      sealedAt: s ? s.e.t : null,
      expiry: (s && s.ev.exp) != null ? s.ev.exp : null,
      side: ev.side || null,                    // revealed only now, never before
      result: ev.res || null,                   // hit | miss | void
      exit: ev.exitPx != null ? ev.exitPx : null,
      exitAt: ev.exitAt != null ? ev.exitAt : null,
      settledAt: e.t,
      settlementAuthority: 'ratchet-server',
      oracleSource: 'pyth-price-update-v2-accounts-read-from-solana',
      commit,
      commitVersion,
      salt: ev.salt || null,
      // Whether this row carries a commitment at all. The earliest rows in the
      // log predate commit-reveal: they are honest history, but they are not
      // sealed calls, and a consumer filtering for "sealed before the outcome"
      // must be able to say so without inspecting nulls and guessing why.
      sealed: !!(commit && ev.side && ev.salt),
      // Recomputed here so a consumer sees the seal verified rather than
      // asserted. null when the row predates commit-reveal or is a void.
      commitVerified: (commit && proof.recomputed) ? proof.matches : null,
      reason: ev.reason || null,                // why a void was a void
      truthPlane: ev.truthPlane || 'ratchet-server',
      settlementAuthority: ev.settlementAuthority || 'ratchet-server',
    });
    if (out.length >= want) break;
  }

  // Nothing joined and nothing settled: still advance so a caller polling for
  // new rows does not spin on a stretch of the log with no predictions in it.
  if (!out.length && scan.length) cursor = scan[scan.length - 1].i;

  return { rows: out, cursor, schema: SCHEMA };
}

const COLUMNS = ['schema', 'i', 'id', 'who', 'agent', 'feed', 'stake', 'entry',
  'sealedAt', 'expiry', 'side', 'result', 'exit', 'exitAt', 'settledAt',
  'settlementAuthority', 'oracleSource', 'truthPlane',
  'commit', 'commitVersion', 'salt', 'sealed', 'commitVerified', 'reason'];

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

module.exports = { rows, toCsv, pseudo, COLUMNS, SCHEMA, SALT, MAX_LIMIT };
