"""Catch GitHub Actions YAML errors before workflows silently fail with zero jobs.

A bare YAML scalar such as run: echo 'message: detail' is invalid because the
colon-space is parsed as a mapping delimiter despite shell quote marks.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parent.parent
INLINE_RUN = re.compile(r"^\s*run:\s+(.+?)\s*$")


class WorkflowYamlSanity(unittest.TestCase):
    def test_inline_run_does_not_contain_unquoted_colon_space(self):
        workflows = sorted((ROOT / ".github" / "workflows").glob("*.yml"))
        self.assertGreater(len(workflows), 0)
        for path in workflows:
            for number, line in enumerate(path.read_text().splitlines(), 1):
                match = INLINE_RUN.match(line)
                if not match:
                    continue
                value = match.group(1)
                if value.startswith(("|", ">", "'", '"')):
                    continue
                with self.subTest(workflow=path.name, line=number):
                    self.assertNotIn(": ", value,
                        "Inline shell commands with ': ' need a block scalar (run: |)")


if __name__ == "__main__":
    unittest.main()
