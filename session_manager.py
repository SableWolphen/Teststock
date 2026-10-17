"""Optional read-only Robinhood session. No credentials are persisted."""
import logging
import os
import threading
import time

import pyotp
import robin_stocks.robinhood as rh

LOG = logging.getLogger(__name__)

class BrokerUnavailable(RuntimeError):
    pass

class SessionManager:
    """Read-only broker adapter. Live execution is deliberately disabled.

    Unofficial robin_stocks does not guarantee order atomicity or stop
    protection. Use officially supported APIs for production execution.
    """
    def __init__(self):
        self._lock = threading.RLock()
        self._session = None
        self._expires_at = 0.0

    def login(self):
        with self._lock:
            if self._session is not None and time.monotonic() < self._expires_at:
                return self._session
            username = os.environ.get("ROBINHOOD_USERNAME")
            password = os.environ.get("ROBINHOOD_PASSWORD")
            mfa_key = os.environ.get("ROBINHOOD_MFA_KEY")
            if not all((username, password, mfa_key)):
                raise BrokerUnavailable("Robinhood credentials are not configured")
            if os.environ.get("ALLOW_UNOFFICIAL_ROBINHOOD_LOGIN") != "true":
                raise BrokerUnavailable("Unofficial login is disabled by default")
            try:
                mfa_code = pyotp.TOTP(mfa_key).now()
                result = rh.login(
                    username=username,
                    password=password,
                    mfa_code=mfa_code,
                    store_session=False,
                    expiresIn=3600,
                )
                if not isinstance(result, dict) or not result.get("access_token"):
                    raise BrokerUnavailable("Broker authentication not confirmed")
                self._session = rh
                self._expires_at = time.monotonic() + 3000
                return rh
            except Exception as exc:
                self._session = None
                self._expires_at = 0.0
                LOG.error("Broker authentication failed (%s)", type(exc).__name__)
                raise BrokerUnavailable("Robinhood session unavailable") from None

    def account_snapshot(self):
        api = self.login()
        try:
            profile = api.profiles.load_account_profile()
            portfolio = api.profiles.load_portfolio_profile()
            equity = portfolio.get("equity")
            cash = profile.get("cash_available_for_withdrawal")
            # Withdrawal cash is conservative, but not proof of settled trading cash.
            # A live adapter must independently verify settled buying power.
            if equity is None or cash is None:
                raise BrokerUnavailable("Incomplete broker account snapshot")
            return {"equity": str(equity), "cash": str(cash),
                    "settled_cash_verified": False}
        except Exception:
            raise BrokerUnavailable("Broker snapshot unavailable") from None

    def execute(self, order):
        raise BrokerUnavailable(
            "LIVE_EXECUTION_DISABLED: no verified atomic entry/stop adapter"
        )
