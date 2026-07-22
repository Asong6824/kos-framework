from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
RUNNER = REPO_ROOT / "agent/packages/kos-agent/dist/kos-cli.js"


class SkillEvalRunnerTests(unittest.TestCase):
    def test_empty_suite_is_no_cases_not_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            (root / ".kos.md").write_text("# test\n", encoding="utf-8")
            (root / "80_Skills").mkdir()
            (root / "90_系统/evals/skills").mkdir(parents=True)

            completed = subprocess.run(
                ["node", str(RUNNER), "skill-eval", "--root", str(root), "--format", "json"],
                text=True,
                capture_output=True,
                check=False,
            )

        self.assertEqual(completed.returncode, 2, completed.stdout + completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertEqual(payload["kind"], "skill_contract_eval")
        self.assertEqual(payload["status"], "no_cases")
        self.assertFalse(payload["overall_pass"])
        self.assertEqual(payload["case_count"], 0)


if __name__ == "__main__":
    unittest.main()
