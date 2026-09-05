import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectDeployInput,isNeverReadPath,enumerateStable} from '../scripts/check-deploy-input.mjs';

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
test('named root allowlist files ship only once tracked',t=>{
  const f=fixture(t),names=['merkle_tree.json','rescue_census.txt','manifest.json'];
  for(const name of names)f.put(name);
  const unreviewed=f.check();
  for(const name of names){
    assert.ok(unreviewed.files.includes(name),'the folder upload would include '+name);
    assert.ok(unreviewed.errors.includes('Unreviewed root deployment file: '+name),name);
  }
  f.track(names);
  const reviewed=f.check();
  assert.deepEqual(reviewed.errors,[]);
  for(const name of names)assert.ok(reviewed.files.includes(name));
});
test('untracked root scripts and data fail even though tracked source is clean',t=>{const f=fixture(t);for(const n of ['fix12.js','claim.js','push_report.txt','merkle_excluded.json','rogue.patch','approx'])f.put(n);const r=f.check();for(const n of ['fix12.js','claim.js','push_report.txt','merkle_excluded.json','rogue.patch','approx'])assert.ok(r.errors.some(e=>e.endsWith(n)),n);});
test('gitignored root and nested scratch cannot hide from folder upload guard',t=>{const f=fixture(t);f.put('.gitignore','private_dump.txt\napi/scratch.js\n');f.put('private_dump.txt');f.put('api/scratch.js');const r=f.check();assert.ok(r.files.includes('private_dump.txt'));assert.ok(r.errors.some(e=>e.endsWith('private_dump.txt')));assert.ok(r.errors.some(e=>e.endsWith('api/scratch.js')));});
test('vercelignore exclusions apply to tracked and untracked files',t=>{const f=fixture(t,'fix*.js\n*.patch\n_to_delete/\n');f.put('fix.js');f.put('fix2.js');f.put('a.patch');f.put('_to_delete/data.json');f.track(['fix.js']);const r=f.check();assert.deepEqual(r.errors,[]);for(const n of ['fix.js','fix2.js','a.patch','_to_delete/data.json'])assert.ok(!r.files.includes(n));});
test('ordered exceptions retain only exact public skill companions',t=>{const f=fixture(t,'*.md\nskills/ratchetx/scripts/*\n!skills/ratchetx/SKILL.md\n!skills/ratchetx/scripts/session-play.mjs\n');for(const n of ['README.md','skills/ratchetx/SKILL.md','skills/ratchetx/private.md','skills/ratchetx/scripts/session-play.mjs','skills/ratchetx/scripts/private.mjs'])f.put(n);f.track(['README.md','skills']);const r=f.check();assert.deepEqual(r.errors,[]);assert.ok(r.files.includes('skills/ratchetx/SKILL.md'));assert.ok(r.files.includes('skills/ratchetx/scripts/session-play.mjs'));assert.ok(!r.files.includes('skills/ratchetx/private.md'));assert.ok(!r.files.includes('skills/ratchetx/scripts/private.mjs'));});
test('unexcluded private path fails by name without content inspection',t=>{const f=fixture(t,'');f.put('id.json','not a key; fixture');const r=f.check();assert.ok(r.errors.some(e=>e.startsWith('Private path')));for(const n of ['.env','.env.production','data/secrets.json','onchain/program-keypair.json','vault.keys/a.json'])assert.equal(isNeverReadPath(n),true,n);});
test('bad enumeration and absent ignore fail closed',t=>{const f=fixture(t);fs.renameSync(f.root+'/.vercelignore',f.root+'/saved-ignore');assert.throws(f.check);});
test('deleted tracked file is omitted while a tracked unexpected root still fails',t=>{const f=fixture(t);fs.unlinkSync(f.root+'/robots.txt');f.put('private.txt');f.track(['private.txt']);const r=f.check();assert.ok(!r.files.includes('robots.txt'));assert.ok(r.errors.some(e=>e.endsWith('private.txt')));});
test('nested untracked file requires review while a newly reviewed tracked file is accepted',t=>{const f=fixture(t);f.put('lib/new-runtime.js');assert.ok(f.check().errors.some(e=>e.endsWith('lib/new-runtime.js')));f.track(['lib/new-runtime.js']);assert.deepEqual(f.check().errors,[]);});

// Measured 2026-09-05 (OpusB, synthetic-repo probe against the real gate): before
// this guard existed, notes/dump.txt and internal/creds.txt shipped with
// errors:[] as soon as they were tracked. .vercelignore could not catch them --
// a denylist can only name directories that already exist.
test('a tracked file in an unreviewed top-level directory cannot ship',t=>{const f=fixture(t);f.put('notes/dump.txt');f.track(['notes/dump.txt']);assert.ok(f.check().errors.some(e=>e.startsWith('Unreviewed deployment directory: notes/dump.txt')));f.put('lib/ok.js');f.track(['lib/ok.js']);assert.ok(!f.check().errors.some(e=>e.includes('lib/ok.js')));});
// The extension escape for the site's own stylesheets and icons is a review
// bypass unless tracked-ness carries the review, which is the signal the nested
// check already uses. Untracked style.css/logo.png shipped with errors:[] before.
test('root assets ship by extension only once they are tracked',t=>{const f=fixture(t);f.put('style.css');f.put('logo.png');assert.ok(f.check().errors.some(e=>e.endsWith('style.css')));assert.ok(f.check().errors.some(e=>e.endsWith('logo.png')));f.track(['style.css','logo.png']);assert.deepEqual(f.check().errors,[]);});

// Measured 2026-09-05: this gate reported a TRACKED file as untracked AND as an
// unreviewed deployment directory, because a commit landed between the first of
// its three git ls-files calls and the third. Nothing was wrong with the tree.
// The message it printed then told the reader to allowlist "docs", which would
// have published every review in the repository, so a race here is not a wasted
// red - it is a wrong instruction under time pressure.
test('a listing that moves under the enumeration is retried, not believed',t=>{
  let call=0;
  // The index settles after the first sweep, exactly as a landing commit does.
  const shifting=which=>{
    if(which==='tracked') return ++call<=1 ? ['a.js'] : ['a.js','docs/new.md'];
    return which==='excludedTracked' ? ['docs/new.md'] : ['a.js','docs/new.md'];
  };
  const r=enumerateStable(shifting,3);
  assert.deepEqual(r.tracked,['a.js','docs/new.md'],'the settled listing is the one used');
  assert.ok(call>2,'it re-read the tracked listing rather than trusting one pass');
});

test('a listing that never settles yields no verdict at all',t=>{
  let n=0;
  const never=which=>which==='tracked' ? ['f'+(n++)] : [];
  assert.throws(()=>enumerateStable(never,3),/index changed while the deployment input was being enumerated/);
});

// The advice must never be "publish this directory" for a directory
// .vercelignore already excludes. That combination means the listing disagrees
// with itself, and the only safe reading of it is: do not act on this.
test('a directory .vercelignore already excludes is never suggested for the allowlist',t=>{
  const f=fixture(t,'docs/\n');
  f.put('docs/keep.md');f.track(['docs/keep.md']);
  f.put('notes/dump.txt');f.track(['notes/dump.txt']);
  const errs=f.check().errors.join(' | ');
  assert.ok(/notes.*add "notes" to ROOT_DIRS/.test(errs),'a genuinely new directory still says how to review it');
  assert.ok(!/add "docs" to ROOT_DIRS/.test(errs),'an excluded directory is never proposed for the allowlist');
});
