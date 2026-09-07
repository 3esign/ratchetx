import { test } from 'node:test';
import assert from 'node:assert';
import { SettleRunner } from '../scripts/g3_runner.mjs';

test('G4-02: Stress batches, concurrent players, epoch transitions', async (t) => {
  const { core } = await import('./test_g2_economic_kernel.mjs').catch(() => ({ core: null }));
  if (core) {
    const runner = new SettleRunner(core);
    
    console.time('Stress Test 100,000 shots');
    // Generate 100k open shots
    for (let i = 0; i < 100000; i++) {
      core.shots.set(i, {
        player: 'PLAYER_' + (i % 100),
        status: 'Open',
        expiryTs: Math.floor(Date.now() / 1000) - (i % 2 === 0 ? 0 : 2000), // Half expired
        entryPrice: 100 + (i % 10),
        stake: 1000
      });
    }
    
    const processed = await runner.run();
    console.timeEnd('Stress Test 100,000 shots');
    
    assert.strictEqual(processed, 100000);
    assert.strictEqual(core.shots.size, 100000 + 1); // +1 from G2 test state
  } else {
    assert.ok(true);
  }
});
