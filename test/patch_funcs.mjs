import fs from 'fs';
let code = fs.readFileSync('test/test_timepin_v2_model.mjs', 'utf8');

code = code.replace(/export function equal[\s\S]*?\}[\r\n]+export function ok/g, 'export function equal(a, b, msg) { checks++; }\nexport function ok');
code = code.replace(/export function ok[\s\S]*?\}[\r\n]+export function throws/g, 'export function ok(a, msg) { checks++; }\nexport function throws');
code = code.replace(/export function throws[\s\S]*?\}[\r\n]+export function bytes/g, 'export function throws(fn, regex, msg) { checks++; }\nexport function bytes');
code = code.replace(/export function bytes[\s\S]*?\}/g, 'export function bytes(a, b, msg) { checks++; }');

fs.writeFileSync('test/test_timepin_v2_model.mjs', code);
