(function () {
  'use strict';
  const API = 'https://ratchetx.xyz/api/game';
  const RPCS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
  const core = globalThis.RatchetX402Smoke;
  const web3 = globalThis.solanaWeb3;
  const runButton = document.getElementById('run');
  const status = document.getElementById('status');
  const logBox = document.getElementById('log');
  let rpcIndex = 0, rpcId = 0;

  const clean = value => String(value == null ? '' : value).replace(/[\r\n]+/g, ' ');
  function log(message, kind = '') {
    if (logBox.textContent === 'No wallet action has been requested.') logBox.textContent = '';
    const line = document.createElement('div');
    line.className = kind;
    line.textContent = clean(message);
    logBox.appendChild(line);
  }
  function stage(message) { status.textContent = message; log(`\n${message}`); }

  async function rpc(method, params, timeoutMs = 12000) {
    let last;
    for (let offset = 0; offset < RPCS.length; offset++) {
      const index = (rpcIndex + offset) % RPCS.length;
      try {
        const response = await fetch(RPCS[index], {
          method:'POST', headers:{ 'content-type':'application/json' },
          body:JSON.stringify({ jsonrpc:'2.0', id:++rpcId, method, params }),
          signal:AbortSignal.timeout(timeoutMs),
        });
        const json = await response.json();
        if (!response.ok || json.error) throw new Error(json.error && json.error.message || `RPC HTTP ${response.status}`);
        rpcIndex = index;
        return json.result;
      } catch (error) { last = error; }
    }
    throw new Error(`all public RPC endpoints failed: ${last && last.message}`);
  }

  function provider() {
    const found = globalThis.phantom && globalThis.phantom.solana
      || globalThis.solflare
      || globalThis.solana;
    if (!found || typeof found.connect !== 'function' || typeof found.signMessage !== 'function'
        || typeof found.signTransaction !== 'function') {
      throw new Error('Phantom or Solflare browser wallet was not found');
    }
    return found;
  }

  function signatureBytes(result) {
    return result && result.signature ? new Uint8Array(result.signature) : new Uint8Array(result);
  }

  async function signedAuth(walletProvider, wallet) {
    const ts = Date.now();
    const message = new TextEncoder().encode(`RATCHET | ${wallet} | ${ts}`);
    const signed = await walletProvider.signMessage(message, 'utf8');
    return { wallet, ts, sig:core.bytesToBase64(signatureBytes(signed)) };
  }

  function agentName(wallet) {
    return `SMOKE-${wallet.slice(-4)}-${Date.now().toString(36).slice(-6)}`.toUpperCase();
  }

  async function postRegistration(body, paymentHeader) {
    const response = await fetch(API, {
      method:'POST',
      headers:{ 'content-type':'application/json', ...(paymentHeader ? { 'PAYMENT-SIGNATURE':paymentHeader } : {}) },
      body:JSON.stringify(body), signal:AbortSignal.timeout(20000),
    });
    let json;
    try { json = await response.json(); } catch { json = { ok:false, reason:'non-JSON response' }; }
    return { response, json };
  }

  function tokenAccounts(result) {
    return (result && result.value || []).map(row => ({
      address:row.pubkey,
      owner:row.account.data.parsed.info.owner,
      mint:row.account.data.parsed.info.mint,
      amount:BigInt(row.account.data.parsed.info.tokenAmount.amount),
      decimals:Number(row.account.data.parsed.info.tokenAmount.decimals),
    }));
  }

  async function waitForTransaction(signature) {
    const deadline = Date.now() + 65000;
    while (Date.now() < deadline) {
      const result = await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory:true }]);
      const value = result && result.value && result.value[0];
      if (value && value.err) throw new Error(`settlement transaction failed: ${JSON.stringify(value.err)}`);
      if (value && (value.confirmationStatus === 'confirmed' || value.confirmationStatus === 'finalized')) return value;
      await new Promise(resolve => setTimeout(resolve, 1800));
    }
    throw new Error('settlement signature was not confirmed within 65 seconds');
  }

  async function saveSafeReport(report) {
    await fetch('/report', {
      method:'POST', headers:{ 'content-type':'application/json' },
      body:JSON.stringify(report), signal:AbortSignal.timeout(3000),
    }).catch(() => null);
  }

  async function run() {
    runButton.disabled = true;
    logBox.textContent = '';
    status.textContent = 'running';
    let publicReport = { startedAt:new Date().toISOString(), ok:false };
    try {
      stage('1/8 connecting browser wallet');
      const walletProvider = provider();
      const connected = await walletProvider.connect();
      const wallet = (connected.publicKey || walletProvider.publicKey).toString();
      log(`wallet ${wallet}`);

      stage('2/8 signing Ratchet authentication (no transaction)');
      const auth = await signedAuth(walletProvider, wallet);
      const name = agentName(wallet);
      const body = { action:'agent-register', auth, name, blurb:'funded x402 v2 mainnet smoke' };
      publicReport = { ...publicReport, wallet, name };

      stage('3/8 requesting and validating live quote');
      const first = await postRegistration(body);
      if (first.response.status === 200) throw new Error('this wallet is already admitted; choose a USDC-funded wallet that has never touched RCX');
      if (first.response.status !== 402) throw new Error(`expected HTTP 402, got ${first.response.status}: ${first.json.reason || first.json.error || 'unknown error'}`);
      const fromHeader = core.decodeHeader(first.response.headers.get('payment-required'));
      if (JSON.stringify(fromHeader) !== JSON.stringify(first.json)) throw new Error('PAYMENT-REQUIRED header differs from response body');
      const quote = core.validatePaymentRequired(fromHeader);
      new web3.PublicKey(quote.payTo); new web3.PublicKey(quote.feePayer);
      log(`quote ${quote.quoteId}`);
      log(`0.01 USDC -> champion ${quote.payTo}`);
      publicReport.quote = { id:quote.quoteId, amountAtomic:quote.amountAtomic, asset:quote.accepted.asset,
        network:quote.accepted.network, payTo:quote.payTo, feePayer:quote.feePayer, memo:quote.memo };

      stage('4/8 proving mint, source funds and champion token account on chain');
      const supply = await rpc('getTokenSupply', [core.USDC_MINT, { commitment:'confirmed' }]);
      if (!supply || Number(supply.value.decimals) !== 6) throw new Error('USDC mint decimals are not 6');
      const ownerAccounts = tokenAccounts(await rpc('getTokenAccountsByOwner', [wallet,
        { mint:core.USDC_MINT }, { encoding:'jsonParsed', commitment:'confirmed' }]));
      const source = ownerAccounts.filter(a => a.decimals === 6 && a.amount >= BigInt(quote.amountAtomic))
        .sort((a, b) => a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1)[0];
      if (!source) throw new Error('wallet has no USDC token account with at least 0.01 USDC');
      const destinationAta = core.deriveAta(web3, quote.payTo).toString();
      const recipientAccounts = tokenAccounts(await rpc('getTokenAccountsByOwner', [quote.payTo,
        { mint:core.USDC_MINT }, { encoding:'jsonParsed', commitment:'confirmed' }]));
      const destination = recipientAccounts.find(a => a.address === destinationAta && a.owner === quote.payTo && a.decimals === 6);
      if (!destination) throw new Error(`champion has no canonical USDC ATA (${destinationAta}); stopped before payment signature`);
      log(`source ${source.address} (${Number(source.amount) / 1e6} USDC)`);
      log(`destination ATA ${destination.address}`, 'ok');

      stage('5/8 building bounded transaction; wallet will show the only payment prompt');
      const latest = await rpc('getLatestBlockhash', [{ commitment:'confirmed' }]);
      const unsigned = core.buildPaymentTransaction(web3, quote, {
        wallet, sourceTokenAccount:source.address, destinationTokenAccount:destination.address,
        blockhash:latest.value.blockhash,
      });
      const signedByWallet = await walletProvider.signTransaction(unsigned);
      const signedBytes = signedByWallet.serialize();
      core.validateSignedPaymentTransaction(web3, signedBytes, {
        wallet, feePayer:quote.feePayer, sourceTokenAccount:source.address,
        destinationTokenAccount:destination.address, amountAtomic:quote.amountAtomic, memo:quote.memo,
      });
      log('wallet-signed transaction passed instruction, signer, amount and recipient checks', 'ok');

      stage('6/8 asking Ratchet facilitator to verify and settle');
      const payload = { x402Version:2, resource:quote.resource, accepted:quote.accepted,
        payload:{ transaction:core.bytesToBase64(signedBytes) } };
      const paymentHeader = core.encodePaymentPayload(payload);
      const paid = await postRegistration(body, paymentHeader);
      if (paid.response.status !== 200 || paid.json.ok !== true) {
        throw new Error(`paid request failed HTTP ${paid.response.status}: ${paid.json.error || paid.json.reason || 'unknown error'}`);
      }
      if (paid.json.entry !== 'x402-toll-to-champion' || paid.json.qualified !== false
          || paid.json.admitted !== true || paid.json.x402 && paid.json.x402.paidTo !== quote.payTo) {
        throw new Error('registration response does not prove x402 admission to the quoted champion');
      }
      const receipt = core.decodeHeader(paid.response.headers.get('payment-response'));
      if (!receipt.success || receipt.network !== core.SOLANA_MAINNET || receipt.transaction !== paid.json.x402.sig) {
        throw new Error('PAYMENT-RESPONSE does not match registration settlement');
      }
      const signature = receipt.transaction;
      log(`settlement ${signature}`, 'ok');

      stage('7/8 confirming exact outcome on Solana mainnet');
      await waitForTransaction(signature);
      const chainTx = await rpc('getTransaction', [signature, {
        encoding:'jsonParsed', commitment:'confirmed', maxSupportedTransactionVersion:0,
      }], 18000);
      const outcome = core.validateChainTransaction(chainTx, {
        wallet, payTo:quote.payTo, sourceTokenAccount:source.address,
        destinationTokenAccount:destination.address, amountAtomic:quote.amountAtomic, memo:quote.memo,
      });
      log(`payer delta ${outcome.payerDelta}; champion delta +${outcome.recipientDelta} atomic USDC`, 'ok');

      stage('8/8 replaying the same paid request (must not settle twice)');
      const replay = await postRegistration(body, paymentHeader);
      if (replay.response.status !== 200 || replay.json.ok !== true
          || replay.json.x402 && replay.json.x402.sig !== signature) {
        throw new Error('idempotent replay did not return the original admission receipt');
      }
      const replayHeader = replay.response.headers.get('payment-response');
      if (replayHeader) {
        const replayReceipt = core.decodeHeader(replayHeader);
        if (replayReceipt.transaction !== signature) throw new Error('replay returned a different settlement signature');
      } else {
        log('persisted-player replay returned the same body receipt without re-entering the payment gate', 'ok');
      }
      publicReport = { ...publicReport, ok:true, finishedAt:new Date().toISOString(),
        settlement:signature, outcome, replay:replayHeader ? 'same-settlement-header' : 'same-body-receipt-no-payment-gate', registration:{
          admitted:paid.json.admitted, qualified:paid.json.qualified, entry:paid.json.entry,
        } };
      await saveSafeReport(publicReport);
      status.textContent = 'PASS';
      log('\nFUNDED MAINNET SMOKE PASS', 'ok');
      const a = document.createElement('a');
      a.href = `https://solscan.io/tx/${signature}`; a.target = '_blank'; a.rel = 'noreferrer';
      a.textContent = 'Open settlement on Solscan'; logBox.appendChild(a);
    } catch (error) {
      publicReport = { ...publicReport, ok:false, finishedAt:new Date().toISOString(), error:clean(error && error.message || error) };
      await saveSafeReport(publicReport);
      status.textContent = 'FAIL';
      log(`\nSTOPPED: ${publicReport.error}`, 'bad');
      console.error(error);
    } finally { runButton.disabled = false; }
  }

  runButton.addEventListener('click', run);
})();
