#!/usr/bin/env python3
from __future__ import annotations

import csv
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
VAULT_ROOT = REPO_ROOT / "vault"
EVAL_ROOT = REPO_ROOT / "dev/evals/core"
RUNTIME_HARNESS = VAULT_ROOT / "90_系统/harness"
sys.path.insert(0, str(RUNTIME_HARNESS))

from harness_common import parse_frontmatter  # noqa: E402
from skill_eval_common import EvalCase, build_checkers  # noqa: E402


REQUIRED_COLUMNS = ["id", "skill", "should_trigger", "prompt", "expected_checks", "notes"]


def core_skill_names() -> set[str]:
    names: set[str] = set()
    for path in sorted((VAULT_ROOT / "41_Skills/core").glob("*/SKILL.md")):
        frontmatter, _ = parse_frontmatter(path)
        name = str((frontmatter or {}).get("name") or "").strip()
        if name:
            names.add(name)
    return names


def main() -> int:
    errors: list[str] = []
    cases: list[EvalCase] = []
    checkers = build_checkers(VAULT_ROOT)

    for path in sorted(EVAL_ROOT.glob("*.csv")):
        with path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames != REQUIRED_COLUMNS:
                errors.append(f"{path.name}: invalid columns")
                continue
            for row in reader:
                checks = [item.strip() for item in (row.get("expected_checks") or "").split("|") if item.strip()]
                unknown = [check for check in checks if check not in checkers]
                if unknown:
                    errors.append(f"{path.name}:{row.get('id')}: unknown checks {unknown}")
                cases.append(
                    EvalCase(
                        id=(row.get("id") or "").strip(),
                        skill=(row.get("skill") or "").strip(),
                        should_trigger=(row.get("should_trigger") or "").strip().lower() == "true",
                        prompt=row.get("prompt") or "",
                        expected_checks=checks,
                        notes=row.get("notes") or "",
                        source_file=path,
                    )
                )

    core = core_skill_names()
    covered = {case.skill for case in cases}
    missing = sorted(core - covered)
    unknown_skills = sorted(covered - core)
    if missing:
        errors.append(f"core Skills without development evals: {missing}")
    if unknown_skills:
        errors.append(f"development evals reference non-core Skills: {unknown_skills}")

    failed_checks: list[str] = []
    check_count = 0
    for case in cases:
        for check_id in case.expected_checks:
            if check_id not in checkers:
                continue
            check_count += 1
            result = checkers[check_id](case)
            if not result.passed:
                failed_checks.append(f"{case.id}:{check_id}:{result.notes}")
    errors.extend(failed_checks)

    if errors:
        print("Core development eval validation failed")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"Core development eval validation passed: {len(core)}/{len(core)} Skills, {len(cases)} cases, {check_count} checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
