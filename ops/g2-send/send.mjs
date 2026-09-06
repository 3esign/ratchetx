#!/usr/bin/env node
// The G2 sender: the thin IO shell around ops/g2-send/gate.mjs.
//
// Everything that DECIDES lives in gate.mjs and is tested without a network.
// This file only talks to the world, and is kept as small as it can be made
// because it is the one part that cannot be proved until a deployment exists.
//
// DRY RUN IS THE DEFAULT: it builds, simulates, prints the program logs, and
// sends nothing.
//
// It cannot reach mainnet. cluster.mjs refuses on the genesis hash before
// anything is built, and gate.mjs refuses again on the cluster name before
// anything is signed. Two refusals, in different files, on different facts.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assertSendable } from '../g2-crank/cluster.mjs';
import { maySend, sendIsEvidence } from './gate.mjs';

// A keypair is read from a path the caller NAMES. There is no default location
// and no search: a tool that goes looking for keys is a tool that eventually
// finds the wrong one.
export function loadSigner(web3, keypairPath) {
  if (!keypairPath) throw new Error('no keypair path was given; the fee payer is never implicit');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(keypairPath, 'utf8')); }
  catch (e) { throw new Error(`cannot read a keypair at ${keypairPath}: ${e.message}`); }
  if (!Array.isArray(raw) || (raw.length !== 64 && raw.length !== 32)) {
    throw new Error(`${keypairPath} does not hold a 32 or 64 byte secret key array`);
  }
  return web3.Keypair.fromSecretKey(Uint8Array.from(raw));
}

// Reads the account a transaction was supposed to write, in the shape
// sendIsEvidence expects. A read that FAILS returns exists:false rather than
// throwing, because "I could not look" and "it is not there" must be
// distinguishable by the caller and both must be refusals.
export async function readBack(connection, web3, address, { expectedOwner = null, discriminator = null } = {}) {
  let info = null;
  try { info = await connection.getAccountInfo(new web3.PublicKey(address), 'confirmed'); }
  catch (e) { return { exists: false, readError: e.message }; }
  if (!info) return { exists: false };
  const data = info.data ?? Buffer.alloc(0);
  const out = {
    exists: true,
    dataLen: data.length,
    owner: info.owner?.toBase58?.() ?? String(info.owner),
    expectedOwner,
    lamports: info.lamports,
  };
  if (discriminator) {
    const want = Buffer.from(discriminator);
    out.discriminatorMatches = data.length >= 8 && Buffer.from(data.subarray(0, 8)).equals(want);
  }
  return out;
}

export async function sendOne({
  connection, web3, instruction, signer, mode = 'dry-run',
  expect = null, log = console.log,
}) {
  const cluster = await assertSendable(connection);
  log(`cluster: ${cluster.name}`);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new web3.Transaction({ feePayer: signer?.publicKey ?? null, blockhash, lastValidBlockHeight })
    .add(instruction);

  // SIMULATE FIRST, ALWAYS, IN BOTH MODES. A dry run that does not simulate is a
  // dry run that tells you nothing you did not already type.
  let simulation = null;
  if (signer) {
    tx.sign(signer);
    const sim = await connection.simulateTransaction(tx);
    simulation = sim.value ?? sim;
    for (const line of simulation.logs ?? []) log(`  log: ${line}`);
    if (simulation.err) log(`  simulation error: ${JSON.stringify(simulation.err)}`);
    else log(`  simulation clean, ${simulation.unitsConsumed ?? '?'} compute units`);
  }

  const verdict = maySend({
    mode, cluster, simulation,
    payer: signer?.publicKey?.toBase58?.() ?? null,
    hasSigner: Boolean(signer),
  });
  log(verdict.send ? 'SENDING' : `NOT SENDING: ${verdict.reason}`);
  if (!verdict.send) return { sent: false, reason: verdict.reason, cluster: cluster.name, simulation };

  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const confirmation = (await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight }, 'confirmed')).value;
  log(`signature: ${signature}`);

  // A signature is not a read-back. See gate.mjs.
  const account = expect
    ? await readBack(connection, web3, expect.address,
        { expectedOwner: expect.owner ?? null, discriminator: expect.discriminator ?? null })
    : null;
  const evidence = sendIsEvidence({ signature, confirmation, account });
  if (!evidence.evidence) for (const p of evidence.problems) log(`  NOT EVIDENCE: ${p}`);
  else log('  read back: the account exists, holds data, and carries the right discriminator and owner');

  return { sent: true, signature, cluster: cluster.name, confirmation, account, evidence };
}

export const isCliEntrypoint = (moduleUrl, argv1, toFileUrl = pathToFileURL) => {
  if (typeof argv1 !== 'string' || argv1 === '') return false;
  try { return moduleUrl === toFileUrl(argv1).href; } catch { return false; }
};

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  console.error('ops/g2-send/send.mjs is a library, not a command. It sends ONE instruction that a '
    + 'caller builds and names an expected account for, because a sender with a built-in idea of what '
    + 'to send is a sender nobody can review. Import sendOne from a script that builds the '
    + 'instruction with onchain/ratchet-core-g2/client/client-v2.mjs.');
  process.exit(2);
}
