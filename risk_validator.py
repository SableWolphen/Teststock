"""Pure, fail-closed risk validation; prices are decimal strings."""
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_DOWN

ONE = Decimal("1")
ZERO = Decimal("0")
RISK_FRACTION = Decimal("0.01")
MAX_SPREAD = Decimal("0.015")
MAX_QUOTE_AGE_SECONDS = 30

class RiskRejected(ValueError):
    pass

def amount(value, label):
    try:
        n = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise RiskRejected(f"{label}: invalid decimal") from None
    if not n.is_finite():
        raise RiskRejected(f"{label}: non-finite decimal")
    return n

@dataclass(frozen=True)
class ValidatedOrder:
    trade_id: str
    asset_type: str
    symbol: str
    side: str
    quantity: str
    entry_limit: str
    stop_trigger: str
    max_loss_at_stop: str
    protective_stop_required: bool = True

def validate_trade(payload, account, market):
    """Validate one long-only BUY proposal; exits are managed separately.

    Requires current independent account + market readings and credible
    execution/stop capability. A trigger is NOT an actual broker-native stop.
    """
    if not isinstance(payload, dict) or not isinstance(account, dict) or not isinstance(market, dict):
        raise RiskRejected("Bad inputs")
    if payload.get("side") != "buy":
        raise RiskRejected("Only long buys supported")
    kind = payload.get("asset_type")
    if kind not in ("option", "crypto"):
        raise RiskRejected("Unsupported asset type")
    if not payload.get("trade_id") or not payload.get("symbol"):
        raise RiskRejected("Missing trade identity")
    if not account.get("settled_cash_verified"):
        raise RiskRejected("Settled cash has not been verified")
    if account.get("daily_lock") or account.get("open_orders_unreconciled"):
        raise RiskRejected("Trading locked or open orders unresolved")
    if market.get("macro_risk_state") != "normal" or not market.get("macro_verified"):
        raise RiskRejected("Macro risk unknown or elevated")
    if not market.get("liquidity_verified") or not market.get("instrument_tradable"):
        raise RiskRejected("Liquidity/tradability unverified")
    if not market.get("native_stop_supported"):
        raise RiskRejected("Verified protective broker stop unavailable")
    now = datetime.now(timezone.utc)
    try:
        stamp = datetime.fromisoformat(market["quote_at"].replace("Z", "+00:00"))
        if stamp.tzinfo is None or not (0 <= (now - stamp).total_seconds() <= MAX_QUOTE_AGE_SECONDS):
            raise RiskRejected("Quote stale or in the future")
    except (KeyError, TypeError, ValueError):
        raise RiskRejected("Missing or invalid quote timestamp") from None
    bid, ask = amount(market.get("bid"), "bid"), amount(market.get("ask"), "ask")
    if bid <= ZERO or ask < bid or (ask-bid)/((ask+bid)/2) > MAX_SPREAD:
        raise RiskRejected("Invalid/wide spread")
    equity = amount(account.get("equity"), "equity")
    cash = amount(account.get("settled_cash"), "settled_cash")
    daily_pnl = amount(account.get("daily_pnl"), "daily_pnl")
    daily_limit = amount(account.get("daily_loss_limit"), "daily_loss_limit")
    if equity <= ZERO or cash <= ZERO or daily_limit <= ZERO or daily_pnl <= -daily_limit:
        raise RiskRejected("Insufficient equity/cash or daily stop reached")
    entry = amount(payload.get("entry_limit"), "entry_limit")
    stop = amount(payload.get("stop_trigger"), "stop_trigger")
    if not (ZERO < stop < entry) or entry < ask:
        raise RiskRejected("Invalid entry/stop or entry below market ask")
    if kind == "option":
        # Long call/put only. Contract multiplier is normally 100.
        if payload.get("position_effect") != "open" or payload.get("contract_multiplier") != 100:
            raise RiskRejected("Option contract metadata not verified")
        if payload.get("option_right") not in ("call", "put") or not payload.get("expiration") or not payload.get("strike"):
            raise RiskRejected("Incomplete option contract")
        multiplier = Decimal("100")
        quantum = ONE
    else:
        multiplier = ONE
        quantum = Decimal("0.00000001")
    stop_risk = (entry-stop)*multiplier
    if stop_risk <= ZERO:
        raise RiskRejected("Invalid stop risk")
    # Cap risk; also cap total premium/notional at settled cash and equity.
    capacity = min(
        equity*RISK_FRACTION/stop_risk,
        cash/(entry*multiplier),
        equity/(entry*multiplier),
    )
    qty = capacity.quantize(quantum, rounding=ROUND_DOWN)
    if qty <= ZERO:
        raise RiskRejected("Trade cannot be sized within limits")
    cost = qty*entry*multiplier
    loss = qty*stop_risk
    if cost > cash or loss > equity*RISK_FRACTION:
        raise RiskRejected("Risk/cash bound exceeded")
    return ValidatedOrder(
        str(payload["trade_id"]),kind,str(payload["symbol"]),"buy",
        str(qty),str(entry),str(stop),str(loss)
    )
