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
const TIMEPIN = read('../onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs');

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

const CORE_VIEWS = [...CORE.matchAll(/struct (\w+)(?:View|AccountView) \{/g)]
  .map(match => match[1]);
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
assert.ok(!/CANDIDATE_SEED|CANDIDATE_DISCRIMINATOR|CANDIDATE_ACCOUNT_LEN/.test(CORE),
  'Core still carries CandidateV2 plumbing. Timepin inlined that observation ' +
  'into the Need; the account does not exist.');
checks += 1;
assert.ok(!/pub struct CandidateV2\b/.test(TIMEPIN),
  'Timepin has a CandidateV2 struct again. If the account came back, Core has ' +
  'to read it again and this file is enforcing the wrong shape.');

// --- 3. the seeds Core derives with must be the seeds Timepin uses ----------

for (const seed of ['need', 'evidence_spec']) {
  checks += 1;
  assert.match(CORE, new RegExp(`_SEED: &\\[u8\\] = b"${seed}"`),
    `Core no longer derives the ${seed} PDA with that seed`);
  checks += 1;
  assert.match(TIMEPIN, new RegExp(`_SEED: &\\[u8\\] = b"${seed}"`),
    `Timepin no longer uses the ${seed} seed, so Core derives the wrong address`);
}

console.log(
  `core reads what timepin writes: ${checks} checks passed (host tier; ` +
  `${ACCOUNTS.map(a => a.label).join(', ')})`,
);
