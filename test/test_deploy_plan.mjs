import test from 'node:test';
import assert from 'node:assert/strict';
import { planDeployment, deploymentIsReal, MAINNET_GENESIS, DEVNET_GENESIS,
  TESTNET_GENESIS, FEE_ALLOWANCE_LAMPORTS } from '../ops/g2-deploy/plan.mjs';

const CORE = 'ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL';
const TIMEPIN = 'C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp';
const ARTIFACTS = [
  {name:'timepin',bytes:375944,expectedProgramId:TIMEPIN,keypairProgramId:TIMEPIN},
  {name:'core',bytes:1014408,expectedProgramId:CORE,keypairProgramId:CORE},
];
const quotes = size => (128 + size) * 5080;
const base = over => planDeployment({cluster:DEVNET_GENESIS,artifacts:ARTIFACTS,
  payerLamports:8_000_000_000,rentForSize:quotes,...over});
const refused = (plan, reason) => {
  assert.equal(plan.ok,false); assert.match(plan.refusals.join(';'),reason);
};
test('exact devnet quotes fund the complete pair plus an explicit unmeasured fee allowance', () => {
  const p=base();
  assert.equal(p.ok,true);
  assert.deepEqual(p.steps.map(s=>s.name),['core','timepin']);
  assert.equal(p.peak,7066412080);
  assert.equal(p.required,7116412080);
  assert.equal(p.required,p.peak+FEE_ALLOWANCE_LAMPORTS);
  assert.equal(p.feesMeasured,false);
  assert.equal(p.steps[1].requiredAtThisStep,p.peak);
  assert.deepEqual(p.steps.map(s=>s.maxLen),[1014408,375944]);
});
test('mainnet, testnet, empty and unknown genesis are refused',()=>{
  for(const cluster of [MAINNET_GENESIS,TESTNET_GENESIS,'',null,'unknown'])
    refused(base({cluster}),/MAINNET|not devnet/);
});
test('exact payer boundary includes fees rather than accepting rent alone',()=>{
  const p=base();
  assert.equal(base({payerLamports:p.required}).ok,true);
  refused(base({payerLamports:p.required-1}),/partially funded/);
  refused(base({payerLamports:p.peak}),/partially funded/);
});
test('unread, nonfinite, negative, fractional and unsafe balances fail closed',()=>{
  for(const payerLamports of [undefined,null,NaN,Infinity,-1,0.5,'8000000000',Number.MAX_SAFE_INTEGER+1])
    refused(base({payerLamports}),/safe integer/);
});
test('both artifacts and their matching program keypairs are mandatory',()=>{
  for(const artifacts of [[],ARTIFACTS.slice(0,1),[ARTIFACTS[0],ARTIFACTS[0]]])
    refused(base({artifacts}),/complete canonical/);
  for(const keypairProgramId of [null,TIMEPIN,'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx'])
    refused(base({artifacts:[ARTIFACTS[0],{...ARTIFACTS[1],keypairProgramId}]}),/keypair/);
  for(const bytes of [0,-1,NaN,1.5])
    refused(base({artifacts:[ARTIFACTS[0],{...ARTIFACTS[1],bytes}]}),/artifact/);
});
test('unquoted rent and non-exact capacity cannot authorize this command',()=>{
  refused(base({rentForSize:undefined}),/RPC rent quotes/);
  refused(base({maxLenMultiplier:2}),/exact capacity/);
  assert.throws(()=>base({rentForSize:()=>undefined}),/quote/);
  assert.throws(()=>base({rentForSize:()=>Number.MAX_SAFE_INTEGER}),/precision/);
});
test('program existence requires a measured owner and executable flag',()=>{
  const owner='BPFLoaderUpgradeab1e11111111111111111111111';
  assert.equal(deploymentIsReal({programId:CORE,account:{exists:true,executable:true,owner}}).real,true);
  for(const account of [null,{exists:false},{exists:true,executable:false,owner},
    {exists:true,executable:true},{exists:true,executable:true,owner:TIMEPIN}])
    assert.equal(deploymentIsReal({programId:CORE,account}).real,false);
});
