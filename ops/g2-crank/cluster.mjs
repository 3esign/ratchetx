#!/usr/bin/env node
// THE BOUNDARY, IN CODE RATHER THAN IN A COMMENT.
//
// No agent on this project sends a mainnet transaction. That has been the rule
// all along and it lived in prose, which is where rules go to be broken by
// whoever is in a hurry - I proved that on the receipt rule tonight, having
// written it myself. So this crank cannot reach mainnet: it asks the RPC for its
// genesis hash and REFUSES if the answer is the mainnet one, before it builds an
// instruction, and there is no flag that turns the refusal off.
//
// The check is on the GENESIS HASH, not on the URL. A URL is a string somebody
// can mistype into pointing at mainnet; the genesis hash is what the cluster
// actually is. An unknown genesis is also refused - a cluster nobody recognises
// is not a licence, and "I could not tell" must never resolve to "go ahead".

export const GENESIS = Object.freeze({
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet-beta',
  'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG': 'devnet',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'testnet',
});

export const FORBIDDEN = Object.freeze(['mainnet-beta']);

export class ClusterRefused extends Error {}

// Pure, so the boundary can be tested without a network.
export function classify(genesisHash) {
  const name = GENESIS[genesisHash];
  if (!name)
    return { allowed: false, name: null,
             why: `unknown genesis ${genesisHash}. A cluster nobody recognises is not a licence: this `
                + 'refuses rather than guessing, because "I could not tell" must never mean "go ahead".' };
  if (FORBIDDEN.includes(name))
    return { allowed: false, name,
             why: `this is ${name}. No agent on this project sends a mainnet transaction, and that is not `
                + 'a flag anyone can pass - the first mainnet transaction needs Semir, explicitly, in his '
                + 'own words, from a tool that is not this one.' };
  return { allowed: true, name, why: `${name} is allowed` };
}

export async function assertSendable(connection) {
  let genesis;
  try {
    genesis = await connection.getGenesisHash();
  } catch (cause) {
    // A cluster that will not say what it is does not get sent to.
    throw new ClusterRefused(`could not read the genesis hash, so the cluster is unidentified: ${cause.message}`);
  }
  const verdict = classify(genesis);
  if (!verdict.allowed) throw new ClusterRefused(verdict.why);
  return verdict;
}
