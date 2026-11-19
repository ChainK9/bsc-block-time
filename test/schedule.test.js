import { test } from "node:test";
import assert from "node:assert/strict";
import { FORKS, ERAS, blockToTime, timeToBlock, spanSeconds, parseDuration, formatDuration, formatDate } from "../src/schedule.js";

const fermi = FORKS.find((f) => f.name === "Fermi");

test("each anchor sits at its fork time (header timestamp within 1 s)", () => {
  for (const f of FORKS.filter((x) => x.block)) {
    assert.ok(f.ts >= f.time && f.ts - f.time <= 1, f.name);
    assert.equal(blockToTime(f.block), f.ts);
  }
});

test("Fermi first block is 2026-01-14 02:30:00 UTC", () => {
  assert.equal(formatDate(blockToTime(fermi.block)), "2026-01-14 02:30:00 UTC");
});

test("a span inside one era uses that era interval", () => {
  assert.equal(spanSeconds(fermi.block, 28800), 28800 * 0.45); // 3 h 36 m
  assert.equal(formatDuration(spanSeconds(fermi.block + 1000, 28800)), "3 h 36 m");
});

test("a span crossing Fermi is split piecewise (750 ms before, 450 ms after)", () => {
  const before = 10_000, after = 20_000;
  const secs = spanSeconds(fermi.block - before, before + after);
  assert.ok(Math.abs(secs - (before * 0.75 + after * 0.45)) < 1e-6);
});

test("a span crossing three forks adds up each era", () => {
  const [, lor, max, fer] = ERAS;
  const secs = spanSeconds(lor.block - 100, fer.block - lor.block + 200);
  const expected = 100 * (ERAS[0].ms / 1000) + (max.block - lor.block) * 1.5 + (fer.block - max.block) * 0.75 + 100 * 0.45;
  assert.ok(Math.abs(secs - expected) < 1e-3);
});

test("timeToBlock inverts blockToTime", () => {
  for (const b of [1_000_000, 48_773_576, 50_000_000, 60_000_000, 75_140_593, 120_000_000]) {
    assert.ok(Math.abs(timeToBlock(blockToTime(b)) - b) <= 1, String(b));
  }
});

test("parseDuration", () => {
  assert.equal(parseDuration("7d"), 604800);
  assert.equal(parseDuration("1y"), 31536000);
  assert.equal(parseDuration("90m"), 5400);
  assert.equal(parseDuration("36h"), 129600);
  assert.equal(parseDuration("1h30m"), 5400);
  assert.equal(parseDuration("2W"), 1209600);
  for (const bad of ["", "d", "7", "7 days", "-1d", "1x"]) assert.throws(() => parseDuration(bad), /duration/, bad);
});

test("formatDuration", () => {
  assert.equal(formatDuration(0), "0 s");
  assert.equal(formatDuration(86400), "1 d");
  assert.equal(formatDuration(12960), "3 h 36 m");
});
