#!/usr/bin/env node
// Create a throwaway player wallet for the mainnet exercise, if one is not there
// already. Prints the public key only; the secret is written to the file and
// never to the screen, a log or a report.
import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';
const path = process.argv[2];
if (!path) { console.error('usage: node tools/new-player-keypair.mjs <path>'); process.exit(1); }
if (fs.existsSync(path)) {
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, 'utf8'))));
  console.log('EXISTS  ' + kp.publicKey.toBase58());
  process.exit(0);
}
const kp = Keypair.generate();
fs.writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
console.log('CREATED ' + kp.publicKey.toBase58());
