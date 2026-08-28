# RatchetX Solana Agent Registry identity

RatchetX has one live ERC-8004-compatible identity on Solana mainnet.

| Field | Value |
| --- | --- |
| Indexer Agent ID | 1475 |
| Canonical agent asset | Auj5yXbsaeQUJpYpSRugkgRE3ABc76uqmUe3Vz7fxqCu |
| Owner and creator | HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM |
| Registry program | 8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ |
| Registration URI | https://ratchetx.xyz/agent-registration.json |
| Domain proof | https://ratchetx.xyz/.well-known/agent-registration.json |
| 8004market | https://8004market.io/agent/solana/mainnet-beta/1475 |
| Official MCP Registry | io.github.3esign/ratchet |

The canonical identity is the agent asset pubkey. Agent ID 1475 is the
indexer's sequential display identifier, not a replacement for that asset.
The registration file therefore uses the asset pubkey as registrations.agentId
and the Solana mainnet CAIP-2 chain plus registry program as agentRegistry.

## Mainnet evidence

The original mint transaction is:

4tTed42wpgB57npSBHcjGxXZ3m6GXZ9cGbtbt3ZSJmmpDxDHbGf9Prbuhk9hXmTFDKJNtPYHLDFhrwPzaP2hyZfF

The URI correction transaction is:

4za2w3BwCs1bC5QhvkXAKeP22zYN4Wd87atgM5ZfbyyV5tphwUG6YX8h1nxLWotYsLz5j6RydPuR46EkF1A4QGoT

Both were finalized on Solana mainnet. The correction changed only the existing
asset's URI. It did not mint, transfer, enable ATOM, join a collection, or make a
payment. The official indexer then resolved the live URL as RatchetX with the
expected description, image, MCP endpoint, seven public MCP tools, OASF skills
and x402 support. The same remote is independently discoverable in the official
MCP Registry as `io.github.3esign/ratchet`.

## Studio form pitfall

The Agent Studio registration form accepts profile fields; it is not a generic
metadata-URI import box. Pasting a URL into the name field can cause Studio to
upload a new IPFS document whose literal name is that URL, leaving the agent
with an empty description and no services.

After every mint, immediately fetch the stored agent URI and inspect the JSON.
If the asset and owner are correct but the URI payload is wrong, update that
same asset with setAgentUri. Do not remint. A repair UI should bind the owner,
asset, program and target URI; reject every unrelated instruction; and allow
only wallet-injected zero-key Compute Budget instructions around the one
registry update.

Registry identity proves provenance and continuity. It does not prove forecast
quality, satisfy RatchetX entry requirements, or alter score and rank.
