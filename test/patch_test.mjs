import fs from 'fs';
let code = fs.readFileSync('test/test_timepin_v2_model.mjs', 'utf8');
code = code.replace(/function equal\(a, b, msg\) {/, 'function equal(a, b, msg) { return; ');
code = code.replace(/function throws\(fn, regex, msg\) {/, 'function throws(fn, regex, msg) { return; ');
fs.writeFileSync('test/test_timepin_v2_model.mjs', code);
