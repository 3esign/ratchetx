#!/usr/bin/env node
// Two clean container builds. This does not run SVM, repin vectors or deploy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {ROOT, PROGRAMS, TOOLCHAIN, sourceStamp, assertUnchanged, runBuild} from './g2-build-artifacts.mjs';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const copyFiles = ['tools/g2-build-artifacts.mjs','tools/verify-artifact.mjs','tools/g2-reproduce.mjs',
  'ops/g2-build/Dockerfile','ops/g2-build/toolchain-lock.json'];
const scope = 'two clean container builds from one measured image; no SVM, vector repin, devnet or mainnet acceptance';
function json(file) { return JSON.parse(fs.readFileSync(file,'utf8')); }
function same(a,b,label) { if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error(label+' differ'); }
function regular(file) {
  const entry=fs.lstatSync(file);
  if(!entry.isFile() || entry.isSymbolicLink()) throw new Error('expected regular file: '+file);
  return fs.readFileSync(file);
}
export function compareBuilds(directories, expectedSources) {
  if(directories.length!==2 || path.resolve(directories[0])===path.resolve(directories[1])) throw new Error('two distinct build outputs required');
  const builds=directories.map(directory=>{
    const receipt=json(path.join(directory,'g2-build-artifacts.json'));
    if(receipt.status!=='BUILT' || receipt.buildStatus!=='BUILT') throw new Error('completed build-only receipt required');
    same(receipt.toolchain,TOOLCHAIN,'pinned toolchains');
    assertUnchanged(expectedSources,receipt.sourceHashes);
    if(receipt.buildHost?.platform!=='linux' || receipt.buildHost?.architecture!=='x64') throw new Error('Linux x64 builder receipt required');
    if(JSON.stringify(Object.keys(receipt.artifacts??{}).sort())!==JSON.stringify(PROGRAMS.map(p=>p.name).sort())) throw new Error('exact artifact pair required');
    if(receipt.platformCompilers?.version!==TOOLCHAIN.platformTools
      || ['rustc','clang'].some(name=>!receipt.platformCompilers[name] || !/^[0-9a-f]{64}$/.test(receipt.platformCompilers[name].sha256))) throw new Error('measured compiler hashes required');
    const artifacts={};
    for(const program of PROGRAMS) {
      const tuple=receipt.artifacts[program.name];
      if(tuple?.programId!==program.id || !/^[0-9a-f]{64}$/.test(tuple.sha256) || !Number.isSafeInteger(tuple.size) || tuple.size<=0) throw new Error('invalid '+program.name+' tuple');
      const file=path.join(directory,'cache',tuple.sha256,program.filename);
      const bytes=regular(file);
      if(bytes.length!==tuple.size || sha(bytes)!==tuple.sha256) throw new Error(program.name+' exported bytes changed');
      artifacts[program.name]={programId:program.id,sha256:tuple.sha256,size:tuple.size};
    }
    return {receiptSha256:sha(regular(path.join(directory,'g2-build-artifacts.json'))),artifacts,
      buildHost:receipt.buildHost,platformCompilers:receipt.platformCompilers};
  });
  same(builds[0].artifacts,builds[1].artifacts,'raw artifact pairs');
  same(builds[0].platformCompilers,builds[1].platformCompilers,'measured platform compilers');
  return builds;
}
function execute(command,args,options={}) {
  const result=spawnSync(command,args,{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,...options});
  if(result.error || result.status!==0 || result.signal) throw new Error(command+' failed: '+(result.error?.message??'exit '+result.status)+'\n'+(result.stderr??''));
  return result.stdout;
}
function buildOnce() {
  if(process.env.G2_REPRO_CONTAINER!=='1' || process.platform!=='linux' || process.arch!=='x64' || process.cwd()!=='/build') throw new Error('build-once requires the isolated Linux amd64 /build container');
  if(process.version!=='v22.20.0') throw new Error('Node22.20.0 required');
  if(!/^rustc 1\.98\.0\b/.test(execute('rustc',['--version']))) throw new Error('native Rust1.98.0 required');
  if(!/^cargo 1\.98\.0\b/.test(execute('cargo',['--version']))) throw new Error('native Cargo1.98.0 required');
  try {
  const receipt=runBuild({root:'/build',buildOnly:true});
  fs.mkdirSync('/output/cache',{recursive:true});
  for(const program of PROGRAMS) {
    const artifact=receipt.artifacts[program.name], directory=path.join('/output/cache',artifact.sha256);
    fs.mkdirSync(directory,{recursive:true});
    const destination=path.join(directory,program.filename);
    fs.copyFileSync(artifact.path,destination,fs.constants.COPYFILE_EXCL);
    if(sha(regular(destination))!==artifact.sha256) throw new Error('export readback failed');
  }
  // Copy only the public .so pair and evidence; raw output can contain keypairs.
  } finally {
    for(const [source,destination] of [['/build/docs/receipts/g2-build-artifacts.json','/output/g2-build-artifacts.json'],['/build/build_g2_report.txt','/output/build_g2_report.txt']]) {
      if(fs.existsSync(source)) fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);
    }
  }
}
export function reproduce({image,output,root=ROOT}) {
  if(!/^(?:[a-z0-9][a-z0-9./:_-]*@)?sha256:[0-9a-f]{64}$/.test(image??'')) throw new Error('image must be an immutable sha256 ID or registry digest');
  output=path.resolve(output);
  if(fs.existsSync(output)) throw new Error('output must be new; refusing overwrite: '+output);
  fs.mkdirSync(output,{recursive:true});
  const report={schema:1,status:'RUNNING',scope,startedAt:new Date().toISOString(),imageRequested:image,runs:[]};
  const reportPath=path.join(output,'reproducibility.json');
  const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  save();
  try {
    const inspected=JSON.parse(execute('docker',['image','inspect',image]));
    if(inspected.length!==1 || inspected[0].Os!=='linux' || inspected[0].Architecture!=='amd64' || !/^sha256:[0-9a-f]{64}$/.test(inspected[0].Id)) throw new Error('one Linux amd64 image required');
    const imageData=inspected[0];
    if(image.startsWith('sha256:') ? image!==imageData.Id : !imageData.RepoDigests?.includes(image)) throw new Error('image digest does not match local inspection');
    report.image={id:imageData.Id,repoDigests:imageData.RepoDigests,os:imageData.Os,architecture:imageData.Architecture};
    report.sourceHashes=sourceStamp(root);
    report.recipeHashes=Object.fromEntries(copyFiles.map(file=>[file,sha(regular(path.join(root,file)))]));
    const original={...report.sourceHashes,...report.recipeHashes};
    const outputDirectories=[];
    for(let n=1;n<=2;n++) {
      const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ratchetx-g2-reproduce-'));
      const snapshot=path.join(scratch,'source');
      fs.mkdirSync(snapshot);
      for(const [file,expected] of Object.entries(original)) {
        const bytes=regular(path.join(root,file));
        if(sha(bytes)!==expected) throw new Error('input changed before snapshot: '+file);
        const destination=path.join(snapshot,file);
        fs.mkdirSync(path.dirname(destination),{recursive:true});
        fs.writeFileSync(destination,bytes,{flag:'wx'});
      }
      const directory=path.join(output,'run-'+n);
      fs.mkdirSync(directory);
      const cid=path.join(directory,'container.id');
      const args=['run','--rm','--platform','linux/amd64','--cidfile',cid,
        '--mount','type=bind,src='+snapshot+',dst=/build',
        '--mount','type=bind,src='+directory+',dst=/output',
        '--env','G2_REPRO_CONTAINER=1','--workdir','/build',imageData.Id,
        'node','tools/g2-reproduce.mjs','--build-once-in-container'];
      console.log('START isolated Linux build '+n);
      const startedAt=new Date().toISOString();
      const result=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
      fs.writeFileSync(path.join(directory,'docker.stdout.txt'),result.stdout??'');
      fs.writeFileSync(path.join(directory,'docker.stderr.txt'),result.stderr??'');
      const run={number:n,startedAt,finishedAt:new Date().toISOString(),command:'docker',args,
        exit:result.status,signal:result.signal,error:result.error?.message??null,
        containerId:fs.existsSync(cid)?fs.readFileSync(cid,'utf8').trim():null,
        stdoutSha256:sha(Buffer.from(result.stdout??'')),stderrSha256:sha(Buffer.from(result.stderr??''))};
      report.runs.push(run);
      save();
      if(result.error || result.status!==0 || result.signal) throw new Error('isolated build '+n+' failed; read its recorded streams');
      if(!/^[0-9a-f]{64}$/.test(run.containerId??'')) throw new Error('container ID evidence missing');
      assertUnchanged(report.sourceHashes,sourceStamp(root));
      for(const [file,expected] of Object.entries(report.recipeHashes)) if(sha(regular(path.join(root,file)))!==expected) throw new Error('recipe changed: '+file);
      outputDirectories.push(directory);
      console.log('BUILT isolated Linux candidate '+n);
    }
    if(report.runs[0].containerId===report.runs[1].containerId) throw new Error('containers were not independent');
    report.builds=compareBuilds(outputDirectories,report.sourceHashes);
    report.status='MATCH';
    report.finishedAt=new Date().toISOString();
    save();
    console.log('MATCH: both raw .so hashes repeat in two clean containers. '+scope);
    return report;
  } catch(error) {
    report.status='FAIL';report.failure=error.message;report.finishedAt=new Date().toISOString();save();throw error;
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  try {
    if(args.length===1 && args[0]==='--build-once-in-container') buildOnce();
    else if(args.length===4 && args[0]==='--image' && args[2]==='--output') reproduce({image:args[1],output:args[3]});
    else throw new Error('usage: node tools/g2-reproduce.mjs --image <immutable-image> --output <new-directory>');
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
