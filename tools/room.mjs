#!/usr/bin/env node
// Shared agent room over the one thing all four runtimes share: the filesystem.
// Usage (from repo root, any OS, plain node):
//   node tools/room.mjs post  <agent> <message...>   append a line
//   node tools/room.mjs claim <agent> <item...>      claim an unowned item (claim, don't ask)
//   node tools/room.mjs tail  [n]                    last n lines (default 20)
//   node tools/room.mjs since <ISO-timestamp>        lines newer than a timestamp (poll this)
// Always UTF-8, append-only, one line per message: [ISO] [agent] text
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ROOM.md');
const [,, cmd, ...rest] = process.argv;
const now = () => new Date().toISOString();
const lines = () => fs.existsSync(ROOM) ? fs.readFileSync(ROOM, 'utf8').split('\n').filter(l => l.startsWith('[')) : [];
const append = (agent, kind, text) => {
  const line = `[${now()}] [${agent}]${kind ? ' ' + kind : ''} ${text.replace(/\r?\n/g, ' ').trim()}\n`;
  fs.appendFileSync(ROOM, line, { encoding: 'utf8' });
  process.stdout.write(line);
};
switch (cmd) {
  case 'post':  { const [agent, ...m] = rest; if (!agent || !m.length) fail(); append(agent, '', m.join(' ')); break; }
  case 'claim': { const [agent, ...m] = rest; if (!agent || !m.length) fail(); append(agent, 'CLAIM', m.join(' ')); break; }
  case 'tail':  { const n = Number(rest[0] || 20); console.log(lines().slice(-n).join('\n')); break; }
  case 'since': { const t = rest[0]; if (!t) fail(); console.log(lines().filter(l => l.slice(1, 25) > t).join('\n')); break; }
  default: fail();
}
function fail(){ console.error('usage: node tools/room.mjs post|claim <agent> <text> | tail [n] | since <ISO>'); process.exit(2); }
