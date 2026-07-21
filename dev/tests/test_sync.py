from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "dev/harness"))

from framework_sync import FRAMEWORK_VAULT, apply_sync, compare, ensure_vault  # noqa: E402


class FrameworkSyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.target = Path(self.tempdir.name) / "kos"
        shutil.copytree(FRAMEWORK_VAULT, self.target)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_clean_copy_has_no_diff(self) -> None:
        diff = compare(self.target)
        self.assertFalse(diff.changed)

    def test_detects_modified_and_stale_core_files(self) -> None:
        skill = self.target / "41_Skills/core/kos-ingest/SKILL.md"
        skill.write_text(skill.read_text(encoding="utf-8") + "\nlocal edit\n", encoding="utf-8")
        stale = self.target / "41_Skills/core/stale-skill/SKILL.md"
        stale.parent.mkdir(parents=True)
        stale.write_text("stale", encoding="utf-8")

        diff = compare(self.target)
        self.assertIn(Path("41_Skills/core/kos-ingest/SKILL.md"), diff.modified)
        self.assertIn(Path("41_Skills/core/stale-skill/SKILL.md"), diff.deleted)

    def test_apply_preserves_personal_content_and_creates_backup(self) -> None:
        personal = self.target / "23_日记/2026/06/2026-06-21.md"
        personal.parent.mkdir(parents=True)
        personal.write_text("personal", encoding="utf-8")

        skill = self.target / "41_Skills/core/kos-ingest/SKILL.md"
        original = skill.read_text(encoding="utf-8")
        skill.write_text(original + "\nlocal edit\n", encoding="utf-8")

        diff = compare(self.target)
        backup = apply_sync(self.target, diff)

        self.assertEqual(skill.read_text(encoding="utf-8"), original)
        self.assertEqual(personal.read_text(encoding="utf-8"), "personal")
        self.assertIsNotNone(backup)
        self.assertTrue((self.target / "90_系统/framework.yaml").is_file())

    def test_target_only_legacy_harness_extension_is_deleted(self) -> None:
        extension = self.target / "90_系统/harness/personal_integration.py"
        extension.parent.mkdir(parents=True)
        extension.write_text("integration", encoding="utf-8")

        diff = compare(self.target)

        self.assertIn(Path("90_系统/harness/personal_integration.py"), diff.deleted)

    def test_sync_accepts_kos_marker_without_hermes_marker(self) -> None:
        (self.target / ".hermes.md").unlink()

        try:
            ensure_vault(self.target)
        except SystemExit as exc:  # pragma: no cover - assertion path
            self.fail(f"ensure_vault rejected a .kos.md vault: {exc}")

    def test_sync_adds_missing_generic_vault_context(self) -> None:
        (self.target / ".kos.md").unlink()

        diff = compare(self.target)

        self.assertIn(Path(".kos.md"), diff.added)


if __name__ == "__main__":
    unittest.main()
