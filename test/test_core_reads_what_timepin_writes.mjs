// Core reads accounts that Timepin owns. Nothing checked that the two agree.
//
// On 2026-09-05 they did not, in two ways at once, and everything was green:
//
//   NEED_ACCOUNT_LEN was `8 + 124`. Timepin writes 8 + 268. decode_exact
//   requires an EQUAL length, so every Core instruction that loads a Need
//   failed on chain. 124 was not a wrong guess - it was the pre-inline Need,
//   field for field, from before Timepin moved the observation inside.
//
//   Core also loaded a CandidateV2 account. Timepin has no such struct and no
//   such seed. The account had been deleted deliberately, because every
//   replacement minted a new one at 1,564,251 lamports of unrecoverable rent.
//   Core demanded it on every settle and every void.
//
// WHY EVERY TEST PASSED: Core's own tests FABRICATE Timepin's accounts from
// Core's own struct definitions. The fixture and the reader are the same
// definition, so they agree perfectly and prove nothing about what the other
// program writes. A test that fabricates the other program's account cannot
// detect that the other program stopped writing it that way.
//
// This file asks the only question that can: does Core's view of each Timepin
// account match the struct in rcx-timepin-v2, field for field, byte for byte,
// and is there a Core view for an account Timepin does not have?
//
// Evidence tier: host. Reads Rust as text; compiles nothing.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const CORE = read('../onchain/ratchet-core-g2/programs/ratchet-core-g2/src/foreign_timepin.rs');
// BOTH Timepin files. This read lib.rs alone until 2026-09-05 17:4xZ, and
// CandidateV2 is declared in lifecycle.rs - so this test could not see the
// account it was asked about, reported it as deleted, and that false P0 is what
// sent Core's half of I1 down the wrong branch: the CandidateV2 reader was
// removed as dead, leaving Core to build settlement records from eleven inline
// fields that Timepin writes as zeros. Only the compiler stopped it.
//
// A test that reads one file and answers about a crate is not measuring the
// crate. The self-check below refuses to run if this corpus is not what it
// claims to be, because "I looked and found nothing" and "I could not look" must
// never produce the same verdict.
const TIMEPIN = read('../onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs')
  + '\n' + read('../onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lifecycle.rs');
for (const [what, needle] of [['lib.rs', 'pub struct TimepinNeedV2 {'], ['lifecycle.rs', 'pub struct CandidateV2 {']]) {
  assert.ok(TIMEPIN.includes(needle),
    `SELF-CHECK FAILED: the Timepin corpus does not contain ${needle} from ${what}. ` +
    'Every "Timepin does not define X" verdict below would be vacuous. Fix the paths before reading further.');
}

let checks = 0;
const eq = (actual, expected, message) => {
  checks += 1;
  assert.deepEqual(actual, expected, message);
};

// Borsh is positional and has no padding, so a field list IS the wire format.
// Only fixed-size types are accepted; anything else and this file refuses to
// guess rather than computing a number that looks like an answer.
const WIDTH = {
  u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8,
  u128: 16, i128: 16, Pubkey: 32, '[u8; 32]': 32, '[u8; 8]': 8,
};

const fieldsOf = (source, signature) => {
  const at = source.indexOf(signature);
  assert.ok(at >= 0, `${signature} is gone`);
  const end = source.indexOf('\n}', at);
  assert.ok(end > at, `cannot find the end of ${signature}`);
  checks += 1;
  return source.slice(at, end).split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('pub ') && line.includes(':'))
    .map(line => {
      const [name, ...rest] = line.replace(/^pub /, '').replace(/,$/, '').split(':');
      const type = rest.join(':').trim();
      assert.ok(WIDTH[type] !== undefined,
        `${signature} field ${name} has type ${type}, which this reader will ` +
        'not size. Add it to WIDTH deliberately - a parity check that guesses a ' +
        'width is worse than none.');
      return { name: name.trim(), type };
    });
};
const bytesOf = fields => fields.reduce((total, f) => total + WIDTH[f.type], 0);

// --- 1. every account Core reads, against the struct Timepin writes ---------

const ACCOUNTS = [
  {
    label: 'TimepinNeedV2',
    core: 'pub struct TimepinNeedV2View {',
    timepin: 'pub struct TimepinNeedV2 {',
    lenConst: 'NEED_ACCOUNT_LEN',
    discConst: 'NEED_DISCRIMINATOR',
  },
  {
    label: 'EvidenceSpecV2',
    core: 'pub struct EvidenceSpecV2View {',
    timepin: 'pub struct EvidenceSpecV2 {',
    lenConst: 'EVIDENCE_SPEC_ACCOUNT_LEN',
    discConst: 'EVIDENCE_SPEC_DISCRIMINATOR',
  },
];

for (const account of ACCOUNTS) {
  const coreFields = fieldsOf(CORE, account.core);
  const timepinFields = fieldsOf(TIMEPIN, account.timepin);

  // Field-for-field, IN ORDER, because borsh reads by position: a view with the
  // right fields in the wrong order decodes garbage and reports success.
  eq(coreFields, timepinFields,
    `Core's view of ${account.label} does not match the struct Timepin writes. ` +
    'Borsh is positional: this is not a naming quibble, it is what the bytes mean.');

  const payload = bytesOf(timepinFields);
  const declared = CORE.match(
    new RegExp(`pub const ${account.lenConst}: usize = 8 \\+ (\\d+);`),
  );
  checks += 1;
  assert.ok(declared, `${account.lenConst} is gone, or no longer written as 8 + N`);
  eq(Number(declared[1]), payload,
    `${account.lenConst} says the ${account.label} payload is ${declared[1]} ` +
    `bytes; the struct Timepin writes is ${payload}. decode_exact requires an ` +
    'EQUAL length, so every load of this account fails on chain.');

  // Anchor derives the discriminator from the account NAME. Core hardcodes the
  // bytes, so they are worth deriving rather than trusting.
  const expected = [...createHash('sha256')
    .update(`account:${account.label}`).digest().subarray(0, 8)];
  const literal = CORE.match(
    new RegExp(`const ${account.discConst}: \\[u8; 8\\] = \\[([^\\]]+)\\];`),
  );
  checks += 1;
  assert.ok(literal, `${account.discConst} is gone`);
  eq(literal[1].split(',').map(byte => Number(byte.trim())), expected,
    `${account.discConst} is not sha256("account:${account.label}")[..8]. Core ` +
    'would reject the account Timepin writes, or accept one it does not.');
}

// --- 2. Core must not read an account Timepin does not have -----------------
// This is the half the length check cannot see. CandidateV2 was deleted from
// Timepin and Core kept loading it: a second account, demanded on every settle,
// that a real Timepin never created. The length of a view for a struct that
// does not exist is not wrong - it is unanswerable.

// The suffix is stripped, not alternated. /(\w+)(?:View|AccountView)/ looks like
// it handles both spellings, but \w+ is greedy and \w matches every letter of
// "Account", so the second arm is unreachable: CandidateV2AccountView yielded
// the name "CandidateV2Account", which no crate has ever defined. That, with the
// single-file corpus above, is why a live account was reported as deleted.
const CORE_VIEWS = [...CORE.matchAll(/struct (\w+View) \{/g)]
  .map(match => match[1].replace(/(?:Account)?View$/, ''));
const ownedByTimepin = name =>
  new RegExp(`pub struct ${name} \\{`).test(TIMEPIN) ||
  // Views Core builds for its own use rather than decoding from an account.
  ['EvidenceRecordV2', 'TerminalTimepinV2'].includes(name);

const orphans = CORE_VIEWS.filter(name => !ownedByTimepin(name));
eq(orphans, [],
  'Core declares a view for a Timepin account that rcx-timepin-v2 does not ' +
  `define: ${orphans.join(', ')}. Either Timepin deleted the account and Core ` +
  'still demands it - which is what happened to CandidateV2 - or the name drifted. ' +
  'Both mean Core asks for an account no transaction can supply.');

checks += 1;
// INVERTED 2026-09-05 17:4xZ, and this assertion is the reason the inversion
// matters. It demanded that Core have NO CandidateV2 plumbing, on the premise
// that "Timepin inlined that observation into the Need; the account does not
// exist". BOTH HALVES OF THAT PREMISE ARE FALSE, and this file's own two bugs
// are what produced it: the corpus was lib.rs alone, and the view-name regex
// yielded "CandidateV2Account". Measured directly instead:
//   rcx-timepin-v2/src/lifecycle.rs:496  pub struct CandidateV2
//   rcx-timepin-v2/src/lifecycle.rs:513  CandidateV2::LEN = 111
//   rcx-timepin-v2/src/lifecycle.rs:23   CANDIDATE_SEED = b"candidate"
//   rcx-timepin-v2/src/lifecycle.rs:1298 price: message.price   <- the real observation
// The account is alive and it is the ONLY account carrying a real price. The
// eleven obs_ fields on the Need are written as zeros at lib.rs:189-199 and
// nowhere else, so a Core that reads them settles nothing: price_message_hash
// over zeros cannot equal the hash the Need commits to, and every settle_final
// reverts with WrongMessageHash.
//
// So Core MUST carry this plumbing, and the test now says so.
assert.ok(/CANDIDATE_SEED/.test(CORE) && /CANDIDATE_DISCRIMINATOR/.test(CORE)
  && /CANDIDATE_ACCOUNT_LEN/.test(CORE),
  'Core has no CandidateV2 plumbing. rcx-timepin-v2 still writes the observation '
  + 'into a CandidateV2 PDA (lifecycle.rs:1298) and writes zeros into the Need\'s '
  + 'obs_ fields (lib.rs:189-199), so a Core that does not load the Candidate has '
  + 'no price to settle with and every settle_final reverts with WrongMessageHash.');
checks += 1;
// The other half of the same inversion. This assertion said Timepin must NOT
// have a CandidateV2 struct, and its own failure message named the remedy: "If
// the account came back, Core has to read it again and this file is enforcing
// the wrong shape." The account never left. The file was enforcing the wrong
// shape from the moment it was written, and it said so itself.
assert.ok(/pub struct CandidateV2\b/.test(TIMEPIN),
  'Timepin has no CandidateV2 struct. It is the account that carries the real '
  + 'observation (lifecycle.rs price: message.price); if it is genuinely gone, '
  + 'then something must WRITE the Need\'s obs_ fields, and today nothing does - '
  + 'they are set to zero at open_need and never touched again.');

// --- 3. the seeds Core derives with must be the seeds Timepin uses ----------

for (const seed of ['need', 'evidence_spec']) {
  checks += 1;
  assert.match(CORE, new RegExp(`_SEED: &\\[u8\\] = b"${seed}"`),
    `Core no longer derives the ${seed} PDA with that seed`);
  checks += 1;
  assert.match(TIMEPIN, new RegExp(`_SEED: &\\[u8\\] = b"${seed}"`),
    `Timepin no longer uses the ${seed} seed, so Core derives the wrong address`);
}

// --- 4. the BROWSER CLIENT is a reader too, and it was stale in both ---------
// client-v2.mjs decodes these same accounts and its ACCOUNT_SIZE table said
// TimepinNeedV2: 132 - the same pre-inline number, in a third file - and
// HistoryPage 87..2_743, the growing Vec form M3 removed. Its own suite never
// called either decoder, so it passed before and after the fix. Asked
// BEHAVIOURALLY here: a decoder is worth more when it is run.

const CORE_STATE = read(
  '../onchain/ratchet-core-g2/programs/ratchet-core-g2/src/state.rs',
);
const client = await import('../onchain/ratchet-core-g2/client/client-v2.mjs');

const rustLen = (source, type) => {
  const found = source.match(
    new RegExp(`impl ${type} \\{[\\s\\S]{0,400}?pub const LEN: usize = ([^;]+);`),
  );
  assert.ok(found, `${type}::LEN is gone`);
  checks += 1;
  return found[1].split('+').reduce((total, term) => {
    const value = Number(term.trim());
    assert.ok(Number.isFinite(value), `${type}::LEN is not a sum of literals`);
    return total + value;
  }, 0);
};

eq(client.ACCOUNT_SIZE.TimepinNeedV2, 8 + rustLen(TIMEPIN, 'TimepinNeedV2'),
  'the client decodes a Need of the wrong size; r.done() asserts every byte is ' +
  'consumed, so it throws on every real Need');
eq(client.ACCOUNT_SIZE.EvidenceSpecV2, 8 + rustLen(TIMEPIN, 'EvidenceSpecV2'),
  'the client decodes an EvidenceSpec of the wrong size');
eq(client.ACCOUNT_SIZE.HistoryPage, 8 + rustLen(CORE_STATE, 'HistoryPage'),
  'the client decodes a HistoryPage of the wrong size');
checks += 1;
assert.ok(client.ACCOUNT_SIZE.HistoryPageMin === undefined
  && client.ACCOUNT_SIZE.HistoryPageMax === undefined,
  'the client still has a Min/Max HistoryPage size. After M3 there is one size, ' +
  'and a range is how a fixed account quietly starts growing again');

for (const [name, hex] of Object.entries(client.ACCOUNT_DISCRIMINATOR)) {
  const expected = createHash('sha256')
    .update(`account:${name}`).digest().subarray(0, 8).toString('hex');
  eq(hex, expected,
    `the client's ${name} discriminator is not sha256("account:${name}")[..8]`);
}

// AND RUN THE DECODERS, on buffers of exactly the length the programs write. A
// size constant that agrees with Rust while the decoder reads a different field
// list is the same defect one layer down: both decoders end in r.done(), which
// asserts every byte was consumed, so this catches a field list that is short or
// long even when the constant is right.
const web3 = await import('@solana/web3.js');
const { webcrypto } = await import('node:crypto');
const core = client.createCoreG2Client({
  web3,
  coreProgramId: new web3.PublicKey('cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN'),
  timepinProgramId: new web3.PublicKey('C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp'),
  cryptoImpl: webcrypto,
});

const blank = (name, size) => {
  const data = Buffer.alloc(size);
  Buffer.from(client.ACCOUNT_DISCRIMINATOR[name], 'hex').copy(data, 0);
  // schema is the first field of both, and both readers require it.
  data.writeUInt16LE(2, 8);
  return data;
};

checks += 1;
assert.doesNotThrow(
  () => core.decodeNeed(blank('TimepinNeedV2', client.ACCOUNT_SIZE.TimepinNeedV2)),
  'decodeNeed cannot read an account of the size Timepin writes. Its field ' +
  'list and its size constant disagree.');

// A ZERO BUFFER OF THE RIGHT LENGTH PROVES ONLY THE LENGTH. Two same-width
// fields swapped - obs_price i64 and obs_conf u64 - decode identically from
// zeros and the test stays green. That is the borsh hazard this whole file is
// about, so the buffer carries a DISTINCT value per field and every one is
// asserted at its own offset.
const needBytes = blank('TimepinNeedV2', client.ACCOUNT_SIZE.TimepinNeedV2);
let at = 8;
const put16 = value => { needBytes.writeUInt16LE(value, at); at += 2; };
const put8 = value => { needBytes.writeUInt8(value, at); at += 1; };
const put32i = value => { needBytes.writeInt32LE(value, at); at += 4; };
const put32u = value => { needBytes.writeUInt32LE(value, at); at += 4; };
const put64 = value => { needBytes.writeBigInt64LE(BigInt(value), at); at += 8; };
const put64u = value => { needBytes.writeBigUInt64LE(BigInt(value), at); at += 8; };
const fill = (byte, width) => { needBytes.fill(byte, at, at + width); at += width; };

put16(2);            // schema
put8(255);           // bump
put8(2);             // state = FINAL
fill(0x11, 32);      // evidenceSpecHash
put64(1_800);        // targetTs
put64(1_920);        // sourceDeadlineTs
put64(1_980);        // captureDeadlineTs
fill(0x22, 32);      // candidateAHash
fill(0x00, 32);      // candidateBHash
// The eleven obs_ fields used to be written here. They are not on the account:
// nothing in rcx-timepin-v2 ever wrote them, and they were removed rather than
// filled. The observation this fixture used to fake lives in the CandidateV2
// account, which has its own decoder and its own check above.
put32u(7);           // openRefs
fill(0x44, 32);      // rentPayer
checks += 1;
assert.equal(at, client.ACCOUNT_SIZE.TimepinNeedV2,
  `the fixture wrote ${at} bytes for a ${client.ACCOUNT_SIZE.TimepinNeedV2}-byte ` +
  'account, so this test would be asserting about the wrong offsets');

const decoded = core.decodeNeed(needBytes);
eq([
  decoded.schema, decoded.bump, decoded.state,
  decoded.targetTs, decoded.sourceDeadlineTs, decoded.captureDeadlineTs,
  decoded.openRefs,
], [
  2, 255, 2,
  1_800n, 1_920n, 1_980n,
  7,
], 'decodeNeed put a value in the wrong field. Borsh is positional: two ' +
   'same-width fields swapped decode without error and mean different things.');
// obsWorker was checked here. It is not a field of this account.
eq([...decoded.rentPayer.toBytes().slice(0, 2)], [0x44, 0x44],
  'rentPayer is not where the program writes it');
checks += 1;
assert.throws(
  () => core.decodeNeed(blank('TimepinNeedV2', client.ACCOUNT_SIZE.TimepinNeedV2 - 1)),
  'decodeNeed accepted a Need one byte short, so it is not checking the length ' +
  'it claims to');

checks += 1;
assert.doesNotThrow(
  () => core.decodeHistoryPage(blank('HistoryPage', client.ACCOUNT_SIZE.HistoryPage)),
  'decodeHistoryPage cannot read a page of the size the program writes');
checks += 1;
assert.throws(
  () => core.decodeHistoryPage(blank('HistoryPage', client.ACCOUNT_SIZE.HistoryPage + 1)),
  'decodeHistoryPage accepted a page one byte long. After M3 there is exactly ' +
  'one valid size and a decoder that tolerates others is how a fixed account ' +
  'starts growing again');

console.log(
  `core reads what timepin writes: ${checks} checks passed (host tier; ` +
  `${ACCOUNTS.map(a => a.label).join(', ')}, and the browser client)`,
);
