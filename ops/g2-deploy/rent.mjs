// Funding arithmetic for a fresh loader-v3 deployment with a newly created
// Agave CLI buffer. No transaction is sent here; fees, upgrades, existing
// buffers, and pre-existing program accounts require a separate calculation.

// Historical SDK defaults, retained for explicitly labeled offline estimates.
// They are not a current cluster quote: observed mainnet rent on 2026-09-05
// differed. Use fetchRentQuotes and inject its exact per-size values for funding.
export const ACCOUNT_STORAGE_OVERHEAD = 128;
export const LAMPORTS_PER_BYTE_YEAR = 3480;
export const EXEMPTION_YEARS = 2;
export const LAMPORTS_PER_SOL = 1_000_000_000;

function checkedSize(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function checkedLamports(value, size) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`rent quote for ${size} bytes must be a positive safe integer`);
  }
  return value;
}

export const rentExempt = dataLen => {
  checkedSize(dataLen, 'account data size');
  return checkedLamports((ACCOUNT_STORAGE_OVERHEAD + dataLen)
    * LAMPORTS_PER_BYTE_YEAR * EXEMPTION_YEARS, dataLen);
};

// bpf_loader_upgradeable::UpgradeableLoaderState serialized account sizes.
export const SIZE_OF_PROGRAM = 36;
export const SIZE_OF_PROGRAMDATA_METADATA = 45;
export const SIZE_OF_BUFFER_METADATA = 37;

export const sizeOfProgramData = elfLen => checkedSize(
  SIZE_OF_PROGRAMDATA_METADATA + checkedSize(elfLen, 'allocated ELF size'), 'ProgramData size');
export const sizeOfBuffer = elfLen => checkedSize(
  SIZE_OF_BUFFER_METADATA + checkedSize(elfLen, 'ELF size'), 'buffer size');

// Fetch every requested size or reject. No static fallback, inferred multiplier,
// retry, or partial quote map is returned. The caller owns cluster identification
// and the connection's commitment, and must record those with its funding plan.
export async function fetchRentQuotes(connection, sizes) {
  if (!connection || typeof connection.getMinimumBalanceForRentExemption !== 'function') {
    throw new TypeError('connection.getMinimumBalanceForRentExemption is required');
  }
  if (!Array.isArray(sizes)) throw new TypeError('rent quote sizes must be an array');
  const unique = [...new Set(sizes.map(size => checkedSize(size, 'account data size')))];
  const entries = await Promise.all(unique.map(async size => [size, checkedLamports(
    await connection.getMinimumBalanceForRentExemption(size), size)]));
  return new Map(entries);
}

// Agave v4.2.1 cli/src/program.rs:1425,2556,2614 and
// programs/bpf_loader/src/lib.rs:287-300 establish the funding sequence:
// 1. The CLI funds the buffer with rent(45 + maxLen), including any headroom.
// 2. The final transaction creates the separate 36-byte Program account.
// 3. The loader drains the buffer to the payer BEFORE creating ProgramData.
// The same ProgramData lamports move through the buffer; they are not paid twice.
// Exact capacity and upgrade authority are independent choices. Later growth
// needs a supported ProgramData extension and its additional rent.
export function deploymentCost(elfLen, { maxLen = null, rentForSize = rentExempt } = {}) {
  checkedSize(elfLen, 'ELF size', 1);
  const allocated = maxLen === null ? elfLen : checkedSize(maxLen, 'max-len', 1);
  if (allocated < elfLen) {
    throw new Error(`max-len ${allocated} is smaller than the program's ${elfLen} bytes`);
  }
  const programDataSize = sizeOfProgramData(allocated);
  const bufferSize = sizeOfBuffer(elfLen);
  if (typeof rentForSize !== 'function') throw new TypeError('rentForSize must be a function');
  const quote = size => checkedLamports(rentForSize(size), size);
  const program = quote(SIZE_OF_PROGRAM);
  const programData = quote(programDataSize);
  const bufferRentMinimum = quote(bufferSize);
  const bufferFunding = programData;
  if (bufferFunding < bufferRentMinimum) {
    throw new Error('ProgramData quote cannot fund the buffer rent minimum; obtain consistent rent quotes');
  }
  const permanent = program + programData;
  if (!Number.isSafeInteger(permanent)) throw new RangeError('total deployment lamports exceed safe integer precision');
  return {
    elfLen,
    allocatedElfLen: allocated,
    programAccount: program,
    programDataAccount: programData,
    permanent,
    bufferRentMinimum,
    bufferFunding,
    // Compatibility field: actual CLI buffer funding, not an added peak charge.
    bufferPeak: bufferFunding,
    peak: permanent,
    rentBasis: rentForSize === rentExempt ? 'legacy-static-estimate' : 'provided-quotes',
    feesIncluded: false,
    scope: 'fresh loader-v3 deployment with a newly CLI-funded buffer; excludes fees, upgrades and existing accounts',
  };
}

export const sol = lamports => (lamports / LAMPORTS_PER_SOL).toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
