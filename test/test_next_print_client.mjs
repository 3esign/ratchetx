import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import {
  PROGRAM_ID,
  SHOT_ACCOUNT_SIZE,
  closeShotIx,
  commitHash,
  forfeitIx,
  observeIx,
  openShotIx,
  parseShot,
  pushAccount,
  revealIx,
  shotPda,
  timeoutIx,
} from '../onchain/ratchet-next-print/client/client-v1.mjs';

const vector = JSON.parse(readFileSync(
  new URL('../onchain/ratchet-next-print/vectors/abi-v1.json', import.meta.url),
));
const player = vector.player;
const nonce = BigInt(vector.nonce);
const shot = vector.shotPda;
const commit = commitHash({
  player,
  nonce,
  side: vector.side,
  pBps: vector.pBps,
  salt: vector.saltHex,
});

assert.equal(PROGRAM_ID.toBase58(), vector.programId);
assert.equal(commit.toString('hex'), vector.commitHex, 'binary commitment must match Rust hashv');
const [derivedShot, bump] = shotPda(player, nonce);
assert.equal(derivedShot.toBase58(), vector.shotPda);
assert.equal(bump, vector.shotBump);
assert.equal(pushAccount(vector.feedIndex).toBase58(), vector.priceUpdate);

const open = openShotIx({ player, nonce, commit, feedIndex: vector.feedIndex });
assert.equal(open.data.toString('hex'), vector.openDataHex);
assert.deepEqual(open.keys.map(k => [k.isSigner, k.isWritable]), [
  [true, true], [false, true], [false, false], [false, false],
]);
assert.equal(open.keys[1].pubkey.toBase58(), vector.shotPda);
assert.equal(open.keys[2].pubkey.toBase58(), vector.priceUpdate);

const actor = Keypair.generate().publicKey;
assert.equal(observeIx({ actor, shot, feedIndex: vector.feedIndex }).data.toString('hex'), vector.observeDataHex);
assert.equal(timeoutIx({ actor, shot }).data.toString('hex'), vector.timeoutDataHex);
assert.equal(revealIx({
  player, shot, side: vector.side, pBps: vector.pBps, salt: vector.saltHex,
}).data.toString('hex'), vector.revealDataHex);
assert.equal(forfeitIx({ actor, shot }).data.toString('hex'), vector.forfeitDataHex);
const close = closeShotIx({ actor, shot, player });
assert.equal(close.data.toString('hex'), vector.closeShotDataHex);
assert.deepEqual(close.keys.map(k => [k.isSigner, k.isWritable]), [
  [true, false], [false, true], [false, true],
]);

assert.throws(() => commitHash({ player, nonce, side: 2, pBps: 5000, salt: vector.saltHex }), /side/);
assert.throws(() => commitHash({ player, nonce, side: 1, pBps: 10001, salt: vector.saltHex }), /pBps/);
assert.throws(() => commitHash({ player, nonce, side: 1, pBps: 5000, salt: '00' }), /salt/);
assert.throws(() => openShotIx({ player, nonce, commit, feedIndex: 7 }), /feedIndex/);
assert.throws(() => parseShot(Buffer.alloc(SHOT_ACCOUNT_SIZE)), /not a NextPrintShot/);
assert.throws(() => parseShot(Buffer.alloc(SHOT_ACCOUNT_SIZE - 1)), /396 bytes/);

const printer = readFileSync(new URL(
  '../onchain/ratchet-next-print/programs/ratchet-next-print/examples/print_abi_vectors.rs',
  import.meta.url,
), 'utf8');
assert.match(printer, /instruction::OpenShot/);
assert.match(printer, /InstructionData/);

console.log('NEXT PRINT static client PASS: Rust vectors, commitment, PDA, instruction bytes and guards');
