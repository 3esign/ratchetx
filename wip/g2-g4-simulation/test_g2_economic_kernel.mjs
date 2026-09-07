import { test } from 'node:test';
import assert from 'node:assert';

const MAX_PESSIMISTIC_XP_PENALTY = 50_000_000;
const PESSIMISTIC_BRIER_DENOMINATOR_PENALTY = 1;

class PlayerLedger {
  constructor(player) {
    this.player = player;
    this.xp = 100_000_000;
    this.hits = 0;
    this.shots = 0;
    this.brierNumerator = 0;
    this.brierDenominator = 0;
    this.balance = 1000;
    this.lastCommandNonce = 0; // G2-07: Prevent replay
  }
}

class GlobalPodium {
  constructor() {
    this.epoch = 0;
    this.topPlayers = [{ player: null, xp: 0 }, { player: null, xp: 0 }, { player: null, xp: 0 }];
  }

  updatePodium(player, xp, currentEpoch) {
    if (currentEpoch > this.epoch) {
      this.epoch = currentEpoch;
      this.topPlayers = [{ player: null, xp: 0 }, { player: null, xp: 0 }, { player: null, xp: 0 }];
    }
    const existingIndex = this.topPlayers.findIndex(p => p.player === player);
    if (existingIndex !== -1) {
      this.topPlayers[existingIndex].xp = xp;
      this.topPlayers.sort((a, b) => b.xp - a.xp);
      return;
    }
    if (xp > this.topPlayers[2].xp) {
      this.topPlayers[2] = { player, xp };
      this.topPlayers.sort((a, b) => b.xp - a.xp);
    }
  }
}

class RatchetCore {
  constructor() {
    this.vault = 0;
    this.shots = new Map();
    this.podium = new GlobalPodium();
    this.currentEpoch = 1;
  }

  reloadTokens(ledger, amount) {
    // G2-06: Simulate Exact token routes
    if (amount <= 0) throw new Error('Invalid reload amount');
    ledger.balance += amount;
  }

  acceptShot(ledger, commandNonce, stake, entryPrice, expiryTs, commitHash) {
    // G2-07: Replay protection
    if (commandNonce <= ledger.lastCommandNonce) throw new Error('Command nonce reused');
    if (stake <= 0) throw new Error('Invalid stake');
    if (ledger.balance < stake) throw new Error('Insufficient funds');

    ledger.balance -= stake;
    this.vault += stake;
    ledger.lastCommandNonce = commandNonce;

    const shot = {
      player: ledger.player,
      commandNonce,
      stake,
      entryPrice,
      expiryTs,
      commitHash,
      status: 'Open',
      checkpointedPrice: null
    };
    this.shots.set(commandNonce, shot);

    ledger.xp = Math.max(0, ledger.xp - MAX_PESSIMISTIC_XP_PENALTY);
    ledger.brierDenominator += PESSIMISTIC_BRIER_DENOMINATOR_PENALTY;
    return shot;
  }

  settleShot(ledger, commandNonce, side, probabilityE5, checkpointedPrice, salt) {
    const shot = this.shots.get(commandNonce);
    if (!shot || shot.status !== 'Open') throw new Error('Invalid state');
    shot.checkpointedPrice = checkpointedPrice;

    if (checkpointedPrice === shot.entryPrice) return this.voidInternal(ledger, shot);

    const outcomeYes = checkpointedPrice > shot.entryPrice;
    const hit = (side === 1) === outcomeYes;

    shot.status = 'Settled';
    const actualXp = hit ? 10_000_000 : 0;
    ledger.xp += MAX_PESSIMISTIC_XP_PENALTY + actualXp;
    ledger.shots += 1;

    if (hit) {
      ledger.hits += 1;
      const payout = Math.floor(shot.stake * 1.7);
      this.vault -= payout;
      ledger.balance += payout;
    }

    if (this.currentEpoch > this.podium.epoch || ledger.xp > this.podium.topPlayers[2].xp) {
      this.podium.updatePodium(ledger.player, ledger.xp, this.currentEpoch);
    }
    return hit;
  }

  voidInternal(ledger, shot) {
    shot.status = 'Voided';
    this.vault -= shot.stake;
    ledger.balance += shot.stake;
    ledger.xp += MAX_PESSIMISTIC_XP_PENALTY;
    ledger.brierDenominator -= PESSIMISTIC_BRIER_DENOMINATOR_PENALTY;
    return "VOID";
  }
}

test('G2 Economic Kernel: G2-06 & G2-07', async (t) => {
  const core = new RatchetCore();

  await t.test('G2-06: Reload and token routes', () => {
    const ledger = new PlayerLedger('player1');
    const initBal = ledger.balance;
    core.reloadTokens(ledger, 500);
    assert.strictEqual(ledger.balance, initBal + 500);
  });

  await t.test('G2-07: Monotonic Nonce prevents replay attacks', () => {
    const ledger = new PlayerLedger('player2');
    core.acceptShot(ledger, 1, 100, 105, 1000, 'hash1');
    
    // Same nonce blocked
    assert.throws(() => core.acceptShot(ledger, 1, 100, 105, 1000, 'hash1'), /Command nonce reused/);
    
    // Lower nonce blocked
    assert.throws(() => core.acceptShot(ledger, 0, 100, 105, 1000, 'hash1'), /Command nonce reused/);

    // Higher nonce allowed
    core.acceptShot(ledger, 2, 100, 105, 1000, 'hash2');
  });
});
