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
        skill = self.target / "80_Skills/core/kos-ingest/SKILL.md"
        skill.write_text(skill.read_text(encoding="utf-8") + "\nlocal edit\n", encoding="utf-8")
        stale = self.target / "80_Skills/core/stale-skill/SKILL.md"
        stale.parent.mkdir(parents=True)
        stale.write_text("stale", encoding="utf-8")

        diff = compare(self.target)
        self.assertIn(Path("80_Skills/core/kos-ingest/SKILL.md"), diff.modified)
        self.assertIn(Path("80_Skills/core/stale-skill/SKILL.md"), diff.deleted)

    def test_apply_preserves_personal_content_and_creates_backup(self) -> None:
        personal = self.target / "40_日记/2026/06/2026-06-21.md"
        personal.parent.mkdir(parents=True)
        personal.write_text("personal", encoding="utf-8")

        skill = self.target / "80_Skills/core/kos-ingest/SKILL.md"
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

    def test_sync_rejects_layout_v1_before_writing(self) -> None:
        manifest = self.target / "90_系统/framework.yaml"
        manifest.write_text(
            manifest.read_text(encoding="utf-8").replace("layout_version: 2\n", ""),
            encoding="utf-8",
        )
        sentinel = self.target / "80_Skills/core/kos-ingest/SKILL.md"
        original = sentinel.read_text(encoding="utf-8")

        with self.assertRaisesRegex(SystemExit, "kos-harness migrate-layout"):
            compare(self.target)

        self.assertEqual(sentinel.read_text(encoding="utf-8"), original)

    def test_sync_manifest_keeps_layout_version(self) -> None:
        diff = compare(self.target)
        apply_sync(self.target, diff)

        manifest = (self.target / "90_系统/framework.yaml").read_text(encoding="utf-8")
        self.assertIn("layout_version: 2", manifest)

    def test_sync_restores_missing_required_empty_directory(self) -> None:
        archive = self.target / "32_任务/归档"
        shutil.rmtree(archive)

        diff = compare(self.target)

        self.assertIn(Path("32_任务/归档"), diff.added_directories)
        apply_sync(self.target, diff)
        self.assertTrue(archive.is_dir())


if __name__ == "__main__":
    unittest.main()
