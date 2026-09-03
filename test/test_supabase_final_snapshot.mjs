import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  assertPublicManifestSafe,
  buildSnapshotProof,
  keyFamily,
  keyspaceInventory,
  parseArgs,
  procedureProof,
  reconstructLog,
  validateConservation,
} from '../tools/supabase_final_snapshot.mjs';

const require = createRequire(import.meta.url);
const { canon } = require('../lib/canon.js');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

const rows = [
  { key:'u:wallet-secret-a', canonical:'["u:wallet-secret-a",{"cr":5000},null,"2026-09-03T00:00:00.000000Z"]' },
  { key:'g:log:n', canonical:'["g:log:n",1,null,"2026-09-03T00:00:00.000000Z"]' },
  { key:'guarded:receipt:secret-receipt', canonical:'["guarded:receipt:secret-receipt",{"digest":"abc"},null,"2026-09-03T00:00:00.000000Z"]' },
];

const cleanConservation = Object.fromEntries([
  'player_count','player_credits','legacy_player_balance','player_xp','player_attributed_rcx_burned',
  'open_shot_count','open_shot_stake','settlement_outbox_count','retained_closed_shot_count','open_challenge_count',
  'open_challenge_stake','pending_play_credits','pending_champion_received_rcx',
  'pending_champion_self_routed_rcx','play_session_count','play_session_pending_count',
  'history_wallet_count','history_entry_count','champion_history_wallet_count',
  'champion_history_entry_count','signature_gate_count','reload_signature_gate_count',
  'seal_event_gate_count','settlement_event_gate_count','guarded_receipt_count',
  'live_lease_count','expired_row_count','stats_allocated_burned_credits',
  'weekly_pot_credits','daily_pot_credits','verified_rcx_burned','verified_rcx_champion_paid',
  'verified_rcx_champion_retained','hit_payout_credits','player_shape_violations',
  'player_container_shape_violations','negative_player_values','open_shot_shape_violations',
  'challenge_shape_violations','challenge_container_shape_violations','queue_shape_violations',
  'play_session_shape_violations','history_shape_violations','champion_history_shape_violations',
].map(name => [name, name === 'player_count' ? '1' : '0']));

test('row digest and Merkle root are order-independent but mutation-sensitive', () => {
  const first = buildSnapshotProof(rows);
  const reordered = buildSnapshotProof([rows[2], rows[0], rows[1]]);
  assert.deepEqual(first, reordered);
  const changed = structuredClone(rows);
  changed[0].canonical = changed[0].canonical.replace('5000', '5001');
  assert.notEqual(buildSnapshotProof(changed).merkle.root, first.merkle.root);
  assert.match(first.databaseDigest, /^[0-9a-f]{64}$/);
  assert.match(first.merkle.root, /^[0-9a-f]{64}$/);
  assert.equal(first.merkle.domainEncoding, 'hex');
  assert.equal(first.merkle.leafDomainHex, Buffer.from('ratchetx-kv-leaf-v1\0').toString('hex'));
  assert.equal(first.merkle.nodeDomainHex, Buffer.from('ratchetx-kv-node-v1\0').toString('hex'));
  assert.ok(first.merkle.leafDomainHex.endsWith('00') && first.merkle.nodeDomainHex.endsWith('00'));
});

test('keyspace inventory publishes families, never private suffixes', () => {
  assert.equal(keyFamily('play-session:v1:wallet-secret'), 'play-session:v1:*');
  assert.equal(keyFamily('g:log:e:42'), 'g:log:e:*');
  assert.equal(keyFamily('sig:transaction-secret'), 'sig:*');
  const inventory = keyspaceInventory(rows);
  const text = JSON.stringify(inventory);
  assert.deepEqual(inventory, { 'g:log:meta':1, 'guarded:receipt:*':1, 'u:*':1 });
  assert.doesNotMatch(text, /wallet-secret|secret-receipt/);
});

test('ceremony arguments require a writer barrier and evidence hash', () => {
  const parsed = parseArgs([
    '--cutover-id','2026-09-03-final',
    '--writer-barrier','legacy-runtime-credential-revoked',
    '--barrier-evidence-sha256','a'.repeat(64),
    '--quiet-seconds','15',
  ]);
  assert.equal(parsed.quietSeconds, 15);
  assert.match(parsed.publicManifest, /legacy-snapshot-manifest-2026-09-03-final\.json$/);
  assert.throws(() => parseArgs(['--cutover-id','2026-09-03-final']), /WRITER_BARRIER_REQUIRED/);
  assert.throws(() => parseArgs([
    '--cutover-id','2026-09-03-final','--writer-barrier','legacy-runtime-credential-revoked',
    '--barrier-evidence-sha256','a'.repeat(64),'--apply','yes',
  ]), /UNKNOWN_ARGUMENT/);
});

test('conservation validation rejects malformed or negative buckets', () => {
  assert.deepEqual(validateConservation(cleanConservation),
    Object.fromEntries(Object.entries(cleanConservation).sort(([a],[b]) => a.localeCompare(b))));
  assert.throws(() => validateConservation({ ...cleanConservation, player_credits:'-1' }), /NEGATIVE_PLAYER_CREDITS/);
  assert.throws(() => validateConservation({ ...cleanConservation, queue_shape_violations:'1' }), /CONSERVATION_QUEUE_SHAPE_VIOLATIONS/);
  assert.throws(() => validateConservation({ ...cleanConservation, history_shape_violations:'1' }), /CONSERVATION_HISTORY_SHAPE_VIOLATIONS/);
});

test('log reconstruction bounds indices and rejects representation conflicts', () => {
  const body = { i:1, t:1788400000000, ev:{ k:'fixture' }, c:1 };
  const entry = { ...body, h:sha(sha('ratchet-genesis') + canon(body)) };
  const base = [
    { key:'g:log:n', value:1 },
    { key:'g:log:head', value:{ i:1, h:entry.h } },
    { key:'g:log:c:0', value:[entry] },
    { key:'g:log:e:1', value:structuredClone(entry) },
  ];
  assert.equal(reconstructLog(base).verified, true);
  assert.throws(() => reconstructLog(base.map(row => row.key === 'g:log:e:1'
    ? { ...row, value:{ ...row.value, i:2 } } : row)), /LOG_DIRECT_INDEX_INVALID/);
  assert.throws(() => reconstructLog(base.map(row => row.key === 'g:log:e:1'
    ? { ...row, value:{ ...row.value, ev:{ k:'conflict' } } } : row)), /LOG_REPRESENTATION_CONFLICT/);
  assert.throws(() => reconstructLog(base.map(row => row.key === 'g:log:c:0'
    ? { ...row, value:[{ ...entry, i:Number.MAX_SAFE_INTEGER }] } : row)), /LOG_ENTRY_INDEX_INVALID/);
});

test('public manifest gate rejects values and credentials', () => {
  const procedure = procedureProof();
  assert.match(procedure.tool.sha256, /^[0-9a-f]{64}$/);
  assert.match(procedure.runbook.sha256, /^[0-9a-f]{64}$/);
  assert.equal(assertPublicManifestSafe({ schema:'x', procedure, completeness:{ rowCount:'3' } }), true);
  assert.throws(() => assertPublicManifestSafe({ password:'secret' }), /PUBLIC_MANIFEST_SECRET_RISK/);
  assert.throws(() => assertPublicManifestSafe({ rows:[{ value:{ cr:5000 } }] }), /PUBLIC_MANIFEST_SECRET_RISK/);
});

console.log('PASS  final Supabase snapshot: deterministic proof, redacted keyspace, barrier and conservation guards');
