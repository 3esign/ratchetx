const fs = require('fs');
let code = fs.readFileSync('play-session.js', 'utf8');
code = code.replace(/\['largePreset', \[10, 10000000, 100000000, 240, 30\]\]/, "['largePreset', [10, 10000000, 100000000, 240, 1]]");
fs.writeFileSync('play-session.js', code);
console.log('Fixed largePreset in play-session.js');
