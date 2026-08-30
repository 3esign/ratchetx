import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {webcrypto, createHash} from 'node:crypto';

const require = createRequire(import.meta.url);
const ui = require('../play-session.js');
const server = require('../lib/play_session.js');
const html = fs.readFileSync(new URL('../play-session.html', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../play-session.js', import.meta.url), 'utf8');
const wallet = '11111111111111111111111111111111';
const wallet2 = 'So11111111111111111111111111111111111111112';
const defaults = {maxAttempts: '1', maxStakeCredits: '500', maxGrossCredits: '500', durationMinutes: '30', minIntervalSeconds: '60'};
const options = ui.readLimits(defaults);
assert.deepEqual(options, {limits: {maxAttempts: 1, maxStakeCredits: 500, maxGrossCredits: 500, minIntervalMs: 60000}, durationMs: 1800000});
for (const [key, value] of [['maxAttempts', 0], ['maxAttempts', 1.2], ['maxStakeCredits', 99], ['maxGrossCredits', 499], ['durationMinutes', 1441], ['minIntervalSeconds', 4]]) {
  assert.throws(() => ui.readLimits({...defaults, [key]: value}), /INVALID_LIMITS/);
}
const token = await ui.createCredential(wallet, webcrypto), time = Date.now();
assert.match(token.token, /^rxp1\.[1-9A-HJ-NP-Za-km-z]{32,44}\.[a-f0-9]{32}\.[a-f0-9]{64}$/);
assert.equal(token.tokenHash, createHash('sha256').update(token.token).digest('hex'));
assert.deepEqual(server.parseToken(token.token), {wallet, id: token.id, tokenHash: token.tokenHash});
const grant = ui.grantPayload(wallet, token.id, token.tokenHash, time, options.durationMs, options.limits);
assert.equal(JSON.stringify(grant), JSON.stringify(server.canonicalGrant(grant, time)), 'grant signature bytes match server exactly');
const revoke = ui.ownerPayload('revoke', wallet, token.id, time);
assert.equal(JSON.stringify(revoke), JSON.stringify(server.canonicalRevoke(revoke, time)), 'revoke signature bytes match server exactly');
assert.equal(JSON.stringify(ui.ownerPayload('owner_status', wallet, token.id, time)), JSON.stringify({domain: 'ratchetx.xyz', network: 'solana:mainnet', version: 'play-session-v1', action: 'owner_status', wallet, id: token.id, issuedAt: time}));
assert.equal(JSON.stringify(ui.ownerPayload('recover', wallet, token.id, time, 'a'.repeat(32))), JSON.stringify({domain: 'ratchetx.xyz', network: 'solana:mainnet', version: 'play-session-v1', action: 'recover', wallet, id: token.id, issuedAt: time, requestId: 'a'.repeat(32)}));
for (const action of ['owner_status', 'recover']) {
  const payload = ui.ownerPayload(action, wallet, token.id, time, 'a'.repeat(32));
  assert.equal(JSON.stringify(payload), JSON.stringify(server.canonicalOwner(payload, time)), action + ' signature bytes match server exactly');
}
assert.throws(() => ui.ownerPayload('grant', wallet, token.id, time), /INVALID_SESSION_ID/);
assert.throws(() => ui.ownerPayload('recover', wallet, token.id, time, 'wrong'), /INVALID_REQUEST_ID/);
assert.equal(ui.signatureBase64({signature: new Uint8Array(64)}, btoa), 'A'.repeat(86) + '==');
assert.throws(() => ui.signatureBase64({signature: new Uint8Array(32)}, btoa), /INVALID_WALLET_SIGNATURE/);
assert.equal(ui.safeError(new Error(token.token)).includes(token.token), false, 'errors never echo arbitrary provider text');

assert.match(html, /<script src="\/play-session\.js" defer><\/script>/);
assert.doesNotMatch(html, /<script[^>]+src="https?:/);
assert.match(html, /type="password" readonly autocomplete="off"/);
assert.match(html, /gross reserved attempts, not successful shots/);
assert.match(html, /An attempt reserved before revocation may still finish/);
assert.match(html, /This page does not integrate with or verify Bankr/);
assert.match(html, /Bankr Settings → Env Vars/);
assert.match(html, /RATCHET_PLAY_SESSION/);
assert.match(html, /ratchetx.xyz only/);
assert.match(html, /Never paste this in chat/);
assert.match(html, /href="\/"/);
assert.match(html, /href="\/agents"/);
assert.doesNotMatch(source, /console\.|innerHTML|sessionStorage|URLSearchParams|history\.|signTransaction|signAndSendTransaction/);
assert.equal((source.match(/localStorage\.setItem/g) || []).length, 1, 'only one explicitly allowlisted metadata write');

function fixture({origin = 'https://ratchetx.xyz', saved = null, signReply, postMode = 'ok'} = {}) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const nodes = Object.fromEntries(ids.map(id => [id, {value: defaults[id] || '', checked: false,
    hidden: false, disabled: false, textContent: '', type: id === 'credential' ? 'password' : 'text',
    listeners: {}, attributes: {}, addEventListener(event, fn) {this.listeners[event] = fn;},
    setAttribute(key, value) {this.attributes[key] = value;}}]));
  const requests = [], signed = [], clipboard = [], storage = new Map(saved ? [['ratchet.play-session.owner-metadata.v1', JSON.stringify(saved)]] : []);
  const providerEvents = new Map(), windowEvents = new Map(), documentEvents = new Map();
  let session, responseMode = postMode;
  const provider = {publicKey: wallet, connect: async () => ({publicKey: provider.publicKey}), disconnect: async () => {},
    on: (name, fn) => providerEvents.set(name, fn), removeListener: name => providerEvents.delete(name),
    signMessage: async (bytes, encoding) => {signed.push({payload: new TextDecoder().decode(bytes), encoding}); return signReply ? signReply(provider) : {signature: new Uint8Array(64), publicKey: provider.publicKey};}};
  const doc = {getElementById: id => {assert.ok(nodes[id], 'known DOM id ' + id); return nodes[id];},
    addEventListener: (name, fn) => documentEvents.set(name, fn)};
  const win = {location: {origin}, crypto: webcrypto, btoa, phantom: {solana: provider}, setTimeout, clearTimeout,
    navigator: {clipboard: {writeText: async value => clipboard.push(value)}},
    localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    addEventListener: (name, fn) => windowEvents.set(name, fn),
    fetch: async (url, init) => {
      const body = init.body && JSON.parse(init.body);
      requests.push({url, init, body});
      assert.equal(url, '/api/game?action=play-session');
      assert.equal(init.mode, 'same-origin'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store'); assert.equal(init.referrerPolicy, 'no-referrer');
      let data = {ok: true, enabled: true, network: 'solana:mainnet', rights: ['shot', 'status']};
      if (body) {
        if (responseMode === 'network-error') throw new Error('Network failed');
        const payload = JSON.parse(body.payload);
        if (body.op === 'grant') {
          assert.equal(JSON.stringify(payload), JSON.stringify(server.canonicalGrant(payload, payload.issuedAt)));
          session = {wallet: payload.wallet, id: payload.id, expiresAt: payload.expiresAt, revokedAt: null,
            limits: payload.limits, budgetRule: payload.budgetRule, attempts: 0, grossCredits: 0, pending: null, requests: {}};
          data = {ok: true, id: payload.id};
        } else if (body.op === 'owner-status') data = {ok: true, session};
        else if (body.op === 'recover') {session.pending = null; data = {ok: true, recovered: true};}
        else if (body.op === 'revoke') {session.revokedAt = Date.now(); data = {ok: true, revoked: true};}
        else assert.fail('unexpected op');
      }
      return {ok: true, headers: {get: key => key === 'date' ? new Date().toUTCString() : null}, json: async () => data};
    }};
  ui.mount(win, doc);
  async function dispatch(id, event = 'click') {
    const task = nodes[id].listeners[event]({preventDefault() {}});
    if (task && typeof task.then === 'function') await task;
    for (let i = 0; i < 100 && nodes.connectWallet.disabled; i++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(nodes.connectWallet.disabled, false, 'controller completes within the fixture deadline');
  }
  return {nodes, requests, signed, clipboard, storage, dispatch, provider, providerEvents, windowEvents,
    session: () => session, responseMode: value => {responseMode = value;}};
}

const f = fixture();
assert.equal(f.requests.length, 0, 'loading never automatically connects, signs, checks or plays');
assert.equal(f.nodes.grantSession.disabled, true);
await f.dispatch('checkApi');
assert.equal(f.signed.length, 0);
await f.dispatch('connectWallet');
assert.equal(f.signed.length, 0, 'connecting is not a hidden grant');
assert.equal(f.nodes.grantSession.disabled, true, 'explicit consent is still required');
await f.dispatch('grantForm', 'submit');
assert.equal(f.signed.length, 0, 'submitting without consent cannot sign');
f.nodes.consent.checked = true;
await f.dispatch('consent', 'change');
await f.dispatch('grantForm', 'submit');
assert.equal(f.signed.length, 1);
assert.equal(f.nodes.credentialPanel.hidden, false);
assert.equal(f.nodes.credential.type, 'password');
const createdToken = f.nodes.credential.value;
assert.match(createdToken, /^rxp1\./);
assert.equal(f.storage.size, 0, 'metadata saving is opt-in; credential is never stored');
for (const req of f.requests) assert.equal((req.init.body || '').includes(createdToken), false, 'server receives only token hash');
assert.equal(f.nodes.signedPayload.textContent.includes(createdToken), false);
f.nodes.rememberSession.checked = true;
await f.dispatch('rememberSession', 'change');
assert.deepEqual(JSON.parse([...f.storage.values()][0]), {wallet, id: f.nodes.sessionId.value});
await f.dispatch('copyCredential');
assert.equal(f.clipboard[0], createdToken, 'only explicit copy sends the token to local clipboard');
await f.dispatch('ownerStatus');
assert.equal(f.signed.length, 2); assert.equal(f.nodes.sessionState.textContent, 'ACTIVE');
assert.equal(f.nodes.recoveryPanel.hidden, true);
f.session().pending = 'b'.repeat(32);
f.session().attempts = 1; f.session().grossCredits = 500;
await f.dispatch('ownerStatus');
assert.equal(f.nodes.recoveryPanel.hidden, false);
const postsBeforeRecovery = f.requests.filter(req => req.body).length;
await f.dispatch('recoverSession');
assert.equal(f.requests.filter(req => req.body).length, postsBeforeRecovery + 1, 'recovery never automatically retries a shot or asks for another signature');
assert.equal(f.requests.at(-1).body.op, 'recover');
assert.equal(JSON.parse(f.requests.at(-1).body.payload).requestId, 'b'.repeat(32));
await f.dispatch('revokeSession');
assert.equal(f.nodes.credential.value, ''); assert.equal(f.nodes.credentialPanel.hidden, true);
assert.match(f.nodes.actionStatus.textContent, /previously reserved attempt may still finish/);
assert.equal(f.requests.some(req => req.body && req.body.op === 'shot'), false, 'setup has no shot transport');

const restored = fixture({saved: {wallet: wallet2, id: 'c'.repeat(32)}});
assert.equal(restored.nodes.sessionId.value, 'c'.repeat(32));
assert.equal(restored.nodes.credential.value, '');
await restored.dispatch('connectWallet');
assert.equal(JSON.parse([...restored.storage.values()][0]).wallet, wallet2, 'connecting a different wallet cannot silently relabel the saved owner');

const uncertain = fixture({postMode: 'network-error'});
await uncertain.dispatch('checkApi'); await uncertain.dispatch('connectWallet');
uncertain.nodes.consent.checked = true; await uncertain.dispatch('grantForm', 'submit');
assert.equal(uncertain.nodes.credential.value, '', 'no credential is revealed without server confirmation');
assert.equal(uncertain.nodes.credentialPanel.hidden, true);
assert.match(uncertain.nodes.sessionId.value, /^[a-f0-9]{32}$/, 'non-secret ID retained for lost-response owner recovery');
assert.match(uncertain.nodes.actionStatus.textContent, /may have completed/);
assert.equal(uncertain.requests.filter(req => req.body).length, 1, 'no network retries');

const switched = fixture({signReply: provider => {provider.publicKey = wallet2; return {signature: new Uint8Array(64), publicKey: wallet2};}});
await switched.dispatch('checkApi'); await switched.dispatch('connectWallet');
switched.nodes.consent.checked = true; await switched.dispatch('grantForm', 'submit');
assert.equal(switched.requests.filter(req => req.body).length, 0, 'wallet switch during signing fails closed');
assert.equal(switched.nodes.credential.value, '');

const cancelled = fixture({signReply: () => {throw Object.assign(new Error('cancelled'), {code: 4001});}});
await cancelled.dispatch('checkApi'); await cancelled.dispatch('connectWallet');
cancelled.nodes.consent.checked = true; await cancelled.dispatch('grantForm', 'submit');
assert.equal(cancelled.requests.filter(req => req.body).length, 0, 'cancelling the wallet dialog sends no grant');
assert.equal(cancelled.nodes.credential.value, '');
assert.match(cancelled.nodes.actionStatus.textContent, /cancelled/);

const cleared = fixture();
await cleared.dispatch('checkApi'); await cleared.dispatch('connectWallet');
cleared.nodes.consent.checked = true; await cleared.dispatch('grantForm', 'submit');
await cleared.dispatch('toggleCredential'); assert.equal(cleared.nodes.credential.type, 'text');
const beforeClear = cleared.requests.length;
await cleared.dispatch('clearCredential');
assert.equal(cleared.nodes.credential.value, ''); assert.equal(cleared.nodes.credential.type, 'password');
assert.equal(cleared.requests.length, beforeClear, 'clearing is not a hidden revoke or network action');
cleared.nodes.consent.checked = true;
cleared.nodes.maxAttempts.value = '2';
await cleared.dispatch('maxAttempts', 'input');
assert.equal(cleared.nodes.consent.checked, false, 'changing any bound resets consent');
await cleared.dispatch('disconnectWallet');
assert.equal(cleared.nodes.grantSession.disabled, true);

const local = fixture({origin: 'http://localhost:8080'});
await local.dispatch('connectWallet'); assert.equal(local.signed.length, 0); assert.equal(local.requests.length, 0);
assert.match(local.nodes.actionStatus.textContent, /official setup page/);
await local.dispatch('checkApi'); assert.equal(local.requests.length, 1, 'unsigned local preflight is testable');

console.log('PASS bounded session page: exact signed contracts, consent, private credential lifecycle, metadata isolation, owner recovery/revoke and failure guards');
