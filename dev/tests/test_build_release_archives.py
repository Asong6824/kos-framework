import importlib.util
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile


SCRIPT = Path(__file__).resolve().parents[1] / "harness" / "build_release_archives.py"
SPEC = importlib.util.spec_from_file_location("build_release_archives", SCRIPT)
assert SPEC and SPEC.loader
archives = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(archives)


class BuildReleaseArchivesTests(unittest.TestCase):
    def test_archives_are_installable_and_preserve_utf8_names(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plugin = root / "plugin"
            mobile_plugin = root / "mobile-plugin"
            vault = root / "vault"
            plugin_agent = plugin / "kos-agent"
            installed_plugin = vault / ".obsidian" / "plugins" / "kos-companion"
            quick_start = vault / "90_系统" / "文档" / "00_快速开始.md"
            first_use = vault / "90_系统" / "文档" / "01_首次使用验收清单.md"
            sync_guide = vault / "90_系统" / "文档" / "65_多端同步.md"
            sync_troubleshooting = vault / "90_系统" / "文档" / "66_多端同步故障排查.md"

            plugin_agent.mkdir(parents=True)
            installed_plugin.mkdir(parents=True)
            quick_start.parent.mkdir(parents=True)
            for name in ("manifest.json", "main.js", "styles.css"):
                (plugin / name).write_text(name, encoding="utf-8")
            mobile_plugin.mkdir(parents=True)
            for name in ("manifest.json", "main.js", "styles.css", "INSTALL.md"):
                (mobile_plugin / name).write_text(name, encoding="utf-8")
            (plugin_agent / "host.mjs").write_text("", encoding="utf-8")
            (vault / ".kos.md").write_text("---\ntype: system\n---\n", encoding="utf-8")
            (installed_plugin / "manifest.json").write_text("{}", encoding="utf-8")
            quick_start.write_text("# 快速开始\n", encoding="utf-8")
            first_use.write_text("# 首次使用验收清单\n", encoding="utf-8")
            sync_guide.write_text("# 多端同步\n", encoding="utf-8")
            sync_troubleshooting.write_text("# 多端同步故障排查\n", encoding="utf-8")

            plugin_zip = root / "plugin.zip"
            mobile_plugin_zip = root / "mobile-plugin.zip"
            vault_zip = root / "vault.zip"
            archives.build_archive(plugin_zip, plugin)
            archives.build_archive(mobile_plugin_zip, mobile_plugin)
            archives.build_archive(vault_zip, vault, "kos-user-vault")
            archives.verify_archives(plugin_zip, mobile_plugin_zip, vault_zip)

            with ZipFile(plugin_zip) as archive:
                self.assertIn("manifest.json", archive.namelist())
                self.assertNotIn("kos-companion/manifest.json", archive.namelist())
            with ZipFile(vault_zip) as archive:
                self.assertIn(
                    "kos-user-vault/90_系统/文档/00_快速开始.md",
                    archive.namelist(),
                )
                self.assertIn(
                    "kos-user-vault/90_系统/文档/01_首次使用验收清单.md",
                    archive.namelist(),
                )
            with ZipFile(mobile_plugin_zip) as archive:
                self.assertIn("INSTALL.md", archive.namelist())
                self.assertFalse(any(name.startswith("kos-agent/") for name in archive.namelist()))


if __name__ == "__main__":
    unittest.main()
