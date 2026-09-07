# Next Print v2 devnet evidence — 2026-09-04

Program: `2TV2zagBZaDXXYjduLrRbiDGGsR8jXNqYAuLDE4j4tyR`  
SBF SHA-256: `01bab651f511cd72c480c432425c1bb343c91ab17f4df63c5ffdac1a8b0d52cc`
Ruleset SHA-256: `78b15cfe2ac9f4c69f60d42a65b544f143ea9a253efbde2f890a26549a15b3f0`

## Deployment

- audited upgrade signature: `3D9kBSTu9H6TqjitGhjuNTuY4uy8botnULJ5m1T1cy5qqdcZ2opKRMw5iL9QuM5d6ZpeqU4WkFYPnVrqgHg57M6B`
- slot: `492867556`
- ProgramData: `ELapjd76gKGPyRtYc6cVRaJA1qAcp8ni5NBsiPME2mbd`
- upgrade authority retained during soak: `9R17sG7w5b4w4DYkXAGAxDGKM4ktAToum3L31VJgkJUy`
- the first 217,040 dumped bytes matched the local SBF hash exactly
- the remaining 10,200 allocated ProgramData bytes were all zero

## Official-Pyth lifecycle

The runner read the official sponsored SOL PriceUpdateV2 account directly. It used no Ratchet API, historical API, database or private oracle feed.

```text
OPEN -> VOID_TIMEOUT -> WRITE_COMPLETION_RECEIPT -> CLOSE_SHOT
```

- open signature: `2fQnwQbysnLnQ5AAtib7sTWEjbeZJANqJSCSFVYDmUn9ekzVtADsNeRJtY2xeocgyWM6iXymuFExWKRDhjL1dinN`
- timeout signature: `NxLttEZ6ZWMwW3D5fNMRA8RLzH54opbJLd7AqHYDdMPcQQLKAQT7r9wZauPL386PaR5Wx3ukSA9eaR7yMCwRaG5`
- receipt signature: `3zgyoJoPMidhb5pAdrjQ834QWv8pGepmXbK56tRJd35YYrpgQ9nb1yWNcY85xuxvgDqDdK5DYJaCxaLXTiVcs6W8`
- close signature: `3GJsv1btnr2NFh8q9anvE7EBgANFP53m97bevhQfarYJeKYRBUkSuiRGzjw6WkKwB5ePoMvF5KwE3jNwKivqzAeN`
- player: `9R17sG7w5b4w4DYkXAGAxDGKM4ktAToum3L31VJgkJUy`
- entry publish time: `1788500122`
- timeout slot: `492871770`
- closed Shot: `32zN6d1vjN47aisNa7Du7GfrH5r6y3w8VZHK78KFNhcY`
- durable receipt: `Gd1GdHsAmnvacsfHTupLZVK1m5mgL4RUqRHSEF1MbMsq`
- disposition: `2` (`Nonpayable`)
- worker: system/default pubkey
- result hash: `536c9b268841ddee192cecbdcbc61615c8c00dfdf4908348d2e9deb9e2fa18fc`

The Shot account is closed and its rent returned to the recorded player. The 125-byte completion receipt remains rent-exempt and owned by v2.

## Clock and commitment findings

The first recovery attempt used workstation wall time and reached timeout slightly before Solana's onchain clock. V2 rejected it with `DeadlineOpen`. No state changed. The checked-in runners now poll cluster slot/block time and retry only that exact early-deadline condition.

The post-upgrade runner then awaited timeout at `processed` but simulated its
dependent receipt transaction at `confirmed`. That older confirmed bank still
saw the Shot as OPEN and correctly rejected receipt creation. Once timeout
reached confirmation, the permissionless recovery runner wrote the receipt and
closed the Shot without a program change. The checked-in smoke runner now waits
at coherent `confirmed` commitment for every dependent lifecycle transaction.

## Honest limits

- No direct successor appeared during this Shot, so this run is not a public CAPTURED proof.
- The exact RCX mint is absent from devnet, so there is no public devnet RCX Work Market claim. The exact-SBF LiteSVM suite proves both nonzero payable and refund paths instead.
- V2 is upgradeable during soak and is not yet canonical production play.
