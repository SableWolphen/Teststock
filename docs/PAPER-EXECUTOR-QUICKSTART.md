# Paper executor verification

This is a **dry-run safety harness**, not an unattended Robinhood executor.

Run `npm test` to execute the harness tests alongside existing Node tests.

To run the harness against a dispatch snapshot, supply a sanitized broker JSON file containing `unleveragedCash`, `positions` and `orders`:

```sh
node scripts/paper-executor.mjs docs/data/execution-dispatch.json ./broker-snapshot.sanitized.json
```

Example sanitized broker file:

```json
{"unleveragedCash":62,"positions":[],"orders":[]}
```

Do **not** commit actual account identifiers, credentials, tokens, or private broker records.

This harness deliberately returns `NO_ACTION` and never sends brokerage orders. Live automation still requires a supported independent scheduled executor with broker authorization, confirmations, idempotency, reconciliation, and broker-resident protective orders. GitHub must remain intelligence-only.
