"""Supported broker observations and private paper handoffs; no login or orders."""
import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

class BrokerUnavailable(RuntimeError):
    pass

def read_private_json(path, limit=4_000_000):
    path = Path(path)
    if path.stat().st_size > limit:
        raise BrokerUnavailable("PRIVATE_DATA_TOO_LARGE")
    return json.loads(path.read_text(encoding="utf-8-sig"))

def fresh(stamp, now, seconds=30):
    try:
        at = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        return at.tzinfo is not None and 0 <= (now-at).total_seconds() <= seconds
    except (AttributeError, TypeError, ValueError):
        return False

class SessionManager:
    def __init__(self, state_dir=None):
        location = state_dir or os.environ.get("TESTSTOCK_RUNTIME_STATE_DIR")
        if not location or not Path(location).is_absolute():
            raise BrokerUnavailable("ABSOLUTE_PRIVATE_STATE_REQUIRED")
        self.root = Path(location).resolve()
        self.repo = Path(__file__).resolve().parent

    def refresh(self, proposal_path=None):
        config = read_private_json(self.root / "installation.json")
        node = config.get("node") or shutil.which("node")
        if not node or not Path(node).is_file():
            raise BrokerUnavailable("NODE_UNAVAILABLE")
        args = [node, str(self.repo / "scripts/engine-observation.mjs"), "--state-dir", str(self.root)]
        if proposal_path:
            args += ["--proposal", str(Path(proposal_path).resolve())]
        # Capture and discard upstream text: never log tokens, bodies or account IDs.
        try:
            result = subprocess.run(args, capture_output=True, timeout=40, check=False)
            if result.returncode:
                raise BrokerUnavailable("SUPPORTED_BROKER_READ_FAILED")
        except (OSError, subprocess.TimeoutExpired):
            raise BrokerUnavailable("SUPPORTED_BROKER_READ_FAILED") from None
        return self.independent_snapshot()

    def independent_snapshot(self, now=None):
        now = now or datetime.now(timezone.utc)
        observation = read_private_json(self.root / "engine-observation.json")
        status = read_private_json(self.root / "status.json")
        if observation.get("source") != "SUPPORTED_ROBINHOOD_READS" or observation.get("brokerWrites") is not False:
            raise BrokerUnavailable("BROKER_SOURCE_UNVERIFIED")
        if not fresh(observation.get("generatedAt"), now) or not fresh(observation.get("readStartedAt"), now):
            raise BrokerUnavailable("BROKER_OBSERVATION_STALE")
        if not fresh(status.get("at"), now) or status.get("brokerConnected") is not True or status.get("liveEnabled") is not False:
            raise BrokerUnavailable("CURRENT_MONITOR_UNVERIFIED")
        snapshot = observation.get("snapshot", {})
        if not re.fullmatch(r"[0-9a-f]{64}", str(observation.get("accountFingerprint", ""))) or snapshot.get("accountFingerprint") != observation.get("accountFingerprint"):
            raise BrokerUnavailable("BROKER_ACCOUNT_CHANGED")
        if snapshot.get("positionsReadComplete") is not True or snapshot.get("orderHistoryReadComplete") is not True:
            raise BrokerUnavailable("BROKER_RECONCILIATION_INCOMPLETE")
        return observation, status

    def execution_status(self, observation, status):
        blockers = list(observation["snapshot"].get("blockers", []))
        blockers += status.get("protection", {}).get("blockers", [])
        if observation.get("policy", {}).get("liveExecutionEnabled") is not True:
            blockers.append("LIVE_DEPLOYMENT_LOCKED")
        return {"broker_writes": False, "live_eligible": False,
                "execution_owner": "CONNECTED_ROBINHOOD_EXECUTOR",
                "blockers": sorted(set(blockers))}
