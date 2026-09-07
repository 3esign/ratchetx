const fs = require('fs');
for (const file of ['skills/ratchetx/scripts/session-play.mjs', 'skills/ratchetx/scripts/session-smoke.mjs']) {
  let code = fs.readFileSync(file, 'utf8');
  code = code.replace(/value\.minIntervalMs>=5000/g, 'value.minIntervalMs>=1000');
  fs.writeFileSync(file, code);
}
console.log('Fixed minIntervalMs');
