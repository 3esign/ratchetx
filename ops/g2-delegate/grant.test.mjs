// Grant CLI, offline half: argument parsing, the canonical addresses, the
// grant decode and every refusal. No network, no keys, no chain - everything
// here runs without a network, which is the only reason it can be trusted
// before a live grant exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, canonicalAddresses, decodeGrantAccount } from './grant.mjs';
import web3 from '@solana/web3.js';

const DELEGATE = 'DuqnyhLHPAARS9dhCL3d3ZVxwYi48XtuZ3yRH38AgQAy';
const HEAD = ['--rpc', 'x', '--keypair', 'k', '--delegate', DELEGATE];
// full argv, exactly one of each flag; lifetime built per case so the
// out-of-range cases never carry a second --lifetime-hours (a repeated flag
// would throw "repeated" before the range is ever checked).
const B = (ms, gs, lh) => [...HEAD, '--max-stake', String(ms), '--max-gross-stake', String(gs),
  '--max-shots', '3', '--min-interval', '60',
  ...(lh !== undefined ? ['--lifetime-hours', String(lh)] : [])];

test('parseArgs refuses every defaulted bound', () => {
  const base = ['--rpc', 'https://api.devnet.solana.com', '--keypair', 'k.json', '--delegate', DELEGATE];
  assert.throws(() => parseArgs(base), /max-stake is required/);
  assert.throws(() => parseArgs([...base, '--max-stake', '100']), /max-gross-stake is required/);
  assert.throws(() => parseArgs([...base, '--max-stake', '100', '--max-gross-stake', '300']), /max-shots is required/);
  assert.throws(() => parseArgs([...base, '--max-stake', '100', '--max-gross-stake', '300', '--max-shots', '3']), /min-interval is required/);
  assert.throws(() => parseArgs([...base, '--max-stake', '100', '--max-gross-stake', '300', '--max-shots', '3', '--min-interval', '60']), /expires-at <unix-ts> or --lifetime-hours/);
  const opt = parseArgs([...base, '--max-stake', '100', '--max-gross-stake', '300', '--max-shots', '3',
    '--min-interval', '60', '--lifetime-hours', '24', '--grant-id', 'ab'.repeat(16)]);
  assert.equal(opt.send, false); // dry run is the default
  assert.equal(opt.maxStake, '100'); assert.equal(opt.maxGrossStake, '300');
  assert.equal(opt.maxShots, '3'); assert.equal(opt.minIntervalSeconds, '60');
  assert.equal(opt.grantId, 'ab'.repeat(16));
});

test('parseArgs refuses bounds the program would refuse', () => {
  // gross above max*shots
  assert.throws(() => parseArgs(B(100, 301, 24)), /exceeds max_stake \* max_shots/);
  // stake below economy min_stake
  assert.throws(() => parseArgs(B(99, 300, 24)), /at least the economy min_stake/);
  // lifetime over 30 days, and zero — no second lifetime flag present
  assert.throws(() => parseArgs(B(100, 300, 721)), /1\.\.720/);
  assert.throws(() => parseArgs(B(100, 300, 0)), /1\.\.720/);
  // repeated flags refuse before any bound is even read
  assert.throws(() => parseArgs([...B(100, 300, 24), '--max-gross-stake', '300']), /repeated/);
  assert.throws(() => parseArgs([...B(100, 300, 24), '--lifetime-hours', '721']), /repeated/);
  // unknown flag
  assert.throws(() => parseArgs([...B(100, 300, 24), '--nope', '1']), /unknown argument/);
});

test('canonicalAddresses refuses a foreign or wrong-shape state', () => {
  const real = canonicalAddresses();
  assert.equal(real.payer, 'wJYFx75hzP9h2ujQQ6mpJWLeYgPSUdLtuWjrw881rKz');
  assert.equal(real.core, 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL');
  assert.equal(real.economy, 'AJZwZTs2bN9ryFmCHaW3NnjK3hinvaMCvmWSJwK1pfNr');
  assert.equal(real.ruleset, '4ZHe6oQQoHsj7HoRaRnBzDgChebumeu28QUAjsfopbS1');
  assert.throws(() => canonicalAddresses({ schema: 2 }), /unrecognized bootstrap state/);
  assert.throws(() => canonicalAddresses({ schema: 1, purpose: 'DEVNET_TEST_CREDITS_ONLY', clusterGenesis: 'other' }), /not the canonical devnet one/);
});

test('decodeGrantAccount reads the exact Rust layout and flags every mismatch', () => {
  // Build 204 bytes exactly as the program would: 8-byte anchor discriminator + DelegateGrant.
  const b = Buffer.alloc(204, 0);
  let o = 8;
  b.writeUInt16LE(2, o); o += 2;                    // schema
  o += 1;                                            // bump
  Buffer.from('ab'.repeat(16), 'hex').copy(b, o); o += 16;   // grant_id
  Buffer.from('cd'.repeat(32), 'hex').copy(b, o); o += 32;   // economy_hash
  Buffer.from('ef'.repeat(32), 'hex').copy(b, o); o += 32;   // ruleset_hash
  const player = new web3.PublicKey('wJYFx75hzP9h2ujQQ6mpJWLeYgPSUdLtuWjrw881rKz');
  player.toBuffer().copy(b, o); o += 32;
  const delegate = new web3.PublicKey(DELEGATE);
  delegate.toBuffer().copy(b, o); o += 32;
  b.writeBigUInt64LE(100n, o); o += 8;               // max_stake
  b.writeBigUInt64LE(300n, o); o += 8;               // max_gross_stake
  b.writeUInt16LE(3, o); o += 2;                     // max_shots
  b.writeUInt32LE(60, o); o += 4;                    // min_interval
  b.writeBigInt64LE(1788700000n, o); o += 8;         // expires_at
  b.writeBigUInt64LE(0n, o); o += 8;                 // gross_stake_used
  b.writeUInt16LE(0, o); o += 2;                     // shots_used
  b.writeBigInt64LE(0n, o); o += 8;                  // last_seal_ts
  b.writeUInt8(0, o);                                 // revoked
  const info = { data: b, owner: new web3.PublicKey('ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL') };
  const r = decodeGrantAccount(info, 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL', 'ab'.repeat(16));
  assert.equal(r.exists, true); assert.equal(r.decoded, true);
  assert.equal(r.ownerOk, true); assert.equal(r.grantIdOk, true);
  assert.equal(r.grant.maxStake, 100n); assert.equal(r.grant.maxGrossStake, 300n);
  assert.equal(r.grant.maxShots, 3); assert.equal(r.grant.minIntervalSeconds, 60);
  assert.equal(r.grant.expiresAtTs, 1788700000n);
  assert.equal(r.grant.delegate, DELEGATE);
  assert.equal(r.grant.revoked, 0); assert.equal(r.grant.shotsUsed, 0);
  // wrong owner is flagged
  const bad = decodeGrantAccount(info, 'SomeOtherProgram', 'ab'.repeat(16));
  assert.equal(bad.ownerOk, false);
  // wrong grant id is flagged
  const wrongId = decodeGrantAccount(info, 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL', 'ff'.repeat(16));
  assert.equal(wrongId.grantIdOk, false);
  // missing account
  assert.equal(decodeGrantAccount(null, 'x').exists, false);
  // wrong length is not a decode
  assert.equal(decodeGrantAccount({ data: Buffer.alloc(100), owner: info.owner }, 'x').decoded, false);
  // a used or revoked grant decodes but tells the truth
  // shots_used u16 sits at offset 192 (8 disc + 2 schema + 1 bump + 16 id + 32+32 hashes + 32 player + 32 delegate + 8+8 stakes + 2 shots_max + 4 interval + 8 expiry + 8 gross)
  const used = Buffer.from(b);
  used.writeUInt16LE(3, 193);
  used.writeUInt8(1, 203); // revoked
  const r2 = decodeGrantAccount({ data: used, owner: info.owner }, 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL', 'ab'.repeat(16));
  assert.equal(r2.grant.shotsUsed, 3); assert.equal(r2.grant.revoked, 1);
  assert.equal(r2.grant.maxStake, 100n); // the rest still decodes
});