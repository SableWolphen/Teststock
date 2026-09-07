"""Throttle Claude executor usage while preserving urgent risk exits.

The runner serializes cycles. Usage state lives outside the checkout so repository
resets cannot erase cooldowns or caps. Routine reviews are deliberately sparse,
new-risk wakes are capped, and urgent risk-reducing exits always bypass usage caps.
"""
import json
import os
import time
from datetime import datetime, timezone

REVIEW_INTERVAL_SECONDS = 15 * 60
ENTRY_INTERVAL_SECONDS = 2 * 60
MAX_NON_EXIT_PER_HOUR = 8
MAX_NON_EXIT_PER_UTC_DAY = 60


def _load(path):
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def _save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, separators=(',', ':')))
    os.replace(temporary, path)


def reserve_wake(path, actionable=False, routine=False, now=None, *, urgent_exit=False):
    """Reserve one Claude wake if policy allows it.

    Backward compatibility matters here: ``now`` remains the fourth positional
    argument used by the test suite and any older callers. ``urgent_exit`` is
    keyword-only so a timestamp can never be misinterpreted as permission to
    bypass usage limits.

    urgent_exit: stop/forced/risk-reducing exit; never delayed by credit caps.
    actionable: fresh entry/other dispatch; rate/cap limited.
    routine: active-position or crypto review; 15-minute cadence and cap limited.
    """
    now = time.time() if now is None else float(now)
    state = _load(path)
    attempts = [float(x) for x in state.get('nonExitAttempts', []) if isinstance(x, (int, float))]
    attempts = [x for x in attempts if 0 <= now - x < 86400]
    last_non_exit = state.get('lastNonExitAttemptAt')
    try:
        last_non_exit = float(last_non_exit)
    except (TypeError, ValueError):
        last_non_exit = None

    # Never let a usage budget delay getting risk off.
    if urgent_exit:
        state['lastUrgentExitAttemptAt'] = now
        state['nonExitAttempts'] = attempts
        _save(path, state)
        return True

    if not actionable and not routine:
        return False

    since_last = float('inf') if last_non_exit is None or now < last_non_exit else now - last_non_exit
    minimum_interval = ENTRY_INTERVAL_SECONDS if actionable else REVIEW_INTERVAL_SECONDS
    if since_last < minimum_interval:
        return False

    hourly = sum(1 for x in attempts if now - x < 3600)
    if hourly >= MAX_NON_EXIT_PER_HOUR or len(attempts) >= MAX_NON_EXIT_PER_UTC_DAY:
        return False

    attempts.append(now)
    state.update({
        'lastNonExitAttemptAt': now,
        'nonExitAttempts': attempts,
        'hourlyLimit': MAX_NON_EXIT_PER_HOUR,
        'dailyLimit': MAX_NON_EXIT_PER_UTC_DAY,
        'reviewIntervalSeconds': REVIEW_INTERVAL_SECONDS,
        'entryIntervalSeconds': ENTRY_INTERVAL_SECONDS,
        'updatedAt': datetime.fromtimestamp(now, timezone.utc).isoformat().replace('+00:00', 'Z'),
    })
    _save(path, state)
    return True
