const fs = require('fs');
let code = fs.readFileSync('skills/ratchetx/scripts/session-play.mjs', 'utf8');
code = code.replace(/i\.stake<=10000/g, "i.stake<=10000000");
fs.writeFileSync('skills/ratchetx/scripts/session-play.mjs', code);
console.log('Fixed validIntent stake limit');
