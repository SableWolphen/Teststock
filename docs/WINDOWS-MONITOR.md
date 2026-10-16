# Windows read-only automatic monitor

This setup never submits, cancels, replaces, exercises or funds an order. The legacy executor's live entry point is hard-disabled, including exits. Environment flags and checked-in capability files cannot unlock it. Existing connected ChatGPT tasks are outside this process; this change does not cancel them or change broker-resident orders.

## Install

Use Windows PowerShell, Node.js 22+ and a trusted checkout of this branch. From the repository root:

```powershell
.\scripts\windows\Install-Monitor.ps1
.\scripts\windows\Install-Monitor.ps1 -RegisterTask
Start-ScheduledTask -TaskName 'Teststock Read-only Monitor'
Get-Content "$env:LOCALAPPDATA\Teststock\runtime\status.json"
```

The first command performs an offline one-shot smoke check; missing authentication reports BLOCKED as expected. Installation does not install dependencies or change your PowerShell execution policy. The monitor uses only Node built-ins. For the web app, install Node with npm, then run `npm ci`, `npm test`, `npm run build` separately. No administrator elevation or stored Windows password is required. Task registration is opt-in and replaces the task with the same name.

The scheduled action launches Node directly, so it does not require changing Windows PowerShell execution policy. The optional Start-Monitor.ps1 helper is for interactive use in a host that permits scripts. The task runs at user logon, with limited privileges, ignores overlapping starts, has no execution time limit, and retries a failed process three times. Windows must be awake, online and logged in; this is not an always-on service or an exit guarantee. Restart the task after changing its environment. Configure a short symbol list in private `monitor.json`, or comma-separated `TESTSTOCK_MONITOR_SYMBOLS` in the launching user's environment (at most 20). Empty symbols deliberately blocks readiness.

## Authentication: supported connection versus unverified standalone access

Robinhood documents its official endpoint as `https://agent.robinhood.com/mcp/trading`. Connect through the supported host UI and complete Robinhood's own authentication and account onboarding. Never supply a Robinhood password, MFA code, browser cookie, or unofficial `robin_stocks` session to this repository.

A connected ChatGPT/Codex tool session is **not** proof that Windows Task Scheduler has broker credentials. The installer never exports host credentials. The standalone monitor now has its own OAuth authorization-code flow with PKCE S256 and state validation, using Robinhood's advertised discovery, registration and token endpoints.

After installation, stop the monitor and verify it has exited, then run:

```powershell
node scripts/robinhood-oauth.mjs --state-dir "$env:LOCALAPPDATA\Teststock\runtime"
```

Open the printed Robinhood authorization URL in a browser on this Windows computer. Complete login, MFA and consent yourself. The loopback callback is bound only to 127.0.0.1 with a random port and a ten-minute timeout. Callback origin, path, state, duplicate parameters and optional issuer are validated. Discovery endpoints are pinned to the observed official hosts; changed metadata blocks authentication pending review.

**Robinhood advertises only the broad `internal` scope. No server-enforced read-only scope has been verified.** The local client continues to deny every broker write tool; only account, equity quote, equity/options position and equity/options order reads are allowed; the legacy live executor remains hard-disabled. Read the broker consent screen before deciding whether to connect.

Tokens are encrypted with Windows DPAPI CurrentUser in `robinhood-oauth.dpapi` within the ACL-protected runtime folder. Only the same Windows account on that machine can normally decrypt them. Secrets pass through private process pipes and are never written in task arguments, logs, source or environment variables. The monitor loads this vault on startup and refreshes shortly before access-token expiry, retaining rotated refresh tokens with an atomic encrypted write. Refresh is serialized by the single monitor lock. Revocation, refresh failure and changed metadata fail closed; sign in again when needed. An explicit environment token remains a legacy fallback only when no vault exists.

Create private `monitor.json` beside the vault, for example `{"symbols":["SPY","QQQ"]}` for broad-market quote diagnostics. This is observation only. Environment `TESTSTOCK_MONITOR_SYMBOLS` overrides the file. Remove STOP only after confirming the old process exited, then start the scheduled task. Confirm a fresh status shows `brokerConnected: true`; `READ_ONLY_HEALTHY` also requires fresh executable quotes, which may be unavailable outside market hours. A successful browser callback alone does not prove broker reads or scheduled operation.

To disconnect, stop the task, verify it has exited, delete only `robinhood-oauth.dpapi` from the private runtime folder, and revoke this client through Robinhood's supported account controls. Restarting without credentials reports BLOCKED. Deleting the local file does not revoke the broker grant.

Verification boundaries: mock tests cover refresh rotation/revocation and callback validation; Windows tests exercise actual DPAPI round trips. A real sign-in, broker read, automatic refresh and scheduled restart must each be verified independently; the code and passing tests alone do not establish them.

Sources checked October 16, 2026:
- [Robinhood external-agent onboarding](https://robinhood.com/us/en/support/articles/agentic-trading-overview/)
- [OpenAI remote MCP documentation](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)

## Architecture and safeguards

Task Scheduler -> persistent deterministic Node monitor -> fixed official MCP endpoint -> strictly allowlisted account, equity quote, equity/options position and equity/options order reads. Account responses are discarded. Quote responses follow the connected tool schema `data.results[].quote`. Both venue bid and ask timestamps must be within 30 seconds (future tolerance 2 seconds), state active, traded true, finite positive bid/ask, uncrossed and spread <=10%. Unknown schemas, missing symbols, authentication errors, network timeouts and invalid quotes block health. READ_ONLY_HEALTHY means only those reads passed; it never means entry or exit readiness. Closed markets normally report blocked quotes. The scheduled cycle now collects every page of equity/options positions and order history for the single active accessible account. It pins an account fingerprint, adopts existing holdings into a private managed-position view and records only broker-reported executions as fills. Unknown order states remain potentially working. This is not options protection or complete coverage of advanced orders and crypto.

The MCP client initializes the protocol, carries session/version headers, accepts JSON/SSE, applies a 20-second request timeout and polls serially every 30 seconds. There is no LLM call in the polling loop. A future analysis agent may consume redacted health and research packets; it must not receive broker write tools. Strategy packets and model output cannot expand the tool allowlist. A broker-side read-only scope has not been verified; the local allowlist is enforced by this implementation.

Private state defaults to `%LOCALAPPDATA%\Teststock\runtime`; the installer removes inherited ACLs and grants the installing user access. Daily append-only JSONL logs are flushed to disk, and status is atomically replaced. Logs record health/counts only, never raw account data, tokens or upstream error bodies. Logs are intentionally retained until the operator archives them; monitor disk space. This state never belongs in GitHub Pages or `docs/data`.

A `monitor.lock` prevents overlapping processes. After a crash, confirm the recorded PID is no longer running before manually removing the lock; the process fails closed rather than guessing. An independent durable intent-claim primitive uses exclusive creation and stable fingerprint hashing. Tests prove restart/process duplicate suppression; it is a building block for a future executor and is not wired to any broker submission. Any future ambiguous submission must retain its claim and reconcile the original broker client ID, partial fills, cancellations and protective orders before retrying. Never treat these observation claims as fills.

Stop with `.\scripts\windows\Stop-Monitor.ps1`; add `-Unregister` to remove the task. STOP is checked between cycles. Allow an in-flight request to time out, verify the process exited, then remove STOP to resume. Logs remain available. No scheduled task is installed by merely cloning or building.

## Go-live gates: all currently unverified

Live implementation requires a separate reviewed code change. Before that change is authorized, retain dated, private evidence for:

1. Supported OAuth registration, consent, correct dedicated account, credential vault, expiration/refresh/revocation, and unattended restart under the actual scheduled identity.
2. Complete broker positions/open-order pagination and reconciliation; cash-only buying power, account restrictions, strategy admission, limits and market-session clock verified. Adopt existing holdings and prioritize exits.
3. Exact equity/option entry and sell/close tool support, required reviews/confirmations, rejected/partial/ambiguous fills and stable broker idempotency verified in an explicitly supported test environment. Local paper output is not broker paper trading.
4. Broker-resident protection, protection failure recovery, confirmed cancel/replace, same-session option closure and emergency recovery verified. A logged-in desktop or periodic AI chat is not sufficient protection.
5. Sustained paper/shadow soak with reboot, sleep, disconnect, duplicate starts, stale quotes, expired credentials, disk failure and kill-switch drills. Positive strategy evidence is independent of software tests.
6. Explicit user authorization for the exact account, asset classes, risk limits and entry/exit behavior, satisfying current broker tool requirements. Do not infer that old repository statements verify this user's current permission.

No real-money order was placed to validate any of these gates. Historical README live flags and execution prompts do not override this hard lock.

## Reconciliation and shadow safety update

`scripts/safety-policy.mjs` is the canonical admission floor and live deployment lock. Stock micro evidence requires 100 independent outcomes over 20 trading days with profit factor >=1.25; options and index-option micro evidence require 50 independent lane-specific outcomes over 20 days with profit factor >=1.30. Higher probation thresholds remain separate. Bootstrap flags cannot bypass SHADOW_ONLY; live authorization remains false even when evidence qualifies. Zero premium cap and disabled bootstrap mean no live spending is authorized, not unlimited spending. A deadline or market open cannot promote a strategy.

Private `broker-reconciliation.json` contains the last successfully collected position/order/fill snapshot and managed holdings. No account snapshots are written to docs or GitHub. Status logs contain counts only. The snapshot is replaced only after successful pagination, identity and quantity validation. On a failed cycle the previous snapshot remains historical; current status marks reconciliation incomplete. Consumers must require a recent generatedAt and current successful status, never infer freshness from file existence. Reads across endpoints are sequential, not a broker-atomic transaction.

`READ_ONLY_HEALTHY` confirms the supported read cycle succeeded. It does not clear the nested reconciliation blockers: advanced-order coverage is unverified and crypto coverage is not implemented. The current remote tool list did not advertise an advanced-order reader. Thus allAssetReconciliationComplete and entryAllowed remain false. Per-execution totals, uncertain identities, unknown order states, duplicate working orders and short positions require review; they never trigger a corrective order. The monitor cannot cancel an order or close a holding.

The shadow tests exercise admission boundaries, stale/invalid quotes, partial fills, pagination failures, duplicate executions, account changes, credential/network errors, retained snapshots and a killed child monitor's crash lock. These are synthetic drills and unit/integration checks, not a reboot/sleep/network/disk-failure soak or broker entry/protection/exit verification. Those go-live gates remain open.

## Alpaca paper-data connection and protection shadow drills

The optional local Alpaca reader supports only fixed GET routes for the paper market clock/calendar and IEX stock bars. It has no orders, cancellation, account-funding or live-trading endpoint. A working chat connector does not supply local API credentials. Paper-account credentials are distinct from live credentials; use the paper account's API Keys panel.

Start local setup after installing the Windows monitor:

```powershell
node scripts/alpaca-data-client.mjs --state-dir "$env:LOCALAPPDATA\Teststock\runtime"
```

Open the printed localhost setup URL and enter paper API key and secret only in that local form. Never put them in chat, source control, task arguments or public files. Setup verifies paper clock, today's calendar and IEX bars before writing `alpaca-data.dpapi` with Windows DPAPI CurrentUser. The form uses a random route, exact Host/Origin checks, no third-party resources and a fifteen-minute timeout. Invalid credentials/read failures do not save new values. The Robinhood vault is separate and unchanged. The broker keys may permit paper trading at Alpaca, but this application's reader exposes no order method.

After the running monitor loads this version, each cycle reports separate `entryData` status. A healthy Robinhood read cycle does not imply `entryData.connected` or trading readiness. When credentials are configured, data probes are read-only. Missing/expired/revoked keys or feed access failures remain blocked and do not turn on trading. Only clock/calendar and a small historical IEX sample are verified by this connection probe; full strategy data validation is a separate step.

Run approved legacy data checks using the encrypted vault:

```powershell
node scripts/run-alpaca-data-task.mjs check-alpaca-market-session.mjs --state-dir "$env:LOCALAPPDATA\Teststock\runtime"
node scripts/run-alpaca-data-task.mjs validate-entry-gates.mjs --state-dir "$env:LOCALAPPDATA\Teststock\runtime"
node scripts/run-shadow-readiness.mjs --state-dir "$env:LOCALAPPDATA\Teststock\runtime"
```

Only those two named data tasks may receive credentials through a child process's temporary environment. Keys are never persisted as global environment variables. The historical validator can write research artifacts and return a `RED_FLAG` result even if its process exits successfully; successful computation is not a strategy pass. Windows must be awake, online and logged in. The local readiness report stays private as `shadow-readiness.json`.

Protection drills have no broker transport. They test confirmation/freshness, whole-share restrictions, remaining stop quantity, session scope, partial fills, ambiguous submissions, pending cancellations, duplicate exits, expired GFD protection and orphan sell orders. A reported matching stop is not a fill or price guarantee. Only equity holdings are assessed by the live read-only report; options coverage remains unverified. These drills do not submit Alpaca paper orders, do not verify Robinhood entry/protection/exit submission, and cannot substitute for broker-supported test flows or separate authorization.

Robinhood's review tools require the user to supply the exact symbol, quantity or dollar amount, order type and applicable prices. Non-submitting previews can be requested once those inputs are supplied. A successful preview does not place an order or verify actual fills, protection creation, cancellation/replacement, or outage recovery. No preview, credential, passing test or market-open deadline overrides `safety-policy.mjs`.

Official references checked October 16, 2026: [Alpaca authentication](https://docs.alpaca.markets/us/docs/authentication), [Alpaca paper trading and simulation limits](https://docs.alpaca.markets/us/docs/paper-trading), [Robinhood agent trading tools](https://robinhood.com/us/en/support/articles/trading-with-your-agent/).

### Complete cycle replay and remaining acceptance gates

Run `node scripts/run-cycle-replay.mjs` for a deterministic integration drill using synthetic fixtures only. It exercises the real reconciliation and protection evaluators across acknowledged entry, ambiguous acknowledgement, partial fill, matching stop, stale outage state, pending stop cancellation, working exit, flat reconciliation and repeated restart input. It has no broker transport. Its synthetic fills and gross P&L must never enter strategy admission, the real trade journal, or broker capability attestations. A passing replay does not establish that a broker order was placed or that crash recovery/alerts were verified operationally.

The readiness evaluator respects the canonical deployment lock even with affirmative capability attestations. The GitHub readiness generator explicitly reports broker execution as unverified; GitHub cannot verify the connected ChatGPT executor.

Before any live deployment, independent evidence must establish all of the following:

| Gate | Required evidence |
| --- | --- |
| Strategy admission | Positive independent forward outcomes meeting canonical sample/day/profit-factor floors; failing holdouts remain blocked. Do not lower thresholds or tune from holdouts. |
| Broker execution | Supported executor entry and exit, broker-confirmed executions, per-order broker approval requirements satisfied, and reconciled remaining holdings. A preview is insufficient. |
| Protection | Broker-resident protection for the actual filled quantity; verified pending cancel/replacement and simultaneous exit behavior; session validity and failure escalation. |
| Reconciliation | Coverage of every in-scope position and order, including advanced-order relationships; unsupported assets must be explicitly isolated and cannot be claimed protected. |
| Operations | Observed restart, expired credentials, stale data, outage, kill-switch and alert-delivery tests under the intended schedule; monitor heartbeat alone is insufficient. |
| Deployment | Reviewed supported executor wiring and explicit live release after the above pass. Windows read-only MCP must not silently acquire write access. |

October 16 connection testing verified local Alpaca paper clock/calendar/IEX bars. Full historical validation ran successfully but returned `RED_FLAG` for CALM. That is an evidence failure rather than a connectivity failure. The local monitor continues independently with real-money submission disabled.

### Recovery, watchdog and expanded read-only reconciliation

The crypto reader uses `rhs_account_number` from the pinned eligible brokerage account, pages both position and order results, and retains explicit blockers for non-fiat exposure or working/unknown orders. Crypto orders are read-only observations; their fills, protection and strategy admission are not asserted. Reader failure never implies empty holdings. The aggregate `allAssetReconciliationComplete` remains false because advanced-order relationships still lack an exposed reader.

Monitor startup serializes lock recovery. It archives an abandoned lock only when the recorded process is demonstrably absent (`ESRCH`). Live PIDs, permission errors and invalid owners remain blocked. A crash during recovery can leave `monitor.lock.recovery`; an operator must verify no recovery worker is active before removing that guard. PID reuse causes a safe refusal. The tests kill an isolated monitor child and verify its restart stays read-only; this does not certify all Windows/credential outage cases.

Install the independent local watchdog with `./scripts/windows/Install-Watchdog.ps1`. It copies its standalone script into the private runtime so repository branch changes cannot remove the scheduled action. The separate `Teststock Read-only Watchdog` task runs every minute while the user is logged in. It detects missing/stale/future heartbeats, broker/data failures, incomplete reconciliation, STOP and unexpected live flags. Private `alerts.jsonl` records incident/recovery transitions and `watchdog-status.json` records active codes. Repeated incidents are deduplicated across process restarts. A stale watchdog lock requires operator inspection; no lock is blindly removed.

These are **local-file alerts only**. Notification delivery to the user and user receipt are unverified; there is no email/SMS/push integration. A healthy watchdog, a passing fixture crash test or a recovered monitor never authorizes a broker order or clears strategy/protection gates.


### Watchdog recovery and source freshness

Reinstall the watchdog after this update: `./scripts/windows/Install-Watchdog.ps1`. The installer copies both `monitor-watchdog.mjs` and its `monitor-lock.mjs` dependency to private runtime tools. The watchdog now archives a dead process lock only after checking that its PID is absent. A live/reused PID, malformed owner or recovery guard still blocks startup for operator inspection. Local tests prove recovery for a terminated fixture process; they do not certify production restart behavior.

A fresh `status.json.at` no longer masks old underlying reads. Successful broker reconciliation must carry `reconciliation.at`, and successful Alpaca data probes must carry `entryData.verifiedAt`, both within 120 seconds and no more than two seconds ahead. Success flags must be booleans. Persisted incident codes must be from the fixed local allowlist; unknown codes generate `WATCHDOG_STATE_INVALID` without copying their content to alerts. Alerts remain local files with unverified delivery. The canonical live deployment lock and monitoring-only transport are unchanged.
### Automatic monitoring quote fallback

For each configured stock, use a fresh valid Robinhood quote first. Missing or invalid primary quotes trigger a fixed read-only Alpaca latest-quotes request with the separate encrypted paper credentials and explicit IEX feed. Only missing symbols are requested. Keep source identity per quote; reject crossed, missing, duplicate, future or older-than-30-second quotes from either source. Unavailable backups remain unavailable; there is no stale-cache substitution. Status reports this separately as `marketData`, with `scope: MONITORING_QUOTES_ONLY` and `executionAuthorized: false`.

IEX covers one exchange and is not equivalent to a consolidated broker execution quote. Backup success does not clear broker authentication, position/order reconciliation or primary-quote blockers, and cannot authorize trading. Quote fallback does not supply missing minute bars, volume, VWAP, option quotes, advanced orders or protection. A GitHub intraday job's rejected credentials are separate from the Windows paper vault; the local keys are not uploaded to GitHub. Reference: https://docs.alpaca.markets/us/reference/stocklatestquotes-1.
