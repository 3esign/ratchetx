#!/usr/bin/env node
// THE ONE HUMAN STEP, MADE REPEATABLE: grant_delegate from a keypair the
// owner named, with bounds that are REQUIRED and never defaulted.
//
//   node ops/g2-delegate/grant.mjs --rpc <devnet> --keypair <path> \
//        --delegate <pubkey> --max-stake 100 --max-gross-stake 300 \
//        --max-shots 3 --min-interval 60 --expires-at <unix-ts> [--grant-id <hex32>]
//
// DRY RUN IS THE DEFAULT. Without --send it builds, simulates, prints the
// program logs and the derived grant address, and sends nothing.
//
// The player is wJYF... (the devnet payer whose keypair is named by --keypair),
// the economy and ruleset are the canonical devnet pair from
// ops/g2-deploy/keys/devnet-bootstrap-state.json, and the grant PDA is derived
// from onchain/ratchet-core-g2/client/delegate.mjs â€” the same code the browser
// lane uses, so a CLI grant and a browser grant land at the same address.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as web3 from '@solana/web3.js';
import { grantDelegateIx, delegateGrantPda } from '../../onchain/ratchet-core-g2/client/delegate.mjs';
import { assertSendable } from '../g2-crank/cluster.mjs';
import { sendOne, loadSigner } from '../g2-send/send.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATE_PATH = path.join(ROOT, 'ops/g2-deploy/keys/devnet-bootstrap-state.json');
const sha = value => createHash('sha256').update(value).digest('hex');
const hex32 = value => /^[0-9a-fA-F]{32}$/.test(value) ? value.toLowerCase() : null;

export function parseArgs(argv) {
  const opt = { send: false };
  let mode = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--send' || a === '--dry-run') {
      if (mode) throw new Error('choose --send or --dry-run once');
      mode = a; opt.send = a === '--send';
    } else if (a === '--help') opt.help = true;
    else if (['--rpc', '--keypair', '--delegate', '--max-stake', '--max-gross-stake',
             '--max-shots', '--min-interval', '--expires-at', '--grant-id', '--lifetime-hours'].includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(a + ' requires a value');
      const key = { '--rpc': 'rpc', '--keypair': 'keypair', '--delegate': 'delegate',
        '--max-stake': 'maxStake', '--max-gross-stake': 'maxGrossStake', '--max-shots': 'maxShots',
        '--min-interval': 'minIntervalSeconds', '--expires-at': 'expiresAtTs', '--grant-id': 'grantId',
        '--lifetime-hours': 'lifetimeHours' }[a];
      if (opt[key] !== undefined) throw new Error(a + ' repeated');
      opt[key] = key === 'lifetimeHours' ? Number(v) : v;
    } else throw new Error('unknown argument ' + a);
  }
  if (opt.help) return opt;
  if (!opt.rpc) throw new Error('--rpc is required; there is no default endpoint');
  if (!opt.keypair) throw new Error('--keypair <path> is required; the fee payer is never implicit');
  if (!opt.delegate) throw new Error('--delegate <pubkey> is required');
  if (!opt.maxStake) throw new Error('--max-stake is required: a defaulted bound is a bound nobody chose');
  if (!opt.maxGrossStake) throw new Error('--max-gross-stake is required: a defaulted bound is a bound nobody chose');
  if (!opt.maxShots) throw new Error('--max-shots is required: a defaulted bound is a bound nobody chose');
  if (!opt.minIntervalSeconds) throw new Error('--min-interval is required: a defaulted bound is a bound nobody chose');
  if (opt.expiresAtTs === undefined && opt.lifetimeHours === undefined) throw new Error('--expires-at <unix-ts> or --lifetime-hours <n> is required');
  if (Number(opt.maxStake) < 100) throw new Error('--max-stake must be at least the economy min_stake (100)');
  if (BigInt(opt.maxGrossStake) > BigInt(opt.maxStake) * BigInt(opt.maxShots))
    throw new Error('max_gross_stake exceeds max_stake * max_shots; the program refuses that');
  if (opt.lifetimeHours !== undefined && (!Number.isSafeInteger(opt.lifetimeHours) || opt.lifetimeHours < 1 || opt.lifetimeHours > 720))
    throw new Error('--lifetime-hours must be 1..720 (the program caps a grant at 30 days)');
  return opt;
}

// The canonical devnet economy/ruleset the whole lane uses, read from the
// bootstrap state rather than retyped, so a typo cannot grant against the
// wrong economy.
export function canonicalAddresses(state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))) {
  if (state.schema !== 1 || state.purpose !== 'DEVNET_TEST_CREDITS_ONLY')
    throw new Error('unrecognized bootstrap state at ' + STATE_PATH);
  if (state.clusterGenesis !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')
    throw new Error('the bootstrap state is not the canonical devnet one; refusing to grant against an unknown economy');
  return {
    core: state.programs.core,
    timepin: state.programs.timepin,
    payer: state.payer,
    economy: 'AJZwZTs2bN9ryFmCHaW3NnjK3hinvaMCvmWSJwK1pfNr',
    ruleset: '4ZHe6oQQoHsj7HoRaRnBzDgChebumeu28QUAjsfopbS1',
    economyHash: 'fc48abc784516fa5cd30a4b4220ef2adbf4d079b9bfad72e75830737fedd61c4',
    rulesetHash: 'a48816b847c6179f7fab9b4835c26321d9a1c0a577d63bce502d51bbe79f81dd',
  };
}

// Reads back a grant account and decodes it against the Rust layout, so the
// CLI never claims success on a signature alone. Anchor: 8 + DelegateGrant::LEN (196) = 204.
export function decodeGrantAccount(info, expectedOwner, expectedGrantId) {
  if (!info) return { exists: false };
  const b = Buffer.from(info.data);
  if (b.length !== 204) return { exists: true, dataLen: b.length, decoded: false };
  let o = 8;
  const u16 = () => { const n = b.readUInt16LE(o); o += 2; return n; };
  const u8 = () => b[o++];
  const u64 = () => { const n = b.readBigUInt64LE(o); o += 8; return n; };
  const i64 = () => { const n = b.readBigInt64LE(o); o += 8; return n; };
  const u32 = () => { const n = b.readUInt32LE(o); o += 4; return n; };
  const take = n => { const v = b.subarray(o, o + n); o += n; return v; };
  const g = {
    schema: u16(), bump: u8(), grantId: take(16).toString('hex'),
    economyHash: take(32).toString('hex'), rulesetHash: take(32).toString('hex'),
    player: new web3.PublicKey(take(32)).toBase58(), delegate: new web3.PublicKey(take(32)).toBase58(),
    maxStake: u64(), maxGrossStake: u64(), maxShots: u16(),
    minIntervalSeconds: u32(), expiresAtTs: i64(),
    grossStakeUsed: u64(), shotsUsed: u16(), lastSealTs: i64(), revoked: u8(),
  };
  const ownerOk = info.owner.toBase58() === expectedOwner;
  const grantIdOk = !expectedGrantId || g.grantId === expectedGrantId.toLowerCase();
  return { exists: true, dataLen: b.length, decoded: true, grant: g, ownerOk, grantIdOk, dataSha256: sha(b) };
}

export async function main({ connection, web3Lib = web3, log = console.log, now = () => Math.floor(Date.now() / 1000) } = {}) {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) { console.log('see the header of this file'); return null; }
  const canonical = canonicalAddresses();
  const cluster = await assertSendable(connection);
  log(`cluster: ${cluster.name}`);
  const signer = loadSigner(web3Lib, path.resolve(opt.keypair));
  if (signer.publicKey.toBase58() !== canonical.payer)
    throw new Error('the keypair is ' + signer.publicKey.toBase58() + ', not the canonical devnet player '
      + canonical.payer + '; a grant binds the player, so the payer of the grant IS the player');
  const delegateKey = new web3Lib.PublicKey(opt.delegate);
  if (delegateKey.equals(signer.publicKey)) throw new Error('the delegate is the player themselves; the program refuses that');
  const grantId = opt.grantId ? hex32(opt.grantId) : createHash('sha256')
    .update(`ratchetx:grant:${signer.publicKey.toBase58()}:${opt.delegate}:${now()}`).digest('hex').slice(0, 32);
  if (!grantId) throw new Error('--grant-id must be 32 hex characters (16 bytes)');
  const expiresAtTs = opt.expiresAtTs !== undefined
    ? BigInt(opt.expiresAtTs) : BigInt(now() + Number(opt.lifetimeHours) * 3600);
  if (expiresAtTs <= BigInt(now())) throw new Error('the grant expires in the past; the program refuses that');
  if (expiresAtTs > BigInt(now() + 30 * 86400)) throw new Error('the grant expires more than 30 days out; the program refuses that');

  const ix = grantDelegateIx(web3Lib, {
    programId: canonical.core, player: signer.publicKey.toBase58(), delegate: opt.delegate,
    economy: canonical.economy, ruleset: canonical.ruleset,
    economyHash: canonical.economyHash, rulesetHash: canonical.rulesetHash,
    grantId, maxStake: opt.maxStake, maxGrossStake: opt.maxGrossStake, maxShots: opt.maxShots,
    minIntervalSeconds: opt.minIntervalSeconds, expiresAtTs,
  });
  const [grantAddress] = delegateGrantPda(web3Lib, {
    programId: canonical.core, player: signer.publicKey.toBase58(), delegate: opt.delegate,
    economyHash: canonical.economyHash, rulesetHash: canonical.rulesetHash, grantId,
  });
  log(`player:    ${signer.publicKey.toBase58()}`);
  log(`delegate:  ${opt.delegate}`);
  log(`grant id:  ${grantId}`);
  log(`grant PDA: ${grantAddress.toBase58()}`);
  log(`bounds:    max ${opt.maxStake}/shot, ${opt.maxGrossStake} total, ${opt.maxShots} shots, `
    + `${opt.minIntervalSeconds}s apart, expires ${expiresAtTs}`);

  const result = await sendOne({
    connection, web3: web3Lib, instruction: ix, signer, mode: opt.send ? 'send' : 'dry-run',
    expect: { address: grantAddress.toBase58(), owner: canonical.core }, log,
  });
  if (!result.sent) return result;

  // A signature is not a read-back: decode the grant bytes the chain now holds.
  const info = await connection.getAccountInfo(grantAddress, 'confirmed');
  const read = decodeGrantAccount(info, canonical.core, grantId);
  if (!read.exists || !read.decoded) {
    log('  GRANT NOT READ BACK: ' + JSON.stringify({ exists: read.exists, dataLen: read.dataLen }));
    return { ...result, readBack: read, evidence: false };
  }
  const g = read.grant;
  const problems = [];
  if (!read.ownerOk) problems.push(`owner is not the core program (${read.ownerOk})`);
  if (!read.grantIdOk) problems.push(`grant id on chain (${g.grantId}) is not the one sent (${grantId})`);
  if (g.player !== signer.publicKey.toBase58()) problems.push(`player on chain is ${g.player}`);
  if (g.delegate !== opt.delegate) problems.push(`delegate on chain is ${g.delegate}`);
  if (g.maxStake !== BigInt(opt.maxStake)) problems.push(`max_stake on chain is ${g.maxStake}`);
  if (g.maxGrossStake !== BigInt(opt.maxGrossStake)) problems.push(`max_gross_stake on chain is ${g.maxGrossStake}`);
  if (g.maxShots !== Number(opt.maxShots)) problems.push(`max_shots on chain is ${g.maxShots}`);
  if (g.minIntervalSeconds !== Number(opt.minIntervalSeconds)) problems.push(`min_interval on chain is ${g.minIntervalSeconds}`);
  if (g.expiresAtTs !== expiresAtTs) problems.push(`expires_at on chain is ${g.expiresAtTs}`);
  if (g.revoked !== 0) problems.push(`the grant is already revoked (${g.revoked})`);
  if (g.shotsUsed !== 0) problems.push(`the grant has already been used (${g.shotsUsed} shots)`);
  if (g.grossStakeUsed !== 0n) problems.push(`the grant has already spent (${g.grossStakeUsed})`);
  if (problems.length) { for (const p of problems) log('  READ BACK DISAGREES: ' + p); return { ...result, readBack: read, evidence: false }; }
  log('  read back: every bound on chain matches what was sent, grant is live, unused and unrevoked');
  log(`  signature: ${result.signature}`);
  return { ...result, readBack: read, evidence: true };
}

export const isCliEntrypoint = (moduleUrl, argv1, toFileUrl = pathToFileURL) => {
  if (typeof argv1 !== 'string' || argv1 === '') return false;
  try { return moduleUrl === toFileUrl(argv1).href; } catch { return false; }
};

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const rpc = process.argv[process.argv.indexOf('--rpc') + 1];
  main({ connection: new web3.Connection(rpc, 'confirmed') })
    .catch(e => { console.error(String(e.message || e)); process.exit(1); });
}
