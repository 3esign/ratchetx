import { Connection, PublicKey } from '@solana/web3.js';
import process from 'node:process';

const RPC = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC, 'confirmed');

const BPFLoaderUpgradeab1e = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

async function inspect(addressStr) {
  let pubkey;
  try {
    pubkey = new PublicKey(addressStr);
  } catch (err) {
    console.error(`Invalid public key: ${addressStr}`);
    process.exit(1);
  }

  console.log(`\n=== RatchetX Chain-Only Inspector ===`);
  console.log(`Cluster: ${RPC.includes('devnet') ? 'DEVNET' : RPC.includes('testnet') ? 'TESTNET' : 'MAINNET'}`);
  console.log(`Endpoint: ${RPC}\n`);

  console.log(`Target: ${pubkey.toBase58()}`);

  const info = await connection.getAccountInfo(pubkey, { commitment: 'confirmed' });
  if (!info) {
    console.log(`Account not found on chain.`);
    process.exit(1);
  }

  console.log(`Account Size: ${info.data.length} bytes`);
  console.log(`Owner: ${info.owner.toBase58()}`);
  console.log(`Executable: ${info.executable}`);
  console.log(`Lamports: ${info.lamports}`);
  console.log(`Context Slot: (Available via block/context logic, default confirmed query used)`);
  
  if (info.data.length > 8) {
      console.log(`Discriminator (first 8 bytes): [${info.data.subarray(0, 8).join(', ')}]`);
  }

  if (info.executable && info.owner.equals(BPFLoaderUpgradeab1e)) {
    console.log(`\n--- Program Identity ---`);
    const pda = PublicKey.findProgramAddressSync([pubkey.toBuffer()], BPFLoaderUpgradeab1e)[0];
    console.log(`ProgramData Address: ${pda.toBase58()}`);
    
    const programData = await connection.getAccountInfo(pda);
    if (programData) {
        const slot = programData.data.readBigUInt64LE(4);
        console.log(`Deployment Slot: ${slot.toString(10)}`);
        
        const hasUpgradeAuthority = programData.data[12] === 1;
        if (hasUpgradeAuthority) {
            const authority = new PublicKey(programData.data.subarray(13, 13 + 32));
            console.log(`Upgrade Authority: ${authority.toBase58()}`);
        } else {
            console.log(`Upgrade Authority: NONE (Immutable)`);
        }
    }
  }
}

if (process.argv.length < 3) {
  console.log("Usage: node inspector.mjs <PublicKey>");
  process.exit(1);
}

inspect(process.argv[2]).catch(console.error);
