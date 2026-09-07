const fs = require('fs');
let code = fs.readFileSync('test/test_play_session_page.mjs', 'utf8');
code = code.replace(/'30'/g, "'1'"); // This might replace too many, let's be careful
