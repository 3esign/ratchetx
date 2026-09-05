// Synthetic bytes test the comparison boundary; no Docker/build claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {compareBuilds,reproduce} from '../tools/g2-reproduce.mjs';
import {PROGRAMS,TOOLCHAIN} from '../tools/g2-build-artifacts.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ratchetx-repro-test-'));
  t.after(()=>{
    assert.equal(path.dirname(root),path.resolve(os.tmpdir()));
    assert.match(path.basename(root),/^ratchetx-repro-test-/);
    fs.rmSync(root,{recursive:true,force:true});
  });
  const sources={'program.rs':sha(Buffer.from('same source'))};
  const directories=[1,2].map(n=>path.join(root,'run-'+n));
  const write=(n,{changedProgram=null,receiptChange=()=>{},corrupt=false}={})=>{
    const directory=directories[n], artifacts={};
    for(const p of PROGRAMS) {
      const bytes=Buffer.from((p.name===changedProgram?'B':'A')+'-synthetic-'+p.name);
      const digest=sha(bytes),dir=path.join(directory,'cache',digest);
      fs.mkdirSync(dir,{recursive:true});
      fs.writeFileSync(path.join(dir,p.filename),corrupt && p.name==='core'?Buffer.from('corruption'):bytes);
      artifacts[p.name]={programId:p.id,sha256:digest,size:bytes.length};
    }
    const receipt={status:'BUILT',buildStatus:'BUILT',toolchain:TOOLCHAIN,sourceHashes:sources,artifacts,
      buildHost:{platform:'linux',architecture:'x64'},platformCompilers:{version:'v1.56',rustc:{sha256:sha(Buffer.from('compiler'))},clang:{sha256:sha(Buffer.from('clang'))}}};
    receiptChange(receipt);
    fs.writeFileSync(path.join(directory,'g2-build-artifacts.json'),JSON.stringify(receipt));
  };
  write(0);write(1);
  return {root,directories,sources,write};
}
test('same source and bytes from distinct build outputs match',t=>{
  const f=fixture(t),builds=compareBuilds(f.directories,f.sources);
  assert.equal(builds.length,2);
  assert.deepEqual(builds[0].artifacts,builds[1].artifacts);
});
test('same-size changed program bytes are rejected for either program',t=>{
  for(const p of PROGRAMS) {
    const f=fixture(t);f.write(1,{changedProgram:p.name});
    assert.throws(()=>compareBuilds(f.directories,f.sources),/raw artifact pairs differ/);
  }
});
test('corrupted exports and source drift cannot pass',t=>{
  const f=fixture(t);f.write(1,{corrupt:true});
  assert.throws(()=>compareBuilds(f.directories,f.sources),/exported bytes changed/);
  f.write(1,{receiptChange:r=>r.sourceHashes={'program.rs':'0'.repeat(64)}});
  assert.throws(()=>compareBuilds(f.directories,f.sources),/source\/lockfile drift/);
});
test('incomplete builds, wrong identities and wrong host fail',t=>{
  const mutations=[r=>r.status='FAIL',r=>delete r.artifacts.core,
    r=>r.artifacts.core.programId=PROGRAMS[0].id,r=>r.buildHost.platform='win32',r=>delete r.platformCompilers,
    r=>r.toolchain={...TOOLCHAIN,platformTools:'v1.57'}];
  for(const mutation of mutations) {
    const f=fixture(t);f.write(1,{receiptChange:mutation});
    assert.throws(()=>compareBuilds(f.directories,f.sources));
  }
});
test('one replayed output and changed measured compiler are rejected',t=>{
  const f=fixture(t);
  assert.throws(()=>compareBuilds([f.directories[0],f.directories[0]],f.sources),/distinct/);
  f.write(1,{receiptChange:r=>r.platformCompilers.rustc.sha256='f'.repeat(64)});
  assert.throws(()=>compareBuilds(f.directories,f.sources),/measured platform compilers differ/);
});
test('mutable image tags and existing output are refused before Docker',t=>{
  const f=fixture(t);
  for(const image of ['latest','rust:1.98.0','repo@sha256:bad','--privileged']) {
    assert.throws(()=>reproduce({image,output:path.join(f.root,'new')}),/immutable/);
  }
  assert.throws(()=>reproduce({image:'sha256:'+'a'.repeat(64),output:f.root}),/refusing overwrite/);
});
