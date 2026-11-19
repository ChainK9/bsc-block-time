import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, custom, toFunctionSelector, pad, toHex } from "viem";
import { stripMetadata, countNumberOpcodes, codeHasSelector, findBlockLines, flattenSource, abiGetters, dictionaryGetters, readGetters, scanContract, describeGetter, hex } from "../src/scan.js";

const b = (...bytes) => Uint8Array.from(bytes);
// solc-style trailer: a CBOR map (starts 0xa1), then its length in two bytes.
const metadata = (inner) => [...inner, inner.length >> 8, inner.length & 0xff];

test("NUMBER outside PUSH data counts", () => {
  assert.equal(countNumberOpcodes(b(0x43, 0x60, 0x01, 0x43, 0x00)), 2);
});

test("0x43 inside PUSH data does not count", () => {
  assert.equal(countNumberOpcodes(b(0x60, 0x43, 0x61, 0x43, 0x43, 0x7f, ...new Array(32).fill(0x43), 0x00)), 0);
});

test("0x43 inside the metadata trailer does not count", () => {
  const trailer = metadata([0xa1, 0x43, 0x43, 0x43, 0x43, 0x43]);
  assert.equal(countNumberOpcodes(b(0x00, 0x5b, 0x43, 0xfe, ...trailer)), 1); // only the real one
  assert.deepEqual([...stripMetadata(b(0x00, ...trailer))], [0x00]);
});

test("constant data after the code is not read as opcodes", () => {
  // INVALID, then ASCII containing 0x43 ('C'): not a JUMPDEST, so it is data, as in revert-string tails
  assert.equal(countNumberOpcodes(b(0x5b, 0x43, 0xfe, 0x49, 0x43, 0x43)), 1);
});

test("codeHasSelector finds PUSH4 operands only", () => {
  const sel = hex(toFunctionSelector("deadlineBlock()"));
  assert.ok(codeHasSelector(b(0x63, ...sel, 0x14), sel));
  assert.ok(!codeHasSelector(b(0x7f, ...sel, ...new Array(28).fill(0)), sel)); // inside PUSH32 data
  assert.ok(!codeHasSelector(b(0x60, 0x00, ...sel), sel)); // not behind a PUSH4
});

test("source regex finds block.number and block constants, skips comments", () => {
  const src = [
    "// uint x = block.number;",
    "uint public unlock = block.number + 28_800;",
    "uint constant YEAR = 10512000;",
    "uint r = rewardPerBlock * 2;",
    "uint8 decimals = 18;",
    " * block.number in a doc comment",
  ].join("\n");
  const r = findBlockLines(src);
  assert.equal(r.total, 3);
  assert.deepEqual(r.hits.map((h) => h.line), [2, 3, 4]);
});

test("flattenSource handles plain, multi-file JSON and double-brace JSON", () => {
  assert.equal(flattenSource("contract A {}"), "contract A {}");
  const files = { "A.sol": { content: "a" }, "B.sol": { content: "b" } };
  assert.equal(flattenSource(JSON.stringify(files)), "a\nb");
  assert.equal(flattenSource("{" + JSON.stringify({ language: "Solidity", sources: files }) + "}"), "a\nb");
});

test("abiGetters keeps zero-arg uint views with time-like names", () => {
  const f = (name, o = {}) => ({ type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }], ...o });
  const abi = [f("unlockBlock"), f("balance"), f("lockDuration"), f("endTime", { inputs: [{ type: "address" }] }), f("setStart", { stateMutability: "nonpayable" }), f("owner", { outputs: [{ type: "address" }] })];
  assert.deepEqual(abiGetters(abi).map((g) => g.name), ["unlockBlock", "lockDuration"]);
});

// ---- getters through a mocked JSON-RPC transport ----

const HEAD = 118_000_000n;
function mockClient(values, code = "0x") {
  const bySelector = Object.fromEntries(Object.entries(values).map(([name, v]) => [toFunctionSelector(`${name}()`), v]));
  return createPublicClient({
    transport: custom({
      async request({ method, params }) {
        if (method === "eth_call") {
          const v = bySelector[params[0].data.slice(0, 10)];
          if (v === undefined) throw new Error("execution reverted");
          return pad(toHex(v), { size: 32 });
        }
        if (method === "eth_getCode") return code;
        if (method === "eth_getStorageAt") return pad("0x00", { size: 32 });
        throw new Error("unexpected " + method);
      },
    }),
  });
}

test("getter values: a height gets a date, a count gets durations at 0.45 s and 3 s", async () => {
  const names = ["deadlineBlock", "DEADLINE_BLOCKS", "unlockBlocks", "startBlock", "endBlock"];
  const client = mockClient({ deadlineBlock: HEAD + 28_800n, DEADLINE_BLOCKS: 28_800n, startBlock: 0n, endBlock: 9_000_000n });
  const getters = names.map((name) => ({ name, selector: hex(toFunctionSelector(`${name}()`)) }));
  const out = await readGetters(client, "0x0000000000000000000000000000000000000001", getters, HEAD, async (blk) => 1_800_000_000 + (blk - Number(HEAD)) * 0.45);
  const by = Object.fromEntries(out.map((g) => [g.name, g]));
  assert.equal(by.unlockBlocks, undefined); // reverted: skipped
  assert.equal(by.startBlock.kind, "zero");
  assert.equal(by.deadlineBlock.kind, "height");
  assert.equal(by.deadlineBlock.past, false);
  assert.equal(by.deadlineBlock.date, 1_800_000_000 + 28_800 * 0.45);
  assert.equal(by.endBlock.past, true); // named ...Block, so a height even though it is far below the head
  assert.deepEqual([by.DEADLINE_BLOCKS.kind, by.DEADLINE_BLOCKS.at045, by.DEADLINE_BLOCKS.at3], ["count", "3 h 36 m", "1 d"]);
  assert.match(describeGetter(by.DEADLINE_BLOCKS), /28,800.*count of blocks.*3 h 36 m.*1 d/);
});

test("keyless scan calls only dictionary getters whose selector is in the bytecode", async () => {
  const sel = hex(toFunctionSelector("lockBlocks()"));
  const code = "0x" + Buffer.from([0x5b, 0x63, ...sel, 0x14, 0x43, 0x00]).toString("hex");
  assert.deepEqual(dictionaryGetters(hex(code)).map((g) => g.name), ["lockBlocks"]);
  const client = mockClient({ lockBlocks: 201_600n, startBlock: 5n }, code); // startBlock answers but is not in the bytecode
  const r = await scanContract(client, "0x0000000000000000000000000000000000000001", {
    head: HEAD,
    dateOf: async () => 0,
    fetchFn: async () => ({ ok: false }), // Sourcify has nothing
  });
  assert.equal(r.numberOpcodes, 1);
  assert.equal(r.source, null);
  assert.equal(r.getters.length, 1);
  assert.equal(r.getters[0].at045, "1 d 1 h"); // 201,600 x 0.45 s = 25.2 h
  assert.equal(r.getters[0].at3, "7 d");
});
