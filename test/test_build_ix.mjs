#!/usr/bin/env node
// buildIx: an instruction is assembled from what the PROGRAM declares, and a
// mistake is caught here rather than on chain.
//
// Thirty-five account lists is far past what anyone checks by eye. The failure
// this guards against is the quiet one: a caller that forgets an account, or
// supplies one the instruction does not take, produces a transaction that a
// validator rejects with a message about index N - and nobody can map index N
// back to a name from outside. buildIx refuses at build time, with the name.
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { PublicKey, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { createCoreG2Client, INSTRUCTION_ACCOUNTS, CORE_INSTRUCTION, TIMEPIN_INSTRUCTION }
  from '../onchain/ratchet-core-g2/client/client-v2.mjs';

const CORE = 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL';
const TIMEPIN = 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp';
const client = createCoreG2Client({
  web3: { PublicKey, TransactionInstruction, SystemProgram },
  coreProgramId: CORE, timepinProgramId: TIMEPIN, cryptoImpl: webcrypto,
});

let checks = 0;
// A distinct, recognisable address per account name, so a transposition is
// visible rather than plausible.
const addressesFor = names => Object.fromEntries(names.map((n, i) =>
  [n, new PublicKey(createHash('sha256').update(`fixture:${n}:${i}`).digest())]));

// --- every instruction builds, in the declared order, with the declared flags
for (const [crate, ixs] of Object.entries(INSTRUCTION_ACCOUNTS)) {
  for (const [name, entry] of Object.entries(ixs)) {
    const names = entry.accounts.map(a => a.name);
    const addresses = addressesFor(names);
    const ix = client.buildIx(crate, name, addresses);

    checks += 1;
    assert.deepEqual(ix.keys.map(k => k.pubkey.toBase58()), names.map(n => addresses[n].toBase58()),
      `${crate}.${name}: accounts are not in the order the program declares them`);

    checks += 1;
    assert.deepEqual(
      ix.keys.map(k => ({ signer: k.isSigner, mut: k.isWritable })),
      entry.accounts.map(a => ({ signer: a.signer, mut: a.mut })),
      `${crate}.${name}: a signer or writable flag does not match the program`);

    const disc = crate === 'rcx-timepin-v2' ? TIMEPIN_INSTRUCTION : CORE_INSTRUCTION;
    checks += 1;
    assert.equal(Buffer.from(ix.data.subarray(0, 8)).toString('hex'), disc[name],
      `${crate}.${name}: wrong discriminator on the wire`);

    checks += 1;
    assert.equal(ix.programId.toBase58(), crate === 'rcx-timepin-v2' ? TIMEPIN : CORE,
      `${crate}.${name}: addressed to the wrong program`);
  }
}

// --- a forgotten account is refused, by name
{
  const names = INSTRUCTION_ACCOUNTS['ratchet-core-g2'].settle_final.accounts.map(a => a.name);
  const full = addressesFor(names);
  const { [names[4]]: _dropped, ...short } = full;
  checks += 1;
  assert.throws(() => client.buildIx('ratchet-core-g2', 'settle_final', short),
    new RegExp(`nobody supplied.*${names[4]}`),
    'a missing account must be refused at build time, naming the account');
}

// --- an account the instruction does not take is refused
{
  const names = INSTRUCTION_ACCOUNTS['rcx-timepin-v2'].finalize.accounts.map(a => a.name);
  checks += 1;
  assert.throws(() => client.buildIx('rcx-timepin-v2', 'finalize',
    { ...addressesFor(names), not_an_account: new PublicKey(new Uint8Array(32)) }),
    /does not take: not_an_account/,
    'an account the instruction does not declare must be refused, naming it');
}

// --- unknown names fail loudly rather than building something addressed nowhere
checks += 1;
assert.throws(() => client.buildIx('ratchet-core-g2', 'no_such_instruction', {}),
  /has no instruction no_such_instruction/);
checks += 1;
assert.throws(() => client.buildIx('no-such-crate', 'settle_final', {}), /unknown crate/);

console.log(`ok - buildIx: ${checks} checks over all ` +
  Object.values(INSTRUCTION_ACCOUNTS).reduce((n, i) => n + Object.keys(i).length, 0) +
  ' instructions, order, flags, discriminator and program id, plus four refusals');
