import fs from 'node:fs';
import path from 'node:path';
import { Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Replace this with the actual network URL or get from .env
const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

// Load wallet from standard path
const walletPath = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'solana', 'id.json');
const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf8')));
const authority = Keypair.fromSecretKey(secretKey);

const merkleTree = JSON.parse(fs.readFileSync(path.join(__dirname, '../merkle_tree.json'), 'utf8'));
const rootHashHex = merkleTree.root;
const rootBuf = Buffer.from(rootHashHex, 'hex');

// You should put the actual Program ID here. Using a placeholder for now until you deploy the updated contract.
const PROGRAM_ID = new PublicKey('11111111111111111111111111111111'); // TODO: Replace with Ratchet Core program ID

async function pushRoot() {
  console.log('Authority:', authority.publicKey.toBase58());
  console.log('Pushing Merkle Root:', rootHashHex);

  const migrationStatePDA = PublicKey.findProgramAddressSync([Buffer.from('migration')], PROGRAM_ID)[0];
  
  // Discriminator for initialize_migration: you'd calculate this via sha256('global:initialize_migration')
  // We'll assume the contract is deployed. 
  
  console.log('Ready to push root to:', migrationStatePDA.toBase58());
  // The actual push requires the deployed program ID. 
  console.log('Please replace PROGRAM_ID in scripts/push_root.mjs with your actual Ratchet Core Program ID before running.');
}

pushRoot().catch(console.error);
