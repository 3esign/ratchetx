#!/usr/bin/env node
// Turn an agent's public error ref back into the throw it came from.
//
// The runtime shows a public reply only from an allowlist of error codes, so
// anything unrecognised arrives as AGENT_CHECK_FAILED - four words and, until
// 2026-09-10, a dead end for the owner too. It now carries a ref: the first
// eight hex of sha256 over the raw code or message. That discloses nothing (a
// message cannot be read back out of a digest) and identifies the failure
// exactly, for whoever holds the source.
//
// This resolves one. It hashes every string literal that the runtime and its
// dependency closure can throw or use as a code, and reports the matches.
//
//   node tools/explain-agent-ref.mjs 1a2b3c4d
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const refOf = text => createHash('sha256').update(String(text)).digest('hex').slice(0, 8);

const SOURCES = ['skills/ratchetx-g2/scripts', 'lib/g2', 'onchain/ratchet-core-g2/client'];

export function candidates(root = ROOT) {
  const found = new Map();
  const walk = dir => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.mjs$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      // Every single- or double-quoted literal. Crude on purpose: a throw can be
      // assembled from a constant, a template or a thrown Error's message, and a
      // narrow regex that only understood `throw new Error('x')` would miss the
      // ones that actually reach a user.
      for (const match of text.matchAll(/'([^'\\\n]{3,120})'|"([^"\\\n]{3,120})"/g)) {
        const value = match[1] ?? match[2];
        if (!found.has(value)) found.set(value, path.relative(root, full));
      }
    }
  };
  for (const dir of SOURCES) walk(path.join(root, dir));
  return found;
}

if (process.argv[1] && process.argv[1].endsWith('explain-agent-ref.mjs')) {
  const wanted = (process.argv[2] || '').toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(wanted)) {
    console.error('usage: node tools/explain-agent-ref.mjs <8 hex characters>');
    process.exitCode = 2;
  } else {
    const hits = [...candidates()].filter(([value]) => refOf(value) === wanted);
    if (!hits.length) {
      console.log(JSON.stringify({ ref: wanted, found: false,
        note: 'No literal in the runtime closure hashes to this. The text was probably assembled at runtime - a message from web3.js, an RPC or the OS. Ask the operator for the host diagnose output next.' }));
    } else {
      for (const [value, file] of hits) console.log(JSON.stringify({ ref: wanted, found: true, text: value, file }));
    }
  }
}
