# RFC: Ratchet Seal v3 - The Checkpoint PDA Architecture

## 1. The Core Problems
The current ratchet-seal-v2 has a severe limitation: it stores Pyth Push Oracle prices in a 64-item ring buffer (Clock). 
1. The Ring Buffer Overflow: In a busy market, Pyth pushes updates every 400ms. 64 items is only 25 seconds of history. If players create shots that expire at many different minutes throughout a 24-hour window, the cranker must call checkpoint for each expiry. The program's 64-item ring buffer quickly overflows, deleting the 12:00 checkpoint by 13:00. When the 12:00 shot tries to settle at 14:00, its checkpoint is gone.
2. The Pull Oracle Trap: We cannot simply switch to a Pull Oracle (Hermes) as proposed in v1 drafts. To settle fairly, we need the exact crossing price. The free Hermes /latest endpoint only returns the current price. If the cranker's network lags by 1 second, they miss the 400ms window, the crossing price is gone, and we would have to pay ,500/mo for Pyth Pro Historical Benchmarks to retrieve it. Even worse, if we cache the VAAs on our own server, we centralize the protocol because third-party crankers wouldn't be able to get the VAAs without our API.

## 2. The Solution: Independent Checkpoint PDAs
Instead of a single monolithic 64-item ring buffer, we create an ephemeral PDA for every unique expiry timestamp, entirely driven by the on-chain Pyth Push Oracle.

### How it works:
1. The 25-Second Crank Window: The Pyth Push Oracle inherently holds 64 observations (25 seconds of history) in its own on-chain account. 
2. Permissionless Checkpoint: When a shot expires at time T, a cranker has exactly 25 seconds to submit a create_checkpoint(feed_id, T) instruction.
3. The On-Chain Scan: The program reads the Pyth Push Oracle, scans its 64-item history array, finds the mathematically provable crossing price (prev_publish_time < T <= publish_time), and copies it into a new PDA:
   [b"checkpoint", feed_id, T]
4. Infinite Scalability: Because each checkpoint is a separate PDA, it never gets overwritten by subsequent checkpoints! A shot that expires at 12:00 can settle at 23:00 because the 12:00 Checkpoint PDA is still sitting safely on the blockchain.

## 3. The Rent & Garbage Collection Economics
Creating a PDA costs ~0.001 SOL. If we create a Checkpoint PDA for every minute of the day, that's 1.4 SOL per day locked in rent. We must clean it up.
Similarly, unrevealed Shot PDAs lock 0.002 SOL indefinitely.

### The Self-Cleaning Mechanism
- Shot Revealing: When a player calls reveal, the Shot PDA is closed, and the 0.002 SOL rent is refunded to the player.
- Shot Abandonment: If a player loses, they might abandon the shot. We introduce a grace_period (e.g., 24 hours). After 24 hours, ANYONE can call close_abandoned_shot, which closes the Shot PDA and gives the 0.002 SOL to the caller.
- Checkpoint Garbage Collection: Checkpoint PDAs can be closed by anyone after 24 hours. The 0.001 SOL rent acts as a bounty for cleanup bots. 
- Cost Neutrality: The cranker pays 0.001 SOL to create the Checkpoint PDA. 24 hours later, the cranker's bot calls close_checkpoint and gets their 0.001 SOL back. The protocol costs exactly 0 SOL to run.

## 4. Addressing Synthetic Chronology
Because the program scans the actual Pyth Push Oracle history array and finds the exact prev_publish_time < T <= publish_time boundary, the 'synthetic chronology' bug is completely eliminated. The program relies purely on Pyth's cryptographic timestamps, never its own internal counter.
