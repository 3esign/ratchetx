#!/usr/bin/env node
// Is the program frozen? Read it off the chain. No key required, by anyone.
//
//   node tools/authority-check.mjs
//   node tools/authority-check.mjs <PROGRAM_ID> [RPC_URL]
//
// WHY THIS EXISTS. `solana program show` refuses to run without a configured
// signer, even though the upgrade authority is a public fact on a public
// ledger. A claim that anyone can check should not require anyone to hold a
// key to check it — least of all THIS claim, which is the one the whole
// freeze rests on.
//
// So this asks the chain directly: derive the ProgramData account, read it,
// decode the authority field. Before 2026-09-08 it should name a key. After,
// it should say the program is immutable — permanently, for everyone,
// including us. Same command, both sides of the ceremony.
//
// Reads only. Signs nothing. Sends nothing.
import { PublicKey } from '@solana/web3.js';

const PROGRAM = process.argv[2] || '23k3r8AJRdX64iipwNMqPdN2vSgNmw9stGs7cJqmZEEX';
const RPC = process.argv[3] || 'https://api.mainnet-beta.solana.com';
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

const rpc = async (method, params) => {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};

console.log(`program : ${PROGRAM}`);
console.log(`rpc     : ${RPC}\n`);

const programId = new PublicKey(PROGRAM);
const info = await rpc('getAccountInfo', [PROGRAM, { encoding: 'base64' }]);
if (!info || !info.value) { console.log('account not found on this cluster'); process.exit(1); }

console.log(`owner   : ${info.value.owner}`);
if (info.value.owner !== LOADER.toBase58()) {
  console.log('\nThis program is NOT owned by the upgradeable loader, so it has no');
  console.log('upgrade authority to revoke — it is already immutable by construction.');
  process.exit(0);
}

const [programData] = PublicKey.findProgramAddressSync([programId.toBuffer()], LOADER);
console.log(`data    : ${programData.toBase58()}`);

const pd = await rpc('getAccountInfo', [programData.toBase58(), { encoding: 'base64' }]);
if (!pd || !pd.value) { console.log('\nProgramData account not found.'); process.exit(1); }

// ProgramData layout: u32 enum(3) | u64 last_deployed_slot | Option<Pubkey>
const buf = Buffer.from(pd.value.data[0], 'base64');
const kind = buf.readUInt32LE(0);
const slot = Number(buf.readBigUInt64LE(4));
const hasAuthority = buf.readUInt8(12) === 1;
const authority = hasAuthority ? new PublicKey(buf.subarray(13, 45)).toBase58() : null;

console.log(`kind    : ${kind === 3 ? 'ProgramData' : kind}`);
console.log(`deployed at slot: ${slot.toLocaleString()}`);
console.log('');
console.log('='.repeat(60));
if (authority) {
  console.log(`  UPGRADE AUTHORITY: ${authority}`);
  console.log('');
  console.log('  The program can still be changed by whoever holds that key.');
  console.log('  On 2026-09-08 this line is meant to disappear — permanently,');
  console.log('  for everyone, including us. See docs/FREEZE.md.');
} else {
  console.log('  UPGRADE AUTHORITY: NONE — the program is IMMUTABLE');
  console.log('');
  console.log('  The deployed bytes are final. Nobody can change them: not a');
  console.log('  multisig, not a governance vote, not us. Verify the binary');
  console.log('  once and the verification stays true forever.');
}
console.log('='.repeat(60));
console.log('\nNothing was signed and nothing was sent. Re-run this against any RPC');
console.log('you trust, or against none of ours at all.');
