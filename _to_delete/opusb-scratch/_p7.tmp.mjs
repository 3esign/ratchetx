// The pair that is actually on chain: ratchet-core-g2 reading rcx-timepin-v2.
//
// Core is a FOREIGN reader. It does not depend on the timepin crate; it
// re-declares the account lengths, discriminators and seeds in
// foreign_timepin.rs and decodes raw bytes. That file says so in its own header
// (lines 11-17): "Nothing at compile time can catch that across two crates, so
// it is policed by test/test_client_model_parity.mjs".
//
// It is not. That suite reads ADAPTER_ constants and nothing else -- one u8 per
// name. Not one length. And Core's own unit tests cannot see the drift either,
// because they FABRICATE the foreign account with
// `encode(&NEED_DISCRIMINATOR, &need, NEED_ACCOUNT_LEN)`: they build the bytes
// to Core's own constant and then agree with themselves. A test that
// manufactures the thing it is authenticating proves the decoder is
// self-consistent, never that it can read what the other program writes.
//
// So the two crates could disagree about the size of an account and every
// compile, every host suite and every gate row would stay green while no shot
// on chain could be sealed or settled. That is what this file exists to stop.
// It reads the numbers out of both crates and compares them to each other.
//
// It is deliberately NOT a copy of the numbers. Nothing here is written down
// twice: every value is parsed from the source that owns it, so the pin cannot
// go stale the way a hand-copied constant does.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const CORE = new URL('../_to_delete/opusb-scratch/coresrc/', import.meta.url);
const TP = new URL('../onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/', import.meta.url);
const read = (base, f) => fs.readFileSync(new URL(f, base), 'utf8');

const foreign = read(CORE, 'foreign_timepin.rs');
const tpLib = read(TP, 'lib.rs');
const tpLife = read(TP, 'lifecycle.rs');
const tpAll = tpLib + '\n' + tpLife;

let checks = 0;
const ok = (cond, msg) => { checks += 1; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };

// --- 1. how strict is the decoder, measured rather than assumed --------------
// Everything below depends on decode_exact requiring an EQUAL length. If that
// ever becomes a minimum -- a documented prefix read, which is a legitimate
// design -- these assertions must be rewritten on purpose, not silently
// satisfied. So the strictness itself is pinned first.
const decodeExact = /fn decode_exact[\s\S]*?\n}/.exec(foreign);
ok(decodeExact, 'foreign_timepin.rs must still have decode_exact - it is the only door into a foreign account');
const body = decodeExact[0];
const equalLength = /data\.len\(\)\s*==\s*expected_len/.test(body);
const drainsPayload = /payload\.is_empty\(\)/.test(body);
ok(equalLength,
  'decode_exact no longer requires data.len() == expected_len. If Core now reads a PREFIX of a foreign '
  + 'account, that is a real design change and this suite must be rewritten to match it - do not delete it');
ok(drainsPayload,
  'decode_exact no longer requires payload.is_empty(). Without it a longer account would deserialize its '
  + 'first fields and the trailing bytes would be ignored in silence');

// --- 2. every foreign length equals the owning struct's LEN + 8 --------------
// Anchor allocates 8 discriminator bytes + LEN. Core declares 8 + N. So N must
// be the timepin crate's own LEN for that account, to the byte.
const PAIRS = [
  ['NEED_ACCOUNT_LEN', 'TimepinNeedV2', 'the Need is what carries the price into settlement'],
  ['EVIDENCE_SPEC_ACCOUNT_LEN', 'EvidenceSpecV2', 'the spec is what a Need is authenticated against'],
  ['CANDIDATE_ACCOUNT_LEN', 'CandidateV2', 'the candidate is the signed observation under adapter 1'],
];

const foreignLen = (name) => {
  const m = new RegExp(`pub const ${name}\\s*:\\s*usize\\s*=\\s*([0-9+\\s]+?);`).exec(foreign);
  if (!m) return null;
  const sum = m[1].split('+').map(s => Number(s.trim()));
  ok(sum.every(Number.isFinite), `${name} must be a plain integer sum`);
  return { total: sum.reduce((a, b) => a + b, 0), text: m[1].trim() };
};

const structLen = (name) => {
  const m = new RegExp(`impl ${name}\\s*\\{[\\s\\S]*?pub const LEN\\s*:\\s*usize\\s*=\\s*(\\d+)\\s*;`).exec(tpAll);
  return m ? Number(m[1]) : null;
};

const drift = [];
for (const [constName, structName, why] of PAIRS) {
  const f = foreignLen(constName);
  const s = structLen(structName);
  ok(f, `foreign_timepin.rs must declare ${constName}`);
  ok(s !== null, `the timepin crate must declare impl ${structName} { pub const LEN }`);
  if (f.total !== s + 8) drift.push(`${constName} = ${f.text} = ${f.total}, but ${structName}::LEN + 8 = ${s + 8} (${why})`);
  eq(f.total, s + 8,
    `CROSS-CRATE ABI DRIFT: Core reads ${constName} = ${f.total} bytes, rcx-timepin-v2 writes `
    + `8 + ${structName}::LEN = ${s + 8}. decode_exact requires an EQUAL length, so every Core instruction `
    + `that loads this account fails with BadTimepinLength on chain. Both crates compile. Both host suites `
    + `pass. No shot can be sealed or settled. ${why}.`);
}

// --- 3. the View must be a genuine prefix of the account -----------------------
// Even at the right length, Core's local mirror of the struct has to agree
// field-for-field with the real one in order, or the same bytes decode to
// different values. A prefix is allowed by this check (it is the shape Core may
// legitimately want); a REORDER or a RENAME is not.
const fieldsOf = (src, name) => {
  const m = new RegExp(`pub struct ${name}(?:<[^>]*>)?\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src);
  if (!m) return null;
  return [...m[1].matchAll(/^\s*pub\s+([a-z_0-9]+)\s*:/gm)].map(x => x[1]);
};
const view = fieldsOf(foreign, 'TimepinNeedV2View');
const real = fieldsOf(tpLib, 'TimepinNeedV2');
ok(view && view.length, 'foreign_timepin.rs must declare TimepinNeedV2View');
ok(real && real.length, 'the timepin crate must declare TimepinNeedV2');
ok(view.length <= real.length,
  `TimepinNeedV2View has ${view.length} fields but TimepinNeedV2 has ${real.length} - Core cannot read more than exists`);
for (let i = 0; i < Math.min(view.length, real.length); i += 1) {
  eq(view[i], real[i],
    `field ${i} of TimepinNeedV2View is "${view[i]}" but field ${i} of the real TimepinNeedV2 is "${real[i]}". `
    + 'Borsh is positional: a reorder or a rename decodes one program\'s bytes into another program\'s meaning '
    + 'with no error anywhere.');
}

// --- 4. what Core is blind to, stated rather than assumed --------------------
// Not a failure by itself: Core may deliberately stop at candidate_b_hash. But
// under adapter 2 the observation lives INSIDE the Need, so a View that stops
// short cannot see the price it is settling on. Whoever widens or narrows this
// should have to read the list.
const unseen = real.slice(view.length);
if (unseen.length) {
  console.log(`  NOTE: Core's view stops after ${view.length} of ${real.length} fields. Not read by Core: `
    + `${unseen.join(', ')}. Under ADAPTER_PYTH_MIN_CAPTURE_V2 the observation is inline in the Need, so `
    + 'check on purpose that nothing in that list is load-bearing for settlement.');
}

// --- 5. the seeds and discriminators, same argument -------------------------
for (const seed of ['need', 'evidence_spec', 'candidate']) {
  const inCore = new RegExp(`"|b"${seed}"`).test(foreign) && foreign.includes(`b"${seed}"`);
  const inTp = tpAll.includes(`b"${seed}"`);
  ok(inCore && inTp, `both crates must derive the ${seed} PDA from b"${seed}" - a seed drift is a silently wrong PDA`);
}

// --- 6. the discriminators, DERIVED rather than trusted -----------------------
// Anchor's account discriminator is sha256("account:" + StructName)[0..8]. Core
// hardcodes all three as byte arrays, so a RENAME in the timepin crate silently
// invalidates them: Core would keep looking for bytes no account ever carries
// again and every load would fail with BadTimepinDiscriminator - or, worse, a
// name reused elsewhere would make it read the wrong account type at the right
// length. Nothing derives these anywhere. This does.
const anchorDiscriminator = (name) =>
  [...crypto.createHash('sha256').update(`account:${name}`).digest().subarray(0, 8)];

for (const [constName, structName] of [
  ['NEED_DISCRIMINATOR', 'TimepinNeedV2'],
  ['EVIDENCE_SPEC_DISCRIMINATOR', 'EvidenceSpecV2'],
  ['CANDIDATE_DISCRIMINATOR', 'CandidateV2'],
]) {
  const m = new RegExp(`const ${constName}\\s*:\\s*\\[u8;\\s*8\\]\\s*=\\s*\\[([^\\]]*)\\]`).exec(foreign);
  ok(m, `foreign_timepin.rs must declare ${constName}`);
  const have = m[1].split(',').map(x => Number(x.trim())).filter(x => Number.isFinite(x));
  eq(have.length, 8, `${constName} must be exactly 8 bytes`);
  // The struct must still be an Anchor account in the timepin crate, or the
  // derivation below is comparing against a name that no longer means anything.
  ok(new RegExp(`#\\[account\\][\\s\\S]{0,400}?pub struct ${structName}\\b`).test(tpAll)
     || new RegExp(`pub struct ${structName}\\b`).test(tpAll),
     `${structName} must still exist in the timepin crate`);
  const want = anchorDiscriminator(structName);
  eq(have.join(','), want.join(','),
    `${constName} in foreign_timepin.rs is [${have.map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}] `
    + `but Anchor derives sha256("account:${structName}")[0..8] = `
    + `[${want.map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]. Core is looking for a discriminator `
    + 'no account carries. Every load of this account type fails with BadTimepinDiscriminator on chain, and no '
    + 'compile and no host suite in either crate can see it.');
}

// --- 7. the two spec validators must agree, not merely coexist ---------------
// Both programs validate the SAME EvidenceSpec: Timepin at registration
// (lib.rs validate_spec), Core when it authenticates the account
// (foreign_timepin.rs validate_spec_shape). Nothing links them. Measured
// 2026-09-05 at exact-SBF tier, they DISAGREED, and the disagreement was not a
// wrong value - it was unsatisfiable: for ADAPTER_PYTH_MIN_CAPTURE_V2, Timepin
// requires max_pre_target_gap_seconds == 0 and Core required it > 0. No spec
// existed that both would accept, so no economy could be registered on the
// mainnet-class adapter at all, and Core's own MIN-CAPTURE branch was
// unreachable code. Program log, RegisterRuleset:
//   AnchorError ... foreign_timepin.rs:606. Error Code: BadEvidenceSpec (6037)
// These four checks are the shape of that agreement, not its exact spelling.
const shape = /fn validate_spec_shape[\s\S]*?\n}/.exec(foreign);
ok(shape, 'foreign_timepin.rs must still have validate_spec_shape - it is what gates every foreign spec');
const shapeBody = shape[0];
const tpSpec = /pub fn validate_spec[\s\S]*?\n}/.exec(tpLib);
ok(tpSpec, 'the timepin crate must still have validate_spec');
const tpBody = tpSpec[0];

ok(!/spec\.adapter\s*==\s*1\b/.test(shapeBody),
  'Core\'s validate_spec_shape hardcodes `spec.adapter == 1`. Timepin accepts ADAPTER_PYTH_PUSH_V2 and '
  + 'ADAPTER_PYTH_MIN_CAPTURE_V2 (lib.rs validate_spec), so Core refuses every mainnet-class spec and its own '
  + 'MIN-CAPTURE branch can never be reached. Name the adapters instead of the literal.');
ok(shapeBody.includes('ADAPTER_PYTH_MIN_CAPTURE_V2'),
  'Core\'s validate_spec_shape never mentions ADAPTER_PYTH_MIN_CAPTURE_V2, so it cannot be applying the '
  + 'adapter-dependent rules Timepin applies. The two validators must agree about which specs exist.');

// The pre-gap rule is adapter-dependent in Timepin. If Core states it
// unconditionally in either direction, one adapter is refused.
const tpPinsPreGap = /max_pre_target_gap_seconds\s*==\s*0/.test(tpBody);
ok(tpPinsPreGap,
  'the timepin crate no longer pins max_pre_target_gap_seconds to zero for adapter 2 - if that rule moved, '
  + 'this section and Core\'s mirror of it must move with it');
ok(/max_pre_target_gap_seconds\s*==\s*0/.test(shapeBody),
  'Timepin pins max_pre_target_gap_seconds to ZERO under ADAPTER_PYTH_MIN_CAPTURE_V2 but Core\'s '
  + 'validate_spec_shape never tests for zero. Core therefore rejects every spec Timepin accepts on the '
  + 'mainnet-class adapter. The two rules must be the same rule.');

// R2 lives in Timepin. Core authenticates the same spec and must not accept one
// Timepin would have refused.
const tpHasLagGrid = /max_post_target_lag_seconds\s*<\s*args\.target_grid_seconds/.test(tpBody);
if (tpHasLagGrid) {
  ok(/max_post_target_lag_seconds\s*<\s*spec\.target_grid_seconds/.test(shapeBody),
    'R2 enforces lag < grid in Timepin (validate_spec) but Core\'s validate_spec_shape accepts any lag. A spec '
    + 'Timepin would refuse can still be authenticated by Core, which is the same class of disagreement as the '
    + 'pre-gap one: one print settling two targets in one program and not the other.');
}

// --- 8. close the triangle: the JS model is a third opinion ------------------
// model.mjs is the executable mirror the clients and most of the JS suites run
// against. It declares the same three account lengths a THIRD time.
// test_model_mirrors_source.mjs (Opus C, 7568cb3) compares the model to the
// TIMEPIN crate. Nothing compared it to CORE, and nothing compared Core to
// Timepin until this file. Measured 2026-09-05: model 276, Timepin 276, Core
// 132. Two of the three agreed and the one that runs on chain did not.
const model = fs.readFileSync(new URL('../onchain/ratchet-core-g2/model.mjs', import.meta.url), 'utf8');
const modelLen = (name) => {
  const m = new RegExp(`export const ${name}\\s*=\\s*(\\d+)\\s*;`).exec(model);
  return m ? Number(m[1]) : null;
};
for (const [modelName, coreName] of [
  ['TIMEPIN_NEED_ACCOUNT_LEN', 'NEED_ACCOUNT_LEN'],
  ['TIMEPIN_EVIDENCE_SPEC_ACCOUNT_LEN', 'EVIDENCE_SPEC_ACCOUNT_LEN'],
  ['TIMEPIN_CANDIDATE_ACCOUNT_LEN', 'CANDIDATE_ACCOUNT_LEN'],
]) {
  const inModel = modelLen(modelName);
  const inCore = foreignLen(coreName);
  ok(inModel !== null, `model.mjs must declare ${modelName}`);
  ok(inCore, `foreign_timepin.rs must declare ${coreName}`);
  eq(inModel, inCore.total,
    `${modelName} is ${inModel} in model.mjs but ${coreName} is ${inCore.total} in foreign_timepin.rs. `
    + 'These describe the same account. The model is what clients and the JS suites decode with; the Rust is '
    + 'what runs on chain. When they disagree the model stays green and the transaction fails.');
}

// --- 9. the manifest must be registrable by BOTH programs -------------------
// test_client_model_parity.mjs already validates releases/g2-mainnet-economy.json
// against the model's validateEvidenceSpec, and says in its own message that "a
// spec that cannot register is an economy that cannot exist". It is green. But
// the model mirrors the TIMEPIN crate, and registering an economy needs CORE to
// accept the same spec. Measured 2026-09-05: the manifest is adapter 2 with
// maxPreTargetGapSeconds 0 - exactly the pair Core refused with BadEvidenceSpec
// (6037) on a real RegisterRuleset. One validator's approval is not the answer.
const manifest = JSON.parse(
  fs.readFileSync(new URL('../releases/g2-mainnet-economy.json', import.meta.url), 'utf8'));
const tmpl = manifest.evidenceSpecTemplate || {};
const proposed = (v) => (v && typeof v === 'object' && 'proposed' in v ? v.proposed : v);
const manifestAdapter = proposed(tmpl.adapter);
const manifestPreGap = proposed(tmpl.maxPreTargetGapSeconds);
if (manifestAdapter !== undefined && shape) {
  const adapterConst = new RegExp(`pub const (ADAPTER_[A-Z0-9_]+)\\s*:\\s*u8\\s*=\\s*${manifestAdapter}\\s*;`)
    .exec(foreign);
  ok(adapterConst,
    `releases/g2-mainnet-economy.json asks for adapter ${manifestAdapter} and foreign_timepin.rs declares no `
    + 'constant with that value. Core cannot name the adapter the manifest selects.');
  ok(shapeBody.includes(adapterConst[1]) || /spec\.adapter/.test(shapeBody) === false,
    `the manifest selects ${adapterConst[1]} (= ${manifestAdapter}) but Core's validate_spec_shape never `
    + `mentions it. Approving this manifest changes a status field and nothing else: RegisterRuleset fails `
    + `with BadEvidenceSpec before an economy exists.`);
  if (manifestAdapter === 2) {
    eq(manifestPreGap, 0,
      'the manifest selects the MIN-CAPTURE adapter, and rcx-timepin-v2 requires '
      + 'max_pre_target_gap_seconds == 0 for it. The manifest says ' + manifestPreGap + '.');
  }
}

if (drift.length) console.log('  DRIFT: ' + drift.join(' | '));
console.log(`PASS  foreign timepin ABI: ${checks} checks - every account length, the field order of the `
  + 'Need view, the three seeds, all three discriminators and the two spec validators are compared ACROSS the two crates. The lengths '
  + 'and seeds are parsed from the source that owns them and the discriminators are DERIVED from the struct '
  + 'names, so nothing here is a copy that can go stale');
