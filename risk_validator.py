"""Pure paper-plan validation. A returned plan is never order authority."""
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_DOWN
import re

class RiskRejected(ValueError):
    pass

def amount(value, label):
    if isinstance(value, bool):
        raise RiskRejected("INVALID_" + label)
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise RiskRejected("INVALID_" + label) from None
    if not number.is_finite():
        raise RiskRejected("INVALID_" + label)
    return number

def timestamp(value, now, maximum=30):
    try:
        at = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return at.tzinfo is not None and 0 <= (now-at).total_seconds() <= maximum
    except (AttributeError, ValueError, TypeError):
        return False

@dataclass(frozen=True)
class ValidatedOrder:
    trade_id: str
    asset_type: str
    symbol: str
    side: str
    quantity: str
    entry_limit: str
    stop_trigger: str
    estimated_cost: str
    maximum_planned_loss: str
    broker_writes: bool = False
    live_eligible: bool = False
    confirmation_required: bool = True

def validate_trade(payload, account, market, now=None):
    now = now or datetime.now(timezone.utc)
    if not all(isinstance(x, dict) for x in (payload, account, market)):
        raise RiskRejected("BAD_INPUTS")
    if payload.get("side") != "buy" or payload.get("asset_type") not in ("stock", "option", "crypto"):
        raise RiskRejected("UNSUPPORTED_ENTRY")
    kind, symbol = payload["asset_type"], payload.get("symbol")
    if not isinstance(payload.get("trade_id"), str) or not 1 <= len(payload["trade_id"]) <= 128:
        raise RiskRejected("INVALID_IDENTITY")
    if not isinstance(symbol, str) or not re.fullmatch(r"[A-Z0-9./-]{1,40}", symbol):
        raise RiskRejected("INVALID_IDENTITY")
    if not timestamp(payload.get("generated_at"), now, 60) or not timestamp(account.get("as_of"), now):
        raise RiskRejected("STALE_PROPOSAL_OR_ACCOUNT")
    if account.get("source") != "SUPPORTED_ROBINHOOD_READS" or account.get("reconciled") is not True:
        raise RiskRejected("RECONCILIATION_UNVERIFIED")
    if account.get("cash_capacity_verified") is not True or account.get("daily_loss_verified") is not True:
        raise RiskRejected("FUNDS_OR_DAILY_LOSS_UNVERIFIED")
    if account.get("daily_halted") is not False or account.get("uncertain_orders") is not False:
        raise RiskRejected("RISK_STATE_BLOCKED")
    if not isinstance(account.get("exposure_symbols"), list) or any(not isinstance(x, str) for x in account["exposure_symbols"]) or symbol in account["exposure_symbols"]:
        raise RiskRejected("DUPLICATE_OR_UNKNOWN_EXPOSURE")
    if not timestamp(market.get("quote_at"), now) or market.get("source") != "ROBINHOOD":
        raise RiskRejected("QUOTE_UNVERIFIED")
    for field in ("tradable", "liquidity_verified", "native_stop_supported", "macro_verified", "earnings_verified"):
        if market.get(field) is not True:
            raise RiskRejected("MARKET_OR_PROTECTION_UNVERIFIED")
    if kind != "crypto" and market.get("regular_session") is not True:
        raise RiskRejected("SESSION_UNVERIFIED")
    if market.get("admission_state") not in ("MICRO_PROBATION", "PROBATION", "LIVE_ADMITTED"):
        raise RiskRejected("ADMISSION_UNEARNED")
    required_samples = 50 if kind == "option" else 100
    required_factor = Decimal("1.30") if kind == "option" else Decimal("1.25")
    expected_scope = "EXACT_CONTRACT" if kind == "option" else "STOCK_FORWARD"
    if (market.get("evidence_scope") != expected_scope or amount(market.get("independent_samples"), "SAMPLES") < required_samples
        or amount(market.get("distinct_days"), "DAYS") < 20 or amount(market.get("profit_factor"), "PROFIT_FACTOR") < required_factor):
        raise RiskRejected("ADMISSION_EVIDENCE_INSUFFICIENT")
    if kind != "crypto" and amount(market.get("minutes_to_close"), "MINUTES_TO_CLOSE") < (45 if kind == "option" else 20):
        raise RiskRejected("SESSION_CUTOFF")
    bid, ask = amount(market.get("bid"), "BID"), amount(market.get("ask"), "ASK")
    if bid <= 0 or ask < bid or (ask-bid)/((ask+bid)/2) > Decimal("0.015"):
        raise RiskRejected("INVALID_OR_WIDE_SPREAD")
    entry, stop = amount(payload.get("entry_limit"), "ENTRY"), amount(payload.get("stop_trigger"), "STOP")
    if not 0 < stop < entry or entry < ask or market.get("symbol") != symbol:
        raise RiskRejected("INVALID_ENTRY_OR_IDENTITY")
    multiplier = Decimal(1)
    if kind == "option":
        if (payload.get("position_effect") != "open" or payload.get("option_right") not in ("call", "put")
            or payload.get("option_id") != market.get("option_id") or not payload.get("option_id")
            or payload.get("expiration") != market.get("expiration") or payload.get("strike") != market.get("strike")):
            raise RiskRejected("OPTION_IDENTITY_UNVERIFIED")
        multiplier = amount(market.get("multiplier"), "MULTIPLIER")
        if multiplier != 100 or payload.get("contract_multiplier") != 100:
            raise RiskRejected("OPTION_MULTIPLIER_UNSUPPORTED")
        try:
            if datetime.fromisoformat(payload["expiration"]).date() <= now.date():
                raise RiskRejected("OPTION_EXPIRATION_UNSUPPORTED")
        except (ValueError, TypeError):
            raise RiskRejected("OPTION_EXPIRATION_UNSUPPORTED") from None
    equity = amount(account.get("equity"), "EQUITY")
    capacity = min(amount(account.get("cash"), "CASH"), amount(account.get("buying_power"), "BP"), amount(account.get("unleveraged_buying_power"), "UNLEVERAGED_BP"))
    pending = amount(account.get("pending_buy_commitments"), "PENDING")
    open_risk = amount(account.get("open_risk"), "OPEN_RISK")
    realized_loss = amount(account.get("gross_realized_loss"), "REALIZED_LOSS")
    unrealized_loss = amount(account.get("unrealized_loss"), "UNREALIZED_LOSS")
    loss = realized_loss + unrealized_loss
    if equity <= 0 or capacity <= 0 or min(pending, open_risk, realized_loss, unrealized_loss) < 0 or loss >= 80:
        raise RiskRejected("CASH_OR_DAILY_LOSS_LIMIT")
    cash = max(Decimal(0), capacity-pending)
    fee = amount(market.get("estimated_fee_per_unit"), "FEE")
    if fee < 0:
        raise RiskRejected("INVALID_FEE")
    unit_cost = entry*multiplier*Decimal("1.01") + fee
    # Long-option exposure uses the entire premium, not an assumed stop fill.
    unit_risk = unit_cost if kind == "option" else (entry-stop)*multiplier + fee
    heat = max(Decimal(0), equity*Decimal("0.05")-open_risk)
    quantity = min(cash/unit_cost, min(equity*Decimal("0.01"), heat)/unit_risk).quantize(Decimal(1), rounding=ROUND_DOWN)
    if quantity <= 0:
        raise RiskRejected("INSUFFICIENT_CASH_OR_RISK_CAPACITY")
    return ValidatedOrder(payload["trade_id"], kind, symbol, "buy", str(quantity), str(entry), str(stop), str(quantity*unit_cost), str(quantity*unit_risk))
