// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BscClock} from "../src/BscClock.sol";

// Runs with `forge test`, no fork and no forge-std needed.
contract BscClockTest {
    function test_skip_oneDayIs192000Blocks() public {
        (uint256 t, uint256 n) = (block.timestamp, block.number);
        BscClock.skip(1 days);
        require(block.timestamp == t + 1 days, "clock should move one day");
        require(block.number == n + 192_000, "one day should be 192,000 blocks at 450 ms");
    }

    // The classic "28,800 blocks = one day", written for 3 s blocks.
    function test_roll_28800BlocksIs3h36m() public {
        (uint256 t, uint256 n) = (block.timestamp, block.number);
        BscClock.roll(28_800);
        require(block.number == n + 28_800, "block number should move 28,800");
        require(block.timestamp == t + 3 hours + 36 minutes, "28,800 blocks should take 3 h 36 m");
    }

    function test_roll_roundsDownToWholeSeconds() public {
        uint256 t = block.timestamp;
        BscClock.roll(1); // 0.45 s
        require(block.timestamp == t, "a single block should not move the clock a whole second");
        BscClock.roll(3); // 1.35 s
        require(block.timestamp == t + 1, "three blocks should move the clock one second");
    }
}
