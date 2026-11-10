"""Isolated $100 experiment gate. PAPER ONLY: this module never submits orders.

Untrusted model output cannot grant permission to use live capital. All quantities
and positions must come from a reconciled experiment ledger, not LLM assertions.
"""
from __future__ import annotations
from decimal import Decimal, InvalidOperation

START = Decimal("100")
FLOOR = Decimal("80")
MAX_POSITION = Decimal("25")
MAX_EXPOSURE = Decimal("50")
MAX_OPEN = 2
MAX_NEW_WEEK = 2
MAX_QUOTE_AGE_SECONDS = 180

def money(value):
    try:
        result = Decimal(str(value))
    except (TypeError, ValueError, InvalidOperation):
        raise ValueError("invalid financial value")
    if not result.is_finite() or result < 0:
        raise ValueError("non-finite or negative financial value")
    return result

def decide_entry(state: dict, proposal: dict) -> dict:
    """Return a PAPER-only decision. Missing or contradictory facts always block."""
    reasons = []
    try:
        if state.get("mode") != "PAPER":
            reasons.append("live mode is not implemented")
        if state.get("reconciled") is not True:
            reasons.append("experiment ledger unverified")
        if state.get("account_type") != "cash":
            reasons.append("cash account not confirmed")
        if state.get("external_cash_isolated") is not True:
            reasons.append("allocation not verified as isolated")
        if state.get("open_orders_reconciled") is not True:
            reasons.append("open orders not reconciled")
        if state.get("market_open") is not True:
            reasons.append("regular market session not confirmed")
        if state.get("kill_switch") is not False:
            reasons.append("kill switch enabled or unknown")
        if proposal.get("side") != "buy" or proposal.get("asset_class") not in ("equity", "unleveraged_etf"):
            reasons.append("long-only eligible cash equity/ETF buys")
        if proposal.get("fractional_eligible") is not True or proposal.get("liquid") is not True:
            reasons.append("liquidity or fractional eligibility unverified")
        if proposal.get("signal_validated") is not True or proposal.get("earnings_safe") is not True:
            reasons.append("strategy signal or earnings safety unverified")
        qty = money(proposal["notional_usd"])
        equity = money(state["experiment_equity_usd"])
        spent = money(state["experiment_exposure_usd"])
        cash = money(state["experiment_settled_cash_usd"])
        pending = money(state["pending_buy_notional_usd"])
        quote_age = money(proposal["quote_age_seconds"])
        open_count = int(state["open_position_count"])
        buys_week = int(state["new_orders_this_week"])
        if qty <= 0 or qty > MAX_POSITION:
            reasons.append("position above $25 or invalid")
        if spent + pending + qty > MAX_EXPOSURE:
            reasons.append("combined exposure above $50")
        if cash < qty + pending:
            reasons.append("insufficient isolated settled cash")
        if equity <= FLOOR:
            reasons.append("experiment reached $80 stop")
        if equity > START + money(state["realized_profit_usd"]):
            reasons.append("unverified capital provenance")
        if open_count < 0 or open_count >= MAX_OPEN:
            reasons.append("open position limit")
        if buys_week < 0 or buys_week >= MAX_NEW_WEEK:
            reasons.append("weekly order limit")
        if quote_age > MAX_QUOTE_AGE_SECONDS:
            reasons.append("stale quote")
        if proposal.get("risk_usd") is None or money(proposal["risk_usd"]) > min(Decimal("1"), qty * Decimal(".04")):
            reasons.append("planned risk exceeds $1 or 4% of position")
        if state.get("duplicate_order_key") is not False:
            reasons.append("duplicate or unresolved order key")
    except (KeyError, ValueError, TypeError, OverflowError):
        reasons.append("missing or invalid validated state")
    return {"allowed": not reasons, "mode": "PAPER", "reasons": reasons or ["paper entry within limits"]}

def decide_exit(state: dict, proposal: dict) -> dict:
    """Do not block protective paper exits due to the entry gate or $80 floor."""
    reasons = []
    try:
        if state.get("mode") != "PAPER":
            reasons.append("live mode is not implemented")
        if state.get("reconciled") is not True:
            reasons.append("experiment holdings not reconciled")
        if proposal.get("side") != "sell":
            reasons.append("sell only")
        symbol = proposal["symbol"]
        own = money(state["owned_quantities"][symbol])
        qty = money(proposal["quantity"])
        if own <= 0 or qty <= 0 or qty > own:
            reasons.append("exit exceeds experiment-owned quantity")
        if state.get("duplicate_order_key") is not False:
            reasons.append("duplicate or unresolved order key")
    except (KeyError, TypeError, ValueError, OverflowError):
        reasons.append("missing or invalid holdings")
    return {"allowed": not reasons, "mode": "PAPER", "reasons": reasons or ["paper exit within owned quantity"]}
