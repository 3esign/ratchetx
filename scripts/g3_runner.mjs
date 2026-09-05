class SettleRunner {
  constructor(core) {
    this.core = core;
  }
  
  async run() {
    const now = Math.floor(Date.now() / 1000);
    let processed = 0;
    for (const [nonce, shot] of this.core.shots.entries()) {
      if (shot.status !== 'Open') continue;
      
      // Simulate Pyth price check
      try {
        const simulatedPrice = 110;
        this.core.settleShot({ player: shot.player, xp: 100000000, hits: 0, shots: 0, balance: 1000, brierDenominator: 1 }, nonce, 1, 60000, simulatedPrice, 'salt');
        processed++;
      } catch (e) {
        if (now > shot.expiryTs + 900) {
          this.core.voidShot({ player: shot.player, xp: 100000000, balance: 1000, brierDenominator: 1 }, nonce, now);
          processed++;
        }
      }
    }
    return processed;
  }
}

export { SettleRunner };
