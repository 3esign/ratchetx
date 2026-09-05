// The two IO helpers in ops/g2-send/send.mjs that CAN be proved without a chain:
// how a keypair is loaded, and how an account read-back is shaped.
//
// The read-back is the one that matters. "I could not look" and "it is not
// there" must be distinguishable, and BOTH must refuse - a read error that
// returns nothing quietly is how a sender ends up reporting success for a
// transaction that wrote nowhere.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSigner, readBack } from '../ops/g2-send/send.mjs';
import { sendIsEvidence } from '../ops/g2-send/gate.mjs';

let checks = 0;
const ok = (c, msg) => { checks += 1; assert.ok(c, msg); };
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };

// ---- loadSigner: no default location, no search ----------------------------
const web3Stub = { Keypair: { fromSecretKey: bytes => ({ secretKeyLength: bytes.length }) } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g2-send-'));
try {
  checks += 1;
  assert.throws(() => loadSigner(web3Stub, null), /never implicit/,
    'loadSigner accepted a missing path. A tool that goes looking for keys eventually finds the wrong one.');
  checks += 1;
  assert.throws(() => loadSigner(web3Stub, path.join(tmp, 'nope.json')), /cannot read a keypair/,
    'a missing keypair file did not produce a clear refusal');

  const notAKey = path.join(tmp, 'short.json');
  fs.writeFileSync(notAKey, JSON.stringify([1, 2, 3]));
  checks += 1;
  assert.throws(() => loadSigner(web3Stub, notAKey), /32 or 64 byte secret key/,
    'a three-byte array was accepted as a keypair');

  const notAnArray = path.join(tmp, 'object.json');
  fs.writeFileSync(notAnArray, JSON.stringify({ secretKey: 'nope' }));
  checks += 1;
  assert.throws(() => loadSigner(web3Stub, notAnArray), /secret key array/,
    'an object was accepted where a secret key array was required');

  const real = path.join(tmp, 'ok.json');
  fs.writeFileSync(real, JSON.stringify(Array.from({ length: 64 }, (_, i) => i % 256)));
  eq(loadSigner(web3Stub, real).secretKeyLength, 64, 'a valid 64-byte keypair did not load');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- readBack: three different nothings, all refusals ----------------------
const PK = a => ({ toBase58: () => a, __addr: a });
const web3Pk = { PublicKey: function (a) { return PK(a); } };
const DISC = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
const OWNER = 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL';

const conn = value => ({ getAccountInfo: async () => (value instanceof Error ? (() => { throw value; })() : value) });

{ // the RPC threw
  const r = await readBack(conn(new Error('connection reset')), web3Pk, 'Addr', {});
  eq(r.exists, false, 'a read that THREW did not report the account as unread');
  ok(r.readError, 'a read error was swallowed rather than recorded');
  ok(sendIsEvidence({ signature: 's', confirmation: { err: null }, account: r }).evidence === false,
    'a failed read counted as evidence');
}
{ // the account is simply not there
  const r = await readBack(conn(null), web3Pk, 'Addr', {});
  eq(r.exists, false, 'a null account info did not report exists:false');
  eq(r.readError, undefined, '"not there" was reported as a read error, which is a different fact');
}
{ // it is there, with the right discriminator and owner
  const data = Buffer.concat([DISC, Buffer.alloc(764)]);
  const r = await readBack(conn({ data, owner: PK(OWNER), lamports: 5 }), web3Pk, 'Addr',
    { expectedOwner: OWNER, discriminator: DISC });
  eq(r.dataLen, 772, 'the data length was not measured');
  eq(r.discriminatorMatches, true, 'a matching discriminator was not recognised');
  ok(sendIsEvidence({ signature: 's', confirmation: { err: null }, account: r }).evidence === true,
    'a correct read-back was not accepted as evidence');
}
{ // right address, WRONG TYPE - the failure a signature alone hides completely
  const data = Buffer.concat([Buffer.from([9, 9, 9, 9, 9, 9, 9, 9]), Buffer.alloc(764)]);
  const r = await readBack(conn({ data, owner: PK(OWNER), lamports: 5 }), web3Pk, 'Addr',
    { expectedOwner: OWNER, discriminator: DISC });
  eq(r.discriminatorMatches, false, 'a DIFFERENT account type at the address was not detected');
  const v = sendIsEvidence({ signature: 's', confirmation: { err: null }, account: r });
  ok(v.evidence === false && v.problems.some(p => /discriminator/.test(p)),
    'an account holding another type counted as evidence of our write');
}
{ // an account too short to hold a discriminator at all
  const r = await readBack(conn({ data: Buffer.alloc(4), owner: PK(OWNER), lamports: 5 }), web3Pk, 'Addr',
    { expectedOwner: OWNER, discriminator: DISC });
  eq(r.discriminatorMatches, false, 'a four-byte account was not too short to match an eight-byte discriminator');
}

console.log(`ok - keys are named not searched, and three kinds of nothing all refuse (${checks} checks)`);
