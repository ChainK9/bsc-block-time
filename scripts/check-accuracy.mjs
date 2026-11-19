// Non-circular accuracy check: compares the --offline estimate (anchors only) with the real
// header timestamp of sample blocks in each era. Run: node scripts/check-accuracy.mjs
// Exits 1 if any era's mean error exceeds 0.5% of the time elapsed across that era.
import { createPublicClient, http } from "viem";
import { ERAS, blockToTime } from "../src/schedule.js";

const url = process.env.BSC_RPC || "https://bsc-rpc.publicnode.com";
const client = createPublicClient({ transport: http(url, { retryCount: 4 }) });
const head = Number(await client.getBlockNumber());

// Eras to test: pre-Lorentz (ERAS[0]), Lorentz, Maxwell, Fermi. Later same-interval forks belong to Fermi.
const fermiEnd = head;
const eras = [
  { name: "pre-Lorentz", from: 2_000_000, to: ERAS[1].block - 1 }, // block 1 .. 2M is served by few nodes; start after
  { name: "Lorentz", from: ERAS[1].block, to: ERAS[2].block - 1 },
  { name: "Maxwell", from: ERAS[2].block, to: ERAS[3].block - 1 },
  { name: "Fermi", from: ERAS[3].block, to: fermiEnd },
];
const SAMPLES = 5;
let bad = false;
for (const era of eras) {
  const errs = [];
  for (let i = 0; i < SAMPLES; i++) {
    // Spread across the era, avoiding the exact anchor block (error 0 by construction).
    const n = Math.floor(era.from + ((era.to - era.from) * (i + 0.5)) / SAMPLES);
    const real = Number((await client.getBlock({ blockNumber: BigInt(n) })).timestamp);
    errs.push({ n, err: blockToTime(n) - real, elapsed: real - Number((await client.getBlock({ blockNumber: BigInt(era.from === 2_000_000 ? 1 : era.from) })).timestamp) });
  }
  const maxAbs = Math.max(...errs.map((e) => Math.abs(e.err)));
  const maxPct = Math.max(...errs.map((e) => (Math.abs(e.err) / Math.max(e.elapsed, 1)) * 100));
  console.log(`${era.name.padEnd(12)} max error ${maxAbs.toFixed(1)} s, ${maxPct.toFixed(3)}% of elapsed time since the era's start  [${errs.map((e) => `${e.n}:${e.err.toFixed(1)}s`).join(" ")}]`);
  if (maxPct > 0.5) bad = true;
}
if (bad) { console.error("an era drifts more than 0.5%: the anchors or intervals are wrong"); process.exit(1); }
