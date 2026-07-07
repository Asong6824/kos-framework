#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_VAULT = REPO_ROOT / "vault"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Initialize a kos vault from kos-framework.")
    parser.add_argument("target", help="Target directory for the new kos vault.")
    parser.add_argument("--force", action="store_true", help="Overwrite target if it already exists.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    target = Path(args.target).expanduser().resolve()

    if not TEMPLATE_VAULT.is_dir():
        raise SystemExit(f"Template vault not found: {TEMPLATE_VAULT}")
    if target.exists() and any(target.iterdir()) and not args.force:
        raise SystemExit(f"Target is not empty: {target}. Use --force to overwrite.")
    if target.exists() and args.force:
        shutil.rmtree(target)

    shutil.copytree(
        TEMPLATE_VAULT,
        target,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"),
    )
    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
