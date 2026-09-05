// The mirror has no mirror check. This is it.
//
// onchain/ratchet-core-g2/model.mjs is the executable mirror of the Core G2
// program: it is what the browser client encodes with, what test_core_g2_model
// checks 1,800 assertions against, and what anybody reasoning about the chain
// off-chain actually runs. It claims to mirror state.rs. NOTHING CHECKED THAT.
//
// The files that read state.rs and the files that import model.mjs were, until
// this one, disjoint sets. That is how model.mjs sat at HISTORY_PAGE_BASE_LEN =
// 79 with a Vec of rows for the whole time after M3 removed both from the
// program, with every model test green - the mirror and its tests agreed with
// each other and both disagreed with the chain.
//
// That is the fourth instance today of one shape: A CHECK THAT MEASURES A COPY
// OF THE FACT INSTEAD OF THE FACT. The other three were the gate row that
// reported GO on a crate that did not compile, a structural test that would
// have passed on a premise that had become vacuous, and a cost snapshot pricing
// a layout from JavaScript literals. Each was found by reading. This file is
// the attempt to stop finding them that way.
//
// Evidence tier: host. It reads Rust as text; it does not compile anything.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as model from '../onchain/ratchet-core-g2/model.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const CORE = read(
  '../onchain/ratchet-core-g2/programs/ratchet-core-g2/src/state.rs',
);
const TIMEPIN = read(
  '../onchain/rcx-timepin-v2/programs/rcx-timepin-v2/src/lib.rs',
);

let checks = 0;
const eq = (actual, expected, message) => {
  checks += 1;
  assert.strictEqual(actual, expected, message);
};

// --- reading a constant out of Rust ------------------------------------------
// Deliberately NOT a general expression evaluator. It accepts sums of products
// of decimal literals and Type::CONST / BARE_CONST references, resolves those
// recursively, and REFUSES anything else rather than guessing - a parity test
// that quietly mis-parses is worse than no parity test at all. Products are
// supported because the program genuinely uses one: WORK_PAGE_CAP is
// HISTORY_PAGE_CAP * WORK_KINDS_PER_SHOT.

const constExpr = (source, type, name) => {
  const found = source.match(new RegExp(
    `impl ${type} \\{[\\s\\S]{0,500}?pub const ${name}: usize = ([^;]+);`,
  ));
  assert.ok(found, `${type}::${name} is gone from the program source`);
  return found[1];
};

const bareConst = (source, name) => {
  const found = source.match(
    new RegExp(`pub const ${name}: usize = ([^;]+);`),
  );
  assert.ok(found, `${name} is gone from the program source`);
  return found[1];
};

const atom = (source, raw, depth) => {
  const term = raw.trim();
  if (/^[0-9_]+$/.test(term)) return Number(term.replace(/_/g, ''));
  const qualified = term.match(/^(\w+)::(\w+)$/);
  if (qualified) {
    return evaluate(
      source, constExpr(source, qualified[1], qualified[2]), depth + 1,
    );
  }
  const bare = term.match(/^(\w+)$/);
  if (bare) return evaluate(source, bareConst(source, bare[1]), depth + 1);
  return assert.fail(
    `cannot read constant term as a literal or a reference: ${term}`,
  );
};

const evaluate = (source, expression, depth = 0) => {
  assert.ok(depth < 8, `constant nests too deeply: ${expression}`);
  return expression.split('+').reduce((total, addend) => total + addend
    .split('*')
    .reduce((product, factor) => product * atom(source, factor, depth), 1), 0);
};

const rustImpl = (source, type, name) =>
  evaluate(source, constExpr(source, type, name));
const rustConst = (source, name) => evaluate(source, bareConst(source, name));

// Prove the reader works before trusting it, including the recursion and the
// refusal. A parser that silently returned 0 would make every check below pass.
eq(evaluate(CORE, '2 + 1 + 32'), 35, 'reader sums literals');
eq(evaluate(CORE, 'EconomyArgs::LEN'), 372, 'reader resolves a reference');
eq(evaluate(CORE, '2 + 1 + 32 + EconomyArgs::LEN'), 407,
  'reader sums literals and references together');
eq(evaluate(CORE, 'HISTORY_PAGE_CAP * WORK_KINDS_PER_SHOT'), 48,
  'reader multiplies two resolved references');
checks += 1;
assert.throws(() => evaluate(CORE, '128 - 4'),
  /cannot read constant term/,
  'reader REFUSES arithmetic it cannot do rather than guessing at it');
checks += 1;
assert.throws(() => evaluate(CORE, 'NoSuchConstant'),
  /is gone from the program source/,
  'reader refuses a constant that is not there rather than reading it as zero');

// --- 1. every mirrored size, and the discriminator rule for each -------------
// Some model constants name the PAYLOAD and some name the whole ACCOUNT, which
// includes Anchor's 8-byte discriminator. That is irregular and it is real, so
// it is written down per constant rather than assumed - a future cleanup that
// makes them consistent has to change this table on purpose.

const PAYLOAD = 0;
const ACCOUNT = 8;

const MIRRORED = [
  ['ECONOMY_CANONICAL_LEN', CORE, 'EconomyArgs', 'LEN', PAYLOAD],
  ['ECONOMY_ACCOUNT_LEN', CORE, 'Economy', 'LEN', ACCOUNT],
  ['RULESET_CANONICAL_LEN', CORE, 'RulesetArgs', 'LEN', PAYLOAD],
  ['RULESET_ACCOUNT_LEN', CORE, 'Ruleset', 'LEN', ACCOUNT],
  ['SHOT_RESULT_LEN', CORE, 'ShotResult', 'LEN', PAYLOAD],
  ['GAME_RESULT_FACTS_LEN', CORE, 'GameResultFacts', 'LEN', PAYLOAD],
  ['HISTORY_PAGE_LEN', CORE, 'HistoryPage', 'LEN', PAYLOAD],
  ['WORK_RECORD_LEN', CORE, 'WorkRecord', 'LEN', PAYLOAD],
  ['WORK_PAGE_BASE_LEN', CORE, 'WorkPage', 'BASE_LEN', PAYLOAD],
  ['RELOAD_RECORD_LEN', CORE, 'ReloadRecord', 'LEN', PAYLOAD],
  ['RELOAD_HISTORY_PAGE_BASE_LEN', CORE, 'ReloadHistoryPage', 'BASE_LEN', ACCOUNT],
  // Timepin is a different crate, and the model encodes its accounts too.
  ['TIMEPIN_EVIDENCE_SPEC_ACCOUNT_LEN', TIMEPIN, 'EvidenceSpecV2', 'LEN', ACCOUNT],
  ['TIMEPIN_NEED_ACCOUNT_LEN', TIMEPIN, 'TimepinNeedV2', 'LEN', ACCOUNT],
];

for (const [exported, source, type, name, offset] of MIRRORED) {
  const fromSource = rustImpl(source, type, name) + offset;
  eq(model[exported], fromSource,
    `${exported} is ${model[exported]} in model.mjs and ${fromSource} in the ` +
    `program (${type}::${name}${offset ? ' + 8 discriminator' : ''}). The model ` +
    'is the mirror; the program is the fact. Change the model.');
}

const BARE = [
  ['HISTORY_PAGE_CAP', CORE, 'HISTORY_PAGE_CAP'],
  ['WORK_KINDS_PER_SHOT', CORE, 'WORK_KINDS_PER_SHOT'],
  ['WORK_PAGE_CAP', CORE, 'WORK_PAGE_CAP'],
  ['RELOAD_HISTORY_PAGE_CAP', CORE, 'RELOAD_HISTORY_PAGE_CAP'],
];
for (const [exported, source, name] of BARE) {
  eq(model[exported], rustConst(source, name),
    `${exported} disagrees with the program's ${name}`);
}

// --- 2. M3 specifically: the page is fixed, and the model says so ------------

checks += 1;
assert.doesNotMatch(CORE, /pub slots: Vec<Option<ShotResult>>/,
  'the program stores history rows again; the model does not, and one of them ' +
  'is now wrong about what a HistoryPage is');
eq(model.HISTORY_PAGE_BASE_LEN, model.HISTORY_PAGE_LEN,
  'BASE_LEN must alias LEN while the program aliases them');
eq(model.HISTORY_PAGE_MAX_LEN, model.HISTORY_PAGE_LEN,
  'MAX_LEN must alias LEN while the program aliases them');
checks += 1;
assert.match(CORE, /pub const BASE_LEN: usize = Self::LEN;/,
  'the program stopped aliasing BASE_LEN to LEN, so the page can grow again');
checks += 1;
assert.match(CORE, /pub const MAX_LEN: usize = Self::LEN;/,
  'the program stopped aliasing MAX_LEN to LEN, so the page can grow again');

// The three fields that replaced the rows. If the program renames one, the
// model's encoder is silently writing a different account.
for (const field of ['pending_count: u8', 'terminal_mask: u16',
  'results_root: \\[u8; 32\\]']) {
  checks += 1;
  assert.match(CORE, new RegExp(`pub ${field}`),
    `HistoryPage.${field} is gone from the program; the model still writes it`);
}

// --- 3. the hash domains, which are the ones that CANNOT be off by a byte ----
// A wrong length fails loudly at the first decode. A wrong domain produces a
// perfectly well-formed hash that simply is not the chain's hash - every root,
// commitment and result the model computes would be quietly, unfixably wrong.
// Names differ between the two files on purpose (COMMITMENT_DOMAIN is
// COMMIT_HASH_DOMAIN in the model), so this compares the LITERALS as sets.

// Capture the readable part and stop at the escape, so the two sides are
// compared as the same text rather than as one file's spelling of a NUL. That
// every domain IS NUL-terminated on both sides is asserted separately below -
// it is the thing that stops one domain being a prefix of another.
const coreDomains = new Set(
  [...CORE.matchAll(/b"(rcx-core:[^"\\]*)\\0"/g)].map(match => match[1]),
);
const modelSource = read('../onchain/ratchet-core-g2/model.mjs');
const modelDomains = new Set(
  [...modelSource.matchAll(/'(rcx-core:[^'\\]*)\\0'/g)].map(match => match[1]),
);
// A domain captured without its terminator would silently drop out of both sets
// and be compared against nothing, so count the raw occurrences too.
checks += 1;
assert.equal(
  [...CORE.matchAll(/b"rcx-core:[^"]*"/g)].length, coreDomains.size,
  'a program domain is not NUL-terminated, or two share a name');

checks += 1;
assert.ok(coreDomains.size >= 15,
  `only ${coreDomains.size} rcx-core domains found in state.rs; the reader is ` +
  'probably broken rather than the program');

// Every domain the model DOES use must exist in the program, spelled
// identically. This is the direction that catches a typo, and a typo here is
// unfixable in the worst way: it produces a well-formed hash that is simply not
// the chain's.
const extraInModel = [...modelDomains].filter(d => !coreDomains.has(d));
checks += 1;
assert.deepEqual(extraInModel, [],
  'the model hashes with rcx-core domains the program does not have, so those ' +
  `hashes are values no on-chain account will ever match: ${extraInModel.join(', ')}`);

// The other direction is NOT a failure, because the model was never a complete
// reimplementation - it takes some hashes as opaque inputs rather than deriving
// them. But the list of things it cannot derive is a REAL LIMITATION of the
// mirror and belongs in writing, so it is frozen here: a NEW unimplemented
// domain fails, and implementing one of these fails too, which is the prompt to
// delete the line rather than to leave a stale caveat.
const NOT_MODELLED = [
  // The model accepts record.dayFinalHash as an input (model.mjs:1579) and
  // never derives it, so it cannot verify a DayFinal against the chain.
  'rcx-core:day-final:g2',
  // Rank shard membership IS modelled (rcx-core:rank-shard-for:g2), but the
  // shard and shard-set commitments are not, so ranking output is unverified.
  'rcx-core:rank-shard:g2',
  'rcx-core:rank-shards:g2',
  // Reload routing memos are not derived off-chain.
  'rcx-core:reload-route:g2',
];
const missingFromModel = [...coreDomains].filter(d => !modelDomains.has(d));
checks += 1;
assert.deepEqual(missingFromModel.slice().sort(), NOT_MODELLED.slice().sort(),
  'the set of program hashes the model cannot derive has changed. If a domain ' +
  'was ADDED to the program, the model is now blind to it and this file is how ' +
  'you found out. If one was IMPLEMENTED in the model, delete its line here ' +
  `rather than leaving a stale caveat. Now: ${missingFromModel.join(', ')}`);

// M3's two by name, because they are new and they are what makes an off-chain
// reader able to verify a results_root at all.
for (const domain of ['rcx-core:history-row:g2', 'rcx-core:history-chain:g2']) {
  checks += 1;
  assert.ok(coreDomains.has(domain), `${domain} is gone from the program`);
  checks += 1;
  assert.ok(modelDomains.has(domain), `${domain} is gone from the model`);
}

// --- 4. the schema version, which gates every account the model builds -------

const schema = CORE.match(/pub const CORE_SCHEMA_VERSION: u16 = (\d+);/);
checks += 1;
assert.ok(schema, 'CORE_SCHEMA_VERSION is gone from the program');
eq(model.CORE_G2_SCHEMA, Number(schema[1]),
  'the model builds accounts at a schema the program does not accept');

console.log(
  `model mirrors source: ${checks} checks passed (host tier; reads Rust as text)`,
);
