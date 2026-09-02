// Devnet salt wiring check — proves this directory's imports resolve and that
// the same wallet + nonce reproduces the same salt, which is the property the
// player now depends on instead of devnet_shooter_salts.json.
//   node salt-wiring-check.mjs
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { deriveSalt } from './salt.mjs';
const w = Keypair.generate();
const signMessage = async b => nacl.sign.detached(b, w.secretKey);
const P = 'CnKAJQAQvJQ7Ht3rZRt4ZaFuZSFL4G6sDZShbmJUdTCx';
const a = await deriveSalt({ signMessage, programId: P, wallet: w.publicKey.toBase58(), nonce: 123456 });
const b = await deriveSalt({ signMessage, programId: P, wallet: w.publicKey.toBase58(), nonce: 123456 });
console.log('derived      :', a);
console.log('reproducible :', a === b ? 'YES (same wallet + nonce -> same salt)' : 'NO');
console.log('format ok    :', /^[0-9a-f]{32}$/.test(a));
