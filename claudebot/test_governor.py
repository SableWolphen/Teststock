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
assert chk(desk="dip", side="buy", symbol="XLK", usd=25)["allow"] is False   # duplicate holding
assert chk(desk="dip", side="buy", symbol="SPY", usd=float("nan"))["allow"] is False
assert chk(desk="dip", side="buy", symbol="SPY", usd=25, buyingPower=float("nan"))["allow"] is False
assert chk(desk="dip", side="buy", symbol="SPY", usd=25, quoteAgeSec=float("nan"))["allow"] is False
assert chk(desk="dip", side="buy", symbol="SPY", usd=60)["allow"] is False               # above cap
assert chk(desk="dip", side="buy", symbol="SPY", usd=25, quoteAgeSec=900)["allow"] is False   # stale
assert chk(desk="dip", side="buy", symbol="SPY", usd=25, now="2026-11-03T23:00:00Z")["allow"] is False  # closed
assert chk(desk="dip", side="buy", symbol="SPY", usd=25, accountValue=40)["allow"] is False   # floor
assert chk(desk="dip", side="sell", symbol="XLK", quantity="0.143")["allow"]
assert chk(desk="dip", side="sell", symbol="XLK", quantity="0.143", quoteAgeSec=99999)["allow"]   # exits on stale data ok
assert chk(desk="dip", side="sell", symbol="XLK", quantity="nan")["allow"] is False
assert chk(desk="dip", side="sell", symbol="XLK", quantity="-1")["allow"] is False
assert chk(desk="dip", side="sell", symbol="XLK", quantity="1.0")["allow"] is False       # more than bought
assert chk(desk="dip", side="sell", symbol="KO", quantity="1")["allow"] is False          # board's shares
assert chk(desk="dip", side="sell", symbol="SPY", quantity="0.1")["allow"] is False       # not held
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=40)["allow"] is False             # desk disabled
DATA["claudebot/optbuy_config.json"]["enabled"] = True
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=40)["allow"] is False            # no gatekeeper verdict
GK = {"pass": True, "live": True}
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=40, gatekeeper=GK)["allow"]
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=40, gatekeeper={"pass": True, "live": False})["allow"] is False   # paper verdict
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=60, gatekeeper=GK)["allow"] is False   # $60 is more than the free cash ($92 - $1 is fine, but the config cap applies here)
DATA["claudebot/optbuy_config.json"]["risk"]["maxPremiumUsd"] = 500                        # loosened config...
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=60, gatekeeper=GK)["allow"] is False   # ...governor still says no
# board 2026-11-11: up to 3 options at once, never two on one stock, all together under 65% of the account
DATA["claudebot/optbuy_config.json"]["risk"].update({"maxPremiumUsd": 25, "maxPctOfAccount": 22, "maxOpenPositions": 3, "maxTotalPctOfAccount": 65})
_op = lambda s_, px: {"symbol": s_, "id": s_, "entryPrice": px}
DATA["docs/data/claudebot-optbuy-ledger.json"] = {"positions": [_op("F", 0.24)]}
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=24, gatekeeper=GK)["allow"]                 # second option: allowed
assert chk(desk="optbuy", side="buy", symbol="F", usd=20, gatekeeper=GK)["allow"] is False          # same stock twice
DATA["docs/data/claudebot-optbuy-ledger.json"] = {"positions": [_op("F", 0.24), _op("T", 0.24), _op("Q", 0.24)]}
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=10, gatekeeper=GK)["allow"] is False        # a fourth
DATA["claudebot/optbuy_config.json"]["risk"]["maxOpenPositions"] = 9
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=10, gatekeeper=GK)["allow"] is False        # hard limit of 3 holds even if the config says 9
DATA["docs/data/claudebot-optbuy-ledger.json"] = {"positions": [_op("F", 0.25), _op("T", 0.25)]}
DATA["claudebot/optbuy_config.json"]["risk"]["maxOpenPositions"] = 3
assert chk(desk="optbuy", side="buy", symbol="SPY", usd=25, gatekeeper=GK, accountValue=100)["allow"] is False   # $75 > 65% of $100
assert chk(desk="optbuy", side="sell", symbol="T", quantity="1")["allow"]                           # selling one the bot holds
DATA["docs/data/claudebot-optbuy-ledger.json"] = {"open": None}
assert chk(desk="spread", side="buy", symbol="SPY", usd=10)["allow"] is False
# park the idle cash in VOO (board 2026-11-20)
_saved = {k: DATA.get(k) for k in ("claudebot/dip_config.json", "docs/data/claudebot-dip-ledger.json")}
DATA["claudebot/dip_config.json"] = {**(DATA.get("claudebot/dip_config.json") or {}), "risk": {"park": {"enabled": True, "symbol": "VOO"}}}
DATA["docs/data/claudebot-dip-ledger.json"] = {"park": None}
assert chk(desk="park", side="buy", symbol="VOO", usd=60, buyingPower=65)["allow"]
assert chk(desk="park", side="buy", symbol="TQQQ", usd=10, buyingPower=65)["allow"] is False
assert chk(desk="park", side="buy", symbol="VOO", usd=65, buyingPower=65)["allow"] is False      # must leave $1
assert chk(desk="park", side="sell", symbol="VOO", quantity="0.1")["allow"] is False              # nothing parked
DATA["docs/data/claudebot-dip-ledger.json"] = {"park": {"symbol": "VOO", "qty": 0.1}}
assert chk(desk="park", side="sell", symbol="VOO", quantity="0.1")["allow"]
for _k, _v in _saved.items():
    if _v is None: DATA.pop(_k, None)
    else: DATA[_k] = _v
# live spreads (board 2026-11-19)
DATA["claudebot/options_config.json"] = {"enabled": True, "boardApproval": {"approvalId": "x"}, "underlyings": ["SPY", "IWM"], "entry": {"widthUsd": 1}, "risk": {"maxLossPctOfAccount": 80, "noNewEntryDates": {"2026-11-04": "x"}}}
DATA["docs/data/claudebot-options-ledger.json"] = {"mode": "paper", "open": None}
assert chk(desk="spread", side="buy", symbol="SPY", usd=86, accountValue=120, buyingPower=110)["allow"] is False   # paper ledger
DATA["docs/data/claudebot-options-ledger.json"]["mode"] = "live"
assert chk(desk="spread", side="buy", symbol="SPY", usd=86, accountValue=120, buyingPower=110)["allow"]
assert chk(desk="spread", side="buy", symbol="SPY", usd=86, accountValue=81, buyingPower=110)["allow"] is False    # $86 > 80% of $81
assert chk(desk="spread", side="buy", symbol="SPY", usd=86, accountValue=120, buyingPower=50)["allow"] is False    # not enough cash
assert chk(desk="spread", side="buy", symbol="QQQ", usd=86, accountValue=120, buyingPower=110)["allow"] is False   # not on the list
assert chk(desk="spread", side="buy", symbol="SPY", usd=86, accountValue=120, buyingPower=110, now="2026-11-04T18:00:00Z")["allow"] is False   # event pause
DATA["docs/data/claudebot-options-ledger.json"]["open"] = {"underlying": "SPY"}
assert chk(desk="spread", side="buy", symbol="IWM", usd=86, accountValue=120, buyingPower=110)["allow"] is False   # one at a time
assert chk(desk="spread", side="sell", symbol="SPY", quantity="1")["allow"]
assert chk(desk="spread", side="sell", symbol="IWM", quantity="1")["allow"] is False
assert chk(desk="crypto", side="buy", symbol="BTC", usd=10)["allow"] is False
DATA["docs/data/claudebot-dip-ledger.json"]["positions"].append({"symbol": "SPY", "usd": 25, "entryPrice": 600})
assert chk(desk="dip", side="buy", symbol="SPY", usd=25)["allow"] is False                # at max open (2)
print("governor tests passed")
