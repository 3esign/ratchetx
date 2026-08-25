/**
 * RATCHET SEAL V3 - Settlement Cranker Bot
 * 
 * Scans the blockchain for 'Sealed' shots that have expired.
 * Retrieves the exact crossing VAA from the local SQLite archiver.
 * Submits the 'settle' transaction to Solana.
 * 
 * Run via: node scripts/cranker_bot.js
 */

const { Connection, Keypair, Transaction } = require('@solana/web3.js');
const anchor = require('@coral-xyz/anchor');
const { PythSolanaReceiver } = require('@pythnetwork/pyth-solana-receiver');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const PROGRAM_ID = new anchor.web3.PublicKey('CqVGgsJpkWm4KtSzQkLk4LaRikgxnRrhbYGietTtu7AB');
const DB_PATH = path.join(__dirname, '..', 'vaa_archive.sqlite');
const db = new sqlite3.Database(DB_PATH);

async function backfillVAA(feedIdHex, expiryTs) {
    console.log(Backfilling missing VAA from Hermes REST for expiryTs ...);
    let targetTs = expiryTs;
    for (let i = 0; i < 10; i++) {
        try {
            const url = https://hermes.pyth.network/v2/updates/price/?ids[]=;
            const res = await fetch(url);
            const data = await res.json();
            if (data && data.parsed && data.parsed.length > 0) {
                const parsed = data.parsed[0];
                const pubTime = parsed.price.publish_time;
                if (pubTime >= expiryTs) {
                    const vaaHex = data.binary.data[0];
                    const vaaBase64 = Buffer.from(vaaHex, 'hex').toString('base64');
                    await new Promise((resolve) => {
                        db.run('INSERT OR IGNORE INTO vaas (publish_time, feed_id, vaa) VALUES (?, ?, ?)', 
                            [pubTime, feedIdHex, vaaBase64], 
                            () => resolve()
                        );
                    });
                    console.log(Successfully backfilled VAA (publish_time: ));
                    return true;
                }
            }
        } catch (e) {
            console.error(Backfill failed for ts :, e.message);
        }
        targetTs++;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
}

async function startCranker() {
    console.log('Starting V3 Cranker Bot...');
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    // Load the cranker keypair (must have SOL to pay for transactions)
    const keypairFile = path.join(__dirname, '..', 'onchain', 'ratchet-seal-v3', 'deployer.json');
    let secretKey;
    if (process.env.CRANKER_SECRET_KEY) {
        secretKey = anchor.utils.bytes.bs58.decode(process.env.CRANKER_SECRET_KEY);
    } else if (fs.existsSync(keypairFile)) {
        secretKey = new Uint8Array(JSON.parse(fs.readFileSync(keypairFile, 'utf8')));
    } else {
        console.error('Cranker keypair not found (neither ENV nor deployer.json)!');
        return;
    }
    
    const crankerWallet = new anchor.Wallet(Keypair.fromSecretKey(secretKey));
    const provider = new anchor.AnchorProvider(connection, crankerWallet, { commitment: 'confirmed' });
    
    const idlPath = path.join(__dirname, '..', 'onchain', 'ratchet-seal-v3', 'target', 'idl', 'ratchet_seal.json');
    if (!fs.existsSync(idlPath)) {
        console.log('Waiting for Anchor to build IDL...');
        setTimeout(startCranker, 5000);
        return;
    }
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
    const program = new anchor.Program(idl, PROGRAM_ID, provider);
    const pythReceiver = new PythSolanaReceiver({ connection, wallet: crankerWallet });

    // Polling loop
    setInterval(async () => {
        try {
            await processExpiredShots(program, pythReceiver);
        } catch (e) {
            console.error('Crank error:', e);
        }
    }, 2000);
}

async function processExpiredShots(program, pythReceiver) {
    const now = Math.floor(Date.now() / 1000);
    
    const shots = await program.account.shot.all([
        { memcmp: { offset: 8 + 32 + 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 1, bytes: anchor.utils.bytes.bs58.encode([1]) } }
    ]);

    for (const shot of shots) {
        const expiryTs = shot.account.expiryTs.toNumber();
        if (now >= expiryTs) {
            const feedIdHex = Buffer.from(shot.account.feedId).toString('hex');
            
            db.get(
                'SELECT vaa FROM vaas WHERE feed_id = ? AND publish_time >= ? ORDER BY publish_time ASC LIMIT 1',
                [feedIdHex, expiryTs],
                async (err, row) => {
                    if (err || !row) {
                        if (now > expiryTs + 900) {
                            console.log(Shot  expired 15 mins ago. Voiding!);
                            await program.methods.voidShot()
                                .accounts({ shot: shot.publicKey, cranker: program.provider.wallet.publicKey })
                                .rpc();
                            return;
                        }
                        
                        // Wait 5 seconds before trying to backfill
                        if (now > expiryTs + 5) {
                            await backfillVAA(feedIdHex, expiryTs);
                        }
                        return;
                    }

                    console.log(Found crossing VAA for shot ! Settling...);
                    
                    const vaaBuffer = Buffer.from(row.vaa, 'base64');
                    const pythIxBuilder = await pythReceiver.getPostUpdateIxBuilder(row.vaa);
                    const pythIxs = await pythIxBuilder.instructions();
                    const priceUpdateAccount = pythIxBuilder.getPriceUpdateAccount();

                    const tx = new Transaction().add(...pythIxs);
                    
                    const settleIx = await program.methods.settle()
                        .accounts({
                            shot: shot.publicKey,
                            priceUpdate: priceUpdateAccount,
                            cranker: program.provider.wallet.publicKey
                        })
                        .instruction();
                    
                    tx.add(settleIx);
                    
                    try {
                        const sig = await program.provider.sendAndConfirm(tx);
                        console.log(Shot Settled! Tx: );
                    } catch (settleErr) {
                        console.error('Failed to settle shot:', settleErr.message || settleErr);
                        const errMsg = settleErr.toString();
                        if (errMsg.includes('NotFirstUpdate') || errMsg.includes('first crossing update')) {
                            console.log('Missed the first VAA! Initiating backfill...');
                            await backfillVAA(feedIdHex, expiryTs);
                        }
                    }
                }
            );
        }
    }
}

startCranker();
