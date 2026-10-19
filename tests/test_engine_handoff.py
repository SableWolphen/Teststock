import copy
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

from risk_validator import validate_trade, RiskRejected
from session_manager import SessionManager, BrokerUnavailable
from github_dispatcher import state_db, claim_handoff, run_once

NOW = datetime(2026, 10, 19, 15, 0, tzinfo=timezone.utc)
AT = NOW.isoformat()

def inputs(kind="stock"):
    proposal = dict(trade_id="logical-1", asset_type=kind, symbol="ABC", side="buy", generated_at=AT, entry_limit="10", stop_trigger="9")
    account = dict(source="SUPPORTED_ROBINHOOD_READS", as_of=AT, reconciled=True, cash_capacity_verified=True, daily_loss_verified=True, daily_halted=False, uncertain_orders=False, exposure_symbols=[], equity="10000", cash="1000", buying_power="2000", unleveraged_buying_power="1000", pending_buy_commitments="0", open_risk="0", gross_realized_loss="0", unrealized_loss="0")
    market = dict(source="ROBINHOOD", symbol="ABC", quote_at=AT, bid="9.99", ask="10", tradable=True, liquidity_verified=True, native_stop_supported=True, macro_verified=True, earnings_verified=True, regular_session=True, admission_state="MICRO_PROBATION", estimated_fee_per_unit="0", evidence_scope="STOCK_FORWARD", independent_samples=100, distinct_days=20, profit_factor="1.5", minutes_to_close=120)
    if kind == "option":
        proposal.update(option_id="exact-contract", position_effect="open", option_right="put", expiration="2026-10-30", strike="13.50", contract_multiplier=100, entry_limit="1", stop_trigger="0.6")
        market.update(evidence_scope="EXACT_CONTRACT", option_id="exact-contract", expiration="2026-10-30", strike="13.50", multiplier="100", bid="0.99", ask="1")
        account["equity"] = "20000"
    return proposal, account, market

class EngineRiskTests(unittest.TestCase):
    def test_paper_plan_has_no_broker_or_live_authority(self):
        p, a, m = inputs()
        plan = validate_trade(p, a, m, NOW)
        self.assertFalse(plan.broker_writes)
        self.assertFalse(plan.live_eligible)
        self.assertTrue(plan.confirmation_required)
        self.assertEqual(plan.quantity, "99")

    def test_full_option_premium_is_risk_not_guaranteed_stop_loss(self):
        p, a, m = inputs("option")
        plan = validate_trade(p, a, m, NOW)
        self.assertEqual(plan.quantity, "1")
        self.assertEqual(plan.maximum_planned_loss, "101.00")
        a["equity"] = "10000"
        with self.assertRaises(RiskRejected):
            validate_trade(p, a, m, NOW)

    def test_cash_reservations_fees_and_heat_reduce_size(self):
        p, a, m = inputs()
        a["pending_buy_commitments"] = "900"
        m["estimated_fee_per_unit"] = "0.50"
        self.assertEqual(validate_trade(p, a, m, NOW).quantity, "9")
        a["open_risk"] = "500"
        with self.assertRaises(RiskRejected):
            validate_trade(p, a, m, NOW)

    def test_unknown_or_unsafe_independent_state_fails_closed(self):
        for field, value in [("reconciled",False),("cash_capacity_verified",False),("daily_loss_verified",False),("uncertain_orders",True),("daily_halted",True),("cash",-1),("exposure_symbols",["ABC"]),("equity","NaN"),("cash",True)]:
            p,a,m=inputs();a[field]=value
            with self.subTest(field=field), self.assertRaises(RiskRejected):
                validate_trade(p,a,m,NOW)

    def test_market_protection_session_evidence_and_time_remain_required(self):
        for field,value in [("native_stop_supported",False),("liquidity_verified",False),("macro_verified",False),("earnings_verified",False),("regular_session",False),("admission_state","SHADOW_ONLY"),("quote_at",(NOW-timedelta(seconds=31)).isoformat()),("quote_at",(NOW+timedelta(microseconds=1)).isoformat()),("bid","8"),("symbol","OTHER")]:
            p,a,m=inputs();m[field]=value
            with self.subTest(field=field), self.assertRaises(RiskRejected):
                validate_trade(p,a,m,NOW)

    def test_option_identity_and_expiration_must_match_broker(self):
        for field,value in [("option_id","wrong"),("expiration","2026-10-19"),("strike","14"),("contract_multiplier",10),("side","sell")]:
            p,a,m=inputs("option");p[field]=value
            with self.subTest(field=field), self.assertRaises(RiskRejected):
                validate_trade(p,a,m,NOW)

    def test_evidence_floors_and_cutoffs_cannot_be_replaced_by_a_state_flag(self):
        for field,value in [("independent_samples",99),("distinct_days",19),("profit_factor","1.24"),("evidence_scope","CROSS_SECTIONAL_COHORT"),("minutes_to_close",19)]:
            p,a,m=inputs();m[field]=value
            with self.subTest(field=field),self.assertRaises(RiskRejected):validate_trade(p,a,m,NOW)

    def test_daily_losses_do_not_offset_with_gains_and_equality_halts(self):
        p,a,m=inputs();a.update(gross_realized_loss="50",unrealized_loss="30")
        with self.assertRaises(RiskRejected):validate_trade(p,a,m,NOW)
        a.update(gross_realized_loss="0",unrealized_loss="-1")
        with self.assertRaises(RiskRejected):validate_trade(p,a,m,NOW)

class PrivateSessionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.observation=dict(source="SUPPORTED_ROBINHOOD_READS",brokerWrites=False,generatedAt=AT,readStartedAt=AT,accountFingerprint="a"*64,policy={"liveExecutionEnabled":False},snapshot={"accountFingerprint":"a"*64,"positionsReadComplete":True,"orderHistoryReadComplete":True,"blockers":["ADVANCED_ORDER_COVERAGE_UNVERIFIED"]})
        self.status=dict(at=AT,brokerConnected=True,liveEnabled=False,protection={"blockers":["HOLDING_PROTECTION_UNVERIFIED"]})
        self.save()
    def tearDown(self):self.temp.cleanup()
    def save(self):
        (self.root/'engine-observation.json').write_text(json.dumps(self.observation))
        (self.root/'status.json').write_text(json.dumps(self.status))
    def test_private_observation_and_monitor_are_both_required(self):
        session=SessionManager(self.root);obs,status=session.independent_snapshot(NOW)
        self.assertIn("LIVE_DEPLOYMENT_LOCKED",session.execution_status(obs,status)["blockers"])
        for patch in [dict(generatedAt="2000-01-01T00:00:00Z"),dict(source="PUBLIC_GITHUB"),dict(accountFingerprint="b"*64),dict(accountFingerprint=None)]:
            original=copy.deepcopy(self.observation);self.observation.update(patch);self.save()
            with self.assertRaises(BrokerUnavailable):session.independent_snapshot(NOW)
            self.observation=original
    def test_failed_current_monitor_cannot_reuse_old_success(self):
        self.status["brokerConnected"]=False;self.save()
        with self.assertRaises(BrokerUnavailable):SessionManager(self.root).independent_snapshot(NOW)
    def test_private_review_prioritizes_unprotected_holding_without_order(self):
        with state_db(self.root/'test.sqlite3') as db:
            result=run_once(db,SessionManager(self.root),dispatch={"generatedAt":AT,"dispatchFingerprints":[]},observation=(self.observation,self.status),now=NOW)
        self.assertEqual(result["status"],"PROTECTION_REVIEW_REQUIRED");self.assertFalse(result["broker_writes"])
    def test_unbound_proposal_never_claims_or_hands_off(self):
        with state_db(self.root/'test.sqlite3') as db:
            result=run_once(db,SessionManager(self.root),dispatch={"generatedAt":AT,"dispatchFingerprints":[]},proposal={"fingerprint":"invented"},observation=(self.observation,self.status),now=NOW)
            self.assertEqual(result["reason"],"LIVE_DEPLOYMENT_LOCKED")
            self.assertEqual(db.execute('SELECT count(*) FROM handoffs').fetchone()[0],0)
    def test_exit_fingerprint_cannot_be_reused_as_an_entry(self):
        self.observation["policy"]={"liveExecutionEnabled":True,"maxOrderUsd":100}
        dispatch={"generatedAt":AT,"riskCreationBlockedByExecutor":False,"dispatchFingerprints":["exit"],"pendingAction":{"fingerprint":"exit","trigger":"TRIGGER_1_STOP","ticker":"ABC","assetClass":"STOCK"}}
        proposal={"fingerprint":"exit","dispatch_generated_at":AT,"symbol":"ABC","asset_type":"stock"}
        with state_db(self.root/'exit.sqlite3') as db:
            result=run_once(db,SessionManager(self.root),dispatch=dispatch,proposal=proposal,observation=(self.observation,self.status),now=NOW)
            self.assertEqual(result["reason"],"ENTRY_ACTION_IDENTITY_UNVERIFIED")
            self.assertEqual(db.execute('SELECT count(*) FROM handoffs').fetchone()[0],0)

    def test_durable_claim_deduplicates_parallel_handoffs_and_conflicts(self):
        file=self.root/'claims.sqlite3'
        with state_db(file):pass
        def claim(_):
            with state_db(file) as db:return claim_handoff(db,"same",{"id":1})
        with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(claim,range(8)))
        self.assertEqual(results.count('CLAIMED'),1)
        with state_db(file) as db:
            self.assertEqual(claim_handoff(db,"same",{"id":2}),"CONFLICTING_PAYLOAD")
            self.assertEqual(claim_handoff(db,"same",{"id":1}),"DUPLICATE")

if __name__ == '__main__':unittest.main()
