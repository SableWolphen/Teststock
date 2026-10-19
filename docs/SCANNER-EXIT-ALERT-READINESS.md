# Scanner, session exits and alert delivery

These components monitor and request review. They do not enable live entries, submit/cancel broker orders, infer fills or waive Robinhood confirmation requirements. The canonical deployment lock and earned-evidence floors remain unchanged.

## Scanner recovery and diagnostics

The scanner retries only missing stock/crypto snapshots once, through the same allowlisted GET reader and shared time/request budget. Persistent omissions remain incomplete, including on HTTP 200. Requested, received, retried, recovered and missing counts are retained. Historical coverage counts only nonempty bar arrays; empty results no longer look like complete history. Missing history withholds the affected lane.

Public packets expose numeric diagnostics and fixed error codes, including DATA_HTTP_403. Provider messages, credentials, missing-symbol lists and arbitrary errors are not copied into the public diagnostic packet. Complete, fresh per-candidate quote/bar, session, macro and earnings checks still apply. Partial lanes cannot publish picks. HTTP success does not establish complete market data.

On October 19, a live local probe found 1,985 of 2,000 requested stock snapshots and 36 of 60 crypto snapshots. One retry recovered none of the 15/24 omissions. Twelve missing stocks were OTC; three were BATS listings, so excluding OTC alone would not fix coverage. The recent option-bars request returned 403. A separate request ending 16 minutes earlier succeeded with no bars for the sampled contract. The current credential therefore did not establish usable recent option history. No delayed-history fallback is used to manufacture current signals or admission evidence.

Alpaca's historical option bars reference documents delayed end-time defaults for accounts without real-time feed access: https://docs.alpaca.markets/us/v1.4.2/reference/optionbars . Provider entitlement/agreement resolution or an independently validated replacement data source is needed; no subscription or agreement is changed by this implementation.

## Session exit review

The monitor retains today's provider calendar date/open/close from its existing read-only probe. session-exit-review.mjs uses America/New_York time and that current calendar; it never assumes a 16:00 close when the calendar is absent. For the existing hourly execution schedule, the final review is the last whole hour before the 15-minute exit cutoff: 15:00 Eastern on a 16:00 close, 12:00 on a 13:00 early close. A warning begins 30 minutes before that review. Missing/stale calendar or held positions after close escalate.

The private session-exit-review.json contains stable review keys, exact option IDs, confirmed held quantities and working exit IDs. It requests reconciliation of the existing stop before any session-close action; it never blindly cancels protection or creates another sell. A working stop does not satisfy the time-exit review. The watchdog independently emits deduplicated review/warning/closed-session incidents.

This closes the missing deadline/queue/alert path. It does not create an unattended broker executor. Actual closing orders still require fresh connected broker review, any required user approval, duplicate-order reconciliation and confirmed fills. A GFD stop can expire with a position still held; an hourly chat schedule and a healthy repository monitor do not guarantee a timely wake or fill. unattendedExecutionVerified and liveCycleVerified remain false.

## Local desktop delivery and explicit receipt

Install scripts/windows/Install-AlertDelivery.ps1 in the existing private runtime. It registers Teststock Desktop Alerts under the current interactive Windows user, runs on login and every minute, hides the shell, and shows a bounded alert dialog when acknowledgement is needed. It has no broker connection or order code. New incident sets require a new acknowledgement. Closing or timing out is not a receipt. Unknown incident strings are not displayed. A stale watchdog produces a monitoring-stale alert.

The Acknowledge receipt button records the challenge ID and timestamp. The read-only monitor/watchdog require a matching button receipt within the challenge lifetime and same New York date, plus a delivery heartbeat at most two minutes old. Displaying the dialog, writing a log, process success, a previous day or an unrelated receipt cannot clear the receipt gate. The private runtime retains evidence; public status has sanitized health flags only. An acknowledgement verifies local delivery, never trading permission or unattended broker availability. It requires a logged-in, powered-on Windows desktop; off-device push/SMS/email delivery is not provided.

Install the updated monitor (13 fixed read-only modules) and watchdog as well. Preserve STOP files, broker orders, lock ownership and encrypted vaults during rollout. Install-AlertDelivery.ps1 is separate so CI/offline monitor installation never shows a dialog or claims receipt.

## What still prevents automatic live entries

- The canonical live deployment lock and zero order cap are active. They cannot be cleared by a generated packet or historical user authorization.
- Earned admission and current qualifying signals are required independently. The current options lane has zero qualifying outcomes; micro admission requires 50 independent exact-lane outcomes across 20 trading days and profit factor at least 1.30. Stocks require 100 outcomes/20 days/profit factor 1.25.
- Complete current provider data is not established by the probes above.
- Broker-supported entry and a same-session entry/protection/exit-fill cycle are unverified. A confirmed working stop is not an exit fill. No demonstration trade may manufacture verification.
- The available supported reader cannot verify advanced/OCO relationships; all-asset reconciliation, crypto protection and verified daily-loss continuity remain incomplete.
- Local alert receipt is narrower than unattended execution or off-device delivery. The connected broker's per-order confirmation requirement remains binding.

Passing tests, simulated early-close/crash cases and an acknowledged alert do not remove any of these independent requirements.
