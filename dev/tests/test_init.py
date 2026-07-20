from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
INIT_SCRIPT = REPO_ROOT / "dev/harness/init_vault.py"


class InitVaultTests(unittest.TestCase):
    def test_fresh_vault_passes_path_validation_before_report_generation(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            target = Path(tempdir) / "kos"
            init_result = subprocess.run(
                [sys.executable, str(INIT_SCRIPT), str(target)],
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(init_result.returncode, 0, init_result.stdout + init_result.stderr)
            self.assertTrue((target / "90_系统/harness/reports").is_dir())

            validation_result = subprocess.run(
                [
                    sys.executable,
                    str(target / "90_系统/harness/validate_paths.py"),
                    "--root",
                    str(target),
                ],
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(
                validation_result.returncode,
                0,
                validation_result.stdout + validation_result.stderr,
            )


if __name__ == "__main__":
    unittest.main()
