#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
VAULT_ROOT = REPO_ROOT / "vault"
EVAL_ROOT = REPO_ROOT / "dev/evals/core"
HARNESS_CLI = REPO_ROOT / "agent/packages/kos-agent/dist/kos-cli.js"
REQUIRED_COLUMNS = ["id", "skill", "should_trigger", "prompt", "expected_checks", "notes"]


def core_skill_names() -> set[str]:
    names: set[str] = set()
    for path in sorted((VAULT_ROOT / "80_Skills/core").glob("*/SKILL.md")):
        text = path.read_text(encoding="utf-8")
        if not text.startswith("---\n"):
            continue
        end = text.find("\n---", 4)
        if end < 0:
            continue
        frontmatter = yaml.safe_load(text[4:end]) or {}
        name = str(frontmatter.get("name") or "").strip()
        if name:
            names.add(name)
    return names


def main() -> int:
    errors: list[str] = []
    covered: set[str] = set()
    case_count = 0
    for path in sorted(EVAL_ROOT.glob("*.csv")):
        with path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames != REQUIRED_COLUMNS:
                errors.append(f"{path.name}: invalid columns")
                continue
            for row in reader:
                case_count += 1
                skill = (row.get("skill") or "").strip()
                if skill:
                    covered.add(skill)

    core = core_skill_names()
    missing = sorted(core - covered)
    unknown_skills = sorted(covered - core)
    if missing:
        errors.append(f"core Skills without development evals: {missing}")
    if unknown_skills:
        errors.append(f"development evals reference non-core Skills: {unknown_skills}")

    if not HARNESS_CLI.is_file():
        errors.append(f"kos-harness is not built: {HARNESS_CLI}")
    else:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir) / "vault"
            shutil.copytree(VAULT_ROOT, root)
            target = root / "90_系统/evals/skills"
            target.mkdir(parents=True, exist_ok=True)
            for source in EVAL_ROOT.glob("*.csv"):
                shutil.copy2(source, target / source.name)
            result = subprocess.run(
                ["node", str(HARNESS_CLI), "skill-eval", "--root", str(root), "--format", "json"],
                text=True,
                capture_output=True,
                check=False,
            )
            try:
                payload = json.loads(result.stdout)
            except json.JSONDecodeError:
                errors.append(result.stdout + result.stderr)
            else:
                if not payload.get("overall_pass"):
                    for case in payload.get("results", []):
                        for check in case.get("checks", []):
                            if not check.get("pass"):
                                errors.append(f"{case.get('id')}:{check.get('id')}:{check.get('notes')}")
                check_count = int(payload.get("check_count", 0))

    if errors:
        print("Core development eval validation failed")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"Core development eval validation passed: {len(core)}/{len(core)} Skills, {case_count} cases, {check_count} checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
