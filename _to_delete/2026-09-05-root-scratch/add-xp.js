const fs = require('fs');
let code = fs.readFileSync('skills/ratchetx/scripts/session-play.mjs', 'utf8');
code = code.replace('stated:p.stated,brier:p.brier,', 'stated:p.stated,brier:p.brier,xp:p.xp,');
fs.writeFileSync('skills/ratchetx/scripts/session-play.mjs', code);
