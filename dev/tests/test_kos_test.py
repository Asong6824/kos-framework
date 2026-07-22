from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "dev/harness"))

from kos_test import KosTestError, build_pi_argv, prepare_test_vault  # noqa: E402


class KosTestVaultTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.target = Path(self.tempdir.name) / "kos-test"

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_prepare_creates_marked_pi_enabled_test_vault(self) -> None:
        prepare_test_vault(self.target)

        marker = json.loads((self.target / ".kos-test.json").read_text(encoding="utf-8"))
        settings = json.loads(
            (self.target / ".pi/settings.json").read_text(encoding="utf-8")
        )

        self.assertEqual(marker["kind"], "kos-test-vault")
        self.assertEqual(marker["source_framework"], str(REPO_ROOT))
        self.assertEqual(settings["skills"], ["../80_Skills/core"])
        self.assertTrue((self.target / ".pi/APPEND_SYSTEM.md").is_file())
        self.assertIn(
            "sync_direction: framework_to_test",
            (self.target / "90_系统/framework.yaml").read_text(encoding="utf-8"),
        )

    def test_refresh_restores_framework_content_and_preserves_test_content(self) -> None:
        prepare_test_vault(self.target)
        managed = self.target / "80_Skills/core/kos-ingest/SKILL.md"
        expected = managed.read_text(encoding="utf-8")
        managed.write_text(expected + "\ntest mutation\n", encoding="utf-8")
        test_note = self.target / "40_日记/test-note.md"
        test_note.write_text("keep me", encoding="utf-8")

        prepare_test_vault(self.target)

        self.assertEqual(managed.read_text(encoding="utf-8"), expected)
        self.assertEqual(test_note.read_text(encoding="utf-8"), "keep me")

    def test_prepare_refuses_unmarked_nonempty_directory(self) -> None:
        self.target.mkdir()
        (self.target / "personal.md").write_text("do not touch", encoding="utf-8")

        with self.assertRaises(KosTestError):
            prepare_test_vault(self.target)

        self.assertEqual((self.target / "personal.md").read_text(encoding="utf-8"), "do not touch")

    def test_prepare_refuses_file_target(self) -> None:
        self.target.write_text("do not replace", encoding="utf-8")

        with self.assertRaises(KosTestError):
            prepare_test_vault(self.target)

        self.assertEqual(self.target.read_text(encoding="utf-8"), "do not replace")

    def test_pi_argv_isolates_core_skills(self) -> None:
        argv = build_pi_argv("/usr/local/bin/pi", self.target, ["--", "--verbose"])

        self.assertEqual(argv[0], "/usr/local/bin/pi")
        self.assertIn("--no-skills", argv)
        self.assertEqual(
            argv[argv.index("--skill") + 1],
            str(self.target / "80_Skills/core"),
        )
        self.assertEqual(argv[-1], "--verbose")

    def test_reset_rebuilds_only_a_marked_test_vault(self) -> None:
        prepare_test_vault(self.target)
        disposable = self.target / "disposable.md"
        disposable.write_text("remove me", encoding="utf-8")

        prepare_test_vault(self.target, reset=True)

        self.assertFalse(disposable.exists())
        self.assertTrue((self.target / ".kos-test.json").is_file())

        shutil.rmtree(self.target)
        self.target.mkdir()
        (self.target / "personal.md").write_text("keep", encoding="utf-8")
        with self.assertRaises(KosTestError):
            prepare_test_vault(self.target, reset=True)


if __name__ == "__main__":
    unittest.main()
