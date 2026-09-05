import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const ROOT_FILES = new Set([
  '.gitattributes', '.gitignore', '.vercelignore',
  'index.html', 'claim.html', 'agents.html', 'gauntlet.html', 'observatory.html',
  'play-session.html', 'play-session.js', 'manifest.json', 'actions.json',
  'server.json', 'openapi.json', 'agent-registration.json', 'llms.txt', 'robots.txt',
  'sitemap.xml', 'rescue_census.txt', 'merkle_tree.json', 'vercel.json',
  'package.json', 'package-lock.json',
]);
export const isNeverReadPath = name => /(^|\/)(\.env(?:\..*)?|secrets\.json|[^/]*keypair[^/]*\.json|id\.json)$|(^|\/)[^/]*\.keys(\/|$)/i.test(name);

// A new top-level directory is a new public surface, and .vercelignore cannot
// guard one: it is a denylist, so it can only name the directories that existed
// when it was written. Measured 2026-09-05 against the real gate: a TRACKED file
// in a directory nobody thought to ignore shipped with zero errors
// (notes/dump.txt -> ships:true errors:[]). Root was already an allowlist below;
// this is the same allowlist one level down. Contents are the top-level segments
// of the deploy set actually measured that day (103 files), not a guess.
const ROOT_DIRS = new Set([
  '.github', '.well-known', 'api', 'lib', 'releases', 'skills', 'vendor',
]);
// The site's own stylesheets and icons ship from the root. They are allowed by
// extension rather than by name, but only once they are TRACKED: an untracked
// root .css/.png reaches a folder-based deployment without ever having been
// reviewed, which is the same unreviewed channel the nested check closes. Nine
// root assets shipped this way on 2026-09-05 and all nine were tracked.
const isReviewedRootAsset = (name, tracked) =>
  /^.+\.(css|png|jpe?g)$/.test(name) && tracked.has(name);

function gitFiles(root, args) {
  const run = spawnSync('git', ['-C', root, 'ls-files', '-z', ...args], {
    encoding:'utf8', timeout:60000, maxBuffer:8_000_000,
  });
  if (run.error || run.status !== 0) throw new Error('Cannot enumerate deployment input with Git');
  return run.stdout.split('\0').filter(Boolean);
}

// Three listings, one index, and the index does not hold still.
//
// `git ls-files` cannot answer all three questions at once, and on 2026-09-05
// this gate went red on docs/reviews/opus-lead-2026-09-05/MIN_CAPTURE_S7_TESTS.md
// with two verdicts that were both false: it called a TRACKED file untracked, and
// it called a directory .vercelignore has excluded since h69 an unreviewed
// deployment surface. Nothing was wrong with the tree. A commit had landed
// between the first listing and the third, so the file was absent from `tracked`
// and present in `possible`. With several agents committing minutes apart that is
// the normal case, not a rare one, and the cost is not just a wasted red: the
// message it printed told the reader to add `docs` to the allowlist, which would
// have published every review and internal plan in the repository.
//
// So the tracked listing is read again after the other two and the enumeration is
// retried while it keeps moving. If it will not hold still, this throws: a gate
// that cannot enumerate its own input has no verdict to give, and no verdict is
// the safe answer.
const sameListing = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

export function enumerateStable(list, attempts = 3) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    const before = list('tracked');
    const excludedTracked = list('excludedTracked');
    const possible = list('possible');
    const after = list('tracked');
    if (sameListing(before, after)) return {tracked: before, excludedTracked, possible};
    last = before.length + ' then ' + after.length + ' tracked files';
  }
  throw new Error('The index changed while the deployment input was being enumerated ('
    + last + '); no verdict is given rather than a wrong one. Re-run when commits settle.');
}

// Git is only the ignore-pattern engine and index inventory here. In particular,
// --exclude-standard must NOT be added: gitignored local files can still be sent
// by a folder-based Vercel deployment. No file contents are read by this module.
export function inspectDeployInput(root = process.cwd(), {ignoreFile = '.vercelignore', attempts = 3} = {}) {
  root = path.resolve(root);
  const ignore = path.resolve(root, ignoreFile);
  if (!fs.statSync(ignore).isFile()) throw new Error('Missing .vercelignore');
  const listings = enumerateStable(which => gitFiles(root,
    which === 'tracked' ? ['--cached']
    : which === 'excludedTracked' ? ['--cached', '--ignored', '--exclude-from='+ignore]
    : ['--cached', '--others', '--exclude-from='+ignore]), attempts);
  const tracked = new Set(listings.tracked);
  const excludedTracked = new Set(listings.excludedTracked);
  const possible = new Set(listings.possible);
  // Whatever .vercelignore already excludes is not a public surface question, so
  // the directory message below must never point at one of those directories.
  const ignoredTops = new Set([...excludedTracked].map(n => n.split('/')[0]));
  const files=[], errors=[];
  for (const name of [...possible].sort()) {
    if (excludedTracked.has(name)) continue;
    if (name.includes('\\') || name.startsWith('/') || name.split('/').some(s=>s==='..'||s==='.') || /[\x00-\x1f\x7f]/.test(name)) {
      errors.push('Unsafe deployment path'); continue;
    }
    let unsafe = false, cursor=root;
    for (const part of name.split('/')) {
      cursor=path.join(cursor,part);
      let stat;
      try {stat=fs.lstatSync(cursor);} catch(e) {if(e.code==='ENOENT'){unsafe=true;break;}throw e;}
      if(stat.isSymbolicLink()){errors.push('Symlink in deployment input: '+name);unsafe=true;break;}
    }
    if(unsafe)continue; // Missing tracked paths are not uploaded.
    if(!fs.lstatSync(cursor).isFile()){errors.push('Non-file deployment input: '+name);continue;}
    files.push(name);
    if(isNeverReadPath(name)) errors.push('Private path is not excluded from deployment: '+name);
    if(!name.includes('/')){
      if(!(ROOT_FILES.has(name)&&tracked.has(name))&&!isReviewedRootAsset(name,tracked))
        errors.push('Unreviewed root deployment file: '+name);
    }else{
      const top=name.split('/')[0];
      if(!ROOT_DIRS.has(top))
        errors.push('Unreviewed deployment directory: '+name+(ignoredTops.has(top)
          ? ' (.vercelignore already excludes "'+top+'/", so this listing disagrees with itself -'
            + ' do NOT add it to ROOT_DIRS; re-run, and if it persists the index is inconsistent)'
          : ' (add "'+top+'" to ROOT_DIRS in check-deploy-input.mjs only after reviewing everything that directory publishes)'));
      if(!tracked.has(name))
        errors.push('Untracked deployment file must be reviewed and tracked: '+name);
    }
  }
  return {files, errors, tracked:[...tracked]};
}
