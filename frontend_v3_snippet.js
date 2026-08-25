/**
 * RATCHET SEAL V3 - Frontend Integration Snippet
 * 
 * This shows how the client (index.html) will transition from sending HTTP POSTs 
 * to directly signing on-chain Solana transactions for V3.
 */

import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { PythSolanaReceiver } from '@pythnetwork/pyth-solana-receiver';

const PROGRAM_ID = new PublicKey('CqVGgsJpkWm4KtSzQkLk4LaRikgxnRrhbYGietTtu7AB');
const SOL_FEED_ID_HEX = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

/**
 * Seals a new shot on-chain.
 * Replaces the old \etch('/api/game', { method: 'POST', action: 'seal' })\.
 */
export async function sealShotOnChain(wallet, shotParams) {
    const connection = new Connection('https://api.devnet.solana.com');
    const provider = new anchor.AnchorProvider(connection, wallet, {});
    const program = new anchor.Program(IDL, PROGRAM_ID, provider);
    const pythReceiver = new PythSolanaReceiver({ connection, wallet });

    // 1. Fetch the latest price VAA from Hermes so the contract can record the exact entry price
    const response = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${SOL_FEED_ID_HEX}`);
    const data = await response.json();
    const vaa = data.binary.data[0];

    // 2. Create the Pyth PriceUpdateV2 instruction
    const pythIxBuilder = await pythReceiver.getPostUpdateIxBuilder(vaa);
    const pythIxs = await pythIxBuilder.instructions();
    const priceUpdateAccount = pythIxBuilder.getPriceUpdateAccount(); // This PDA holds the pulled price

    // 3. Prepare the Ratchet parameters
    const nonce = new anchor.BN(Date.now()); // Unique nonce for this player's shot
    const commitHash = await computeCommitmentHash(shotParams.side, shotParams.salt);
    const expiryTs = new anchor.BN(Math.floor(Date.now() / 1000) + (shotParams.minutes * 60));
    const kind = shotParams.kind === 'direction' ? 0 : 1;
    const threshold = new anchor.BN(0);

    // 4. Derive the Shot PDA
    const [shotPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('shot'), wallet.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
        PROGRAM_ID
    );

    // 5. Build the Seal instruction
    const sealIx = await program.methods.seal(
        nonce,
        Array.from(commitHash),
        shotParams.id, // e.g. "shot_123"
        SOL_FEED_ID_HEX,
        expiryTs,
        kind,
        threshold
    )
    .accounts({
        shot: shotPda,
        player: wallet.publicKey,
        priceUpdate: priceUpdateAccount,
        systemProgram: SystemProgram.programId
    })
    .instruction();

    // 6. Combine and send the transaction
    const tx = new Transaction().add(...pythIxs, sealIx);
    
    // The user's Phantom wallet pops up here!
    const txSignature = await provider.sendAndConfirm(tx);
    console.log('Shot perfectly sealed on-chain!', txSignature);
    
    return { shotPda, txSignature };
}

async function computeCommitmentHash(side, salt) {
    // side: 1 for YES, 0 for NO
    const sideStr = side === 1 ? 'YES' : 'NO';
    const payload = `${sideStr}|${salt}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hashBuffer);
}
