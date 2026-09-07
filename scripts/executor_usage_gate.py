"""Throttle routine Claude reviews; event dispatches remain immediate.

The runner serializes cycles. Reserve before invocation, including failed calls,
and store outside the checkout so resets cannot erase the cooldown.
"""
import json
import os
import time

REVIEW_INTERVAL_SECONDS = 15 * 60


def reserve_wake(path, actionable, routine, now=None):
    now = time.time() if now is None else now
    try:
        last = float(json.loads(path.read_text())['lastAttemptAt'])
    except (OSError, ValueError, KeyError, TypeError):
        last = None
    # Event-driven exits and entries never wait for a routine-review cooldown.
    due = last is None or now < last or now - last >= REVIEW_INTERVAL_SECONDS
    if not actionable and not (routine and due):
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps({'lastAttemptAt': now}))
    os.replace(temporary, path)
    return True
