const fs = require('fs');
const file = 'lib/play_session.js';
let code = fs.readFileSync(file, 'utf8');
code = code.replace('!integer(l.maxStakeCredits,100,10000)', '!integer(l.maxStakeCredits,100,10000000)');
code = code.replace('!integer(l.maxGrossCredits,l.maxStakeCredits,100000)', '!integer(l.maxGrossCredits,l.maxStakeCredits,100000000)');
fs.writeFileSync(file, code);
console.log('Fixed backend limits.');
