// Ceremony preflight — is this machine and this program ready to REHEARSE the
// zero-authority ceremony on devnet? Prints one machine verdict LINE that the
// .cmd parses with `find`, in the same style as devnet-preflight.mjs: never
// process.exit() (Node 22 on Windows aborts with the libuv UV_HANDLE_CLOSING
// assertion when a script exits while stdout is piped, corrupting the exit
// code), and httpAgent:false so the process ends on its own.
//
//   node ceremony-preflight.mjs --rpc <url> --program <id> [--keypair <payer id.json>]
//
// Prints (last line is the machine verdict):
//   RXVERDICT READY        — devnet, deployed, authority still live: rehearse
//   RXVERDICT IMMUTABLE    — authority already revoked; nothing left to rehearse here
//   RXVERDICT NOTDEPLOYED  — program is not on this cluster yet; deploy first
//   RXVERDICT NOTDEVNET    — cluster is NOT devnet; refuse (never rehearse revocation on mainnet)
//   RXVERDICT SHORT        — payer cannot cover fees
//   RXVERDICT RETRY        — the RPC could not be read; nothing was decided
//
// The cluster check is by GENESIS HASH, not by the URL string, so a custom or
// mislabelled endpoint cannot smuggle us onto mainnet.
import fs from 'node:fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

const GENESIS = {
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet-beta',
  'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG': 'devnet',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'testnet',
};
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : []).filter(Boolean));
const rpc = args.rpc || 'https://api.devnet.solana.com';
const programId = args.program || 'CnKAJQAQvJQ7Ht3rZRt4ZaFuZSFL4G6sDZShbmJUdTCx';
const say = (...a) => console.log(...a);
const verdict = v => say('RXVERDICT ' + v);

const conn = new Connection(rpc, { commitment: 'confirmed', httpAgent: false });
let decided = false;
try {
  // 1. Which cluster is this really? Genesis hash, not the URL.
  const genesis = await conn.getGenesisHash();
  const cluster = GENESIS[genesis] || 'unknown(' + genesis.slice(0, 8) + '…)';
  say('rpc      ', rpc);
  say('cluster  ', cluster);
  if (cluster !== 'devnet') {
    say('');
    say('REFUSING: this rehearsal revokes an upgrade authority, which is irreversible.');
    say('It runs on devnet only. Point the RPC at devnet and try again.');
    verdict('NOTDEVNET'); decided = true;
  }

  if (!decided) {
    // 2. Is the program there, and is it upgradeable?
    const pid = new PublicKey(programId);
    const prog = await conn.getAccountInfo(pid);
    say('program  ', programId);
    if (!prog || !prog.executable) {
      say('state     not deployed on this cluster');
      verdict('NOTDEPLOYED'); decided = true;
    } else if (prog.owner.toBase58() !== LOADER) {
      say('state     deployed, but not owned by the upgradeable loader');
      say('owner    ', prog.owner.toBase58());
      say('          (already final/immutable by construction — nothing to revoke)');
      verdict('IMMUTABLE'); decided = true;
    } else {
      // Program account: u32 enum(2) + 32-byte programdata address
      const pdAddr = new PublicKey(prog.data.subarray(4, 36));
      const pd = await conn.getAccountInfo(pdAddr);
      if (!pd) { say('programdata unreadable'); verdict('RETRY'); decided = true; }
      else {
        // ProgramData: u32 enum(3) + u64 slot + Option<Pubkey> (1 + 32) = 45 header
        const hasAuthority = pd.data[12] === 1;
        const authority = hasAuthority ? new PublicKey(pd.data.subarray(13, 45)).toBase58() : null;
        say('data acct', pdAddr.toBase58());
        say('authority', hasAuthority ? authority : 'NONE (already revoked)');
        if (!hasAuthority) {
          say('');
          say('This program is already immutable. The ceremony cannot be rehearsed on it;');
          say('deploy a fresh throwaway devnet program to rehearse again.');
          verdict('IMMUTABLE'); decided = true;
        }
      }
    }
  }

  // 3. Can the payer move?
  if (!decided && args.keypair) {
    try {
      const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(args.keypair, 'utf8'))));
      const bal = (await conn.getBalance(payer.publicKey)) / 1e9;
      say('payer    ', payer.publicKey.toBase58());
      say('balance  ', bal.toFixed(4), 'SOL');
      if (bal < 0.05) {
        say('');
        say('Payer is short. Run: solana airdrop 2');
        verdict('SHORT'); decided = true;
      }
    } catch (e) { say('payer     unreadable:', e.message); }
  }

  if (!decided) {
    say('');
    say('Devnet, deployed, authority still live — the ceremony can be rehearsed.');
    say('Order is fixed: verify FIRST, revoke LAST.');
    verdict('READY');
  }
} catch (e) {
  say('rpc error:', String(e.message || e).split('\n')[0]);
  verdict('RETRY');
}
