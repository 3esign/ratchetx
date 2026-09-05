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

function gitFiles(root, args) {
  const run = spawnSync('git', ['-C', root, 'ls-files', '-z', ...args], {
    encoding:'utf8', timeout:60000, maxBuffer:8_000_000,
  });
  if (run.error || run.status !== 0) throw new Error('Cannot enumerate deployment input with Git');
  return run.stdout.split('\0').filter(Boolean);
}

// Git is only the ignore-pattern engine and index inventory here. In particular,
// --exclude-standard must NOT be added: gitignored local files can still be sent
// by a folder-based Vercel deployment. No file contents are read by this module.
export function inspectDeployInput(root = process.cwd(), {ignoreFile = '.vercelignore'} = {}) {
  root = path.resolve(root);
  const ignore = path.resolve(root, ignoreFile);
  if (!fs.statSync(ignore).isFile()) throw new Error('Missing .vercelignore');
  const tracked = new Set(gitFiles(root, ['--cached']));
  const excludedTracked = new Set(gitFiles(root, ['--cached', '--ignored', '--exclude-from='+ignore]));
  const possible = new Set(gitFiles(root, ['--cached', '--others', '--exclude-from='+ignore]));
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
    if(!name.includes('/')&&!ROOT_FILES.has(name)&&!/^.+\.(css|png|jpe?g)$/.test(name))
      errors.push('Unreviewed root deployment file: '+name);
    if(name.includes('/')&&!tracked.has(name))
      errors.push('Untracked deployment file must be reviewed and tracked: '+name);
  }
  return {files, errors, tracked:[...tracked]};
}
