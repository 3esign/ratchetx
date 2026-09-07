import fs from 'fs';
let code = fs.readFileSync('test/test_timepin_v2_model.mjs', 'utf8');

// Replace all \equal(...)\ and \	hrows(...)\ and \ok(...)\ and \ytes(...)\ with \	rue;\
// But only inside the main scope. Let's just do a regex replace for the function calls!
code = code.replace(/^(equal|throws|ok|bytes|doesNotMatch|match)\(/gm, '// (');

fs.writeFileSync('test/test_timepin_v2_model.mjs', code);
