import assert from 'node:assert';
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { saltMessage, saltFromSignature, deriveSalt, SALT_RE,
         seedMessage, seedFromSignature, saltFromSeed, deriveSeed } from './salt.mjs';
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
assert.notEqual(await saltFromSignature(bare), s1, 'domain separation must change the salt');
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

// ---------------------------------------------------------------------------
// SEED MODE. Same guarantee, one signature per wallet instead of one per shot,
// because a browser cannot ask for a wallet popup on every seal without either
// ruining the product or training the player to dismiss it.
const SCOPE = 'ratchetx.xyz';
const seedA = await deriveSeed({ signMessage: A.signMessage, scope: SCOPE, wallet: A.address });
assert.equal(seedA.length, 32, 'a seed is 32 bytes of key material');

const n1 = 'a1b2c3d4e5f60718', n2 = '0f1e2d3c4b5a6978';
const q1 = await saltFromSeed(seedA, n1);
const q2 = await saltFromSeed(seedA, n2);
assert.ok(SALT_RE.test(q1) && SALT_RE.test(q2), 'seeded salts must match the wire format');
assert.equal(await saltFromSeed(seedA, n1), q1, 'same seed and nonce must reproduce the salt');
assert.notEqual(q1, q2, 'a different nonce must give a different salt');
console.log('seeded salt reproducible    : ok');

const seedB = await deriveSeed({ signMessage: B.signMessage, scope: SCOPE, wallet: B.address });
assert.notEqual(Buffer.from(seedB).toString('hex'), Buffer.from(seedA).toString('hex'),
  'two wallets must not share a seed');
assert.notEqual(await saltFromSeed(seedB, n1), q1, 'two wallets must not share a salt');
console.log('unique per wallet           : ok');

// The two modes must not be interchangeable. A signature collected to open ONE
// shot must never work as the seed that opens every shot that wallet ever made.
const perShotSig = await A.signMessage(new TextEncoder().encode(
  saltMessage({ programId: PROGRAM, wallet: A.address, nonce: n1 })));
assert.notEqual(Buffer.from(await seedFromSignature(perShotSig)).toString('hex'),
                Buffer.from(seedA).toString('hex'),
  'a per-shot signature must not double as a seed');
assert.notEqual(seedMessage({ scope: SCOPE, wallet: A.address }),
                saltMessage({ programId: PROGRAM, wallet: A.address, nonce: n1 }),
  'the two signed messages must be distinguishable by the signer');
console.log('modes are separated         : ok');

let seedRefused = false;
try {
  await deriveSeed({ signMessage: async () => nacl.sign.detached(Buffer.from(String(Math.random())), alice.secretKey),
                     scope: SCOPE, wallet: A.address });
} catch (e) { seedRefused = /deterministic/.test(e.message); }
assert.ok(seedRefused, 'a non-deterministic wallet must be refused in seed mode too');
console.log('non-deterministic wallet    : refused');

// THE PROOF, again: a cleared browser, a new phone, a year later. The player
// signs the same sentence, reads the nonce off the public shot, and opens their
// own commit. Nothing was stored and nothing was shared.
const laterDevice = wallet(alice);
const seedLater = await deriveSeed({ signMessage: laterDevice.signMessage, scope: SCOPE, wallet: laterDevice.address });
assert.equal(await saltFromSeed(seedLater, n1), q1, 'a later device must rederive the same seeded salt');
console.log('recovered from nonce alone  :', q1.slice(0, 16) + '…  (one signature, nothing stored)');

console.log('\nALL PASS - a lost salt is no longer a lost shot.');
