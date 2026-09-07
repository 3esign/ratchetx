const fs = require('fs');
let html = fs.readFileSync('play-session.html', 'utf8');
html = html.replace('min="30" max="600" step="1" value="30"', 'min="1" max="600" step="1" value="1"');
html = html.replace('30—600 seconds', '1—600 seconds');
fs.writeFileSync('play-session.html', html);
console.log('Fixed HTML');
