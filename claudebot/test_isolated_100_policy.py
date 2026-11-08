"""Deterministic unit checks for the isolated experiment policy."""
import unittest
from isolated_100_policy import decide_entry, decide_exit

def ready():
    return dict(mode="PAPER",reconciled=True,account_type="cash",
        external_cash_isolated=True,open_orders_reconciled=True,market_open=True,
        kill_switch=False,experiment_equity_usd="100",experiment_exposure_usd="0",
        experiment_settled_cash_usd="100",pending_buy_notional_usd="0",
        open_position_count=0,new_orders_this_week=0,realized_profit_usd="0",
        duplicate_order_key=False,owned_quantities={"XLK":"0.25"})
def buy():
    return dict(side="buy",asset_class="unleveraged_etf",fractional_eligible=True,
        liquid=True,signal_validated=True,earnings_safe=True,notional_usd="25",
        quote_age_seconds=12,risk_usd="1",symbol="XLK")
class GateTests(unittest.TestCase):
    def test_paper_buy(self): self.assertTrue(decide_entry(ready(),buy())["allowed"])
    def test_no_live(self):
        s=ready();s["mode"]="LIVE"
        self.assertFalse(decide_entry(s,buy())["allowed"])
    def test_no_external_cash(self):
        s=ready();s["external_cash_isolated"]=False
        self.assertFalse(decide_entry(s,buy())["allowed"])
    def test_max_position(self):
        p=buy();p["notional_usd"]=26
        self.assertFalse(decide_entry(ready(),p)["allowed"])
    def test_combined_position(self):
        s=ready();s["experiment_exposure_usd"]=30
        self.assertFalse(decide_entry(s,buy())["allowed"])
    def test_pending_order_cap(self):
        s=ready();s["pending_buy_notional_usd"]=30
        self.assertFalse(decide_entry(s,buy())["allowed"])
    def test_settled_cash_only(self):
        s=ready();s["experiment_settled_cash_usd"]=10
        self.assertFalse(decide_entry(s,buy())["allowed"])
    def test_floor(self):
        s=ready();s["experiment_equity_usd"]=80
        self.assertFalse(decide_entry(s,buy())["allowed"])
    def test_quote_age(self):
        p=buy();p["quote_age_seconds"]=181
        self.assertFalse(decide_entry(ready(),p)["allowed"])
    def test_duplicate(self):
        s=ready();s["duplicate_order_key"]=True
        self.assertFalse(decide_entry(s,buy())["allowed"])
    def test_weekly_limit(self):
        s=ready();s["new_orders_this_week"]=2
        self.assertFalse(decide_entry(s,buy())["allowed"])
    def test_missing_state(self):
        s=ready();s.pop("experiment_settled_cash_usd")
        self.assertFalse(decide_entry(s,buy())["allowed"])
    def test_bad_number(self):
        p=buy();p["notional_usd"]="nan"
        self.assertFalse(decide_entry(ready(),p)["allowed"])
    def test_protective_exit_below_floor(self):
        s=ready();s["experiment_equity_usd"]=70
        self.assertTrue(decide_exit(s,dict(side="sell",symbol="XLK",quantity="0.2"))["allowed"])
    def test_cannot_sell_other_holdings(self):
        self.assertFalse(decide_exit(ready(),dict(side="sell",symbol="KO",quantity="1"))["allowed"])
    def test_cannot_oversell(self):
        self.assertFalse(decide_exit(ready(),dict(side="sell",symbol="XLK",quantity="0.3"))["allowed"])
if __name__=="__main__":unittest.main()
