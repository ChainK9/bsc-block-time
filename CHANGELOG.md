# Changelog

## 0.2.0 (2026-11-24)

- `src/BscClock.sol`: a Foundry test helper that moves `block.number` and `block.timestamp` together
  at 450 ms per block (`BscClock.roll(blocks)`, `BscClock.skip(secs)`). One file, no dependencies;
  `forge install ChainK9/bsc-block-time`.
- CI runs its Foundry tests (`forge test`, no network).

## 0.1.0 (2026-11-19)

- First release: `when`, `span`, `blocks` and `scan` for BNB Smart Chain.
- Fork table (Lorentz, Maxwell, Fermi, Osaka/Mendel, Pasteur, Jenner) from `bnb-chain/bsc`, with
  first blocks resolved on two public RPCs (`scripts/resolve-forks.mjs`).
- `scan`: NUMBER opcode walk, EIP-1967 proxies, source search (Etherscan V2 or Sourcify), and block
  getters from the ABI or a built-in dictionary.
- `scripts/check-accuracy.mjs` (anchors against real timestamps) and `scripts/check-upstream.mjs`
  (fork table against `bnb-chain/bsc`, weekly in CI).
