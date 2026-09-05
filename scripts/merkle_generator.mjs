import fs from 'node:fs';
import crypto from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

function bufferToHex(buffer) {
  return buffer.toString('hex');
}

function generateLeaf(walletStr, cr, xp) {
  // Convert wallet to 32-byte pubkey
  const pubkey = new PublicKey(walletStr).toBuffer();
  
  // Convert cr and xp to 8-byte little-endian (u64)
  const crBuffer = Buffer.alloc(8);
  crBuffer.writeBigUInt64LE(BigInt(cr), 0);
  
  const xpBuffer = Buffer.alloc(8);
  xpBuffer.writeBigUInt64LE(BigInt(xp), 0);
  
  // Leaf = sha256(pubkey || cr || xp)
  const leafData = Buffer.concat([pubkey, crBuffer, xpBuffer]);
  return sha256(leafData);
}

function generateMerkleTree(leaves) {
  let layer = leaves;
  const layers = [layer];
  
  while (layer.length > 1) {
    const nextLayer = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 === layer.length) {
        // Odd number of nodes, just pass the last one up
        nextLayer.push(layer[i]);
      } else {
        const left = layer[i];
        const right = layer[i + 1];
        
        // Sort the pairs to avoid left/right index tracking in proofs
        const concat = Buffer.compare(left, right) < 0 
          ? Buffer.concat([left, right]) 
          : Buffer.concat([right, left]);
          
        nextLayer.push(sha256(concat));
      }
    }
    layer = nextLayer;
    layers.push(layer);
  }
  
  return layers;
}

function getProof(layers, leafIndex) {
  const proof = [];
  let currentIndex = leafIndex;
  
  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i];
    const isRightNode = currentIndex % 2 === 1;
    let siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;
    
    // If it's the last element and odd, there is no sibling on this level
    if (siblingIndex < layer.length) {
      proof.push(bufferToHex(layer[siblingIndex]));
    }
    
    currentIndex = Math.floor(currentIndex / 2);
  }
  
  return proof;
}

function main() {
  if (!fs.existsSync('merkle_balances.json')) {
    console.error('Error: merkle_balances.json not found. Run reconcile.mjs first.');
    process.exit(1);
  }

  const balances = JSON.parse(fs.readFileSync('merkle_balances.json', 'utf8'));
  
  if (balances.length === 0) {
    console.log('No balances to process. Tree is empty.');
    process.exit(0);
  }

  console.log(`Processing ${balances.length} eligible accounts...`);

  const leaves = balances.map((b) => generateLeaf(b.wallet, b.cr, b.xp));
  
  // Build tree
  const layers = generateMerkleTree(leaves);
  const root = bufferToHex(layers[layers.length - 1][0]);
  
  console.log(`\nMerkle Root: ${root}\n`);
  
  // Generate proofs
  const output = {
    root,
    totalAccounts: balances.length,
    accounts: {}
  };
  
  for (let i = 0; i < balances.length; i++) {
    const b = balances[i];
    output.accounts[b.wallet] = {
      cr: b.cr,
      xp: b.xp,
      proof: getProof(layers, i)
    };
  }
  
  fs.writeFileSync('merkle_tree.json', JSON.stringify(output, null, 2));
  console.log('Successfully wrote merkle_tree.json with proofs for all accounts.');
}

main();
