import { test } from 'node:test';
import assert from 'node:assert';

// -----------------------------------------------------------------------------
// The "Monotonic Checkpoint Race" Oracle Selection Logic (On-Chain Model)
// 
// This model simulates the smart contract logic that will receive checkpoint
// instructions containing Pyth PriceUpdateV2 payloads.
// -----------------------------------------------------------------------------

class ShotSettlement {
  constructor(expiryTime) {
    this.expiryTime = expiryTime;
    this.checkpointedPrice = null;
    this.checkpointedPublishTime = null;
    this.voided = false;
  }

  // Simulates a user calling the `checkpoint` instruction on-chain
  checkpoint(pythUpdate, now) {
    if (this.voided) throw new Error("Shot already voided");
    
    // 1. Pyth admission bounds
    if (pythUpdate.publishTime < this.expiryTime) {
      return false; // Not at or after expiry
    }
    
    // 2. Confidence bound: max 200 bps
    const confBps = (pythUpdate.conf / pythUpdate.price) * 10000;
    if (confBps > 200) {
      return false; // Confidence too wide
    }

    // 3. Stale entry / Clock bounds (On-chain might rely on cluster time, but for this simulation we use `now`)
    // A strict on-chain program would just rely on the recorded publish_time vs expiry, 
    // and let the 15-minute void window handle liveness.
    
    // 4. Monotonic Race
    // Only update if we haven't recorded one, OR if this new one has an strictly earlier publish_time.
    // Because time moves forward, the true first crossing will eventually be submitted
    // and cannot be overwritten by a later one.
    if (this.checkpointedPublishTime === null || pythUpdate.publishTime < this.checkpointedPublishTime) {
      this.checkpointedPrice = pythUpdate.price;
      this.checkpointedPublishTime = pythUpdate.publishTime;
      return true;
    }
    return false; // Ignored: Later publish_time
  }

  // Simulates the 15-minute void window expiration
  voidShot(now) {
    if (this.checkpointedPrice !== null) {
      throw new Error("Already checkpointed");
    }
    if (now < this.expiryTime + 900) { // 15 minutes = 900 seconds
      throw new Error("Void window has not expired");
    }
    this.voided = true;
    return true;
  }
}

// -----------------------------------------------------------------------------
// Adversarial Harness Tests
// -----------------------------------------------------------------------------

test('Oracle Selection: Monotonic Checkpoint Race', async (t) => {
  const expiry = 1000;

  await t.test('Standard execution: earliest update wins', () => {
    const shot = new ShotSettlement(expiry);
    
    // User A submits T+5s
    const successA = shot.checkpoint({ price: 105, conf: 1, publishTime: 1005 }, 1010);
    assert.strictEqual(successA, true);
    assert.strictEqual(shot.checkpointedPrice, 105);

    // User B submits T+10s (too late, rejected because T+5s is earlier)
    const successB = shot.checkpoint({ price: 110, conf: 1, publishTime: 1010 }, 1012);
    assert.strictEqual(successB, false);
    assert.strictEqual(shot.checkpointedPrice, 105); // Price remains T+5s

    // User C submits T+2s (valid earlier crossing, overwrites T+5s)
    const successC = shot.checkpoint({ price: 102, conf: 1, publishTime: 1002 }, 1015);
    assert.strictEqual(successC, true);
    assert.strictEqual(shot.checkpointedPrice, 102);
  });

  await t.test('Rejection of pre-expiry updates', () => {
    const shot = new ShotSettlement(expiry);
    const success = shot.checkpoint({ price: 95, conf: 1, publishTime: 999 }, 1000);
    assert.strictEqual(success, false); // publishTime < expiry
    assert.strictEqual(shot.checkpointedPrice, null);
  });

  await t.test('The Confidence Blowout (widening confidence > 200 bps)', () => {
    const shot = new ShotSettlement(expiry);
    
    // T+1s has huge confidence interval (300 bps)
    const successA = shot.checkpoint({ price: 100, conf: 3, publishTime: 1001 }, 1005); 
    assert.strictEqual(successA, false);
    assert.strictEqual(shot.checkpointedPrice, null);

    // T+5s confidence tightens to normal (100 bps)
    const successB = shot.checkpoint({ price: 102, conf: 1, publishTime: 1005 }, 1010);
    assert.strictEqual(successB, true);
    assert.strictEqual(shot.checkpointedPrice, 102);
  });

  await t.test('Missing Crossing (Oracle Halt) and Ring Wrap reorder', () => {
    const shot = new ShotSettlement(expiry);
    
    // Oracle halts at T-5s, resumes at T+30s.
    // Someone submits T+30s
    shot.checkpoint({ price: 150, conf: 1, publishTime: 1030 }, 1035);
    assert.strictEqual(shot.checkpointedPrice, 150);

    // Reorder/Ring wrap: Out of order transmission arrives for T+20s
    const successLate = shot.checkpoint({ price: 120, conf: 1, publishTime: 1020 }, 1040);
    assert.strictEqual(successLate, true);
    assert.strictEqual(shot.checkpointedPrice, 120); // Successfully improves the checkpoint to T+20s
  });

  await t.test('Forced VOID after 15-minute grace window', () => {
    const shot = new ShotSettlement(expiry);
    const now = expiry + 901; // 15m 1s

    // Try voiding before 15m
    assert.throws(() => shot.voidShot(expiry + 899), /Void window has not expired/);
    
    // Void successfully after 15m
    const voided = shot.voidShot(now);
    assert.strictEqual(voided, true);
    assert.strictEqual(shot.voided, true);

    // Checkpointing after void should fail
    assert.throws(() => shot.checkpoint({ price: 105, conf: 1, publishTime: 1001 }, now + 1), /Shot already voided/);
  });
});
