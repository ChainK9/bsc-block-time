// BSC block-time schedule: the fork table, block <-> time math, and duration parsing.
//
// Sources (bnb-chain/bsc): params/config.go (BSCChainConfig: fork times) and
// consensus/parlia/parlia.go (block interval per fork). Forks activate on a timestamp, so the
// first block of each fork was found by binary search on two public RPCs that agreed
// (scripts/resolve-forks.mjs). `block` and `ts` are that block's number and header timestamp.

export const DEFAULT_MS = 3000; // parlia.go: defaultBlockInterval

export const FORKS = [
  { name: "Lorentz", bep: "BEP-520", time: 1745903100, ms: 1500, block: 48773576, ts: 1745903100 },
  { name: "Maxwell", bep: "BEP-524", time: 1751250600, ms: 750, block: 52337091, ts: 1751250601 },
  { name: "Fermi", bep: "BEP-619", time: 1768357800, ms: 450, block: 75140593, ts: 1768357800 },
  // Later forks keep 450 ms; they are here so the upstream check can tell a new interval from a known fork.
  { name: "Osaka/Mendel", bep: "", time: 1777343400, ms: 450, block: 95090937, ts: 1777343400 },
  { name: "Pasteur", bep: "", time: 1787625000, ms: 450, block: 117920136, ts: 1787625000 },
  // 2026-12-08. BEP-706 adds a millisecond block-time precompile at 0x70; block.timestamp stays in seconds.
  { name: "Jenner", bep: "BEP-706", time: 1796697000, ms: 450, block: null, ts: null },
];

// Block 1 (block 0 carries a placeholder timestamp). Measured on a public RPC.
const GENESIS = { block: 1, ts: 1598671449 };
const LORENTZ = FORKS[0];

// Each era is { block, ts, ms }: from `block` (made at time `ts`) every block takes `ms`.
// Before Lorentz the nominal 3 s is not exact (slots were missed), so that era uses the measured
// average between block 1 and Lorentz. Per-block times there are estimates; see the README for the error.
export const ERAS = [
  { block: GENESIS.block, ts: GENESIS.ts, ms: ((LORENTZ.ts - GENESIS.ts) / (LORENTZ.block - GENESIS.block)) * 1000, average: true },
  ...FORKS.filter((f) => f.block !== null).map((f) => ({ block: f.block, ts: f.ts, ms: f.ms })),
];

const eraOf = (block) => ERAS.findLast((e) => block >= e.block) ?? ERAS[0];

/** Estimated unix time (seconds, fractional) of a block, from the anchors alone. */
export function blockToTime(block) {
  const e = eraOf(block);
  return e.ts + ((block - e.block) * e.ms) / 1000;
}

/** Estimated block number at a unix time (seconds). Inverse of blockToTime. */
export function timeToBlock(time) {
  const e = ERAS.findLast((x) => time >= x.ts) ?? ERAS[0];
  return Math.round(e.block + ((time - e.ts) * 1000) / e.ms);
}

/** Real seconds that `n` blocks take starting at block `from`, crossing fork boundaries piecewise. */
export function spanSeconds(from, n) {
  let block = from, left = n, secs = 0;
  while (left > 0) {
    const e = eraOf(block);
    const next = ERAS.find((x) => x.block > block);
    const inEra = next ? Math.min(left, next.block - block) : left;
    secs += (inEra * e.ms) / 1000;
    block += inEra;
    left -= inEra;
  }
  return secs;
}

/** Interval in ms at a block. */
export const intervalAt = (block) => eraOf(block).ms;

const UNITS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, y: 365 * 86400 };

/** "7d", "1y", "90m", "36h", "1h30m" -> seconds. Throws on anything else. */
export function parseDuration(text) {
  const s = String(text).trim().toLowerCase();
  if (!/^(\d+(\.\d+)?[smhdwy])+$/.test(s)) throw new Error(`cannot read duration "${text}" (try 7d, 36h, 90m, 1y, 1h30m)`);
  let total = 0;
  for (const [, num, unit] of s.matchAll(/(\d+(?:\.\d+)?)([smhdwy])/g)) total += Number(num) * UNITS[unit];
  return total;
}

/** 12960 -> "3 h 36 m". Shows the two largest non-zero units. */
export function formatDuration(secs) {
  const parts = [];
  let rest = Math.round(secs);
  for (const [label, size] of [["y", 31536000], ["d", 86400], ["h", 3600], ["m", 60], ["s", 1]]) {
    const q = Math.floor(rest / size);
    if (q > 0) parts.push(`${q.toLocaleString("en-US")} ${label}`);
    rest -= q * size;
  }
  return parts.slice(0, 2).join(" ") || "0 s";
}

export const formatDate = (secs) => new Date(secs * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
