#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
from pathlib import Path

from harness_common import Finding, find_vault_root, has_errors, parse_args, print_findings, relpath
from skill_eval_common import EVAL_SKILL_DIR, build_checkers, find_skill_file, load_eval_cases


REQUIRED_COLUMNS = ["id", "skill", "should_trigger", "prompt", "expected_checks", "notes"]


def main() -> int:
    args = parse_args("校验 kos Skill eval 定义")
    root = Path(args.root).resolve() if args.root else find_vault_root()
    findings: list[Finding] = []

    eval_root = root / "90_系统/evals"
    skill_dir = root / EVAL_SKILL_DIR
    schema_path = eval_root / "schemas/skill_eval_result.schema.json"

    if not eval_root.is_dir():
        findings.append(Finding("ERROR", "90_系统/evals", "缺少 Skill eval 根目录"))
    if not skill_dir.is_dir():
        findings.append(Finding("ERROR", relpath(skill_dir, root), "缺少 skills prompt 目录"))
    if not schema_path.is_file():
        findings.append(Finding("ERROR", relpath(schema_path, root), "缺少 skill eval 结果 schema"))
    else:
        try:
            json.loads(schema_path.read_text(encoding="utf-8"))
        except Exception as exc:
            findings.append(Finding("ERROR", relpath(schema_path, root), f"schema 不是合法 JSON：{exc}"))

    checkers = build_checkers(root)
    csv_files = sorted(skill_dir.glob("*.prompts.csv")) if skill_dir.is_dir() else []
    if not csv_files:
        findings.append(Finding("INFO", relpath(skill_dir, root), "当前没有用户自定义 Skill eval prompt CSV"))

    case_count = 0
    for path in csv_files:
        rel = relpath(path, root)
        with path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames != REQUIRED_COLUMNS:
                findings.append(Finding("ERROR", rel, f"CSV 表头必须为 {REQUIRED_COLUMNS}"))
                continue
            for row in reader:
                case_count += 1
                case_id = row.get("id") or "<missing-id>"
                skill = (row.get("skill") or "").strip()
                should_trigger = (row.get("should_trigger") or "").strip().lower()
                if should_trigger not in {"true", "false"}:
                    findings.append(Finding("ERROR", rel, f"{case_id}: should_trigger 必须为 true/false"))
                if not skill:
                    findings.append(Finding("ERROR", rel, f"{case_id}: 缺少 skill"))
                elif find_skill_file(root, skill) is None:
                    findings.append(Finding("ERROR", rel, f"{case_id}: 目标 Skill 不存在：{skill}"))
                if not (row.get("prompt") or "").strip():
                    findings.append(Finding("ERROR", rel, f"{case_id}: 缺少 prompt"))
                checks = [
                    item.strip()
                    for item in (row.get("expected_checks") or "").split("|")
                    if item.strip()
                ]
                if not checks:
                    findings.append(Finding("ERROR", rel, f"{case_id}: 缺少 expected_checks"))
                for check in checks:
                    if check not in checkers:
                        findings.append(Finding("ERROR", rel, f"{case_id}: 未知检查项 `{check}`"))

    cases = load_eval_cases(root)
    skills_with_evals = sorted({case.skill for case in cases})
    findings.append(Finding("INFO", "90_系统/evals", f"共发现 {len(csv_files)} 个 eval suite，{case_count} 个 case"))
    findings.append(Finding("INFO", "90_系统/evals", f"覆盖 Skill：{', '.join(skills_with_evals) if skills_with_evals else '无'}"))

    print_findings(findings, "Skill Eval 定义检查报告", markdown=args.format == "markdown")
    return 1 if has_errors(findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
