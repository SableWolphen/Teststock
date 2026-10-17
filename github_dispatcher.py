"""Five-minute GitHub payload validator, in safe dry-run mode.

Run as a single persistent process on a trusted machine; GitHub Actions
schedules do not guarantee five-minute timing. Never store trade secrets
or authoritative broker balances in GitHub action_payload.json.
"""
import json
import logging
import os
import signal
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from github import Github, GithubException
from risk_validator import RiskRejected, validate_trade

LOG = logging.getLogger("teststock")
POLL_SECONDS = 300
STATE_DB = Path(os.environ.get("TESTSTOCK_STATE_DB", "teststock_state.sqlite3"))
REPO = os.environ.get("TESTSTOCK_REPO", "SableWolphen/Teststock")
stop_requested = False

def shutdown(*_):
    global stop_requested
    stop_requested = True

def state_db():
    db = sqlite3.connect(STATE_DB, timeout=15)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""CREATE TABLE IF NOT EXISTS decisions (
        trade_id TEXT PRIMARY KEY, seen_at TEXT NOT NULL,
        status TEXT NOT NULL, reason TEXT NOT NULL
    )""")
    db.commit()
    return db

def pull_payload():
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN missing")
    gh = Github(token, timeout=15, per_page=20)
    try:
        blob = gh.get_repo(REPO).get_contents("action_payload.json")
        raw = blob.decoded_content
        if len(raw) > 32768:
            raise ValueError("Payload too large")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("Expected object payload")
        return data
    except (GithubException, OSError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Dispatch pull failed: {type(exc).__name__}") from None
    finally:
        gh.close()

def independent_snapshot():
    """Supply via a separately tested authenticated live-data adapter.

    Never trust GitHub for equity, settled cash, quotes or macro flags.
    """
    raise RuntimeError("Live market/account adapter not configured")

def run_once(db):
    payload = pull_payload()
    trade_id = payload.get("trade_id")
    if not isinstance(trade_id, str) or len(trade_id) > 128 or not trade_id:
        raise RiskRejected("Missing/invalid trade_id")
    if db.execute("SELECT 1 FROM decisions WHERE trade_id=?", (trade_id,)).fetchone():
        LOG.info("Duplicate instruction skipped: %s", trade_id)
        return
    now = datetime.now(timezone.utc).isoformat()
    # Reserve ID BEFORE any external activity. Unknown execution states
    # must NEVER be retried automatically.
    db.execute("INSERT INTO decisions VALUES (?,?,?,?)",
               (trade_id, now, "reserved", "awaiting validation"))
    db.commit()
    try:
        account, market = independent_snapshot()
        order = validate_trade(payload, account, market)
        if os.environ.get("TESTSTOCK_MODE", "paper") != "paper":
            raise RuntimeError("Live order placement disabled pending broker certification")
        LOG.info("Validated paper signal: %s %s qty=%s",
                 order.asset_type, order.symbol, order.quantity)
        status, reason = "paper_validated", "No live order submitted"
    except (RiskRejected, RuntimeError, KeyError, TypeError) as exc:
        status, reason = "rejected", str(exc)[:200]
        LOG.warning("Trade rejected: %s", reason)
    db.execute("UPDATE decisions SET status=?, reason=? WHERE trade_id=?",
               (status, reason, trade_id))
    db.commit()

def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    db = state_db()
    try:
        while not stop_requested:
            start = time.monotonic()
            try:
                run_once(db)
            except Exception as exc:
                LOG.error("Poll failed closed: %s", type(exc).__name__)
            remaining = max(0, POLL_SECONDS-(time.monotonic()-start))
            until = time.monotonic()+remaining
            while not stop_requested and time.monotonic()<until:
                time.sleep(min(1, max(0, until-time.monotonic())))
    finally:
        db.close()

if __name__ == "__main__":
    main()
