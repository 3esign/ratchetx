#!/usr/bin/env node
// THE CHECKED-IN ACCOUNT LISTS MUST STILL BE WHAT THE PROGRAMS DECLARE.
//
// A client sends accounts in Anchor's declared order with the right mut and
// signer flags. One wrong flag or one transposed pair produces a transaction
// that fails on chain in a way nobody can diagnose from the outside, and there
// are thirty-five of these lists. Transcribing them is the same "copied
// arithmetic" that put 8 + 124 against a 276-byte account and cost this project
// a day, so they are generated - and this is what stops the generated file from
// rotting the moment somebody adds an account to a struct.
//
// Three things, none of which can pass on silence:
//   1. Re-derive from source and compare to the checked-in table, exactly.
//   2. Every instruction with a discriminator has an account list, and vice
//      versa - a name known to one table and not the other is a gap.
//   3. Structural sanity: no empty list, no duplicate account name inside one
//      instruction, and exactly one signer-and-writable fee payer where Anchor
//      requires one.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { derive, OUT } from '../tools/derive-account-lists.mjs';
import { CORE_INSTRUCTION, TIMEPIN_INSTRUCTION, INSTRUCTION_ACCOUNTS }
  from '../onchain/ratchet-core-g2/client/client-v2.mjs';

let checks = 0;
const committed = JSON.parse(readFileSync(new URL('../' + OUT, import.meta.url), 'utf8'));
const fresh = derive(new URL('../', import.meta.url).pathname);

checks += 1;
assert.deepEqual(Object.keys(fresh).sort(), Object.keys(committed).sort(),
  'the generator and the checked-in table disagree about which crates exist');

for (const crate of Object.keys(fresh)) {
  checks += 1;
  assert.ok(Object.keys(fresh[crate]).length > 0,
    `${crate}: the generator produced zero instructions - no verdict is possible`);

  checks += 1;
  assert.deepEqual(fresh[crate], committed[crate],
    `${crate}: ${OUT} no longer matches the program. Something changed an accounts struct or an ` +
    'instruction and the client was not told. Run: node tools/derive-account-lists.mjs --write');
}

// The two tables are two halves of one fact.
const pairs = [['ratchet-core-g2', CORE_INSTRUCTION], ['rcx-timepin-v2', TIMEPIN_INSTRUCTION]];
for (const [crate, disc] of pairs) {
  const withAccounts = Object.keys(committed[crate]).sort();
  const withDisc = Object.keys(disc).sort();
  checks += 1;
  assert.deepEqual(withAccounts, withDisc,
    `${crate}: the discriminator table and the account table name different instructions. ` +
    `only accounts: ${withAccounts.filter(n => !withDisc.includes(n)).join(', ') || 'none'}; ` +
    `only discriminators: ${withDisc.filter(n => !withAccounts.includes(n)).join(', ') || 'none'}. ` +
    'An instruction you can name but cannot address, or address but cannot name, cannot be sent.');
}

for (const [crate, ixs] of Object.entries(committed)) {
  for (const [ix, { context, accounts }] of Object.entries(ixs)) {
    checks += 1;
    assert.ok(accounts.length > 0, `${crate}.${ix} (${context}) has an empty account list`);

    const names = accounts.map(a => a.name);
    checks += 1;
    assert.equal(new Set(names).size, names.length,
      `${crate}.${ix} lists an account name twice: ${names.join(', ')}`);

    // Anchor needs a writable signer to pay for any account it initialises.
    const initialises = /system_program/.test(names.join(','));
    if (initialises) {
      checks += 1;
      assert.ok(accounts.some(a => a.signer && a.mut),
        `${crate}.${ix} takes the system program but has no writable signer to pay rent`);
    }
  }
}

// THE CLIENT CARRIES ITS OWN COPY, so the copy is checked too. client-v2.mjs
// inlines the table rather than importing the JSON, because it must stay one
// file a browser can load - and an inlined copy is a copy, which is the thing
// this whole file exists to distrust. Without this the generated file and the
// shipped client could disagree and every other check here would still pass.
checks += 1;
assert.deepEqual(INSTRUCTION_ACCOUNTS, committed,
  'client-v2.mjs has an inlined account table that differs from ' + OUT + '. The client is what ' +
  'actually builds transactions, so the client is what would be wrong. Regenerate with ' +
  'node tools/derive-account-lists.mjs --write and re-inline it.');

console.log(`ok - account lists: ${checks} checks across ` +
  Object.entries(committed).map(([c, i]) => `${c} ${Object.keys(i).length}`).join(', ') +
  ', regenerated from source and compared field for field');
