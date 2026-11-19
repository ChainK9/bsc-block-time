// `scan`: does this contract count time in blocks? Bytecode first (no key needed), then source, then getters.
// Everything here is a heuristic: a NUMBER opcode is normal (randomness seeds, reward accrual) and a
// getter's value is only guessed to be a height or a count from its name and size.
import { toFunctionSelector } from "viem";
import { formatDuration, formatDate } from "./schedule.js";

// ---------- bytecode (ported from ChainK9's stripMetadata / codeHasSelector / opcode walk) ----------

export const hex = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));

// Drops solc's CBOR metadata trailer (its length is in the last two bytes) so its hash bytes are never read as opcodes.
export function stripMetadata(code) {
  if (code.length >= 2) {
    const n = (code[code.length - 2] << 8) | code[code.length - 1];
    if (n > 0 && n + 2 <= code.length && (code[code.length - n - 2] & 0xe0) === 0xa0) return code.slice(0, code.length - n - 2);
  }
  return code;
}

// Calls fn(opcode, operandStart, code) for each real opcode: PUSH operands and the metadata trailer are skipped.
function walk(code, fn) {
  code = stripMetadata(code);
  let ended = false;
  let skipping = false;
  for (let i = 0; i < code.length; i++) {
    const op = code[i];
    // After STOP/JUMP/RETURN/REVERT/INVALID/SELFDESTRUCT only a JUMPDEST can be reached again. Anything else
    // is unreachable: constant data some compilers append (e.g. revert strings) or dead code. Skip it up to
    // the next JUMPDEST rather than stopping, so code after a dead stretch in unoptimized contracts still counts.
    if (skipping && op !== 0x5b) continue;
    skipping = false;
    if (ended && op !== 0x5b) { skipping = true; continue; }
    ended = [0x00, 0x56, 0xf3, 0xfd, 0xfe, 0xff].includes(op);
    fn(op, i + 1, code);
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f; // PUSH1..PUSH32
  }
}

/** How many times the NUMBER opcode (0x43) is executable code. */
export function countNumberOpcodes(code) {
  let n = 0;
  walk(code, (op) => { if (op === 0x43) n++; });
  return n;
}

/** True if `selector` (4 bytes) is pushed by PUSH4, the way solc's dispatcher does it. */
export function codeHasSelector(code, selector) {
  let found = false;
  walk(code, (op, at, c) => {
    if (op === 0x63 && !found && c.length >= at + 4) found = selector.every((b, k) => c[at + k] === b);
  });
  return found;
}

// ---------- source ----------

const SOURCE_PATTERNS = [
  /\bblock\.number\b/,
  // Blocks per day, week, 10 days and year at 3 s. 864000 is also 10 days in seconds, so a hit is a lead, not proof.
  /\b(28[_,]?800|201[_,]?600|864[_,]?000|10[_,]?512[_,]?000|10[_,]?368[_,]?000)\b/,
  /\b(blocksPerYear|blocksPerDay|rewardPerBlock|BLOCKS_PER_\w+)\b/i,
];

/** Lines of Solidity that use block.number or well-known block-count constants. Comments are skipped. */
export function findBlockLines(source, limit = 20) {
  const hits = [];
  source.split(/\r?\n/).forEach((text, i) => {
    const line = text.trim();
    if (!line || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) return;
    if (SOURCE_PATTERNS.some((re) => re.test(line))) hits.push({ line: i + 1, text: line.slice(0, 140) });
  });
  return { total: hits.length, hits: hits.slice(0, limit) };
}

// Etherscan returns SourceCode as plain text, as a JSON map of files, or as that map wrapped in a second pair of braces.
export function flattenSource(raw) {
  const s = raw.trim();
  if (!s.startsWith("{")) return s;
  try {
    const json = JSON.parse(s.startsWith("{{") ? s.slice(1, -1) : s);
    const files = json.sources ?? json;
    return Object.values(files).map((f) => f.content ?? "").join("\n");
  } catch {
    return s;
  }
}

export async function fetchSource(address, { etherscanKey, fetchFn = fetch } = {}) {
  if (etherscanKey) {
    const url = `https://api.etherscan.io/v2/api?chainid=56&module=contract&action=getsourcecode&address=${address}&apikey=${etherscanKey}`;
    const r = (await (await fetchFn(url)).json()).result;
    if (Array.isArray(r) && r[0]?.SourceCode) {
      const abi = r[0].ABI?.startsWith("[") ? JSON.parse(r[0].ABI) : null;
      return { from: "Etherscan", name: r[0].ContractName, source: flattenSource(r[0].SourceCode), abi };
    }
    return null; // unverified, or the key was rejected: fall through to "no source"
  }
  const res = await fetchFn(`https://sourcify.dev/server/v2/contract/56/${address}?fields=abi,sources`);
  if (!res.ok) return null;
  const j = await res.json();
  if (!j.sources) return null;
  return { from: "Sourcify", name: null, source: Object.values(j.sources).map((f) => f.content).join("\n"), abi: j.abi ?? null };
}

// ---------- getters ----------

// Common names for "a block height" or "a count of blocks". Keyless mode calls only those whose selector is in the bytecode.
export const BLOCK_GETTERS = [
  "startBlock", "endBlock", "launchBlock", "deadlineBlock", "unlockBlock", "unlockBlocks", "lockBlock", "lockBlocks",
  "lockEndBlock", "rampBlock", "rampBlocks", "cliffBlock", "cliffBlocks", "releaseBlock", "claimBlock", "tradingBlock",
  "tradingStartBlock", "tradingEnabledBlock", "enableBlock", "antiBotBlocks", "antiBotBlock", "protectionBlocks",
  "deadBlocks", "sniperBlocks", "cooldownBlocks", "delayBlocks", "blockDelay", "vestingStartBlock", "vestingEndBlock",
  "vestingBlocks", "bonusEndBlock", "lastRewardBlock", "lastUpdateBlock", "periodFinishBlock", "saleEndBlock",
  "presaleEndBlock", "stakingEndBlock", "deploymentBlock", "creationBlock", "genesisBlock", "rewardPerBlock",
  "tokensPerBlock", "blocksPerYear", "blocksPerDay", "BLOCKS_PER_YEAR", "BLOCKS_PER_DAY", "BLOCKS_PER_EPOCH",
  "DEADLINE_BLOCKS", "epochBlocks",
].map((name) => ({ name, selector: hex(toFunctionSelector(`${name}()`)) }));

const NAME_RE = /block|period|duration|lock|delay|cooldown|vesting|unlock|end|start|deadline|ramp/i;

/** Zero-argument view functions returning one uint whose name looks time-related. */
export function abiGetters(abi) {
  return abi
    .filter((f) => f.type === "function" && ["view", "pure"].includes(f.stateMutability) && f.inputs.length === 0 && f.outputs?.length === 1 && /^uint/.test(f.outputs[0].type) && NAME_RE.test(f.name))
    .map((f) => ({ name: f.name, selector: hex(toFunctionSelector(`${f.name}()`)) }));
}

/** Without an ABI: the dictionary entries whose selector the bytecode contains. */
export const dictionaryGetters = (code) => BLOCK_GETTERS.filter((g) => codeHasSelector(code, g.selector));

// A name ending in "Block" (not "PerBlock") reads as a height; anything above half of today's height is one regardless of name.
const looksLikeHeight = (name, v, head) => (/Block$/.test(name) && !/per/i.test(name)) || v > head / 2n;

/**
 * Call each getter on `address` and describe the value.
 * `dateOf(block)` returns unix seconds for a past or future block.
 */
export async function readGetters(client, address, getters, head, dateOf) {
  const out = [];
  for (const g of getters) {
    let v;
    try {
      const r = await client.call({ to: address, data: "0x" + Buffer.from(g.selector).toString("hex") });
      if (!r.data || r.data.length !== 66) continue;
      v = BigInt(r.data);
    } catch {
      continue; // reverted: not callable in this state
    }
    if (v === 0n) {
      out.push({ name: g.name, value: v, kind: "zero" });
    } else if (looksLikeHeight(g.name, v, head)) {
      const date = v < 2n ** 40n ? await dateOf(Number(v)) : null;
      out.push({ name: g.name, value: v, kind: "height", past: v <= head, date });
    } else {
      const n = Number(v);
      out.push({ name: g.name, value: v, kind: "count", at045: formatDuration((n * 450) / 1000), at3: formatDuration(n * 3) });
    }
  }
  return out;
}

export function describeGetter(g) {
  const v = g.value.toLocaleString("en-US");
  if (g.kind === "zero") return `${g.name}() = 0`;
  if (g.kind === "height") return `${g.name}() = ${v}: a block height, ${g.past ? "reached" : "projected for"} ${g.date ? formatDate(g.date) : "(too large to place)"}`;
  return `${g.name}() = ${v}: a count of blocks, ${g.at045} at 0.45 s (${g.at3} if blocks were still 3 s)`;
}

// ---------- orchestration ----------

// EIP-1967: bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export async function scanContract(client, address, { etherscanKey, fetchFn, head, dateOf }) {
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error(`no contract code at ${address}`);
  const slot = await client.getStorageAt({ address, slot: IMPL_SLOT });
  const implementation = slot && BigInt(slot) !== 0n ? "0x" + slot.slice(-40) : null;
  // Logic lives in the implementation; its storage (and so the getters' values) lives at `address`.
  const logicAddress = implementation ?? address;
  const logic = hex(implementation ? await client.getCode({ address: implementation }) : code);

  let source = null, sourceError = null;
  try {
    source = await fetchSource(logicAddress, { etherscanKey, fetchFn });
  } catch (e) {
    sourceError = e.message;
  }
  const names = new Set();
  const getters = [...(source?.abi ? abiGetters(source.abi) : []), ...dictionaryGetters(logic)].filter((g) => !names.has(g.name) && names.add(g.name));
  return {
    address,
    implementation,
    numberOpcodes: countNumberOpcodes(logic),
    source: source && { from: source.from, name: source.name, ...findBlockLines(source.source) },
    sourceError,
    getters: await readGetters(client, address, getters, head, dateOf),
  };
}
