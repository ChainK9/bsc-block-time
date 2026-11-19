// Weekly check: fails if bnb-chain/bsc has a mainnet fork time or block interval that FORKS in src/schedule.js lacks.
// A new BEP interval then gets added the week it is scheduled, not after it breaks dates.
// Run: node scripts/check-upstream.mjs
import { FORKS, DEFAULT_MS } from "../src/schedule.js";

const RAW = "https://raw.githubusercontent.com/bnb-chain/bsc/master/";
const get = async (path) => {
  const res = await fetch(RAW + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
};

const [config, parlia] = await Promise.all([get("params/config.go"), get("consensus/parlia/parlia.go")]);

// Fork times: only the mainnet block, BSCChainConfig (the chapel and rialto configs sit next to it).
const start = config.indexOf("BSCChainConfig = &ChainConfig{");
const end = config.indexOf("\n\t}", start);
if (start < 0 || end < 0) throw new Error("could not find BSCChainConfig in params/config.go: the file layout changed, update this script");
const upstreamForks = [...config.slice(start, end).matchAll(/^\s*(\w+)Time:\s*newUint64\((\d+)\)/gm)].map((m) => ({ name: m[1], time: Number(m[2]) }));

// Intervals: constants like `fermiBlockInterval uint64 = 450`, plus the default.
const upstreamIntervals = [...parlia.matchAll(/^\s*(\w*[bB]lockInterval)\s+uint64\s*=\s*(\d+)/gm)].map((m) => ({ name: m[1], ms: Number(m[2]) }));

const known = new Set(FORKS.map((f) => f.time));
const knownMs = new Set([DEFAULT_MS, ...FORKS.map((f) => f.ms)]);
const lorentz = FORKS[0].time;
const problems = [];

// Everything before Lorentz keeps the 3 s default, so only newer forks can change the math.
for (const f of upstreamForks.filter((x) => x.time >= lorentz)) {
  if (!known.has(f.time)) problems.push(`new fork ${f.name}Time=${f.time} (${new Date(f.time * 1000).toISOString()}) is not in FORKS`);
}
for (const i of upstreamIntervals) {
  if (!knownMs.has(i.ms)) problems.push(`new block interval ${i.name}=${i.ms} ms is not in FORKS`);
}
if (upstreamIntervals.length === 0) problems.push("found no *BlockInterval constants in parlia.go: the file layout changed, update this script");
// A fork that has already happened needs its first block resolved (scripts/resolve-forks.mjs).
for (const f of FORKS) if (f.block === null && f.time * 1000 < Date.now()) problems.push(`${f.name} has activated but has no resolved block; run scripts/resolve-forks.mjs`);

console.log(`upstream: ${upstreamForks.filter((x) => x.time >= lorentz).map((f) => f.name).join(", ")}`);
console.log(`intervals: ${upstreamIntervals.map((i) => `${i.name}=${i.ms}`).join(", ")}`);
if (problems.length) {
  console.error("FAIL\n" + problems.map((p) => "  " + p).join("\n"));
  process.exit(1);
}
console.log("ok: the fork table matches bnb-chain/bsc");
