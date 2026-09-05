#!/usr/bin/env node
// Every account a planned instruction declares has a stated source, and no
// source names an account the instruction does not take.
//
// This is the layer where an account-name mistake lives, and the symptom of one
// is a validator saying "account index 7" - a number nobody outside the program
// can map back to a name. The sources are data so that this test can compare
// them to what the program declares, in both directions, for every action the
// crank can decide.
//
// It also refuses to let an action be quietly unaddressable: anything decide.mjs
// can emit must either have sources or be named in NOT_YET_PLANNED with a
// reason. A crank that silently never captures looks exactly like a crank that
// has nothing to do.
import assert from 'node:assert/strict';
import { SOURCES, NOT_YET_PLANNED, planAction } from '../ops/g2-crank/plan.mjs';
import { INSTRUCTION_ACCOUNTS } from '../onchain/ratchet-core-g2/client/client-v2.mjs';
import { readFileSync } from 'node:fs';

let checks = 0;

// --- sources agree with the programs, both directions
for (const [crate, actions] of Object.entries(SOURCES)) {
  for (const [ix, sources] of Object.entries(actions)) {
    const entry = INSTRUCTION_ACCOUNTS[crate]?.[ix];
    checks += 1;
    assert.ok(entry, `${crate}.${ix} has sources but the program does not declare it`);

    const declared = entry.accounts.map(a => a.name).sort();
    const named = Object.keys(sources).sort();
    checks += 1;
    assert.deepEqual(named, declared,
      `${crate}.${ix}: sources and declaration disagree. ` +
      `no source: ${declared.filter(n => !named.includes(n)).join(', ') || 'none'}; ` +
      `not declared: ${named.filter(n => !declared.includes(n)).join(', ') || 'none'}`);

    for (const [name, source] of Object.entries(sources)) {
      checks += 1;
      assert.match(source, /^(actor|subject\.[a-zA-Z]+|derived\.[a-zA-Z]+|context\.[a-zA-Z]+|const\.[a-zA-Z]+)$/,
        `${crate}.${ix}.${name}: "${source}" is not one of the five source kinds`);
    }
  }
}

// --- every action decide.mjs can emit is either planned or named as deferred
const decideSource = readFileSync(new URL('../ops/g2-crank/decide.mjs', import.meta.url), 'utf8');
const emitted = [...decideSource.matchAll(/action:\s*'([a-z_]+)'/g)].map(m => m[1]);
checks += 1;
assert.ok(emitted.length >= 8, `only ${emitted.length} actions parsed out of decide.mjs - the parser is wrong`);
const planned = new Set(Object.values(SOURCES).flatMap(a => Object.keys(a)));
for (const action of new Set(emitted)) {
  checks += 1;
  assert.ok(planned.has(action) || NOT_YET_PLANNED.includes(action),
    `decide.mjs can emit ${action} and nothing can address it. Give it sources, or name it in ` +
    'NOT_YET_PLANNED with a reason - a crank that silently never performs an action looks exactly ' +
    'like a crank with nothing to do.');
}

// --- planAction fills every declared account, in the declared set
{
  const resolve = source => `addr:${source}`;
  for (const [crate, actions] of Object.entries(SOURCES)) {
    for (const ix of Object.keys(actions)) {
      const plan = planAction({ crate, action: ix, subject: 's', why: 'test' }, resolve);
      const declared = INSTRUCTION_ACCOUNTS[crate][ix].accounts.map(a => a.name);
      checks += 1;
      assert.deepEqual(Object.keys(plan.addresses).sort(), [...declared].sort(),
        `${crate}.${ix}: planAction did not fill exactly the declared accounts`);
    }
  }
}

// --- a source that resolves to nothing is refused, not passed through
checks += 1;
assert.throws(() => planAction({ crate: 'rcx-timepin-v2', action: 'expire' }, () => null),
  /resolved to nothing/, 'an unresolvable source must fail loudly');

// --- a deferred action explains itself instead of being skipped
checks += 1;
assert.throws(() => planAction({ crate: 'rcx-timepin-v2', action: 'capture_first' }, () => 'x'),
  /not yet addressable.*price update/s, 'a deferred action must say what it is waiting for');

console.log(`ok - crank plan: ${checks} checks, ` +
  `${planned.size} actions addressable, ${NOT_YET_PLANNED.length} named as deferred`);
