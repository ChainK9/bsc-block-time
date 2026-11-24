// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface IBscClockVm {
    function warp(uint256) external;
    function roll(uint256) external;
}

/// @title BscClock
/// @notice Foundry test helper for BNB Smart Chain: moves block.number and block.timestamp together at
/// the real block time. Since Fermi (BEP-619, 2026-01-14) BSC makes a block every 450 ms. vm.warp alone
/// leaves block.number behind and vm.roll alone leaves the clock behind, so a lock counted in blocks
/// can pass a test and still open 6.7 times sooner on chain than its author meant.
/// @dev Assumes 450 ms blocks, which holds from Fermi through Jenner. Wrong for a fork pinned before
/// 2026-01-14: see the fork table in the README.
library BscClock {
    uint256 internal constant BLOCK_MS = 450;
    IBscClockVm private constant VM = IBscClockVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @notice Moves the clock forward `secs` seconds and block.number by the blocks BSC makes in that time.
    function skip(uint256 secs) internal {
        VM.warp(block.timestamp + secs);
        VM.roll(block.number + secs * 1000 / BLOCK_MS);
    }

    /// @notice Moves block.number forward `blocks` blocks and the clock by the time they take, rounded down
    /// to whole seconds (block.timestamp has no milliseconds), so many tiny rolls drift behind the real clock.
    function roll(uint256 blocks) internal {
        VM.roll(block.number + blocks);
        VM.warp(block.timestamp + blocks * BLOCK_MS / 1000);
    }
}
