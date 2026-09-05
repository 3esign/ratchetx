import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const kv = require('../lib/kv.js');

async function dump() {
  console.log(`Connected to backend: ${kv.backend}`);
  
  const players = {};
  console.log('Scanning for u:* keys...');
  const keys = await kv.scanKeys('u:*');
  console.log(`Found ${keys.length} player records. Fetching...`);
  
  for (let i = 0; i < keys.length; i += 200) {
    const batchKeys = keys.slice(i, i + 200);
    const batchVals = await kv.getManyJSON(batchKeys);
    
    for (let j = 0; j < batchKeys.length; j++) {
      const k = batchKeys[j];
      const p = batchVals[j];
      if (p) {
        players[k.slice(2)] = {
          cr: p.cr || 0,
          xp: p.xp || 0,
          w: p.w,
          open: (p.open || []).map(({ side, salt, xp, sp, ...rest }) => rest)
        };
      }
    }
    process.stdout.write(`\rFetched ${Math.min(i + 200, keys.length)} / ${keys.length}`);
  }
  console.log('\n');

  const stats = (await kv.hall('h:stats')) || {};
  if (!Object.keys(stats).length) {
    const legacy = await kv.getJSON('g:stats');
    if (legacy) Object.assign(stats, legacy);
  }
  
  const dump = {
    timestamp: Date.now(),
    backend: kv.backend,
    stats,
    players
  };

  fs.writeFileSync('kv_dump.json', JSON.stringify(dump, null, 2));
  console.log(`Successfully wrote ${Object.keys(players).length} players to kv_dump.json.`);
  process.exit(0);
}

dump().catch(err => {
  console.error(err);
  process.exit(1);
});
