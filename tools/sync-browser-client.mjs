#!/usr/bin/env node
// Public browser modules are byte-for-byte copies of these three reviewed sources.
// Default/--check is read-only. --write refreshes only this fixed map.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['onchain/ratchet-core-g2/client/client-v2.mjs', 'lib/g2/client-v2.mjs'],
  ['onchain/ratchet-core-g2/client/shot-receipt.mjs', 'lib/g2/shot-receipt.mjs'],
  ['ops/g2-crank/cluster.mjs', 'lib/g2/cluster.mjs'],
];
const readCopy = name => {
  try { return fs.readFileSync(path.join(root, name)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
const same = (a, b) => a === null ? b === null : b !== null && a.equals(b);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--check', '--write'].includes(args[0])))
    throw new Error('usage: node tools/sync-browser-client.mjs [--check|--write]');
  const write = args[0] === '--write';
  // Read every source before writing anything: a missing receipt source must not
  // leave a partially refreshed browser package.
  const plans = files.map(([source, target]) => ({
    source, target, bytes: fs.readFileSync(path.join(root, source)), before: readCopy(target),
  }));
  if (write) {
    for (const item of plans) {
      if (!item.bytes.equals(fs.readFileSync(path.join(root, item.source))))
        throw new Error('Source changed during sync: ' + item.source);
      if (!same(item.before, readCopy(item.target)))
        throw new Error('Browser copy changed during sync: ' + item.target);
    }
    for (const item of plans) {
      if (!item.bytes.equals(fs.readFileSync(path.join(root, item.source))) ||
          !same(item.before, readCopy(item.target)))
        throw new Error('File changed before copy: ' + item.target);
      if (!same(item.bytes, item.before)) {
        fs.mkdirSync(path.dirname(path.join(root, item.target)), { recursive: true });
        fs.writeFileSync(path.join(root, item.target), item.bytes);
      }
    }
  }
  let failures = 0;
  for (const item of plans) {
    const source = fs.readFileSync(path.join(root, item.source));
    const copy = readCopy(item.target);
    if (!same(source, copy) || !same(source, item.bytes)) {
      failures++;
      console.error((copy === null ? 'MISSING ' : 'DRIFT ') + item.target);
    } else {
      console.log('MATCH ' + item.target + ' sha256=' + digest(copy));
    }
  }
  if (failures) throw new Error('Browser module sync failed for ' + failures + ' file(s)');
}
try { main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
