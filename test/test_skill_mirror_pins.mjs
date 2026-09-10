// The mirror cannot lag the skill it mirrors.
//
// skills/ratchetx is what the site tells a Bankr user to install from, and
// skills/ratchetx-g2 is where the runtime build writes its pins. On 2026-09-10
// the second was repacked for newly deployed programs and the first was not, so
// the published instructions would have installed an archive built for programs
// that no longer existed - verified against its own old hash, and wrong. A hash
// pin protects against a corrupted download. Nothing protects against a faithful
// copy of the wrong thing except this.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const pin = (text, key) => text.match(new RegExp(key + ': "([^"]+)"'))?.[1] ?? null;
const release = text => text.match(/^const RELEASE = (\{[^\n]+\});$/m)?.[1] ?? null;

test('the ratchetx mirror pins exactly what ratchetx-g2 pins', () => {
  const g2 = read('skills/ratchetx-g2/SKILL.md');
  const mirror = read('skills/ratchetx/SKILL.md');
  for (const key of ['version', 'runtime-sha256', 'installer-sha256']) {
    const a = pin(g2, key), b = pin(mirror, key);
    assert.ok(a, `skills/ratchetx-g2/SKILL.md declares no ${key}`);
    assert.equal(b, a, `skills/ratchetx/SKILL.md ${key} is ${b}, the skill it mirrors says ${a}. `
      + 'A published install path that names an older runtime installs it successfully and runs the wrong client.');
  }
});

test('both installers name the same release, and the declared installer digest is that file', () => {
  const g2 = release(read('skills/ratchetx-g2/scripts/install.mjs'));
  const mirror = release(read('skills/ratchetx/scripts/install.mjs'));
  assert.ok(g2, 'no RELEASE pin in the g2 installer');
  assert.equal(mirror, g2, 'the mirror installer names a different release archive');

  // And the digest each SKILL.md publishes is really that installer's bytes -
  // otherwise an agent that checks the digest before running rejects the honest
  // file, or accepts a stale one.
  for (const dir of ['skills/ratchetx-g2', 'skills/ratchetx']) {
    const declared = pin(read(`${dir}/SKILL.md`), 'installer-sha256');
    const actual = createHash('sha256').update(fs.readFileSync(new URL(`../${dir}/scripts/install.mjs`, import.meta.url))).digest('hex');
    assert.equal(declared, actual, `${dir}/SKILL.md publishes an installer digest that is not its installer`);
  }
});

test('the Bankr-facing mirror exposes the same G2 runtime source', () => {
  assert.equal(read('skills/ratchetx/scripts/g2-session.mjs'), read('skills/ratchetx-g2/scripts/g2-session.mjs'),
    'Bankr mirrors companion resources from skills/ratchetx, so its g2-session.mjs cannot lag the packaged runtime source');
});

test('the installer downloads the pinned runtime from GitHub while Vercel is blocked', () => {
  const installer = read('skills/ratchetx/scripts/install.mjs');
  const release = JSON.parse(installer.match(/^const RELEASE = (\{[^\n]+\});$/m)?.[1] ?? '{}');
  assert.equal(release.url, 'https://raw.githubusercontent.com/3esign/ratchetx/main/releases/g2-agent-runtime.json.gz');
  assert.match(installer, /raw\\\.githubusercontent\\\.com\\\/3esign\\\/ratchetx\\\/main\\\/releases\\\/g2-agent-runtime\\\.json\\\.gz/);
});


test('Bankr command dispatch updates the runtime before execution', () => {
  const skill = read('skills/ratchetx/SKILL.md');
  assert.match(skill, /run `node scripts\/install\.mjs` before each command dispatch/,
    'Bankr must update the installed runtime even when run.mjs already exists');
  assert.doesNotMatch(skill, /run\.mjs` is missing when a command arrives/,
    'the old missing-file-only rule left Bankr on stale runtimes after skill updates');
});
