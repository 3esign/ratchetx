import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const { prepare } = createRequire(import.meta.url)('../lib/guarded_commit.js');

// Two real connections. All mutations are exact, random fixture keys; no game
// handler, activity event, ranking, token transfer or real player is invoked.
export async function guardedBatch(a, b) {
  const prefix = '__ratchet_guarded_probe_' + randomBytes(12).toString('hex');
  const wa = prefix + '_a', wb = prefix + '_b';
  const keys = ['u:' + wa, 'u:' + wb, 'lock:u:' + wa, 'lock:u:' + wb, 'pend:' + wa, prefix + '_deposit'];
  const txs = [];
  const now = Number((await a.query('select extract(epoch from clock_timestamp())*1000 as n')).rows[0].n);
  const token = randomBytes(16).toString('hex');
  const leases = [wa, wb].map(w => ({ key: 'lock:u:' + w, token, expiresAt: Math.floor(now + 120000) }));
  const make = entries => {
    const tx = prepare({ id: randomBytes(16).toString('hex'), entries, debits: [], leases });
    txs.push(tx); return tx;
  };
  const commit = async (c, tx) => (await c.query('select public.ratchet_kv_commit_guarded($1::jsonb) v', [JSON.stringify(tx)])).rows[0].v;
  const get = async key => (await a.query('select value from public.ratchet_kv where key=$1', [key])).rows[0]?.value;
  const put = (c, key, value) => c.query('insert into public.ratchet_kv(key,value) values($1,$2::jsonb)', [key, JSON.stringify(value)]);
  let transactionOpen = false;
  try {
    const initialA = { w: wa, cr: 5000, _writeGuard: 1 };
    const initialB = { w: wb, cr: 5000, _writeGuard: 1 };
    for (const [key, value] of [[keys[0], initialA], [keys[1], initialB], [keys[2], token], [keys[3], token], [keys[4], 100]]) await put(a, key, value);
    const x = make([{ key: keys[0], expected: initialA, value: { ...initialA, cr: 4900 } },
      { key: keys[1], expected: initialB, value: { ...initialB, cr: 5100 } }]);
    const y = make([{ key: keys[1], expected: initialB, value: { ...initialB, cr: 5200 } },
      { key: keys[0], expected: initialA, value: { ...initialA, cr: 4800 } }]);
    const concurrent = await Promise.all([commit(a, x), commit(b, y)]);
    assert.equal(concurrent.filter(r => r.ok).length, 1);
    assert.equal(concurrent.find(r => !r.ok).code, 'WRITE_CONFLICT');
    const winner = concurrent[0].ok ? x : y;
    assert.equal((await get(keys[0])).cr + (await get(keys[1])).cr, 10000);
    assert.deepEqual(await commit(b, winner), { ok: true, replay: true });

    const current = await get(keys[0]);
    const debit = prepare({ id: randomBytes(16).toString('hex'),
      entries: [{ key: keys[0], expected: current, value: { ...current, cr: current.cr + 20 } }],
      leases, debits: [[keys[4], 20]] });
    txs.push(debit);
    await a.query('BEGIN'); transactionOpen = true;
    await a.query('select 1 from public.ratchet_kv where key=$1 for update', [keys[4]]);
    const pid = Number((await b.query('select pg_backend_pid() pid')).rows[0].pid);
    const depositArgs = [keys[5], JSON.stringify([[keys[4], 25]])];
    const depositSql = "select public.ratchet_kv_apply_once($1,'true'::jsonb,$2::jsonb) applied";
    const deposit = b.query(depositSql, depositArgs);
    deposit.catch(() => {});
    let blocked = false;
    for (let n = 0; n < 40; n++) {
      blocked = (await a.query('select cardinality(pg_blocking_pids($1)) > 0 blocked', [pid])).rows[0].blocked;
      if (blocked) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(blocked, 'deposit must actually contend on the locked row');
    assert.deepEqual(await commit(a, debit), { ok: true, replay: false });
    await a.query('COMMIT'); transactionOpen = false;
    assert.equal((await deposit).rows[0].applied, true);
    assert.equal(await get(keys[4]), 105, 'queued-credit conservation: 100 - 20 + 25 must equal 105');
    assert.equal((await b.query(depositSql, depositArgs)).rows[0].applied, false, 'incoming deposit replay must not add credit twice');
    assert.deepEqual(await commit(b, debit), { ok: true, replay: true });
    assert.equal(await get(keys[4]), 105);

    await b.query('update public.ratchet_kv set value=$2::jsonb where key=$1', [keys[2], JSON.stringify('replacement')]);
    const stale = make([{ key: keys[0], expected: await get(keys[0]), value: { ...current, cr: 0 } }]);
    assert.deepEqual(await commit(a, stale), { ok: false, code: 'WRITE_LEASE_EXPIRED' });
    assert.equal(await get(keys[4]), 105);
    await assert.rejects(() => b.query('select public.ratchet_kv_set($1,$2::jsonb)', [keys[0], JSON.stringify(initialA)]), /unguarded player write/);
    await assert.rejects(() => b.query('select public.ratchet_kv_take($1)', [keys[4]]), /unguarded credit drain/);
    return { oppositeOrderCas: true, replay: true, blockedConcurrentDeposit: true, depositReplay: true, staleLease: true, legacyGuard: true };
  } finally {
    if (transactionOpen) await a.query('ROLLBACK').catch(() => {});
    const exact = [...keys, ...txs.map(tx => 'guarded:receipt:' + tx.id)];
    await a.query('delete from public.ratchet_kv where key=any($1::text[])', [exact]);
    assert.equal(Number((await a.query('select count(*) n from public.ratchet_kv where key=any($1::text[])', [exact])).rows[0].n), 0);
  }
}
