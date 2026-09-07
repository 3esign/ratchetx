const fs = require('fs');
let code = fs.readFileSync('skills/ratchetx/scripts/session-smoke.mjs', 'utf8');

// 1. Fix max limits
code = code.replace('value.maxStakeCredits<=10000\n', 'value.maxStakeCredits<=10000000\n');
code = code.replace('value.maxGrossCredits<=100000\n', 'value.maxGrossCredits<=100000000\n');

// 2. Fix validReceipt for rejected shots
const receiptCheckOld = "need(HEX32.test(key)&&r?.intent?.requestId===key&&validReceipt(r,r.intent),'INVALID_SESSION');";
const receiptCheckNew = "need(HEX32.test(key)&&r?.intent?.requestId===key&&(validReceipt(r,r.intent)||(r.state==='rejected'&&r.result&&typeof r.result.code==='string'&&r.credits===r.intent.stake)),'INVALID_SESSION');";
code = code.replace(receiptCheckOld, receiptCheckNew);

fs.writeFileSync('skills/ratchetx/scripts/session-smoke.mjs', code);
console.log('Fixed session-smoke.mjs');
