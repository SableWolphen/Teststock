"""Fail-closed regression checks for the published Teststock execution dispatch.

Run: python -m unittest discover -s tests -p 'test_dispatch_safety.py'
These tests do not connect to a broker or authorize live trading.
"""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DISPATCH = ROOT / "docs/data/execution-dispatch.json"


class DispatchSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = json.loads(DISPATCH.read_text(encoding="utf-8"))

    def test_no_entry_when_executor_unverified(self):
        d = self.payload
        c = d["executorCapability"]
        verified = (
            c.get("capabilityFresh") is True
            and c.get("liveOrderSubmission") is True
            and c.get("liveEquityExitSubmission") is True
            and c.get("liveOptionExitSubmission") is True
            and c.get("liveOptionExitVerifiedThisSession") is True
        )
        if not verified:
            self.assertFalse(c.get("riskCreationAllowed", False))
            self.assertFalse(c.get("equityEntryAllowed", False))
            self.assertFalse(c.get("optionEntryAllowed", False))

    def test_unhealthy_board_cannot_publish_live_entries(self):
        d = self.payload
        healthy = (
            d.get("monitorHealth") == "OK"
            and d.get("boardAgeMs", float("inf")) <= d.get("maximumBoardAgeMs", 0)
            and d.get("executorCapability", {}).get("capabilityFresh") is True
        )
        if not healthy:
            self.assertFalse(d.get("executorCapability", {}).get("riskCreationAllowed", False))
            self.assertFalse(d.get("chatgptShouldRun", False))
            self.assertFalse(d.get("automaticStockCandidates", []))
            self.assertFalse(d.get("optionCandidates", []))

    def test_pending_action_must_not_override_lock(self):
        d = self.payload
        if d.get("riskCreationBlockedByExecutor"):
            # Entry locks must preserve risk-reducing exit dispatches.
            actions = [d.get("pendingAction")] + d.get("queuedActions", [])
            for action in filter(None, actions):
                self.assertNotIn("BUY_TRIGGER", action.get("trigger", ""))
            for field in ("automaticStockCandidates", "seedLaneCandidates", "optionCandidates"):
                self.assertFalse(d.get(field, []))

    def test_dispatch_requires_reconciliation(self):
        instruction = self.payload.get("actionInstruction", "").lower()
        self.assertIn("reconcile", instruction)
        self.assertIn("partial", instruction)
        self.assertIn("exit", instruction)


if __name__ == "__main__":
    unittest.main()
