from __future__ import annotations

import hashlib
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
FRAMEWORK_VAULT = REPO_ROOT / "vault"
VERSION_FILE = REPO_ROOT / "VERSION"
ROOT_MARKERS = (".kos.md", ".hermes.md")

MANAGED_PATHS = [
    Path(".kos.md"),
    Path(".hermes.md"),
    Path("AGENTS.md"),
    Path("CLAUDE.md"),
    Path("README.md"),
    Path("25_个人操作画像"),
    Path("41_Skills/README.md"),
    Path("41_Skills/core"),
    Path("90_系统/规则"),
    Path("90_系统/模板"),
    Path("90_系统/harness"),
    Path("90_系统/evals/README.md"),
    Path("90_系统/evals/contracts"),
    Path("90_系统/evals/schemas"),
    Path("90_系统/evals/skills"),
    Path("90_系统/工作流"),
    Path("90_系统/文档"),
]

# Only this subtree is fully owned by the framework. Other managed directories
# may contain personal or integration extensions, so synchronization updates
# matching files but never removes target-only files from them.
AUTHORITATIVE_DELETE_PATHS = [
    Path("41_Skills/core"),
    Path("90_系统/harness"),
    Path("90_系统/evals/schemas"),
]

EXCLUDED_PARTS = {
    "__pycache__",
    "reports",
    "artifacts",
    "framework-backups",
}
EXCLUDED_SUFFIXES = {".pyc"}


@dataclass
class SyncDiff:
    added: list[Path]
    modified: list[Path]
    deleted: list[Path]

    @property
    def changed(self) -> bool:
        return bool(self.added or self.modified or self.deleted)


def framework_version() -> str:
    return VERSION_FILE.read_text(encoding="utf-8").strip()


def is_excluded(path: Path) -> bool:
    return any(part in EXCLUDED_PARTS for part in path.parts) or path.suffix in EXCLUDED_SUFFIXES


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def managed_files(root: Path) -> dict[Path, str]:
    files: dict[Path, str] = {}
    for managed in MANAGED_PATHS:
        absolute = root / managed
        if absolute.is_file():
            if not is_excluded(managed):
                files[managed] = hash_file(absolute)
            continue
        if not absolute.is_dir():
            continue
        for path in sorted(absolute.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(root)
            if is_excluded(rel):
                continue
            files[rel] = hash_file(path)
    return files


def compare(target: Path) -> SyncDiff:
    source_files = managed_files(FRAMEWORK_VAULT)
    target_files = managed_files(target)
    added = sorted(path for path in source_files if path not in target_files)
    modified = sorted(
        path
        for path in source_files
        if path in target_files and source_files[path] != target_files[path]
    )
    deleted = sorted(
        path
        for path in target_files
        if path not in source_files
        and any(path == root or root in path.parents for root in AUTHORITATIVE_DELETE_PATHS)
    )
    return SyncDiff(added=added, modified=modified, deleted=deleted)


def backup_files(target: Path, paths: list[Path]) -> Path | None:
    existing = [path for path in paths if (target / path).is_file()]
    if not existing:
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_root = target / "90_系统/framework-backups" / stamp
    for rel in existing:
        destination = backup_root / rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target / rel, destination)
    return backup_root


def remove_empty_managed_dirs(target: Path) -> None:
    for managed in MANAGED_PATHS:
        root = target / managed
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*"), reverse=True):
            if path.is_dir() and not any(path.iterdir()):
                path.rmdir()


def write_manifest(target: Path) -> Path:
    manifest = target / "90_系统/framework.yaml"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    synced_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    manifest.write_text(
        "\n".join(
            [
                "framework: kos-framework",
                f'version: "{framework_version()}"',
                f'synced_at: "{synced_at}"',
                "sync_direction: framework_to_personal",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return manifest


def apply_sync(target: Path, diff: SyncDiff) -> Path | None:
    backup_root = backup_files(target, diff.modified + diff.deleted)
    for rel in diff.added + diff.modified:
        source = FRAMEWORK_VAULT / rel
        destination = target / rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    for rel in diff.deleted:
        path = target / rel
        if path.is_file():
            path.unlink()
    remove_empty_managed_dirs(target)
    write_manifest(target)
    return backup_root


def ensure_vault(path: Path) -> None:
    if not path.is_dir() or not any((path / marker).is_file() for marker in ROOT_MARKERS):
        raise SystemExit(f"Not a kos vault: {path}")
