/**
 * RATCHET SEAL V3 - Backend Indexer / Engine Draft
 * 
 * In V3, the server NO LONGER settles shots or decides who won.
 * The server becomes a purely reactive INDEXER. 
 * It listens to the Solana blockchain for events emitted by ratchet-seal-v3,
 * and updates the off-chain database (XP, Ladders, Streaks) accordingly.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { awardXp, updateLadder } from './some_db_module.js';

const PROGRAM_ID = new PublicKey('CqVGgsJpkWm4KtSzQkLk4LaRikgxnRrhbYGietTtu7AB');
const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');

// In a real Vercel environment, this could be a cron job fetching recent signatures,
// or a persistent worker tracking the program logs.
export async function syncV3Events() {
    const provider = new anchor.AnchorProvider(connection, null, {});
    const program = new anchor.Program(IDL, PROGRAM_ID, provider);

    console.log('Listening for Ratchet V3 on-chain events...');

    // Event 1: A player sealed a shot
    program.addEventListener('Sealed', async (event, slot) => {
        console.log(`[ON-CHAIN] Player ${event.player.toBase58()} sealed shot ${event.shotId}!`);
        // We can record the entry in the DB for the UI, but it's already secured on-chain.
    });

    // Event 2: A cranker provided the VAA and settled the price
    program.addEventListener('Settled', async (event, slot) => {
        console.log(`[ON-CHAIN] Shot ${event.shot.toBase58()} crossed the finish line at price ${event.exitE12.toString()}`);
        // The shot is settled, but we don't know if they won or lost until they reveal!
    });

    // Event 3: The player revealed their secret and the contract scored it
    program.addEventListener('Revealed', async (event, slot) => {
        console.log(`[ON-CHAIN] Player ${event.player.toBase58()} revealed! Hit: ${event.hit}`);
        
        // NOW the backend kicks in to award off-chain XP!
        if (event.hit === 1) {
            await awardXp(event.player.toBase58(), 500); // 500 XP for winning
            await updateLadder(event.player.toBase58());
        } else {
            console.log('Player lost. Streak resets.');
        }
    });

    // Event 4: The shot was voided (e.g. VAA archiver failed, or equality tie)
    program.addEventListener('Voided', async (event, slot) => {
        console.log(`[ON-CHAIN] Shot ${event.shot.toBase58()} was VOIDED. Reason: ${event.reason}`);
        // Refund the player's off-chain credits/stake if applicable
    });
}
