// A wallet may append guard instructions before signing (Phantom/Lighthouse); it may not
// reorder, alter or prepend ours, add a System transfer, call our programs, or change the payer.
// Found 2026-09-08 when the /play claim failed with "Wallet returned a different transaction".
const { walletKeptOurTransaction } = await import(new URL('../lib/g2/browser-game.mjs', import.meta.url));
const { loadWeb3 } = await import(new URL('../skills/ratchetx-g2/scripts/g2-session.mjs', import.meta.url));
const web3 = loadWeb3(); const { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, SystemProgram } = web3;
const payer = Keypair.generate(); const core = new PublicKey('ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL'); const lighthouse = Keypair.generate().publicKey;
const bh = '11111111111111111111111111111111';
const ours = new TransactionInstruction({ programId: core, keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }], data: Uint8Array.from([1,2,3]) });
const build = ixs => new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: bh, instructions: ixs }).compileToV0Message());
const orig = build([ours]);
const guard = new TransactionInstruction({ programId: lighthouse, keys: [{ pubkey: payer.publicKey, isSigner: false, isWritable: false }], data: Uint8Array.from([9]) });
const results = {
  identical: walletKeptOurTransaction(orig.message, build([ours]), { ourPrograms: [core.toBase58()] }),
  appendedGuard: walletKeptOurTransaction(orig.message, build([ours, guard]), { ourPrograms: [core.toBase58()] }),
  prependedGuard: walletKeptOurTransaction(orig.message, build([guard, ours]), { ourPrograms: [core.toBase58()] }),
  appendedCoreCall: walletKeptOurTransaction(orig.message, build([ours, new TransactionInstruction({ programId: core, keys: [], data: Uint8Array.from([7]) })]), { ourPrograms: [core.toBase58()] }),
  appendedTransfer: walletKeptOurTransaction(orig.message, build([ours, SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: lighthouse, lamports: 1 })]), { ourPrograms: [core.toBase58()] }),
  changedData: walletKeptOurTransaction(orig.message, build([new TransactionInstruction({ programId: core, keys: ours.keys, data: Uint8Array.from([1,2,4]) })]), { ourPrograms: [core.toBase58()] }),
  otherPayer: walletKeptOurTransaction(orig.message, new VersionedTransaction(new TransactionMessage({ payerKey: lighthouse, recentBlockhash: bh, instructions: [ours] }).compileToV0Message()), { ourPrograms: [core.toBase58()] }),
};
console.log(results);
const expect = { identical: true, appendedGuard: true, prependedGuard: false, appendedCoreCall: false, appendedTransfer: false, changedData: false, otherPayer: false };
if (JSON.stringify(results) !== JSON.stringify(expect)) { console.error('MISMATCH'); process.exit(1); } console.log('ALL AS EXPECTED');
