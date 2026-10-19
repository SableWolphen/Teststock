# Protection verification and live acceptance

Teststock identifies candidates and publishes decision packets. The current broker tool contract requires user-specified order parameters and an explicitly confirmed preview. A generated candidate is decision support, not user confirmation, an order or a verified fill. Historical automatic buys do not attest that the current executor can submit and protect a new position. The live deployment lock remains disabled.

## Read-only coverage audit

Run `node scripts/verify-protection-readiness.mjs --state-dir <absolute-private-runtime>` or use `installation.json`'s `protectionAudit` path. The command reads the existing private monitor snapshot and current status, then atomically saves `protection-readiness.json`. Exit 2 means an audit completed with blockers; exit 1 means the audit itself failed. Stdout contains counts and fixed blocker codes; holdings and contract identities stay in the private report. Do not upload that report to GitHub.

The audit:

- Requires broker snapshots and current monitor status within 30 seconds, successful current position/order reads and exactly matching reconciliation timestamps. A retained snapshot cannot substitute for a failed current cycle.
- Assesses both stock and long, whole-contract option holdings. Unknown quantities or pending broker state cannot be treated as zero.
- Checks the full set of related working orders. Multiple stops, simultaneous stop and exit, unknown states, opening sells, working entries, multi-leg structures and quantity mismatches cannot be silently reduced to a single apparently matching stop.
- Requires confirmed broker-resident stop identity, remaining quantity, session scope, validity and stop prices. Stop-limit coverage needs an explicit positive limit at or below the sell stop. A matching stop is an observation, not a guarantee of execution or fill price.
- Escalates options pending assignment/exercise/expiration, expiring today, unknown expiry, unsupported short/fractional contracts and unmatched pending sells. A recognized pending sell must reconcile with the known closing order.
- Keeps regular-hours coverage unverified when the broker/data clock reports a closed session. It never substitutes a stale quote or midpoint for an executable exit.
- Leaves advanced-order coverage, crypto protection, actual automated execution and user alert receipt as explicit separate gates. An empty standard-order list does not prove no advanced orders exist.

The monitor emits only protection counts and codes in `status.json`. `READ_ONLY_HEALTHY` means supported reads succeeded; `protection` is separate. The watchdog records local incidents for unverified holding protection, options expiration and crypto protection, without copying holding identities into alert messages. File creation is not proof of a user receiving an alert.

`run-shadow-readiness.mjs` uses the same audit rather than selecting only the first equity stop. The monitor timestamps completed cycles separately from `cycleStartedAt` and targets a non-overlapping 30-second start-to-start cadence. Slow broker calls can still prevent that cadence; passing a heartbeat is not a real-time protection guarantee.

## Stable Windows runtime

The installer packages ten fixed read-only modules into a content-hashed private bundle. The scheduled action and start script use the bundle path, independently of future checkout or branch changes. Credentials, journals and the order executor are excluded. Existing content under a bundle hash is integrity-checked rather than overwritten. Corruption fails installation. Reinstalling records a new version when source changes; prior bundles remain available for rollback.

## Remaining go-live evidence

| Gate | Required evidence |
| --- | --- |
| Broker order coverage | Supported reader for every in-scope order, including advanced/OCO relationships, or broker-supported isolation that proves such orders cannot conflict. Never infer absence from an unavailable API. |
| Current protection | Reconciled broker-resident protection for actual filled quantity and the intended trading session; no ambiguous or conflicting sell state. |
| Controlled execution | Exact user-specified test order, reviewed broker preview and its required confirmation, followed by broker-confirmed fills, protection creation, cancellation/replacement safety, exit and final reconciliation. A read, preview or historical fill is insufficient. |
| Strategy | Independent forward evidence satisfying canonical samples, trading days and after-cost profitability. Software tests and manually selected test trades cannot admit a strategy. |
| Operations | Observed credential expiry, network interruption, restart, kill-switch and alert-delivery/receipt under the intended schedule. Local incident logs are insufficient for receipt. |
| Live release | Supported executor wiring and reviewed release only after the above evidence exists. The Windows reader never acquires write access. |

No verification trade is fabricated to meet a deadline or an income target. An unavailable bid, pending expiration or a closed session cannot be fixed by relaxing checks.
