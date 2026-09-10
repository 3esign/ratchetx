#!/usr/bin/env node
// One saved devnet test shot, actual account bytes, no implicit payer or cluster.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as web3 from '@solana/web3.js';
import bs58 from 'bs58';
import { buildContext, readClock, assertBoundary, PROGRAMS, PAYER, DEVNET_GENESIS } from './g2-devnet-bootstrap.mjs';
import { readGeneration } from '../onchain/rcx-timepin-v2/scripts/devnet-lifecycle.mjs';
import { decodePriceUpdateV2, evaluateCapture, validateCandidate, encodeCandidateV2,
  deriveCandidatePda, deriveWorkPagePda, derivePushSourcePda, validateGeneration, hashPriceMessage } from '../onchain/rcx-timepin/model-v2.mjs';
import { ACCOUNT_DISCRIMINATOR, INSTRUCTION_ACCOUNTS } from '../onchain/ratchet-core-g2/client/client-v2.mjs';
import { extractShotArchivedReceipts } from '../onchain/ratchet-core-g2/client/shot-receipt.mjs';
import { historyRowHash, historyChainFold, gameResultHash, compactResultCommit,
  timepinResultHash, compareExactPrices } from '../onchain/ratchet-core-g2/model.mjs';
import { sendOne, loadSigner } from '../ops/g2-send/send.mjs';
import { checkRunReceipt } from '../ops/g2-devnet/receipt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, 'ops/g2-deploy/keys/devnet-bootstrap-state.json');
const RECEIPT = path.join(ROOT, 'docs/receipts/g2-devnet-play.json');
const RELEASE = path.join(ROOT, 'releases/g2-devnet-run.json');
const ZERO = Buffer.alloc(32), NEED_STATES = ['Open', 'Candidate', 'Final', 'Ambiguous', 'Expired'];
const VOID_REASONS = [null, 'VOID_ENTRY_EXPIRED', 'VOID_ENTRY_AMBIGUOUS', 'VOID_EXIT_EXPIRED', 'VOID_EXIT_AMBIGUOUS', 'VOID_EQUALITY', 'VOID_CONFIDENCE_BAND'];
const pk = value => new web3.PublicKey(value), bytes = value => value?.toBuffer ? value.toBuffer() : Buffer.from(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const hex = value => bytes(value).toString('hex');
const fact = (ok, why) => { if (!ok) throw new Error(why); };
const same = (a, b, why) => fact(bytes(a).equals(bytes(b)), why);
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const accountEvidence = (address, info) => ({ address: String(address), owner: info.owner.toBase58(), dataLen: info.data.length, dataSha256: sha(info.data) });

const exactAccounts = (crate, name, values) => Object.fromEntries(INSTRUCTION_ACCOUNTS[crate][name].accounts.map(({ name: account }) => {
  fact(values[account] !== undefined, 'missing instruction account ' + account); return [account, values[account]];
}));

export function withReadRetries(connection, pause = sleep) {
  return new Proxy(connection, { get(target, name) {
    const value = target[name]; if (typeof value !== 'function') return value;
    if (!String(name).startsWith('get')) return value.bind(target);
    return async (...args) => {
      for (let attempt = 0; ; attempt++) {
        try { return await value.apply(target, args); }
        // "Minimum context slot has not been reached" is a lagging node saying
        // "not yet", not a failure: a public endpoint is many nodes behind one
        // address, and a read that demands the slot an earlier read returned will
        // meet one of the slower ones. Treating it as fatal blinded the keeper
        // for five minutes on 2026-09-10 and voided a game.
        catch (error) { if (attempt >= 2 || !/\b429\b|too many requests|minimum context slot/i.test(String(error.message))) throw error; await pause(2000 * (attempt + 1)); }
      }
    };
  } });
}

export function parseArgs(argv) {
  const opt = { send: false, maxSeconds: 5400 };
  let mode = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--send' || a === '--dry-run') { fact(!mode, 'choose one mode'); mode = true; opt.send = a === '--send'; }
    else if (a === '--help') opt.help = true;
    else if (['--rpc', '--keypair', '--max-seconds'].includes(a)) {
      const v = argv[++i]; fact(v && !v.startsWith('--'), 'missing value for ' + a);
      const k = a === '--max-seconds' ? 'maxSeconds' : a.slice(2); fact(k === 'maxSeconds' || !opt[k], 'duplicate ' + a);
      opt[k] = k === 'maxSeconds' ? Number(v) : v;
    } else throw new Error('unknown argument ' + a);
  }
  if (opt.help) return opt;
  fact(opt.rpc, '--rpc is required; no implicit cluster');
  fact(['https:', 'http:'].includes(new URL(opt.rpc).protocol), 'RPC must be HTTP(S)');
  fact(!opt.send || opt.keypair, '--send requires --keypair before network access');
  fact(Number.isSafeInteger(opt.maxSeconds) && opt.maxSeconds >= 2 && opt.maxSeconds <= 7200, '--max-seconds must be 2..7200');
  return opt;
}

export function authenticateSource(spec, address, info) {
  same(pk(address).toBuffer(), derivePushSourcePda(spec).address, 'SOL source PDA mismatch');
  fact(info && !info.executable && info.owner.equals(pk(spec.receiverProgram)), 'SOL source owner/executable mismatch');
  const decoded = decodePriceUpdateV2(info); fact(decoded.ok, 'SOL source: ' + decoded.code);
  same(decoded.writeAuthority, pk(address).toBuffer(), 'SOL source write authority mismatch');
  same(decoded.feedId, spec.feedId, 'SOL source feed mismatch');
  return decoded;
}

export function decodeCandidateAccount(spec, need, hash, address, info) {
  fact(info && !info.executable && info.owner.equals(pk(PROGRAMS.timepin)), 'Candidate owner/executable mismatch');
  // 151 since 2026-09-10: CandidateV2 carries rent_payer so the capture rent has
  // an address to be returned to.
  const b = Buffer.from(info.data); fact(b.length === 151, 'Candidate exact length mismatch');
  same(b.subarray(0, 8), Buffer.from(sha('account:CandidateV2').slice(0, 16), 'hex'), 'Candidate discriminator mismatch');
  let o = 8;
  const u8 = () => b[o++], u16 = () => { const n = b.readUInt16LE(o); o += 2; return n; };
  const take = n => { const v = b.subarray(o, o + n); o += n; return v; };
  const i64 = () => { const n = b.readBigInt64LE(o); o += 8; return n; };
  const u64 = () => { const n = b.readBigUInt64LE(o); o += 8; return n; };
  const i32 = () => { const n = b.readInt32LE(o); o += 4; return n; };
  const c = { address: pk(address).toBuffer(), schema: u16(), bump: u8(), need: take(32), rentPayer: take(32), price: i64(), conf: u64(), exponent: i32(),
    publishTime: i64(), prevPublishTime: i64(), emaPrice: i64(), emaConf: u64(), postedSlot: u64(), captureSlot: u64(), captureTs: i64() };
  fact(o === b.length, 'Candidate trailing bytes');
  const valid = validateCandidate(spec, need, c, hash, pk(PROGRAMS.timepin).toBuffer()); fact(valid.ok, 'Candidate invalid: ' + valid.code);
  same(encodeCandidateV2(c), b, 'Candidate decoded bytes mismatch');
  return c;
}

// Mirrors lifecycle.rs capture_order_key. The older model transition helper
// still treats equal publication times as ambiguous and is deliberately unused.
export function compareCapture(a, aHash, b, bHash) {
  for (const key of ['publishTime', 'postedSlot']) if (BigInt(a[key]) !== BigInt(b[key])) return BigInt(a[key]) < BigInt(b[key]) ? -1 : 1;
  return Buffer.compare(bytes(aHash), bytes(bHash));
}

export function chooseCapture(spec, need, candidate, source, clock, generation) {
  const checked = evaluateCapture(spec, need, source, { slot: clock.slot, unixTimestamp: clock.nowTs, generation }, pk(PROGRAMS.timepin).toBuffer());
  if (!checked.ok) return { action: null, reason: checked.code };
  same(checked.messageHash, hashPriceMessage(checked.message), 'canonical message hash disagreement');
  if (need.state === 'Open') return { action: 'capture_first', ...checked };
  fact(need.state === 'Candidate' && candidate, 'candidate Need has no authenticated incumbent');
  if (bytes(need.candidateAHash).equals(checked.messageHash)) return { action: null, reason: 'DUPLICATE' };
  return compareCapture(checked.message, checked.messageHash, candidate, need.candidateAHash) < 0
    ? { action: 'capture_conflict', ...checked } : { action: null, reason: 'NOT_EARLIER' };
}

export function timepinInstruction(ctx, need, name, messageHash) {
  const c = ctx.c, spec = ctx.spec.args, address = pk(need.address);
  const accounts = { actor: PAYER, evidence_spec: ctx.addresses.evidenceSpec, need: address,
    work_page: pk(deriveWorkPagePda(pk(PROGRAMS.timepin).toBuffer(), need.address).address), system_program: web3.SystemProgram.programId };
  const candidate = hash => pk(deriveCandidatePda(pk(PROGRAMS.timepin).toBuffer(), need.address, hash).address);
  if (name.startsWith('capture_')) Object.assign(accounts, { receiver_program: pk(spec.receiverProgram), receiver_program_data: c.programDataPda(spec.receiverProgram)[0],
    receiver_config: c.receiverConfigPda(spec.receiverProgram)[0], wormhole_program: pk(spec.wormholeProgram), wormhole_program_data: c.programDataPda(spec.wormholeProgram)[0], price_update: ctx.spec.priceAccount });
  if (name === 'capture_first') accounts.candidate = candidate(messageHash);
  if (name === 'capture_conflict') { accounts.candidate_a = candidate(need.candidateAHash); accounts.candidate_b = candidate(messageHash); }
  if (name === 'finalize') accounts.candidate = candidate(need.candidateAHash);
  fact(['capture_first', 'capture_conflict', 'finalize', 'expire'].includes(name), 'unknown Timepin action');
  return c.buildIx('rcx-timepin-v2', name, exactAccounts('rcx-timepin-v2', name, accounts), ...(messageHash ? [bytes(messageHash)] : []));
}

export function nextCoreAction(shot, needs, clock) {
  if (!shot) return null;
  if (shot.state === 1) return needs[0].state === 'Final' ? 'activate_entry' : ['Expired', 'Ambiguous'].includes(needs[0].state) ? 'void_pending_entry' : null;
  if (shot.state === 2) return needs[1].state === 'Final' ? 'settle_final' : ['Expired', 'Ambiguous'].includes(needs[1].state) ? 'void_active_shot' : null;
  if (shot.state === 3) { fact(BigInt(clock.nowTs) <= shot.revealDeadlineTs, 'REVEAL_WINDOW_MISSED'); return 'reveal'; }
  if (shot.state === 7) return 'finalize_resolved_void';
  throw new Error('unexpected live Shot state ' + shot.state);
}

export async function coreInstruction(ctx, state, shot, needs, name) {
  const c = ctx.c, a = ctx.addresses, scoreDay = BigInt(state.targets.scoreDay);
  const work = web3.PublicKey.findProgramAddressSync([Buffer.from('work_page'), bytes(ctx.economy.economyHash), pk(PAYER).toBuffer(), Buffer.alloc(8)], pk(PROGRAMS.core))[0];
  const candidate = need => pk(deriveCandidatePda(pk(PROGRAMS.timepin).toBuffer(), need.address, need.candidateAHash).address);
  const accounts = { actor: PAYER, player: PAYER, economy: a.economy, ruleset: a.ruleset, ledger: a.ledger, shot: a.shot,
    work_page: work, player_day: c.playerDayPda(ctx.economy.economyHash, scoreDay, PAYER)[0], rank_shard: (await c.rankShardPda(ctx.economy.economyHash, scoreDay, PAYER))[0],
    evidence_spec: a.evidenceSpec, entry_need: pk(needs[0].address), exit_need: pk(needs[1].address),
    entry_candidate: candidate(needs[0]), exit_candidate: candidate(needs[1]), history_page: a.historyPage, rent_refund: PAYER, system_program: web3.SystemProgram.programId };
  let args = [];
  if (name === 'reveal') { const p = Buffer.alloc(2); p.writeUInt16LE(state.probability); args = [Buffer.from([state.side]), p, Buffer.from(state.salt, 'hex')]; }
  fact(['activate_entry', 'settle_final', 'reveal', 'void_pending_entry', 'void_active_shot', 'finalize_resolved_void'].includes(name), 'unknown Core action');
  return c.buildIx('ratchet-core-g2', name, exactAccounts('ratchet-core-g2', name, accounts), ...args);
}

export function verifyTransaction(transaction, signature, instruction) {
  fact(transaction?.meta?.err === null && Number.isSafeInteger(transaction.slot) && transaction.slot > 0, 'transaction missing/failed');
  fact(transaction.transaction?.signatures?.[0] === signature, 'transaction signature mismatch');
  const m = transaction.transaction.message, keys = m.accountKeys || m.staticAccountKeys;
  fact(keys?.[0]?.toString() === PAYER && m.header?.numRequiredSignatures === 1, 'transaction payer/signers mismatch');
  const all = [...keys, ...(transaction.meta.loadedAddresses?.writable || []), ...(transaction.meta.loadedAddresses?.readonly || [])];
  const matches = (m.instructions || m.compiledInstructions || []).filter(ix => all[ix.programIdIndex].toString() === instruction.programId.toBase58());
  fact(matches.length === 1, 'transaction must contain exactly one expected program instruction');
  const ix = matches[0], data = typeof ix.data === 'string' ? bs58.decode(ix.data) : ix.data;
  same(data, instruction.data, 'confirmed instruction data mismatch');
  const indices = ix.accounts || ix.accountKeyIndexes;
  fact(indices.length === instruction.keys.length, 'confirmed instruction account count mismatch');
  instruction.keys.forEach((key, i) => fact(all[indices[i]].toString() === key.pubkey.toBase58(), 'confirmed instruction account mismatch'));
  fact(Array.isArray(transaction.meta.logMessages), 'confirmed transaction logs unavailable');
  return { signature, slot: transaction.slot, feeLamports: transaction.meta.fee, logsSha256: sha(json(transaction.meta.logMessages)), commitment: 'confirmed' };
}

function readShot(ctx, state, info) {
  if (!info) return null;
  const v = ctx.c.validateShotAccount({ address: ctx.addresses.shot, info, economy: ctx.economy, ruleset: ctx.ruleset, player: PAYER, nonce: 0n });
  same(v.commit, ctx.commit, 'saved Shot commitment mismatch');
  fact(v.stake === 100n && v.entryMode === 2 && v.scoreDay === BigInt(state.targets.scoreDay)
    && v.entryTargetTs === BigInt(state.targets.entryTargetTs) && v.exitTargetTs === BigInt(state.targets.exitTargetTs)
    && v.rentRefund.toBase58() === PAYER && bytes(v.delegate).equals(ZERO), 'saved Shot terms mismatch');
  for (const kind of ['entry', 'exit']) fact(v[kind + 'Need'].equals(ctx.c.needPda(ctx.spec.specHash, v[kind + 'TargetTs'])[0]), 'Shot Need address mismatch');
  return v;
}

export async function readTick(connection, ctx, state, previous = null) {
  const addresses = ['entry', 'exit'].map(kind => ctx.c.needPda(ctx.spec.specHash, BigInt(state.targets[kind + 'TargetTs']))[0]);
  const known = previous?.needs?.filter(n => ['Candidate', 'Final'].includes(n.state)).map(n => pk(deriveCandidatePda(pk(PROGRAMS.timepin).toBuffer(), n.address, n.candidateAHash).address)) || [];
  const keys = [web3.SYSVAR_CLOCK_PUBKEY, pk(ctx.spec.priceAccount), ...addresses, ctx.addresses.shot, ...known];
  const batch = await connection.getMultipleAccountsInfoAndContext(keys, { commitment: 'confirmed' });
  fact(batch?.value?.length === keys.length && Number.isSafeInteger(batch.context?.slot), 'incomplete account batch');
  const map = new Map(keys.map((key, i) => [key.toBase58(), batch.value[i]]));
  const clock = await readClock({ getAccountInfo: async () => batch.value[0] });
  fact(clock.slot <= BigInt(batch.context.slot), 'Clock exceeds RPC context slot');
  const needs = addresses.map((address, i) => {
    const n = ctx.c.validateNeedAccount({ address, info: batch.value[i + 2], evidenceSpec: ctx.spec, targetTs: BigInt(state.targets[(i ? 'exit' : 'entry') + 'TargetTs']), requireOpen: false });
    return { ...n, address: address.toBuffer(), state: NEED_STATES[n.state], numericState: n.state, rentPayer: n.rentPayer.toBuffer() };
  });
  const candidateAddresses = needs.filter(n => ['Candidate', 'Final'].includes(n.state)).map(n => pk(deriveCandidatePda(pk(PROGRAMS.timepin).toBuffer(), n.address, n.candidateAHash).address));
  const missing = candidateAddresses.filter(key => !map.has(key.toBase58()));
  if (missing.length) {
    const infos = await connection.getMultipleAccountsInfo(missing, { commitment: 'confirmed', minContextSlot: batch.context.slot });
    missing.forEach((key, i) => map.set(key.toBase58(), infos[i]));
  }
  const candidates = needs.map(n => {
    if (!['Candidate', 'Final'].includes(n.state)) return null;
    const address = pk(deriveCandidatePda(pk(PROGRAMS.timepin).toBuffer(), n.address, n.candidateAHash).address);
    return decodeCandidateAccount(ctx.modelSpec, n, n.candidateAHash, address, map.get(address.toBase58()));
  });
  return { clock, contextSlot: batch.context.slot, needs, candidates, shot: readShot(ctx, state, batch.value[4]),
    source: { key: pk(ctx.spec.priceAccount).toBuffer(), owner: batch.value[1]?.owner?.toBuffer(), data: batch.value[1]?.data, executable: batch.value[1]?.executable }, infos: map };
}

export function verifyTerminal(ctx, state, tick, ledger, history, transaction) {
  fact(tick.shot === null, 'terminal Shot still exists');
  const events = extractShotArchivedReceipts(transaction, { coreProgramId: PROGRAMS.core }).map(r => r.event)
    .filter(e => bytes(e.economyHash).equals(bytes(ctx.economy.economyHash)) && bytes(e.player).equals(pk(PAYER).toBuffer()) && e.nonce === 0n);
  fact(events.length === 1, 'exact ShotArchived event missing or duplicated');
  const e = events[0], r = e.result;
  fact(e.pageIndex === 0n && e.slot === 0 && e.sequence === 1, 'archive slot/sequence mismatch');
  same(r.rulesetHash, ctx.ruleset.rulesetHash, 'archived ruleset mismatch');
  fact(r.stake === 100n && r.entryTargetTs === BigInt(state.targets.entryTargetTs) && r.exitTargetTs === BigInt(state.targets.exitTargetTs), 'archived terms mismatch');
  same(r.delegate, ZERO, 'unexpected archived delegate');
  fact([4, 5].includes(r.state), 'archive is neither reveal nor void');
  const result = { ...r, state: r.state === 4 ? 'Revealed' : 'Void', voidReason: VOID_REASONS[r.voidReason] };
  same(compactResultCommit({ programId: pk(PROGRAMS.core).toBuffer(), economyHash: bytes(ctx.economy.economyHash), player: pk(PAYER).toBuffer(), nonce: 0n, result }), ctx.commit, 'archived commitment mismatch');
  const [entry, exit] = tick.needs, [a, b] = tick.candidates;
  const needHash = n => timepinResultHash({ ...n, state: n.numericState, key: n.address });
  let outcome = 0, hit = 0, xp = 0n;
  if (r.state === 4) {
    fact(entry.state === 'Final' && exit.state === 'Final' && a && b && r.voidReason === 0 && r.side === state.side && r.pBps === state.probability, 'revealed facts mismatch');
    const delta = compareExactPrices(a, b); fact(delta !== 0, 'equality cannot reveal'); outcome = Number(delta > 0); hit = Number((state.side === 1) === (outcome === 1)); xp = hit ? 11n : 1n;
  } else {
    const wanted = entry.state === 'Expired' ? 1 : entry.state === 'Ambiguous' ? 2 : exit.state === 'Expired' ? 3 : exit.state === 'Ambiguous' ? 4
      : entry.state === 'Final' && exit.state === 'Final' && a && b && compareExactPrices(a, b) === 0 ? 5 : null;
    fact(wanted !== null && r.voidReason === wanted, 'void reason does not match permanent oracle facts');
  }
  const facts = { entryTimepinResultHash: needHash(entry), exitTimepinResultHash: r.state === 5 && r.voidReason <= 2 ? ZERO : needHash(exit), outcomeYes: outcome, hit, xpAwarded: xp, scoreDay: BigInt(state.targets.scoreDay) };
  same(gameResultHash({ programId: pk(PROGRAMS.core).toBuffer(), economyHash: bytes(ctx.economy.economyHash), player: pk(PAYER).toBuffer(), nonce: 0n, result, facts }), r.gameResultHash, 'game result hash mismatch');
  same(historyRowHash(0n, result), e.rowHash, 'archive row hash mismatch');
  same(historyChainFold(ZERO, e.rowHash), e.resultsRoot, 'archive history fold mismatch');
  same(e.resultsRoot, history.resultsRoot, 'on-chain history root mismatch');
  fact(history.pendingCount === 1 && history.terminalMask === 1 && history.terminalCount === 1, 'history terminal count mismatch');
  const isVoid = r.state === 5, credits = isVoid ? 10000n : hit ? 10070n : 9900n;
  fact(ledger.credits === credits && ledger.xp === xp && ledger.open === 0 && ledger.lockedCredits === 0n && ledger.nextShotNonce === 1n
    && ledger.reservedPayoutCredits === 0n && ledger.reservedXp === 0n && ledger.legacyCredits === 10000n && ledger.legacyXp === 0n
    && ledger.shots === (isVoid ? 0n : 1n) && ledger.voids === (isVoid ? 1n : 0n) && ledger.hits === BigInt(hit)
    && ledger.refundedCredits === (isVoid ? 100n : 0n) && ledger.retiredCredits === (isVoid ? 0n : 100n), 'terminal ledger outcome/refund mismatch');
  // The archive's proofMaterial contains the revealed salt. Verify it in memory,
  // then publish only hashes and public outcome/accounting, never that material.
  return { outcome: isVoid ? 'VOID' : hit ? 'HIT' : 'MISS', voidReason: result.voidReason, refundCredits: isVoid ? '100' : '0',
    credits: String(credits), xp: String(xp), gameResultHash: hex(r.gameResultHash), rowHash: hex(e.rowHash), resultsRoot: hex(history.resultsRoot), shotClosed: true };
}

async function confirmedTransaction(connection, signature) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (tx) return tx;
    await sleep(2000);
  }
  throw new Error('confirmed transaction unavailable: ' + signature);
}

export async function sendVerified({ connection, signer, instruction, expected, readBack, name, sender = sendOne, log = () => {}, onSignature = () => {} }) {
  fact(signer?.publicKey?.toBase58() === PAYER, 'designated signer required');
  assertBoundary(await connection.getGenesisHash(), signer.publicKey.toBase58());
  // Do not print simulation logs: a future event may carry reveal material.
  const result = await sender({ connection, web3, instruction, signer, mode: 'send', expect: expected, log: () => {} });
  if (!result.sent && name.startsWith('capture_') && result.simulation?.err
    && result.simulation.logs?.some(line => /WrongExpectedMessageHash|CaptureIsNotEarlier|CandidateRequired|CaptureClosed|CaptureDeadlinePassed|DuplicateMustUseFirstCapture/.test(line))) {
    const error = new Error('source or Need changed before simulation; refreshing both Needs'); error.retryObservation = true; throw error;
  }
  fact(result.sent && result.signature, name + ' was not sent: ' + (result.reason || 'unknown'));
  onSignature(result.signature);
  fact(result.confirmation?.err === null && result.evidence?.evidence === true, name + ' lacks successful confirmation/readback');
  const transaction = await confirmedTransaction(connection, result.signature);
  const transactionEvidence = verifyTransaction(transaction, result.signature, instruction);
  const values = await readBack(transaction);
  fact(values?.evidence === true, name + ' decoded postcondition failed');
  log(name + ' confirmed ' + result.signature);
  return { step: name, ok: true, signature: result.signature, transaction: transactionEvidence, readBack: values };
}

export async function runPlay({ connection, ctx, state, signer, send = false, receipt, persist = () => {}, log = console.log,
  maxSeconds = 5400, poll = sleep, sender = sendOne, unchanged = () => {} }) {
  let tick = null, lastNote = '', started = Date.now(), watchingSaved = false;
  const note = text => { if (text !== lastNote) { lastNote = text; log(text); } };
  const save = status => { receipt.status = status; receipt.updatedAt = new Date().toISOString(); receipt.landed = receipt.steps.filter(s => s.ok).length;
    receipt.sealSignature = receipt.steps.find(s => s.step === 'seal_forward' && s.ok)?.signature;
    receipt.settleSignature = receipt.steps.find(s => s.step === 'settle_final' && s.ok)?.signature;
    const check = checkRunReceipt(receipt, { expect: { programs: PROGRAMS } }); fact(check.ok, check.problems.join('; ')); if (send) persist(receipt); };
  const ledgerHistory = async () => {
    const infos = await connection.getMultipleAccountsInfo([ctx.addresses.ledger, ctx.addresses.historyPage], 'confirmed');
    return { ledger: ctx.c.validateLedgerAccount({ address: ctx.addresses.ledger, info: infos[0], economy: ctx.economy, player: PAYER }),
      history: ctx.c.validateHistoryPageAccount({ address: ctx.addresses.historyPage, info: infos[1], economy: ctx.economy, player: PAYER, pageIndex: 0n }),
      accounts: [accountEvidence(ctx.addresses.ledger, infos[0]), accountEvidence(ctx.addresses.historyPage, infos[1])] };
  };
  const perform = async (name, instruction, expected, verify) => {
    if (!send) { note('DRY RUN: ' + name + '; no transaction sent'); return false; }
    unchanged();
    let step;
    try { step = await sendVerified({ connection, signer, instruction, expected, name, sender, log,
      onSignature: signature => { receipt.pending = { step: name, signature }; save('VERIFYING'); }, readBack: verify }); }
    catch (error) { if (error.retryObservation) { note(error.message); return false; } throw error; }
    receipt.steps.push(step); delete receipt.pending; save('RUNNING'); return true;
  };
  try {
    for (;;) {
      tick = await readTick(connection, ctx, state, tick);
      authenticateSource(ctx.modelSpec, ctx.spec.priceAccount, tick.infos.get(ctx.spec.priceAccount));
      if (!tick.shot) {
        const terminalNames = ['reveal', 'void_pending_entry', 'void_active_shot', 'finalize_resolved_void'];
        let record = receipt.pending && terminalNames.includes(receipt.pending.step) ? receipt.pending : [...receipt.steps].reverse().find(s => terminalNames.includes(s.step) && s.ok);
        // Crash recovery: inspect only this named Shot's history, never a broad scan.
        if (!record) {
          const signatures = await connection.getSignaturesForAddress(ctx.addresses.shot, { limit: 12 }, 'confirmed');
          for (const row of signatures.filter(r => r.err === null)) {
            const tx = await confirmedTransaction(connection, row.signature);
            const events = extractShotArchivedReceipts(tx, { coreProgramId: PROGRAMS.core });
            if (events.some(r => r.event.nonce === 0n && bytes(r.event.economyHash).equals(bytes(ctx.economy.economyHash)))) {
              const r = events.find(r => r.event.nonce === 0n).event.result;
              record = { step: r.state === 4 ? 'reveal' : r.voidReason <= 2 ? 'void_pending_entry' : r.voidReason <= 4 ? 'void_active_shot' : 'finalize_resolved_void', signature: row.signature }; break;
            }
          }
        }
        fact(record, 'Shot absent without an authenticated terminal transaction');
        const tx = await confirmedTransaction(connection, record.signature), ix = await coreInstruction(ctx, state, null, tick.needs, record.step);
        const transaction = verifyTransaction(tx, record.signature, ix), values = await ledgerHistory();
        const terminal = verifyTerminal(ctx, state, tick, values.ledger, values.history, tx);
        if (!receipt.steps.some(s => s.signature === record.signature && s.ok)) receipt.steps.push({ ...record, ok: true, transaction, readBack: { evidence: true, ...terminal, accounts: values.accounts } });
        receipt.result = terminal; delete receipt.pending; save(terminal.outcome === 'VOID' ? 'VOID' : 'COMPLETED'); return receipt;
      }
      if (send && !watchingSaved) { save('WATCHING'); watchingSaved = true; }
      let acted = false;
      // Both Needs are considered on every tick, before Core activation/settlement.
      for (let i = 0; i < 2; i++) {
        const need = tick.needs[i], kind = i ? 'exit' : 'entry';
        if (['Final', 'Expired', 'Ambiguous'].includes(need.state)) continue;
        if (tick.clock.nowTs >= need.captureDeadlineTs) {
          const name = need.state === 'Candidate' ? 'finalize' : 'expire';
          const ix = timepinInstruction(ctx, need, name);
          acted = await perform(name + '_' + kind, ix, { address: pk(need.address).toBase58(), owner: PROGRAMS.timepin, discriminator: Buffer.from(ACCOUNT_DISCRIMINATOR.TimepinNeedV2, 'hex') }, async () => {
            tick = await readTick(connection, ctx, state, tick); fact(tick.needs[i].state === (name === 'finalize' ? 'Final' : 'Expired'), 'Need terminal postcondition mismatch');
            return { evidence: true, need: pk(need.address).toBase58(), state: tick.needs[i].state, candidateHash: hex(tick.needs[i].candidateAHash), clockSlot: String(tick.clock.slot) };
          });
        } else {
          let decision = chooseCapture(ctx.modelSpec, need, tick.candidates[i], tick.source, tick.clock, ctx.generation);
          if (!decision.action) continue;
          // Refresh generation and the batched print immediately before choosing the signed hash.
          if (send) { ctx.generation = await readGeneration(connection); tick = await readTick(connection, ctx, state, tick);
            decision = chooseCapture(ctx.modelSpec, tick.needs[i], tick.candidates[i], tick.source, tick.clock, ctx.generation); if (!decision.action) continue; }
          const current = tick.needs[i], hash = decision.messageHash, ix = timepinInstruction(ctx, current, decision.action, hash);
          acted = await perform(decision.action + '_' + kind, ix, { address: pk(current.address).toBase58(), owner: PROGRAMS.timepin, discriminator: Buffer.from(ACCOUNT_DISCRIMINATOR.TimepinNeedV2, 'hex') }, async () => {
            tick = await readTick(connection, ctx, state, tick); const after = tick.needs[i];
            fact(after.state === 'Candidate', 'capture did not leave a Candidate Need'); same(after.candidateAHash, hash, 'capture selected a different message');
            const candidate = tick.candidates[i]; fact(candidate, 'captured Candidate unreadable');
            return { evidence: true, need: pk(after.address).toBase58(), state: after.state, candidate: pk(candidate.address).toBase58(), messageHash: hex(hash),
              price: String(candidate.price), conf: String(candidate.conf), exponent: candidate.exponent, publishTime: String(candidate.publishTime), postedSlot: String(candidate.postedSlot), captureSlot: String(candidate.captureSlot), captureTs: String(candidate.captureTs) };
          });
        }
        if (!send) return { ...receipt, status: 'DRY_RUN' };
        if (acted) break;
      }
      if (acted) continue;
      const name = nextCoreAction(tick.shot, tick.needs, tick.clock);
      if (name) {
        const terminal = ['reveal', 'void_pending_entry', 'void_active_shot', 'finalize_resolved_void'].includes(name);
        const ix = await coreInstruction(ctx, state, tick.shot, tick.needs, name);
        const expectedAddress = terminal ? ctx.addresses.ledger : ctx.addresses.shot;
        const expected = { address: expectedAddress.toBase58(), owner: PROGRAMS.core, discriminator: Buffer.from(ACCOUNT_DISCRIMINATOR[terminal ? 'PlayerLedger' : 'Shot'], 'hex') };
        await perform(name, ix, expected, async tx => {
          tick = await readTick(connection, ctx, state, tick);
          if (terminal) { const values = await ledgerHistory(); const result = verifyTerminal(ctx, state, tick, values.ledger, values.history, tx); receipt.result = result; return { evidence: true, ...result, accounts: values.accounts }; }
          fact(tick.shot && (name === 'activate_entry' ? tick.shot.state === 2 : [3, 7].includes(tick.shot.state)), 'Core state transition missing');
          const n = tick.needs[name === 'activate_entry' ? 0 : 1], c = tick.candidates[name === 'activate_entry' ? 0 : 1], prefix = name === 'activate_entry' ? 'entry' : 'exit';
          same(tick.shot[prefix + 'MessageHash'], n.candidateAHash, 'Shot message hash mismatch');
          fact(tick.shot[prefix + 'Price'] === c.price && tick.shot[prefix + 'Conf'] === c.conf && tick.shot[prefix + 'Exponent'] === c.exponent && tick.shot[prefix + 'PublishTime'] === c.publishTime, 'Shot price fields mismatch');
          same(tick.shot[prefix + 'TimepinResultHash'], timepinResultHash({ ...n, state: n.numericState, key: n.address }), 'Shot Timepin result mismatch');
          return { evidence: true, shot: ctx.addresses.shot.toBase58(), state: tick.shot.state, messageHash: hex(n.candidateAHash), revealDeadlineTs: String(tick.shot.revealDeadlineTs) };
        });
        if (!send) return { ...receipt, status: 'DRY_RUN', nextStep: name };
        if (terminal) { save(receipt.result.outcome === 'VOID' ? 'VOID' : 'COMPLETED'); return receipt; }
        continue;
      }
      note('Clock ' + String(tick.clock.nowTs / 30n * 30n) + ': entry ' + tick.needs[0].state + ', exit ' + tick.needs[1].state + ', Shot ' + tick.shot.state);
      if (!send) return { ...receipt, status: 'DRY_RUN', nextStep: 'WAIT_FOR_REAL_CLOCK', states: tick.needs.map(n => n.state) };
      if (Date.now() - started >= maxSeconds * 1000) { save('TIMED_OUT'); return receipt; }
      await poll(2000);
    }
  } catch (error) { receipt.failure = { message: String(error.message) }; save('FAILED'); throw error; }
}

function regular(file) { fact(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), 'expected regular file: ' + file); }
function writePublic(file, receipt) {
  const dir = path.dirname(file); fact(fs.realpathSync(dir) === dir, 'receipt directory cannot be a link');
  if (fs.existsSync(file)) regular(file);
  const temp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(temp, json(receipt), { flag: 'wx', mode: 0o644 }); fs.renameSync(temp, file);
}

export async function main(argv = process.argv.slice(2)) {
  const opt = parseArgs(argv); if (opt.help) { console.log('node tools/g2-devnet-play.mjs --rpc URL [--keypair PATH] [--send] [--max-seconds 5400]\nDefault: one read-only observation of the saved devnet shot.'); return; }
  const connection = withReadRetries(new web3.Connection(opt.rpc, 'confirmed')); assertBoundary(await connection.getGenesisHash());
  const signer = opt.keypair ? loadSigner(web3, path.resolve(opt.keypair)) : null; if (signer) assertBoundary(DEVNET_GENESIS, signer.publicKey.toBase58());
  regular(STATE); const stateBytes = fs.readFileSync(STATE), state = JSON.parse(stateBytes);
  const manifestPath = path.join(ROOT, 'releases/g2-mainnet-economy.json'), manifestBytes = fs.readFileSync(manifestPath);
  const generation = await readGeneration(connection), clock = await readClock(connection);
  const ctx = await buildContext({ manifest: JSON.parse(manifestBytes), manifestSha256: sha(manifestBytes), state, generation, clock });
  const baseKeys = [pk(PROGRAMS.core), pk(PROGRAMS.timepin), ctx.addresses.economy, ctx.addresses.ruleset, ctx.addresses.evidenceSpec, pk(ctx.spec.priceAccount)];
  const infos = await connection.getMultipleAccountsInfo(baseKeys, 'confirmed');
  for (const info of infos.slice(0, 2)) fact(info?.executable && info.owner.equals(ctx.c.loaderProgram), 'program not deployed under expected loader');
  await ctx.c.validateEconomyAccount({ address: ctx.addresses.economy, info: infos[2], expectedHash: ctx.economy.economyHash });
  await ctx.c.validateRulesetAccount({ address: ctx.addresses.ruleset, info: infos[3], economy: ctx.economy, expectedHash: ctx.ruleset.rulesetHash });
  const storedSpec = await ctx.c.validateEvidenceSpecAccount({ address: ctx.addresses.evidenceSpec, info: infos[4], expectedHash: ctx.spec.specHash });
  ctx.modelSpec = { ...ctx.spec.args, registeredSlot: storedSpec.registeredSlot }; ctx.generation = generation;
  const valid = validateGeneration(ctx.modelSpec, generation, clock.slot); fact(valid.ok, 'live oracle generation mismatch: ' + valid.code);
  authenticateSource(ctx.modelSpec, ctx.spec.priceAccount, infos[5]);
  if (!state.targets) { fact(!opt.send, 'NOT_SEALED: run the reviewed timed bootstrap before --send'); console.log(json({ status: 'NOT_SEALED', clusterGenesis: DEVNET_GENESIS, sourceAuthenticated: true, generationAuthenticated: true, sends: 0 })); return; }
  const bootstrapPath = path.join(ROOT, 'docs/receipts/g2-devnet-bootstrap.json'), bootstrap = JSON.parse(fs.readFileSync(bootstrapPath));
  same(Buffer.from(bootstrap.economyHash, 'hex'), ctx.economy.economyHash, 'bootstrap economy receipt mismatch');
  fact(checkRunReceipt(bootstrap, { expect: { programs: PROGRAMS } }).ok && bootstrap.sealSignature, 'actual bootstrap seal receipt required');
  const seal = await ctx.c.sealForwardIx({ player: PAYER, economyHash: ctx.economy.economyHash, rulesetHash: ctx.ruleset.rulesetHash, evidenceSpecHash: ctx.spec.specHash,
    nonce: 0n, commit: ctx.commit, stake: 100n, entryTargetTs: BigInt(state.targets.entryTargetTs), horizonSeconds: 300, scoreDay: BigInt(state.targets.scoreDay) });
  verifyTransaction(await confirmedTransaction(connection, bootstrap.sealSignature), bootstrap.sealSignature, seal);
  let receipt = { schema: 1, clusterGenesis: DEVNET_GENESIS, programs: PROGRAMS, payer: PAYER, sourceManifestSha256: state.manifestSha256,
    economyHash: hex(ctx.economy.economyHash), rulesetHash: hex(ctx.ruleset.rulesetHash), commitment: hex(ctx.commit), bootstrapReceiptSha256: sha(fs.readFileSync(bootstrapPath)),
    steps: bootstrap.steps.filter(s => s.ok), status: 'STARTING', createdAt: new Date().toISOString() };
  if (fs.existsSync(RECEIPT)) {
    regular(RECEIPT); const old = JSON.parse(fs.readFileSync(RECEIPT));
    fact(old.economyHash === receipt.economyHash && old.commitment === receipt.commitment && old.bootstrapReceiptSha256 === receipt.bootstrapReceiptSha256, 'existing play receipt belongs to a different run');
    fact(checkRunReceipt(old, { expect: { programs: PROGRAMS } }).ok, 'existing play receipt invalid'); receipt = old;
  }
  const unchanged = () => { same(fs.readFileSync(STATE), stateBytes, 'private bootstrap state changed during play'); same(fs.readFileSync(manifestPath), manifestBytes, 'approved manifest changed during play'); };
  let lock = null; const lockPath = path.join(path.dirname(STATE), 'devnet-play.lock');
  try {
    if (opt.send) lock = fs.openSync(lockPath, 'wx', 0o600);
    const result = await runPlay({ connection, ctx, state, signer, send: opt.send, receipt, maxSeconds: opt.maxSeconds, unchanged,
      persist: value => { writePublic(RECEIPT, value); writePublic(RELEASE, value); } });
    console.log(json(result));
    if (['TIMED_OUT', 'FAILED'].includes(result.status)) process.exitCode = 1;
  } finally { if (lock !== null) { fs.closeSync(lock); fs.unlinkSync(lockPath); } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error('DEVNET PLAY REFUSED: ' + error.message); process.exitCode = 1; });
