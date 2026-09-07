import fs from 'node:fs';
const src = fs.readFileSync(new URL('../../test/test_manifest_is_approved.mjs', import.meta.url), 'utf8');
const cut = src.indexOf('const live = draftReasons');
const mod = src.slice(0, cut);
const b64 = Buffer.from(mod).toString('base64');
const m = await import('data:text/javascript;base64,' + b64);
const base = JSON.parse(fs.readFileSync(new URL('../../releases/g2-mainnet-economy.json', import.meta.url), 'utf8'));
for (const s of ['UNAPPROVED','DISAPPROVED','NOT YET APPROVED','NOT APPROVED FOR REGISTRATION','APPROVED BY THE OWNER 2026-09-05']) {
  const c = JSON.parse(JSON.stringify(base)); c.status = s;
  console.log(JSON.stringify(s).padEnd(36), '-> draftReasons:', m.draftReasons(c).length);
}
