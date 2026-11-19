# Security

`bsc-block-time` is a read-only tool. It sends JSON-RPC reads (`eth_getBlock`, `eth_getCode`,
`eth_call`, `eth_getStorageAt`) to the RPC you choose and, for `scan`, one request to Etherscan or
Sourcify. It never signs or sends a transaction and never holds a key.

- **RPC URLs and API keys** often embed secrets. Output and error messages cut URLs to
  scheme://host and hide the Etherscan key. If you find a path where one leaks, report it.
- **Getter calls** run `eth_call` against the contract you point it at. They do not change state.
- **Results are heuristics.** A clean `scan` does not mean a contract is safe, and a hit does not
  mean it is broken. See the README's limits.
- The fork table is maintained by hand from `bnb-chain/bsc`. If a date is wrong because a fork or
  interval is missing, that is a bug: open an issue.

## Reporting

- Bugs and wrong dates: open an issue.
- Anything you would rather not post publicly: email hello@chaink9.com.

Never put RPC URLs with API keys in issues, logs or pull requests.
