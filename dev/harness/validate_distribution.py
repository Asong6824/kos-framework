#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPO_ROOT / "dev/specs/distribution-manifest.yaml"


def visible_files(path: Path) -> list[Path]:
    if not path.exists():
        return []
    return [item for item in path.rglob("*") if item.is_file() and item.name != ".gitkeep"]


def main() -> int:
    manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
    root = REPO_ROOT / manifest["distribution_root"]
    errors: list[str] = []

    if not root.is_dir():
        errors.append(f"distribution root missing: {root}")
    for rel in manifest.get("required_paths", []):
        if not (root / rel).exists():
            errors.append(f"required path missing: {rel}")
    for rel in manifest.get("forbidden_runtime_directories", []):
        if (root / rel).exists():
            errors.append(f"development directory leaked into runtime: {rel}")
    forbidden_parts = set(manifest.get("forbidden_parts", []))
    for path in root.rglob("*"):
        if any(part in forbidden_parts for part in path.relative_to(root).parts):
            errors.append(f"generated path leaked into runtime: {path.relative_to(root)}")
    for pattern in manifest.get("forbidden_generated_paths", []):
        for path in root.glob(pattern):
            errors.append(f"generated artifact leaked into runtime: {path.relative_to(root)}")
    for rel in manifest.get("runtime_empty_extension_dirs", []):
        files = visible_files(root / rel)
        if files:
            errors.append(f"core distribution contains extension files under {rel}: {files}")

    framework_manifest = yaml.safe_load((root / "90_系统/framework.yaml").read_text(encoding="utf-8"))
    version = (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()
    if manifest.get("version") != version:
        errors.append("distribution manifest version does not match VERSION")
    if framework_manifest.get("version") != version:
        errors.append("vault framework.yaml version does not match VERSION")

    if errors:
        print("Distribution validation failed")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Distribution validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
