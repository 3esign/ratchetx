(function () {
  'use strict';

  const API = '/api/game?action=claim_migration';
  let connectedWallet = null;
  let busy = false;

  function el(id) { return document.getElementById(id); }
  function safeError(error) {
    if (error && typeof error.message === 'string') return error.message;
    return String(error || 'Unknown error');
  }

  function setMessage(text, isError = false) {
    const elStatus = el('claimStatus');
    if (!text) {
      elStatus.hidden = true;
      return;
    }
    elStatus.textContent = text;
    elStatus.className = 'message ' + (isError ? 'error' : 'success');
    elStatus.hidden = false;
  }

  function updateControls() {
    el('connectWallet').hidden = !!connectedWallet;
    el('disconnectWallet').hidden = !connectedWallet;
    el('claimBtn').disabled = busy || !connectedWallet;
    el('connectWallet').disabled = busy;
    el('disconnectWallet').disabled = busy;
    
    el('walletAddress').textContent = connectedWallet 
      ? 'Connected: ' + connectedWallet 
      : 'No wallet connected.';
  }

  async function connect() {
    if (busy) return;
    busy = true;
    updateControls();
    setMessage('');
    try {
      const sol = window.phantom && window.phantom.solana || window.solana;
      if (!sol || !sol.isPhantom) throw new Error('Phantom wallet required. Please install Phantom.');
      const resp = await sol.connect();
      connectedWallet = resp.publicKey.toString();
    } catch (err) {
      setMessage(safeError(err), true);
    } finally {
      busy = false;
      updateControls();
    }
  }

  function disconnect() {
    if (busy) return;
    const sol = window.phantom && window.phantom.solana || window.solana;
    if (sol && sol.disconnect) sol.disconnect();
    connectedWallet = null;
    updateControls();
    setMessage('');
  }

  async function claim() {
    if (busy || !connectedWallet) return;
    busy = true;
    updateControls();
    setMessage('Preparing transaction...', false);
    try {
      const req = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim_migration', wallet: connectedWallet })
      });
      const data = await req.json();
      if (!req.ok || !data.ok) throw new Error(data.reason || data.code || 'Failed to build transaction');
      
      setMessage('Please sign the transaction in your wallet...', false);
      
      const sol = window.phantom && window.phantom.solana || window.solana;
      
      // Decode Base64 to Uint8Array
      const binaryString = window.atob(data.tx);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Note: Phantom uses sol.signTransaction(tx) which expects a specific object format or Uint8Array for v0?
      // Since it's a versioned transaction, we can just send it using signAndSendTransaction.
      
      // Actually, standard Phantom window.solana handles signAndSendTransaction with base64/Uint8Array or requires deserialization.
      // But we can just use sendAndConfirm via window.solana.request
      let res;
      try {
         res = await sol.request({
            method: 'signAndSendTransaction',
            params: { message: window.btoa(String.fromCharCode.apply(null, bytes)) }
         });
      } catch (e) {
         // Fallback if that method fails
         throw new Error(safeError(e) + ' - Transaction cancelled or failed.');
      }
      
      setMessage('Transaction sent successfully! Signature: ' + res.signature, false);
    } catch (err) {
      setMessage(safeError(err), true);
    } finally {
      busy = false;
      updateControls();
    }
  }

  el('connectWallet').addEventListener('click', connect);
  el('disconnectWallet').addEventListener('click', disconnect);
  el('claimBtn').addEventListener('click', claim);
  
  const sol = window.phantom && window.phantom.solana || window.solana;
  if (sol) {
    sol.on('connect', () => {
      connectedWallet = sol.publicKey.toString();
      updateControls();
    });
    sol.on('disconnect', () => {
      connectedWallet = null;
      updateControls();
    });
  }
})();
