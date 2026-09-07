"""Retain local executor evidence without leaking account data into public logs."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def record(directory, returncode):
    folder = Path(directory)
    stdout = (folder / "stdout.json").read_text(encoding="utf-8-sig", errors="replace")
    stderr = (folder / "stderr.txt").read_text(encoding="utf-8-sig", errors="replace")
    try:
        payload = json.loads(stdout)
    except (ValueError, TypeError):
        payload = None
    failed = returncode != 0 or not isinstance(payload, dict) or payload.get("is_error") is True
    category = "COMPLETED"
    if failed:
        detail = (stdout + stderr).lower()
        if any(term in detail for term in ("invalid api key", "authentication_error", "not logged in", "unauthorized", "oauth token has expired")):
            category = "AUTHENTICATION"
        elif any(term in detail for term in ("rate_limit", "rate limit", "usage limit", "credit balance")):
            category = "RATE_OR_USAGE_LIMIT"
        elif any(term in detail for term in ("max_turns", "max turns")):
            category = "TURN_LIMIT"
        elif any(term in detail for term in ("econnreset", "etimedout", "connection error")):
            category = "CONNECTION"
        else:
            category = "EXECUTOR_ERROR" if isinstance(payload, dict) else "INVALID_OR_MISSING_OUTPUT"
    metadata = {"recordedAt": datetime.now(timezone.utc).isoformat(), "exitCode": returncode,
                "status": "FAILED" if failed else "COMPLETED", "category": category,
                "brokerOutcome": "UNVERIFIED", "automaticRetry": False}
    (folder / "status.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print("FAST_CYCLE_CLAUDE_" + metadata["status"] + " category=" + category, flush=True)
    if failed:
        print("Private stdout/stderr retained in the Sable runtime executor-diagnostics folder. Reconcile any ambiguous broker outcome before retrying.", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(record(sys.argv[1], int(sys.argv[2])))
