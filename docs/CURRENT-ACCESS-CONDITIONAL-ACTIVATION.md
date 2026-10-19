# Current-access research and conditional activation

The user authorized automatic trading only when every safety check passes and prohibited forced trades. This authorization is conditional; it does not waive the deployment lock, evidence floors, account risk limits or connected Robinhood review/confirmation requirements. Teststock/GitHub remains intelligence-only. No new live entry or demonstration trade is required to test this change.

## Current data scope

The research workflow defaults to CURRENT_ACCESS_CORE: SPY, QQQ, AAPL, MSFT and NVDA on the existing IEX feed, plus BTC/USD, ETH/USD and SOL/USD on the existing Alpaca US crypto feed. This is a named, limited research universe, not a claim of full-market coverage. Option research is explicitly EXCLUDED_CURRENT_ACCESS because recent contract history has not been verified. An excluded lane never publishes a candidate. Broad scan diagnostics and its missing instruments are preserved separately.

The core packet is published to docs/data/safe-trading-core-research.json. Broad packets remain at docs/data/safe-trading-research.json. Inside either declared scope, missing snapshots, empty histories, stale/future quotes, intraday gaps, earnings, macro, spread, session and expiry checks remain mandatory. Eligibility is still false for every research candidate. A research candidate is never a qualified broker dispatch.

Provider snapshots sometimes arrive with timestamps up to two seconds ahead of local time. The scanner may wait within its existing runtime budget for those timestamps to reach local time, then run the unchanged strict checks. It never accepts a future quote as fresh. Larger future timestamps remain rejected. The core scope can operate with the current access without querying denied recent option history or silently replacing it with delayed bars.

## Broker risk facts

The private observation bridge now reads the supported per-trade realized P&L feed with bounded pagination and today's aggregate realized P&L independently. It validates account identity, span, currency and aggregate trade count/net totals. Gross losing trades are summed without offsetting gains. Null P&L/basis remains unknown even with zero reported trades. Cursor loops, mismatched totals, missing fields and unavailable tools fail closed. These are realized observations only, not a durable daily-loss continuity claim.

The bridge also computes a conservative full-cost capital-at-risk bound for existing long stock/option/crypto holdings. Option average_price is the total premium per contract and is counted once. Crypto requires full direct-purchase basis coverage; transfers/rewards without basis remain unknown. Nonzero/unknown unsupported asset classes and pending entry reservations prevent a verified capacity result. All holdings still count; no dust threshold excludes crypto.

The upper bound is not reported as an actual unrealized loss or a guaranteed stop fill. It supports portfolio-heat checks and never clears advanced/OCO reconciliation, native protection or daily-loss continuity. Private risk facts are retained outside GitHub; only fixed blocker codes are exposed by the review coordinator.

Live funding and holding values remain private. Existing positions can consume more than the 5% aggregate heat allowance even with a working stop. A complete research scan and an acknowledged desktop alert cannot override exhausted cash or risk capacity.

## Conditional activation and unattended execution

The read-only Python coordinator remains review-only and its result cannot place an order. The supported connected executor is the only broker execution layer. The user's requested activation is pending until current earned admission, exact qualifying dispatch, full risk/broker reconciliation, native protection, verified entry/exit capability, scheduler/alert evidence and all per-order checks pass. The canonical live flag remains false and maxOrderUsd remains zero while any requirement fails.

An hourly follow-up in the existing chat can refresh readiness and escalate a current session exit. It must stay quiet when nothing actionable changes, reconcile existing protection before any closing action, preserve logical order IDs, and obey the broker's actual current review/confirmation rules. A configured schedule is not proof of a reliable wake or an executed exit. The local app/computer must remain available for local work. No scheduled prompt may assert that a future broker confirmation has already been supplied.

Recent option-history access, advanced/OCO coverage, complete daily-loss continuity and verified unattended broker execution remain separate limitations. None is repaired by a flag or inferred from a test. If the requirements do not all pass, activation remains pending and no trade is forced.
