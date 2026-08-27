#!/usr/bin/env node
// THE FREEZE, REHEARSED. Everything except the signature.
//
//   node tools/freeze-drill.mjs
//   node tools/freeze-drill.mjs <KEYPAIR_PATH>
//
// On 2026-09-08 one command makes RatchetX's settlement program immutable for
// good. There is no undo, no second attempt, and no support ticket. So it gets
// rehearsed first, and the rehearsal answers the only questions that can ruin
// the day:
//
//   1. does the program still have an upgrade authority to revoke?
//   2. does the key we are about to use MATCH that authority?
//   3. does that key have enough SOL to pay for the transaction?
//   4. what, exactly, is the command?
//
// (2) is the one that actually bites. A keypair that looks right and is not the
// authority produces a confident failure on the day, in public.
//
// NOTHING IS SIGNED AND NOTHING IS SENT. The secret key is never read by this
// script, never printed, and never leaves the machine: only `solana-keygen
// pubkey` runs against it, which emits the PUBLIC key and nothing else.
import { PublicKey } from '@solana/web3.js';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROGRAM = '23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX';
const RPC = 'https://api.mainnet-beta.solana.com';
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const KEY = process.argv[2] || path.join(os.homedir(), '.config', 'solana', 'id.json');

const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30_000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
};
const ok = (c, label, detail) => {
  console.log(`  ${c ? '[ OK ]' : '[FAIL]'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
  return c;
};

console.log('\nFREEZE DRILL — nothing is signed, nothing is sent\n');
console.log(`  program : ${PROGRAM}`);
console.log(`  keypair : ${KEY}\n`);

let pass = true;

// ---- 1. is there anything to revoke?
const pid = new PublicKey(PROGRAM);
const [pdAddr] = PublicKey.findProgramAddressSync([pid.toBuffer()], LOADER);
const pd = await rpc('getAccountInfo', [pdAddr.toBase58(), { encoding: 'base64' }]);
if (!pd || !pd.value) { console.log('  [FAIL]  ProgramData account not found — wrong cluster?'); process.exit(1); }
const buf = Buffer.from(pd.value.data[0], 'base64');
const authority = buf.readUInt8(12) === 1 ? new PublicKey(buf.subarray(13, 45)).toBase58() : null;

pass = ok(!!authority, 'the program still has an upgrade authority to revoke',
  authority ? `on-chain authority: ${authority}` : 'already immutable — the ceremony is already done') && pass;
if (!authority) { console.log('\nNothing left to rehearse. It is finished.'); process.exit(0); }

// ---- 2. does our key match it? THE question.
let mine = null;
if (!existsSync(KEY)) {
  ok(false, 'the keypair file exists', `not found: ${KEY}\n          pass the real path as an argument`);
  pass = false;
} else {
  try {
    // public key only — the secret is never read by this process
    mine = execFileSync('solana-keygen', ['pubkey', KEY], { encoding: 'utf8' }).trim();
  } catch (e) {
    ok(false, 'solana-keygen could read a public key from it', String(e.message).slice(0, 120));
    pass = false;
  }
}
if (mine) {
  pass = ok(mine === authority, 'THE KEY MATCHES THE ON-CHAIN AUTHORITY',
    mine === authority ? `${mine}`
      : `this key is  ${mine}\n          authority is ${authority}\n          THIS KEY CANNOT PERFORM THE FREEZE`) && pass;
}

// ---- 3. can it pay?
if (mine) {
  const bal = await rpc('getBalance', [mine]);
  const sol = (bal?.value ?? 0) / 1e9;
  pass = ok(sol > 0.001, 'the authority key can pay the fee', `balance: ${sol} SOL`) && pass;
}

// ---- 4. the command, written out
console.log('\n' + '='.repeat(64));
console.log('  THE COMMAND, for 2026-09-08. Not run here.\n');
console.log(`  solana program set-upgrade-authority ${PROGRAM} \\`);
console.log(`    --final \\`);
console.log(`    --keypair ${KEY} \\`);
console.log(`    --url ${RPC}`);
console.log('\n  It will ask for confirmation. After it returns there is no undo,');
console.log('  for anyone, ever. Verify afterwards with:\n');
console.log('    node tools/authority-check.mjs');
console.log('='.repeat(64));

console.log('\n' + (pass
  ? 'READY. Every check passed. The only thing missing on the day is you.'
  : 'NOT READY. Fix the failures above before 2026-09-08.'));
console.log('\nNothing was signed. Nothing was sent. No secret key was read.\n');
process.exitCode = pass ? 0 : 1;
