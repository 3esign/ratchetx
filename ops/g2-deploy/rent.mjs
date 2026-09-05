// What a devnet deployment of the two G2 programs actually costs, in lamports.
//
// Pure arithmetic over MEASURED file sizes. No network, no keys, no chain, and
// nothing here can send anything. It exists so that the deployment step is a
// number somebody checked rather than a surprise at the moment of deploying.
//
// Every constant below is named with what it is, because a magic number in a
// cost calculation is how a deploy fails half-way with a buffer account funded
// and a program account not.

// solana-sdk rent: an account is exempt when it holds
//   (ACCOUNT_STORAGE_OVERHEAD + data_len) * LAMPORTS_PER_BYTE_YEAR * EXEMPTION_YEARS
export const ACCOUNT_STORAGE_OVERHEAD = 128;
export const LAMPORTS_PER_BYTE_YEAR = 3480;
export const EXEMPTION_YEARS = 2;
export const LAMPORTS_PER_SOL = 1_000_000_000;

export const rentExempt = dataLen =>
  (ACCOUNT_STORAGE_OVERHEAD + dataLen) * LAMPORTS_PER_BYTE_YEAR * EXEMPTION_YEARS;

// bpf_loader_upgradeable::UpgradeableLoaderState, serialized sizes.
//   Program        = 4 (enum tag) + 32 (programdata address)              = 36
//   ProgramData    = 4 (enum tag) + 8 (slot) + 1 (option) + 32 (authority) = 45, then the ELF
//   Buffer         = 4 (enum tag) + 1 (option) + 32 (authority)            = 37, then the ELF
export const SIZE_OF_PROGRAM = 36;
export const SIZE_OF_PROGRAMDATA_METADATA = 45;
export const SIZE_OF_BUFFER_METADATA = 37;

export const sizeOfProgramData = elfLen => SIZE_OF_PROGRAMDATA_METADATA + elfLen;
export const sizeOfBuffer = elfLen => SIZE_OF_BUFFER_METADATA + elfLen;

// THE HEADROOM QUESTION, STATED RATHER THAN ASSUMED.
//
// `solana program deploy` allocates programdata for `--max-len` bytes of ELF.
// Without the flag the CLI picks a default, and which default depends on the CLI
// version. That is not a detail: at these sizes the difference between exact fit
// and double is about 7 SOL for the pair, and an exact fit means the FIRST
// upgrade that grows the binary by one byte cannot be deployed in place.
//
// So both are computed and both are reported, and the flag is passed explicitly
// at deploy time rather than trusted. A number that depends on which version of
// a tool somebody has installed is not a measurement.
export function deploymentCost(elfLen, { maxLen = null } = {}) {
  const allocated = maxLen === null ? elfLen : maxLen;
  if (allocated < elfLen) {
    throw new Error(`max-len ${allocated} is smaller than the program's ${elfLen} bytes, `
      + 'so the deploy would be rejected after the buffer was already funded');
  }
  const program = rentExempt(SIZE_OF_PROGRAM);
  const programData = rentExempt(sizeOfProgramData(allocated));
  // The buffer is funded during the deploy and reclaimed when it is consumed, so
  // it is a PEAK requirement rather than a permanent cost. A payer funded only
  // for the permanent part fails part-way through.
  const bufferPeak = rentExempt(sizeOfBuffer(elfLen));
  return {
    elfLen,
    allocatedElfLen: allocated,
    programAccount: program,
    programDataAccount: programData,
    permanent: program + programData,
    bufferPeak,
    peak: program + programData + bufferPeak,
  };
}

export const sol = lamports => (lamports / LAMPORTS_PER_SOL).toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
