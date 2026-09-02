// The browser derives commit salts with a copy of the algorithm that lives in
// onchain/ratchet-core/client/salt.mjs. A copy is a liability: the day the two
// drift, every salt derived after that day stops rebuilding, and nobody finds
// out until a player tries to recover one and cannot. So the copy is pinned.
//
// This runs the ACTUAL source lifted out of index.html -- not a paraphrase of
// it -- against the reference module, with a fixed signature, and demands the
// same bytes out of both.
import assert from 'node:assert';
import fs from 'node:fs';
import { seedMessage, seedFromSignature, saltFromSeed, SALT_RE } from
  '../onchain/ratchet-core/client/salt.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const from = html.indexOf('const SALT_SCOPE=');
const to = html.indexOf('$("fire").onclick', from);
assert.ok(from > 0 && to > from, 'the salt derivation must still be in index.html');
const source = html.slice(from, to);

// A wallet that signs deterministically, as Ed25519 does.
const SIG = new Uint8Array(64).map((_, i) => (i * 37 + 11) & 0xff);
const WALLET = '7Xq2mF8kLpR4vN1sJhT6bYwZ3cAeQdG9uK5rM0nP2xVd';
const win = { phantom: { solana: { signMessage: async () => ({ signature: SIG.slice() }) } } };
const run = new Function('window', 'crypto', source + '\nreturn { saltFor, seedSentence, saltSeed };');
const browser = run(win, globalThis.crypto);

let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };

// 1. the signed sentence is the same sentence
ok(browser.seedSentence(WALLET) === seedMessage({ scope: 'ratchetx.xyz', wallet: WALLET }),
  'the browser must sign exactly the sentence the reference module defines');

// 2. the seed is the same 32 bytes
const seedRef = await seedFromSignature(SIG);
const seedBrowser = await browser.saltSeed(WALLET);
ok(Buffer.from(seedBrowser).equals(Buffer.from(seedRef)),
  'the browser seed must equal seedFromSignature of the same signature');

// 3. the salt is the same salt, for whatever nonce the browser chose
const got = await browser.saltFor(WALLET);
ok(got && SALT_RE.test(got.salt), 'the browser must produce a wire-format salt');
ok(/^[0-9a-f]{16}$/.test(got.saltNonce), 'the nonce must be hex the server will accept');
ok(await saltFromSeed(seedRef, got.saltNonce) === got.salt,
  'saltFromSeed must reproduce the browser salt from the published nonce alone');

// 4. and it is a fresh nonce each time, or two shots would share a salt
const again = await browser.saltFor(WALLET);
ok(again.saltNonce !== got.saltNonce && again.salt !== got.salt,
  'each shot must get its own nonce and its own salt');

// 5. a wallet that signs differently every time is refused rather than trusted.
// It would hand back a salt that can never be rebuilt, and the player would
// discover that at reveal, when the stake is already forfeit.
const flaky = { phantom: { solana: { signMessage: async () =>
  ({ signature: new Uint8Array(64).map(() => Math.floor(Math.random() * 256)) }) } } };
const shaky = run(flaky, globalThis.crypto);
ok(await shaky.saltFor(WALLET) === null,
  'a non-deterministic wallet must fall back to the server salt, not derive an unrecoverable one');

// 6. no wallet at all is not an error -- it is every agent, Bankr and MCP seal,
// which keep the server's random salt exactly as before.
const bare = run({}, globalThis.crypto);
ok(await bare.saltFor(WALLET) === null, 'no signMessage means no client salt, and no thrown error');

// 7. the server accepts precisely what the browser sends
const game = fs.readFileSync(new URL('../api/game.js', import.meta.url), 'utf8');
const saltRe = game.match(/const SALT_RE = (\/.*?\/);/)[1];
const nonceRe = game.match(/const SALT_NONCE_RE = (\/.*?\/);/)[1];
ok(new RegExp(saltRe.slice(1, -1)).test(got.salt), 'the server salt bound must accept a real browser salt');
ok(new RegExp(nonceRe.slice(1, -1)).test(got.saltNonce), 'the server nonce bound must accept a real browser nonce');

console.log(`SALT PARITY OK — ${checks} checks: the page and the reference module `
  + `derive the same salt from the same signature, and the server takes it`);
