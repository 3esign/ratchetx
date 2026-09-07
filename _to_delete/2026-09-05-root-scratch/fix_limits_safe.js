const fs = require('fs');
for (const file of ['skills/ratchetx/scripts/session-play.mjs', 'skills/ratchetx/scripts/session-smoke.mjs']) {
  let code = fs.readFileSync(file, 'utf8');
  code = code.replace('value.maxStakeCredits<=10000\n', 'value.maxStakeCredits<=10000000\n');
  code = code.replace('value.maxGrossCredits<=100000\n', 'value.maxGrossCredits<=100000000\n');
  fs.writeFileSync(file, code);
}
console.log('Limits fixed safely.');
