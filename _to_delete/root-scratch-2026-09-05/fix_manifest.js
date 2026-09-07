const fs = require('fs');
let data = JSON.parse(fs.readFileSync('releases/g2-mainnet-economy.json', 'utf8'));

// Fix ANVG
data.programs.core = 'cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN';

// Fix DRAFT status
data.status = 'FINAL - READY FOR REGISTRATION';

// Fix grid 60
data.launchScope.targetGridSeconds = 60;
data.launchScope.maxPostTargetLagSeconds = 59;
data.launchScope.horizonCheck = data.launchScope.horizonCheck.replace('grid 300', 'grid 60');

data.rulesetTemplate.targetGridSeconds = 60;

data.evidenceSpecTemplate.targetGridSeconds = 60;
data.permanentCosts.needsInFlight.value = 1500;
data.permanentCosts.needsInFlight.derivation = "maxTargetAheadSeconds / targetGridSeconds = 90000 / 60.";

data.rulesetTemplate.minOpenLeadSeconds = 60;
data.evidenceSpecTemplate.minOpenLeadSeconds = 60;

fs.writeFileSync('releases/g2-mainnet-economy.json', JSON.stringify(data, null, 2));
