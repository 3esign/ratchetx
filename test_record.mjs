// THE RECORD is a public dataset. Two things must be true of every row:
// it must be a real settled prediction, and it must never reveal a side that
// is still sealed. A leak here is not a data-quality problem, it is the game
// being broken from the outside.
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const fresh = () => {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  globalThis.__ratchet_mem = new Map();
  return { log: require('./lib/log.js'), rec: require('./lib/record.js'), kv: require('./lib/kv.js') };
};

const W1 = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
const W2 = 'ExtQ7bK9mVn3Rd5Tf8Yh2Jq4Lw6Zs1Ap3Cx5Vb7Ncmq';

async function seed(log, { w, id, side, feed = 'SOL', stake = 500, res = 'hit', settle = true }) {
  const salt = crypto.randomBytes(8).toString('hex');
  const commit = sha(`${side}|${salt}`);
  await log.append({ k: 'seal', w, id, feed, stake, exp: Date.now() + 300e3, entry: 100, commit });
  if (settle) await log.append({ k: 'settle', w, id, res, exitPx: 101, exitAt: Date.now(),
    side, salt, commit });
  return { salt, commit };
}

// ---- 1. a settled shot becomes one complete, self-verifying row ----
{
  const { log, rec } = fresh();
  const { commit } = await seed(log, { w: W1, id: 'aaa111', side: 'YES' });
  const { rows } = await rec.rows({ limit: 10 });
  assert.equal(rows.length, 1, 'one settled shot -> one row');
  const r = rows[0];
  assert.equal(r.id, 'aaa111');
  assert.equal(r.side, 'YES');
  assert.equal(r.result, 'hit');
  assert.equal(r.feed, 'SOL', 'the seal supplied the feed');
  assert.equal(r.stake, 500, 'the seal supplied the stake');
  assert.equal(r.entry, 100, 'the seal supplied the entry price');
  assert.equal(r.commit, commit);
  assert.equal(r.commitVerified, true, 'and the commitment recomputes at export time');
  assert.ok(r.sealedAt <= r.settledAt, 'the seal is never timestamped after the settlement');
  console.log('settled shot -> one row, seal joined, commitment verified in the export');
}

// ---- 2. AN OPEN SHOT MUST NOT APPEAR. This is the one that matters. ----
{
  const { log, rec } = fresh();
  await seed(log, { w: W1, id: 'open01', side: 'NO', settle: false });
  await seed(log, { w: W1, id: 'done01', side: 'YES' });
  const { rows } = await rec.rows({ limit: 10 });
  assert.equal(rows.length, 1, 'only the settled shot is exported');
  assert.equal(rows[0].id, 'done01');
  const blob = JSON.stringify(rows);
  assert.ok(!/open01/.test(blob), 'the open shot id does not appear anywhere');
  console.log('open shot -> absent from the export; its side stays sealed');
}

// ---- 3. an unsettled side must not leak through ANY format ----
{
  const { log, rec } = fresh();
  await log.append({ k: 'seal', w: W1, id: 'sealed9', feed: 'BTC', stake: 2500,
    exp: Date.now() + 600e3, entry: 60000, commit: sha('NO|deadbeef') });
  const { rows } = await rec.rows({ limit: 50 });
  const csv = rec.toCsv(rows);
  assert.ok(!/sealed9/.test(csv), 'csv carries no open shot');
  assert.equal(rows.length, 0, 'and no row at all was produced');
  console.log('a seal with no settle produces nothing, in any format');
}

// ---- 4. identity: agents by name, humans by stable pseudonym ----
{
  const { log, rec, kv } = fresh();
  await kv.setJSON('g:arena', [W2]);
  await kv.setJSON(`u:${W2}`, { w: W2, agent: { name: 'DRIFT READER', since: 1 } });
  await seed(log, { w: W1, id: 'h1', side: 'YES' });
  await seed(log, { w: W2, id: 'a1', side: 'NO', res: 'miss' });
  const { rows } = await rec.rows({ limit: 10 });
  const human = rows.find(r => r.id === 'h1'), agent = rows.find(r => r.id === 'a1');
  assert.equal(agent.agent, 'DRIFT READER', 'a registered agent is named — that is why it registered');
  assert.equal(agent.who, null, 'and carries no pseudonym');
  assert.equal(human.agent, null, 'a human is not named');
  assert.equal(human.who, rec.pseudo(W1), 'and gets the documented pseudonym');
  assert.equal(human.who.length, 12, 'twelve hex characters');
  assert.ok(!JSON.stringify(rows).includes(W1), 'THE RAW WALLET NEVER APPEARS IN THE EXPORT');
  console.log('identity: agents by name, humans by documented pseudonym, no raw wallets');
}

// ---- 5. the pseudonym is stable and documented, not secret ----
{
  const { rec } = fresh();
  assert.equal(rec.pseudo(W1), rec.pseudo(W1), 'stable across calls');
  assert.notEqual(rec.pseudo(W1), rec.pseudo(W2), 'distinct per wallet');
  assert.equal(rec.pseudo(W1), sha(rec.SALT + W1).slice(0, 12),
    'and reproducible by anyone from the published salt — a join key, not anonymity');
  console.log('pseudonym is stable, distinct, and reproducible from the published salt');
}

// ---- 6. pagination covers every row exactly once ----
{
  const { log, rec } = fresh();
  for (let i = 0; i < 25; i++) await seed(log, { w: W1, id: 'p' + i, side: i % 2 ? 'YES' : 'NO' });
  const seen = [];
  let after = 0;
  for (let page = 0; page < 20; page++) {
    const r = await rec.rows({ after, limit: 7 });
    if (!r.rows.length) break;
    seen.push(...r.rows.map(x => x.id));
    assert.ok(r.cursor > after, `cursor must advance (${after} -> ${r.cursor})`);
    after = r.cursor;
  }
  assert.equal(seen.length, 25, `every row delivered exactly once (${seen.length})`);
  assert.equal(new Set(seen).size, 25, 'no duplicates across pages');
  assert.deepEqual(seen, Array.from({ length: 25 }, (_, i) => 'p' + i), 'and in chain order');
  console.log('25 rows over pages of 7 -> each exactly once, in order, no duplicates');
}

// ---- 7. a page of log with no predictions in it must not stall the cursor ----
{
  const { log, rec } = fresh();
  for (let i = 0; i < 30; i++) await log.append({ k: 'anchor', w: W1, n: i });
  await seed(log, { w: W1, id: 'zz1', side: 'YES' });
  let after = 0, got = [];
  for (let p = 0; p < 12; p++) {
    const r = await rec.rows({ after, limit: 5 });
    got.push(...r.rows.map(x => x.id));
    if (r.cursor === after) break;                    // stalled
    after = r.cursor;
    if (got.length) break;
  }
  assert.deepEqual(got, ['zz1'], 'the prediction is reached past 30 unrelated entries');
  console.log('30 non-prediction entries -> cursor advances past them, no spin');
}

// ---- 8. limits are enforced ----
{
  const { log, rec } = fresh();
  for (let i = 0; i < 12; i++) await seed(log, { w: W1, id: 'l' + i, side: 'YES' });
  assert.equal((await rec.rows({ limit: 5 })).rows.length, 5, 'limit respected');
  assert.ok((await rec.rows({ limit: 99999 })).rows.length <= rec.MAX_LIMIT, 'hard cap holds');
  assert.ok((await rec.rows({ limit: 0 })).rows.length > 0, 'zero falls back to a default');
  console.log('limits: honoured, capped at ' + rec.MAX_LIMIT + ', zero defaults');
}

// ---- 9. CSV is well formed and column-stable ----
{
  const { log, rec } = fresh();
  await seed(log, { w: W1, id: 'c1', side: 'YES' });
  const csv = rec.toCsv((await rec.rows({ limit: 5 })).rows);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], rec.COLUMNS.join(','), 'header matches the published column order');
  assert.equal(lines[1].split(',').length, rec.COLUMNS.length, 'row has one cell per column');
  assert.ok(csv.endsWith('\n'), 'file ends with a newline');
  console.log('csv: stable header, one cell per column, trailing newline');
}

// ---- 10. a void row keeps its reason and claims no exit price ----
{
  const { log, rec } = fresh();
  await log.append({ k: 'seal', w: W1, id: 'v1', feed: 'WIF', stake: 100, exp: Date.now(), entry: 1.2, commit: 'x' });
  await log.append({ k: 'settle', w: W1, id: 'v1', res: 'void', reason: 'no-oracle-sample-in-window' });
  const r = (await rec.rows({ limit: 5 })).rows[0];
  assert.equal(r.result, 'void');
  assert.equal(r.exit, null, 'a void invents no exit price');
  assert.equal(r.reason, 'no-oracle-sample-in-window', 'and says why');
  assert.equal(r.commitVerified, null, 'unverifiable is null, never a hopeful true');
  console.log('void row -> no exit price, reason kept, commitVerified null not true');
}

console.log('\nrecord: all assertions passed');
