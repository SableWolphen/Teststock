# Supported broker observations and private execution review

The Python engine uses the installed supported Robinhood read-only connection. It does not use robin_stocks, username/password/TOTP login, PyGithub, or a separate broker session. Python needs only its standard library. GitHub stays intelligence-only; actual broker review, confirmation, placement and fill verification belong to the connected executor.

## Run a review

Use Python 3.11+ and the existing installed private runtime:

    python github_dispatcher.py --state-dir C:/Users/Sable/AppData/Local/Teststock/runtime

The command performs fresh broker account, portfolio, positions, orders and held-option quote reads through a fixed Node bridge using the existing encrypted vault. It pins the selected account across independent account reads and saves observations under the protected private runtime. It independently fetches the current public execution-dispatch from main as decision support. No public file supplies balances, fills, credentials or a claim of broker approval.

The installed monitor must have a fresh successful current cycle. Stale/malformed readings, changed account identity and unsupported coverage block review. Stdout contains status and fixed blocker codes; private holdings and funding stay in engine-observation.json. engine-review.json records NO_ACTION, a protection review requirement, or explicit blockers. These files are private and must never be uploaded to GitHub.

A supplied normalized private proposal can be inspected with --proposal <absolute-json-path>. It must be bound to a fresh current dispatch fingerprint/generation, match a verified broker instrument/quote and independently satisfy risk, cash, protection, session, earnings, macro, admission and daily-loss checks. Missing proof is not filled in from proposal flags. The canonical deployment lock remains mandatory. The current connection does not supply verified all-asset reconciliation, daily-loss continuity, native entry protection or broker confirmations, so it cannot currently publish an eligible entry handoff. This is an explicit failed acceptance check, not an unimplemented snapshot stub.

The pure risk validator supports paper-plan tests: cash is capped by cash, buying power and unleveraged buying power, less pending commitments, with a 1% cost reserve and explicit fees. Sizing is whole-unit, <=1% planned risk and <=5% aggregate; long options count the entire premium as risk. Gross realized and unrealized losses never offset with gains; an $80 equality threshold blocks. Real daily-loss continuity still needs a verified source. Stops never guarantee execution prices.

The durable SQLite handoff claim uses a transaction and content digest. Duplicate or changed payloads cannot create a second handoff. This is paper/review deduplication, not a claim that an actual broker order was submitted. Unknown submissions must still be reconciled by the connected executor. TESTSTOCK_MODE=live cannot activate this module.

## Protection monitoring

The read-only monitor now fetches held option quotes by exact contract UUID, in batches of at most 20. It rejects missing/duplicate, stale/future, zero-bid/zero-size and crossed markets as monitoring evidence. Public status exposes counts and fixed codes only. Quote observations are private and do not establish broker-resident stops, same-session exits or permission to trade. Broker connectivity remains separate from protection coverage.

Reinstall the monitor bundle after deployment using scripts/windows/Install-Monitor.ps1 -RegisterTask, and reinstall the watchdog. The bundle contains the fixed option quote module, not the Python review coordinator or an order executor. Do not clear existing STOP files or live gates to make startup appear healthy.

## Scanner diagnostics

A partial/failed market-data scan may upload its sanitized artifact and publish a fresh research-only diagnostic packet. Missing/invalid/expired artifacts still fail publication. dataHealth, macroStatus, per-lane states and numerical coverage distinguish missing data from a complete scan. Incomplete/unknown/session-blocked lanes publish no candidates; unaffected complete lanes may publish already-qualified research only when macro and per-candidate guards pass. Every packet still says NO_ACTION and liveOrdersEnabled=false. The scan job stays red when it exits 2; a successful diagnostic publication does not relabel the scan healthy.

Unavailable crypto pairs are still reported; no provider coverage, entitlement or quote is invented. Recurring bulk scanning remains paused unless separately started through its existing control. Existing stock/intelligence workflows retain their schedules.

## Acceptance

Run node --test scripts/test-*.mjs and python -m unittest discover -s tests -p 'test_*.py', plus the production build. CI includes the Python engine regressions. A passing suite or a matched stop observation is not a broker-confirmed entry/protection/exit cycle. No demonstration trade may be used to create that proof. No user confirmation requirement or earned-evidence threshold is waived by this change.

A stale or unavailable public entry dispatch never suppresses a protection review based on fresh independently verified broker observations. Private protection review rows include exact contracts, quoted bids when fresh, and working-exit counts. An existing working close produces reconciliation instructions, never a second protective order. All rows still require broker review and confirmation; none claims placement.
