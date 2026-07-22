#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from framework_sync import apply_sync, compare, ensure_vault, framework_version


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Synchronize kos-framework core into a personal kos vault.")
    parser.add_argument("target", help="Personal kos vault path.")
    parser.add_argument("--apply", action="store_true", help="Apply changes. Default is dry-run.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    target = Path(args.target).expanduser().resolve()
    ensure_vault(target)
    diff = compare(target)

    print(f"Framework version: {framework_version()}")
    print(f"Target: {target}")
    print(f"Add: {len(diff.added)}")
    print(f"Update: {len(diff.modified)}")
    print(f"Delete: {len(diff.deleted)}")
    print(f"Add directories: {len(diff.added_directories)}")
    for label, paths in [("ADD_DIR", diff.added_directories), ("ADD", diff.added), ("UPDATE", diff.modified), ("DELETE", diff.deleted)]:
        for path in paths:
            print(f"{label} {path}")

    if not args.apply:
        print("Dry-run only. Re-run with --apply to synchronize.")
        return 1 if diff.changed else 0

    backup_root = apply_sync(target, diff)
    if backup_root:
        print(f"Backup: {backup_root}")
    print(f"Synchronized to kos-framework {framework_version()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
