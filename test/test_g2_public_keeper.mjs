import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as web3 from '@solana/web3.js';
import bs58 from 'bs58';
import { createCoreG2Client } from '../lib/g2/client-v2.mjs';
import { PROGRAMS, DEVNET_GENESIS } from '../ops/g2-crank/public-pins.mjs';
import { assertChainBoundary, operatorKey, createJournal, assertJournal, assertMaintenance, pendingBytes } from '../ops/g2-crank/public-boundary.mjs';
import { parseArgs, loadGame, publicTimepinInstruction, nextOperation, writeJournal, sendOperation, resolvePending, withinFeeBudget, FEE_BUDGET } from '../ops/g2-crank/live.mjs';

// Public configuration only. Every signer below is synthetic and stays in RAM.
// Connections are local stubs; no test constructs an RPC connection.
const config = JSON.parse(fs.readFileSync(new URL('../lib/g2/devnet-config.json', import.meta.url), 'utf8'));
const signer = web3.Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => 81));
const other = web3.Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => 82));
const key = n => new web3.PublicKey(Buffer.alloc(32, n));
const c = createCoreG2Client({ web3, coreProgramId: PROGRAMS.core, timepinProgramId: PROGRAMS.timepin });
const hash = name => Buffer.from(config[name], 'hex');
const ctx = { c, operator: signer.publicKey, economy: { economyHash: hash('economyHash') },
  addresses: { economy: c.economyPda(hash('economyHash'))[0], ruleset: c.rulesetPda(hash('rulesetHash'))[0], evidenceSpec: c.evidenceSpecPda(hash('evidenceSpecHash'))[0] },
  spec: { args: { receiverProgram: key(10), wormholeProgram: key(11) }, priceAccount: key(12).toBase58() } };
const need = { address: c.needPda(hash('evidenceSpecHash'), 1000n)[0].toBuffer(), candidateAHash: Buffer.alloc(32, 33) };
const operation = { name: 'expire', subject: new web3.PublicKey(need.address).toBase58(), instruction: publicTimepinInstruction(ctx, need, 'expire') };
const recent = { blockhash: key(90).toBase58(), lastValidBlockHeight: 100 };
const clone = x => JSON.parse(JSON.stringify(x));
const makeJournal = () => createJournal(config, signer.publicKey);
const record = (ix = operation.instruction, fields = {}) => {
  const tx = new web3.Transaction({ feePayer: signer.publicKey, ...recent }).add(ix);
  tx.sign(signer);
  return { name: operation.name, subject: operation.subject, ...recent, signature: bs58.encode(tx.signature),
    signedTransaction: tx.serialize().toString('base64'), ...fields };
};
const pendingJournal = () => ({ ...makeJournal(), pending: record() });
const stub = (overrides = {}) => ({
  getGenesisHash: async () => DEVNET_GENESIS,
  getLatestBlockhash: async () => recent,
  simulateTransaction: async (tx, options) => {
    assert.equal(options.sigVerify, false);
    assert.ok(tx.signatures.every(signature => signature.every(byte => byte === 0)), 'simulation must carry no executable signature');
    return { value: { err: null } };
  },
  getSignatureStatuses: async () => ({ value: [null] }),
  getBlockHeight: async () => 50,
  sendRawTransaction: async raw => bs58.encode(web3.Transaction.from(raw).signature),
  confirmTransaction: async () => ({ value: { err: null } }),
  ...overrides
});

test('any explicit operator can plan; dry-run cannot load a key; wrong chain/program pins refuse before account reads', async () => {
  for (const operator of [signer.publicKey, other.publicKey]) {
    assert.notEqual(operator.toBase58(), config.watchPlayer);
    const opt = parseArgs(['--rpc', 'https://example.invalid', '--operator', operator.toBase58()]);
    assert.equal(opt.send, false);
    assert.equal(opt.keypair, undefined);
    assert.equal(operatorKey(operator.toBase58()).toBase58(), operator.toBase58());
  }
  assert.throws(() => parseArgs(['--rpc', 'https://example.invalid']), /operator/);
  assert.throws(() => parseArgs(['--rpc', 'https://example.invalid', '--operator', signer.publicKey.toBase58(), '--keypair', 'not-read.json']), /Dry-run/);
  assert.throws(() => parseArgs(['--rpc', 'https://example.invalid', '--operator', signer.publicKey.toBase58(), '--send']), /signer/);
  assert.throws(() => assertChainBoundary('mainnet', PROGRAMS), /genesis/);
  assert.throws(() => assertChainBoundary(DEVNET_GENESIS, { ...PROGRAMS, core: other.publicKey.toBase58() }), /programs/);
  await assert.rejects(loadGame({ getGenesisHash: async () => 'mainnet' }, config, signer.publicKey), /genesis/);
  await assert.rejects(loadGame({ getGenesisHash: async () => DEVNET_GENESIS }, { ...config, programs: {} }, signer.publicKey), /programs/);
});

test('journal binds selected operator, purpose, all game pins and refuses old unsigned-pending format', () => {
  const journal = makeJournal();
  assertJournal(journal, config, signer.publicKey);
  for (const field of ['payer', 'clusterGenesis', 'economyHash', 'rulesetHash', 'evidenceSpecHash', 'purpose', 'schema', 'programs']) {
    const altered = clone(journal);
    altered[field] = field === 'schema' ? 1 : field === 'programs' ? {} : 'different';
    assert.throws(() => assertJournal(altered, config, signer.publicKey), /journal belongs/);
  }
  assert.throws(() => assertJournal(journal, config, other.publicKey), /journal belongs/);
  assert.throws(() => assertJournal({ ...journal, pending: { signature: 'old-no-bytes' } }, config, signer.publicKey), /saved bytes/);
});

// Captured from the unchanged bootstrap helper before extraction: program,
// every non-actor account (address and privileges), and instruction data.
// These public fixture hashes keep this test independent of the old CLI graph.
test('all four Timepin instructions match canonical fixtures while replacing bootstrap actor', () => {
  const expected = {
    capture_first: '98eb74989b814e45775aeccb66f96e0f582831eb677f529996824ad6afe5a721',
    capture_conflict: '45bd8ef0d8ca7e2ba27ade643b908b676a53ebff38f24b4290f0fd3ecf7c5aba',
    finalize: '0ef9de37d57cc88e03a74fefb03a117fb193378e5f0e26d9604ccb6157ccf8e4',
    expire: 'd3c1c4e943e0b469f70382666252185344abfc598c591d90ba415cebad50d9ff'
  };
  for (const operator of [signer.publicKey, other.publicKey]) for (const name of Object.keys(expected)) {
    const messageHash = name.startsWith('capture_') ? Buffer.alloc(32, 44) : undefined;
    const local = publicTimepinInstruction({ ...ctx, operator }, need, name, messageHash);
    assert.ok(local.keys[0].pubkey.equals(operator) && local.keys[0].isSigner && local.keys[0].isWritable);
    const canonical = { program: local.programId.toBase58(),
      accounts: local.keys.slice(1).map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
      data: Buffer.from(local.data).toString('hex') };
    assert.equal(createHash('sha256').update(JSON.stringify(canonical)).digest('hex'), expected[name]);
    assertMaintenance({ name, subject: operation.subject, instruction: local }, createJournal(config, operator));
  }
});

test('all six Core actions use selected actor and leave player PDAs and frozen rent destination intact', async () => {
  const entry = new web3.PublicKey(need.address), exit = c.needPda(hash('evidenceSpecHash'), 1300n)[0];
  const cases = [[1, 2, 2, 'activate_entry'], [1, 4, 2, 'void_pending_entry'], [2, 2, 2, 'settle_final'],
    [2, 2, 4, 'void_active_shot'], [7, 2, 2, 'finalize_resolved_void'], [3, 2, 2, 'forfeit']];
  for (const operator of [signer.publicKey, other.publicKey]) for (const [shotState, entryState, exitState, expected] of cases) {
    const shot = { key: key(50), player: other.publicKey, nonce: 17n, scoreDay: 3n, state: shotState, entryNeed: entry, exitNeed: exit, rentRefund: key(51), revealDeadlineTs: 2000n };
    const makeNeed = (address, numericState) => ({ address: address.toBuffer(), numericState, candidateAHash: need.candidateAHash, captureDeadlineTs: 3000n, targetTs: 1000n });
    const state = { clock: { nowTs: 2000n }, needs: [makeNeed(entry, entryState), makeNeed(exit, exitState)], shots: [shot] };
    const action = await nextOperation({}, { ...ctx, operator }, state);
    assert.equal(action.name, expected);
    assert.ok(action.instruction.keys[0].pubkey.equals(operator));
    assertMaintenance(action, createJournal(config, operator));
    if (['void_pending_entry', 'void_active_shot', 'finalize_resolved_void', 'forfeit'].includes(expected)) {
      assert.ok(action.instruction.keys.some(meta => meta.pubkey.equals(shot.rentRefund)), 'frozen refund is preserved');
    }
    const ownerAction = await nextOperation({}, { ...ctx, operator: signer.publicKey }, state);
    assert.deepEqual(action.instruction.keys.slice(1), ownerAction.instruction.keys.slice(1), 'changing operator must not change player-derived accounts');
  }
});

test('uncertain send is fsynced before broadcast; restart resends identical bytes without a new signature or blockhash', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2-public-keeper-'));
  const file = path.join(dir, 'journal.json');
  let journal = makeJournal(), latest = 0, simulations = 0, sends = 0, firstBytes, synced = false;
  const io = { ...fs,
    fsyncSync(fd) { synced = true; fs.fsyncSync(fd); },
    renameSync(from, to) { assert.ok(synced, 'file fsync must precede rename'); fs.renameSync(from, to); } };
  const persist = () => writeJournal(file, journal, io);
  const connection = stub({
    getLatestBlockhash: async () => { latest++; return recent; },
    simulateTransaction: async (...args) => { simulations++; return stub().simulateTransaction(...args); },
    sendRawTransaction: async raw => {
      sends++;
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.deepEqual(pendingBytes(saved), Buffer.from(raw), 'exact signed bytes must exist on disk before RPC sees them');
      if (!firstBytes) firstBytes = Buffer.from(raw); else assert.deepEqual(Buffer.from(raw), firstBytes);
      if (sends === 1) throw new Error('synthetic RPC response lost');
      return saved.pending.signature;
    }
  });
  try {
    await assert.rejects(sendOperation(connection, signer, operation, journal, persist), /response lost/);
    assert.equal(sends, 1);
    journal = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertJournal(journal, config, signer.publicKey);
    await assert.rejects(sendOperation(connection, signer, operation, journal, persist), /must be reconciled/);
    assert.equal(await resolvePending(connection, journal, persist), true);
    assert.equal(sends, 1, 'default recovery remains read-only');
    assert.equal(await resolvePending(connection, journal, persist, { send: true }), true);
    assert.equal(sends, 2); assert.equal(latest, 1); assert.equal(simulations, 1);
    connection.getSignatureStatuses = async () => ({ value: [{ confirmationStatus: 'confirmed', err: null, slot: 12 }] });
    assert.equal(await resolvePending(connection, journal, persist, { send: true }), false);
    assert.equal(journal.pending, undefined);
    assert.equal(journal.events[0].status, 'confirmed');
    assert.equal(sends, 2);
  } finally {
    for (const entry of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, entry));
    fs.rmdirSync(dir);
  }
});

test('wrong signer, failed simulation and failed persistence cannot broadcast', async () => {
  let sends = 0;
  const connection = stub({ sendRawTransaction: async () => { sends++; throw new Error('must not send'); } });
  await assert.rejects(sendOperation(connection, other, operation, makeJournal(), () => {}), /journal belongs/);
  const failedSim = makeJournal();
  const result = await sendOperation(stub({ ...connection, simulateTransaction: async () => ({ value: { err: 'WrongState' } }) }), signer, operation, failedSim, () => {});
  assert.equal(result.simulated, false); assert.equal(failedSim.pending, undefined);
  await assert.rejects(sendOperation(connection, signer, operation, makeJournal(), () => { throw new Error('disk unavailable'); }), /disk unavailable/);
  assert.equal(sends, 0);
});

test('expiry without observation stays unknown, failures wait for finalization, and pending replay rechecks genesis', async () => {
  let sends = 0;
  const connection = stub({ sendRawTransaction: async () => { sends++; }, getBlockHeight: async () => 101 });
  const unknown = pendingJournal();
  assert.equal(await resolvePending(connection, unknown, () => {}, { send: true }), false);
  assert.equal(unknown.events[0].status, 'expired-unobserved');
  assert.equal(unknown.events[0].error, undefined);
  const failed = pendingJournal();
  const failure = { confirmationStatus: 'confirmed', err: { InstructionError: [0, 'Custom'] }, slot: 22 };
  const observedFailure = stub({ getSignatureStatuses: async () => ({ value: [failure] }) });
  assert.equal(await resolvePending(observedFailure, failed, () => {}, { send: true }), true);
  assert.ok(failed.pending); assert.equal(failed.events.length, 0);
  failure.confirmationStatus = 'finalized';
  assert.equal(await resolvePending(observedFailure, failed, () => {}, { send: true }), false);
  assert.equal(failed.events[0].status, 'failed');
  const pending = pendingJournal();
  await assert.rejects(resolvePending(stub({ ...connection, getBlockHeight: async () => 50, getGenesisHash: async () => 'mainnet' }), pending, () => {}, { send: true }), /genesis/);
  assert.ok(pending.pending); assert.equal(sends, 0);
});

test('saved bytes refuse altered signature, payer, subject, program, instruction and chain account pins', () => {
  const journal = pendingJournal();
  assert.deepEqual(pendingBytes(journal), Buffer.from(journal.pending.signedTransaction, 'base64'));
  for (const altered of [
    { ...journal.pending, signature: bs58.encode(Buffer.alloc(64, 1)) },
    { ...journal.pending, blockhash: key(91).toBase58() },
    { ...journal.pending, subject: key(92).toBase58() },
    { ...journal.pending, name: 'seal_forward' },
    { ...journal.pending, name: 'forfeit' },
    { ...journal.pending, signedTransaction: journal.pending.signedTransaction + '\n' }
  ]) assert.throws(() => pendingBytes({ ...journal, pending: altered }));
  assert.throws(() => pendingBytes({ ...journal, payer: other.publicKey.toBase58() }), /payer/);
  const transfer = web3.SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: other.publicKey, lamports: 1 });
  assert.throws(() => pendingBytes({ ...journal, pending: record(transfer) }), /program\/data/);
  const wrongPin = publicTimepinInstruction({ ...ctx, addresses: { ...ctx.addresses, evidenceSpec: key(99) } }, need, 'expire');
  assert.throws(() => pendingBytes({ ...journal, pending: record(wrongPin) }), /pinned account/);
  const extra = new web3.Transaction({ feePayer: signer.publicKey, ...recent }).add(operation.instruction, transfer);
  extra.sign(signer);
  assert.throws(() => pendingBytes({ ...journal, pending: { ...journal.pending, signedTransaction: extra.serialize().toString('base64'), signature: bs58.encode(extra.signature) } }), /signature\/payer/);
});

// The guard that used to end a keeper's life for the crime of staying up. It
// counted every record the journal had ever written, so an operator serving real
// games walked into the same wall as one sending in a loop - and the wall throws,
// which the restart loop re-enters at once, so open games void while the process
// spins. The bound is a rate now; these cases pin what it does and does not stop.
test('the fee budget bounds a rate, not a lifetime, and still stops a drained or looping keeper', () => {
  const now = Date.UTC(2026, 8, 10, 12, 0, 0);
  const at = minutesAgo => new Date(now - minutesAgo * 60000).toISOString();
  const healthy = { balance: 11_000_000_000, startBalance: 2_800_000_000, now };

  // Thousands of records over a long life, six of them recent: this is exactly
  // the keeper the old bound killed.
  const longLife = [
    ...Array.from({ length: 5000 }, (_, i) => ({ preparedAt: at(120 + i) })),
    ...Array.from({ length: 6 }, () => ({ preparedAt: at(5) })),
  ];
  assert.equal(withinFeeBudget({ ...healthy, events: longLife }), true);

  // A tight loop inside the window is still stopped.
  const looping = Array.from({ length: FEE_BUDGET.maxRecordsPerWindow }, () => ({ preparedAt: at(1) }));
  assert.equal(withinFeeBudget({ ...healthy, events: looping }), false);
  assert.equal(withinFeeBudget({ ...healthy, events: looping.slice(1) }), true);

  // Money bounds are untouched and independent of the rate.
  assert.equal(withinFeeBudget({ ...healthy, balance: FEE_BUDGET.minBalanceLamports - 1, events: [] }), false);
  assert.equal(withinFeeBudget({
    balance: 1_000_000_000,
    startBalance: 1_000_000_000 + FEE_BUDGET.maxNetDecreaseLamports,
    events: [], now,
  }), false);

  // Topping the operator up raises the balance above where it started, which is
  // a negative decrease - allowed, and the reason a funded operator keeps going.
  assert.equal(withinFeeBudget({ balance: 11_000_000_000, startBalance: 2_800_000_000, events: [], now }), true);

  // An undated record counts as recent. A journal that lost its timestamps must
  // not become a journal with no rate bound at all.
  const undated = Array.from({ length: FEE_BUDGET.maxRecordsPerWindow }, () => ({}));
  assert.equal(withinFeeBudget({ ...healthy, events: undated }), false);
});
