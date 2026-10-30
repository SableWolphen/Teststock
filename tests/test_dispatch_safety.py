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

    def test_exit_fill_is_not_inferred_from_submitted_stop(self):
        """A submitted protective order is not evidence of a completed exit."""
        d = self.payload
        c = d["executorCapability"]
        evidence = c.get("optionExitEvidence") or {}
        if evidence.get("filledQuantity", 0) == 0:
            self.assertFalse(c.get("liveOptionExitVerifiedThisSession", False))
        if c.get("mode") == "MANUAL_ONLY_FAIL_CLOSED":
            self.assertFalse(c.get("optionEntryAllowed", False))
            self.assertFalse(c.get("equityEntryAllowed", False))

    def test_live_option_entry_requires_fresh_verified_exit(self):
        """A later fill must not silently turn on unattended entries."""
        c = self.payload["executorCapability"]
        if c.get("optionEntryAllowed") is True:
            self.assertTrue(c.get("capabilityFresh"))
            self.assertTrue(c.get("liveOrderSubmission"))
            self.assertTrue(c.get("liveOptionEntrySubmission"))
            self.assertTrue(c.get("liveOptionExitSubmission"))
            self.assertTrue(c.get("liveOptionExitVerifiedThisSession"))
            self.assertTrue(c.get("riskCreationAllowed"))

    def test_dispatch_requires_reconciliation(self):
        instruction = self.payload.get("actionInstruction", "").lower()
        self.assertIn("reconcile", instruction)
        self.assertIn("partial", instruction)
        self.assertIn("exit", instruction)


if __name__ == "__main__":
    unittest.main()
