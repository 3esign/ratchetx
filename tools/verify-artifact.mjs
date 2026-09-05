#!/usr/bin/env node
// One-command artifact tuple check. Dependency-free. Use after every build, before every claim.
//   node tools/verify-artifact.mjs <path.so> <expectedProgramIdBase58> [expectedSha256Hex] [expectedSize]
// Release mode (used by onchain/verify-onchain.ps1):
//   EXPECT_SBPF=3 REQUIRE_CONTENT_ADDRESS=1 FORBID_PROGRAM_IDS=<csv> node tools/verify-artifact.mjs ...
// Prints size, sha256, embedded/forbidden identities, ELF version, and PASS/FAIL.
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const [,, so, id, expSha, expSize] = process.argv;
if (!so || !id) {
  console.error('usage: node tools/verify-artifact.mjs <path.so> <programId> [sha256] [size]');
  process.exit(2);
}

const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s) {
  const bytes = [0];
  for (const ch of s) {
    let c = A.indexOf(ch);
    if (c < 0) throw new Error('bad base58 char ' + ch);
    for (let i = 0; i < bytes.length; i++) {
      c += bytes[i] * 58;
      bytes[i] = c & 255;
      c >>= 8;
    }
    while (c > 0) {
      bytes.push(c & 255);
      c >>= 8;
    }
  }
  for (const ch of s) {
    if (ch === '1') bytes.push(0);
    else break;
  }
  return Buffer.from(bytes.reverse());
}

function occurrences(buf, needle) {
  let count = 0;
  let from = 0;
  while (needle.length > 0) {
    const at = buf.indexOf(needle, from);
    if (at < 0) break;
    count++;
    from = at + 1;
  }
  return count;
}

const configuredPath = path.resolve(so);
const resolvedPath = fs.realpathSync(configuredPath);
const configuredParts = configuredPath.split(path.sep).filter(Boolean);
const resolvedParts = resolvedPath.split(path.sep).filter(Boolean);
const hasTargetComponent = [...configuredParts, ...resolvedParts]
  .some((part) => part.toLowerCase() === 'target');
const buf = fs.readFileSync(resolvedPath);
const sha = crypto.createHash('sha256').update(buf).digest('hex');

// ELF64: e_ident class=2, data=1 (little endian), e_flags is u32 LE at offset 0x30.
// Solana SBPF uses the complete e_flags value as the version: 0=v0 ... 3=v3.
const isElf = buf.length >= 0x34
  && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
const isElf64Le = isElf && buf[4] === 2 && buf[5] === 1;
const eFlags = isElf64Le ? buf.readUInt32LE(0x30) : null;
const sbpfVersion = isElf64Le ? eFlags : null;
const idBytes = b58decode(id);
const idOffset = buf.indexOf(idBytes);
const idOccurrences = occurrences(buf, idBytes);
const wantSbpf = process.env.EXPECT_SBPF !== undefined
  ? Number(process.env.EXPECT_SBPF)
  : null;
const requireContentAddress = process.env.REQUIRE_CONTENT_ADDRESS === '1';
const forbiddenIds = (process.env.FORBID_PROGRAM_IDS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (wantSbpf !== null && (!Number.isInteger(wantSbpf) || wantSbpf < 0 || wantSbpf > 4)) {
  console.error('EXPECT_SBPF must be an integer from 0 through 4');
  process.exit(2);
}
if (requireContentAddress && (!expSha || !expSize || wantSbpf === null)) {
  console.error('release mode requires expected sha256, size, and EXPECT_SBPF');
  process.exit(2);
}

const forbidden = forbiddenIds.map((programId) => {
  const bytes = b58decode(programId);
  return {
    programId,
    byteLength: bytes.length,
    occurrences: occurrences(buf, bytes),
  };
});

let contentAddress = null;
let contentAddressOk = false;
if (requireContentAddress) {
  const cacheRoot = fs.realpathSync(path.join(os.tmpdir(), 'ratchetx-onchain-sbf'));
  const relative = path.relative(cacheRoot, resolvedPath);
  const withinCache = relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
  const relativeParts = relative.split(path.sep);
  contentAddressOk = withinCache
    && relativeParts.length === 2
    && relativeParts[0] === sha
    && /^[0-9a-f]{64}$/.test(relativeParts[0]);
  if (contentAddressOk) {
    contentAddress = `ratchetx-onchain-sbf/${sha}/${relativeParts[1]}`;
  }
}

const checks = [
  ['is ELF64 little-endian', isElf64Le, isElf ? `class ${buf[4]}, data ${buf[5]}` : 'not an ELF'],
  ['path excludes mutable target components', !hasTargetComponent, hasTargetComponent ? 'target component found' : 'no target component'],
  ['id embedded (declare_id baked)', idOccurrences >= 1, idOccurrences >= 1 ? `${idOccurrences} occurrence(s), first offset ${idOffset}` : 'NOT FOUND'],
  ['id is 32 bytes', idBytes.length === 32, `${idBytes.length}`],
];
if (requireContentAddress) {
  checks.push(['content-addressed temp cache path', contentAddressOk, contentAddress ?? 'path/hash layout mismatch']);
}
if (wantSbpf !== null) {
  checks.push([`sbpf version == ${wantSbpf}`, sbpfVersion === wantSbpf, `e_flags=0x${(eFlags ?? 0).toString(16)} -> sbpf v${sbpfVersion}`]);
}
if (expSha) checks.push(['sha256 matches expected', sha === expSha.toLowerCase(), sha]);
if (expSize) checks.push(['size matches expected', buf.length === Number(expSize), `${buf.length}`]);
for (const item of forbidden) {
  checks.push([
    `forbidden id absent: ${item.programId}`,
    item.byteLength === 32 && item.occurrences === 0,
    `${item.byteLength} bytes; ${item.occurrences} occurrence(s)`,
  ]);
}

const pass = checks.every((check) => check[1]);
console.log(JSON.stringify({
  file: resolvedPath,
  contentAddress,
  size: buf.length,
  sha256: sha,
  programId: id,
  idOffset,
  idOccurrences,
  forbiddenIds: forbidden,
  elf: {
    isElf64Le,
    eFlagsHex: eFlags === null ? null : '0x' + eFlags.toString(16),
    sbpfVersion,
  },
  checks: checks.map(([check, ok, detail]) => ({ check, ok, detail })),
  verdict: pass ? 'PASS' : 'FAIL',
}, null, 2));
process.exit(pass ? 0 : 1);
