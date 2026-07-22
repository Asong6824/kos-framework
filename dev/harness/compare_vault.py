#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from framework_sync import compare, ensure_vault, framework_version


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare a personal kos vault with kos-framework core.")
    parser.add_argument("target", help="Personal kos vault path.")
    parser.add_argument("--json", action="store_true", help="Output JSON.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    target = Path(args.target).expanduser().resolve()
    ensure_vault(target)
    diff = compare(target)
    payload = {
        "framework_version": framework_version(),
        "target": str(target),
        "changed": diff.changed,
        "added": [str(path) for path in diff.added],
        "added_directories": [str(path) for path in diff.added_directories],
        "modified": [str(path) for path in diff.modified],
        "deleted": [str(path) for path in diff.deleted],
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(f"Framework version: {payload['framework_version']}")
        print(f"Target: {target}")
        for label, paths in [("ADD_DIR", diff.added_directories), ("ADD", diff.added), ("UPDATE", diff.modified), ("DELETE", diff.deleted)]:
            for path in paths:
                print(f"{label} {path}")
        if not diff.changed:
            print("No differences")
    return 1 if diff.changed else 0


if __name__ == "__main__":
    raise SystemExit(main())
