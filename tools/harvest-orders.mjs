#!/usr/bin/env node
// Re-derive lib/legacy_chain.js's TEMPLATES from this repository's own history.
//
// Every legacy log entry was hashed over its keys in INSERTION order, and the
// storage layer later re-sorted them. The orders are therefore not lost: they
// are still written down at every append() call site that has ever existed
// here. This walks all commits and reads them back out, so the recovery table
// is reproducible by anyone with the repo rather than being a list we assert.
//
//   node tools/harvest-orders.mjs            # print the table as JSON
//
// The scanner is deliberately careful about template literals: an append site
// like appendOnce(`seal:${w}:${id}`, {...}) contains a brace inside ${…}, and
// a naive search lands there instead of on the object — which is exactly the
// mistake that left the 9+ key shapes without a template and untested.
import { execSync } from 'node:child_process';
const sh = c => { try {
  return execSync(c, { cwd: process.cwd(), maxBuffer: 1 << 28, stdio: ['ignore','pipe','ignore'] }).toString();
} catch { return ''; } };

function skipToObject(src, i) {
  let depth = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") { const q = ch; i++; while (i < src.length && !(src[i] === q && src[i-1] !== '\\')) i++; i++; continue; }
    if (ch === '`') {
      i++;
      while (i < src.length) {
        if (src[i] === '`' && src[i-1] !== '\\') break;
        if (src[i] === '$' && src[i+1] === '{') { let d = 1; i += 2; while (i < src.length && d) { if (src[i] === '{') d++; else if (src[i] === '}') d--; i++; } continue; }
        i++;
      }
      i++; continue;
    }
    if (ch === '{') return i;
    if (ch === '(') depth++;
    if (ch === ')') { if (!depth) return -1; depth--; }
    i++;
  }
  return -1;
}

function topKeys(src, start) {
  const parts = []; let depth = 0, buf = '', i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") { const q = ch; buf += ch; i++; while (i < src.length && !(src[i] === q && src[i-1] !== '\\')) buf += src[i++]; buf += src[i] || ''; i++; continue; }
    if (ch === '`') { buf += ch; i++;
      while (i < src.length) {
        if (src[i] === '`' && src[i-1] !== '\\') break;
        if (src[i] === '$' && src[i+1] === '{') { let d = 1; buf += '${'; i += 2; while (i < src.length && d) { if (src[i] === '{') d++; else if (src[i] === '}') d--; buf += src[i++]; } continue; }
        buf += src[i++];
      }
      buf += '`'; i++; continue; }
    if (ch === '{' || ch === '[') { depth++; if (depth === 1 && ch === '{') { i++; continue; } buf += ch; i++; continue; }
    if (ch === '}' || ch === ']') { depth--; if (!depth) { parts.push(buf); break; } buf += ch; i++; continue; }
    if (ch === ',' && depth === 1) { parts.push(buf); buf = ''; i++; continue; }
    buf += ch; i++;
  }
  return parts.map(x => (x.match(/^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::|$)/) || [])[1]).filter(Boolean);
}

const commits = sh('git log --all --format=%H').split('\n').filter(Boolean);
const seen = new Map();
for (const c of commits) {
  for (const f of sh(`git ls-tree -r --name-only ${c}`).split('\n').filter(x => /^(api|lib|tools)\/.*\.m?js$/.test(x))) {
    const src = sh(`git show ${c}:${f}`);
    if (!src.includes('append')) continue;
    for (const m of src.matchAll(/append(?:Once)?\s*\(/g)) {
      const b = skipToObject(src, m.index + m[0].length);
      if (b < 0) continue;
      const keys = topKeys(src, b);
      if (keys.length < 2) continue;
      const kind = (src.slice(b, b + 500).match(/k\s*:\s*'([A-Za-z0-9_-]+)'/) || [])[1] || '?';
      const sig = keys.join(',');
      if (!seen.has(sig)) seen.set(sig, { kind, keys });
    }
  }
}
const out = [...seen.values()].sort((a, b) => b.keys.length - a.keys.length);
console.log(JSON.stringify(out, null, 0));
console.error(`${out.length} distinct key orders across ${commits.length} commits; largest ${out[0]?.keys.length} keys`);
