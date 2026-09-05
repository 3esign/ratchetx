import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import {
  SHOT_ARCHIVED_SIZE, SHOT_RESULT_SIZE, SHOT_ARCHIVED_DISCRIMINATOR,
  decodeShotArchived, extractShotArchivedReceipts,
} from '../onchain/ratchet-core-g2/client/shot-receipt.mjs';

const root = new URL('../', import.meta.url);
const lib = readFileSync(new URL('onchain/ratchet-core-g2/programs/ratchet-core-g2/src/lib.rs', root), 'utf8');
const state = readFileSync(new URL('onchain/ratchet-core-g2/programs/ratchet-core-g2/src/state.rs', root), 'utf8');
// The fixture encoder takes field order and types from the ACTUAL Rust structs,
// independently of the browser decoder's offsets and discriminator constant.
function fields(source, name) {
  const body = new RegExp('pub struct ' + name + ' \\{([\\s\\S]*?)^\\}', 'm').exec(source)?.[1];
  assert.ok(body, name + ' Rust struct exists');
  return [...body.replace(/\/\/[^\n]*/g, '').matchAll(/pub\s+(\w+)\s*:\s*([^,\n]+),/g)]
    .map(([, key, type]) => [key, type.replace(/\s/g, '')]);
}
const structs = { ShotArchived: fields(lib, 'ShotArchived'), ShotResult: fields(state, 'ShotResult') };
const disc = createHash('sha256').update('event:ShotArchived').digest().subarray(0, 8);
const bytes = seed => Uint8Array.from({ length: 32 }, (_, i) => (seed + i) & 255);
function values(overrides = {}) {
  const nonce = (1n << 60n) + 23n;
  return {
    economy_hash: bytes(11), player: bytes(51), nonce, page_index: nonce / 16n,
    slot: Number(nonce % 16n), sequence: 3, row_hash: bytes(91), results_root: bytes(131),
    ...overrides,
    result: {
      ruleset_hash: bytes(171), proof_material: bytes(211), state: 4, void_reason: 0,
      stake: (1n << 63n) + 5n, sealed_ts: -9n, entry_target_ts: 1_800_000_000n,
      exit_target_ts: 1_800_000_300n, side: 1, p_bps: 6901,
      delegate: bytes(27), game_result_hash: bytes(67), ...overrides.result,
    },
  };
}
function encode(name, value) {
  return Buffer.concat(structs[name].map(([key, type]) => {
    if (structs[type]) return encode(type, value[key]);
    if (type === '[u8;32]' || type === 'Pubkey') return Buffer.from(value[key]);
    const buffer = Buffer.alloc({ u8: 1, u16: 2, u64: 8, i64: 8 }[type]);
    if (type === 'u8') buffer.writeUInt8(value[key]);
    else if (type === 'u16') buffer.writeUInt16LE(value[key]);
    else if (type === 'u64') buffer.writeBigUInt64LE(value[key]);
    else if (type === 'i64') buffer.writeBigInt64LE(value[key]);
    else throw new Error('New Rust field type needs an independent encoder: ' + type);
    return buffer;
  }));
}
const fixture = (overrides = {}) => Buffer.concat([disc, encode('ShotArchived', values(overrides))]);
const camel = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [
  key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
  item instanceof Uint8Array || typeof item !== 'object' ? item : camel(item),
]));
const CORE = 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL';
const OTHER = '11111111111111111111111111111111';
const THIRD = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const enter = (program = CORE, depth = 1) => `Program ${program} invoke [${depth}]`;
const success = (program = CORE) => `Program ${program} success`;
const failed = (program = CORE) => `Program ${program} failed: custom program error: 0x1`;
const data = (buffer = fixture()) => 'Program data: ' + buffer.toString('base64');
const transaction = logs => ({
  slot: 345_678_901, transaction: { signatures: ['5'.repeat(88)] },
  meta: { err: null, logMessages: logs },
});
const extract = logs => extractShotArchivedReceipts(transaction(logs), { coreProgramId: CORE });

test('wire fixture follows current Rust event and all twelve ShotResult fields', () => {
  assert.equal(structs.ShotArchived.length, 9);
  assert.equal(structs.ShotResult.length, 12);
  assert.equal(encode('ShotResult', values().result).length, 165);
  assert.equal(SHOT_RESULT_SIZE, 165);
  assert.equal(fixture().length, 319);
  assert.equal(SHOT_ARCHIVED_SIZE, 319);
  assert.equal(SHOT_ARCHIVED_DISCRIMINATOR, disc.toString('hex'));
  assert.match(state, /pub const HISTORY_PAGE_CAP: usize = 16;/);
});

test('all fields decode without integer loss or aliasing input bytes', () => {
  const input = fixture(), decoded = decodeShotArchived(input);
  assert.deepEqual(decoded, camel(values()));
  assert.equal(typeof decoded.nonce, 'bigint');
  assert.equal(typeof decoded.result.stake, 'bigint');
  assert.equal(decoded.result.sealedTs, -9n);
  assert.equal(Buffer.isBuffer(decoded.player), false);
  input.fill(0);
  assert.deepEqual(decoded.player, values().player);
  assert.deepEqual(decoded.result.gameResultHash, values().result.game_result_hash);
});

test('byte-offset views decode correctly and partial/extended/wrong events fail', () => {
  const wire = fixture(), padded = new Uint8Array(wire.length + 12);
  padded.set(wire, 5);
  assert.deepEqual(decodeShotArchived(padded.subarray(5, 5 + wire.length)), camel(values()));
  assert.throws(() => decodeShotArchived(wire.subarray(0, -1)), /exactly 319/);
  assert.throws(() => decodeShotArchived(Buffer.concat([wire, Buffer.from([0])])), /exactly 319/);
  const wrong = fixture(); wrong[0] ^= 1;
  assert.throws(() => decodeShotArchived(wrong), /discriminator/);
  assert.throws(() => decodeShotArchived(wire.toString('base64')), /Uint8Array/);
});

test('metadata binds nonce/page/slot; fold sequence is not nonce order', () => {
  for (const override of [{ slot: 16 }, { sequence: 0 }, { sequence: 17 },
    { page_index: values().page_index + 1n }, { slot: 8 }])
    assert.throws(() => decodeShotArchived(fixture(override)), /slot|sequence|nonce/);
  const nonce = (1n << 64n) - 1n;
  const decoded = decodeShotArchived(fixture({ nonce, page_index: nonce / 16n, slot: 15, sequence: 1 }));
  assert.equal(decoded.nonce, nonce);
  assert.equal(decoded.sequence, 1, 'the final nonce can be the first terminal fold');
  assert.equal(decodeShotArchived(fixture({ nonce: 0n, page_index: 0n, slot: 0, sequence: 16 })).sequence, 16);
});

test('unknown state, void reason and side remain raw numeric evidence', () => {
  const result = decodeShotArchived(fixture({ result: { state: 251, void_reason: 252, side: 253 } })).result;
  assert.equal(result.state, 251);
  assert.equal(result.voidReason, 252);
  assert.equal(result.side, 253);
});

test('successful Core runtime event carries transaction and bounded provenance', () => {
  const receipts = extract([enter(), 'Program log: Instruction: Reveal', data(),
    `Program ${CORE} consumed 123 of 456 compute units`, success()]);
  assert.equal(receipts.length, 1);
  const receipt = receipts[0];
  assert.deepEqual(receipt.event, camel(values()));
  assert.deepEqual(receipt.transaction, { signature: '5'.repeat(88), slot: 345_678_901 });
  assert.deepEqual(receipt.provenance, {
    source: 'getTransaction.meta.logMessages', coreProgramId: CORE, logIndex: 2,
    invocationLogIndex: 0, invocationDepth: 1, invocationPath: [CORE], rpcReportedSuccess: true,
    independentVerification: false, historyPageVerified: false, economicsVerified: false,
  });
});

test('failed/unknown transaction status and missing metadata cannot yield receipts', () => {
  for (const err of [{ InstructionError: [0, 'Custom'] }, undefined, false]) {
    const tx = transaction([enter(), data(), success()]); tx.meta.err = err;
    assert.throws(() => extractShotArchivedReceipts(tx, { coreProgramId: CORE }), /meta.err/);
  }
  for (const change of [tx => { tx.meta = null; }, tx => { tx.meta.logMessages = null; },
    tx => { tx.meta.logMessages = [null]; }, tx => { tx.slot = Number.MAX_SAFE_INTEGER + 1; },
    tx => { tx.transaction.signatures = []; }, tx => { tx.transaction.signatures = 'not-an-array'; }]) {
    const tx = transaction([enter(), data(), success()]); change(tx);
    assert.throws(() => extractShotArchivedReceipts(tx, { coreProgramId: CORE }));
  }
  assert.throws(() => extractShotArchivedReceipts(transaction([])), /explicit/);
  assert.throws(() => extractShotArchivedReceipts(transaction([]), { coreProgramId: CORE + '\n' }), /explicit/);
});

test('foreign events and foreign CPI emissions are skipped; real nested Core survives', () => {
  assert.deepEqual(extract([enter(OTHER), data(), success(OTHER)]), []);
  assert.deepEqual(extract([enter(), enter(OTHER, 2), data(), success(OTHER), success()]), []);
  const receipts = extract([enter(OTHER), enter(CORE, 2), data(), success(), success(OTHER)]);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].provenance.invocationDepth, 2);
  assert.deepEqual(receipts[0].provenance.invocationPath, [OTHER, CORE]);
});

test('Program log strings cannot spoof data, invocations or multiline runtime logs', () => {
  const spoof = ['Program log: ' + data(), 'Program log: ' + enter(),
    'Program log: text\n' + data() + '\n' + success(), 'Program log: Log truncated'];
  assert.deepEqual(extract([enter(), ...spoof, success()]), []);
  assert.deepEqual(extract([enter(OTHER), ...spoof, data(), success(OTHER)]), []);
  assert.throws(() => extract(['Program log: ' + enter(), data(), 'Program log: ' + success()]), /provenance/);
});

test('a caught failed Core CPI discards its events despite overall transaction success', () => {
  assert.deepEqual(extract([enter(OTHER), enter(CORE, 2), data(), failed(), success(OTHER)]), []);
});

test('a later failed ancestor rolls back a successfully emitted nested Core event', () => {
  assert.deepEqual(extract([enter(THIRD), enter(OTHER, 2), enter(CORE, 3), data(),
    success(), failed(OTHER), success(THIRD)]), []);
  const receipts = extract([enter(), data(), success(), enter(OTHER), enter(CORE, 2),
    data(), failed(), success(OTHER)]);
  assert.equal(receipts.length, 1, 'a different successful top-level invocation is retained');
  assert.equal(receipts[0].provenance.invocationLogIndex, 0);
});

test('broken, missing and truncated runtime provenance fails closed', () => {
  const cases = [[enter(CORE, 2)], [enter(), success(OTHER)], [success()], [data()],
    [enter(), data()], [enter(), data(), success(), 'Log truncated'], [enter(), failed()],
    [`Program ${CORE} invoke [x]`], [enter() + ' trailing'], [enter(), success() + ' trailing'],
    [enter() + '\n', data(), success()]];
  for (const logs of cases) assert.throws(() => extract(logs), /invocation|provenance|Truncated|truncated|contradicts/);
});

test('foreign event kinds are skipped but malformed Core archive bytes are rejected', () => {
  const otherEvent = fixture(); otherEvent[0] ^= 1;
  assert.deepEqual(extract([enter(), data(otherEvent), success()]), []);
  assert.deepEqual(extract([enter(OTHER), 'Program data: !not-base64!', success(OTHER)]), []);
  for (const line of ['Program data: !not-base64!', 'Program data:', 'Program data: AAAA',
    data(fixture().subarray(0, -1)), data(Buffer.concat([fixture(), Buffer.from([0])]))])
    assert.throws(() => extract([enter(), line, success()]), /base64|data|discriminator|exactly/);
});

test('module runs in a browser-shaped context with no Node globals', () => {
  const source = readFileSync(new URL('onchain/ratchet-core-g2/client/shot-receipt.mjs', root), 'utf8');
  const browser = runInNewContext(source.replace(/^export /gm, '') +
    '\n({decodeShotArchived,extractShotArchivedReceipts})', { Uint8Array, DataView, atob });
  assert.equal(browser.decodeShotArchived(new Uint8Array(fixture())).nonce, values().nonce);
  assert.equal(browser.extractShotArchivedReceipts(transaction([enter(), data(), success()]),
    { coreProgramId: CORE }).length, 1);
});
