// Two programs, one rule about which specs may exist. Nothing compared them.
//
// The evidence-spec rule lives in THREE places that must agree, and until
// 2026-09-05 two of them did not:
//
//   rcx-timepin-v2/src/lib.rs      validate_spec        - registers the spec
//   ratchet-core-g2/foreign_timepin.rs validate_spec_shape - accepts it into a ruleset
//   ratchet-core-g2/model.mjs      encodeTimepinEvidencePolicy - the off-chain mirror
//
// Timepin said adapter 1 OR 2, with the pre-gap pinned to zero for MIN-CAPTURE
// and positive for the strict bracket. The model said the same and its comment
// even claimed to mirror Core. CORE'S GATE SAID `adapter == 1` AND
// `max_pre_target_gap_seconds > 0`, both unconditional - so no MIN-CAPTURE spec
// could ever be registered into a ruleset, and the MIN-CAPTURE branch of Core's
// own validate_record_against_spec was unreachable code with a comment asserting
// a pin the same file forbade.
//
// The manifest uses adapter 2. So the economy Semir is being asked to approve
// could not have been registered, and register_economy is content-addressed and
// permanent: the failure would have landed on the first transaction after a
// build, an ELF lock and a vector re-pin.
//
// This file is the comparison. It asks the same question of both crates and the
// mirror, as text, because the rule is a fact that lives in three files and a
// check that reads one of them is a check that measures a copy.
//
// Evidence tier: host. Reads Rust and JS as text; compiles nothing.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const CORE = read('../onchain/ratchet-core-g2/programs/ratchet-core-g2/src/foreign_timepin.rs');
const TIMEPIN_SPEC = read('../onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs');
const TIMEPIN_DECIDE = read('../onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lifecycle.rs');
const MODEL = read('../onchain/ratchet-core-g2/model.mjs');

let checks = 0;
const has = (source, pattern, message) => {
  checks += 1;
  assert.match(source, pattern, message);
};
const hasNot = (source, pattern, message) => {
  checks += 1;
  assert.doesNotMatch(source, pattern, message);
};

// Slice a function body by its own closing brace at column 0, never by a
// character window - a fixed window is how a structural test ends up asserting
// about the NEXT function, which has happened in this repository already.
const body = (source, signature) => {
  const at = source.indexOf(signature);
  assert.ok(at >= 0, `${signature} is gone`);
  const close = source.indexOf('\n}\n', at);
  assert.ok(close > at, `cannot find the end of ${signature}`);
  checks += 1;
  return source.slice(at, close);
};

// --- 1. the two adapter numbers, identical in both crates --------------------
// If these ever drift, every branch below silently changes meaning.

const adapterConst = (source, name) => {
  const found = source.match(new RegExp(`pub const ${name}: u8 = (\\d+);`));
  assert.ok(found, `${name} is gone`);
  checks += 1;
  return Number(found[1]);
};
const CORE_PUSH = adapterConst(CORE, 'ADAPTER_PYTH_PUSH_V2');
const CORE_MIN = adapterConst(CORE, 'ADAPTER_PYTH_MIN_CAPTURE_V2');
const TIMEPIN_PUSH = adapterConst(TIMEPIN_SPEC, 'ADAPTER_PYTH_PUSH_V2');
const TIMEPIN_MIN = adapterConst(TIMEPIN_SPEC, 'ADAPTER_PYTH_MIN_CAPTURE_V2');

checks += 1;
assert.equal(CORE_PUSH, TIMEPIN_PUSH,
  `strict-bracket adapter is ${CORE_PUSH} in Core and ${TIMEPIN_PUSH} in Timepin`);
checks += 1;
assert.equal(CORE_MIN, TIMEPIN_MIN,
  `MIN-CAPTURE adapter is ${CORE_MIN} in Core and ${TIMEPIN_MIN} in Timepin`);
checks += 1;
assert.notEqual(CORE_PUSH, CORE_MIN,
  'the two adapters are the same number, so every branch on them is unconditional');
checks += 1;
assert.deepEqual([CORE_PUSH, CORE_MIN], [1, 2],
  'the adapter numbering moved. It is baked into canonical_policy_bytes and ' +
  'therefore into every spec hash ever computed.');

// --- 2. BOTH registration gates admit BOTH adapters -------------------------

const coreGate = body(CORE, 'fn validate_spec_shape');
has(coreGate, /spec\.adapter == ADAPTER_PYTH_PUSH_V2\s*\n?\s*\|\|\s*spec\.adapter == ADAPTER_PYTH_MIN_CAPTURE_V2/,
  'Core\'s validate_spec_shape does not admit BOTH adapters. If it pins one, ' +
  'the other branch of validate_record_against_spec is unreachable and a ' +
  'ruleset ' +
  'carrying that adapter dies at register_ruleset with BadEvidenceSpec.');
// Asked of CODE only. The comment above that line quotes the old literal on
// purpose, so that a reader knows what it used to say - and a check that cannot
// tell code from the comment explaining it is a check that will be deleted.
const stripComments = source => source.split('\n')
  .filter(line => !line.trim().startsWith('//')).join('\n');
hasNot(stripComments(coreGate), /spec\.adapter == 1\b/,
  'Core\'s gate compares the adapter to a bare 1 again. Use the named constant: ' +
  'a literal here is what made MIN-CAPTURE unregistrable while the same file ' +
  'implemented it.');

const timepinGate = body(TIMEPIN_SPEC, 'pub fn validate_spec');
has(timepinGate, /args\.adapter == ADAPTER_PYTH_PUSH_V2 \|\| args\.adapter == ADAPTER_PYTH_MIN_CAPTURE_V2/,
  'Timepin\'s validate_spec no longer admits both adapters');

// --- 3. the pre-gap is pinned in OPPOSITE directions, in both crates --------
// This is the field the two adapters disagree about, and the one Core had
// pinned unconditionally in the strict-bracket direction.

has(coreGate, /ADAPTER_PYTH_MIN_CAPTURE_V2[\s\S]{0,200}?max_pre_target_gap_seconds == 0/,
  'Core\'s gate does not pin the pre-gap to ZERO for MIN-CAPTURE. Under that ' +
  'adapter prev_publish_time is not in the predicate, so a non-zero bound is a ' +
  'dead number inside every spec hash.');
has(coreGate, /max_pre_target_gap_seconds > 0/,
  'Core\'s gate no longer requires a POSITIVE pre-gap for the strict bracket, ' +
  'where it is load-bearing');
has(timepinGate, /ADAPTER_PYTH_MIN_CAPTURE_V2[\s\S]{0,300}?max_pre_target_gap_seconds == 0/,
  'Timepin\'s validate_spec no longer pins the pre-gap to zero for MIN-CAPTURE');
has(timepinGate, /max_pre_target_gap_seconds > 0/,
  'Timepin\'s validate_spec no longer requires a positive pre-gap for adapter 1');

// --- 4. the SETTLEMENT predicate agrees, which is the thing that must not ----
//        differ by a byte: a shot that settles in one and voids in the other.

const corePredicate = body(CORE, 'pub fn validate_record_against_spec');
const timepinPredicate = TIMEPIN_DECIDE.slice(
  TIMEPIN_DECIDE.indexOf('fn validate_decision_fields'),
  TIMEPIN_DECIDE.indexOf('fn validate_decision_fields') + 2000,
);
checks += 1;
assert.ok(TIMEPIN_DECIDE.includes('fn validate_decision_fields'),
  'Timepin\'s validate_decision_fields is gone');

for (const [label, source] of [['Core', corePredicate], ['Timepin', timepinPredicate]]) {
  checks += 1;
  assert.match(source, /if spec\.adapter == ADAPTER_PYTH_MIN_CAPTURE_V2/,
    `${label}'s settlement predicate does not branch on MIN-CAPTURE (Core: validate_record_against_spec, Timepin: validate_decision_fields)`);
  checks += 1;
  assert.match(source, /publish_time >= (?:target_ts|need\.target_ts)/,
    `${label}'s MIN-CAPTURE branch is not "the earliest print at or after the target"`);
  checks += 1;
  assert.match(source, /prev_publish_time < (?:target_ts|need\.target_ts)/,
    `${label}'s strict-bracket branch no longer requires prev < target`);
}

// The MIN-CAPTURE branch must not consult prev_publish_time. If it does, the two
// programs are computing different predicates from the same signed message.
const minCaptureBranch = source => {
  const at = source.indexOf('ADAPTER_PYTH_MIN_CAPTURE_V2 {');
  assert.ok(at >= 0, 'no MIN-CAPTURE branch');
  const end = source.indexOf('} else {', at);
  assert.ok(end > at, 'MIN-CAPTURE branch has no else');
  checks += 1;
  // Comments explain WHY prev_publish_time is absent; strip them before asking.
  return source.slice(at, end).split('\n')
    .filter(line => !line.trim().startsWith('//')).join('\n');
};
for (const [label, source] of [['Core', corePredicate], ['Timepin', timepinPredicate]]) {
  checks += 1;
  assert.doesNotMatch(minCaptureBranch(source), /prev_publish_time/,
    `${label}'s MIN-CAPTURE branch reads prev_publish_time. It is not part of ` +
    'that predicate, and the pre-gap is pinned to zero precisely because it is not.');
}

// --- 5. the off-chain mirrors agree with both -------------------------------

has(MODEL, /adapter !== 1 && adapter !== 2/,
  'model.mjs no longer accepts exactly the two adapters the programs accept');

// --- 6. the BROWSER CLIENT, exercised rather than read ----------------------
// This one is JavaScript, so it can be asked the question directly instead of
// having its source pattern-matched - and a guard that is RUN is worth more
// than a guard that is grepped. It had the same two defects as Core's gate:
// `adapter !== 1`, and `!preGap` which rejects the zero MIN-CAPTURE requires.
// Measured before the fix: the manifest's own spec threw 'EvidenceSpec oracle
// identity mismatch'. The client players load could not read the economy the
// programs are being frozen for.

const { createHash, webcrypto } = await import('node:crypto');
const web3 = await import('@solana/web3.js');
const { PublicKey } = web3;
const client = await import('../onchain/ratchet-core-g2/client/client-v2.mjs');

const digest = label => createHash('sha256').update(label).digest();
const core = client.createCoreG2Client({
  web3,
  coreProgramId: new PublicKey('ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL'),
  timepinProgramId: new PublicKey('C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp'),
  cryptoImpl: webcrypto,
});

checks += 1;
assert.equal(client.ADAPTER_PYTH_PUSH_V2, CORE_PUSH,
  'the client\'s strict-bracket adapter disagrees with the programs');
checks += 1;
assert.equal(client.ADAPTER_PYTH_MIN_CAPTURE_V2, CORE_MIN,
  'the client\'s MIN-CAPTURE adapter disagrees with the programs');

const specArgs = (adapter, preGap) => ({
  schema: 2,
  adapter,
  receiverProgram: new PublicKey(client.PYTH_RECEIVER_PROGRAM).toBuffer(),
  pushOracleProgram: new PublicKey(client.PYTH_PUSH_ORACLE_PROGRAM).toBuffer(),
  shardId: 0,
  feedId: digest('feed'),
  requiredVerification: 1,
  targetGridSeconds: 60,
  minOpenLeadSeconds: 30,
  maxTargetAheadSeconds: 7_200,
  maxPreTargetGapSeconds: preGap,
  maxPostTargetLagSeconds: 59,
  captureGraceSeconds: 10,
  maxFutureSkewSeconds: 5,
  minExponent: -12,
  maxExponent: 2,
  maxConfidenceBps: 1_000,
  receiverProgramdataSlot: 5n,
  receiverConfigHash: digest('receiver'),
  wormholeProgram: new PublicKey(digest('wormhole')).toBuffer(),
  wormholeProgramdataSlot: 6n,
  registeredSlot: 9n,
});
const accepts = (adapter, preGap) => {
  try {
    core.validateEvidenceSpecShape(specArgs(adapter, preGap), 9n);
    return true;
  } catch { return false; }
};

checks += 1;
assert.ok(accepts(CORE_MIN, 0),
  'THE CLIENT REFUSES THE MANIFEST\'S OWN SPEC. adapter 2 with a zero pre-gap ' +
  'is what releases/g2-mainnet-economy.json carries and what Timepin and Core ' +
  'both require; a client that cannot read it cannot play the game.');
checks += 1;
assert.ok(accepts(CORE_PUSH, 120),
  'the client refuses a valid strict-bracket spec');
checks += 1;
assert.ok(!accepts(CORE_MIN, 120),
  'the client accepts MIN-CAPTURE carrying a non-zero pre-gap, which both ' +
  'programs refuse - a dead number inside every spec hash');
checks += 1;
assert.ok(!accepts(CORE_PUSH, 0),
  'the client accepts the strict bracket with no pre-gap bound, which both ' +
  'programs refuse - there the bound is load-bearing');
checks += 1;
assert.ok(!accepts(3, 0) && !accepts(3, 120),
  'the client admits a third adapter neither program knows');

console.log(
  `core and timepin agree on a spec: ${checks} checks passed ` +
  `(host tier; adapters ${CORE_PUSH}=strict-bracket, ${CORE_MIN}=MIN-CAPTURE)`,
);
