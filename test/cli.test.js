import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const run = (...args) => spawnSync(process.execPath, ["bin/bsc-block-time.js", ...args], { encoding: "utf8" });

test("blocks 7d --json", () => {
  const j = JSON.parse(run("blocks", "7d", "--json").stdout);
  assert.equal(j.blocksAt3s, 201600);
  assert.equal(j.blocksNow, 1344000);
});

test("span 28800 --from 75140593 is 3 h 36 m, written as 1 d at 3 s (offline)", () => {
  const out = run("span", "28800", "--from", "75140593", "--offline").stdout;
  assert.match(out, /real duration: 3 h 36 m/);
  assert.match(out, /3 s blocks this meant 1 d \(6\.7x longer\)/);
});

test("when --offline labels the result as an estimate", () => {
  assert.match(run("when", "75140593", "--offline").stdout, /2026-01-14 02:30:00 UTC.*estimate/);
});

test("errors never print an RPC URL, only scheme://host", () => {
  const r = run("when", "10", "--rpc", "http://user:SECRET@127.0.0.1:1/path-with-key");
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stderr, /SECRET|path-with-key/);
});

test("bad input exits 1", () => {
  assert.equal(run("blocks", "soon").status, 1);
  assert.equal(run("scan", "nope").status, 1);
});
