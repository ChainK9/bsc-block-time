// Finds the first block of each BSC fork by binary search on two public RPCs and checks they agree.
// Forks activate on a timestamp, so the block number is not in any config: it has to be looked up.
// Run: node scripts/resolve-forks.mjs   (prints the constants to paste into src/schedule.js)
import { FORKS } from "../src/schedule.js";

const RPCS = ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org"];

async function call(url, method, params) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = await res.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) {
      if (attempt >= 4) throw new Error(`${new URL(url).host} ${method}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

const ts = async (url, n) => Number((await call(url, "eth_getBlockByNumber", ["0x" + n.toString(16), false])).timestamp);

async function firstBlockAtOrAfter(url, time, head) {
  let lo = 0, hi = head; // invariant: ts(hi) >= time, ts(lo) < time
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await ts(url, mid)) >= time) hi = mid; else lo = mid;
  }
  return hi;
}

const out = [];
for (const { name, time, block: tableBlock, ts: tableTs } of FORKS) {
  const row = { name, time, perRpc: [] };
  for (const url of RPCS) {
    const head = Number(await call(url, "eth_blockNumber", []));
    if ((await ts(url, head)) < time) { row.perRpc.push(null); continue; } // fork still in the future
    const block = await firstBlockAtOrAfter(url, time, head);
    row.perRpc.push({ block, ts: await ts(url, block), parentTs: await ts(url, block - 1) });
  }
  const [a, b] = row.perRpc;
  if (!a && !b) row.status = "future";
  else if (a && b && a.block === b.block && a.ts === b.ts) row.status = a.parentTs >= time ? "PARENT-NOT-BEFORE-FORK" : a.block !== tableBlock || a.ts !== tableTs ? "TABLE-MISMATCH" : "agree";
  else row.status = "DISAGREE";
  out.push(row);
  console.log(JSON.stringify({ name, time, status: row.status, block: a?.block ?? null, ts: a?.ts ?? null, parentTs: a?.parentTs ?? null }));
}
if (out.some((r) => !["agree", "future"].includes(r.status))) process.exit(1);
