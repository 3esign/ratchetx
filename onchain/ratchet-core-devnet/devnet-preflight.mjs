// One preflight for the devnet one-click, printing a single verdict LINE that
// the .cmd parses with `find` — because Node 22 on Windows aborts with
// "!(handle->flags & UV_HANDLE_CLOSING) src\win\async.c line 76" when a script
// calls process.exit() while its stdout is piped to a file, and that abort
// corrupts the exit code the .cmd would otherwise branch on. So: never
// process.exit(); disable the keep-alive agent so the process ends on its own;
// let the verdict travel as text, not as an exit status.
//
//   node devnet-preflight.mjs --rpc <url> --keypair <payer id.json> --program <id> [--so <path>]
//
// Prints (last line is the machine verdict):
//   RXVERDICT READY   — the program is executable on chain; deploy can be skipped
//   RXVERDICT DEPLOY  — not deployed yet, and the payer can afford the rent
//   RXVERDICT SHORT   — not deployed, and the payer is short of the deploy rent
//   RXVERDICT RETRY   — the RPC could not be read; nothing was decided
import fs from 'node:fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : []).filter(Boolean));
const rpc = args.rpc || 'https://api.devnet.solana.com';
const programId = args.program;
const so = args.so || 'onchain/ratchet-core-devnet/ratchet_core_devnet.so';
const say = (...a) => console.log(...a);
const verdict = v => say('RXVERDICT ' + v);

if (!args.keypair || !programId) { say('need --keypair and --program'); verdict('RETRY'); }
else {
  // httpAgent:false → no keep-alive socket pool → the process exits on its own
  // once the awaits resolve, so we never need process.exit() (which is what
  // trips the libuv assertion on Windows when stdout is redirected).
  const conn = new Connection(rpc, { commitment: 'confirmed', httpAgent: false });
  try {
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(args.keypair, 'utf8'))));
    const balLamports = await conn.getBalance(payer.publicKey);
    const bal = balLamports / 1e9;

    const prog = await conn.getAccountInfo(new PublicKey(programId));
    const deployed = !!(prog && prog.executable);

    // Honest rent: programdata is 45 header bytes + the ELF; plus the program
    // account (36 bytes); plus a little for the deploy transactions.
    let needed = 2.9;
    try {
      const soLen = fs.statSync(so).size;
      const pdRent = await conn.getMinimumBalanceForRentExemption(45 + soLen);
      const progRent = await conn.getMinimumBalanceForRentExemption(36);
      needed = (pdRent + progRent) / 1e9 + 0.03;
    } catch { /* fall back to the constant if the .so is not found from here */ }

    say(`payer     ${payer.publicKey.toBase58()}`);
    say(`balance   ${bal.toFixed(3)} SOL`);
    say(`program   ${programId} — ${deployed ? 'already deployed' : 'NOT deployed'}`);
    say(`deploy rent needed ~${needed.toFixed(2)} SOL`);
    if (deployed) verdict('READY');
    else if (bal >= needed) verdict('DEPLOY');
    else { say(`short by ~${(needed - bal).toFixed(2)} SOL`); verdict('SHORT'); }
  } catch (e) {
    say('RPC error: ' + String(e.message || e).split('\n')[0].slice(0, 160));
    verdict('RETRY');
  }
}
