// Whether a built transaction may be sent, and what must be true afterwards for
// the send to count as evidence.
//
// This file is pure. It takes facts and returns a decision, so every rule below
// is testable without a network, a key or a chain - which is the only reason any
// of it can be trusted before a deployment exists.
//
// The shape is deliberate. ops/g2-crank/decide.mjs does the same thing for
// settlement: the part that DECIDES is separated from the part that TALKS TO THE
// WORLD, because the talking part cannot be proved until there is a world to
// talk to, and everything else can be proved now.

// A simulation that failed is a transaction that will fail. Sending it anyway
// burns a fee to learn what the simulation already said.
//
// A simulation that was not RUN is not a simulation that passed. This is the
// distinction that six false greens were made of on 2026-09-05: an answer that
// was never computed read as an answer of yes.
export function maySend({ mode, cluster, simulation, payer, hasSigner }) {
  const refuse = reason => ({ send: false, reason });

  if (mode !== 'send' && mode !== 'dry-run') return refuse(`unknown mode ${JSON.stringify(mode)}`);
  if (!cluster || !cluster.name) return refuse('the cluster was not identified, so nothing may be sent');
  if (cluster.name === 'mainnet') {
    return refuse('this tool does not send on mainnet, and there is no flag that changes that. '
      + 'The first mainnet transaction is the owner\'s, in his own words.');
  }
  if (mode === 'dry-run') return { send: false, reason: 'dry run: built and simulated, nothing sent' };
  if (!payer) return refuse('--send requires a fee payer; it is never implicit');
  if (!hasSigner) return refuse('the fee payer has no signer, so this transaction cannot be signed');
  if (simulation === undefined || simulation === null) {
    return refuse('no simulation was run. A simulation that was not run is not a simulation that passed.');
  }
  if (simulation.err) {
    return refuse(`the simulation failed: ${JSON.stringify(simulation.err)}. `
      + 'Sending it would pay a fee to learn what the simulation already said.');
  }
  return { send: true, reason: 'simulated clean on a non-mainnet cluster with an explicit signer' };
}

// WHAT MAKES A SEND EVIDENCE.
//
// A signature proves a transaction was accepted. It does not prove the account
// you meant to write exists, or that it holds what you meant to put there. L1
// asks whether a shot can be SENT; the honest version of that question is
// whether the chain now holds a shot, and only a read-back answers it.
export function sendIsEvidence({ signature, confirmation, account }) {
  const problems = [];
  if (!signature) problems.push('there is no signature');
  if (!confirmation) problems.push('the transaction was never confirmed');
  else if (confirmation.err) problems.push(`the confirmed transaction carries an error: ${JSON.stringify(confirmation.err)}`);
  if (!account) problems.push('the account this was supposed to create or change was not read back');
  else {
    if (!account.exists) problems.push('the account does not exist after a confirmed transaction');
    else {
      if (!(account.dataLen > 0)) problems.push('the account exists but holds no data');
      if (account.discriminatorMatches === false) {
        problems.push('the account\'s first eight bytes are not the discriminator for the type it should be, '
          + 'so something else lives at that address');
      }
      if (account.owner && account.expectedOwner && account.owner !== account.expectedOwner) {
        problems.push(`the account is owned by ${account.owner}, not by ${account.expectedOwner}`);
      }
    }
  }
  return { evidence: problems.length === 0, problems };
}
