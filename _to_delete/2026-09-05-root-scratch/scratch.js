const fs = require('fs');
let rat = fs.readFileSync('releases/g2-mainnet-economy.rationale.md', 'utf8');
rat = rat.replace(/- \*\*maxPostTargetLag\*\*: 30 \(SOL\/BTC\), 120 \(ETH\/BONK\/PUMP\/JUP\/WIF\)\. Evidence: .*/, '- **maxPostTargetLagSeconds**: 30 (SOL/BTC), 120 (ETH/BONK/PUMP/JUP/WIF). Evidence: docs/reviews/cadence/cadence-2026-09-05.summary.json (measured p99 6s for SOL/BTC, 51-52s for others).');
// Also replacing in case the name is maxPostTargetLagSeconds
rat = rat.replace(/- \*\*maxPostTargetLagSeconds\*\*: 30 \(SOL\/BTC\), 120 \(ETH\/BONK\/PUMP\/JUP\/WIF\)\. Evidence: .*/, '- **maxPostTargetLagSeconds**: 30 (SOL/BTC), 120 (ETH/BONK/PUMP/JUP/WIF). Evidence: docs/reviews/cadence/cadence-2026-09-05.summary.json (measured p99 6s for SOL/BTC, 51-52s for others).');
fs.writeFileSync('releases/g2-mainnet-economy.rationale.md', rat);

let json = JSON.parse(fs.readFileSync('releases/g2-mainnet-economy.json', 'utf8'));
json.feeds.forEach(f => {
  let p99 = (f.symbol === 'SOL' || f.symbol === 'BTC') ? '6s over 69 targets' : '51-52s over 70 targets';
  f.maxPostTargetLagSeconds.measured = 'min-capture 100%, p99=' + p99 + ' (docs/reviews/cadence/cadence-2026-09-05.summary.json)';
});
fs.writeFileSync('releases/g2-mainnet-economy.json', JSON.stringify(json, null, 2));

