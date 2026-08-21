// Are the four agents actually four opinions? Measure their agreement across
// the real board generator, not by inspection.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const src = require('fs').readFileSync('../api/game.js','utf8');
const pick = n => { const m = src.match(new RegExp(`(?:function ${n}\\\\b|const ${n} =)`)); return m ? m.index : -1; };
// evaluate the pure pieces in isolation
const slice = s0 => src.slice(src.indexOf(s0));
const TYPVOL = eval('(' + src.match(/const TYPVOL = (\{[^}]*\})/)[1] + ')');
const agentSideSrc = src.slice(src.indexOf('function agentSide('), src.indexOf('// ---- the fleet'));
const agentSide = eval(`(TYPVOL) => { ${agentSideSrc}; return agentSide; }`)(TYPVOL);

const KINDS = ['dir','thr','thrDown','range','race'];
const FEEDS = ['SOL','BTC','ETH','BONK','WIF','JUP','PUMP'];
const ids = ['mom','rev','vol','con'];
const votes = {}; ids.forEach(i => votes[i] = []);
let n = 0;
for (const feed of FEEDS) for (const kind of KINDS)
  for (const pct of [0.004, 0.012, 0.03])
    for (const d of [-0.05,-0.02,-0.008,-0.001,0,0.001,0.008,0.02,0.05])
      for (const wardenUp of [true,false]) {
        const t = { kind, feed, pct };
        ids.forEach(i => votes[i].push(agentSide(i, t, {}, d, n, wardenUp)));
        n++;
      }
console.log('scenarios:', n, '\n');
const agree = (a,b) => votes[a].filter((v,i)=>v===votes[b][i]).length / n;
console.log('pairwise agreement:');
for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) {
  const a = agree(ids[i], ids[j]);
  const flag = a > 0.9 ? '  <-- near-duplicate' : a < 0.1 ? '  <-- near-mirror' : '';
  console.log(`  ${ids[i]} vs ${ids[j]}: ${(a*100).toFixed(1)}%${flag}`);
}
const bad = ids.flatMap((a,i)=>ids.slice(i+1).map(b=>agree(a,b))).filter(a=>a>0.9||a<0.1);
console.log(bad.length ? `\n${bad.length} DEGENERATE PAIR(S)` : '\nno degenerate pairs — four independent opinions');
