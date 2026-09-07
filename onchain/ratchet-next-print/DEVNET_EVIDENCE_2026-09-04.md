# Ratchet Next Print devnet evidence -- 2026-09-04

This is a value-free integration proof. The program moves no RCX, credits or
payout.

## Program

- program id: `5bBHDFMmXQq6PNyrGVdSiKo3xpDvevbueYXZmp48bX4`
- upgrade authority retained for soak:
  `9R17sG7w5b4w4DYkXAGAxDGKM4ktAToum3L31VJgkJUy`
- close-enabled upgrade signature:
  `4ecctEGbjsg9duHVTxWXipZdeBSzSy8suCyBkq1HYHEAe5prPZE6USXfs4Mh4XXRy8ySiAGxTK9PJphZKKKGHiPH`
- local SBF: 187480 bytes, SHA-256
  `e819470d2d068af4c09e02e41d883034c43102c32b12c5453ddbaea14def90ba`
- on-chain ProgramData capacity: 191728 bytes
- verification: the first 187480 dumped bytes equal the local SBF exactly and
  the remaining 4248 bytes are all zero loader padding.

## Official Pyth lifecycle

Source: devnet sponsored SOL PriceUpdateV2 account
`7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE`, owned by the official Pyth
Receiver program.

- Shot: `A4tPsf9dvhvYukRfhi5R6yLHNqATsGZvMfTvYPTMXJ34`
- entry publish time: `1788484123`
- open:
  `SjFCMTFPFUUxDgUbhDiFVqzgpYhxbAnavBNJUpdk5GaYXXNF8KWnmm2ETbpGD1Cr6aDTcw9zEQaeW7qZKqjXwCV`
- no direct successor arrived before the pinned 300-second deadline;
- permissionless timeout:
  `646362imz8bc27KuL2GGF8uuF8nWUXGTcaZGvMyFgnQM8r33Q692z2Ngez6ZzKiRmWMCsQSdn8nAPq5Pxe3mEzAv`
- terminal state: `VOID_TIMEOUT`
- permissionless close:
  `qGDGn9rN2MZJ6oaSRTgTDTB6p6TcHvL4inm18AGShws6GkiGELcvkfhCQVbJRf3zKn4ztBFSG8gtzL31BDMUm77`
- all three signatures independently returned `Finalized`;
- the Shot account returned `AccountNotFound` after close, proving rent cleanup.

The first attempted open was correctly refused as `StaleEntry`; no Shot was
created. The successful run waited for a fresh official print before opening.
Ratchet services, databases and historical price APIs were not used.

This proves integration and fail-closed liveness, not a captured higher/lower
outcome. Devnet Pyth did not publish a successor during the deadline. A future
run must record a real `CAPTURED -> REVEALED -> CLOSED` lifecycle before any
claim that the live happy path is proven.
