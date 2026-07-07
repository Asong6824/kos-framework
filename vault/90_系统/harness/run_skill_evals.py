#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

from harness_common import find_vault_root
from skill_eval_common import CheckResult, build_checkers, load_eval_cases


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="运行 kos Skill eval 的轻量确定性检查")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--suite", default=None, help="指定 eval suite，例如 kos-translate 或 kos-translate.prompts.csv")
    parser.add_argument("--format", choices=["text", "json"], default="text")
    parser.add_argument("--write-artifact", action="store_true", help="写入 artifacts JSON 结果")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve() if args.root else find_vault_root()
    cases = load_eval_cases(root, args.suite)
    checkers = build_checkers(root)

    results: list[dict] = []
    total_checks = 0
    passed_checks = 0

    for case in cases:
        case_results: list[CheckResult] = []
        for check_id in case.expected_checks:
            checker = checkers[check_id]
            result = checker(case)
            case_results.append(result)
            total_checks += 1
            if result.passed:
                passed_checks += 1
        case_pass = all(item.passed for item in case_results)
        results.append(
            {
                "id": case.id,
                "skill": case.skill,
                "suite": case.source_file.name,
                "should_trigger": case.should_trigger,
                "prompt": case.prompt,
                "pass": case_pass,
                "checks": [
                    {"id": item.id, "pass": item.passed, "notes": item.notes}
                    for item in case_results
                ],
                "notes": case.notes,
            }
        )

    overall_pass = all(item["pass"] for item in results) if results else True
    score = round((passed_checks / total_checks) * 100) if total_checks else 0
    payload = {
        "created": dt.date.today().isoformat(),
        "suite": args.suite or "all",
        "overall_pass": overall_pass,
        "score": score,
        "case_count": len(results),
        "check_count": total_checks,
        "results": results,
    }

    if args.write_artifact:
        out_dir = root / "90_系统/evals/artifacts"
        out_dir.mkdir(parents=True, exist_ok=True)
        name = args.suite or "all"
        name = name.replace("/", "_").replace(".prompts.csv", "")
        out_path = out_dir / f"{dt.date.today().isoformat()}_{name}.json"
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        payload["artifact"] = str(out_path)

    if args.format == "json":
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(f"Skill Eval: {payload['suite']}")
        print(f"Overall: {'PASS' if overall_pass else 'FAIL'}")
        print(f"Score: {score}")
        print(f"Cases: {len(results)}")
        if not results:
            print("No runtime Skill eval cases are currently defined")
        for item in results:
            print(f"- [{'PASS' if item['pass'] else 'FAIL'}] {item['id']} ({item['skill']})")
            for check in item["checks"]:
                if not check["pass"]:
                    print(f"  - FAIL {check['id']}: {check['notes']}")

    return 0 if overall_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
