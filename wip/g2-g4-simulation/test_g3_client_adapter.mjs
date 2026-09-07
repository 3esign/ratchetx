import { test } from 'node:test';
import assert from 'node:assert';

class MockWeb3Adapter {
  constructor(playerPubkey) {
    this.playerPubkey = playerPubkey;
    this.programId = 'RATCHET_CORE_PROG_ID';
  }

  buildAcceptShotIx(targetFeed, side, stake, probability) {
    return {
      programId: this.programId,
      keys: [
        { pubkey: this.playerPubkey, isSigner: true, isWritable: true },
        { pubkey: 'VAULT_PDA', isSigner: false, isWritable: true },
        { pubkey: targetFeed, isSigner: false, isWritable: false }
      ],
      data: Buffer.from([/* Instruction discriminator + args */ 1, side, stake, probability])
    };
  }

  buildDelegateGrantIx(delegatePubkey, allowance, expiry) {
    return {
      programId: this.programId,
      keys: [
        { pubkey: this.playerPubkey, isSigner: true, isWritable: true },
        { pubkey: delegatePubkey, isSigner: false, isWritable: false },
        { pubkey: 'GRANT_PDA', isSigner: false, isWritable: true }
      ],
      data: Buffer.from([/* Instruction discriminator + args */ 2, allowance, expiry])
    };
  }
}

test('G3-03: Minimal existing-client adapter', async (t) => {
  const adapter = new MockWeb3Adapter('PLAYER_123');

  await t.test('Builds Accept Shot Instruction', () => {
    const ix = adapter.buildAcceptShotIx('FEED_XYZ', 1, 100, 60000);
    assert.strictEqual(ix.programId, 'RATCHET_CORE_PROG_ID');
    assert.strictEqual(ix.keys[0].pubkey, 'PLAYER_123');
    assert.strictEqual(ix.keys[0].isSigner, true);
    assert.ok(ix.data instanceof Buffer);
  });

  await t.test('Builds Delegate Grant Instruction', () => {
    const ix = adapter.buildDelegateGrantIx('BANKR_BOT', 5000, 1999999999);
    assert.strictEqual(ix.keys[1].pubkey, 'BANKR_BOT');
    assert.strictEqual(ix.keys[2].pubkey, 'GRANT_PDA');
  });
});
