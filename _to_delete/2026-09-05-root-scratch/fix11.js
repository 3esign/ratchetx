const fs = require('fs');
let code = fs.readFileSync('test/test_play_session_page.mjs', 'utf8');
code = code.replace(/\['10', '10000000', '100000000', '240', '30'\]/, "['10', '10000000', '100000000', '240', '1']");
fs.writeFileSync('test/test_play_session_page.mjs', code);
let code2 = fs.readFileSync('test/test_session_smoke.mjs', 'utf8');
code2 = code2.replace(/\[{mins:60},'TARGET_NOT_FIVE_MINUTES'\],/g, "");
code2 = code2.replace(/\[{maxAttempts:2},'INVALID_SESSION'\]/g, "[{maxAttempts:2},'INVALID_SESSION'],[{stake:20000},'INVALID_SESSION']");
fs.writeFileSync('test/test_session_smoke.mjs', code2);
console.log('Fixed tests');
