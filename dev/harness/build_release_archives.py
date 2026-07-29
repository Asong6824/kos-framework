#!/usr/bin/env python3
"""Build user-facing ZIP archives with portable UTF-8 filenames."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[2]
PLUGIN_DIR = ROOT / "release" / "kos-companion"
RELEASE_DIR = ROOT / "release"


def add_tree(archive: ZipFile, source: Path, prefix: str = "") -> None:
    for path in sorted(source.rglob("*")):
        if path.name == ".DS_Store" or "__pycache__" in path.parts:
            continue
        relative = path.relative_to(source)
        archive_name = (Path(prefix) / relative).as_posix()
        if path.is_dir():
            archive.writestr(f"{archive_name}/", b"")
        else:
            archive.write(path, archive_name)


def build_archive(path: Path, source: Path, prefix: str = "") -> None:
    path.unlink(missing_ok=True)
    with ZipFile(path, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        add_tree(archive, source, prefix)


def verify_archives(plugin_archive: Path, vault_archive: Path) -> None:
    with ZipFile(plugin_archive) as archive:
        names = set(archive.namelist())
        archive.testzip()
        required = {"manifest.json", "main.js", "styles.css", "kos-agent/"}
        missing = required - names
        if missing:
            raise RuntimeError(f"plugin archive is missing: {', '.join(sorted(missing))}")
        if "kos-companion/manifest.json" in names:
            raise RuntimeError("plugin archive contains an unexpected outer kos-companion directory")

    with ZipFile(vault_archive) as archive:
        names = set(archive.namelist())
        archive.testzip()
        required = {
            "kos-user-vault/.kos.md",
            "kos-user-vault/.obsidian/plugins/kos-companion/manifest.json",
            "kos-user-vault/90_系统/文档/00_快速开始.md",
        }
        missing = required - names
        if missing:
            raise RuntimeError(f"Vault archive is missing: {', '.join(sorted(missing))}")
        if not any(name == "kos-user-vault/90_系统/" for name in names):
            raise RuntimeError("Vault archive did not preserve UTF-8 directory names")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("vault", type=Path, help="installed Vault to package")
    args = parser.parse_args()

    vault = args.vault.resolve()
    if not (vault / ".kos.md").is_file():
        parser.error(f"not a kos Vault: {vault}")
    if not (PLUGIN_DIR / "manifest.json").is_file():
        parser.error("release/kos-companion has not been built")

    manifest = json.loads((PLUGIN_DIR / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    plugin_archive = RELEASE_DIR / f"kos-companion-{version}.zip"
    vault_archive = RELEASE_DIR / f"kos-vault-{version}.zip"

    build_archive(plugin_archive, PLUGIN_DIR)
    build_archive(vault_archive, vault, "kos-user-vault")
    verify_archives(plugin_archive, vault_archive)

    checksums = RELEASE_DIR / "SHA256SUMS"
    checksums.write_text(
        f"{sha256(plugin_archive)}  {plugin_archive.name}\n"
        f"{sha256(vault_archive)}  {vault_archive.name}\n",
        encoding="utf-8",
    )
    print(plugin_archive)
    print(vault_archive)
    print(checksums)


if __name__ == "__main__":
    main()
