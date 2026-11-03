"""Tests for the independent risk governor."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import governor as g  # noqa: E402

DATA = {
    "claudebot/dip_config.json": {"enabled": True, "symbols": ["SPY", "XLK"], "risk": {"positionUsd": 25, "positionPctOfAccount": 20, "maxOpenPositions": 2, "minBuyingPowerAfterUsd": 1},
                                  "edges": {"double7": {"enabled": False, "symbols": ["XLE"]}}},
    "docs/data/claudebot-dip-ledger.json": {"positions": [{"symbol": "XLK", "usd": 25, "entryPrice": 174.68}]},
    "claudebot/optbuy_config.json": {"enabled": False, "risk": {"maxPremiumUsd": 50, "maxPctOfAccount": 43}},
    "docs/data/claudebot-optbuy-ledger.json": {"open": None},
    "docs/data/claudebot-ledger.json": {"open": None},
}
L = lambda rel, d=None: DATA.get(rel, d)
NOW = "2026-11-03T20:14:00Z"   # Tuesday 2:14 PM CT
BASE = {"accountNickname": "MCP", "accountValue": 117, "buyingPower": 92, "quoteAgeSec": 10, "now": NOW}


def chk(**kw):
    return g.check({**BASE, **kw}, L)


assert chk(desk="dip", side="buy", symbol="SPY", usd=25)["allow"]
assert chk(desk="dip", side="buy", symbol="SPY", usd=25, accountNickname="Individual")["allow"] is False
assert chk(desk="dip", side="buy", symbol="TSLA", usd=25)["allow"] is False              # not approved
assert chk(desk="dip", side="buy", symbol="XLE", usd=25)["allow"] is False               # edge not enabled
assert chk(desk="dip", side="buy", symbol="SPY", usd=60)["allow"] is False               # above cap
assert chk(desk="dip", side="buy", symbol="SPY", usd=25, quoteAgeSec=900)["allow"] is False   # stale
assert chk(desk="dip", side="buy", symbol="SPY", usd=25, now="2026-11-03T23:00:00Z")["allow"] is False  # closed
assert chk(desk="dip", side="buy", symbol="SPY", usd=25, accountValue=40)["allow"] is False   # floor
assert chk(desk="dip", side="sell", symbol="XLK", quantity="0.143")["allow"]
assert chk(desk="dip", side="sell", symbol="XLK", quantity="0.143", quoteAgeSec=99999)["allow"]   # exits on stale data ok
assert chk(desk="dip", side="sell", symbol="XLK", quantity="1.0")["allow"] is False       # more than bought
assert chk(desk="dip", side="sell", symbol="KO", quantity="1")["allow"] is False          # board's shares
assert chk(desk="dip", side="sell", symbol="SPY", quantity="0.1")["allow"] is False       # not held
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=40)["allow"] is False             # desk disabled
DATA["claudebot/optbuy_config.json"]["enabled"] = True
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=40)["allow"] is False            # no gatekeeper verdict
GK = {"pass": True, "live": True}
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=40, gatekeeper=GK)["allow"]
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=40, gatekeeper={"pass": True, "live": False})["allow"] is False   # paper verdict
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=60, gatekeeper=GK)["allow"] is False   # hard $50
DATA["claudebot/optbuy_config.json"]["risk"]["maxPremiumUsd"] = 500                        # loosened config...
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=60, gatekeeper=GK)["allow"] is False   # ...governor still says no
assert chk(desk="spread", side="buy", symbol="SPY", usd=10)["allow"] is False
assert chk(desk="crypto", side="buy", symbol="BTC", usd=10)["allow"] is False
DATA["docs/data/claudebot-dip-ledger.json"]["positions"].append({"symbol": "SPY", "usd": 25, "entryPrice": 600})
assert chk(desk="dip", side="buy", symbol="SPY", usd=25)["allow"] is False                # at max open (2)
print("governor tests passed")
