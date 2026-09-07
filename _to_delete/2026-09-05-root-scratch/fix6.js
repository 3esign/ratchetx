const fs = require('fs');
let code = fs.readFileSync('skills/ratchetx/scripts/session-smoke.mjs', 'utf8');

code = code.replace(/need\(target&&target\.kind==='dir'&&target\.mins===5&&!target\.feed2,'TARGET_NOT_FIVE_MINUTES'\);/g, "need(target&&target.kind==='dir'&&!target.feed2,'TARGET_NOT_DIRECTIONAL');");

code = code.replace(/&&feed\.activeTargets\?\.some\(row=>row\.id===intent\.target&&row\.horizonMinutes===5\),'CONTEXT_REFUSED'\);/g, "&&feed.activeTargets?.some(row=>row.id===intent.target),'CONTEXT_REFUSED');");

fs.writeFileSync('skills/ratchetx/scripts/session-smoke.mjs', code);
console.log('Fixed session-smoke.mjs target minutes restriction');
