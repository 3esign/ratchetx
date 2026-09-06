import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { main, acceptedArtifacts, assertArtifactBytes, readBackDeployment,
  DESIGNATED_PAYER, LOADER, PROGRAM_KEYPAIRS, failedBufferAddress } from '../ops/g2-deploy/deploy-devnet.mjs';
import { DEVNET_GENESIS, MAINNET_GENESIS, TESTNET_GENESIS } from '../ops/g2-deploy/plan.mjs';

const sha = bytes=>createHash('sha256').update(bytes).digest('hex');
const IDS={timepin:'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp',core:'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL'};
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'g2-deploy-test-'));
  t.after(()=>{
    assert.ok(path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()),'g2-deploy-test-')));
    fs.rmSync(root,{recursive:true,force:true});
  });
  const cache=path.join(root,'accepted cache');
  const report={verdict:'PASS',receiptStatus:'PASS',runtimeEvidenceChecked:true,receiptSha256:'a'.repeat(64),
    sourceHashes:{'onchain/public-source.rs':'b'.repeat(64)},artifacts:{},resolvedArtifactPaths:{}};
  for(const [name,programId] of Object.entries(IDS)){
    const bytes=Buffer.alloc(name==='core'?128:64,name==='core'?7:9);
    bytes.set([0x7f,69,76,70]);
    const digest=sha(bytes),file=path.join(cache,digest,name==='core'?'ratchet_core_g2.so':'rcx_timepin_v2.so');
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
    report.artifacts[name]={programId,size:bytes.length,sha256:digest,path:file};
    report.resolvedArtifactPaths[name]=file;
  }
  const artifacts=acceptedArtifacts(report),deployed=new Set(),calls=[],logs=[];
  const accountFor=key=>{
    for(const a of artifacts){
      const pubkey=new PublicKey(a.expectedProgramId);
      const [pdKey]=PublicKey.findProgramAddressSync([pubkey.toBuffer()],new PublicKey(LOADER));
      if(!deployed.has(a.name))continue;
      if(key.equals(pubkey)){
        const data=Buffer.alloc(36);data.writeUInt32LE(2);pdKey.toBuffer().copy(data,4);
        return {owner:new PublicKey(LOADER),executable:true,data};
      }
      if(key.equals(pdKey)){
        const data=Buffer.alloc(45+a.bytes);data.writeUInt32LE(3);data.writeBigUInt64LE(123n,4);
        data[12]=1;new PublicKey(DESIGNATED_PAYER).toBuffer().copy(data,13);
        fs.readFileSync(a.path).copy(data,45);
        return {owner:new PublicKey(LOADER),executable:false,data};
      }
    }
    return null;
  };
  const connection={
    getGenesisHash:async()=>DEVNET_GENESIS,
    getBalance:async()=>1_000_000_000,
    getMinimumBalanceForRentExemption:async size=>(128+size)*5080,
    getAccountInfo:async key=>accountFor(key),
  };
  const spawn=(exe,args,options)=>{
    calls.push({exe,args,options});
    if(exe==='solana-keygen'){
      const name=Object.keys(PROGRAM_KEYPAIRS).find(n=>args[1]===path.resolve(root,PROGRAM_KEYPAIRS[n]));
      return {status:0,stdout:(name?IDS[name]:DESIGNATED_PAYER)+'\n'};
    }
    if(args[0]==='--version')return {status:0,stdout:'solana-cli 4.2.1 (src:test)\n'};
    if(args[0]==='genesis-hash')return {status:0,stdout:DEVNET_GENESIS+'\n'};
    assert.deepEqual(args.slice(0,2),['program','deploy']);
    const a=artifacts.find(a=>a.path===args[2]);assert.ok(a);
    deployed.add(a.name);
    return {status:0,stdout:'deployment complete\n'};
  };
  let checkerCalls=0;
  const checker=({root:r,cacheRoot:c})=>{
    assert.equal(r,root);assert.equal(c,cache);checkerCalls++;
    return structuredClone(report);
  };
  const invoke=over=>main({argv:['--cache-root',cache,'--payer','dedicated payer.json'],root,
    checker,spawn,connectionFactory:async()=>connection,log:line=>logs.push(line),...over});
  return {root,cache,report,artifacts,deployed,calls,logs,connection,spawn,checker,invoke,
    accountFor,checkerCalls:()=>checkerCalls,
    executeArgs:['--cache-root',cache,'--payer','dedicated payer.json','--execute']};
}
const sends=f=>f.calls.filter(c=>c.exe==='solana'&&c.args[0]==='program');

test('dry run uses strict accepted tuple and live quotes, with zero native deploy calls',async t=>{
  const f=fixture(t),r=await f.invoke();
  assert.equal(r.ok,true);assert.equal(r.mode,'dry-run');assert.equal(r.payer,DESIGNATED_PAYER);
  assert.equal(r.plan.rentSource,'rpc');assert.equal(r.deployments.length,0);assert.equal(sends(f).length,0);
  assert.ok(f.checkerCalls()>=2);
  assert.ok(f.calls.every(c=>c.options.windowsHide===true));
  assert.deepEqual(r.resolvedArtifactPaths,f.report.resolvedArtifactPaths);
});
test('explicit execution pins all signers, exact max-len and actual program-data hashes',async t=>{
  const f=fixture(t),r=await f.invoke({argv:f.executeArgs});
  assert.equal(r.ok,true);assert.equal(r.mode,'execute');assert.equal(sends(f).length,2);
  assert.ok(f.checkerCalls()>=6);
  for(const call of sends(f)){
    const a=f.artifacts.find(a=>a.path===call.args[2]);assert.ok(a);
    for(const flag of ['--keypair','--fee-payer','--upgrade-authority'])
      assert.equal(call.args[call.args.indexOf(flag)+1],path.join(f.root,'dedicated payer.json'));
    assert.equal(call.args[call.args.indexOf('--program-id')+1],path.resolve(f.root,PROGRAM_KEYPAIRS[a.name]));
    assert.equal(call.args[call.args.indexOf('--max-len')+1],String(a.bytes));
    assert.equal(call.options.shell,undefined);
    const read=r.deployments.find(d=>d.programId===a.expectedProgramId);
    assert.equal(read.sha256,a.sha256);assert.equal(read.bytes,a.bytes);assert.equal(read.owner,LOADER);
    assert.equal(read.programDataOwner,LOADER);assert.equal(read.upgradeAuthority,DESIGNATED_PAYER);
    assert.equal(read.slot,'123');
  }
});
test('RUNNING/FAIL/missing runtime evidence and changed receipt binding never deploy',async t=>{
  const f=fixture(t);
  for(const bad of [{verdict:'FAIL'},{receiptStatus:'RUNNING'},{receiptStatus:'FAIL'},
    {runtimeEvidenceChecked:false},{receiptSha256:'bad'}]){
    await assert.rejects(f.invoke({argv:f.executeArgs,checker:()=>({...structuredClone(f.report),...bad})}),/PASS/);
  }
  let n=0;
  await assert.rejects(f.invoke({argv:f.executeArgs,checker:()=>{
    const r=structuredClone(f.report);if(++n>1)r.sourceHashes['onchain/public-source.rs']='c'.repeat(64);return r;
  }}),/changed during/);
  assert.equal(sends(f).length,0);
});
test('wrong accepted ID, hash or content-addressed filename is refused',async t=>{
  const f=fixture(t);
  for(const alter of [
    r=>r.artifacts.core.programId=IDS.timepin,
    r=>r.artifacts.core.sha256='bad',
    r=>r.resolvedArtifactPaths.core=path.join(f.cache,'ratchet_core_g2.so'),
    r=>delete r.artifacts.timepin,
  ]){
    const r=structuredClone(f.report);alter(r);
    await assert.rejects(f.invoke({argv:f.executeArgs,checker:()=>r}),/tuple|content-addressed|canonical pair/);
  }
  fs.appendFileSync(f.artifacts[0].path,'tamper');
  await assert.rejects(f.invoke({argv:f.executeArgs}),/artifact bytes changed/);
  assert.equal(sends(f).length,0);
});
test('mainnet/testnet/unknown RPC and differing CLI genesis fail before keys or rent',async t=>{
  const f=fixture(t);
  for(const genesis of [MAINNET_GENESIS,TESTNET_GENESIS,'unknown']){
    await assert.rejects(f.invoke({argv:f.executeArgs,connectionFactory:async()=>({
      getGenesisHash:async()=>genesis,
      getMinimumBalanceForRentExemption:async()=>{throw new Error('unexpected rent');},
    })}),/not DEVNET/);
  }
  assert.equal(f.calls.some(c=>c.exe==='solana-keygen'),false);
  await assert.rejects(f.invoke({argv:f.executeArgs,spawn:(exe,args,opts)=>
    args[0]==='genesis-hash'?{status:0,stdout:MAINNET_GENESIS}:f.spawn(exe,args,opts)}),/both identify devnet/);
  assert.equal(sends(f).length,0);
});
test('wrong CLI version, failed inspection, wrong payer or wrong program keypair refuse',async t=>{
  const f=fixture(t);
  await assert.rejects(f.invoke({spawn:()=>({status:0,stdout:'solana-cli 4.3.0'})}),/4.2.1/);
  await assert.rejects(f.invoke({spawn:()=>({status:1,stdout:'solana-cli 4.2.1'})}),/inspection failed/);
  await assert.rejects(f.invoke({spawn:(exe,args,opts)=>exe==='solana-keygen'
    ?{status:0,stdout:IDS.core}:f.spawn(exe,args,opts)}),/designated devnet wallet/);
  await assert.rejects(f.invoke({spawn:(exe,args,opts)=>exe==='solana-keygen'&&args[1].endsWith('ratchet_core_g2-keypair.json')
    ?{status:0,stdout:IDS.timepin}:f.spawn(exe,args,opts)}),/program keypair/);
  assert.equal(sends(f).length,0);
});
test('bad balances, missing quotes and existing programs never trigger upgrades',async t=>{
  const f=fixture(t);
  for(const balance of [NaN,Infinity,undefined,-1,0.1,Number.MAX_SAFE_INTEGER+1,0]){
    f.connection.getBalance=async()=>balance;
    await assert.rejects(f.invoke({argv:f.executeArgs}),/balance|holds/);
  }
  f.connection.getBalance=async()=>1e9;
  f.connection.getMinimumBalanceForRentExemption=async()=>undefined;
  await assert.rejects(f.invoke({argv:f.executeArgs}),/rent quote/);
  f.deployed.add('core');
  await assert.rejects(f.invoke({argv:f.executeArgs}),/already exists/);
  assert.equal(sends(f).length,0);
});
test('CLI failure returns only a public attempt-specific buffer, never recovery phrases',async t=>{
  const f=fixture(t),secret='private recovery words must never enter logs';
  const r=await f.invoke({argv:f.executeArgs,spawn:(exe,args,opts)=>{
    if(exe==='solana'&&args[0]==='program')return {status:1,stderr:'Buffer account: '+IDS.timepin+'\n'+secret};
    return f.spawn(exe,args,opts);
  }});
  assert.equal(r.ok,false);assert.equal(r.failedProgram,'core');assert.equal(r.bufferAddress,IDS.timepin);
  assert.equal(JSON.stringify(r).includes(secret),false);assert.equal(f.logs.join('\n').includes(secret),false);
  assert.equal(f.logs.join('\n').includes('close --buffers'),false);
  assert.equal(f.deployed.size,0);
  assert.equal(failedBufferAddress({stderr:'unlabeled '+IDS.timepin}),null);
});
test('actual loader state, owner, executable flags, capacity, authority and ELF bytes are mandatory',async t=>{
  const f=fixture(t),a=f.artifacts[0];f.deployed.add(a.name);
  const programKey=new PublicKey(a.expectedProgramId);
  const cases=[
    ['program owner',(key,info)=>key.equals(programKey)?{...info,owner:new PublicKey(IDS.core)}:info],
    ['program executable',(key,info)=>key.equals(programKey)?{...info,executable:false}:info],
    ['program state',(key,info)=>{if(key.equals(programKey)){info.data.writeUInt32LE(1);}return info;}],
    ['program address',(key,info)=>{if(key.equals(programKey)){new PublicKey(IDS.core).toBuffer().copy(info.data,4);}return info;}],
    ['PD owner',(key,info)=>!key.equals(programKey)?{...info,owner:new PublicKey(IDS.core)}:info],
    ['PD executable',(key,info)=>!key.equals(programKey)?{...info,executable:true}:info],
    ['PD state',(key,info)=>{if(!key.equals(programKey)){info.data.writeUInt32LE(2);}return info;}],
    ['PD size',(key,info)=>!key.equals(programKey)?{...info,data:Buffer.concat([info.data,Buffer.alloc(1)])}:info],
    ['PD authority',(key,info)=>{if(!key.equals(programKey)){info.data[12]=0;}return info;}],
    ['PD hash',(key,info)=>{if(!key.equals(programKey)){info.data[45]^=1;}return info;}],
  ];
  for(const [name,alter]of cases){
    const conn={getAccountInfo:async key=>alter(key,f.accountFor(key))};
    await assert.rejects(readBackDeployment(conn,a),undefined,name);
  }
  await assert.rejects(readBackDeployment({getAccountInfo:async()=>null},a),/no account/);
  await assert.rejects(readBackDeployment({getAccountInfo:async key=>key.equals(programKey)?f.accountFor(key):null},a),/ProgramData missing/);
  assert.equal((await readBackDeployment(f.connection,a)).sha256,a.sha256);
});
test('malformed arguments and non-file artifacts fail without a deployment',async t=>{
  const f=fixture(t);
  for(const argv of [[],['--payer'],['--cache-root',f.cache,'--payer','x','--execute','false'],
    ['--cache-root',f.cache,'--payer','x','--execute','--execute']]){
    await assert.rejects(f.invoke({argv}),/required|requires|unknown|duplicate/);
  }
  // Regular-file validation is independent of the checker contract.
  assert.throws(()=>assertArtifactBytes({...f.artifacts[0],path:f.cache}),/regular file/);
  assert.equal(sends(f).length,0);
});

test('measured FNc Timepin keypair mismatch refuses the configured C8 artifact in dry run',async t=>{
  const f=fixture(t);
  await assert.rejects(f.invoke({spawn:(exe,args,opts)=>
    exe==='solana-keygen'&&args[1]===path.resolve(f.root,PROGRAM_KEYPAIRS.timepin)
      ?{status:0,stdout:'FNc5ezEgW9Z4vRvgsmgMQV46YQfoMvR8KYuq9A7qU9Ge'}
      :f.spawn(exe,args,opts)}),/FNc5ezEgW9Z4vRvgsmgMQV46YQfoMvR8KYuq9A7qU9Ge.*C8wwx/);
  assert.equal(sends(f).length,0);
});
test('a CLI exit zero with wrong on-chain ELF stops before the second deployment',async t=>{
  const f=fixture(t),original=f.connection.getAccountInfo;
  f.connection.getAccountInfo=async key=>{
    const info=await original(key);
    if(info&&info.executable===false) info.data[45]^=1;
    return info;
  };
  await assert.rejects(f.invoke({argv:f.executeArgs}),/deployed ELF bytes/);
  assert.equal(sends(f).length,1);
});
