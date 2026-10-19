"""Private supported-broker review coordinator. Never logs in or places an order."""
import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import urllib.request

from session_manager import SessionManager, BrokerUnavailable, read_private_json, fresh
from risk_validator import validate_trade, RiskRejected

REPOSITORY = "SableWolphen/Teststock"

class PrivateConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()

def state_db(path):
    path = Path(path)
    if not path.is_absolute():
        raise BrokerUnavailable("ABSOLUTE_PRIVATE_DATABASE_REQUIRED")
    db = sqlite3.connect(path, timeout=15, factory=PrivateConnection)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("CREATE TABLE IF NOT EXISTS handoffs (fingerprint TEXT PRIMARY KEY, digest TEXT NOT NULL, state TEXT NOT NULL)")
    db.commit()
    return db

def pull_payload():
    # Public decision support only. No token, account data or alternate URL is accepted.
    url = f"https://raw.githubusercontent.com/{REPOSITORY}/main/docs/data/execution-dispatch.json"
    with urllib.request.urlopen(url, timeout=15) as response:
        raw = response.read(1_000_001)
    if len(raw) > 1_000_000:
        raise BrokerUnavailable("DISPATCH_TOO_LARGE")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise BrokerUnavailable("INVALID_DISPATCH")
    return data

def independent_snapshot(session, proposal_path=None):
    return session.refresh(proposal_path)

def claim_handoff(db, fingerprint, payload):
    if not isinstance(fingerprint, str) or not 1 <= len(fingerprint) <= 256:
        raise RiskRejected("INVALID_FINGERPRINT")
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    try:
        db.execute("BEGIN IMMEDIATE")
        previous = db.execute("SELECT digest,state FROM handoffs WHERE fingerprint=?", (fingerprint,)).fetchone()
        if previous:
            db.rollback()
            return "DUPLICATE" if previous[0] == digest else "CONFLICTING_PAYLOAD"
        db.execute("INSERT INTO handoffs VALUES (?,?,?)", (fingerprint, digest, "CLAIMED_BEFORE_HANDOFF"))
        db.commit()
        return "CLAIMED"
    except Exception:
        db.rollback()
        raise

def run_once(db, session, dispatch=None, proposal=None, observation=None, now=None):
    now = now or datetime.now(timezone.utc)
    dispatch = dispatch if dispatch is not None else pull_payload()
    observation, status = observation if observation is not None else independent_snapshot(session)
    execution = session.execution_status(observation, status)
    result = {"schemaVersion": 1, "generatedAt": now.isoformat(), "mode": "PRIVATE_REVIEW_ONLY", "broker_writes": False, "live_eligible": False, "execution_owner": execution["execution_owner"], "blockers": execution["blockers"]}
    if os.environ.get("TESTSTOCK_MODE", "paper") != "paper":
        raise BrokerUnavailable("DIRECT_LIVE_EXECUTION_DISABLED")
    if not fresh(dispatch.get("generatedAt"), now, 900):
        result.update(status="BLOCKED", reason="DISPATCH_STALE")
        return result
    if proposal is None:
        result.update(status="PROTECTION_REVIEW_REQUIRED" if "HOLDING_PROTECTION_UNVERIFIED" in result["blockers"] else "NO_ACTION", reason="NO_QUALIFIED_ENTRY_PROPOSAL")
        return result
    if observation.get("policy", {}).get("liveExecutionEnabled") is not True or observation.get("policy", {}).get("maxOrderUsd", 0) <= 0 or dispatch.get("riskCreationBlockedByExecutor") is not False:
        result.update(status="BLOCKED", reason="LIVE_DEPLOYMENT_LOCKED")
        return result
    fingerprint = proposal.get("fingerprint")
    if fingerprint not in dispatch.get("dispatchFingerprints", []) or proposal.get("dispatch_generated_at") != dispatch.get("generatedAt"):
        result.update(status="BLOCKED", reason="PROPOSAL_NOT_BOUND_TO_CURRENT_DISPATCH")
        return result
    actions = [dispatch.get("pendingAction")] + dispatch.get("automaticStockCandidates", []) + dispatch.get("optionCandidates", [])
    matching = [a for a in actions if isinstance(a, dict) and a.get("fingerprint") == fingerprint]
    if len(matching) != 1 or matching[0].get("trigger") not in ("BUY_TRIGGER", "OPTION_BUY_TRIGGER") or matching[0].get("ticker") != proposal.get("symbol") or matching[0].get("assetClass", "").lower() != proposal.get("asset_type"):
        result.update(status="BLOCKED", reason="ENTRY_ACTION_IDENTITY_UNVERIFIED")
        return result
    # Eligibility comes from independent evidence, never flags in the public proposal.
    snapshot = observation["snapshot"]
    market = observation.get("market") or {}
    quote, instrument = market.get("quote") or {}, market.get("instrument") or {}
    portfolio = observation.get("portfolio") or {}
    bp = portfolio.get("buying_power") or {}
    account = {"source": observation["source"], "as_of": observation["generatedAt"], "reconciled": snapshot.get("allAssetReconciliationComplete") is True,
        "cash_capacity_verified": all(k in portfolio for k in ("cash", "total_value")) and all(k in bp for k in ("buying_power", "unleveraged_buying_power")),
        "daily_loss_verified": False, "daily_halted": True, "uncertain_orders": bool(snapshot.get("blockers")),
        "equity": portfolio.get("total_value"), "cash": portfolio.get("cash"), "buying_power": bp.get("buying_power"), "unleveraged_buying_power": bp.get("unleveraged_buying_power"),
        "exposure_symbols": [p.get("symbol") or p.get("chain_symbol") for p in snapshot.get("managedPositions", [])]}
    market_inputs = {"source": "ROBINHOOD", "symbol": instrument.get("chain_symbol") or quote.get("symbol"), "option_id": instrument.get("id"), "expiration": instrument.get("expiration_date"), "strike": instrument.get("strike_price"), "multiplier": instrument.get("trade_value_multiplier"),
        "quote_at": quote.get("updated_at"), "bid": quote.get("bid_price"), "ask": quote.get("ask_price"), "tradable": instrument.get("tradability") == "tradable", "native_stop_supported": False}
    try:
        plan = asdict(validate_trade(proposal, account, market_inputs, now))
    except RiskRejected as error:
        result.update(status="BLOCKED", reason=str(error))
        return result
    claim = claim_handoff(db, fingerprint, proposal)
    result.update(status="PAPER_HANDOFF" if claim == "CLAIMED" else claim, plan=plan if claim == "CLAIMED" else None)
    return result

def atomic_private_json(path, data):
    import uuid
    path = Path(path)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temp.open("x", encoding="utf-8") as stream:
            if os.name != "nt":
                os.chmod(temp, 0o600)
            json.dump(data, stream, indent=2)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--proposal")
    args = parser.parse_args()
    try:
        session = SessionManager(args.state_dir)
        proposal = read_private_json(args.proposal, 32768) if args.proposal else None
        observation = independent_snapshot(session, args.proposal)
        with state_db(session.root / "engine-handoffs.sqlite3") as db:
            result = run_once(db, session, proposal=proposal, observation=observation)
        atomic_private_json(session.root / "engine-review.json", result)
        print(json.dumps({k: result[k] for k in ("status", "broker_writes", "live_eligible", "blockers")}))
        return 2 if result["status"] in ("BLOCKED", "PROTECTION_REVIEW_REQUIRED") else 0
    except Exception:
        print(json.dumps({"status": "BLOCKED", "reason": "PRIVATE_ENGINE_REVIEW_FAILED", "broker_writes": False}))
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
