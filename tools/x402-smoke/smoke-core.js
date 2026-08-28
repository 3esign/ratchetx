(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RatchetX402Smoke = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
  const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
  const LIGHTHOUSE_PROGRAM = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
  const SMOKE_AMOUNT_ATOMIC = '10000';
  const EXPECTED_ORIGIN = 'https://ratchetx.xyz';

  function invariant(condition, message) {
    if (!condition) throw new Error(message);
  }

  function asPublicKey(web3, value, label) {
    try { return new web3.PublicKey(String(value)); }
    catch { throw new Error(`${label} is not a valid Solana public key`); }
  }

  function allZero(bytes) {
    return !!bytes && bytes.every(byte => byte === 0);
  }

  function readU32LE(data, offset) {
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
  }

  function readU64LE(data, offset) {
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
  }

  function writeU64LE(data, offset, value) {
    new DataView(data.buffer, data.byteOffset, data.byteLength).setBigUint64(offset, BigInt(value), true);
  }

  function validatePaymentRequired(required, options = {}) {
    const expectedAmount = String(options.expectedAmount || SMOKE_AMOUNT_ATOMIC);
    const expectedOrigin = String(options.expectedOrigin || EXPECTED_ORIGIN);
    const expectedPath = String(options.expectedPath || '/api/game');
    const expectedAction = options.expectedAction === undefined ? 'agent-register' : options.expectedAction;
    invariant(required && required.x402Version === 2, 'server did not issue x402 v2');
    invariant(required.resource && typeof required.resource === 'object', 'quote has no canonical resource');
    invariant(Array.isArray(required.accepts) && required.accepts.length === 1,
      'smoke requires exactly one payment option');
    const accepted = required.accepts[0];
    invariant(accepted.scheme === 'exact', 'quote is not the exact payment scheme');
    invariant(accepted.network === SOLANA_MAINNET, 'quote is not Solana mainnet');
    invariant(accepted.asset === USDC_MINT, 'quote asset is not mainnet USDC');
    invariant(String(accepted.amount) === expectedAmount,
      `quote amount is ${accepted.amount}; expected ${expectedAmount} atomic USDC`);
    invariant(String(accepted.maxTimeoutSeconds) === '600', 'quote lifetime is not the audited 600 seconds');
    invariant(typeof accepted.payTo === 'string' && accepted.payTo.length > 0, 'quote has no recipient');
    invariant(accepted.extra && typeof accepted.extra.feePayer === 'string', 'quote has no facilitator fee payer');
    invariant(accepted.payTo !== accepted.extra.feePayer, 'recipient and facilitator fee payer must differ');
    invariant(/^ratchetx:[a-f0-9]{32}$/.test(String(accepted.extra.memo || '')),
      'quote memo is missing or malformed');

    let resourceUrl;
    try { resourceUrl = new URL(required.resource.url); }
    catch { throw new Error('quote resource URL is invalid'); }
    const expected = new URL(expectedOrigin);
    invariant(resourceUrl.origin === expected.origin, 'quote resource points away from Ratchet');
    invariant(resourceUrl.pathname === expectedPath, `quote resource path is not ${expectedPath}`);
    if (expectedAction !== null)
      invariant(resourceUrl.searchParams.get('action') === expectedAction,
        `quote resource action is not ${expectedAction}`);
    if (options.requireQueryless)
      invariant(resourceUrl.search === '', 'canonical resource URL must not contain a query');
    const memoMatch = /^ratchetx:([a-f0-9]{32})$/.exec(String(accepted.extra.memo || ''));
    const quoteId = resourceUrl.searchParams.get('x402Quote') || memoMatch && memoMatch[1];
    invariant(/^[a-f0-9]{32}$/.test(String(quoteId || '')), 'quote resource has no valid quote id');
    invariant(accepted.extra.memo === `ratchetx:${quoteId}`, 'quote memo is not bound to its resource id');
    invariant(required.resource.mimeType === 'application/json', 'quote resource MIME type changed');

    return {
      required,
      resource: required.resource,
      accepted,
      quoteId,
      amountAtomic: String(accepted.amount),
      payTo: accepted.payTo,
      feePayer: accepted.extra.feePayer,
      memo: accepted.extra.memo,
    };
  }

  function validateAgentEntryPaymentRequired(required, options = {}) {
    const quote = validatePaymentRequired(required, {
      ...options, expectedPath:'/api/agent-entry', expectedAction:null, requireQueryless:true,
    });
    const bazaar = required && required.extensions && required.extensions.bazaar;
    invariant(bazaar && bazaar.routeTemplate === '/api/agent-entry',
      'quote has no canonical Bazaar route template');
    const input = bazaar.info && bazaar.info.input;
    invariant(input && input.type === 'http' && input.method === 'POST'
      && input.bodyType === 'json' && input.body && typeof input.body === 'object',
      'quote has no executable Bazaar POST input declaration');
    invariant(bazaar.schema && bazaar.schema.$schema === 'https://json-schema.org/draft/2020-12/schema',
      'quote has no Bazaar Draft 2020-12 schema');
    return quote;
  }

  function deriveAta(web3, owner, mint = USDC_MINT) {
    const ownerKey = asPublicKey(web3, owner, 'owner');
    const mintKey = asPublicKey(web3, mint, 'mint');
    const tokenProgram = asPublicKey(web3, TOKEN_PROGRAM, 'token program');
    return web3.PublicKey.findProgramAddressSync([
      ownerKey.toBuffer(), tokenProgram.toBuffer(), mintKey.toBuffer(),
    ], asPublicKey(web3, ASSOCIATED_TOKEN_PROGRAM, 'associated token program'))[0];
  }

  function transferCheckedInstruction(web3, { source, destination, owner, amountAtomic, decimals = 6 }) {
    const data = new Uint8Array(10);
    data[0] = 12;
    writeU64LE(data, 1, amountAtomic);
    data[9] = decimals;
    return new web3.TransactionInstruction({
      programId: asPublicKey(web3, TOKEN_PROGRAM, 'token program'),
      keys: [
        { pubkey: asPublicKey(web3, source, 'source token account'), isSigner: false, isWritable: true },
        { pubkey: asPublicKey(web3, USDC_MINT, 'USDC mint'), isSigner: false, isWritable: false },
        { pubkey: asPublicKey(web3, destination, 'destination token account'), isSigner: false, isWritable: true },
        { pubkey: asPublicKey(web3, owner, 'payment wallet'), isSigner: true, isWritable: false },
      ],
      data,
    });
  }

  function buildPaymentTransaction(web3, quote, { wallet, sourceTokenAccount, destinationTokenAccount, blockhash }) {
    const q = quote.accepted ? quote : validatePaymentRequired(quote);
    const instructions = [
      web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 20000 }),
      web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
      transferCheckedInstruction(web3, {
        source: sourceTokenAccount,
        destination: destinationTokenAccount,
        owner: wallet,
        amountAtomic: q.amountAtomic,
      }),
      new web3.TransactionInstruction({
        programId: asPublicKey(web3, MEMO_PROGRAM, 'memo program'),
        keys: [],
        data: new TextEncoder().encode(q.memo),
      }),
    ];
    const message = new web3.TransactionMessage({
      payerKey: asPublicKey(web3, q.feePayer, 'facilitator fee payer'),
      recentBlockhash: String(blockhash),
      instructions,
    }).compileToV0Message();
    return new web3.VersionedTransaction(message);
  }

  function validateSignedPaymentTransaction(web3, transaction, expected) {
    const tx = transaction instanceof web3.VersionedTransaction
      ? transaction
      : web3.VersionedTransaction.deserialize(transaction);
    const message = tx.message;
    invariant(message.version === 0, 'wallet returned a non-v0 transaction');
    invariant((message.addressTableLookups || []).length === 0, 'address lookup tables are not allowed in this smoke');
    const staticKeys = message.staticAccountKeys.map(key => key.toString());
    invariant(staticKeys[0] === expected.feePayer, 'facilitator is not the transaction fee payer');

    const signerCount = message.header.numRequiredSignatures;
    const signers = staticKeys.slice(0, signerCount);
    invariant(signerCount === 2 && signers.includes(expected.feePayer) && signers.includes(expected.wallet),
      'transaction signer set is not exactly facilitator plus payment wallet');
    const feeIndex = signers.indexOf(expected.feePayer);
    const walletIndex = signers.indexOf(expected.wallet);
    invariant(allZero(tx.signatures[feeIndex]), 'wallet unexpectedly signed for the facilitator');
    invariant(!allZero(tx.signatures[walletIndex]), 'wallet payment signature is missing');

    const decompiled = web3.TransactionMessage.decompile(message);
    let limits = 0, prices = 0, transfers = 0, memos = 0, lighthouse = 0;
    for (const ix of decompiled.instructions) {
      const program = ix.programId.toString();
      invariant(!ix.keys.some(key => key.pubkey.toString() === expected.feePayer),
        'facilitator fee payer appears inside an instruction');
      const data = new Uint8Array(ix.data);
      if (program === COMPUTE_BUDGET_PROGRAM) {
        if (data[0] === 2 && data.length === 5) {
          limits++;
          invariant(readU32LE(data, 1) <= 400000, 'compute unit limit exceeds x402 safety cap');
        } else if (data[0] === 3 && data.length === 9) {
          prices++;
          invariant(readU64LE(data, 1) <= 5000000n, 'compute unit price exceeds x402 safety cap');
        } else throw new Error('unknown compute-budget instruction');
        continue;
      }
      if (program === TOKEN_PROGRAM) {
        transfers++;
        invariant(data.length === 10 && data[0] === 12, 'token instruction is not TransferChecked');
        invariant(ix.keys.length === 4, 'TransferChecked account set changed');
        invariant(ix.keys[0].pubkey.toString() === expected.sourceTokenAccount, 'payment source account changed');
        invariant(ix.keys[1].pubkey.toString() === USDC_MINT, 'payment mint changed');
        invariant(ix.keys[2].pubkey.toString() === expected.destinationTokenAccount, 'payment destination changed');
        invariant(ix.keys[3].pubkey.toString() === expected.wallet && ix.keys[3].isSigner,
          'payment authority changed');
        invariant(readU64LE(data, 1) === BigInt(expected.amountAtomic), 'payment amount changed');
        invariant(data[9] === 6, 'USDC decimals changed');
        continue;
      }
      if (program === MEMO_PROGRAM) {
        memos++;
        invariant(new TextDecoder().decode(data) === expected.memo, 'payment memo changed');
        invariant(ix.keys.length === 0, 'memo unexpectedly references accounts');
        continue;
      }
      if (program === LIGHTHOUSE_PROGRAM) {
        lighthouse++;
        invariant(lighthouse <= 3, 'wallet injected too many Lighthouse instructions');
        continue;
      }
      throw new Error(`wallet injected unsupported program ${program}`);
    }
    invariant(limits === 1 && prices === 1, 'transaction must contain one compute limit and one compute price');
    invariant(transfers === 1, 'transaction must contain exactly one USDC transfer');
    invariant(memos === 1, 'transaction must contain exactly one Ratchet memo');
    return { transaction: tx, signerCount, lighthouseInstructions: lighthouse };
  }

  function validateChainTransaction(result, expected) {
    invariant(result && result.meta && result.meta.err == null, 'settled transaction failed on chain');
    const instructions = result.transaction && result.transaction.message && result.transaction.message.instructions || [];
    const transfers = instructions.filter(ix => ix && ix.program === 'spl-token'
      && ix.parsed && ix.parsed.type === 'transferChecked');
    invariant(transfers.length === 1, 'on-chain transaction does not contain exactly one parsed TransferChecked');
    const info = transfers[0].parsed.info || {};
    invariant(info.source === expected.sourceTokenAccount, 'on-chain payment source differs');
    invariant(info.mint === USDC_MINT, 'on-chain mint differs');
    invariant(info.destination === expected.destinationTokenAccount, 'on-chain destination differs');
    invariant(info.authority === expected.wallet, 'on-chain payment authority differs');
    invariant(String(info.tokenAmount && info.tokenAmount.amount) === String(expected.amountAtomic),
      'on-chain payment amount differs');
    invariant(Number(info.tokenAmount && info.tokenAmount.decimals) === 6, 'on-chain token decimals differ');

    const memos = instructions.filter(ix => ix && ix.program === 'spl-memo');
    invariant(memos.length === 1 && memos[0].parsed === expected.memo, 'on-chain memo differs');

    const sumOwner = (balances, owner) => (balances || [])
      .filter(b => b.mint === USDC_MINT && b.owner === owner)
      .reduce((sum, b) => sum + BigInt(b.uiTokenAmount.amount), 0n);
    const payerDelta = sumOwner(result.meta.postTokenBalances, expected.wallet)
      - sumOwner(result.meta.preTokenBalances, expected.wallet);
    const recipientDelta = sumOwner(result.meta.postTokenBalances, expected.payTo)
      - sumOwner(result.meta.preTokenBalances, expected.payTo);
    invariant(payerDelta <= -BigInt(expected.amountAtomic), 'payer USDC balance did not decrease by the quote');
    invariant(recipientDelta >= BigInt(expected.amountAtomic), 'champion USDC balance did not increase by the quote');
    return { payerDelta: payerDelta.toString(), recipientDelta: recipientDelta.toString() };
  }

  function utf8ToBase64(value) {
    const bytes = new TextEncoder().encode(String(value));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function base64ToUtf8(value) {
    const binary = atob(String(value));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const data = new Uint8Array(bytes);
    for (let i = 0; i < data.length; i += 0x8000) {
      binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  function decodeHeader(value) {
    invariant(value, 'required x402 response header is missing');
    return JSON.parse(base64ToUtf8(value));
  }

  function encodePaymentPayload(value) {
    return utf8ToBase64(JSON.stringify(value));
  }

  return {
    USDC_MINT, SOLANA_MAINNET, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM,
    MEMO_PROGRAM, COMPUTE_BUDGET_PROGRAM, LIGHTHOUSE_PROGRAM,
    SMOKE_AMOUNT_ATOMIC, EXPECTED_ORIGIN,
    validatePaymentRequired, validateAgentEntryPaymentRequired, deriveAta, transferCheckedInstruction,
    buildPaymentTransaction, validateSignedPaymentTransaction,
    validateChainTransaction, decodeHeader, encodePaymentPayload, bytesToBase64,
  };
});
