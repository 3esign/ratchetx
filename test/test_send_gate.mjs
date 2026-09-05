// Whether a G2 transaction may be sent, and what makes a send count as evidence.
//
// L1 says a sender that has never sent is still not a game. The other half is
// just as true and is easier to get wrong: a signature is not evidence that the
// state changed. A transaction can be confirmed and the account you meant to
// write can be absent, empty, owned by something else, or hold a different type
// entirely. Both halves are decided here, in a pure file, so both are settled
// before a deployment exists rather than discovered against one.
import assert from 'node:assert/strict';
import { maySend, sendIsEvidence } from '../ops/g2-send/gate.mjs';

let checks = 0;
const ok = (c, msg) => { checks += 1; assert.ok(c, msg); };
const refuses = (input, match, msg) => {
  const r = maySend(input);
  checks += 1;
  assert.ok(r.send === false, msg);
  checks += 1;
  assert.match(r.reason, match, `refused for the wrong reason: ${r.reason}`);
};

const CLEAN = { mode: 'send', cluster: { name: 'devnet' }, simulation: { err: null },
                payer: 'Payer1111111111111111111111111111111111111', hasSigner: true };

// ---- the one that must work -------------------------------------------------
ok(maySend(CLEAN).send === true, 'a clean devnet send with a signer and a passing simulation was refused');

// ---- mainnet, which has no flag ---------------------------------------------
refuses({ ...CLEAN, cluster: { name: 'mainnet' } }, /does not send on mainnet/,
  'MAINNET WAS SENDABLE FROM THIS TOOL. That is the single thing it must never allow.');
// And not even in dry-run shape, and not with any extra field somebody adds later.
for (const extra of [{ force: true }, { allowMainnet: true }, { override: 'yes' }, { i_know_what_i_am_doing: 1 }]) {
  refuses({ ...CLEAN, ...extra, cluster: { name: 'mainnet' } }, /does not send on mainnet/,
    `a field named ${Object.keys(extra)[0]} was enough to send on mainnet`);
}

// ---- an unidentified cluster is not a permissive cluster --------------------
refuses({ ...CLEAN, cluster: null }, /cluster was not identified/, 'a missing cluster was treated as sendable');
refuses({ ...CLEAN, cluster: {} }, /cluster was not identified/, 'a nameless cluster was treated as sendable');

// ---- a simulation that was not run is not a simulation that passed ---------
refuses({ ...CLEAN, simulation: undefined }, /not run is not a simulation that passed/,
  'a transaction with NO simulation was sent. This is the exact shape of the six false greens: an '
  + 'answer that was never computed reading as an answer of yes.');
refuses({ ...CLEAN, simulation: null }, /not run is not a simulation that passed/,
  'a null simulation was treated as a passing one');
refuses({ ...CLEAN, simulation: { err: { InstructionError: [0, { Custom: 6009 }] } } }, /simulation failed/,
  'a transaction whose simulation FAILED was sent anyway, paying a fee to learn what was already known');

// ---- the fee payer is never implicit ---------------------------------------
refuses({ ...CLEAN, payer: null }, /never implicit/, 'a send with no fee payer was allowed');
refuses({ ...CLEAN, hasSigner: false }, /no signer/, 'a send with an unsignable payer was allowed');

// ---- dry run sends nothing, on any cluster ---------------------------------
for (const name of ['devnet', 'testnet', 'localnet']) {
  const r = maySend({ ...CLEAN, mode: 'dry-run', cluster: { name } });
  checks += 1;
  assert.equal(r.send, false, `dry run sent something on ${name}`);
}
refuses({ ...CLEAN, mode: 'yolo' }, /unknown mode/, 'an unrecognised mode was not refused');

// ---- and now: what makes a send EVIDENCE -----------------------------------
const GOOD = {
  signature: '5x'.repeat(20),
  confirmation: { err: null },
  account: { exists: true, dataLen: 772, discriminatorMatches: true,
             owner: 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL',
             expectedOwner: 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL' },
};
ok(sendIsEvidence(GOOD).evidence === true, 'a confirmed send with a correct read-back was not accepted');

const notEvidence = (patch, match, msg) => {
  const r = sendIsEvidence({ ...GOOD, ...patch });
  checks += 1;
  assert.equal(r.evidence, false, msg);
  checks += 1;
  assert.ok(r.problems.some(p => match.test(p)), `wrong problem reported: ${r.problems.join(' | ')}`);
};

notEvidence({ account: null }, /not read back/,
  'A SIGNATURE ALONE COUNTED AS EVIDENCE. It proves a transaction was accepted, not that the account exists.');
notEvidence({ account: { ...GOOD.account, exists: false } }, /does not exist after a confirmed/,
  'a confirmed transaction with no account at the address counted as evidence');
notEvidence({ account: { ...GOOD.account, dataLen: 0 } }, /holds no data/,
  'an account that exists but is empty counted as evidence');
notEvidence({ account: { ...GOOD.account, discriminatorMatches: false } }, /not the discriminator/,
  'an account holding a DIFFERENT type counted as evidence, which is how a wrong-address write hides');
notEvidence({ account: { ...GOOD.account, owner: '11111111111111111111111111111111' } }, /owned by/,
  'an account owned by the system program counted as evidence of a program write');
notEvidence({ confirmation: null }, /never confirmed/, 'an unconfirmed transaction counted as evidence');
notEvidence({ confirmation: { err: { InstructionError: [0, 'Custom'] } } }, /carries an error/,
  'a CONFIRMED-BUT-FAILED transaction counted as evidence - the most expensive one to miss');
notEvidence({ signature: null }, /no signature/, 'evidence was claimed with no signature at all');

console.log(`ok - nothing sends on mainnet, nothing sends unsimulated, and a signature is not a read-back (${checks} checks)`);
