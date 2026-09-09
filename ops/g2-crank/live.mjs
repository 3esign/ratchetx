// Keep new G2 devnet shots moving using their on-chain state, not a saved run.
// This operator pays only devnet fees. Players keep their keys and reveal salts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as web3 from '@solana/web3.js';
import bs58 from 'bs58';
import { createCoreG2Client, INSTRUCTION_ACCOUNTS } from '../../lib/g2/client-v2.mjs';
import { PROGRAMS, DEVNET_GENESIS } from './public-pins.mjs';
import { readClock, authenticateSource, chooseCapture, decodeCandidateAccount, withReadRetries } from './public-evidence.mjs';
import { readGeneration } from '../../onchain/rcx-timepin-v2/scripts/devnet-lifecycle.mjs';
import { deriveCandidatePda, deriveWorkPagePda, derivePushSourcePda, validateGeneration } from '../../onchain/rcx-timepin/model-v2.mjs';
import { loadSigner } from '../g2-send/send.mjs';
import { decideShot } from './decide.mjs';
import { planAction } from './plan.mjs';
import { assertChainBoundary, operatorKey, createJournal, assertJournal, assertMaintenance, pendingBytes } from './public-boundary.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pk = x => new web3.PublicKey(x);
const bytes = x => x?.toBuffer ? x.toBuffer() : Buffer.from(x);
const names = ['Open', 'Candidate', 'Final', 'Ambiguous', 'Expired'];
const fact = (ok, why) => { if (!ok) throw new Error(why); };
const equal = (a, b) => bytes(a).equals(bytes(b));
const hex32 = s => { fact(typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s), 'Invalid configuration hash'); return Buffer.from(s, 'hex'); };
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function loadGame(connection, config, operator) {
  const actor = operatorKey(operator);
  assertChainBoundary(await connection.getGenesisHash(), config.programs);
  fact(config.clusterGenesis === DEVNET_GENESIS, 'Configuration is not devnet');
  const c = createCoreG2Client({ web3, coreProgramId: PROGRAMS.core, timepinProgramId: PROGRAMS.timepin });
  const economyHash = hex32(config.economyHash), rulesetHash = hex32(config.rulesetHash), specHash = hex32(config.evidenceSpecHash);
  const addresses = { economy: c.economyPda(economyHash)[0], ruleset: c.rulesetPda(rulesetHash)[0], evidenceSpec: c.evidenceSpecPda(specHash)[0] };
  const keys = [c.coreProgram, c.timepinProgram, addresses.economy, addresses.ruleset, addresses.evidenceSpec];
  const values = await connection.getMultipleAccountsInfo(keys, 'confirmed');
  for (const info of values.slice(0, 2)) fact(info?.executable && info.owner.equals(c.loaderProgram), 'Expected deployed program is unavailable');
  const economy = await c.validateEconomyAccount({ address: addresses.economy, info: values[2], expectedHash: economyHash });
  fact(equal(economy.args.clusterGenesisHash, pk(DEVNET_GENESIS)), 'Economy genesis mismatch');
  const ruleset = await c.validateRulesetAccount({ address: addresses.ruleset, info: values[3], economy, expectedHash: rulesetHash });
  const spec = await c.validateEvidenceSpecAccount({ address: addresses.evidenceSpec, info: values[4], expectedHash: specHash });
  c.validateForwardKernel({ economy, ruleset, evidenceSpec: spec });
  const modelSpec = { ...Object.fromEntries(Object.entries(spec.args).map(([name, value]) => [name, value?.toBuffer ? value.toBuffer() : value])), registeredSlot: spec.registeredSlot };
  spec.priceAccount = pk(derivePushSourcePda(modelSpec).address).toBase58();
  return { c, addresses, economy, ruleset, spec, modelSpec, operator: actor };
}

// The bootstrap helper deliberately fixes its own payer. Public maintenance
// builds the same canonical account list with this keeper's explicit operator.
export function publicTimepinInstruction(ctx, need, name, messageHash) {
  fact(['capture_first', 'capture_conflict', 'finalize', 'expire'].includes(name), 'Unknown public Timepin action');
  const { c } = ctx, spec = ctx.spec.args, actor = operatorKey(ctx.operator);
  const accounts = { actor, evidence_spec: ctx.addresses.evidenceSpec, need: pk(need.address),
    work_page: pk(deriveWorkPagePda(c.timepinProgram.toBuffer(), need.address).address), system_program: web3.SystemProgram.programId };
  const candidate = hash => pk(deriveCandidatePda(c.timepinProgram.toBuffer(), need.address, hash).address);
  if (name.startsWith('capture_')) Object.assign(accounts, { receiver_program: pk(spec.receiverProgram), receiver_program_data: c.programDataPda(spec.receiverProgram)[0],
    receiver_config: c.receiverConfigPda(spec.receiverProgram)[0], wormhole_program: pk(spec.wormholeProgram), wormhole_program_data: c.programDataPda(spec.wormholeProgram)[0], price_update: ctx.spec.priceAccount });
  if (name === 'capture_first') accounts.candidate = candidate(messageHash);
  if (name === 'capture_conflict') { accounts.candidate_a = candidate(need.candidateAHash); accounts.candidate_b = candidate(messageHash); }
  if (name === 'finalize') accounts.candidate = candidate(need.candidateAHash);
  const exact = Object.fromEntries(INSTRUCTION_ACCOUNTS['rcx-timepin-v2'][name].accounts.map(({ name }) => [name, accounts[name]]));
  return c.buildIx('rcx-timepin-v2', name, exact, ...(messageHash ? [bytes(messageHash)] : []));
}

async function batchRead(connection, keys, minContextSlot) {
  const values = new Map();
  for (let i = 0; i < keys.length; i += 5) {
    const group = keys.slice(i, i + 5);
    const batch = await connection.getMultipleAccountsInfoAndContext(group, { commitment: 'confirmed', minContextSlot });
    fact(batch?.value?.length === group.length && batch.context.slot >= minContextSlot, 'Incomplete or older chain snapshot');
    group.forEach((key, j) => values.set(key.toBase58(), batch.value[j]));
  }
  return values;
}

export async function readLiveState(connection, ctx) {
  const { c, economy, ruleset, spec } = ctx;
  const scan = await connection.getProgramAccounts(c.coreProgram, { commitment: 'confirmed', withContext: true,
    filters: [{ dataSize: 780 }, { memcmp: { offset: 11, bytes: pk(economy.economyHash).toBase58() } },
      { memcmp: { offset: 43, bytes: pk(ruleset.rulesetHash).toBase58() } }] });
  fact(Array.isArray(scan?.value) && Number.isSafeInteger(scan.context?.slot), 'Shot discovery failed');
  fact(scan.value.length <= 50, 'This devnet keeper supports at most 50 concurrent shots');
  const shots = scan.value.map(({ pubkey, account }) => {
    const raw = c.decodeShot(account.data);
    return { ...c.validateShotAccount({ address: pubkey, info: account, economy, ruleset, player: raw.player, nonce: raw.nonce }), key: pubkey };
  });
  const needTerms = new Map();
  for (const shot of shots) for (const side of ['entry', 'exit']) {
    const target = shot[side + 'TargetTs'], address = c.needPda(spec.specHash, target)[0];
    fact(address.equals(shot[side + 'Need']), 'Shot references the wrong Need');
    needTerms.set(address.toBase58(), { address, target });
  }
  const keys = [web3.SYSVAR_CLOCK_PUBKEY, pk(spec.priceAccount), ...[...needTerms.values()].map(n => n.address)];
  const infos = await batchRead(connection, keys, scan.context.slot);
  const clock = await readClock({ getAccountInfo: async () => infos.get(web3.SYSVAR_CLOCK_PUBKEY.toBase58()) });
  const sourceInfo = infos.get(spec.priceAccount);
  authenticateSource(ctx.modelSpec, spec.priceAccount, sourceInfo);
  const needs = [...needTerms.values()].map(({ address, target }) => {
    const n = c.validateNeedAccount({ address, info: infos.get(address.toBase58()), evidenceSpec: spec, targetTs: target, requireOpen: false });
    return { ...n, numericState: n.state, state: names[n.state], address: address.toBuffer(), rentPayer: n.rentPayer.toBuffer() };
  });
  const candidates = needs.filter(n => [1, 2].includes(n.numericState)).map(n => pk(deriveCandidatePda(c.timepinProgram.toBuffer(), n.address, n.candidateAHash).address));
  const candidateInfos = await batchRead(connection, candidates, scan.context.slot);
  for (const n of needs) if ([1, 2].includes(n.numericState)) {
    const address = pk(deriveCandidatePda(c.timepinProgram.toBuffer(), n.address, n.candidateAHash).address);
    n.candidate = decodeCandidateAccount(ctx.modelSpec, n, n.candidateAHash, address, candidateInfos.get(address.toBase58()));
  }
  return { shots, needs, clock, slot: scan.context.slot,
    source: { key: pk(spec.priceAccount).toBuffer(), owner: sourceInfo.owner.toBuffer(), data: sourceInfo.data, executable: sourceInfo.executable } };
}

// All generation checks use program headers and the complete 370-byte config.
// Fetch them in one bounded snapshot; repeatedly downloading the executable
// payloads can exhaust a public RPC while a Need is waiting for its target.
export async function readPinnedGeneration(connection, ctx, minContextSlot) {
  const {c, spec}=ctx, receiver=pk(spec.args.receiverProgram), wormhole=pk(spec.args.wormholeProgram);
  const keys=[receiver,c.programDataPda(receiver)[0],c.receiverConfigPda(receiver)[0],wormhole,c.programDataPda(wormhole)[0]];
  const response=await connection.getMultipleAccountsInfoAndContext(keys,{commitment:'confirmed',minContextSlot,dataSlice:{offset:0,length:512}});
  fact(response?.value?.length===keys.length && response.context.slot>=minContextSlot,'Incomplete oracle generation snapshot');
  const infos=new Map(keys.map((k,i)=>[k.toBase58(),response.value[i]]));
  return readGeneration({getAccountInfo:async key=>{fact(infos.has(key.toBase58()),'Oracle generation changed its linked account');return infos.get(key.toBase58());}}, {receiverProgram:receiver.toBuffer()});
}

export async function nextOperation(connection, ctx, state) {
  const operator = operatorKey(ctx.operator);
  for (const need of state.needs) {
    let name, hash;
    if (state.clock.nowTs >= need.captureDeadlineTs) {
      if (need.numericState === 0) name = 'expire';
      if (need.numericState === 1) name = 'finalize';
    } else if ([0, 1].includes(need.numericState) && state.clock.nowTs >= need.targetTs) {
      // Generation pins are re-read before each attempted capture. The on-chain
      // instruction checks the same pins and exact message hash at execution.
      const generation = await readPinnedGeneration(connection, ctx, state.slot);
      fact(validateGeneration(ctx.modelSpec, generation, state.clock.slot).ok, 'Oracle generation changed');
      const choice = chooseCapture(ctx.modelSpec, need, need.candidate, state.source, state.clock, generation);
      name = choice.action; hash = choice.messageHash;
      (state.captureWait ||= []).push({need:pk(need.address).toBase58(),reason:choice.reason || name});
    }
    if (name) return { name, subject: pk(need.address).toBase58(), instruction: publicTimepinInstruction(ctx, need, name, hash) };
  }
  const needMap = new Map(state.needs.map(n => [pk(n.address).toBase58(), { ...n, state: n.numericState }]));
  for (const shot of state.shots) {
    const choice = decideShot(shot, { now: state.clock.nowTs, entryNeed: needMap.get(shot.entryNeed.toBase58()), exitNeed: needMap.get(shot.exitNeed.toBase58()) });
    if (!choice) continue;
    const { c, economy, addresses } = ctx, page = shot.nonce / 16n, pageBytes = Buffer.alloc(8); pageBytes.writeBigUInt64LE(page);
    const work = web3.PublicKey.findProgramAddressSync([Buffer.from('work_page'), bytes(economy.economyHash), shot.player.toBuffer(), pageBytes], c.coreProgram)[0];
    const selected = needKey => { const n = needMap.get(needKey.toBase58()); return pk(deriveCandidatePda(c.timepinProgram.toBuffer(), n.address, n.candidateAHash).address); };
    const sources = { actor: operator, 'context.economy': addresses.economy, 'context.ruleset': addresses.ruleset,
      'context.evidenceSpec': addresses.evidenceSpec, 'context.workPage': work, 'subject.shot': shot.key, 'subject.rentRefund': shot.rentRefund,
      'derived.ledger': c.ledgerPda(economy.economyHash, shot.player)[0], 'derived.playerDay': c.playerDayPda(economy.economyHash, shot.scoreDay, shot.player)[0],
      'derived.rankShard': (await c.rankShardPda(economy.economyHash, shot.scoreDay, shot.player))[0],
      'derived.historyPage': c.historyPagePda(economy.economyHash, shot.player, page)[0],
      'derived.entryNeed': shot.entryNeed, 'derived.exitNeed': shot.exitNeed, 'const.systemProgram': web3.SystemProgram.programId };
    if (choice.action === 'activate_entry') sources['derived.entryCandidate'] = selected(shot.entryNeed);
    if (choice.action === 'settle_final') sources['derived.exitCandidate'] = selected(shot.exitNeed);
    const plan = planAction({ ...choice, subject: shot.key.toBase58() }, source => sources[source]);
    return { name: plan.instruction, subject: plan.subject, instruction: c.buildIx(plan.crate, plan.instruction, plan.addresses) };
  }
  return null;
}

export function writeJournal(file, value, io = fs) {
  const temp = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
  let fd;
  try {
    fd = io.openSync(temp, 'wx', 0o600);
    io.writeFileSync(fd, json(value)); io.fsyncSync(fd); io.closeSync(fd); fd = undefined;
    io.renameSync(temp, file);
    // Node cannot fsync directories on Windows. On POSIX persist the rename as
    // well as its contents; use a local filesystem that supports atomic rename.
    if (process.platform !== 'win32') {
      const dir = io.openSync(path.dirname(file), 'r');
      try { io.fsyncSync(dir); } finally { io.closeSync(dir); }
    }
  } catch (error) {
    throw new Error('Keeper journal write failed: ' + error.message);
  } finally {
    if (fd !== undefined) io.closeSync(fd);
    if (io.existsSync(temp)) io.unlinkSync(temp);
  }
}

export async function resolvePending(connection, journal, persist, { send = false } = {}) {
  if (!journal.pending) return false;
  const raw = pendingBytes(journal), pending = journal.pending;
  const response = await connection.getSignatureStatuses([pending.signature], { searchTransactionHistory: true });
  fact(response?.value?.length === 1, 'Incomplete pending signature status');
  const status = response.value[0];
  // A confirmed failure can still disappear with its fork. Keep those bytes
  // pending until finalization instead of preparing a replacement immediately.
  if (status?.confirmationStatus === 'finalized' || status?.confirmationStatus === 'confirmed' && status.err === null) {
    journal.events.push({ ...pending, status: status.err ? 'failed' : 'confirmed', error: status.err, slot: status.slot });
    delete journal.pending; persist(); return false;
  }
  if (!status) {
    const height = await connection.getBlockHeight('finalized');
    fact(Number.isSafeInteger(height) && height >= 0, 'Invalid finalized block height');
    if (height > pending.lastValidBlockHeight) {
      // An RPC not finding a signature is not proof that the transaction failed.
      // This signed blockhash cannot execute anew. The next sweep must read the
      // current accounts before it can prepare any further maintenance action.
      journal.events.push({ ...pending, status: 'expired-unobserved' });
      delete journal.pending; persist(); return false;
    }
    if (send) {
      assertChainBoundary(await connection.getGenesisHash(), journal.programs);
      // Re-persist validated bytes before rebroadcast too. No replacement
      // blockhash, signature, simulation or new operation while unresolved.
      persist();
      const returned = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 });
      fact(returned === pending.signature, 'RPC returned a different signature');
    }
  }
  return true;
}

export async function sendOperation(connection, signer, operation, journal, persist) {
  fact(!journal.pending, 'Pending transaction must be reconciled before preparing another');
  assertJournal(journal, journal, signer.publicKey);
  assertMaintenance(operation, journal);
  assertChainBoundary(await connection.getGenesisHash(), journal.programs);
  const recent = await connection.getLatestBlockhash('confirmed');
  const tx = new web3.Transaction({ feePayer: signer.publicKey, ...recent }).add(operation.instruction);
  // Simulation receives no executable signature. Signed bytes are never handed
  // to any RPC until their durable journal record exists.
  const simulation = await connection.simulateTransaction(new web3.VersionedTransaction(tx.compileMessage()),
    { sigVerify: false, commitment: 'confirmed' });
  fact(simulation?.value && Object.hasOwn(simulation.value, 'err'), 'Incomplete transaction simulation');
  if (simulation.value.err) return { simulated: false, error: simulation.value.err };
  tx.sign(signer);
  const signature = bs58.encode(tx.signature), raw = tx.serialize();
  journal.pending = { name: operation.name, subject: operation.subject, signature, ...recent,
    signedTransaction: raw.toString('base64'), preparedAt: new Date().toISOString() };
  pendingBytes(journal); persist();
  const returned = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 });
  fact(returned === signature, 'RPC returned a different signature');
  await connection.confirmTransaction({ ...recent, signature }, 'confirmed');
  await resolvePending(connection, journal, persist);
  return { simulated: true, signature };
}

export function parseArgs(argv) {
  const opt = { send: false, watch: false };
  let mode = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--send' || arg === '--dry-run') {
      fact(!mode, 'Choose one keeper mode'); mode = true; opt.send = arg === '--send';
    } else if (arg === '--watch') opt.watch = true;
    else if (arg === '--help') opt.help = true;
    else if (['--rpc', '--operator', '--keypair', '--journal'].includes(arg)) {
      const name = arg.slice(2), value = argv[++i];
      fact(value && !value.startsWith('--') && !opt[name], 'Missing or duplicate ' + name); opt[name] = value;
    } else throw new Error('Unknown option ' + arg);
  }
  if (opt.help) return opt;
  fact(opt.rpc && opt.operator, 'Explicit --rpc and --operator public key are required');
  fact(['https:', 'http:'].includes(new URL(opt.rpc).protocol), 'RPC must be HTTP(S)');
  operatorKey(opt.operator);
  fact(!opt.send || opt.keypair && opt.journal, '--send requires an explicit signer and separate journal');
  fact(opt.send || !opt.keypair, 'Dry-run accepts only the operator public key, not a keypair');
  return opt;
}

export async function main(argv = process.argv.slice(2)) {
  const opt = parseArgs(argv);
  if (opt.help) {
    console.log('node ops/g2-crank/live.mjs --rpc <devnet-rpc> --operator <public-key> [--watch] [--send --keypair <operator-keypair> --journal <new-public-keeper.json>]');
    console.log('Default: read-only dry-run, no keypair or journal writes. See ops/g2-crank/PUBLIC_KEEPER.md.');
    return;
  }
  const operator = operatorKey(opt.operator);
  const connection = withReadRetries(new web3.Connection(opt.rpc, { commitment: 'confirmed', disableRetryOnRateLimit: true }));
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/g2/devnet-config.json'), 'utf8'));
  const ctx = await loadGame(connection, config, operator);
  const signer = opt.send ? loadSigner(web3, path.resolve(opt.keypair)) : null;
  fact(!signer || signer.publicKey.equals(operator), 'Signer does not match selected operator');
  const journalFile = opt.journal && path.resolve(opt.journal);
  let stopped = false, lastMessage = '', lock, journal;
  const stop = () => { stopped = true; };
  const persist = () => { journal.updatedAt = new Date().toISOString(); if (opt.send) writeJournal(journalFile, journal); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    // Lock before reading, so a concurrent process cannot leave us with a stale
    // pending record that predates its successful write.
    if (opt.send) { lock = fs.openSync(journalFile + '.lock', 'wx', 0o600); fs.writeSync(lock, String(process.pid)); }
    journal = journalFile && fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8')) : createJournal(config, operator);
    assertJournal(journal, config, operator);
    const initialBalance = await connection.getBalance(operator, 'confirmed');
    if (journal.startBalance === undefined) journal.startBalance = initialBalance;
    fact(Number.isSafeInteger(journal.startBalance) && journal.startBalance >= 0, 'Invalid keeper journal starting balance');
    persist();
    do {
      try {
        if (await resolvePending(connection, journal, persist, { send: opt.send })) {
          const message = json({ state: 'PENDING', operator: operator.toBase58(), signature: journal.pending.signature });
          if (message !== lastMessage) { console.log(message.trim()); lastMessage = message; }
          if (!opt.watch) break; await sleep(2000); continue;
        }
        const state = await readLiveState(connection, ctx), operation = await nextOperation(connection, ctx, state);
        if (operation) assertMaintenance(operation, journal);
        const message = json({ state: operation ? 'ACTION_READY' : state.shots.length ? 'WATCHING' : 'IDLE', operator: operator.toBase58(),
          shots: state.shots.map(s => ({ player: s.player.toBase58(), nonce: String(s.nonce), state: s.state })), next: operation?.name || null });
        if (message !== lastMessage) { console.log(message.trim()); lastMessage = message; }
        journal.lastRead = { slot: state.slot, at: new Date().toISOString(), shots: state.shots.length, next: operation?.name || null, captureWait: state.captureWait || [] };
        delete journal.lastError; persist();
        if (operation && opt.send) {
          const balance = await connection.getBalance(operator, 'confirmed');
          fact(balance >= 50000000 && journal.startBalance - balance < 250000000 && journal.events.length < 300, 'Devnet keeper fee budget reached');
          const sent = await sendOperation(connection, signer, operation, journal, persist);
          console.log(json({ action: operation.name, subject: operation.subject, ...sent }).trim());
        }
        if (!opt.watch) break;
        await sleep(operation ? 2000 : 5000);
      } catch (error) {
        journal.lastError = { at: new Date().toISOString(), message: error.message }; persist(); console.error(error.message);
        if (!opt.watch || /fee budget|genesis|different signature|generation changed|another game|Keeper journal|Keeper instruction|Keeper pending/.test(error.message)) throw error;
        await sleep(10000);
      }
    } while (!stopped);
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(journalFile + '.lock'); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error('DEVNET KEEPER STOPPED: ' + error.message); process.exitCode = 1; });
