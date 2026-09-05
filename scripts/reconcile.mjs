import fs from 'node:fs';

function reconcile() {
  if (!fs.existsSync('kv_dump.json')) {
    console.error('Error: kv_dump.json not found. Run dump_kv.mjs first.');
    process.exit(1);
  }

  const dump = JSON.parse(fs.readFileSync('kv_dump.json', 'utf8'));
  const players = dump.players || {};
  const stats = dump.stats || {};

  let totalCredits = 0;
  let totalVaultStaked = 0;
  let totalXp = 0;
  let invalidPlayers = 0;
  
  const cleanBalances = [];

  for (const [wallet, data] of Object.entries(players)) {
    // Validate structural integrity
    if (typeof data.cr !== 'number' || data.cr < 0) {
      console.error(`Invalid credit balance for ${wallet}: ${data.cr}`);
      invalidPlayers++;
    }
    if (typeof data.xp !== 'number' || data.xp < 0) {
      console.error(`Invalid XP for ${wallet}: ${data.xp}`);
      invalidPlayers++;
    }

    let staked = 0;
    if (Array.isArray(data.open)) {
      for (const shot of data.open) {
        if (typeof shot.stake === 'number' && shot.stake > 0) {
          staked += shot.stake;
        }
      }
    }

    totalCredits += data.cr;
    totalVaultStaked += staked;
    totalXp += data.xp;
    
    // We only migrate players who actually have credits, stake, or XP
    if (data.cr > 0 || staked > 0 || data.xp > 0) {
      cleanBalances.push({
        wallet: data.w || wallet,
        cr: data.cr,
        staked: staked,
        xp: data.xp
      });
    }
  }

  console.log('--- RECONCILIATION REPORT ---');
  console.log(`Total Players Scanned: ${Object.keys(players).length}`);
  console.log(`Players with Balances/XP: ${cleanBalances.length}`);
  console.log(`Total Credits Held: ${totalCredits.toLocaleString()}`);
  console.log(`Total Vault Staked (Open Shots): ${totalVaultStaked.toLocaleString()}`);
  console.log(`Total Ecosystem XP: ${totalXp.toLocaleString()}`);
  console.log(`Total Real Burned (from Stats): ${Number(stats.realBurned || 0).toLocaleString()} RCX`);
  
  if (invalidPlayers > 0) {
    console.error(`\nFAILED: Found ${invalidPlayers} invalid player records. Migration halted.`);
    process.exit(1);
  }

  console.log('\nSUCCESS: All player records are valid.');
  
  // Sort deterministically by wallet for the Merkle tree
  cleanBalances.sort((a, b) => a.wallet.localeCompare(b.wallet));
  
  fs.writeFileSync('merkle_balances.json', JSON.stringify(cleanBalances, null, 2));
  console.log('Wrote reconciled eligible balances to merkle_balances.json');
}

reconcile();
