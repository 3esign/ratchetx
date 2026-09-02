import assert from 'node:assert';
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { saltMessage, saltFromSignature, deriveSalt, SALT_RE } from './salt.mjs';
import { commitPreimage } from './core.mjs';

const PROGRAM = '6sJn9CfSwD3Jt8V6vYyHq5hYmLKdDmaTgqwHY5czpPBv';
const sha = s => createHash('sha256').update(s).digest('hex');
const wallet = kp => ({ address: kp.publicKey.toBase58(), signMessage: async b => nacl.sign.detached(b, kp.secretKey) });

const alice = Keypair.generate(), bobKp = Keypair.generate();
const A = wallet(alice), B = wallet(bobKp);

const s1 = await deriveSalt({ signMessage: A.signMessage, programId: PROGRAM, wallet: A.address, nonce: 42 });
const s2 = await deriveSalt({ signMessage: A.signMessage, programId: PROGRAM, wallet: A.address, nonce: 42 });
assert.equal(s1, s2, 'same wallet + same shot must give the same salt');
assert.match(s1, SALT_RE, 'salt must be 32 lowercase hex');
console.log('deterministic + well formed :', s1);

const other = await deriveSalt({ signMessage: A.signMessage, programId: PROGRAM, wallet: A.address, nonce: 43 });
assert.notEqual(s1, other, 'a different shot must get a different salt');
const bobSalt = await deriveSalt({ signMessage: B.signMessage, programId: PROGRAM, wallet: B.address, nonce: 42 });
assert.notEqual(s1, bobSalt, 'a different wallet must get a different salt');
console.log('unique per shot and wallet  : ok');

const bare = nacl.sign.detached(new TextEncoder().encode(`${PROGRAM}|${A.address}|42`), alice.secretKey);
assert.notEqual(saltFromSignature(bare), s1, 'domain separation must change the salt');
console.log('domain separated            : ok');

let refused = false;
try {
  await deriveSalt({ signMessage: async () => nacl.sign.detached(Buffer.from(String(Math.random())), alice.secretKey),
                     programId: PROGRAM, wallet: A.address, nonce: 7 });
} catch (e) { refused = /deterministic/.test(e.message); }
assert.ok(refused, 'a wallet signing non-deterministically must be refused, not trusted');
console.log('non-deterministic wallet    : refused');

// THE PROOF — recovery on a second device with nothing carried over.
const saltA = await deriveSalt({ signMessage: A.signMessage, programId: PROGRAM, wallet: A.address, nonce: 99 });
const commitA = sha(commitPreimage({ wallet: A.address, nonce: 99, side: 'YES', pBps: 6000, salt: saltA }));
const deviceB = wallet(alice);   // same wallet, fresh context, zero shared state
const saltB = await deriveSalt({ signMessage: deviceB.signMessage, programId: PROGRAM, wallet: deviceB.address, nonce: 99 });
const commitB = sha(commitPreimage({ wallet: deviceB.address, nonce: 99, side: 'YES', pBps: 6000, salt: saltB }));
assert.equal(saltB, saltA, 'second device must rederive the same salt');
assert.equal(commitB, commitA, 'second device must rebuild the same commit');
console.log('recovered on a 2nd device   :', commitB.slice(0, 16) + '…  (nothing stored, nothing shared)');

console.log('\nALL PASS - a lost salt is no longer a lost shot.');
