import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const web3 = require('@solana/web3.js');
const core = require('../tools/x402-smoke/smoke-core.js');

let pass = 0;
const ok = (fn, label) => { fn(); pass++; console.log('PASS  ' + label); };
const rejects = (fn, pattern, label) => ok(() => assert.throws(fn, pattern), label);
const key = () => web3.Keypair.generate().publicKey.toString();
const walletSigner = web3.Keypair.generate();
const wallet = walletSigner.publicKey.toString();
const feePayer = key(), payTo = key(), source = key(), destination = key();
const id = '0123456789abcdef0123456789abcdef';
const required = {
  x402Version:2,
  resource:{ url:`https://ratchetx.xyz/api/game?action=agent-register&x402Quote=${id}`,
    description:'fixture', mimeType:'application/json' },
  accepts:[{ scheme:'exact', network:core.SOLANA_MAINNET, amount:core.SMOKE_AMOUNT_ATOMIC,
    asset:core.USDC_MINT, payTo, maxTimeoutSeconds:600,
    extra:{ feePayer, memo:`ratchetx:${id}`, payToIs:'fixture champion' } }],
};

const quote = core.validatePaymentRequired(required);
ok(() => assert.equal(quote.quoteId, id), 'accepts the exact Ratchet x402 v2 smoke quote');

for (const [mutate, pattern, label] of [
  [q => { q.accepts[0].amount = '1000000'; }, /quote amount/, 'rejects an amount above the 0.01 USDC smoke cap'],
  [q => { q.accepts[0].network = 'solana:devnet'; }, /mainnet/, 'rejects a non-mainnet quote'],
  [q => { q.accepts[0].asset = key(); }, /mainnet USDC/, 'rejects a different token mint'],
  [q => { q.accepts[0].extra.memo = 'ratchetx:ffffffffffffffffffffffffffffffff'; }, /not bound/, 'rejects a memo not bound to the resource'],
  [q => { q.resource.url = `https://evil.example/api/game?action=agent-register&x402Quote=${id}`; }, /away from Ratchet/, 'rejects a resource on another origin'],
]) {
  const changed = structuredClone(required); mutate(changed);
  rejects(() => core.validatePaymentRequired(changed), pattern, label);
}

const unsigned = core.buildPaymentTransaction(web3, quote, {
  wallet, sourceTokenAccount:source, destinationTokenAccount:destination, blockhash:key(),
});
unsigned.sign([walletSigner]);
const expected = { wallet, feePayer, sourceTokenAccount:source, destinationTokenAccount:destination,
  amountAtomic:quote.amountAtomic, memo:quote.memo };
ok(() => assert.equal(core.validateSignedPaymentTransaction(web3, unsigned.serialize(), expected).signerCount, 2),
  'accepts the bounded wallet-signed v0 transaction');

function signedWith(instructions) {
  const message = new web3.TransactionMessage({ payerKey:new web3.PublicKey(feePayer),
    recentBlockhash:key(), instructions }).compileToV0Message();
  const tx = new web3.VersionedTransaction(message); tx.sign([walletSigner]); return tx;
}
const baseInstructions = web3.TransactionMessage.decompile(unsigned.message).instructions;
const transferIndex = baseInstructions.findIndex(ix => ix.programId.toString() === core.TOKEN_PROGRAM);
const memoIndex = baseInstructions.findIndex(ix => ix.programId.toString() === core.MEMO_PROGRAM);

const wrongAmount = baseInstructions.map(ix => new web3.TransactionInstruction(ix));
wrongAmount[transferIndex].data = Uint8Array.from(wrongAmount[transferIndex].data);
new DataView(wrongAmount[transferIndex].data.buffer).setBigUint64(1, 9999n, true);
rejects(() => core.validateSignedPaymentTransaction(web3, signedWith(wrongAmount).serialize(), expected),
  /payment amount changed/, 'rejects a wallet transaction with a changed amount');

const wrongDestination = baseInstructions.map(ix => new web3.TransactionInstruction(ix));
wrongDestination[transferIndex].keys = wrongDestination[transferIndex].keys.map((meta, index) =>
  index === 2 ? { ...meta, pubkey:web3.Keypair.generate().publicKey } : meta);
rejects(() => core.validateSignedPaymentTransaction(web3, signedWith(wrongDestination).serialize(), expected),
  /payment destination changed/, 'rejects a wallet transaction with a changed recipient');

const noMemo = baseInstructions.filter((_, index) => index !== memoIndex);
rejects(() => core.validateSignedPaymentTransaction(web3, signedWith(noMemo).serialize(), expected),
  /exactly one Ratchet memo/, 'rejects a transaction without the quote memo');

const unknown = [...baseInstructions, new web3.TransactionInstruction({
  programId:web3.SystemProgram.programId, keys:[], data:new Uint8Array(),
})];
rejects(() => core.validateSignedPaymentTransaction(web3, signedWith(unknown).serialize(), expected),
  /unsupported program/, 'rejects injected instructions from an unknown program');

const feeInMemo = baseInstructions.map(ix => new web3.TransactionInstruction(ix));
feeInMemo[memoIndex].keys = [{ pubkey:new web3.PublicKey(feePayer), isSigner:false, isWritable:false }];
rejects(() => core.validateSignedPaymentTransaction(web3, signedWith(feeInMemo).serialize(), expected),
  /fee payer appears/, 'rejects any instruction that references facilitator fee payer');

console.log(`\n${pass} passed`);
