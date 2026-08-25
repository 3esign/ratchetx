import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair } from '@solana/web3.js';
import { PythSolanaReceiver } from '@pythnetwork/pyth-solana-receiver';
import { assert } from 'chai';
// Use require for fetch if running in older node, but node 24 has global fetch
const SOL_FEED_ID_HEX = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

describe('ratchet-seal-v3', () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  
  // Since we don't have the generated types locally yet, we load dynamically
  let program: any;
  let pythReceiver: PythSolanaReceiver;

  before(async () => {
    // Wait for the workspace to load
    program = anchor.workspace.RatchetSeal;
    pythReceiver = new PythSolanaReceiver({ connection: provider.connection, wallet: provider.wallet as any });
  });
  
  it('Can seal a shot and void it', async () => {
    // 1. Fetch real VAA from Hermes
    const response = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${SOL_FEED_ID_HEX}`);
    const data = await response.json();
    const vaa = data.binary.data[0];

    // 2. Post it to Pyth Receiver on localnet
    const pythIxBuilder = await pythReceiver.getPostUpdateIxBuilder(vaa);
    const pythIxs = await pythIxBuilder.instructions();
    const priceUpdateAccount = pythIxBuilder.getPriceUpdateAccount();

    const tx = new anchor.web3.Transaction().add(...pythIxs);
    await provider.sendAndConfirm(tx);

    // 3. Seal the shot
    const nonce = new anchor.BN(Date.now());
    const commit = new Uint8Array(32);
    const shotId = 'test_shot_1';
    
    // Set expiry 5 seconds in the past so we can immediately test Void!
    // Wait! The contract checks: require!(expiry_ts > now, ExpiryInPast);
    // So we must set expiry in the FUTURE!
    const expiryTs = new anchor.BN(Math.floor(Date.now() / 1000) + 10);
    const kind = 0;
    const thresholdE12 = new anchor.BN(0);

    const [shotPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('shot'), provider.wallet.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    await program.methods.seal(
      nonce,
      Array.from(commit),
      shotId,
      SOL_FEED_ID_HEX,
      expiryTs,
      kind,
      thresholdE12
    )
    .accounts({
      shot: shotPda,
      player: provider.wallet.publicKey,
      priceUpdate: priceUpdateAccount,
      systemProgram: SystemProgram.programId
    })
    .rpc();

    // Verify shot state
    const shotAccount = await program.account.shot.fetch(shotPda);
    assert.equal(shotAccount.state, 1); // 1 = Sealed

    // 4. Fast forward time to expire the shot (Localnet trick)
    // Unfortunately we can't easily fast-forward the BPF clock in TS.
    // Instead we will wait 11 seconds.
    console.log('Waiting 11 seconds for shot to expire...');
    await new Promise(resolve => setTimeout(resolve, 11000));

    // 5. Void the shot
    await program.methods.voidShot()
      .accounts({
        shot: shotPda,
        cranker: provider.wallet.publicKey
      })
      .rpc();

    const voidedAccount = await program.account.shot.fetch(shotPda);
    assert.equal(voidedAccount.state, 3); // 3 = Voided
  });
});
