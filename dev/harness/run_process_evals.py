#!/usr/bin/env python3
from __future__ import annotations

import argparse
import contextlib
import io
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import yaml

from kos_test import prepare_test_vault
from process_eval_common import (
    REPO_ROOT,
    ProcessEvalError,
    aggregate_process_results,
    diff_snapshots,
    evaluate_process_trace,
    load_process_contracts,
    load_prompt_case,
    run_pi_trace,
    sha256_file,
    snapshot_vault,
    utc_now,
)


DEFAULT_ARTIFACT_DIR = REPO_ROOT / "dev/evals/artifacts"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run real Pi Process Evals in disposable kos-test fixtures.")
    parser.add_argument("--suite", default=None, help="Prompt suite or process contract id.")
    parser.add_argument("--case", default=None, help="Prompt case or process contract id.")
    parser.add_argument("--pi", default="pi", help="Pi executable name or path.")
    parser.add_argument("--artifact-dir", default=str(DEFAULT_ARTIFACT_DIR))
    parser.add_argument("--no-artifact", action="store_true")
    parser.add_argument("--format", choices=["text", "json"], default="text")
    return parser.parse_args()


def pi_version(pi_path: str) -> str:
    completed = subprocess.run(
        [pi_path, "--version"],
        text=True,
        capture_output=True,
        check=False,
        timeout=10,
    )
    return completed.stdout.strip() if completed.returncode == 0 else "unknown"


def skill_version(vault: Path, skill_name: str) -> str:
    for path in (vault / "41_Skills").rglob("SKILL.md"):
        text = path.read_text(encoding="utf-8")
        if not text.startswith("---\n"):
            continue
        _, frontmatter, _ = text.split("---", 2)
        data = yaml.safe_load(frontmatter) or {}
        if data.get("name") == skill_name:
            return str(data.get("version") or "unknown")
    return "unknown"


def run_case(pi_path: str, contract) -> dict:
    prompt = load_prompt_case(contract)
    with tempfile.TemporaryDirectory(prefix="kos-process-eval-") as tempdir:
        vault = Path(tempdir) / "kos-test"
        with contextlib.redirect_stdout(io.StringIO()):
            prepare_test_vault(vault)
        before = snapshot_vault(vault)
        trace = run_pi_trace(
            pi_path,
            vault,
            prompt.prompt,
            tools=contract.tools,
            thinking_level=contract.thinking_level,
            timeout_seconds=contract.timeout_seconds,
        )
        after = snapshot_vault(vault)
        result = evaluate_process_trace(contract, prompt, trace, diff_snapshots(before, after))
        result["environment"] = {
            "backend": contract.backend,
            "provider": trace.get("provider") or "unknown",
            "model": trace.get("model") or "unknown",
            "thinking_level": contract.thinking_level,
            "skill_version": skill_version(vault, prompt.skill),
            "contract_sha256": sha256_file(contract.source_file),
            "prompt_sha256": sha256_file(prompt.source_file),
        }
        return result


def main() -> int:
    args = parse_args()
    pi_path = shutil.which(args.pi)
    if pi_path is None:
        print(f"Pi executable not found: {args.pi}")
        return 2
    try:
        contracts = load_process_contracts(args.suite, args.case)
        if not contracts:
            raise ProcessEvalError("No matching Process Eval contracts")
        results = [run_case(pi_path, contract) for contract in contracts]
    except ProcessEvalError as exc:
        print(f"Process Eval failed: {exc}")
        return 2

    metrics = aggregate_process_results(results)
    payload = {
        "kind": "kos_process_eval",
        "version": 1,
        "created_at": utc_now(),
        "framework_version": (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip(),
        "backend": "pi",
        "backend_version": pi_version(pi_path),
        "status": "pass" if all(item["overall_pass"] for item in results) else "fail",
        "metrics": metrics,
        "results": results,
    }
    artifact_path = None
    if not args.no_artifact:
        artifact_dir = Path(args.artifact_dir).expanduser().resolve()
        artifact_dir.mkdir(parents=True, exist_ok=True)
        stamp = payload["created_at"].replace(":", "").replace("-", "")
        artifact_path = artifact_dir / f"{stamp}_pi-process-eval.json"
        artifact_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.format == "json":
        output = dict(payload)
        if artifact_path:
            output["artifact"] = str(artifact_path)
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print(f"Process Eval: {payload['status'].upper()}")
        print(f"Backend: pi {payload['backend_version']}")
        print(f"Cases: {metrics['passed_cases']}/{metrics['case_count']}")
        print(f"Route precision: {metrics['route']['precision']}")
        print(f"Route recall: {metrics['route']['recall']}")
        print(f"Required step coverage: {metrics['required_step_coverage']}")
        print(f"Forbidden violations: {metrics['forbidden_violation_count']}")
        for result in results:
            state = "PASS" if result["overall_pass"] else "FAIL"
            print(f"- [{state}] {result['id']} route={result['route_pass']} protocol={result['protocol_pass']}")
            for check in result["checks"]:
                if not check["pass"]:
                    print(f"  - FAIL {check['id']}: {check['evidence']}")
        if artifact_path:
            print(f"Artifact: {artifact_path}")
    return 0 if payload["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
