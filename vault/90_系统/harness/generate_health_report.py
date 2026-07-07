#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from harness_common import REPORT_DIR, find_vault_root, parse_args


CHECKS = [
    ("路径检查", "validate_paths.py"),
    ("Schema 检查", "validate_schema.py"),
    ("状态检查", "validate_state.py"),
    ("权限与人工确认检查", "validate_permissions.py"),
    ("Skill 检查", "validate_skills.py"),
    ("Skill Eval 定义检查", "validate_skill_evals.py"),
]


def run_check(script: str, root: Path) -> tuple[int, str]:
    path = Path(__file__).resolve().parent / script
    result = subprocess.run(
        [sys.executable, str(path), "--root", str(root), "--format", "markdown"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    return result.returncode, result.stdout.strip()


def main() -> int:
    args = parse_args("生成 kos 系统健康报告")
    root = Path(args.root).resolve() if args.root else find_vault_root()
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "health_report.md"

    sections: list[str] = [
        "# kos 系统健康报告",
        "",
        f"- Vault 根目录：`{root}`",
        "",
    ]
    exit_code = 0
    for title, script in CHECKS:
        code, output = run_check(script, root)
        if code:
            exit_code = 1
        sections.append(f"## {title}")
        sections.append("")
        sections.append(output)
        sections.append("")
    report_path.write_text("\n".join(sections), encoding="utf-8")
    print(report_path)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
