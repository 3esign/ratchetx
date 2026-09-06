// Offline only. Public fixture identities, synthetic accounts and mocked sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as web3 from '@solana/web3.js';
import bs58 from 'bs58';
import { buildContext, newState, PAYER, PROGRAMS, DEVNET_GENESIS } from '../tools/g2-devnet-bootstrap.mjs';
import { parseArgs, authenticateSource, decodeCandidateAccount, compareCapture, chooseCapture, timepinInstruction,
  coreInstruction, nextCoreAction, verifyTransaction, verifyTerminal, sendVerified, runPlay, withReadRetries } from '../tools/g2-devnet-play.mjs';
import { createNeed, deriveCandidatePda, encodeCandidateV2, encodeTimepinNeedV2, hashPriceMessage } from '../onchain/rcx-timepin/model-v2.mjs';
import { createCoreG2Client, ACCOUNT_DISCRIMINATOR, INSTRUCTION_ACCOUNTS } from '../onchain/ratchet-core-g2/client/client-v2.mjs';
import { encodeShotResult, gameResultHash, historyRowHash, historyChainFold, timepinResultHash } from '../onchain/ratchet-core-g2/model.mjs';

const sha = b => createHash('sha256').update(b).digest(), zero = Buffer.alloc(32), pk = b => new web3.PublicKey(b);
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = n => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const byte = n => Buffer.from([n]);
const key = n => pk(Buffer.alloc(32, n));
const program = pd => Buffer.concat([Buffer.from([2,0,0,0]), pd.toBuffer()]);
const programdata = slot => Buffer.concat([Buffer.from([3,0,0,0]), u64(slot), byte(1), key(11).toBuffer()]);
const c = createCoreG2Client({ web3, coreProgramId: PROGRAMS.core, timepinProgramId: PROGRAMS.timepin });
const receiver = c.pythReceiver, wormhole = key(7), loader = c.loaderProgram;
const config = Buffer.alloc(370); sha('account:Config').subarray(0,8).copy(config); key(11).toBuffer().copy(config,8); wormhole.toBuffer().copy(config,41);
config.writeUInt32LE(1,73); config.writeUInt16LE(26,77); key(12).toBuffer().copy(config,79); config.writeBigUInt64LE(1n,113); config[121]=3;
const receiverPd=c.programDataPda(receiver)[0], wormholePd=c.programDataPda(wormhole)[0];
const generation={ receiverProgram:receiver.toBuffer(), receiverProgramExecutable:true, receiverProgramOwner:loader.toBuffer(), receiverProgramAccountData:program(receiverPd),
  receiverProgramdata:receiverPd.toBuffer(), receiverProgramdataOwner:loader.toBuffer(), receiverProgramdataExecutable:false, receiverProgramdataAccountData:programdata(900n), receiverProgramdataSlot:900n,
  receiverConfigKey:c.receiverConfigPda(receiver)[0].toBuffer(), receiverConfigOwner:receiver.toBuffer(), receiverConfigExecutable:false, receiverConfigData:config,
  wormholeProgram:wormhole.toBuffer(), wormholeProgramExecutable:true, wormholeProgramOwner:loader.toBuffer(), wormholeProgramAccountData:program(wormholePd),
  wormholeProgramdata:wormholePd.toBuffer(), wormholeProgramdataOwner:loader.toBuffer(), wormholeProgramdataExecutable:false, wormholeProgramdataAccountData:programdata(901n), wormholeProgramdataSlot:901n };
const manifestBytes=fs.readFileSync(new URL('../releases/g2-mainnet-economy.json',import.meta.url));
const manifest=JSON.parse(manifestBytes), manifestSha256=sha(manifestBytes).toString('hex'), initialClock={slot:1000n,nowTs:1800000000n};
const state=newState({manifestSha256,clock:initialClock,generation});
state.targets={entryTargetTs:'1800000300',exitTargetTs:'1800000600',scoreDay:String((1800000600n+1199n+3600n)/86400n)};
const ctx=await buildContext({manifest,manifestSha256,state,generation,clock:initialClock});
ctx.modelSpec={...ctx.spec.args,registeredSlot:999n};ctx.generation=generation;
const clock={slot:1003n,nowTs:1800000301n};
const needs=['entry','exit'].map(kind=>createNeed(ctx.modelSpec,BigInt(state.targets[kind+'TargetTs']),1800000200n,pk(PROGRAMS.timepin).toBuffer()));
const message={feedId:ctx.modelSpec.feedId,price:20000000000n,conf:1n,exponent:-8,publishTime:clock.nowTs,prevPublishTime:clock.nowTs-1n,emaPrice:20000000000n,emaConf:1n,postedSlot:1002n};
function source(m=message){
  const exponent=Buffer.alloc(4);exponent.writeInt32LE(m.exponent);
  const data=Buffer.concat([sha('account:PriceUpdateV2').subarray(0,8),pk(ctx.spec.priceAccount).toBuffer(),byte(1),Buffer.from(m.feedId),i64(m.price),u64(m.conf),exponent,
    i64(m.publishTime),i64(m.prevPublishTime),i64(m.emaPrice),u64(m.emaConf),u64(m.postedSlot),byte(0)]);
  assert.equal(data.length,134);return {key:pk(ctx.spec.priceAccount).toBuffer(),owner:receiver.toBuffer(),executable:false,data};
}
function candidate(need,m=message){const hash=hashPriceMessage(m),pda=deriveCandidatePda(pk(PROGRAMS.timepin).toBuffer(),need.address,hash);
  return {schema:2,bump:pda.bump,address:pda.address,need:need.address,...m,captureSlot:1003n,captureTs:m.publishTime};}
const candidateInfo=x=>({data:encodeCandidateV2(x),owner:pk(PROGRAMS.timepin),executable:false});
function transaction(ix, signature=bs58.encode(Buffer.alloc(64,2)), logs=[]){
  const keys=[pk(PAYER)];for(const k of [...ix.keys.map(k=>k.pubkey),ix.programId])if(!keys.some(x=>x.equals(k)))keys.push(k);
  return {slot:1003,meta:{err:null,fee:5000,logMessages:logs},transaction:{signatures:[signature],message:{header:{numRequiredSignatures:1},accountKeys:keys,
    instructions:[{programIdIndex:keys.findIndex(k=>k.equals(ix.programId)),accounts:ix.keys.map(v=>keys.findIndex(k=>k.equals(v.pubkey))),data:bs58.encode(ix.data)}]}}};
}
const signature=bs58.encode(Buffer.alloc(64,2)), signer={publicKey:pk(PAYER)};
const receipt=()=>({schema:1,clusterGenesis:DEVNET_GENESIS,programs:PROGRAMS,steps:[{step:'seal_forward',ok:true,signature,readBack:{evidence:true}}],landed:1});

test('CLI has explicit cluster/key boundary and bounded observation',()=>{
  assert.throws(()=>parseArgs([]),/--rpc/);assert.throws(()=>parseArgs(['--rpc','http://localhost:1','--send']),/--keypair/);
  assert.equal(parseArgs(['--rpc','http://localhost:1']).send,false);
  assert.throws(()=>parseArgs(['--rpc','http://localhost:1','--max-seconds','Infinity']),/max-seconds/);
  assert.throws(()=>parseArgs(['--rpc','http://localhost:1','--mainnet']),/unknown/);
});
test('real instruction tables accept all four Timepin and six Core actions',async()=>{
  const incumbent=candidate(needs[0]), a={...needs[0],state:'Candidate',candidateAHash:hashPriceMessage(message)};
  for(const name of ['capture_first','capture_conflict','finalize','expire']){
    const ix=timepinInstruction(ctx,a,name,name.startsWith('capture')?hashPriceMessage({...message,price:message.price+1n}):undefined);
    assert.equal(ix.keys.length,INSTRUCTION_ACCOUNTS['rcx-timepin-v2'][name].accounts.length);
    assert.equal(ix.data.length,name.startsWith('capture')?40:8);
    const work=ix.keys[INSTRUCTION_ACCOUNTS['rcx-timepin-v2'][name].accounts.findIndex(a=>a.name==='work_page')];
    assert.equal(work.isWritable,true);assert.notEqual(work.pubkey.toBase58(),web3.SystemProgram.programId.toBase58());
  }
  for(const name of ['activate_entry','settle_final','reveal','void_pending_entry','void_active_shot','finalize_resolved_void']){
    const ix=await coreInstruction(ctx,state,null,[a,needs[1]],name);const table=INSTRUCTION_ACCOUNTS['ratchet-core-g2'][name].accounts;
    assert.equal(ix.keys.length,table.length);assert.equal(ix.data.length,name==='reveal'?43:8);
    const work=ix.keys[table.findIndex(a=>a.name==='work_page')];
    const expected=web3.PublicKey.findProgramAddressSync([Buffer.from('work_page'),Buffer.from(ctx.economy.economyHash),pk(PAYER).toBuffer(),u64(0)],pk(PROGRAMS.core))[0];
    assert.equal(work.pubkey.toBase58(),expected.toBase58());assert.equal(work.isWritable,true);
    if(name==='reveal'){assert.equal(ix.data[8],state.side);assert.equal(Buffer.from(ix.data).readUInt16LE(9),state.probability);assert.equal(Buffer.from(ix.data).subarray(11).toString('hex'),state.salt);}
  }
  assert.equal(incumbent.address.length,32);
});
test('Full source authentication rejects discriminator, verification, owner, PDA and feed corruption',()=>{
  const s=source(),info={...s,owner:pk(s.owner)};assert.equal(authenticateSource(ctx.modelSpec,ctx.spec.priceAccount,info).ok,true);
  for(const offset of [0,40,41]){const data=Buffer.from(s.data);data[offset]^=1;assert.throws(()=>authenticateSource(ctx.modelSpec,ctx.spec.priceAccount,{...info,data}));}
  assert.throws(()=>authenticateSource(ctx.modelSpec,ctx.spec.priceAccount,{...info,owner:key(9)}),/owner/);
  assert.throws(()=>authenticateSource(ctx.modelSpec,key(9),info),/PDA/);
});
test('capture authenticates runtime generation and canonical message hash, not whole account hash',()=>{
  const result=chooseCapture(ctx.modelSpec,needs[0],null,source(),clock,generation);
  assert.equal(result.action,'capture_first');assert.deepEqual(result.messageHash,hashPriceMessage(message));assert.notDeepEqual(result.messageHash,sha(source().data));
  assert.equal(chooseCapture(ctx.modelSpec,needs[1],null,source(),clock,generation).reason,'TARGET_NOT_REACHED');
  assert.equal(chooseCapture(ctx.modelSpec,needs[0],null,source(),{...clock,nowTs:needs[0].captureDeadlineTs},generation).reason,'CAPTURE_CLOSED');
  assert.equal(chooseCapture(ctx.modelSpec,needs[0],null,source(),clock,{...generation,receiverProgramExecutable:false}).action,null);
});
test('deployed total order replaces earlier prints and tie-breaks without inventing Ambiguous',()=>{
  const incumbent=candidate(needs[0]), need={...needs[0],state:'Candidate',candidateAHash:hashPriceMessage(message)};
  assert.equal(chooseCapture(ctx.modelSpec,need,incumbent,source(),clock,generation).reason,'DUPLICATE');
  const later={...message,publishTime:message.publishTime+1n};assert.equal(chooseCapture(ctx.modelSpec,need,incumbent,source(later),{...clock,nowTs:later.publishTime},generation).reason,'NOT_EARLIER');
  const earlier={...message,publishTime:message.publishTime-1n};assert.equal(chooseCapture(ctx.modelSpec,need,incumbent,source(earlier),clock,generation).action,'capture_conflict');
  assert.equal(compareCapture({...message,postedSlot:1001n},Buffer.alloc(32,255),message,zero),-1);
  assert.equal(compareCapture(message,zero,message,Buffer.alloc(32,1)),-1);
});
test('Candidate readback checks bytes, PDA/hash, length, owner and capture facts',()=>{
  const value=candidate(needs[0]),hash=hashPriceMessage(message),info=candidateInfo(value);
  assert.equal(decodeCandidateAccount(ctx.modelSpec,needs[0],hash,pk(value.address),info).price,message.price);
  assert.throws(()=>decodeCandidateAccount(ctx.modelSpec,needs[0],zero,pk(value.address),info),/Candidate/);
  assert.throws(()=>decodeCandidateAccount(ctx.modelSpec,needs[0],hash,pk(value.address),{...info,data:Buffer.concat([info.data,byte(0)])}),/length/);
  const data=Buffer.from(info.data);data[43]^=1;assert.throws(()=>decodeCandidateAccount(ctx.modelSpec,needs[0],hash,pk(value.address),{...info,data}),/Candidate/);
  assert.throws(()=>decodeCandidateAccount(ctx.modelSpec,needs[0],hash,pk(value.address),{...info,owner:key(5)}),/owner/);
});
test('Core scheduler waits for the appropriate permanent Need and handles void/equality',()=>{
  const final=needs.map(n=>({...n,state:'Final'}));assert.equal(nextCoreAction({state:1},needs,clock),null);
  assert.equal(nextCoreAction({state:1},final,clock),'activate_entry');assert.equal(nextCoreAction({state:2},final,clock),'settle_final');
  assert.equal(nextCoreAction({state:1},[{state:'Expired'},final[1]],clock),'void_pending_entry');
  assert.equal(nextCoreAction({state:2},[final[0],{state:'Expired'}],clock),'void_active_shot');
  assert.equal(nextCoreAction({state:7},final,clock),'finalize_resolved_void');
  assert.equal(nextCoreAction({state:3,revealDeadlineTs:clock.nowTs+1n},final,clock),'reveal');
  assert.throws(()=>nextCoreAction({state:3,revealDeadlineTs:clock.nowTs-1n},final,clock),/WINDOW_MISSED/);
});
test('confirmed transaction binds exact bytes, account order, payer and true success',()=>{
  const ix=timepinInstruction(ctx,needs[0],'capture_first',hashPriceMessage(message)),tx=transaction(ix);
  assert.equal(verifyTransaction(tx,signature,ix).slot,1003);
  assert.throws(()=>verifyTransaction({...tx,meta:{...tx.meta,err:{InstructionError:1}}},signature,ix),/failed/);
  assert.throws(()=>verifyTransaction(tx,bs58.encode(Buffer.alloc(64,3)),ix),/signature/);
  const bad=transaction(ix);bad.transaction.message.instructions[0].data=bs58.encode(Buffer.alloc(40));assert.throws(()=>verifyTransaction(bad,signature,ix),/data/);
  const wrong=transaction(ix);wrong.transaction.message.accountKeys[0]=key(4);assert.throws(()=>verifyTransaction(wrong,signature,ix),/payer/);
});
test('send failure, ignored readback and changed-source simulation never count as evidence',async()=>{
  const ix=timepinInstruction(ctx,needs[0],'capture_first',hashPriceMessage(message));let pending=0;
  const connection={getGenesisHash:async()=>DEVNET_GENESIS,getTransaction:async()=>transaction(ix)};
  const args={connection,signer,instruction:ix,expected:{},name:'capture_first_entry',readBack:async()=>({evidence:true}),onSignature:()=>pending++};
  const success={sent:true,signature,confirmation:{err:null},evidence:{evidence:true}};
  assert.equal((await sendVerified({...args,sender:async()=>success})).ok,true);assert.equal(pending,1);
  await assert.rejects(()=>sendVerified({...args,sender:async()=>({...success,evidence:{evidence:false}})}),/confirmation\/readback/);
  await assert.rejects(()=>sendVerified({...args,sender:async()=>success,readBack:async()=>({evidence:false})}),/postcondition/);
  await assert.rejects(()=>sendVerified({...args,sender:async()=>({sent:false,simulation:{err:{},logs:['Error Code: WrongExpectedMessageHash']}})}),e=>e.retryObservation===true);
  await assert.rejects(()=>sendVerified({...args,sender:async()=>({sent:false,simulation:{err:{},logs:['Error Code: WrongOwner']}})}),e=>!e.retryObservation);
  await assert.rejects(()=>sendVerified({...args,connection:{getGenesisHash:async()=>'mainnet'},sender:async()=>success}),/DEVNET/);
});
test('read-only 429 retry is bounded and never retries transaction sends or unrelated errors',async()=>{
  let calls=0,sends=0;const waits=[];
  const wrapped=withReadRetries({getSlot:async()=>{if(++calls<3)throw Error('429 Too Many Requests');return 99;},sendRawTransaction:async()=>{sends++;throw Error('429');}},async ms=>waits.push(ms));
  assert.equal(await wrapped.getSlot(),99);assert.deepEqual(waits,[2000,4000]);
  await assert.rejects(()=>wrapped.sendRawTransaction(),/429/);assert.equal(sends,1);
  let failed=0;await assert.rejects(()=>withReadRetries({getSlot:async()=>{failed++;throw Error('bad owner');}},async()=>{}).getSlot(),/owner/);assert.equal(failed,1);
});

function terminalFixture(kind='hit'){
  const isVoid=['entry_expired','exit_expired','equality'].includes(kind),isHit=kind==='hit';
  const code=kind==='entry_expired'?1:kind==='exit_expired'?3:kind==='equality'?5:0;
  const reason=code===1?'VOID_ENTRY_EXPIRED':code===3?'VOID_EXIT_EXPIRED':code===5?'VOID_EQUALITY':null;
  const a=candidate(needs[0]),m={...message,publishTime:BigInt(state.targets.exitTargetTs)+1n,prevPublishTime:BigInt(state.targets.exitTargetTs),price:message.price+(kind==='miss'?-100n:kind==='equality'?0n:100n),postedSlot:1002n},b=candidate(needs[1],m);
  const terminalNeeds=needs.map((n,i)=>{const expired=kind==='entry_expired'&&i===0||kind==='exit_expired'&&i===1;return {...n,numericState:expired?4:2,state:expired?'Expired':'Final',candidateAHash:expired?zero:hashPriceMessage(i?m:message)};});
  const result={rulesetHash:Buffer.from(ctx.ruleset.rulesetHash),proofMaterial:isVoid?Buffer.from(ctx.commit):Buffer.from(state.salt,'hex'),state:isVoid?'Void':'Revealed',voidReason:reason,
    stake:100n,sealedTs:1800000200n,entryTargetTs:BigInt(state.targets.entryTargetTs),exitTargetTs:BigInt(state.targets.exitTargetTs),side:isVoid?0:1,pBps:isVoid?0:6000,delegate:zero,gameResultHash:zero};
  const needHash=n=>timepinResultHash({...n,key:n.address,state:n.numericState});
  const facts={entryTimepinResultHash:needHash(terminalNeeds[0]),exitTimepinResultHash:kind==='entry_expired'?zero:needHash(terminalNeeds[1]),outcomeYes:isHit?1:0,hit:isHit?1:0,xpAwarded:isVoid?0n:isHit?11n:1n,scoreDay:BigInt(state.targets.scoreDay)};
  result.gameResultHash=gameResultHash({programId:pk(PROGRAMS.core).toBuffer(),economyHash:Buffer.from(ctx.economy.economyHash),player:pk(PAYER).toBuffer(),nonce:0n,result,facts});
  const rowHash=historyRowHash(0n,result),resultsRoot=historyChainFold(zero,rowHash);
  const event=Buffer.concat([sha('event:ShotArchived').subarray(0,8),Buffer.from(ctx.economy.economyHash),pk(PAYER).toBuffer(),u64(0),u64(0),byte(0),byte(1),rowHash,resultsRoot,encodeShotResult(result)]);
  assert.equal(event.length,319);
  const tx={slot:1003,meta:{err:null,logMessages:['Program '+PROGRAMS.core+' invoke [1]','Program data: '+event.toString('base64'),'Program '+PROGRAMS.core+' success']},transaction:{signatures:[signature]}};
  const ledger={credits:isVoid?10000n:isHit?10070n:9900n,xp:isVoid?0n:isHit?11n:1n,open:0,lockedCredits:0n,nextShotNonce:1n,reservedPayoutCredits:0n,reservedXp:0n,legacyCredits:10000n,legacyXp:0n,
    shots:isVoid?0n:1n,voids:isVoid?1n:0n,hits:isHit?1n:0n,refundedCredits:isVoid?100n:0n,retiredCredits:isVoid?0n:100n};
  return {tick:{shot:null,needs:terminalNeeds,candidates:[kind==='entry_expired'?null:a,kind==='exit_expired'?null:b]},ledger,history:{pendingCount:1,terminalMask:1,terminalCount:1,resultsRoot},tx,reason};
}
for(const kind of ['hit','miss','entry_expired','exit_expired','equality'])test('closed Shot '+kind+' requires archive/root/game hash and exact ledger, without salt output',()=>{
  const f=terminalFixture(kind),isVoid=['entry_expired','exit_expired','equality'].includes(kind);const r=verifyTerminal(ctx,state,f.tick,f.ledger,f.history,f.tx);
  assert.equal(r.outcome,isVoid?'VOID':kind.toUpperCase());assert.equal(r.refundCredits,isVoid?'100':'0');assert.equal(r.voidReason,f.reason);assert.ok(!JSON.stringify(r).includes(state.salt));
  assert.throws(()=>verifyTerminal(ctx,state,{...f.tick,shot:{}},f.ledger,f.history,f.tx),/still exists/);
  assert.throws(()=>verifyTerminal(ctx,state,f.tick,{...f.ledger,credits:f.ledger.credits+1n},f.history,f.tx),/ledger/);
  assert.throws(()=>verifyTerminal(ctx,state,f.tick,f.ledger,{...f.history,resultsRoot:zero},f.tx),/root/);
  assert.throws(()=>verifyTerminal(ctx,state,f.tick,f.ledger,f.history,{...f.tx,meta:{...f.tx.meta,err:{bad:1}}}),/err/);
  if(isVoid)assert.throws(()=>verifyTerminal(ctx,state,f.tick,{...f.ledger,refundedCredits:0n},f.history,f.tx),/ledger/);
});

function shotInfo(){
  const bump=ctx.c.shotPda(ctx.economy.economyHash,PAYER,0n)[1],a=ctx.addresses;
  const prefix=Buffer.concat([Buffer.from(ACCOUNT_DISCRIMINATOR.Shot,'hex'),u16(2),byte(bump),Buffer.from(ctx.economy.economyHash),Buffer.from(ctx.ruleset.rulesetHash),pk(PAYER).toBuffer(),pk(PAYER).toBuffer(),zero,u64(0),Buffer.from(ctx.commit),
    byte(2),byte(1),byte(0),u64(100),u64(50000),u64(10),i64(1800000200),i64(state.targets.entryTargetTs),i64(state.targets.exitTargetTs),i64(state.targets.scoreDay),byte(0),Buffer.from(needs[0].address),Buffer.from(needs[1].address)]);
  assert.ok(a.shot);return {owner:pk(PROGRAMS.core),executable:false,data:Buffer.concat([prefix,Buffer.alloc(780-prefix.length)])};
}
test('mocked read-only observation considers both Needs and writes/sends nothing',async()=>{
  const clockData=Buffer.alloc(40);clockData.writeBigUInt64LE(clock.slot);clockData.writeBigInt64LE(clock.nowTs,32);
  const map=new Map([[web3.SYSVAR_CLOCK_PUBKEY.toBase58(),{data:clockData,owner:pk('Sysvar1111111111111111111111111111111111111'),executable:false}],
    [ctx.spec.priceAccount,{...source(),owner:receiver}],[ctx.addresses.shot.toBase58(),shotInfo()],...needs.map(n=>[pk(n.address).toBase58(),{data:encodeTimepinNeedV2(n),owner:pk(PROGRAMS.timepin),executable:false}])]);
  let batches=0,writes=0,sends=0;
  const connection={getMultipleAccountsInfoAndContext:async keys=>{batches++;assert.ok(keys.some(k=>k.equals(pk(needs[0].address))));assert.ok(keys.some(k=>k.equals(pk(needs[1].address))));return {context:{slot:1003},value:keys.map(k=>map.get(k.toBase58())||null)};}};
  const r=await runPlay({connection,ctx,state,send:false,receipt:receipt(),persist:()=>writes++,sender:async()=>sends++,log:()=>{}});
  assert.equal(r.status,'DRY_RUN');assert.equal(batches,1);assert.equal(writes,0);assert.equal(sends,0);
});


test('actual mocked capture loop writes WATCHING then verifies fresh Candidate; corrupt readback stays failed with signature',async()=>{
  for(const corrupt of [false,true]){
    const clockData=Buffer.alloc(40);clockData.writeBigUInt64LE(clock.slot);clockData.writeBigInt64LE(clock.nowTs,32);
    const map=new Map([[web3.SYSVAR_CLOCK_PUBKEY.toBase58(),{data:clockData,owner:pk('Sysvar1111111111111111111111111111111111111'),executable:false}],
      [ctx.spec.priceAccount,{...source(),owner:receiver}],[ctx.addresses.shot.toBase58(),shotInfo()],...needs.map(n=>[pk(n.address).toBase58(),{data:encodeTimepinNeedV2(n),owner:pk(PROGRAMS.timepin),executable:false}]),
      [receiver.toBase58(),{data:program(receiverPd),owner:loader,executable:true}],[receiverPd.toBase58(),{data:programdata(900n),owner:loader,executable:false}],
      [c.receiverConfigPda(receiver)[0].toBase58(),{data:config,owner:receiver,executable:false}],[wormhole.toBase58(),{data:program(wormholePd),owner:loader,executable:true}],
      [wormholePd.toBase58(),{data:programdata(901n),owner:loader,executable:false}]]);
    let lastIx,sends=0;const written=[];
    const connection={getGenesisHash:async()=>DEVNET_GENESIS,getAccountInfo:async key=>map.get(key.toBase58())||null,
      getMultipleAccountsInfoAndContext:async keys=>({context:{slot:1003},value:keys.map(k=>map.get(k.toBase58())||null)}),
      getMultipleAccountsInfo:async keys=>keys.map(k=>map.get(k.toBase58())||null),getTransaction:async sig=>transaction(lastIx,sig)};
    const sender=async({instruction,mode,expect})=>{
      assert.equal(mode,'send');sends++;lastIx=instruction;assert.equal(expect.address,pk(needs[0].address).toBase58());
      const hash=Buffer.from(instruction.data).subarray(8);assert.deepEqual(hash,hashPriceMessage(message));
      const captured=candidate(needs[0]),info=candidateInfo(captured);if(corrupt)info.data[43]^=1;
      map.set(pk(captured.address).toBase58(),info);
      map.set(pk(needs[0].address).toBase58(),{data:encodeTimepinNeedV2({...needs[0],state:'Candidate',candidateAHash:hash}),owner:pk(PROGRAMS.timepin),executable:false});
      return {sent:true,signature:bs58.encode(Buffer.alloc(64,3)),confirmation:{err:null},evidence:{evidence:true}};
    };
    const args={connection,ctx,state,signer,send:true,receipt:receipt(),sender,persist:r=>written.push(structuredClone(r)),log:()=>{},maxSeconds:0,poll:async()=>{}};
    if(corrupt){await assert.rejects(()=>runPlay(args),/Candidate/);assert.equal(written.at(-1).status,'FAILED');assert.ok(written.at(-1).pending.signature);assert.equal(written.at(-1).steps.length,1);}
    else {const out=await runPlay(args);assert.equal(out.status,'TIMED_OUT');assert.equal(out.steps.at(-1).step,'capture_first_entry');assert.equal(out.steps.at(-1).readBack.messageHash,hashPriceMessage(message).toString('hex'));assert.equal(out.landed,2);}
    assert.equal(sends,1);assert.equal(written[0].status,'WATCHING');assert.ok(!JSON.stringify(written).includes(state.salt));
  }
});
