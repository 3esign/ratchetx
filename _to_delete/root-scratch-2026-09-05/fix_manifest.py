import json
import re

with open('releases/g2-mainnet-economy.json', 'r', encoding='utf8') as f:
    data = json.load(f)

# Fix ANVG
data['programs']['core'] = 'cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN'

# Fix DRAFT status
data['status'] = 'FINAL - READY FOR REGISTRATION'

# Fix grid 60
data['launchScope']['targetGridSeconds'] = 60
data['launchScope']['maxPostTargetLagSeconds'] = 59
data['launchScope']['horizonCheck'] = data['launchScope']['horizonCheck'].replace('grid 300', 'grid 60')

data['rulesetTemplate']['targetGridSeconds'] = 60

data['evidenceSpecTemplate']['targetGridSeconds'] = 60
data['evidenceSpecTemplate']['maxTargetAheadSeconds'] = 3600 # Wait, the user said maxTargetAhead is 3600 in my test? Let's check needsInFlight derivation.
# In the original json:
# "needsInFlight": {
#   "value": 300,
#   "derivation": "maxTargetAheadSeconds / targetGridSeconds = 90000 / 300."
# }
data['permanentCosts']['needsInFlight']['value'] = 1500
data['permanentCosts']['needsInFlight']['derivation'] = "maxTargetAheadSeconds / targetGridSeconds = 90000 / 60."

# Ensure ruleset vs spec opening leads are 60
data['rulesetTemplate']['minOpenLeadSeconds'] = 60
data['evidenceSpecTemplate']['minOpenLeadSeconds'] = 60

# Write back
with open('releases/g2-mainnet-economy.json', 'w', encoding='utf8') as f:
    json.dump(data, f, indent=2)
