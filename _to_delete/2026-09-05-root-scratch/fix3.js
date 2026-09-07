const fs = require('fs');

let lib = fs.readFileSync('lib/play_session.js', 'utf8');
lib = lib.replace('!integer(l.minIntervalMs, 30000, 600000)', '!integer(l.minIntervalMs, 1000, 600000)');
lib = lib.replace('!integer(l.minIntervalMs,30000,600000)', '!integer(l.minIntervalMs,1000,600000)');
fs.writeFileSync('lib/play_session.js', lib);

let js = fs.readFileSync('play-session.js', 'utf8');
js = js.replace('boundedInteger(values.minIntervalSeconds, 30, 600', 'boundedInteger(values.minIntervalSeconds, 1, 600');
js = js.replace('l.minIntervalMs < 30000', 'l.minIntervalMs < 1000');
fs.writeFileSync('play-session.js', js);

let html = fs.readFileSync('play-session.html', 'utf8');
html = html.replace('min="30" value="30"', 'min="1" value="1"');
fs.writeFileSync('play-session.html', html);

console.log('Fixed minInterval');
