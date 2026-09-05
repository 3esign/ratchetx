const fs = require('node:fs');
const path = require('node:path');
const targetPath = 'D:/Work/Software_Projects/pumpmind/ratchetx/ratchet_phase_a_clean/api/game.js';
let content = fs.readFileSync(targetPath, 'utf8');

const claimCode = `
    if (action === 'claim_migration') {
      if (!MINT) return res.status(400).json({ ok:false, reason:'token not launched yet - paper mode only' });
      const b = req.body || {};
      const w = b.wallet || req.query.wallet;
      if (!w) return res.status(400).json({ ok:false, reason:'wallet address required' });

      try {
        const merkleData = JSON.parse(require('node:fs').readFileSync(require('node:path').join(process.cwd(), 'merkle_tree.json'), 'utf8'));
        const playerEntry = merkleData.balances[w];
        if (!playerEntry) return res.status(404).json({ ok:false, reason:'No legacy balance found for this wallet' });

        const { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, AddressLookupTableAccount, TransactionInstruction } = require('@solana/web3.js');
        const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
        
        const playerPubkey = new PublicKey(w);
        const mintPubkey = new PublicKey(MINT);
        const tokenProgramId = new PublicKey(await getMintProgram() || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
        const PROGRAM_ID = new PublicKey(MIRROR_PROGRAM_ID);

        const vaultPDA = PublicKey.findProgramAddressSync([Buffer.from('vault')], PROGRAM_ID)[0];
        const migrationStatePDA = PublicKey.findProgramAddressSync([Buffer.from('migration')], PROGRAM_ID)[0];
        const claimPDA = PublicKey.findProgramAddressSync([Buffer.from('claim'), playerPubkey.toBuffer()], PROGRAM_ID)[0];
        const playerLedgerPDA = PublicKey.findProgramAddressSync([Buffer.from('player'), playerPubkey.toBuffer()], PROGRAM_ID)[0];

        const userAta = PublicKey.findProgramAddressSync([playerPubkey.toBuffer(), tokenProgramId.toBuffer(), mintPubkey.toBuffer()], ATA_PROGRAM_ID)[0];
        const vaultAta = PublicKey.findProgramAddressSync([vaultPDA.toBuffer(), tokenProgramId.toBuffer(), mintPubkey.toBuffer()], ATA_PROGRAM_ID)[0];

        // Discriminator for claim_legacy_balance is 7cb23fa7f8c159f2
        const proofBufs = playerEntry.proof.map(p => Buffer.from(p, 'hex'));
        const dataLength = 8 + 8 + 8 + 4 + (proofBufs.length * 32);
        const data = Buffer.alloc(dataLength);
        
        Buffer.from('7cb23fa7f8c159f2', 'hex').copy(data, 0);
        data.writeBigUInt64LE(BigInt(playerEntry.cr), 8);
        data.writeBigUInt64LE(BigInt(playerEntry.xp), 16);
        data.writeUInt32LE(proofBufs.length, 24);
        let offset = 28;
        for (const p of proofBufs) {
          p.copy(data, offset);
          offset += 32;
        }

        const ix = new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: migrationStatePDA, isSigner: false, isWritable: false },
            { pubkey: claimPDA, isSigner: false, isWritable: true },
            { pubkey: playerPubkey, isSigner: true, isWritable: true },
            { pubkey: playerLedgerPDA, isSigner: false, isWritable: true },
            { pubkey: userAta, isSigner: false, isWritable: true },
            { pubkey: vaultAta, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: tokenProgramId, isSigner: false, isWritable: false },
          ],
          data
        });

        const createAtaIx = new TransactionInstruction({
          programId: ATA_PROGRAM_ID,
          keys: [
            { pubkey: playerPubkey, isSigner: true, isWritable: true },
            { pubkey: userAta, isSigner: false, isWritable: true },
            { pubkey: playerPubkey, isSigner: false, isWritable: false },
            { pubkey: mintPubkey, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: tokenProgramId, isSigner: false, isWritable: false },
          ],
          data: Buffer.from([1]),
        });

        const getBH = await rpcCall('getLatestBlockhash', [{ commitment:'confirmed' }]);
        if (!getBH || !getBH.value || !getBH.value.blockhash) throw new Error('Failed to get latest blockhash');

        const message = new TransactionMessage({
          payerKey: playerPubkey,
          recentBlockhash: getBH.value.blockhash,
          instructions: [createAtaIx, ix]
        }).compileToV0Message([]);

        const newTx = new VersionedTransaction(message);
        return res.json({ ok:true, tx: Buffer.from(newTx.serialize()).toString('base64'), message: 'Sign to claim your legacy balance.' });
      } catch (err) {
        return res.status(500).json({ ok:false, reason: err.message });
      }
    }
`;

content = content.replace("if (action === 'reload_build') {", claimCode + "\n    if (action === 'reload_build') {");

fs.writeFileSync(targetPath, content);
console.log('Added claim_migration to api/game.js');
