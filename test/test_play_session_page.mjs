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
for (const [key, value] of [['maxAttempts', 0], ['maxAttempts', 1.2], ['maxStakeCredits', 99], ['maxGrossCredits', 499], ['durationMinutes', 1441], ['minIntervalSeconds', 0]]) {
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
assert.match(html, /id="grantSession"[^>]*aria-describedby="grantReadiness"/);
assert.match(html, /id="grantReadiness"[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(html, /id="checkApiNearGrant" type="button" hidden/);
assert.doesNotMatch(source, /console\.|innerHTML|sessionStorage|URLSearchParams|history\.|signTransaction|signAndSendTransaction/);
assert.equal((source.match(/localStorage\.setItem/g) || []).length, 1, 'only one explicitly allowlisted metadata write');

function fixture({origin = 'https://ratchetx.xyz', saved = null, signReply, postMode = 'ok', preflightMode = 'ok', preflightHook,
  initialSession = null, discoveryMode = 'ok', postHook} = {}) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const nodes = Object.fromEntries(ids.map(id => [id, {value: defaults[id] || '', checked: false,
    hidden: false, disabled: false, textContent: '', type: id === 'credential' ? 'password' : 'text',
    listeners: {}, attributes: {}, addEventListener(event, fn) {this.listeners[event] = fn;},
    setAttribute(key, value) {this.attributes[key] = value;}}]));
  const requests = [], signed = [], clipboard = [], storage = new Map(saved ? [['ratchet.play-session.owner-metadata.v1', JSON.stringify(saved)]] : []);
  const providerEvents = new Map(), windowEvents = new Map(), documentEvents = new Map();
  let session = initialSession, responseMode = postMode, readinessMode = preflightMode;
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
      if (!body) {
        assert.equal(init.method, 'GET', 'availability is a read-only GET');
        if (preflightHook) await preflightHook({nodes, provider, providerEvents, requests});
        if (readinessMode === 'network-error') throw new Error('Network failed');
        else if (readinessMode === 'bad-json') data = null;
        else if (readinessMode === 'disabled') data.enabled = false;
        else if (readinessMode === 'wrong-network') data.network = 'solana:devnet';
        else if (readinessMode === 'wrong-contract') data.rights = ['shot', 'status', 'transfer'];
        else assert.equal(readinessMode, 'ok', 'known preflight fixture mode');
      }
      if (body) {
        if (responseMode === 'network-error') throw new Error('Network failed');
        const payload = JSON.parse(body.payload);
        if (body.op === 'grant') {
          assert.equal(JSON.stringify(payload), JSON.stringify(server.canonicalGrant(payload, payload.issuedAt)));
          session = {wallet: payload.wallet, id: payload.id, expiresAt: payload.expiresAt, revokedAt: null,
            limits: payload.limits, budgetRule: payload.budgetRule, attempts: 0, grossCredits: 0, pending: null, requests: {}};
          data = {ok: true, id: payload.id};
        } else if (body.op === 'owner-discover') {
          assert.equal(JSON.stringify(payload), JSON.stringify(server.canonicalDiscovery(payload, payload.issuedAt)));
          assert.equal(Object.hasOwn(payload, 'id'), false, 'discovery requires no session ID');
          assert.equal(Object.hasOwn(init.headers, 'Authorization'), false, 'owner signatures never attach bearer');
          data = {ok: true, readOnly: true, discovery: 'latest-retained-session-v1', wallet: payload.wallet,
            nonce: payload.nonce, observedAt: Date.now(), session};
          if (discoveryMode === 'wrong-wallet') data.wallet = wallet2;
          else if (discoveryMode === 'wrong-nonce') data.nonce = '0'.repeat(32);
          else if (discoveryMode === 'missing-session') delete data.session;
          else if (discoveryMode === 'stale-time') data.observedAt -= 600000;
          else if (discoveryMode === 'wrong-session-wallet') data.session = {...session, wallet: wallet2};
          else if (discoveryMode === 'wrong-id') data.session = {...session, id: '<invalid>'};
          else if (discoveryMode === 'bad-limits') data.session = {...session, limits: {...session.limits, maxAttempts: '1'}};
          else assert.equal(discoveryMode, 'ok');
        } else if (body.op === 'owner-status') data = {ok: true, session};
        else if (body.op === 'recover') {session.pending = null; data = {ok: true, recovered: true};}
        else if (body.op === 'revoke') {session.revokedAt = Date.now(); data = {ok: true, revoked: true};}
        else assert.fail('unexpected op');
        if (postHook) await postHook({body, data, nodes, provider, providerEvents, windowEvents, storage, requests});
      }
      return {ok: true, headers: {get: key => key === 'date' ? new Date().toUTCString() : null}, json: async () => {
        if ((!body && readinessMode === 'bad-json') || (body && responseMode === 'bad-json')) throw new Error('Invalid JSON');
        return data;
      }};
    }};
  ui.mount(win, doc);
  async function dispatch(id, event = 'click') {
    const task = nodes[id].listeners[event]({preventDefault() {}});
    if (task && typeof task.then === 'function') await task;
    for (let i = 0; i < 100 && nodes.connectWallet.disabled; i++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(nodes.connectWallet.disabled, false, 'controller completes within the fixture deadline');
  }
  return {nodes, requests, signed, clipboard, storage, dispatch, provider, providerEvents, windowEvents,
    session: () => session, setSession: value => {session = value;}, responseMode: value => {responseMode = value;}, preflightMode: value => {readinessMode = value;}};
}

const f = fixture();
assert.equal(f.requests.length, 0, 'loading never automatically connects, signs, checks or plays');
assert.equal(f.nodes.grantSession.disabled, true);
assert.equal(f.nodes.checkApiNearGrant.hidden, true, 'nearby retry is hidden until a wallet is connected');
await f.dispatch('connectWallet');
assert.equal(f.requests.length, 1, 'connecting without a manual check automatically checks availability exactly once');
assert.equal(f.requests[0].init.method, 'GET');
assert.equal(f.requests.filter(req => req.body).length, 0, 'connecting sends no grant or play request');
assert.equal(f.signed.length, 0, 'connecting is not a hidden grant');
assert.equal(f.nodes.grantSession.disabled, true, 'explicit consent is still required');
assert.equal(f.nodes.consent.checked, false);
assert.match(f.nodes.grantReadiness.textContent, /Availability passed.*consent checkbox/);
assert.equal(f.nodes.checkApiNearGrant.hidden, true, 'successful readiness hides the nearby retry');
await f.dispatch('grantForm', 'submit');
assert.equal(f.signed.length, 0, 'submitting without consent cannot sign');
assert.equal(f.requests.length, 1, 'submitting without consent does not even recheck availability');
f.nodes.consent.checked = true;
await f.dispatch('consent', 'change');
assert.equal(f.nodes.grantSession.disabled, false, 'wallet plus passed readiness plus explicit consent enables signing');
assert.match(f.nodes.grantReadiness.textContent, /^Ready\./);
assert.equal(f.requests.length, 1, 'consent itself performs no network action');
await f.dispatch('grantForm', 'submit');
assert.equal(f.requests.filter(req => req.init.method === 'GET').length, 2, 'explicit submission rechecks availability before signing');
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

for (const mode of ['disabled', 'network-error', 'bad-json', 'wrong-network', 'wrong-contract']) {
  const unavailable = fixture({preflightMode: mode});
  await unavailable.dispatch('connectWallet');
  unavailable.nodes.consent.checked = true;
  await unavailable.dispatch('consent', 'change');
  assert.equal(unavailable.requests.length, 1, mode + ': failed readiness is not automatically retried');
  assert.equal(unavailable.requests.filter(req => req.body).length, 0, mode + ': failed readiness cannot send a POST');
  assert.equal(unavailable.signed.length, 0, mode + ': failed readiness never requests a signature');
  assert.equal(unavailable.nodes.grantSession.disabled, true, mode + ': consent cannot override failed readiness');
  assert.equal(unavailable.nodes.checkApiNearGrant.hidden, false, mode + ': nearby retry is visible');
  assert.equal(unavailable.nodes.checkApiNearGrant.disabled, false, mode + ': nearby retry is usable');
  assert.match(unavailable.nodes.grantReadiness.textContent, /Availability has not passed.*CHECK AVAILABILITY/);
  assert.equal(unavailable.nodes.grantReadiness.textContent.includes(unavailable.nodes.preflightStatus.textContent), true,
    mode + ': the nearby explanation includes the actual readiness failure');
  assert.match(unavailable.nodes.preflightStatus.textContent, ['network-error', 'bad-json'].includes(mode) ? /Availability check failed/ : /unavailable or its contract does not match/);
  assert.doesNotMatch(unavailable.nodes.preflightStatus.textContent, /action may have completed|Check owner status with the session ID/);
  if (['network-error', 'bad-json'].includes(mode)) {
    assert.match(unavailable.nodes.preflightStatus.textContent, /read-only check.*did not create a session or spend credits.*CHECK AVAILABILITY/);
  }
  unavailable.preflightMode('ok');
  await unavailable.dispatch('checkApiNearGrant');
  assert.equal(unavailable.requests.length, 2, mode + ': explicit retry makes exactly one more GET');
  assert.equal(unavailable.requests.every(req => req.init.method === 'GET' && !req.body), true);
  assert.equal(unavailable.signed.length, 0, mode + ': retry never signs automatically');
  assert.equal(unavailable.nodes.walletAddress.textContent, wallet, mode + ': retry preserves the connected owner');
  assert.equal(unavailable.nodes.consent.checked, true, mode + ': retry preserves explicit consent for unchanged limits');
  assert.equal(unavailable.nodes.grantSession.disabled, false, mode + ': a successful retry unlocks signing');
  assert.equal(unavailable.nodes.checkApiNearGrant.hidden, true);

  unavailable.preflightMode(mode);
  await unavailable.dispatch('grantForm', 'submit');
  assert.equal(unavailable.requests.length, 3, mode + ': submission rechecks newly changed availability');
  assert.equal(unavailable.requests.every(req => req.init.method === 'GET' && !req.body), true);
  assert.equal(unavailable.signed.length, 0, mode + ': readiness loss before submission fails before wallet signing');
  assert.equal(unavailable.nodes.grantSession.disabled, true);
  assert.equal(unavailable.nodes.credentialPanel.hidden, true);
  assert.match(unavailable.nodes.actionStatus.textContent, /Session creation is not currently available/);
}

for (const disconnectAt of [1, 2]) {
  const disconnected = fixture({preflightHook: ({nodes, providerEvents, requests}) => {
    assert.equal(nodes.grantSession.disabled, true, 'signing stays disabled while readiness is checking');
    assert.equal(nodes.checkApiNearGrant.disabled, true, 'readiness cannot be dispatched concurrently');
    assert.match(nodes.grantReadiness.textContent, /Checking availability.*read-only/);
    if (requests.length === disconnectAt) providerEvents.get('disconnect')();
  }});
  await disconnected.dispatch('connectWallet');
  if (disconnectAt === 2) {
    disconnected.nodes.consent.checked = true;
    await disconnected.dispatch('consent', 'change');
    assert.equal(disconnected.nodes.grantSession.disabled, false);
    await disconnected.dispatch('grantForm', 'submit');
  }
  assert.equal(disconnected.requests.length, disconnectAt);
  assert.equal(disconnected.requests.every(req => req.init.method === 'GET' && !req.body), true,
    'a disconnect during either readiness gate sends no POST');
  assert.equal(disconnected.signed.length, 0, 'a completed readiness response cannot sign for a disconnected wallet');
  assert.equal(disconnected.nodes.walletAddress.textContent, 'No wallet connected.');
  assert.equal(disconnected.nodes.consent.checked, false, 'disconnect clears consent even during a pending readiness check');
  assert.equal(disconnected.nodes.grantSession.disabled, true, 'late successful readiness cannot unlock a disconnected wallet');
  assert.equal(disconnected.nodes.checkApiNearGrant.hidden, true);
  assert.match(disconnected.nodes.grantReadiness.textContent, /Connect your Solana wallet/);
}

const restored = fixture({saved: {wallet: wallet2, id: 'c'.repeat(32)}});
assert.equal(restored.nodes.sessionId.value, 'c'.repeat(32));
assert.equal(restored.nodes.credential.value, '');
await restored.dispatch('connectWallet');
assert.equal(JSON.parse([...restored.storage.values()][0]).wallet, wallet2, 'connecting a different wallet cannot silently relabel the saved owner');

for (const postMode of ['network-error', 'bad-json']) {
const uncertain = fixture({postMode});
await uncertain.dispatch('checkApi'); await uncertain.dispatch('connectWallet');
uncertain.nodes.consent.checked = true; await uncertain.dispatch('grantForm', 'submit');
assert.equal(uncertain.nodes.credential.value, '', 'no credential is revealed without server confirmation');
assert.equal(uncertain.nodes.credentialPanel.hidden, true);
assert.match(uncertain.nodes.sessionId.value, /^[a-f0-9]{32}$/, 'non-secret ID retained for lost-response owner recovery');
assert.match(uncertain.nodes.actionStatus.textContent, postMode === 'network-error' ? /may have completed/ : /Check owner status before taking another action/);
assert.equal(uncertain.requests.filter(req => req.body).length, 1, 'no network retries');
}

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

// Fresh device, no storage and no bearer: explicit scoped discovery only.
const sampleSession = () => ({wallet, id: 'd'.repeat(32), expiresAt: Date.now() + 1800000, revokedAt: null,
  limits: options.limits, budgetRule: 'gross-reserved-attempts-v1', attempts: 0, grossCredits: 0, pending: null, requests: {},
  tokenHash: 'hidden-token-hash', token: 'hidden-credential', revision: 'hidden-revision'});
const otherDevice = fixture({initialSession: sampleSession()});
assert.equal(otherDevice.nodes.findSession.disabled, true);
await otherDevice.dispatch('connectWallet');
assert.equal(otherDevice.nodes.findSession.disabled, false, 'same wallet can discover without any local ID');
assert.equal(otherDevice.nodes.revokeSession.disabled, true, 'revoke still needs an exact selected ID');
assert.equal(otherDevice.signed.length, 0, 'connect never discovers with a hidden signature');
assert.match(otherDevice.nodes.ownerReadiness.textContent, /another device/);
await otherDevice.dispatch('findSession');
assert.deepEqual(otherDevice.requests.filter(r => r.body).map(r => r.body.op), ['owner-discover']);
assert.equal(otherDevice.signed.length, 1);
assert.equal(otherDevice.nodes.sessionId.value, 'd'.repeat(32));
assert.equal(otherDevice.nodes.sessionIdSummary.textContent, 'd'.repeat(32));
assert.equal(otherDevice.nodes.sessionState.textContent, 'ACTIVE');
assert.equal(otherDevice.nodes.revokeSession.disabled, false);
assert.equal(otherDevice.nodes.grantSession.disabled, true, 'discovery does not imply grant consent');
assert.equal(otherDevice.nodes.credential.value, '');
assert.equal(otherDevice.nodes.credentialPanel.hidden, true);
assert.equal(otherDevice.storage.size, 0, 'discovery does not automatically persist metadata');
assert.doesNotMatch(otherDevice.nodes.sessionDetails.textContent, /hidden-token|hidden-credential|hidden-revision/);
assert.match(otherDevice.nodes.ownerRecord.attributes.href, /^\/api\/agent\?id=/);
await otherDevice.dispatch('copySessionId');
assert.deepEqual(otherDevice.clipboard, ['d'.repeat(32)], 'copy ID is separate from credential copy');
await otherDevice.dispatch('revokeSession');
assert.equal(otherDevice.signed.length, 2, 'revocation needs its own new signature');
assert.deepEqual(otherDevice.requests.filter(r => r.body).map(r => r.body.op), ['owner-discover', 'revoke']);
await otherDevice.dispatch('findSession');
assert.equal(otherDevice.nodes.sessionState.textContent, 'REVOKED');
assert.equal(otherDevice.nodes.revokeSession.disabled, true, 'confirmed revoked record does not invite another revoke');

for (const [patch, state] of [[{expiresAt: Date.now() - 10000}, 'EXPIRED'],
  [{attempts: 1, grossCredits: 100}, 'ALLOWANCE USED'], [{pending: 'a'.repeat(32), attempts: 1, grossCredits: 100}, 'PENDING']]) {
  const f = fixture({initialSession: {...sampleSession(), ...patch}});
  await f.dispatch('connectWallet'); await f.dispatch('findSession');
  assert.equal(f.nodes.sessionState.textContent, state);
  assert.equal(f.nodes.recoveryPanel.hidden, state !== 'PENDING');
  assert.deepEqual(f.requests.filter(r => r.body).map(r => r.body.op), ['owner-discover']);
}

const absent = fixture({initialSession: sampleSession()});
await absent.dispatch('connectWallet'); await absent.dispatch('findSession');
absent.setSession(null);
await absent.dispatch('findSession');
assert.match(absent.nodes.actionStatus.textContent, /No retained session was found/);
assert.equal(absent.nodes.sessionId.value, '');
assert.equal(absent.nodes.sessionPanel.hidden, true);
assert.equal(absent.nodes.recoveryPanel.hidden, true);
assert.equal(absent.nodes.revokeSession.disabled, true);
assert.equal(absent.requests.filter(r => r.body?.op === 'grant').length, 0);

for (const discoveryMode of ['wrong-wallet', 'wrong-nonce', 'missing-session', 'stale-time', 'wrong-session-wallet', 'wrong-id', 'bad-limits']) {
  const f = fixture({initialSession: sampleSession(), discoveryMode});
  await f.dispatch('connectWallet'); await f.dispatch('findSession');
  assert.equal(f.nodes.sessionPanel.hidden, true, discoveryMode);
  assert.equal(f.nodes.sessionId.value, '', discoveryMode + ': untrusted response cannot populate an ID');
  assert.equal(f.storage.size, 0);
  assert.match(f.nodes.actionStatus.textContent, /signed read did not return a valid owner-matched result/);
  assert.equal(f.requests.filter(r => r.body).length, 1, 'no retry after mismatched read');
}
for (const postMode of ['network-error', 'bad-json']) {
  const f = fixture({postMode, initialSession: sampleSession()});
  await f.dispatch('connectWallet'); await f.dispatch('findSession');
  assert.match(f.nodes.actionStatus.textContent, /signed read/);
  assert.doesNotMatch(f.nodes.actionStatus.textContent, /action may have completed/);
  assert.equal(f.nodes.sessionPanel.hidden, true);
  assert.equal(f.requests.filter(r => r.body).length, 1);
}
for (const event of ['disconnect', 'accountChanged', 'pagehide']) {
  const f = fixture({initialSession: sampleSession(), postHook: ({body, providerEvents, windowEvents}) => {
    if (body.op === 'owner-discover') (event === 'pagehide' ? windowEvents : providerEvents).get(event)();
  }});
  await f.dispatch('connectWallet'); await f.dispatch('findSession');
  assert.equal(f.nodes.sessionPanel.hidden, true, event + ': late response cannot restore a stale owner lifecycle');
  assert.equal(f.nodes.sessionId.value, '');
  assert.equal(f.storage.size, 0);
  assert.match(f.nodes.actionStatus.textContent, /wallet account changed/);
}
const lostOwner = fixture({initialSession: sampleSession(), signReply: provider => {
  provider.publicKey = wallet2; return {signature: new Uint8Array(64), publicKey: wallet2};
}});
await lostOwner.dispatch('connectWallet'); await lostOwner.dispatch('findSession');
assert.equal(lostOwner.requests.filter(r => r.body).length, 0, 'wallet switch at discovery signature prevents POST');

const replaced = fixture();
await replaced.dispatch('connectWallet'); replaced.nodes.consent.checked = true;
await replaced.dispatch('grantForm', 'submit');
assert.match(replaced.nodes.credential.value, /^rxp1\./);
replaced.setSession(sampleSession());
await replaced.dispatch('findSession');
assert.equal(replaced.nodes.credential.value, '', 'finding another latest session clears the old visible bearer');
assert.equal(replaced.nodes.sessionId.value, 'd'.repeat(32));
assert.equal(new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])).size,
  [...html.matchAll(/\bid="([^"]+)"/g)].length, 'reordered management UI has unique IDs');

// Public command helpers never copy bearer material, even from a rich server record.
const publicCommand = ui.bankrCommand('play', sampleSession(), 'a'.repeat(32));
assert.equal(publicCommand, '@bankrbot ratchetx SOL up 5 min 100 credits', 'skill 1.5.0: words only, the post ID is the command ID');
assert.doesNotMatch(publicCommand, /Command ID|Expected owner|Session:|hidden-token|hidden-credential|rxp1\./, 'no wallet, session or command id in a public post');
assert.throws(() => ui.bankrCommand('play', sampleSession(), 'invalid'), /INVALID_REQUEST_ID/);
assert.throws(() => ui.bankrCommand('play', {...sampleSession(), wallet: 'bad'}, 'a'.repeat(32)), /INVALID_SESSION_ID/);
const commands = fixture({initialSession: sampleSession()});
assert.equal(commands.nodes.bankrCommands.hidden, true);
await commands.dispatch('connectWallet'); await commands.dispatch('findSession');
const commandReads = commands.requests.length, commandSigns = commands.signed.length;
await commands.dispatch('copyBankrStats');
assert.equal(commands.clipboard.at(-1), '@bankrbot ratchetx stats');
await commands.dispatch('copyBankrPlay');
const firstCommand = commands.clipboard.at(-1);
await commands.dispatch('copyBankrPlay');
assert.equal(commands.clipboard.at(-1), firstCommand, 'the public play words carry no nonce: Bankr uses the post ID as the command ID');
assert.equal(commands.requests.length, commandReads, 'copying makes no API call');
assert.equal(commands.signed.length, commandSigns, 'copying never signs');
assert.doesNotMatch(commands.clipboard.join('\n'), /hidden-credential|rxp1\./);
commands.nodes.consent.checked = true;
await commands.dispatch('seriesPreset');
assert.equal(commands.nodes.maxAttempts.value, '5');
assert.equal(commands.nodes.maxStakeCredits.value, '100');
assert.equal(commands.nodes.maxGrossCredits.value, '500');
assert.equal(commands.nodes.durationMinutes.value, '60');
assert.equal(commands.nodes.consent.checked, false, 'preset never supplies consent');
await commands.dispatch('singlePreset');
assert.equal(commands.nodes.maxAttempts.value, '1');
assert.equal(commands.nodes.maxGrossCredits.value, '100');
commands.nodes.consent.checked = true;
await commands.dispatch('largePreset');
assert.deepEqual(['maxAttempts','maxStakeCredits','maxGrossCredits','durationMinutes','minIntervalSeconds'].map(id=>commands.nodes[id].value), ['10','10000000','100000000','240','1']);
assert.equal(commands.nodes.consent.checked, false);
assert.match(html, /Allowance is not your balance/);
assert.match(html, /cooldown, not an automatic schedule/);
assert.match(html, /ratchetx SOL up 5 min 10000000 credits/, "the large preset is played in words, not flags");
assert.equal(commands.requests.length, commandReads, 'presets never grant or play');
await commands.dispatch('disconnectWallet');
assert.equal(commands.nodes.bankrCommands.hidden, true);
assert.equal(commands.nodes.bankrCommandText.textContent, '');
for (const patch of [{revokedAt: Date.now()}, {expiresAt: Date.now() - 1000}, {pending: 'b'.repeat(32)}, {attempts: 1}, {grossCredits: 500}]) {
  const c = fixture({initialSession: {...sampleSession(), ...patch}});
  await c.dispatch('connectWallet'); await c.dispatch('findSession');
  assert.equal(c.nodes.copyBankrPlay.disabled, true);
  await c.dispatch('copyBankrPlay');
  assert.equal(c.clipboard.length, 0, 'blocked grant cannot prepare a new play command');
}
const landing = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(landing, /id="bankrPlay"[^>]*href="\/play-session.html"/);
assert.match(landing, /PLAY WITH BANKR/);
assert.match(landing, /no play on click/);
assert.match(landing, /\.bankr-play:focus-visible/);
assert.match(landing, /@media\(max-width:640px\).*\.bankr-entry/);
console.log('PASS bounded session page: signed owner controls, private credential lifecycle, Bankr presets/public commands, no copy authority and landing CTA');
