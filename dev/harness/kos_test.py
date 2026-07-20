#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from framework_sync import FRAMEWORK_VAULT, apply_sync, compare, framework_version


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TARGET = REPO_ROOT.parent / "kos-test"
MARKER_NAME = ".kos-test.json"
MARKER_KIND = "kos-test-vault"
PI_ADAPTER_SOURCE = REPO_ROOT / "dev/agents/pi/kos-test.APPEND_SYSTEM.md"


class KosTestError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a disposable kos-test vault and optionally run Pi inside it."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare", help="Create or refresh kos-test.")
    prepare_parser.add_argument("--target", default=str(DEFAULT_TARGET))
    prepare_parser.add_argument(
        "--reset",
        action="store_true",
        help="Rebuild from scratch. Refuses targets without a kos-test marker.",
    )

    run_parser = subparsers.add_parser("run", help="Prepare kos-test and run Pi from its root.")
    run_parser.add_argument("--target", default=str(DEFAULT_TARGET))
    run_parser.add_argument(
        "--reset",
        action="store_true",
        help="Rebuild from scratch before starting Pi.",
    )
    run_parser.add_argument("pi_args", nargs=argparse.REMAINDER)
    return parser.parse_args()


def marker_path(target: Path) -> Path:
    return target / MARKER_NAME


def assert_target_outside_framework(target: Path) -> None:
    if target == REPO_ROOT or REPO_ROOT in target.parents:
        raise KosTestError(f"kos-test must be outside kos-framework: {target}")


def read_marker(target: Path) -> dict[str, object]:
    path = marker_path(target)
    if not path.is_file():
        raise KosTestError(
            f"Refusing to modify unmarked directory: {target}. "
            f"Expected {MARKER_NAME}."
        )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise KosTestError(f"Invalid kos-test marker: {path}") from exc
    if payload.get("kind") != MARKER_KIND:
        raise KosTestError(f"Invalid kos-test marker kind: {path}")
    if payload.get("source_framework") != str(REPO_ROOT):
        raise KosTestError(
            f"kos-test belongs to a different framework checkout: {path}"
        )
    return payload


def write_marker(target: Path) -> None:
    payload = {
        "kind": MARKER_KIND,
        "source_framework": str(REPO_ROOT),
        "framework_version": framework_version(),
        "prepared_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    marker_path(target).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_test_manifest(target: Path) -> None:
    manifest = target / "90_系统/framework.yaml"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    prepared_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    manifest.write_text(
        "\n".join(
            [
                "framework: kos-framework",
                f'version: "{framework_version()}"',
                f'synced_at: "{prepared_at}"',
                "sync_direction: framework_to_test",
                "",
            ]
        ),
        encoding="utf-8",
    )


def write_pi_adapter(target: Path) -> None:
    if not PI_ADAPTER_SOURCE.is_file():
        raise KosTestError(f"Pi adapter source missing: {PI_ADAPTER_SOURCE}")
    pi_dir = target / ".pi"
    pi_dir.mkdir(parents=True, exist_ok=True)
    settings = {
        "skills": ["../41_Skills/core"],
        "enableSkillCommands": True,
    }
    (pi_dir / "settings.json").write_text(
        json.dumps(settings, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    shutil.copy2(PI_ADAPTER_SOURCE, pi_dir / "APPEND_SYSTEM.md")


def copy_fresh_vault(target: Path) -> None:
    shutil.copytree(
        FRAMEWORK_VAULT,
        target,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"),
    )


def prepare_test_vault(target: Path, *, reset: bool = False) -> Path:
    target = target.expanduser().resolve()
    assert_target_outside_framework(target)

    if target.exists() and not target.is_dir():
        raise KosTestError(f"kos-test target is not a directory: {target}")

    if reset and target.exists():
        read_marker(target)
        shutil.rmtree(target)

    if target.exists() and any(target.iterdir()):
        read_marker(target)
        diff = compare(target)
        apply_sync(target, diff)
        print(
            f"Refreshed {target}: "
            f"add={len(diff.added)} update={len(diff.modified)} delete={len(diff.deleted)}"
        )
    else:
        if target.exists():
            target.rmdir()
        copy_fresh_vault(target)
        print(f"Created {target}")

    write_test_manifest(target)
    write_pi_adapter(target)
    write_marker(target)
    return target


def build_pi_argv(pi_path: str, target: Path, pi_args: list[str]) -> list[str]:
    if pi_args and pi_args[0] == "--":
        pi_args = pi_args[1:]
    return [
        pi_path,
        "--approve",
        "--no-skills",
        "--skill",
        str(target / "41_Skills/core"),
        *pi_args,
    ]


def run_pi(target: Path, pi_args: list[str]) -> None:
    pi_command = os.environ.get("PI_AGENT_BIN", "pi")
    pi_path = shutil.which(pi_command)
    if pi_path is None:
        raise KosTestError(f"Pi command not found: {pi_command}")
    argv = build_pi_argv(pi_path, target, pi_args)
    os.chdir(target)
    os.execv(pi_path, argv)


def main() -> int:
    args = parse_args()
    try:
        target = prepare_test_vault(Path(args.target), reset=args.reset)
        if args.command == "run":
            run_pi(target, args.pi_args)
    except KosTestError as exc:
        raise SystemExit(str(exc)) from exc
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
