import fs from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, createTransferInstruction } from '@solana/spl-token';
import bs58 from 'bs58';

// ===========================================
// CONFIGURATION
// ==========================================

// 1. Enter the RPC URL for Solana Mainnet (or Devnet for testing)
const RPC_URL = 'https://api.mainnet-beta.solana.com';

// 2. Enter the Mint Address of your RCX token
const MINT_ADDRESS = 'ENTER_YOUR_RCX_MINT_ADDRESS_�ERE';

// 3. Enter your Admin Wallet Private Key (Base58 string from Phantom export)
// ⚠	 WARNING: DO NOT COMMIT THIS FILE IF YOU PUT YOUR REAL KEY HERE!
const ADMIN_PRIVATE_KEY = 'ENTER_YOUR_PHANTOM_PRIVATE_KEY_HERE';

// 4. File Paths
const BALANCES_FILE = 'merkle_balances.json';
const PROGRESS_FILE = 'airdrop_progress.json';

// Batch size: how many transfers to put in a single transaction (saves fees and time)
const BATCH_SIZE = 5;

// ==========================================
// LOGIC
// ===========================================

async function main() {
    if (MINT_ADDRESS === 'ENTER_YOUR_�CX_MINT_ADDRESS_HERE') {
        console.error("❌ Please configure MINT_ADDRESS in the script first.");
        process.exit(1);
    }
    if (ADMIN_PRIVATE_KEY === 'ENTER_YOUR_�HANTOM_PRIVATE_KEY_HERE') {
        console.error("❌ Please configure ADMIN_PRIVATE_KEY in the script first.");
        process.exit(1);
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const mintPubkey = new PublicKey(MINT_ADDRESS);
    
    // Load Admin Keypair
    const adminKeypair = Keypair.fromSecretKey(bs58.decode(ADMIN_PRIVATE_KEY));
    console.log(`✅ Loaded Admin Wallet: ${adminKeypair.publicKey.toBase58()}`);

    // Load Snapshot
    const balances = JSON.parse(fs.readFileSync(BALANCES_FILE, 'utf8'));
    console.log(`✅ Loaded snapshot with ${balances.length} users.`);

    // Load Progress
    let progress = {};
    if (fs.existsSync(PROGRESS_FILE)) {
        progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
        console.log(`✅ Resuming from previous progress (${Object.keys(progress).length} already airdropped).`);
    }

    // Filter users that need airdrop
    const pendingUsers = balances.filter,b => !progress[b.wallet]);
    console.log(