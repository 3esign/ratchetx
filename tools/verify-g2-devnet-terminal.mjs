#!/usr/bin/env node
// Independent, read-only verification of the single public G2 devnet run.
// No bootstrap/runtime imports, signer inputs, sending, or private file reads.
// Hash preimages follow Core state.rs / Timepin lifecycle.rs directly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import assert from 'node:assert/strict';
import * as web3 from '@solana/web3.js';
import bs58 from 'bs58';
import { createCoreG2Client, INSTRUCTION_ACCOUNTS } from '../onchain/ratchet-core-g2/client/client-v2.mjs';
import { extractShotArchivedReceipts } from '../onchain/ratchet-core-g2/client/shot-receipt.mjs';
import { validateCandidate, deriveCandidatePda, deriveWorkPagePda, derivePushSourcePda } from '../onchain/rcx-timepin/model-v2.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOT = 'docs/receipts/g2-devnet-bootstrap.json', RUN = 'releases/g2-devnet-run.json';
const OUT = 'docs/receipts/g2-devnet-terminal-independent-20260906.json';
const PROGRAMS = { core: 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL', timepin: 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp' };
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const PLAYER = 'wJYFx75hzP9h2ujQQ6mpJWLeYgPSUdLtuWjrw881rKz';
const ZERO = Buffer.alloc(32), pk = v => new web3.PublicKey(v);
const b = v => v?.toBuffer ? v.toBuffer() : Buffer.from(v);
const requireFact = (ok, why) => { if (!ok) throw new Error(why); };
const same = (a, c, why) => requireFact(b(a).equals(b(c)), why);
const hash = (...parts) => createHash('sha256').update(Buffer.concat(parts.map(b))).digest();
const domain = s => Buffer.from(s + '\0');
const disc = (kind, name) => createHash('sha256').update(kind + ':' + name).digest().subarray(0, 8);
const u8 = n => Buffer.from([n]);
const u16 = n => { const x = Buffer.alloc(2); x.writeUInt16LE(n); return x; };
const u64 = n => { const x = Buffer.alloc(8); x.writeBigUInt64LE(BigInt(n)); return x; };
const i32 = n => { const x = Buffer.alloc(4); x.writeInt32LE(n); return x; };
const i64 = n => { const x = Buffer.alloc(8); x.writeBigInt64LE(BigInt(n)); return x; };
const asHex = x => b(x).toString('hex');
const json = x => JSON.stringify(x, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n';
const hex32 = s => { requireFact(typeof s === 'string' && /^[a-f0-9]{64}$/.test(s), 'Invalid public hash'); return Buffer.from(s, 'hex'); };

export function needResultHash(n) {
  if (n.state === 2) return hash(domain('rcx-timepin:evidence-set:v2'), n.address, n.candidateAHash);
  if (n.state === 3) return hash(domain('rcx-timepin:evidence-set:v2'), n.address, n.candidateAHash, n.candidateBHash);
  if (n.state === 4) return hash(domain('rcx-timepin:expired:v2'), n.address, i64(n.targetTs));
  throw new Error('Need is not terminal');
}
export function archiveHashes({ economyHash, player, nonce, result: r, facts }) {
  requireFact(r.state === 4 || r.state === 5, 'This run must reveal or VOID, not forfeit');
  requireFact(r.stake > 0n && r.sealedTs > 0n && r.entryTargetTs > 0n && r.exitTargetTs > r.entryTargetTs, 'Invalid archive terms');
  if (r.state === 4) requireFact(r.voidReason === 0 && r.side <= 1 && r.pBps > 0 && r.pBps < 10000, 'Invalid reveal shape');
  else requireFact(r.voidReason >= 1 && r.voidReason <= 6 && r.side === 0 && r.pBps === 0 && !b(r.proofMaterial).equals(ZERO), 'Invalid VOID shape');
  const commit = r.state === 4
    ? hash(domain('rcx-core:commitment:g2'), pk(PROGRAMS.core), economyHash, r.rulesetHash, player, u64(nonce), u8(r.side), u16(r.pBps), r.proofMaterial)
    : b(r.proofMaterial);
  const game = hash(domain('rcx-core:game-result:g2'), pk(PROGRAMS.core), economyHash, player, u64(nonce), r.rulesetHash, commit,
    u64(r.stake), i64(r.sealedTs), i64(r.entryTargetTs), i64(r.exitTargetTs), u8(r.state), u8(r.voidReason), u8(r.side), u16(r.pBps), r.delegate,
    facts.entryTimepinResultHash, facts.exitTimepinResultHash, u8(facts.outcomeYes), u8(facts.hit), u64(facts.xpAwarded), i64(facts.scoreDay));
  const rowBytes = Buffer.concat([b(r.rulesetHash), b(r.proofMaterial), u8(r.state), u8(r.voidReason), u64(r.stake), i64(r.sealedTs),
    i64(r.entryTargetTs), i64(r.exitTargetTs), u8(r.side), u16(r.pBps), b(r.delegate), b(r.gameResultHash)]);
  requireFact(rowBytes.length === 165, 'ShotResult ABI size mismatch');
  const row = hash(domain('rcx-core:history-row:g2'), u64(nonce), rowBytes);
  return { commit, game, row, root: hash(domain('rcx-core:history-chain:g2'), ZERO, row) };
}
const isqrt = n => { let x = 0n, y = n + 1n; while (y > x + 1n) { const m = (x + y) / 2n; if (m * m <= n) x = m; else y = m; } return x; };
export function terminalMath(r, candidates, needs, economy, rules) {
  const scale = c => { requireFact(c && c.exponent >= -12 && c.exponent <= 2 && c.price > 0n, 'Bad terminal candidate'); return c.price * 10n ** BigInt(12 + c.exponent); };
  let hit = 0, outcomeYes = 0, xp = 0n, payout = 0n, brier = 0n;
  if (r.state === 4) {
    requireFact(needs.every(n => n.state === 2) && r.side === 1 && r.pBps === 6000 && r.voidReason === 0, 'Wrong reveal facts');
    const delta = scale(candidates[1]) - scale(candidates[0]); requireFact(delta !== 0n && rules.bandNumerator === 0, 'Equality or unsupported confidence band');
    outcomeYes = Number(delta > 0n); hit = Number((r.side === 1) === (outcomeYes === 1));
    const base = ((isqrt(rules.baseXp * rules.baseXp * r.stake) / 5n + 1n) / 2n) || 1n;
    xp = economy.settleXp + (hit ? base : 0n);
    payout = hit ? r.stake * economy.hitPayoutNumerator / economy.hitPayoutDenominator : 0n;
    const error = BigInt(r.pBps) - (outcomeYes ? 10000n : 0n); brier = error * error;
  } else {
    const wanted = needs[0].state === 4 ? 1 : needs[0].state === 3 ? 2 : needs[1].state === 4 ? 3 : needs[1].state === 3 ? 4
      : needs.every(n => n.state === 2) && scale(candidates[0]) === scale(candidates[1]) ? 5 : null;
    requireFact(r.state === 5 && wanted !== null && r.voidReason === wanted, 'VOID reason disagrees with immutable Needs');
  }
  const voided = r.state === 5;
  return { outcome: voided ? 'VOID' : hit ? 'HIT' : 'MISS', outcomeYes, hit, xpAwarded: xp,
    expectedLedger: { credits: voided ? 10000n : 10000n - r.stake + payout, lockedCredits: 0n, xp, legacyCredits: 10000n, reloadCredits: 0n,
      payoutCredits: payout, reservedPayoutCredits: 0n, retiredCredits: voided ? 0n : r.stake, refundedCredits: voided ? r.stake : 0n,
      legacyXp: 0n, earnedXp: xp, reservedXp: 0n, hits: BigInt(hit), shots: voided ? 0n : 1n, voids: voided ? 1n : 0n, forfeits: 0n,
      sealed: 1n, open: 0, brierSum: brier, nextShotNonce: 1n, nextReloadNonce: 0n, rcxBurned: 0n, rcxRouted: 0n, rcxReloaded: 0n, rcxRetained: 0n } };
}
export function signedInstruction(tx, signature, crate, name) {
  requireFact(tx && tx.meta?.err === null && Number.isSafeInteger(tx.slot) && tx.slot > 0, 'Transaction absent/failed or slot invalid: ' + name);
  requireFact(tx.version === undefined || tx.version === 'legacy', 'Expected the observed legacy transaction format');
  const raw = tx.transaction?.message, sigs = tx.transaction?.signatures;
  requireFact(raw && Array.isArray(raw.accountKeys) && sigs?.[0] === signature && sigs.length === raw.header.numRequiredSignatures, 'Transaction signature/message shape mismatch');
  const message = new web3.Message(raw), encoded = message.serialize();
  for (let i = 0; i < sigs.length; i++) {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pk(raw.accountKeys[i]).toBuffer()]), format: 'der', type: 'spki' });
    requireFact(edVerify(null, encoded, key, bs58.decode(sigs[i])), 'Invalid cryptographic transaction signature');
  }
  requireFact(raw.accountKeys[0] === PLAYER && sigs.length === 1, 'Wrong designated devnet payer');
  const program = crate === 'ratchet-core-g2' ? PROGRAMS.core : PROGRAMS.timepin, table = INSTRUCTION_ACCOUNTS[crate][name].accounts;
  const matches = raw.instructions.filter(ix => raw.accountKeys[ix.programIdIndex] === program && b(bs58.decode(ix.data)).subarray(0, 8).equals(disc('global', name)));
  requireFact(matches.length === 1 && raw.instructions.length === 1, 'Expected one exact program instruction: ' + name);
  const ix = matches[0]; requireFact(ix.accounts.length === table.length, 'Instruction account count mismatch: ' + name);
  const accounts = Object.fromEntries(table.map((a, i) => [a.name, raw.accountKeys[ix.accounts[i]]]));
  for (let i = 0; i < table.length; i++) {
    if (table[i].signer) requireFact(message.isAccountSigner(ix.accounts[i]), 'Missing instruction signer');
    if (table[i].mut) requireFact(message.isAccountWritable(ix.accounts[i]), 'Missing writable account');
  }
  return { accounts, data: b(bs58.decode(ix.data)), slot: tx.slot, messageSha256: asHex(hash(encoded)) };
}
// Only complete successful top-level invocation logs are accepted. Failed CPIs
// are excluded even when caught by the parent. No arbitrary Program log parsing.
export function programEvents(tx, program, eventName) {
  const logs = tx.meta?.logMessages; requireFact(Array.isArray(logs), 'Missing transaction logs');
  const stack = [], done = [], wanted = disc('event', eventName);
  for (const line of logs) {
    requireFact(typeof line === 'string' && !/^Logs? truncated/i.test(line), 'Truncated logs');
    if (line.startsWith('Program log:')) continue;
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[([1-9][0-9]*)\]$/.exec(line);
    const end = /^Program ([1-9A-HJ-NP-Za-km-z]+) (success|failed: .+)$/.exec(line);
    if (invoke) { requireFact(Number(invoke[2]) === stack.length + 1, 'Invalid invocation nesting'); stack.push({ program: invoke[1], events: [] }); }
    else if (end) { const frame = stack.pop(); requireFact(frame?.program === end[1], 'Invalid invocation completion'); if (end[2] === 'success') (stack.at(-1)?.events || done).push(...frame.events); }
    else if (line.startsWith('Program data: ')) {
      requireFact(stack.length, 'Event outside invocation');
      if (stack.at(-1).program === program) { const data = Buffer.from(line.slice(14), 'base64'); if (data.subarray(0, 8).equals(wanted)) stack.at(-1).events.push(data); }
    } else requireFact(!/^Program \S+ (invoke|success|failed)\b/.test(line), 'Malformed invocation provenance');
  }
  requireFact(!stack.length, 'Unfinished invocation logs'); return done;
}
export function decodeCandidate(spec, need, messageHash, address, info) {
  requireFact(info && !info.executable && info.owner.equals(pk(PROGRAMS.timepin)), 'Candidate owner/executable mismatch');
  const x = b(info.data); requireFact(x.length === 119, 'Candidate size'); same(x.subarray(0,8), disc('account','CandidateV2'), 'Candidate discriminator');
  let o = 8; const take = n => { const v=x.subarray(o,o+n);o+=n;return v; }, rd=(name,n)=>{const v=x[name](o);o+=n;return v;};
  const value = { address: pk(address).toBuffer(), schema: rd('readUInt16LE',2), bump: rd('readUInt8',1), need:take(32),price:rd('readBigInt64LE',8),
    conf:rd('readBigUInt64LE',8),exponent:rd('readInt32LE',4),publishTime:rd('readBigInt64LE',8),prevPublishTime:rd('readBigInt64LE',8),
    emaPrice:rd('readBigInt64LE',8),emaConf:rd('readBigUInt64LE',8),postedSlot:rd('readBigUInt64LE',8),captureSlot:rd('readBigUInt64LE',8),captureTs:rd('readBigInt64LE',8) };
  requireFact(o === x.length, 'Candidate trailing data');
  const preimage = Buffer.concat([domain('rcx-timepin:pyth-price-message:v2'), b(spec.args.feedId), i64(value.price), u64(value.conf), i32(value.exponent), i64(value.publishTime), i64(value.prevPublishTime), i64(value.emaPrice), u64(value.emaConf)]);
  same(hash(preimage), messageHash, 'Independent Candidate message preimage mismatch'); value.messagePreimageHex = asHex(preimage);
  const valid = validateCandidate({ ...spec.args, registeredSlot: spec.registeredSlot }, need, value, messageHash, pk(PROGRAMS.timepin).toBuffer());
  requireFact(valid.ok, 'Candidate constraints: ' + valid.code); return value;
}
export async function verifyRun({ rpc, terminalSignature, evidence }) {
  const bootBytes = fs.readFileSync(path.join(ROOT,BOOT)), runBytes = fs.readFileSync(path.join(ROOT,RUN));
  const boot = JSON.parse(bootBytes), run = JSON.parse(runBytes);
  requireFact(boot.clusterGenesis === GENESIS && run.clusterGenesis === GENESIS && boot.payer === PLAYER && run.payer === PLAYER, 'Public run identity mismatch');
  for (const name of ['core','timepin']) requireFact(boot.programs[name] === PROGRAMS[name] && run.programs[name] === PROGRAMS[name], 'Program identity changed');
  for (const name of ['economyHash','rulesetHash','commitment']) requireFact(boot[name] === run[name], 'Receipt identity disagreement: ' + name);
  Object.assign(evidence, { inputs: { bootstrapPath:BOOT,bootstrapSha256:asHex(hash(bootBytes)),runPath:RUN,runSha256:asHex(hash(runBytes)),runStatus:run.status },
    clusterGenesis:GENESIS,programs:PROGRAMS,player:PLAYER,terminalSignature,raw:{transactions:{},accountBatches:[]},requests:[] });
  let id=0; const call=async(method,params=[])=>{
    requireFact(['getGenesisHash','getTransaction','getMultipleAccounts'].includes(method),'Read-only RPC method violation');
    const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});
    requireFact(response.ok,'RPC HTTP '+response.status+' for '+method);
    const responseText=await response.text(); evidence.requests.push({method,params,at:new Date().toISOString(),httpStatus:response.status,responseSha256:asHex(hash(Buffer.from(responseText)))});
    const value=JSON.parse(responseText); requireFact(!value.error,'RPC rejected '+method+': '+String(value.error?.code));
    requireFact(Object.hasOwn(value,'result'),'Missing RPC result'); return value.result;
  };
  requireFact(await call('getGenesisHash') === GENESIS,'RPC is not devnet');
  const transaction=async(signature)=>{
    requireFact(typeof signature==='string' && bs58.decode(signature).length===64,'Invalid public transaction signature');
    if(!evidence.raw.transactions[signature]) { const tx=await call('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
      requireFact(tx,'Finalized transaction unavailable; rerun only after finality'); evidence.raw.transactions[signature]=tx; }
    return evidence.raw.transactions[signature];
  };
  const step=name=>{const found=run.steps.filter(s=>s.step===name&&s.ok);requireFact(found.length===1,'Missing/duplicate public step '+name);return found[0];};
  const finalRows=run.steps.filter(s=>s.signature===terminalSignature&&s.ok);
  requireFact(finalRows.length===1 && ['reveal','void_pending_entry','void_active_shot','finalize_resolved_void'].includes(finalRows[0].step),'Terminal signature is not an actual terminal run step');
  const terminalTx=await transaction(terminalSignature), terminalIx=signedInstruction(terminalTx,terminalSignature,'ratchet-core-g2',finalRows[0].step);
  const sealRow=step('seal_forward'),sealTx=await transaction(sealRow.signature),seal=signedInstruction(sealTx,sealRow.signature,'ratchet-core-g2','seal_forward');
  requireFact(seal.data.length===72,'seal_forward ABI size');
  const nonce=seal.data.readBigUInt64LE(8),commit=seal.data.subarray(16,48),stake=seal.data.readBigUInt64LE(48),entryTs=seal.data.readBigInt64LE(56),scoreDay=seal.data.readBigInt64LE(64);
  requireFact(nonce===0n&&stake===100n&&seal.slot<terminalTx.slot,'Wrong nonce/stake/transaction order');same(commit,hex32(boot.commitment),'Seal commitment');
  const c=createCoreG2Client({web3,coreProgramId:PROGRAMS.core,timepinProgramId:PROGRAMS.timepin});
  const economyHash=hex32(boot.economyHash),rulesetHash=hex32(boot.rulesetHash),specHash=hex32(boot.evidenceSpecHash);
  const addresses={economy:c.economyPda(economyHash)[0],ruleset:c.rulesetPda(rulesetHash)[0],evidenceSpec:c.evidenceSpecPda(specHash)[0],
    ledger:c.ledgerPda(economyHash,PLAYER)[0],historyPage:c.historyPagePda(economyHash,PLAYER,nonce/16n)[0],shot:c.shotPda(economyHash,PLAYER,nonce)[0]};
  for(const [name,value] of Object.entries(addresses))requireFact(boot.addresses[name]===value.toBase58(),'Bootstrap PDA mismatch '+name);
  const accounts=async(named)=>{
    const keys=Object.values(named).map(x=>pk(x).toBase58());
    const batch=await call('getMultipleAccounts',[keys,{encoding:'base64',commitment:'finalized',minContextSlot:terminalTx.slot}]);
    requireFact(Number.isSafeInteger(batch?.context?.slot)&&batch.context.slot>=terminalTx.slot&&batch.value?.length===keys.length,'Incomplete/post-terminal account snapshot');
    evidence.raw.accountBatches.push({addresses:keys,...batch});
    return Object.fromEntries(Object.keys(named).map((name,i)=>{const a=batch.value[i];return[name,a?{...a,owner:pk(a.owner),data:Buffer.from(a.data[0],'base64')}:null];}));
  };
  const raw=await accounts({...addresses,payer:pk(PLAYER)});
  requireFact(raw.payer && Number.isSafeInteger(raw.payer.lamports), 'Payer balance missing'); evidence.payerBalanceLamports=raw.payer.lamports;
  requireFact(raw.shot===null,'Shot still exists at finalized commitment');
  const economy=await c.validateEconomyAccount({address:addresses.economy,info:raw.economy,expectedHash:economyHash});
  const ruleset=await c.validateRulesetAccount({address:addresses.ruleset,info:raw.ruleset,economy,expectedHash:rulesetHash});
  const spec=await c.validateEvidenceSpecAccount({address:addresses.evidenceSpec,info:raw.evidenceSpec,expectedHash:specHash});
  c.validateForwardKernel({economy,ruleset,evidenceSpec:spec});
  same(economy.args.clusterGenesisHash,pk(GENESIS),'Economy cluster');
  requireFact(economy.args.legacyLeafCount===1&&economy.args.legacyTotalCredits===10000n&&economy.args.legacyTotalXp===0n,'Wrong test allocation');
  requireFact(economy.args.hitPayoutNumerator===17n&&economy.args.hitPayoutDenominator===10n&&economy.args.settleXp===1n&&ruleset.args.baseXp===10n&&ruleset.args.horizonSeconds===300&&ruleset.args.bandNumerator===0,'Wrong fixed test economics');
  const exitTs=entryTs+BigInt(ruleset.args.horizonSeconds), needAddresses={entry:c.needPda(specHash,entryTs)[0],exit:c.needPda(specHash,exitTs)[0]};
  const rawNeeds=await accounts(needAddresses),needs=Object.entries(needAddresses).map(([name,address],i)=>({...c.validateNeedAccount({address,info:rawNeeds[name],evidenceSpec:spec,targetTs:i?exitTs:entryTs,requireOpen:false}),address:address.toBuffer()}));
  requireFact(needs.every(n=>[2,3,4].includes(n.state)),'Both Needs must be finalized; incomplete oracle proof');
  requireFact(scoreDay===(needs[1].captureDeadlineTs+BigInt(economy.args.revealWindowSeconds))/86400n,'Seal score day mismatch');
  const candidates=[null,null], candidateAddresses={};
  for(let i=0;i<2;i++)if(needs[i].state===2)candidateAddresses[i]=pk(deriveCandidatePda(pk(PROGRAMS.timepin).toBuffer(),needs[i].address,needs[i].candidateAHash).address);
  const rawCandidates=Object.keys(candidateAddresses).length?await accounts(candidateAddresses):{};
  for(const [i,address] of Object.entries(candidateAddresses))candidates[i]=decodeCandidate(spec,needs[i],needs[i].candidateAHash,address,rawCandidates[i]);
  const coreCommon={player:PLAYER,actor:PLAYER,rent_refund:PLAYER,economy:addresses.economy,ruleset:addresses.ruleset,ledger:addresses.ledger,shot:addresses.shot,
    history_page:addresses.historyPage,entry_need:needAddresses.entry,exit_need:needAddresses.exit,evidence_spec:addresses.evidenceSpec,
    system_program:web3.SystemProgram.programId,player_day:c.playerDayPda(economyHash,scoreDay,PLAYER)[0],rank_shard:(await c.rankShardPda(economyHash,scoreDay,PLAYER))[0],
    work_page:web3.PublicKey.findProgramAddressSync([Buffer.from('work_page'),economyHash,pk(PLAYER).toBuffer(),u64(nonce)],pk(PROGRAMS.core))[0],
    entry_candidate:candidateAddresses[0],exit_candidate:candidateAddresses[1]};
  const bind=(ix,known)=>{for(const [name,address]of Object.entries(ix.accounts)){requireFact(known[name]!==undefined,'No independent binding for '+name);requireFact(address===pk(known[name]).toBase58(),'Instruction account mismatch '+name);}};
  bind(seal,coreCommon);bind(terminalIx,coreCommon);
  const oracle=[];
  for(let i=0;i<2;i++){
    const n=needs[i],kind=i?'exit':'entry',name=n.state===4?'expire':'finalize';
    requireFact(n.state!==3,'AMBIGUOUS is unsupported by this deployed total-order run; missing provenance');
    const row=step(name+'_'+kind),tx=await transaction(row.signature),ix=signedInstruction(tx,row.signature,'rcx-timepin-v2',name);
    const common={actor:PLAYER,evidence_spec:addresses.evidenceSpec,need:n.address,candidate:candidateAddresses[i],work_page:deriveWorkPagePda(pk(PROGRAMS.timepin).toBuffer(),n.address).address};
    bind(ix,common);requireFact(ix.data.length===8&&ix.slot<=terminalTx.slot&&ix.slot>seal.slot,'Invalid Need finalization order/args');
    const es=programEvents(tx,PROGRAMS.timepin,'NeedTerminalizedV2').filter(x=>x.length===105&&x.subarray(8,40).equals(n.address));
    requireFact(es.length===1&&es[0][40]===n.state,'Need terminal event missing/state mismatch');
    same(es[0].subarray(41,73),needResultHash(n),'Need terminal event hash');same(es[0].subarray(73,105),pk(PLAYER),'Need terminal actor');
    const proof={kind,need:pk(n.address).toBase58(),state:n.state,resultHash:asHex(needResultHash(n)),terminalSignature:row.signature,terminalSlot:tx.slot};
    if(candidates[i]){
      const choices=run.steps.filter(s=>s.ok&&['capture_first_'+kind,'capture_conflict_'+kind].includes(s.step)&&s.readBack?.messageHash===asHex(n.candidateAHash));
      requireFact(choices.length===1,'Selected Candidate capture receipt missing/duplicate');
      const capture=choices[0],ct=await transaction(capture.signature),captureName=capture.step.startsWith('capture_first')?'capture_first':'capture_conflict';
      const ci=signedInstruction(ct,capture.signature,'rcx-timepin-v2',captureName),candidate=candidates[i];
      requireFact(captureName==='capture_first','Conflict candidate needs explicit prior-candidate proof; not silently accepted');
      bind(ci,{...common,candidate:candidate.address,receiver_program:spec.args.receiverProgram,receiver_program_data:c.programDataPda(spec.args.receiverProgram)[0],
        receiver_config:c.receiverConfigPda(spec.args.receiverProgram)[0],wormhole_program:spec.args.wormholeProgram,wormhole_program_data:c.programDataPda(spec.args.wormholeProgram)[0],
        price_update:derivePushSourcePda({...spec.args,pushOracleProgram:b(spec.args.pushOracleProgram)}).address,system_program:web3.SystemProgram.programId});
      requireFact(ci.data.length===40&&BigInt(ct.slot)===candidate.captureSlot&&ct.slot<tx.slot&&ct.slot>seal.slot,'Capture slot/order/args mismatch');
      same(ci.data.subarray(8),n.candidateAHash,'Capture signed message hash');
      const ce=programEvents(ct,PROGRAMS.timepin,'EvidenceCapturedV2').filter(x=>x.length===106&&x.subarray(8,40).equals(n.address));
      requireFact(ce.length===1&&ce[0][104]===1&&ce[0][105]===1,'Capture event missing/disposition mismatch');
      same(ce[0].subarray(40,72),n.candidateAHash,'Capture event hash');same(ce[0].subarray(72,104),pk(PLAYER),'Capture event actor');
      Object.assign(proof,{captureSignature:capture.signature,captureSlot:ct.slot,candidate:pk(candidate.address).toBase58(),price:String(candidate.price),conf:String(candidate.conf),exponent:candidate.exponent,publishTime:String(candidate.publishTime),messageHash:asHex(n.candidateAHash),messagePreimageHex:candidate.messagePreimageHex});
    }
    oracle.push(proof);
  }
  const events=extractShotArchivedReceipts(terminalTx,{coreProgramId:PROGRAMS.core}).map(x=>x.event);
  const found=events.filter(e=>b(e.economyHash).equals(economyHash)&&b(e.player).equals(pk(PLAYER).toBuffer())&&e.nonce===nonce);
  requireFact(found.length===1,'Exact ShotArchived event missing/duplicate');
  const event=found[0],r=event.result;
  requireFact(event.pageIndex===0n&&event.slot===0&&event.sequence===1&&r.stake===stake&&r.entryTargetTs===entryTs&&r.exitTargetTs===exitTs,'Archive terms/slot mismatch');
  same(r.rulesetHash,rulesetHash,'Archive ruleset');same(r.delegate,ZERO,'Unexpected delegated shot');
  const math=terminalMath(r,candidates,needs,economy.args,ruleset.args);
  if(r.state===4){requireFact(finalRows[0].step==='reveal'&&terminalIx.data.length===43&&terminalIx.data[8]===r.side&&terminalIx.data.readUInt16LE(9)===r.pBps,'Reveal instruction terms');same(terminalIx.data.subarray(11),r.proofMaterial,'Reveal salt/event mismatch');}
  else requireFact(finalRows[0].step===(r.voidReason<=2?'void_pending_entry':r.voidReason<=4?'void_active_shot':'finalize_resolved_void')&&terminalIx.data.length===8,'VOID instruction/reason mismatch');
  if(r.voidReason!==1&&r.voidReason!==2){
    const ar=step('activate_entry'),at=await transaction(ar.signature),ai=signedInstruction(at,ar.signature,'ratchet-core-g2','activate_entry');bind(ai,coreCommon);
    requireFact(ai.data.length===8&&ai.slot>=oracle[0].terminalSlot&&ai.slot<terminalTx.slot,'Activation provenance/order');
    if(needs[1].state===2){
      const sr=step('settle_final'),st=await transaction(sr.signature),si=signedInstruction(st,sr.signature,'ratchet-core-g2','settle_final');bind(si,coreCommon);
      requireFact(si.data.length===8&&si.slot>=oracle[1].terminalSlot&&si.slot>=ai.slot&&si.slot<terminalTx.slot,'Settlement provenance/order');
    }
  }
  const facts={entryTimepinResultHash:needResultHash(needs[0]),exitTimepinResultHash:r.state===5&&r.voidReason<=2?ZERO:needResultHash(needs[1]),
    outcomeYes:math.outcomeYes,hit:math.hit,xpAwarded:math.xpAwarded,scoreDay};
  const hashes=archiveHashes({economyHash,player:pk(PLAYER).toBuffer(),nonce,result:r,facts});
  same(hashes.commit,commit,'Independent commitment mismatch');same(hashes.game,r.gameResultHash,'Independent gameResultHash mismatch');same(hashes.row,event.rowHash,'Independent rowHash mismatch');same(hashes.root,event.resultsRoot,'Independent resultsRoot mismatch');
  const ledger=c.validateLedgerAccount({address:addresses.ledger,info:raw.ledger,economy,player:PLAYER});
  for(const [name,value]of Object.entries(math.expectedLedger))requireFact(ledger[name]===value,'Ledger '+name+' mismatch');
  const history=c.validateHistoryPageAccount({address:addresses.historyPage,info:raw.historyPage,economy,player:PLAYER,pageIndex:0n});
  requireFact(history.pendingCount===1&&history.terminalMask===1&&history.terminalCount===1,'History counts mismatch');same(history.resultsRoot,hashes.root,'History account root mismatch');
  Object.assign(evidence,{status:'PASS',scope:'INDEPENDENT_FINALIZED_DEVNET_SINGLE_SHOT_TERMINAL_PROOF',verifiedAt:new Date().toISOString(),terminalSlot:terminalTx.slot,
    economyHash:asHex(economyHash),rulesetHash:asHex(rulesetHash),nonce:String(nonce),outcome:math.outcome,voidReason:r.voidReason,shotClosed:true,
    hashes:Object.fromEntries(Object.entries(hashes).map(([k,v])=>[k,asHex(v)])),facts,expectedLedger:math.expectedLedger,actualLedger:ledger,oracle,
    publicArchive:event,signatureVerification:'Native Ed25519 over each fetched serialized legacy transaction message',
    limitations:['Finality and execution metadata rely on the named RPC, not an independently replayed validator.',
      'Capture authenticity is witnessed by the finalized Timepin execution and immutable Candidate; historical mutable Pyth source bytes are not reconstructed.',
      'This verifier requires both Needs terminal; it does not cover an entry VOID that leaves the exit Need nonterminal.',
      'Only selected capture_first Candidates are covered; capture_conflict replacement requires additional prior-candidate proof.',
      'This is one devnet test shot, not deployment approval, mainnet readiness, or general keeper coverage.']});
  return evidence;
}
export async function selfTest(){
  const model=await import('../onchain/ratchet-core-g2/model.mjs'),econ=Buffer.alloc(32,2),player=pk(PLAYER).toBuffer(),rules=Buffer.alloc(32,3);
  const reasons=[null,'VOID_ENTRY_EXPIRED','VOID_ENTRY_AMBIGUOUS','VOID_EXIT_EXPIRED','VOID_EXIT_AMBIGUOUS','VOID_EQUALITY'];
  let checks=0;
  for(const [state,reason]of [[4,0],[5,1],[5,2],[5,3],[5,4],[5,5]]){
    const r={rulesetHash:rules,proofMaterial:Buffer.alloc(32,4),state,voidReason:reason,stake:100n,sealedTs:1800000001n,entryTargetTs:1800000300n,exitTargetTs:1800000600n,side:state===4?1:0,pBps:state===4?6000:0,delegate:ZERO,gameResultHash:ZERO};
    const facts={entryTimepinResultHash:Buffer.alloc(32,5),exitTimepinResultHash:reason===1||reason===2?ZERO:Buffer.alloc(32,6),outcomeYes:state===4?1:0,hit:state===4?1:0,xpAwarded:state===4?11n:0n,scoreDay:20833n};
    const modeled={...r,state:state===4?'Revealed':'Void',voidReason:reasons[reason]};
    r.gameResultHash=model.gameResultHash({programId:pk(PROGRAMS.core).toBuffer(),economyHash:econ,player,nonce:0n,result:modeled,facts});modeled.gameResultHash=r.gameResultHash;
    const actual=archiveHashes({economyHash:econ,player,nonce:0n,result:r,facts});
    assert.deepEqual(actual.game,r.gameResultHash);assert.deepEqual(actual.row,model.historyRowHash(0n,modeled));assert.deepEqual(actual.root,model.historyChainFold(ZERO,actual.row));
    assert.notDeepEqual(archiveHashes({economyHash:econ,player,nonce:0n,result:r,facts:{...facts,xpAwarded:facts.xpAwarded+1n}}).game,actual.game);checks+=4;
  }
  for(const [exit,outcome,xp,credits,brier]of [[201n,'HIT',11n,10070n,16000000n],[199n,'MISS',1n,9900n,36000000n]]){
    const result=terminalMath({state:4,voidReason:0,side:1,pBps:6000,stake:100n},[{price:200n,exponent:-8},{price:exit,exponent:-8}],[{state:2},{state:2}],{settleXp:1n,hitPayoutNumerator:17n,hitPayoutDenominator:10n},{baseXp:10n,bandNumerator:0});
    assert.equal(result.outcome,outcome);assert.equal(result.xpAwarded,xp);assert.equal(result.expectedLedger.credits,credits);assert.equal(result.expectedLedger.brierSum,brier);checks+=4;
  }
  console.log('Independent terminal verifier offline self-test PASS: '+checks+' assertions; no RPC');
}
async function main(argv=process.argv.slice(2)){
  if(argv.length===1&&argv[0]==='--self-test')return selfTest();
  if(argv.length===1&&argv[0]==='--help'){console.log('node tools/verify-g2-devnet-terminal.mjs --rpc URL --terminal-signature SIGNATURE\\nRead-only finalized proof; writes only the named public independent receipt. --self-test is offline.');return;}
  requireFact(argv.length===4&&argv[0]==='--rpc'&&argv[2]==='--terminal-signature','Exact args required: --rpc URL --terminal-signature SIGNATURE');
  const url=new URL(argv[1]);requireFact(['https:','http:'].includes(url.protocol),'Invalid RPC transport');
  requireFact(bs58.decode(argv[3]).length===64,'Invalid terminal signature');
  const evidence={schema:1,status:'INCOMPLETE',startedAt:new Date().toISOString(),rpcOrigin:url.origin,commitment:'finalized',scriptSha256:asHex(hash(fs.readFileSync(fileURLToPath(import.meta.url))))};
  try{await verifyRun({rpc:argv[1],terminalSignature:argv[3],evidence});}
  catch(error){evidence.status='FAIL';evidence.failure=String(error.message);process.exitCode=1;}
  const output=path.join(ROOT,OUT);requireFact(!fs.existsSync(output),'Independent receipt already exists; refusing overwrite');
  fs.writeFileSync(output,json(evidence),{flag:'wx',mode:0o644});
  console.log(json({status:evidence.status,outcome:evidence.outcome,failure:evidence.failure,receipt:OUT}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error('INDEPENDENT VERIFY REFUSED: '+error.message);process.exitCode=1;});
