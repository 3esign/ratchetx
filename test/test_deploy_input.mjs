import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectDeployInput,isNeverReadPath} from '../scripts/check-deploy-input.mjs';

function fixture(t, ignore='*.md\nnode_modules/\n.env*\n_to_delete/\n') {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ratchetx-deploy-'));
  t.after(()=>{const checked=fs.realpathSync(root);assert.ok(checked.startsWith(fs.realpathSync(os.tmpdir())+path.sep));assert.match(path.basename(checked),/^ratchetx-deploy-/);fs.rmSync(checked,{recursive:true});});
  execFileSync('git',['init','-q',root]);
  const put=(name,content='fixture')=>{fs.mkdirSync(path.dirname(root+'/'+name),{recursive:true});fs.writeFileSync(root+'/'+name,content);};
  const track=names=>execFileSync('git',['-C',root,'add','-f','--',...names]);
  put('.vercelignore',ignore);put('index.html');put('robots.txt');put('llms.txt');put('play-session.js');put('api/game.js');track(['.vercelignore','index.html','robots.txt','llms.txt','play-session.js','api/game.js']);
  return{root,put,track,check:()=>inspectDeployInput(root)};
}
test('known site and tracked API inputs remain uploadable',t=>{const f=fixture(t),r=f.check();assert.deepEqual(r.errors,[]);for(const n of ['index.html','robots.txt','llms.txt','play-session.js','api/game.js'])assert.ok(r.files.includes(n));});
test('untracked root scripts and data fail even though tracked source is clean',t=>{const f=fixture(t);for(const n of ['fix12.js','claim.js','push_report.txt','merkle_excluded.json','rogue.patch','approx'])f.put(n);const r=f.check();for(const n of ['fix12.js','claim.js','push_report.txt','merkle_excluded.json','rogue.patch','approx'])assert.ok(r.errors.some(e=>e.endsWith(n)),n);});
test('gitignored root and nested scratch cannot hide from folder upload guard',t=>{const f=fixture(t);f.put('.gitignore','private_dump.txt\napi/scratch.js\n');f.put('private_dump.txt');f.put('api/scratch.js');const r=f.check();assert.ok(r.files.includes('private_dump.txt'));assert.ok(r.errors.some(e=>e.endsWith('private_dump.txt')));assert.ok(r.errors.some(e=>e.endsWith('api/scratch.js')));});
test('vercelignore exclusions apply to tracked and untracked files',t=>{const f=fixture(t,'fix*.js\n*.patch\n_to_delete/\n');f.put('fix.js');f.put('fix2.js');f.put('a.patch');f.put('_to_delete/data.json');f.track(['fix.js']);const r=f.check();assert.deepEqual(r.errors,[]);for(const n of ['fix.js','fix2.js','a.patch','_to_delete/data.json'])assert.ok(!r.files.includes(n));});
test('ordered exceptions retain only exact public skill companions',t=>{const f=fixture(t,'*.md\nskills/ratchetx/scripts/*\n!skills/ratchetx/SKILL.md\n!skills/ratchetx/scripts/session-play.mjs\n');for(const n of ['README.md','skills/ratchetx/SKILL.md','skills/ratchetx/private.md','skills/ratchetx/scripts/session-play.mjs','skills/ratchetx/scripts/private.mjs'])f.put(n);f.track(['README.md','skills']);const r=f.check();assert.deepEqual(r.errors,[]);assert.ok(r.files.includes('skills/ratchetx/SKILL.md'));assert.ok(r.files.includes('skills/ratchetx/scripts/session-play.mjs'));assert.ok(!r.files.includes('skills/ratchetx/private.md'));assert.ok(!r.files.includes('skills/ratchetx/scripts/private.mjs'));});
test('unexcluded private path fails by name without content inspection',t=>{const f=fixture(t,'');f.put('id.json','not a key; fixture');const r=f.check();assert.ok(r.errors.some(e=>e.startsWith('Private path')));for(const n of ['.env','.env.production','data/secrets.json','onchain/program-keypair.json','vault.keys/a.json'])assert.equal(isNeverReadPath(n),true,n);});
test('bad enumeration and absent ignore fail closed',t=>{const f=fixture(t);fs.renameSync(f.root+'/.vercelignore',f.root+'/saved-ignore');assert.throws(f.check);});
test('deleted tracked file is omitted while a tracked unexpected root still fails',t=>{const f=fixture(t);fs.unlinkSync(f.root+'/robots.txt');f.put('private.txt');f.track(['private.txt']);const r=f.check();assert.ok(!r.files.includes('robots.txt'));assert.ok(r.errors.some(e=>e.endsWith('private.txt')));});
test('nested untracked file requires review while a newly reviewed tracked file is accepted',t=>{const f=fixture(t);f.put('lib/new-runtime.js');assert.ok(f.check().errors.some(e=>e.endsWith('lib/new-runtime.js')));f.track(['lib/new-runtime.js']);assert.deepEqual(f.check().errors,[]);});
test('DEPLOY preserves a failed CLI exit through successful report printing',t=>{
  const deployPath=new URL('../DEPLOY.cmd',import.meta.url);if(process.platform!=='win32'||!fs.existsSync(deployPath)){t.skip('requires Windows staged DEPLOY.cmd');return;}
  const f=fixture(t),source=fs.readFileSync(deployPath,'utf8');
  const begin=source.indexOf('call npx --yes vercel deploy --prod --yes');
  const end=source.indexOf('goto :vercelfail',begin)+'goto :vercelfail'.length;
  assert.ok(begin>=0&&end>begin);
  const fragment=source.slice(begin,end).replace(/^call npx[^\r\n]+/,'call mock-deploy.cmd > rx_vercel.txt 2>&1').replaceAll('"%TEMP%\\rx_vercel.txt"','rx_vercel.txt');
  assert.ok(!/npx|vercel deploy/.test(fragment));
  f.put('runner.cmd','@echo off\r\n'+fragment+'\r\nexit /b 0\r\n:vercelfail\r\nexit /b 17\r\n');
  f.put('mock-deploy.cmd','@echo off\r\necho simulated failure\r\nexit /b 17\r\n');
  assert.throws(()=>execFileSync('cmd.exe',['/d','/c','runner.cmd'],{cwd:f.root,stdio:'pipe'}),e=>e.status===17);
  f.put('mock-deploy.cmd','@echo off\r\necho simulated success\r\nexit /b 0\r\n');
  execFileSync('cmd.exe',['/d','/c','runner.cmd'],{cwd:f.root,stdio:'pipe'});
});
