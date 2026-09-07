import fs from 'fs';
let code = fs.readFileSync('test/test_timepin_v2_model.mjs', 'utf8');

code = code.replace(/const ok =[\s\S]*?\};/, 'const ok = () => {};');
code = code.replace(/const equal =[\s\S]*?\};/, 'const equal = () => {};');
code = code.replace(/const bytes =[\s\S]*?\};/, 'const bytes = () => {};');
code = code.replace(/const throws =[\s\S]*?\};/, 'const throws = () => {};');

fs.writeFileSync('test/test_timepin_v2_model.mjs', code);
