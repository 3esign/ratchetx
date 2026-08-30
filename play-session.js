(function () {
  'use strict';

  const API = '/api/game?action=play-session';
  const DOMAIN = 'ratchetx.xyz';
  const NETWORK = 'solana:mainnet';
  const VERSION = 'play-session-v1';
  const METADATA_KEY = 'ratchet.play-session.owner-metadata.v1';
  const HEX32 = /^[a-f0-9]{32}$/;
  const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const encoder = new TextEncoder();

  function boundedInteger(value, min, max, label) {
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('INVALID_LIMITS:' + label);
    return n;
  }
  function readLimits(values) {
    const maxAttempts = boundedInteger(values.maxAttempts, 1, 100, 'attempts');
    const maxStakeCredits = boundedInteger(values.maxStakeCredits, 100, 10000, 'per-attempt credits');
    const maxGrossCredits = boundedInteger(values.maxGrossCredits, maxStakeCredits, 100000, 'total credits');
    const minIntervalMs = boundedInteger(values.minIntervalSeconds, 5, 600, 'interval') * 1000;
    const durationMs = boundedInteger(values.durationMinutes, 1, 1440, 'duration') * 60000;
    return {limits: {maxAttempts, maxStakeCredits, maxGrossCredits, minIntervalMs}, durationMs};
  }
  // Property order is part of the signed protocol. Keep pinned to lib/play_session.js.
  function grantPayload(wallet, id, tokenHash, issuedAt, durationMs, limits) {
    return {domain: DOMAIN, network: NETWORK, version: VERSION, action: 'grant', wallet,
      id, tokenHash, issuedAt, expiresAt: issuedAt + durationMs, actions: ['shot', 'status'],
      budgetRule: 'gross-reserved-attempts-v1', inFlightPolicy: 'finish-authorized-attempt-no-retry-v1',
      limits: {maxAttempts: limits.maxAttempts, maxStakeCredits: limits.maxStakeCredits,
        maxGrossCredits: limits.maxGrossCredits, minIntervalMs: limits.minIntervalMs}};
  }
  function ownerPayload(action, wallet, id, issuedAt, requestId) {
    if (!['revoke', 'owner_status', 'recover'].includes(action) || !WALLET.test(wallet) || !HEX32.test(id)) {
      throw new Error('INVALID_SESSION_ID');
    }
    const payload = {domain: DOMAIN, network: NETWORK, version: VERSION, action, wallet, id, issuedAt};
    if (action === 'recover') {
      if (!HEX32.test(requestId)) throw new Error('INVALID_REQUEST_ID');
      payload.requestId = requestId;
    }
    return payload;
  }
  function hex(bytes) { return Array.from(bytes, n => n.toString(16).padStart(2, '0')).join(''); }
  async function createCredential(wallet, webCrypto) {
    if (!WALLET.test(wallet) || !webCrypto || !webCrypto.subtle) throw new Error('SECURE_BROWSER_REQUIRED');
    const id = hex(webCrypto.getRandomValues(new Uint8Array(16)));
    const token = 'rxp1.' + wallet + '.' + id + '.' + hex(webCrypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = hex(new Uint8Array(await webCrypto.subtle.digest('SHA-256', encoder.encode(token))));
    return {id, token, tokenHash};
  }
  function signatureBase64(reply, encode) {
    const signature = reply && reply.signature;
    if (!signature || !ArrayBuffer.isView(signature) || signature.byteLength !== 64) {
      throw new Error('INVALID_WALLET_SIGNATURE');
    }
    const bytes = new Uint8Array(signature.buffer, signature.byteOffset, signature.byteLength);
    return encode(Array.from(bytes, n => String.fromCharCode(n)).join(''));
  }
  function safeError(error) {
    // Wallet/server errors must not echo arbitrary strings: a provider can include request data.
    const raw = String(error && (error.code || error.message) || '');
    const code = /^[A-Z_0-9]{1,64}$/.test(raw) ? raw : '';
    const known = {
      INVALID_SESSION_ID: 'Enter the 32-character session ID, not the private credential.',
      INVALID_REQUEST_ID: 'Check owner status again before recovering this attempt.',
      WALLET_REQUIRED: 'Connect the session owner’s Solana wallet first.',
      WALLET_UNAVAILABLE: 'Open this page in Phantom’s browser or a browser with an injected Solana wallet. No private key is needed.',
      WALLET_CHANGED: 'The wallet account changed. Reconnect and review the intended owner before signing again.',
      INVALID_WALLET_SIGNATURE: 'The wallet did not return a 64-byte message signature. No transaction-signing fallback is used.',
      SECURE_BROWSER_REQUIRED: 'A secure browser with Web Crypto is required.',
      WRONG_ORIGIN: 'Wallet signatures are enabled only at https://ratchetx.xyz. Open the official setup page to continue.',
      CONSENT_REQUIRED: 'Review the limits and tick the explicit consent checkbox first.',
      SESSION_DISABLED: 'Session creation is not currently available. No permission was created by this action.',
      AGENT_ADMISSION_REQUIRED: 'This exact wallet needs normal Ratchet arena admission before it can grant play permission. Open Agent docs; this page does not register, fund or reload a wallet.',
      PLAYER_BUSY: 'This wallet has another operation in progress. Wait for it to finish, then check owner status. No automatic retry will run.',
      SESSION_REVOKED: 'This session has been revoked. Already-reserved work may still finish.',
      SESSION_EXPIRED: 'This session has expired. You can still inspect or revoke it with its owner wallet.',
      UNKNOWN_SESSION: 'This session ID was not found for the connected wallet. Check the ID and the original owner wallet.',
      PRIOR_ATTEMPT_UNRESOLVED: 'An earlier attempt is unresolved. Check the original session’s owner status and use explicit recovery before creating another.',
      SESSION_BUDGET_EXHAUSTED: 'The session’s reserved-attempt allowance is exhausted.',
      INVALID_WINDOW: 'The signed time window was refused. Check availability to refresh server time, then review and sign again.',
      INVALID_SIGNATURE: 'The server could not verify this wallet signature. No transaction-signing fallback is used.',
      NON_CANONICAL_PAYLOAD: 'The server rejected the signed message format. Do not share the credential; report this setup error.',
      REQUEST_IN_FLIGHT: 'This attempt may still be running. Leave it pending and check status again; do not retry the shot.',
      UNKNOWN_REQUEST: 'The request was not found in this session. Check owner status again before recovery.',
      ATTEMPT_ALREADY_TERMINAL: 'This attempt already has a result. Check owner status for its receipt; do not retry the shot.',
      SESSION_CONTENTION: 'Another session operation is in progress. Check owner status before taking another action.',
      NETWORK_UNCERTAIN: 'The server response was not received. An action may have completed. Check owner status with the session ID; do not assume failure or automatically retry.',
      AVAILABILITY_UNREACHABLE: 'The read-only check could not reach the server. This check did not create a session or spend credits. Use CHECK AVAILABILITY to try the check again.',
      AVAILABILITY_BAD_RESPONSE: 'The read-only check did not receive a valid availability response. This check did not create a session or spend credits. Use CHECK AVAILABILITY to check again.',
      BAD_RESPONSE: 'The server did not return a valid confirmation. Check owner status before taking another action.'
    };
    if (known[code]) return known[code];
    if (raw.startsWith('INVALID_LIMITS:')) return 'Use whole numbers within the displayed limits. The total credit cap must be at least the per-attempt cap.';
    if (raw === '4001' || raw === 'ACTION_REJECTED') return 'The wallet request was cancelled. No further request was sent.';
    return code ? 'Request refused (' + code + '). Check owner status before retrying any change.'
      : 'The request could not be completed. Check your wallet and owner status before retrying any change.';
  }

  function mount(win, doc) {
    const el = id => doc.getElementById(id);
    let provider = null, connectedWallet = '', busy = false, apiEnabled = false, clockOffset = 0;
    let apiCheckState = 'unchecked';
    let lastSession = null, rememberedOwner = '', visibleCredential = '';
    let accountHandler = null, disconnectHandler = null;
    const limitIds = ['maxAttempts', 'maxStakeCredits', 'maxGrossCredits', 'durationMinutes', 'minIntervalSeconds'];
    function currentOptions() { return readLimits(Object.fromEntries(limitIds.map(id => [id, el(id).value]))); }
    function setMessage(message, kind) {
      const node = el('actionStatus'); node.hidden = false; node.textContent = message;
      node.className = 'message' + (kind ? ' ' + kind : '');
    }
    function now() { return Math.floor(Date.now() + clockOffset); }
    function clearCredential() {
      visibleCredential = ''; el('credential').value = ''; el('credential').type = 'password';
      el('toggleCredential').textContent = 'SHOW'; el('toggleCredential').setAttribute('aria-pressed', 'false');
      el('credentialPanel').hidden = true;
    }
    function resetSessionDisplay() {
      lastSession = null; el('sessionPanel').hidden = true; el('recoveryPanel').hidden = true;
      el('sessionDetails').textContent = ''; el('pendingRequest').textContent = '';
    }
    function updateControls() {
      const hasId = HEX32.test(el('sessionId').value.trim());
      el('connectWallet').disabled = busy;
      el('disconnectWallet').disabled = busy || !connectedWallet;
      el('checkApi').disabled = busy;
      el('checkApiNearGrant').disabled = busy;
      el('checkApiNearGrant').hidden = !connectedWallet || apiEnabled;
      el('grantSession').disabled = busy || !connectedWallet || !apiEnabled || !el('consent').checked;
      el('grantReadiness').textContent = apiCheckState === 'checking'
        ? 'Checking availability. This is read-only; no signature or play permission is requested.'
        : busy ? 'Finish the current wallet or server request before continuing.'
        : !connectedWallet ? 'Connect your Solana wallet above. Availability is checked automatically after connecting.'
        : !apiEnabled ? (apiCheckState === 'unchecked'
          ? 'Check availability below to enable signing. This check cannot create a session or spend credits.'
          : 'Availability has not passed. Use CHECK AVAILABILITY below to retry. ' + el('preflightStatus').textContent)
        : !el('consent').checked ? 'Availability passed. Review the limits and tick the consent checkbox to enable signing.'
        : 'Ready. SIGN & CREATE SESSION will request one wallet message signature for the displayed limits.';
      el('ownerStatus').disabled = busy || !connectedWallet || !hasId;
      el('revokeSession').disabled = busy || !connectedWallet || !hasId;
      el('recoverSession').disabled = busy || !connectedWallet || !lastSession || !HEX32.test(lastSession.pending || '');
      limitIds.forEach(id => { el(id).disabled = busy; });
      el('consent').disabled = busy; el('sessionId').disabled = busy;
      el('forgetSession').disabled = busy;
    }
    function summary() {
      try {
        const options = currentOptions(), l = options.limits;
        el('grantSummary').textContent = l.maxAttempts + ' reserved attempt' + (l.maxAttempts === 1 ? '' : 's')
          + ' · at most ' + l.maxStakeCredits.toLocaleString() + ' credits each · '
          + l.maxGrossCredits.toLocaleString() + ' gross credits total · expires ' + options.durationMs / 60000
          + ' minutes after issuance · at least ' + l.minIntervalMs / 1000 + ' seconds apart.';
      } catch (error) { el('grantSummary').textContent = safeError(error); }
    }
    function remember() {
      try {
        const id = el('sessionId').value.trim();
        if (el('rememberSession').checked && connectedWallet && HEX32.test(id)) {
          // The allowlist is deliberate: bearer, payload and signatures must never enter storage.
          win.localStorage.setItem(METADATA_KEY, JSON.stringify({wallet: connectedWallet, id}));
          rememberedOwner = connectedWallet;
        } else if (!el('rememberSession').checked) { win.localStorage.removeItem(METADATA_KEY); rememberedOwner = ''; }
        el('rememberedWallet').hidden = !rememberedOwner;
        el('rememberedWallet').textContent = rememberedOwner ? 'Saved session owner: ' + rememberedOwner + '. Connect this exact wallet to manage the saved session.' : '';
      } catch { setMessage('This browser could not save local metadata. Keep the non-secret session ID yourself; the credential is never saved here.'); }
    }
    function captureServerTime(response) {
      const serverTime = Date.parse(response.headers.get('date') || '');
      const age = Number(response.headers.get('age'));
      if (Number.isFinite(serverTime)) clockOffset = serverTime + (Number.isFinite(age) && age >= 0 ? age * 1000 : 0) - Date.now();
      el('clockNote').hidden = Math.abs(clockOffset) < 120000;
      el('clockNote').textContent = 'Your device clock differs from server time. Signed timestamps use the server’s clock correction (' + Math.round(clockOffset / 1000) + ' seconds).';
    }
    async function request(method, body) {
      const controller = new AbortController(), timer = win.setTimeout(() => controller.abort(), 20000);
      try {
        let response;
        try {
          response = await win.fetch(API, {method, mode: 'same-origin', credentials: 'omit', cache: 'no-store',
            redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
            headers: body ? {'Content-Type': 'application/json', 'Accept': 'application/json'} : {'Accept': 'application/json'},
            ...(body ? {body: JSON.stringify(body)} : {})});
        } catch { throw new Error(method === 'GET' ? 'AVAILABILITY_UNREACHABLE' : 'NETWORK_UNCERTAIN'); }
        captureServerTime(response);
        let data;
        try { data = await response.json(); } catch { throw new Error(method === 'GET' ? 'AVAILABILITY_BAD_RESPONSE' : 'BAD_RESPONSE'); }
        if (!response.ok || !data || data.ok !== true) {
          const code = data && (data.code || data.reason || data.error);
          throw new Error(method === 'GET' ? 'AVAILABILITY_BAD_RESPONSE'
            : typeof code === 'string' && /^[A-Z_0-9]{1,64}$/.test(code) ? code : 'BAD_RESPONSE');
        }
        return data;
      } finally { win.clearTimeout(timer); }
    }
    async function checkApi() {
      apiEnabled = false; apiCheckState = 'checking';
      el('preflightStatus').textContent = 'Checking the same-origin session API…';
      updateControls();
      try {
        const data = await request('GET');
        apiEnabled = data.enabled === true && data.network === NETWORK && Array.isArray(data.rights)
          && data.rights.length === 2 && data.rights.includes('shot') && data.rights.includes('status');
        apiCheckState = apiEnabled ? 'passed' : 'unavailable';
        el('preflightStatus').className = 'message' + (apiEnabled ? ' success' : '');
        el('preflightStatus').textContent = apiEnabled
          ? 'Available · Solana mainnet · shot + status only · existing admitted arena agent and credits required. This check did not grant any authority.'
          : 'Session creation is unavailable or its contract does not match this page. Owner controls remain available; no permission was granted.';
        return apiEnabled;
      } catch (error) {
        apiEnabled = false; apiCheckState = 'failed'; el('preflightStatus').className = 'message error';
        el('preflightStatus').textContent = 'Availability check failed. ' + safeError(error);
        return false;
      } finally { updateControls(); }
    }
    function assertOwner() {
      if (win.location.origin !== 'https://' + DOMAIN) throw new Error('WRONG_ORIGIN');
      if (!provider || !connectedWallet) throw new Error('WALLET_REQUIRED');
      if (String(provider.publicKey || '') !== connectedWallet) throw new Error('WALLET_CHANGED');
      return connectedWallet;
    }
    async function signAndPost(op, payload) {
      const owner = assertOwner(), signingProvider = provider;
      if (payload.wallet !== owner) throw new Error('WALLET_CHANGED');
      const serialized = JSON.stringify(payload);
      el('signedPayload').textContent = serialized;
      setMessage('Review and approve the ' + op + ' message in your wallet. No transaction will be sent.');
      const reply = await signingProvider.signMessage(encoder.encode(serialized), 'utf8');
      if (provider !== signingProvider || assertOwner() !== owner
        || (reply && reply.publicKey && String(reply.publicKey) !== owner)) throw new Error('WALLET_CHANGED');
      const signature = signatureBase64(reply, value => win.btoa(value));
      if (op === 'grant') {
        el('sessionId').value = payload.id; resetSessionDisplay(); remember();
      }
      setMessage('Waiting for the server to confirm ' + op + '. Do not close this page.');
      return request('POST', {op, payload: serialized, signature});
    }
    function showSession(session) {
      const owner = assertOwner(), id = el('sessionId').value.trim();
      if (!session || session.wallet !== owner || session.id !== id || !session.limits
        || !Number.isSafeInteger(session.attempts) || !Number.isSafeInteger(session.grossCredits)
        || !Number.isSafeInteger(session.expiresAt)
        || (session.pending !== null && !HEX32.test(session.pending || ''))) throw new Error('BAD_RESPONSE');
      lastSession = session;
      el('sessionState').textContent = session.revokedAt != null ? 'REVOKED' : session.expiresAt <= now() ? 'EXPIRED' : 'ACTIVE';
      el('attemptsUsed').textContent = session.attempts + ' / ' + session.limits.maxAttempts;
      el('creditsUsed').textContent = session.grossCredits + ' / ' + session.limits.maxGrossCredits;
      el('sessionExpiry').textContent = 'Expires ' + new Date(session.expiresAt).toLocaleString()
        + '. Reserved attempts can consume allowance without debiting credits; revocation does not cancel work already reserved.';
      // Explicit allowlist prevents a future API field from rendering a credential/hash/signature.
      const receipts = {};
      for (const [requestId, receipt] of Object.entries(session.requests || {}).slice(0, 100)) {
        if (!HEX32.test(requestId) || !receipt || typeof receipt !== 'object') continue;
        receipts[requestId] = {state: receipt.state, stake: receipt.stake, reservedAt: receipt.reservedAt,
          finishedAt: receipt.finishedAt, result: receipt.result && {state: receipt.result.state,
            shotId: receipt.result.shotId, code: receipt.result.code}};
      }
      el('sessionDetails').textContent = JSON.stringify({wallet: session.wallet, id: session.id,
        expiresAt: session.expiresAt, revokedAt: session.revokedAt, limits: {
          maxAttempts: session.limits.maxAttempts, maxStakeCredits: session.limits.maxStakeCredits,
          maxGrossCredits: session.limits.maxGrossCredits, minIntervalMs: session.limits.minIntervalMs},
        budgetRule: session.budgetRule, attempts: session.attempts, grossCredits: session.grossCredits,
        pending: session.pending, requests: receipts}, null, 2);
      el('sessionPanel').hidden = false; el('recoveryPanel').hidden = !session.pending;
      el('pendingRequest').textContent = session.pending ? 'Request ID: ' + session.pending : '';
      remember(); updateControls();
    }
    async function ownerStatus() {
      const payload = ownerPayload('owner_status', assertOwner(), el('sessionId').value.trim(), now());
      const data = await signAndPost('owner-status', payload);
      showSession(data.session);
      setMessage('Owner status checked. No shot was submitted.', 'success');
    }
    async function run(task) {
      if (busy) return;
      busy = true; updateControls();
      try { await task(); } catch (error) { setMessage(safeError(error), 'error'); }
      finally { busy = false; updateControls(); }
    }
    function dropWallet() {
      if (provider && typeof provider.removeListener === 'function') {
        if (accountHandler) provider.removeListener('accountChanged', accountHandler);
        if (disconnectHandler) provider.removeListener('disconnect', disconnectHandler);
      }
      provider = null; connectedWallet = ''; clearCredential(); resetSessionDisplay();
      el('consent').checked = false; el('walletAddress').textContent = 'No wallet connected.';
      el('signedPayload').textContent = 'No current signed payload.'; updateControls();
    }
    el('checkApi').addEventListener('click', () => run(checkApi));
    el('checkApiNearGrant').addEventListener('click', () => run(checkApi));
    el('connectWallet').addEventListener('click', () => run(async () => {
      if (win.location.origin !== 'https://' + DOMAIN) throw new Error('WRONG_ORIGIN');
      const candidate = win.phantom && win.phantom.solana || win.solana;
      if (!candidate || typeof candidate.connect !== 'function' || typeof candidate.signMessage !== 'function') throw new Error('WALLET_UNAVAILABLE');
      const result = await candidate.connect();
      const wallet = String(candidate.publicKey || result && result.publicKey || '');
      if (!WALLET.test(wallet)) throw new Error('WALLET_UNAVAILABLE');
      dropWallet(); provider = candidate; connectedWallet = wallet;
      el('walletAddress').textContent = wallet;
      if (typeof provider.on === 'function') {
        accountHandler = () => { dropWallet(); setMessage('The wallet account changed. Reconnect the intended owner and review consent again.'); };
        disconnectHandler = () => { dropWallet(); setMessage('Wallet disconnected. The credential was cleared here; an existing grant is not revoked.'); };
        provider.on('accountChanged', accountHandler); provider.on('disconnect', disconnectHandler);
      }
      setMessage('Wallet connected. Checking availability without signing or creating permission.', 'success');
      await checkApi();
    }));
    el('disconnectWallet').addEventListener('click', () => run(async () => {
      const previous = provider; dropWallet();
      if (previous && typeof previous.disconnect === 'function') { try { await previous.disconnect(); } catch {} }
      setMessage('Wallet disconnected and credential cleared from this page. This does not revoke an existing session.');
    }));
    limitIds.forEach(id => el(id).addEventListener('input', () => {
      el('consent').checked = false; summary(); updateControls();
    }));
    el('consent').addEventListener('change', updateControls);
    el('grantForm').addEventListener('submit', event => {
      event.preventDefault();
      run(async () => {
        const owner = assertOwner();
        if (!el('consent').checked) throw new Error('CONSENT_REQUIRED');
        const options = currentOptions();
        if (!await checkApi()) throw new Error('SESSION_DISABLED');
        if (assertOwner() !== owner || !el('consent').checked) throw new Error('WALLET_CHANGED');
        clearCredential();
        let credential = await createCredential(owner, win.crypto);
        try {
          const payload = grantPayload(owner, credential.id, credential.tokenHash, now(), options.durationMs, options.limits);
          const result = await signAndPost('grant', payload);
          if (result.id !== credential.id || assertOwner() !== owner) throw new Error('BAD_RESPONSE');
          visibleCredential = credential.token; el('credential').value = visibleCredential;
          el('credentialPanel').hidden = false; el('consent').checked = false;
          setMessage('Session confirmed. Save the private credential only in your own protected secret store. No shot has been placed.', 'success');
        } finally { credential = null; }
      });
    });
    el('ownerStatus').addEventListener('click', () => run(ownerStatus));
    el('revokeSession').addEventListener('click', () => run(async () => {
      const payload = ownerPayload('revoke', assertOwner(), el('sessionId').value.trim(), now());
      const result = await signAndPost('revoke', payload);
      if (result.revoked !== true) throw new Error('BAD_RESPONSE');
      clearCredential(); resetSessionDisplay();
      setMessage('Revocation confirmed. New reservations are blocked; a previously reserved attempt may still finish. Check owner status to inspect any pending work.', 'success');
    }));
    el('recoverSession').addEventListener('click', () => run(async () => {
      if (!lastSession || lastSession.wallet !== assertOwner() || lastSession.id !== el('sessionId').value.trim()
        || !HEX32.test(lastSession.pending || '')) throw new Error('INVALID_REQUEST_ID');
      const payload = ownerPayload('recover', assertOwner(), lastSession.id, now(), lastSession.pending);
      await signAndPost('recover', payload);
      resetSessionDisplay();
      setMessage('Recovery request confirmed. No shot was retried and no allowance was restored. Sign & check status to inspect the resulting receipt.', 'success');
    }));
    el('sessionId').addEventListener('input', () => { resetSessionDisplay(); updateControls(); });
    el('sessionId').addEventListener('change', remember);
    el('rememberSession').addEventListener('change', remember);
    el('forgetSession').addEventListener('click', () => {
      el('rememberSession').checked = false; remember(); el('sessionId').value = '';
      resetSessionDisplay(); updateControls(); setMessage('Local session ID forgotten. No server permission was changed.');
    });
    el('clearCredential').addEventListener('click', () => {
      clearCredential(); setMessage('Credential cleared from this page. Existing clipboard contents and server permission are unchanged. Use revoke to end future play authority.');
    });
    el('toggleCredential').addEventListener('click', () => {
      if (!visibleCredential) return;
      const show = el('credential').type === 'password'; el('credential').type = show ? 'text' : 'password';
      el('toggleCredential').textContent = show ? 'HIDE' : 'SHOW';
      el('toggleCredential').setAttribute('aria-pressed', String(show));
    });
    el('copyCredential').addEventListener('click', async () => {
      if (!visibleCredential) return;
      try {
        await win.navigator.clipboard.writeText(visibleCredential);
        setMessage('Private credential copied to this device’s clipboard. Paste only into your protected per-user secret store, never chat. Clear clipboard history afterward.', 'success');
      } catch { setMessage('Clipboard access failed. Use the owner-visible field to copy privately. Never paste the credential into chat.', 'error'); }
    });
    win.addEventListener('pagehide', () => { clearCredential(); el('consent').checked = false; });
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) { el('credential').type = 'password'; el('toggleCredential').textContent = 'SHOW'; el('toggleCredential').setAttribute('aria-pressed', 'false'); }
    });
    try {
      const saved = JSON.parse(win.localStorage.getItem(METADATA_KEY) || 'null');
      if (saved && WALLET.test(saved.wallet) && HEX32.test(saved.id)) {
        el('sessionId').value = saved.id; el('rememberSession').checked = true; rememberedOwner = saved.wallet;
        el('rememberedWallet').hidden = false; el('rememberedWallet').textContent = 'Saved session owner: ' + saved.wallet + '. Connect this exact wallet to manage the saved session.';
      }
    } catch {}
    clearCredential(); summary(); updateControls();
    if (win.location.origin !== 'https://' + DOMAIN) {
      setMessage('Preview only: wallet connection and signatures are enabled only on https://ratchetx.xyz. The unsigned availability check can still be tested.');
    }
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = {readLimits, grantPayload, ownerPayload, createCredential, signatureBase64, safeError, mount};
  } else if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    mount(window, document);
  }
}());
