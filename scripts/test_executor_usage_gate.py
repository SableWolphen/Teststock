import tempfile
import unittest
from pathlib import Path
from executor_usage_gate import reserve_wake


class UsageGateTests(unittest.TestCase):
    def test_idle_never_calls_claude(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'usage.json'
            self.assertFalse(reserve_wake(path, False, False, 1000))
            self.assertFalse(path.exists())

    def test_repeated_position_or_crypto_checks_are_throttled(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'usage.json'
            results = [reserve_wake(path, False, True, t) for t in range(1000, 4600, 45)]
            self.assertEqual(sum(results), 4)

    def test_entries_are_throttled_but_urgent_exits_bypass(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'usage.json'
            self.assertTrue(reserve_wake(path, False, True, 1000))
            self.assertFalse(reserve_wake(path, True, False, 1045))
            self.assertTrue(reserve_wake(path, True, False, 1120))
            self.assertTrue(reserve_wake(path, False, False, 1130, urgent_exit=True))
            self.assertFalse(reserve_wake(path, False, True, 1900))
            self.assertTrue(reserve_wake(path, False, True, 2020))


if __name__ == '__main__':
    unittest.main()
