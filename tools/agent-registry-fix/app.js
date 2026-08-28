(function () {
  'use strict';
  const OWNER = 'HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM';
  const ASSET = 'Auj5yXbsaeQUJpYpSRugkgRE3ABc76uqmUe3Vz7fxqCu';
  const REGISTRY = '8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ';
  const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
  const TARGET_URI = 'https://ratchetx.xyz/agent-registration.json';
  const web3 = globalThis.solanaWeb3;
  const run = document.getElementById('run');
  const status = document.getElementById('status');
  const logBox = document.getElementById('log');
  let rpcId = 0;

  function log(message, kind = '') {
    if (logBox.textContent === 'No wallet action has been requested.') logBox.textContent = '';
    const line = document.createElement('div'); line.className = kind;
    line.textContent = String(message).replace(/[\r\n]+/g, ' '); logBox.appendChild(line);
  }
  function stage(message) { status.textContent = message; log(`\n${message}`); }
  function provider() {
    const found = globalThis.phantom?.solana || globalThis.solflare || globalThis.solana;
    if (!found || typeof found.connect !== 'function' || typeof found.signTransaction !== 'function') {
      throw new Error('Phantom or Solflare browser wallet was not found');
    }
    return found;
  }
  async function rpc(method, params) {
    const response = await fetch('/rpc', { method:'POST', headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ jsonrpc:'2.0', id:++rpcId, method, params }) });
    const json = await response.json();
    if (!response.ok || json.error) throw new Error(json.error?.message || `RPC HTTP ${response.status}`);
    return json.result;
  }
  async function waitFor(signature) {
    const deadline = Date.now() + 70000;
    while (Date.now() < deadline) {
      const result = await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory:true }]);
      const value = result?.value?.[0];
      if (value?.err) throw new Error(`transaction failed: ${JSON.stringify(value.err)}`);
      if (value && ['confirmed', 'finalized'].includes(value.confirmationStatus)) return value;
      await new Promise(resolve => setTimeout(resolve, 1300));
    }
    throw new Error('confirmation timed out; inspect the signature before retrying');
  }
  function validate(tx, prepared) {
    const required = tx.signatures.map(row => row.publicKey.toBase58());
    if (prepared.signer !== OWNER || required.length !== 1 || required[0] !== OWNER) throw new Error('unexpected signer');
    if (tx.feePayer?.toBase58() !== OWNER) throw new Error('unexpected fee payer');
    const registryInstructions = tx.instructions.filter(ix => ix.programId.toBase58() === REGISTRY);
    const extras = tx.instructions.filter(ix => ix.programId.toBase58() !== REGISTRY);
    if (registryInstructions.length !== 1) throw new Error('expected exactly one registry instruction');
    if (extras.some(ix => ix.programId.toBase58() !== COMPUTE_BUDGET || ix.keys.length !== 0)) {
      throw new Error('unexpected non-compute instruction');
    }
    const ix = registryInstructions[0];
    const keys = ix.keys.map(row => row.pubkey.toBase58());
    if (!keys.includes(OWNER) || !keys.includes(ASSET)) throw new Error('owner or asset missing');
  }

  run.addEventListener('click', async () => {
    run.disabled = true; status.textContent = 'starting'; logBox.textContent = '';
    try {
      const walletProvider = provider();
      stage('1/5 connecting the owner wallet');
      const connected = await walletProvider.connect();
      const wallet = (connected.publicKey || walletProvider.publicKey).toBase58();
      log(`wallet ${wallet}`);
      if (wallet !== OWNER) throw new Error(`wrong wallet; expected ${OWNER}`);

      stage('2/5 proving current owner and building one fixed URI update');
      const response = await fetch('/prepare', { method:'POST', headers:{ 'content-type':'application/json' },
        body:JSON.stringify({ wallet }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `prepare HTTP ${response.status}`);
      if (data.owner !== OWNER || data.asset !== ASSET || data.registry !== REGISTRY || data.targetUri !== TARGET_URI) {
        throw new Error('prepared facts do not match the fixed correction');
      }
      log(`current URI ${data.currentUri}`);
      log(`target URI  ${data.targetUri}`, 'ok');

      stage('3/5 validating program, signer, fee payer, asset and instruction count');
      const tx = web3.Transaction.from(Uint8Array.from(atob(data.prepared.transaction), c => c.charCodeAt(0)));
      validate(tx, data.prepared);
      log('bounded transaction passed local checks', 'ok');

      stage('4/5 Phantom will now show the only signature prompt');
      const signed = await walletProvider.signTransaction(tx);
      validate(signed, data.prepared);
      const raw = signed.serialize();
      const base64 = btoa(String.fromCharCode(...raw));
      const signature = await rpc('sendTransaction', [base64]);
      log(`sent ${signature}`, 'ok');
      await waitFor(signature);

      stage('5/5 confirmed on Solana mainnet');
      status.textContent = 'PASS';
      log('URI CORRECTION PASS — the existing agent now points to RatchetX metadata', 'ok');
      const link = document.createElement('a');
      link.href = `https://solscan.io/tx/${signature}`; link.target = '_blank'; link.rel = 'noreferrer';
      link.textContent = 'Open correction on Solscan'; logBox.appendChild(link);
    } catch (error) {
      status.textContent = 'FAIL'; log(`STOPPED: ${error.message || error}`, 'bad');
    } finally { run.disabled = false; }
  });
})();
