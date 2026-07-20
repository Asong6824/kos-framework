#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

from harness_common import find_vault_root
from task_eval_common import (
    TaskContractError,
    evaluate_task_contract,
    load_self_assessment,
    load_task_contract,
    resolve_contract_path,
    update_run_state,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="按 Task Contract 评估任务完成度并记录迭代收敛")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--contract", required=True, help="Task Contract YAML 路径或 contracts 下的相对路径")
    parser.add_argument("--self-assessment", default=None, help="Agent rubric 自评 YAML；rubric 非空时必需")
    parser.add_argument("--state", default=None, help="累计 run state JSON；存在时读取并追加本轮")
    parser.add_argument("--run-id", default=None, help="稳定 run id；使用 --state 时建议显式提供")
    parser.add_argument("--format", choices=["text", "json"], default="text")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve() if args.root else find_vault_root()
    try:
        contract_path = resolve_contract_path(root, args.contract)
        contract = load_task_contract(contract_path)
        assessment = load_self_assessment(Path(args.self_assessment).resolve() if args.self_assessment else None)
        state_path = Path(args.state).resolve() if args.state else None
        state = json.loads(state_path.read_text(encoding="utf-8")) if state_path and state_path.exists() else None
        iteration = len((state or {}).get("attempts") or []) + 1
        run_id = args.run_id or str((state or {}).get("run_id") or f"{contract['id']}-{dt.datetime.now().strftime('%Y%m%dT%H%M%S')}")
        attempt = evaluate_task_contract(root, contract, assessment, iteration=iteration)
        payload = update_run_state(state, contract, attempt, run_id)
        if state_path:
            state_path.parent.mkdir(parents=True, exist_ok=True)
            state_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except (TaskContractError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"Task Contract eval failed: {exc}")
        return 2

    if args.format == "json":
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        metrics = payload["metrics"]
        latest = payload["attempts"][-1]
        print(f"Task Contract: {payload['contract_id']}")
        print(f"Status: {payload['status'].upper()}")
        print(f"Iteration: {metrics['iterations']}/{payload['max_iterations']}")
        print(f"Score: {latest['score']}")
        print(f"pass@1: {str(metrics['pass_at_1']).lower()}")
        print(f"pass@k: {str(metrics['pass_at_k']).lower()}")
        for failure in latest["failures"]:
            print(f"- FAIL {failure}")
        if latest["next_action"]:
            print(f"Next action: {latest['next_action']}")
        if state_path:
            print(f"State: {state_path}")
    return 0 if payload["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
