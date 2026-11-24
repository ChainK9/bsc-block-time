# bsc-block-time

Find out when a BNB Smart Chain block really happens, and which contracts still count time with the
old block speed.

BSC used to make a block every 3 seconds. Since January 2026 it makes one every 0.45 seconds. A lock
written as "28,800 blocks, one day" now opens after 3 hours 36 minutes. This tool turns block numbers
into dates across every speed change, and scans a contract for time counted in blocks.

```bash
npx bsc-block-time when 140000000      # what date is that block?
npx bsc-block-time span 28800          # how long is 28,800 blocks today?
npx bsc-block-time scan 0xContract     # does this contract count time in blocks?
```

Made by [ChainK9](https://chaink9.com). Sibling tools:
[bsc-honeypot-benchmark](https://github.com/ChainK9/bsc-honeypot-benchmark) (fake scam tokens for testing
scanners) and [bsc-lp-lock-checker](https://github.com/ChainK9/bsc-lp-lock-checker).

## Why

BSC's block time has changed three times: 3 s, then 1.5 s (Lorentz, BEP-520), 0.75 s (Maxwell,
BEP-524) and 0.45 s (Fermi, BEP-619). A contract that counts time in blocks, such as a vesting
schedule, a lock, rewards per block, an anti-bot window or "28,800 blocks = 1 day", now runs 6.7
times faster than its author wrote it. Venus had to redeploy for this twice.

Nothing flags it. Slither, Aderyn, Solhint and Mythril have no rule for it, and block-to-date
converters assume a fixed 3 s. `bsc-block-time` knows the schedule, converts across the forks, and
checks a deployed contract for block-counted time.

## Who uses it, and how

- **Holders and traders.** "The lock ends at block 140,000,000" or "vesting runs 2,592,000 blocks":
  `bsc-block-time when` and `bsc-block-time span` say when that really is on today's BSC, not at 3 s.
- **Developers and auditors.** `bsc-block-time scan <address>` before trusting or integrating a contract:
  does it read `block.number`, and which of its stored block counts or heights now mean something
  very different?
- **Protocol teams.** Recompute blocks-per-day and blocks-per-year constants (rewards, interest,
  governance periods) for the current block time, and see what the old ones mean now.
- **Analysts and governance readers.** Turn block heights in proposals, timelocks and dashboards into
  real dates, including future blocks, with the assumption stated.
- **Anyone tracking BSC upgrades.** A weekly CI job compares the fork table with `bnb-chain/bsc`, so a
  new block-time change is added the week it is scheduled.

## Quick start

Node 20 or newer. One dependency ([viem](https://viem.sh)).

```bash
npx bsc-block-time when 35000000
npx bsc-block-time span 28800
npx bsc-block-time blocks 30d
npx bsc-block-time scan 0xContract
```

Add `--json` for machine-readable output. `--rpc <url>` or the `BSC_RPC` environment variable picks
the node (default: a public one). RPC URLs never appear in output or errors, only scheme://host.

### when

```
$ bsc-block-time when 35000000
block 35,000,000: 2024-01-06 06:19:56 UTC  (exact, from the block header)

$ bsc-block-time when 200000000
block 200,000,000: 2027-10-26 15:32:51 UTC  (projected from block 134,294,412 at 450 ms per block; assumes no interval change after Jenner (2026-12-08))
```

Past blocks come from the node's header. Future blocks are projected from the head at the current
interval. `--offline` estimates from the built-in fork anchors and says so.

### span

How long N blocks really take, crossing fork boundaries piece by piece, and what the author meant.

```
$ bsc-block-time span 28800 --from 75140593
28,800 blocks starting at block 75,140,593
  real duration: 3 h 36 m
  written for 3 s blocks this meant 1 d (6.7x longer)
```

`--from` takes a block number or a date (`2026-01-14`). Without it, the current head is used.

### blocks

```
$ bsc-block-time blocks 1y
1y: 70,080,000 blocks now (450 ms per block), 10,512,000 blocks at 3 s
```

Durations: `90m`, `36h`, `7d`, `2w`, `1y`, `1h30m`.

### scan

```
bsc-block-time scan <address> [--etherscan-key <key>]
```

1. Reads the contract's code and follows an EIP-1967 proxy to its implementation.
2. Counts the `NUMBER` opcode (`block.number`) in executable code, ignoring PUSH data and the
   Solidity metadata trailer.
3. Finds source. With `--etherscan-key` (or `ETHERSCAN_API_KEY`) it asks the Etherscan V2 API
   (chain 56); without a key it asks Sourcify, whose BSC coverage is thin. It prints the lines that
   use `block.number` or constants like 28800, 201600, 864000, 10512000, `blocksPerYear`,
   `rewardPerBlock` and `BLOCKS_PER_*`.
4. Reads block-related getters. With an ABI: zero-argument view functions whose name matches
   block, period, duration, lock, delay, cooldown, vesting, unlock, end, start, deadline or ramp.
   Without one: a built-in dictionary of about 50 common names (`startBlock()`, `lockBlocks()`,
   `deadlineBlock()`, `rewardPerBlock()`...), each called only if its selector is in the bytecode.
   A value that looks like a block height gets a date; a smaller one is a count and gets its
   duration at 0.45 s and at 3 s.

Example, on `BlockDeadlineHoneypotTrap` from [bsc-honeypot-benchmark](https://github.com/ChainK9/bsc-honeypot-benchmark)
deployed on a local Anvil fork of BSC (a test token whose sells revert after 28,800 blocks, written
as "one day"):

```
$ bsc-block-time scan 0x907ab5e1b24289ebc05331966352a38b15903128 --rpc http://127.0.0.1:8545
NUMBER opcode (block.number): 1 in executable code
Source: not found. Sourcify has thin BSC coverage; pass --etherscan-key for BscScan-verified source.
Block-related getters:
  launchBlock() = 134,294,862: a block height, reached 2026-11-18 10:24:19 UTC
  deadlineBlock() = 134,323,662: a block height, projected for 2026-11-18 14:00:19 UTC
  DEADLINE_BLOCKS() = 28,800: a count of blocks, 3 h 36 m at 0.45 s (1 d if blocks were still 3 s)
```

### BscClock.sol, for Foundry tests

`vm.warp` moves the clock and leaves `block.number` where it was; `vm.roll` does the opposite. A test
of a lock counted in blocks can then pass while the lock opens 6.7 times sooner on chain.
`BscClock` moves both together at 450 ms per block.

```bash
forge install ChainK9/bsc-block-time
```

```solidity
import {BscClock} from "bsc-block-time/BscClock.sol";

BscClock.roll(28_800);   // 28,800 blocks: block.timestamp moves 3 h 36 m, not a day
BscClock.skip(1 days);   // one day: block.number moves 192,000
```

It is one file with no dependencies (not even forge-std), so copying `src/BscClock.sol` works too.
`roll` rounds the time down to whole seconds, because `block.timestamp` has none.

## The fork table

Fork times come from `bnb-chain/bsc`: `params/config.go` (`BSCChainConfig`) and
`consensus/parlia/parlia.go` (block intervals). Forks activate on a timestamp, so the first block of
each was found by binary search on two public RPCs (`bsc-rpc.publicnode.com` and
`bsc-dataseed.bnbchain.org`), which agreed on every block. Each anchor's parent block is before the
fork time. Reproduce with `node scripts/resolve-forks.mjs`.

| Fork | BEP | Activation (UTC) | First block | Block time |
|---|---|---|---|---|
| (genesis) | | 2020-08-29 | 1 | 3 s nominal, 3.019 s measured average |
| Lorentz | BEP-520 | 2025-04-29 05:05:00 | 48,773,576 | 1.5 s |
| Maxwell | BEP-524 | 2025-06-30 02:30:00 | 52,337,091 | 0.75 s |
| Fermi | BEP-619 | 2026-01-14 02:30:00 | 75,140,593 | 0.45 s |
| Osaka/Mendel | | 2026-04-28 02:30:00 | 95,090,937 | 0.45 s |
| Pasteur | | 2026-08-25 02:30:00 | 117,920,136 | 0.45 s |
| Jenner | BEP-706 | 2026-12-08 02:30:00 | not yet | 0.45 s |

Jenner adds a millisecond block-time precompile at `0x70`; `block.timestamp` stays in seconds.
Output assumes no interval change after Jenner.

## How accurate is the offline estimate?

`node scripts/check-accuracy.mjs` takes 5 sample blocks per era and compares the `--offline`
estimate with the real header timestamp from an RPC. Measured 2026-11-18:

| Era | Largest error | As a share of the time elapsed since the era's start |
|---|---|---|
| pre-Lorentz (3 s) | 2.8 days | 0.34% |
| Lorentz | 26 min | 0.06% |
| Maxwell | 71 min | 0.03% |
| Fermi | 2.3 hours | 0.08% |

Real blocks come a little slower than the nominal interval (missed slots), so estimates run early.
The check fails if an era drifts more than 0.5%, which would mean wrong anchors. Past blocks without
`--offline` are exact, and future ones are projected from the live head, so they carry no
accumulated drift beyond the projection distance.

## Honest limits

- `scan` is a heuristic. `block.number` appears in many safe contracts (reward accrual, randomness
  seeds, ordering). A hit is a lead for a human to read, not a finding.
- Getter values are guessed to be a height or a count from the name and size. A getter outside the
  dictionary or the ABI is not seen. Contracts with no public getter for their block constants
  can only be found through source.
- The opcode walk is linear. It skips PUSH data, the metadata trailer and constant data after a
  terminating instruction, but unusual compilers or hand-written bytecode can fool it.
- Future dates assume the current interval holds. A new BEP interval changes them; the weekly CI
  check exists to catch a new interval the week it is scheduled.
- Pre-Lorentz dates are estimates (up to about 3 days off for old blocks) unless you ask the RPC,
  and public nodes may not serve very old state.
- `BscClock.sol` uses 450 ms for every block. That is right for a fork of BSC after Fermi
  (2026-01-14), wrong for a fork pinned earlier.
- BSC only. No Ethereum or other chains.

## Roadmap

- Weekly CI check against `bnb-chain/bsc` (`scripts/check-upstream.mjs`, already here): a new fork or
  block interval fails the job, and the table is updated the week it is scheduled.
- Jenner (2026-12-08): a release that week. Millisecond block times where the header has them, and a
  note for contracts that call the `0x70` precompile.
- A growing dictionary of getters and constants from real contracts.
- A survey of recent BSC tokens that read `block.number`, published as a dated report.
- `--sarif` output and a GitHub Action, to run `scan` in your CI.

See [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
npm ci
node --test                          # offline, no network
node scripts/check-accuracy.mjs      # network: anchors against real timestamps
node scripts/check-upstream.mjs      # network: fork table against bnb-chain/bsc
forge test                           # BscClock.sol (Foundry, no network)
```

MIT licensed. [chaink9.com](https://chaink9.com) checks tokens on BSC, Ethereum and Base by forking
the chain and trading them.
