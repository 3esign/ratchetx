// Portable PostgreSQL restore proof. The historical private pg_restore check is
// test/private/test_supabase_final_snapshot_restore.mjs and is mandatory in
// npm run test:release; this suite needs only the checked-in npm dependencies.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  FINGERPRINT_SQL,
  RESTORE_SCHEMA_SQL,
  readSnapshot,
} from '../tools/supabase_final_snapshot.mjs';

const require = createRequire(import.meta.url);
const { canon } = require('../lib/canon.js');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const CUTOFF = '2026-09-03T12:00:00.000000Z';
const UPDATED = '2026-09-03T11:59:00.123456Z';

function fixtureRows() {
  let previous = sha('ratchet-genesis');
  const entries = ['reload', 'seal', 'settle'].map((k, index) => {
    const body = { i:index + 1, t:1788436800000 + index, ev:{ k, fixture:true }, c:1 };
    const entry = { ...body, h:sha(previous + canon(body)) };
    previous = entry.h;
    return entry;
  });
  return [
    ['u:fixture-a', { w:'fixture-a', cr:1000, bal:9, xp:80, burned:700,
      open:[{ id:'open-a', stake:70, exp:1788440400000, side:'UP', kind:'price', feed:'SOL' }],
      closed:[{ id:'closed-a', stake:25, res:'hit' }],
      settlementOutbox:[{ s:{ id:'outbox-a', stake:40, res:'void' } }] }],
    ['u:fixture-b', { w:'fixture-b', cr:500, xp:20, burned:300,
      open:[{ id:'open-b', stake:30, exp:1788440400000, side:'DOWN', kind:'price', feed:'BTC' }],
      closed:[], settlementOutbox:[] }],
    ['h:stats', { burned:100, pot:15, potD:5, shots:4, realBurned:1000,
      champPaid:7, champRetained:3, stakePaid:2, stakers:1, hitPaid:42 }],
    ['g:chal', [{ id:'challenge-a', by:'fixture-a', stake:60,
      expiresAt:1788440400000, side:'YES', kind:'price', feed:'SOL' }]],
    ['pend:fixture-a', 11],
    // Expired rows still belong to the raw snapshot and its conservation proof.
    ['pend:fixture-expired', 5, CUTOFF],
    ['c7:fixture-a', 7],
    ['cs7:fixture-a', 3],
    ['lock:fixture-expired', { owner:'synthetic' }, '2026-09-03T11:59:59.999999Z'],
    ['lock:fixture-live', { owner:'synthetic' }, '2026-09-03T12:00:00.000001Z'],
    ['play-session:v1:fixture-a', { pending:{ id:'session-a' } }],
    ['hist:fixture-a', [{ id:'closed-a' }, { id:'older-a' }]],
    ['chist:fixture-a', [{ received:7 }]],
    ['sig:fixture-reload', { amount:1000 }],
    ['guarded:receipt:fixture-a', { digest:'synthetic' }],
    ['g:log:n', entries.length],
    ['g:log:head', { i:entries.length, h:previous }],
    ['g:log:c:0', entries],
    ...entries.map(entry => ['g:log:e:' + entry.i, entry]),
  ];
}

async function fingerprint(db) {
  return (await db.query(FINGERPRINT_SQL)).rows[0];
}

async function rolledBack(db, action) {
  await db.exec('BEGIN');
  try { await action(); }
  finally { await db.exec('ROLLBACK'); }
}

test('portable PostgreSQL snapshot exports, restores, and detects corrupt state', {
  timeout:120_000,
}, async t => {
  let source = new PGlite(), restored;
  try {
    await source.exec("set timezone='UTC'");
    await source.exec(RESTORE_SCHEMA_SQL);
    const rows = fixtureRows();
    // Reverse insertion order so SQL canonical ordering is exercised by the proof.
    for (const [key, value, expires = null] of rows.slice().reverse()) {
      await source.query('insert into public.ratchet_kv (key,value,expires_at,updated_at) values ($1,$2::jsonb,$3,$4)',
        [key, JSON.stringify(value), expires, UPDATED]);
    }
    const before = await readSnapshot(source, CUTOFF);
    const beforeFingerprint = await fingerprint(source);
    assert.equal(before.analysis.proof.rowCount, String(rows.length));
    assert.equal(before.analysis.proof.databaseDigest, beforeFingerprint.digest);
    assert.equal(before.analysis.log.verified, true);
    assert.equal(before.analysis.log.intact, true);
    assert.equal(before.analysis.log.exportedEntries, '3');
    const expectedBuckets = {
      player_count:'2', player_credits:'1500', legacy_player_balance:'9', player_xp:'100',
      player_attributed_rcx_burned:'1000', open_shot_count:'2', open_shot_stake:'100',
      retained_closed_shot_count:'1', retained_closed_shot_stake:'25',
      settlement_outbox_count:'1', settlement_outbox_stake:'40',
      open_challenge_count:'1', open_challenge_stake:'60',
      pending_play_credits:'16', pending_champion_received_rcx:'7', pending_champion_self_routed_rcx:'3',
      expired_row_count:'2', live_lease_count:'1', play_session_count:'1', play_session_pending_count:'1',
      history_entry_count:'2', champion_history_entry_count:'1', signature_gate_count:'1',
      guarded_receipt_count:'1', stats_allocated_burned_credits:'100', weekly_pot_credits:'15',
      daily_pot_credits:'5', stats_shot_count:'4', verified_rcx_burned:'1000',
      verified_rcx_champion_paid:'7', verified_rcx_champion_retained:'3', hit_payout_credits:'42',
    };
    for (const [name, value] of Object.entries(expectedBuckets))
      assert.equal(before.analysis.conservation[name], value, name);
    assert.equal(before.rows.filter(row => row.expired).length, 2);

    // dumpDataDir/loadDataDir are the installed PGlite PostgreSQL export/import
    // APIs. Both databases live in memory, so no test fixtures or keys go to disk.
    const dump = await source.dumpDataDir('none');
    assert.ok(dump.size > 0, 'a nonempty PostgreSQL archive was exported');
    // Changes after the export must not leak into the restored point in time.
    await source.query("update public.ratchet_kv set value=jsonb_set(value,'{cr}','9999'::jsonb) where key='u:fixture-a'");
    assert.notEqual((await fingerprint(source)).digest, beforeFingerprint.digest);
    await source.close();
    source = null;
    restored = new PGlite({ loadDataDir:dump });
    await restored.exec("set timezone='UTC'");

    await t.test('restored database preserves every row, proof, log, and state bucket', async () => {
      const after = await readSnapshot(restored, CUTOFF);
      assert.deepEqual(after, before);
      assert.deepEqual(await fingerprint(restored), beforeFingerprint);
      assert.deepEqual((await readSnapshot(restored, CUTOFF)).analysis, before.analysis);
      const expired = after.rows.find(row => row.key === 'pend:fixture-expired');
      assert.equal(expired.expired, true, 'expiration exactly at cutoff is inclusive');
      assert.equal(expired.value, 5, 'expired queue obligation remains in the raw restore');
    });

    await t.test('valid balance mutation changes SQL fingerprint, Merkle root, and totals', async () => {
      await rolledBack(restored, async () => {
        await restored.query("update public.ratchet_kv set value=jsonb_set(value,'{cr}','1001'::jsonb) where key='u:fixture-a'");
        const changed = await readSnapshot(restored, CUTOFF);
        const changedFingerprint = await fingerprint(restored);
        assert.equal(changed.analysis.proof.rowCount, before.analysis.proof.rowCount);
        assert.equal(changed.analysis.conservation.player_credits, '1501');
        assert.notEqual(changedFingerprint.digest, beforeFingerprint.digest);
        assert.equal(changed.analysis.proof.databaseDigest, changedFingerprint.digest);
        assert.notEqual(changed.analysis.proof.merkle.root, before.analysis.proof.merkle.root);
      });
    });

    await t.test('dropping an expired queue row is detected as lost state', async () => {
      await rolledBack(restored, async () => {
        await restored.query("delete from public.ratchet_kv where key='pend:fixture-expired'");
        const changed = await readSnapshot(restored, CUTOFF);
        assert.equal(changed.analysis.conservation.pending_play_credits, '11');
        assert.equal(changed.analysis.conservation.expired_row_count, '1');
        assert.equal(changed.analysis.proof.rowCount, String(rows.length - 1));
        assert.notEqual((await fingerprint(restored)).digest, beforeFingerprint.digest);
        assert.notEqual(changed.analysis.proof.merkle.root, before.analysis.proof.merkle.root);
      });
    });

    await t.test('malformed queue values fail the actual SQL conservation analyzer', async () => {
      await rolledBack(restored, async () => {
        await restored.query('update public.ratchet_kv set value=$1::jsonb where key=$2',
          [JSON.stringify('11'), 'pend:fixture-a']);
        await assert.rejects(readSnapshot(restored, CUTOFF), /CONSERVATION_QUEUE_SHAPE_VIOLATIONS/);
      });
    });

    await t.test('tampering both log representations still fails cryptographic verification', async () => {
      await rolledBack(restored, async () => {
        await restored.query("update public.ratchet_kv set value=jsonb_set(value,'{ev,fixture}','false'::jsonb) where key='g:log:e:2'");
        await restored.query("update public.ratchet_kv set value=jsonb_set(value,'{1,ev,fixture}','false'::jsonb) where key='g:log:c:0'");
        await assert.rejects(readSnapshot(restored, CUTOFF), /LOG_CHAIN_INVALID/);
      });
    });

    assert.deepEqual((await readSnapshot(restored, CUTOFF)).analysis, before.analysis,
      'negative controls roll back to the successfully restored database');
    console.log(JSON.stringify({ syntheticPostgresRestore:true, rows:beforeFingerprint.row_count,
      databaseDigest:beforeFingerprint.digest, merkleRoot:before.analysis.proof.merkle.root }));
  } finally {
    if (source) await source.close();
    if (restored) await restored.close();
  }
});
