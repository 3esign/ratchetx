import fs from 'fs';
let code = fs.readFileSync('test/test_timepin_v2_model.mjs', 'utf8');
code = code.replace('C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp', 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx');
fs.writeFileSync('test/test_timepin_v2_model.mjs', code);
