import { PublicKey, Keypair } from '@solana/web3.js';
const auth = Keypair.generate().publicKey;
const pdKey = Keypair.generate().publicKey;
const prog = Buffer.alloc(36);
prog.writeUInt32LE(2, 0); pdKey.toBuffer().copy(prog, 4);
function mkPd(hasAuth){
  const b = Buffer.alloc(45 + 8);
  b.writeUInt32LE(3, 0); b.writeBigUInt64LE(12345n, 4);
  b[12] = hasAuth ? 1 : 0;
  if (hasAuth) auth.toBuffer().copy(b, 13);
  return b;
}
const gotPd = new PublicKey(prog.subarray(4, 36));
console.log('programdata addr    ', gotPd.equals(pdKey) ? 'OK' : 'MISMATCH');
const withAuth = mkPd(true);
console.log('has-authority tag   ', withAuth[12] === 1 ? 'OK' : 'MISMATCH');
console.log('authority pubkey    ', new PublicKey(withAuth.subarray(13, 45)).equals(auth) ? 'OK' : 'MISMATCH');
const revoked = mkPd(false);
console.log('revoked detected    ', revoked[12] === 0 ? 'OK (reads as NONE)' : 'MISMATCH');
console.log('header 4+8+1+32     ', (4+8+1+32) === 45 ? 'OK (45)' : 'MISMATCH');
