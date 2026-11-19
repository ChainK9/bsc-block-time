#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createPublicClient, http, isAddress } from "viem";
import { bsc } from "viem/chains";
import { ERAS, blockToTime, timeToBlock, spanSeconds, intervalAt, parseDuration, formatDuration, formatDate } from "../src/schedule.js";
import { scanContract, describeGetter } from "../src/scan.js";

const HELP = `bsc-block-time: BNB Smart Chain block numbers <-> dates, across the 3 s / 1.5 s / 0.75 s / 0.45 s block-time forks

  bsc-block-time when <block>                         date of a block (past: exact from RPC, future: projected)
  bsc-block-time span <blocks> [--from <block|date>]  real duration of N blocks, and what it meant at 3 s
  bsc-block-time blocks <duration>                    how many blocks 7d, 36h, 90m, 1y are, now and at 3 s
  bsc-block-time scan <address>                       does this contract count time in blocks? (bytecode, source, getters)

  --rpc <url>            BSC RPC (default: env BSC_RPC, else a public node)
  --offline              estimate from the built-in fork anchors, no RPC
  --etherscan-key <key>  verified source via Etherscan V2 (default: env ETHERSCAN_API_KEY; else Sourcify)
  --json                 machine-readable output
`;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rpc: { type: "string" }, offline: { type: "boolean" }, from: { type: "string" },
    "etherscan-key": { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" },
  },
});
const [cmd, arg] = positionals;
// || not ??: CI sets BSC_RPC to "" when the repository variable is unset.
const rpcUrl = opt.rpc || process.env.BSC_RPC || "https://bsc-rpc.publicnode.com";
const etherscanKey = opt["etherscan-key"] || process.env.ETHERSCAN_API_KEY || undefined;

// URLs (they can carry API keys) are cut to scheme://host before anything is printed.
const redact = (s) => {
  let out = String(s).replace(/https?:\/\/[^\s"')]+/g, (u) => { try { return new URL(u).origin; } catch { return "[url]"; } });
  if (etherscanKey) out = out.split(etherscanKey).join("[key]");
  return out;
};
const print = (human, json) => console.log(opt.json ? JSON.stringify(json, null, 2) : human);
const client = () => createPublicClient({ chain: bsc, transport: http(rpcUrl, { retryCount: 3 }) });
const num = (v, what) => { if (!/^\d+$/.test(v ?? "")) throw new Error(`${what} must be a whole number`); return Number(v); };
const n = (x) => x.toLocaleString("en-US");
const ESTIMATE = "estimate from the fork anchors; see README for the measured error";

async function head(c) {
  const b = await c.getBlock();
  return { number: Number(b.number), ts: Number(b.timestamp) };
}

async function when() {
  const block = num(arg, "block");
  if (opt.offline) {
    const t = blockToTime(block);
    return print(`block ${n(block)}: ${formatDate(t)}  (${ESTIMATE})`, { block, time: Math.round(t), iso: new Date(t * 1000).toISOString(), source: "estimate" });
  }
  const c = client();
  const h = await head(c);
  let t, source;
  if (block <= h.number) {
    t = Number((await c.getBlock({ blockNumber: BigInt(block) })).timestamp);
    source = "rpc";
  } else {
    t = h.ts + spanSeconds(h.number, block - h.number);
    source = "projection";
  }
  const note = source === "rpc" ? "exact, from the block header" : `projected from block ${n(h.number)} at ${intervalAt(h.number)} ms per block; assumes no interval change after Jenner (2026-12-08)`;
  print(`block ${n(block)}: ${formatDate(t)}  (${note})`, { block, time: t, iso: new Date(t * 1000).toISOString(), source });
}

async function span() {
  const count = num(arg, "block count");
  let from, fromNote;
  if (opt.from) {
    from = /^\d+$/.test(opt.from) ? Number(opt.from) : timeToBlock(Date.parse(opt.from) / 1000);
    if (!Number.isFinite(from)) throw new Error(`cannot read --from "${opt.from}" (a block number or a date like 2025-01-01)`);
    fromNote = `at block ${n(from)}`;
  } else {
    from = opt.offline ? timeToBlock(Date.now() / 1000) : (await head(client())).number;
    fromNote = `at the current head, block ${n(from)}`;
  }
  const real = spanSeconds(from, count);
  const written = count * 3;
  print(
    `${n(count)} blocks starting ${fromNote}\n  real duration: ${formatDuration(real)}\n  written for 3 s blocks this meant ${formatDuration(written)} (${(written / real).toFixed(1)}x longer)`,
    { blocks: count, from, realSeconds: real, at3sSeconds: written },
  );
}

function blocks() {
  const secs = parseDuration(arg);
  const ms = ERAS.at(-1).ms;
  const now = Math.round((secs * 1000) / ms);
  const at3 = Math.round(secs / 3);
  print(`${arg}: ${n(now)} blocks now (${ms} ms per block), ${n(at3)} blocks at 3 s`, { duration: arg, seconds: secs, blocksNow: now, blocksAt3s: at3, intervalMs: ms });
}

async function scan() {
  if (!isAddress(arg ?? "")) throw new Error("scan needs a contract address (0x...)");
  const c = client();
  const h = await head(c);
  const dateOf = async (b) => (b > h.number ? h.ts + spanSeconds(h.number, b - h.number) : Number((await c.getBlock({ blockNumber: BigInt(b) })).timestamp));
  const r = await scanContract(c, arg, { etherscanKey, head: BigInt(h.number), dateOf });
  if (opt.json) return console.log(JSON.stringify(r, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  const out = [`${r.address}${r.implementation ? `  (EIP-1967 proxy, implementation ${r.implementation})` : ""}`];
  out.push(`NUMBER opcode (block.number): ${r.numberOpcodes ? `${r.numberOpcodes} in executable code` : "none in executable code"}`);
  if (r.source) {
    out.push(`Source (${r.source.from}${r.source.name ? `, ${r.source.name}` : ""}): ${r.source.total} line(s) use block.number or a block-count constant`);
    for (const l of r.source.hits) out.push(`  line ${l.line}: ${l.text}`);
  } else {
    const why = r.sourceError ? ` (${redact(r.sourceError)})` : "";
    out.push(`Source: not found${why}.${etherscanKey ? "" : " Sourcify has thin BSC coverage; pass --etherscan-key for BscScan-verified source."}`);
  }
  out.push(r.getters.length ? "Block-related getters:" : "Block-related getters: none found (keyless mode tries ~50 common names whose selector is in the bytecode)");
  for (const g of r.getters) out.push("  " + describeGetter(g));
  out.push("", "Heuristic: block.number is normal in many contracts, and whether a getter holds a height or a count is guessed from its name and size. Read the code before drawing conclusions.");
  console.log(out.join("\n"));
}

try {
  if (opt.help || !cmd) {
    console.log(HELP);
    process.exit(opt.help ? 0 : 1);
  }
  const run = { when, span, blocks, scan }[cmd];
  if (!run) throw new Error(`unknown command "${cmd}"`);
  await run();
} catch (e) {
  const hint = !opt.offline && ["when", "span"].includes(cmd) && /fetch|HTTP|request|timed out/i.test(e.message) ? "\n(try --offline for an estimate without RPC)" : "";
  console.error("error: " + redact((e.shortMessage ?? e.message).split("\n")[0]) + hint);
  process.exit(1);
}
