import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { generateSigner, createSignerFromKeypair, keypairIdentity, sol } from '@metaplex-foundation/umi';
import { 
  createV2, fetchAsset, pluginAuthorityPair, writeExternalPluginAdapterDataV1,
  baseExternalPluginAdapterInitInfo, appDataInitInfoArgsToBase
} from '@metaplex-foundation/mpl-core';
import { encodePassportState } from './schema.mjs';
import fs from 'fs';
import path from 'path';

const umi = createUmi('https://api.devnet.solana.com', { commitment: 'confirmed' });

function getOrCreateKeypair(filename) {
    const filepath = path.join(process.cwd(), filename);
    if (fs.existsSync(filepath)) {
        const secretKey = new Uint8Array(JSON.parse(fs.readFileSync(filepath, 'utf8')));
        const keypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
        return createSignerFromKeypair(umi, keypair);
    } else {
        const keypair = umi.eddsa.generateKeypair();
        fs.writeFileSync(filepath, JSON.stringify(Array.from(keypair.secretKey)));
        return createSignerFromKeypair(umi, keypair);
    }
}

async function runDevnet() {
  console.log('Loading or generating keypairs...');
  
  const player = getOrCreateKeypair('player-keypair.json');
  const ratchetAuth = getOrCreateKeypair('ratchetAuth-keypair.json');
  
  console.log(`Player Pubkey: ${player.publicKey}`);
  console.log(`Ratchet Auth Pubkey: ${ratchetAuth.publicKey}`);

  // Check balances
  const playerBalance = await umi.rpc.getBalance(player.publicKey);
  const ratchetBalance = await umi.rpc.getBalance(ratchetAuth.publicKey);
  
  console.log(`Player Balance: ${Number(playerBalance.basisPoints) / 1e9} SOL`);
  console.log(`Ratchet Balance: ${Number(ratchetBalance.basisPoints) / 1e9} SOL`);

  if (playerBalance.basisPoints === 0n || ratchetBalance.basisPoints === 0n) {
      console.log('\n--- NEDOSTAJE SOLANA ---');
      console.log('Molim te pošalji malo Devnet SOL-a (barem 0.1 SOL) na ove dvije adrese preko Phantom novčanika ili na https://faucet.solana.com/');
      console.log(`1. Pošalji na Player: ${player.publicKey}`);
      console.log(`2. Pošalji na Ratchet: ${ratchetAuth.publicKey}`);
      console.log('Kada pošalješ, samo ponovno pokreni skriptu!\n');
      process.exit(0);
  }

  console.log('\nStanje je u redu, krećemo s kreiranjem Asseta...\n');
  umi.use(keypairIdentity(player));

  const asset = generateSigner(umi);

  const passportState = {
    player: player.publicKey,
    sequence: 0,
    previousCheckpointHash: '0'.repeat(64),
    checkpointHash: '0'.repeat(64),
    logHead: '0'.repeat(64),
    stateRoot: '0'.repeat(64),
    lifetimeXp: 0,
    bestStreak: 0,
    shots: 0,
    podiumWins: 0,
    burned: 0,
    epochDay: 0,
    checkpointUnix: 0,
    logIndex: 0
  };

  const appDataBytes = encodePassportState(passportState);
  
  console.log('Creating Core Asset with FreezeDelegate and AppData...');
  try {
    const tx = await createV2(umi, {
      asset,
      name: 'RATCHET Player Passport',
      uri: 'https://ratchetx.xyz/token/player-passport.json',
      owner: player.publicKey,
      plugins: [
        pluginAuthorityPair({
          type: 'FreezeDelegate',
          data: {
            frozen: true
          }
        })
      ],
      externalPluginAdapters: [
        baseExternalPluginAdapterInitInfo('AppData', [
          appDataInitInfoArgsToBase({
            dataAuthority: { type: 'Address', address: ratchetAuth.publicKey },
            schema: null
          })
        ])
      ]
    }).sendAndConfirm(umi);

    console.log('Asset created successfully:', asset.publicKey);
    
    console.log('Writing initial RATCHET AppData to the asset via state authority...');
    umi.use(keypairIdentity(ratchetAuth));
    
    await writeExternalPluginAdapterDataV1(umi, {
      asset: asset.publicKey,
      authority: ratchetAuth,
      key: { __kind: 'AppData', fields: [{ __kind: 'Address', address: ratchetAuth.publicKey }] },
      data: appDataBytes
    }).sendAndConfirm(umi);

    console.log('AppData written successfully.');
    
    const fetched = await fetchAsset(umi, asset.publicKey);
    console.log('\n--- REZULTAT ---');
    console.log('Fetched Asset:', fetched.name);
    console.log('AppData:', fetched.appDatas);
    
  } catch (err) {
    console.error('Failed to create Core Asset:', err);
  }
}

const args = process.argv.slice(2);
if (args[0] === 'devnet') {
    runDevnet().catch(err => {
        console.error(err);
        process.exit(1);
    });
} else if (args[0] === 'plan') {
    console.log('Planning mode');
} else {
    console.log('Usage: node src/cli.mjs [devnet|plan]');
}
