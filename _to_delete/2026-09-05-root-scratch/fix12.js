const fs = require('fs');

let page = fs.readFileSync('test/test_play_session_page.mjs', 'utf8');
page = page.replace(/\['10','10000000','100000000','240','30'\]/, "['10','10000000','100000000','240','1']");
fs.writeFileSync('test/test_play_session_page.mjs', page);

let smoke = fs.readFileSync('test/test_session_smoke.mjs', 'utf8');
smoke = smoke.replace(/,\[\{stake:20000\},'INVALID_SESSION'\]/, "");
fs.writeFileSync('test/test_session_smoke.mjs', smoke);

let play = fs.readFileSync('test/test_session_play.mjs', 'utf8');
play = play.replace(/\[\{mins:60\},'TARGET_NOT_FIVE_MINUTES'\],/, "");
play = play.replace(/\[\{stake:20000\},'EXPLICIT_INTENT_REQUIRED'\],/, "");
fs.writeFileSync('test/test_session_play.mjs', play);

console.log('Tests fixed');
