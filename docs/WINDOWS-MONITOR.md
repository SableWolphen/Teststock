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

The task runs at user logon, with limited privileges, ignores overlapping starts, has no execution time limit, and retries a failed process three times. Windows must be awake, online and logged in; this is not an always-on service or an exit guarantee. Restart the task after changing its environment. Configure a short comma-separated `TESTSTOCK_MONITOR_SYMBOLS` list in the launching user's environment (at most 20). Empty symbols deliberately blocks readiness.

## Authentication: supported connection versus unverified standalone access

Robinhood documents its official endpoint as `https://agent.robinhood.com/mcp/trading`. Connect through the supported host UI and complete Robinhood's own authentication and account onboarding. Never supply a Robinhood password, MFA code, browser cookie, or unofficial `robin_stocks` session to this repository.

A connected ChatGPT/Codex tool session is **not** proof that Windows Task Scheduler has broker credentials. Its session tokens are not exported by this installer. This implementation does not scrape the host's credential store, implement OAuth onboarding/refresh, or claim unattended token renewal works. Those remain deployment blockers.

The optional standalone adapter accepts `ROBINHOOD_MCP_OAUTH_TOKEN` only if the operator already has a legitimately issued token supported for this client/resource. No such token was obtained or tested here. Inject it into the process through an approved secret provider; do not commit it or write it in task arguments or public files. A host credential vault/refresh bridge must be separately implemented and verified before unattended broker monitoring can be called deployed. Expired/revoked credentials yield BLOCKED; there is no automatic fallback. A blank token keeps the daemon offline and records that limitation.

Sources checked October 16, 2026:
- [Robinhood external-agent onboarding](https://robinhood.com/us/en/support/articles/agentic-trading-overview/)
- [OpenAI remote MCP documentation](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)

## Architecture and safeguards

Task Scheduler -> persistent deterministic Node monitor -> fixed official MCP endpoint -> strictly allowlisted `get_accounts` and `get_equity_quotes`. Account responses are discarded. Quote responses follow the connected tool schema `data.results[].quote`. Both venue bid and ask timestamps must be within 30 seconds (future tolerance 2 seconds), state active, traded true, finite positive bid/ask, uncrossed and spread <=10%. Unknown schemas, missing symbols, authentication errors, network timeouts and invalid quotes block health. READ_ONLY_HEALTHY means only those reads passed; it never means entry or exit readiness. Closed markets normally report blocked quotes. This is an equity quote monitor, not options protection or a full portfolio reconciler.

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
