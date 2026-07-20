from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from harness_common import load_yaml, parse_frontmatter, relpath


CONTRACT_VERSION = 1
SCORE_MAX = 4
ALLOWED_CHECK_TYPES = {
    "path_exists",
    "path_not_exists",
    "glob_count",
    "text_contains",
    "text_not_contains",
    "frontmatter",
    "harness_passes",
}
ALLOWED_HARNESS_SCRIPTS = {
    "validate_paths.py",
    "validate_schema.py",
    "validate_state.py",
    "validate_permissions.py",
    "validate_skills.py",
    "validate_skill_evals.py",
}
ALLOWED_CONTRACT_FIELDS = {"version", "id", "skill", "objective", "max_iterations", "checks", "rubric"}
ALLOWED_CHECK_FIELDS = {
    "id",
    "type",
    "required",
    "path",
    "pattern",
    "min",
    "max",
    "values",
    "field",
    "operator",
    "expected",
    "script",
}
ALLOWED_RUBRIC_FIELDS = {"id", "description", "min_score", "weight"}


class TaskContractError(ValueError):
    pass


def contract_digest(contract: dict[str, Any]) -> str:
    encoded = json.dumps(contract, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _safe_relative(value: Any, label: str) -> str:
    if not _non_empty_string(value):
        raise TaskContractError(f"{label} 必须是非空相对路径")
    path = Path(str(value))
    if path.is_absolute() or ".." in path.parts:
        raise TaskContractError(f"{label} 必须位于 vault 内：{value}")
    return path.as_posix()


def validate_task_contract(contract: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    unknown_fields = sorted(set(contract) - ALLOWED_CONTRACT_FIELDS)
    if unknown_fields:
        errors.append(f"未知顶层字段：{unknown_fields}")
    if contract.get("version") != CONTRACT_VERSION or isinstance(contract.get("version"), bool):
        errors.append(f"version 必须为 {CONTRACT_VERSION}")
    for field in ["id", "skill", "objective"]:
        if not _non_empty_string(contract.get(field)):
            errors.append(f"缺少非空字段 {field}")

    max_iterations = contract.get("max_iterations", 3)
    if not isinstance(max_iterations, int) or isinstance(max_iterations, bool) or not 1 <= max_iterations <= 10:
        errors.append("max_iterations 必须是 1 到 10 的整数")

    checks = contract.get("checks")
    if not isinstance(checks, list) or not checks:
        errors.append("checks 必须是非空数组")
        checks = []
    seen: set[str] = set()
    for index, check in enumerate(checks):
        label = f"checks[{index}]"
        if not isinstance(check, dict):
            errors.append(f"{label} 必须是 mapping")
            continue
        unknown_check_fields = sorted(set(check) - ALLOWED_CHECK_FIELDS)
        if unknown_check_fields:
            errors.append(f"{label} 包含未知字段：{unknown_check_fields}")
        if "required" in check and not isinstance(check["required"], bool):
            errors.append(f"{label}.required 必须为布尔值")
        check_id = check.get("id")
        if not _non_empty_string(check_id):
            errors.append(f"{label}.id 必须为非空字符串")
        elif str(check_id) in seen:
            errors.append(f"检查 id 重复：{check_id}")
        else:
            seen.add(str(check_id))
        check_type = check.get("type")
        if check_type not in ALLOWED_CHECK_TYPES:
            errors.append(f"{label}.type 不受支持：{check_type!r}")
            continue
        try:
            if check_type in {"path_exists", "path_not_exists", "text_contains", "text_not_contains", "frontmatter"}:
                _safe_relative(check.get("path"), f"{label}.path")
            if check_type == "glob_count":
                _safe_relative(check.get("pattern"), f"{label}.pattern")
                minimum = check.get("min", 1)
                maximum = check.get("max")
                valid_minimum = isinstance(minimum, int) and not isinstance(minimum, bool) and minimum >= 0
                valid_maximum = isinstance(maximum, int) and not isinstance(maximum, bool)
                if not valid_minimum:
                    errors.append(f"{label}.min 必须是非负整数")
                if maximum is not None and (not valid_maximum or (valid_minimum and maximum < minimum)):
                    errors.append(f"{label}.max 必须是不小于 min 的整数")
            if check_type in {"text_contains", "text_not_contains"}:
                values = check.get("values")
                if not isinstance(values, list) or not values or not all(_non_empty_string(item) for item in values):
                    errors.append(f"{label}.values 必须是非空字符串数组")
            if check_type == "frontmatter":
                if not _non_empty_string(check.get("field")):
                    errors.append(f"{label}.field 必须为非空字符串")
                operator = check.get("operator", "nonempty")
                if operator not in {"nonempty", "equals", "contains"}:
                    errors.append(f"{label}.operator 不受支持：{operator!r}")
                if operator in {"equals", "contains"} and "expected" not in check:
                    errors.append(f"{label} 使用 {operator} 时必须声明 expected")
            if check_type == "harness_passes":
                script = check.get("script")
                if script not in ALLOWED_HARNESS_SCRIPTS:
                    errors.append(f"{label}.script 不在允许列表：{script!r}")
        except TaskContractError as exc:
            errors.append(str(exc))

    rubric = contract.get("rubric", [])
    if rubric is None:
        rubric = []
    if not isinstance(rubric, list):
        errors.append("rubric 必须是数组")
        rubric = []
    rubric_ids: set[str] = set()
    for index, item in enumerate(rubric):
        label = f"rubric[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{label} 必须是 mapping")
            continue
        unknown_rubric_fields = sorted(set(item) - ALLOWED_RUBRIC_FIELDS)
        if unknown_rubric_fields:
            errors.append(f"{label} 包含未知字段：{unknown_rubric_fields}")
        rubric_id = item.get("id")
        if not _non_empty_string(rubric_id):
            errors.append(f"{label}.id 必须为非空字符串")
        elif str(rubric_id) in rubric_ids:
            errors.append(f"rubric id 重复：{rubric_id}")
        else:
            rubric_ids.add(str(rubric_id))
        if not _non_empty_string(item.get("description")):
            errors.append(f"{label}.description 必须为非空字符串")
        minimum = item.get("min_score")
        if not isinstance(minimum, (int, float)) or isinstance(minimum, bool) or not 0 <= minimum <= SCORE_MAX:
            errors.append(f"{label}.min_score 必须在 0 到 {SCORE_MAX} 之间")
        weight = item.get("weight", 1)
        if not isinstance(weight, (int, float)) or isinstance(weight, bool) or weight <= 0:
            errors.append(f"{label}.weight 必须大于 0")
    return errors


def load_task_contract(path: Path) -> dict[str, Any]:
    contract = load_yaml(path)
    errors = validate_task_contract(contract)
    if errors:
        raise TaskContractError("；".join(errors))
    return contract


def resolve_contract_path(root: Path, value: str | Path) -> Path:
    path = Path(value)
    candidates = [path] if path.is_absolute() else [Path.cwd() / path, root / path, root / "90_系统/evals/contracts" / path]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise TaskContractError(f"找不到 Task Contract：{value}")


def _resolve_vault_path(root: Path, value: str) -> Path:
    relative = _safe_relative(value, "path")
    path = (root / relative).resolve()
    try:
        path.relative_to(root.resolve())
    except ValueError as exc:
        raise TaskContractError(f"路径越过 vault 边界：{value}") from exc
    return path


def _result(check: dict[str, Any], passed: bool, notes: str, evidence: list[str] | None = None) -> dict[str, Any]:
    return {
        "id": str(check["id"]),
        "type": str(check["type"]),
        "required": check.get("required", True) is not False,
        "pass": passed,
        "notes": notes,
        "evidence": evidence or [],
    }


def _nested_value(data: Any, dotted: str) -> Any:
    current = data
    for part in dotted.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def evaluate_check(root: Path, check: dict[str, Any]) -> dict[str, Any]:
    check_type = str(check["type"])
    if check_type in {"path_exists", "path_not_exists"}:
        path = _resolve_vault_path(root, str(check["path"]))
        exists = path.exists()
        passed = exists if check_type == "path_exists" else not exists
        return _result(check, passed, f"exists={exists}", [relpath(path, root)])

    if check_type == "glob_count":
        pattern = _safe_relative(check["pattern"], "pattern")
        matches = []
        for path in sorted(root.glob(pattern)):
            resolved = path.resolve()
            try:
                resolved.relative_to(root.resolve())
            except ValueError:
                continue
            matches.append(path)
        minimum = int(check.get("min", 1))
        maximum = check.get("max")
        passed = len(matches) >= minimum and (maximum is None or len(matches) <= int(maximum))
        evidence = [relpath(path, root) for path in matches[:20]]
        upper = "∞" if maximum is None else str(maximum)
        return _result(check, passed, f"matches={len(matches)}, expected={minimum}..{upper}", evidence)

    if check_type in {"text_contains", "text_not_contains"}:
        path = _resolve_vault_path(root, str(check["path"]))
        if not path.is_file():
            return _result(check, False, "目标文件不存在", [relpath(path, root)])
        text = path.read_text(encoding="utf-8")
        values = [str(item) for item in check["values"]]
        found = [item for item in values if item in text]
        passed = len(found) == len(values) if check_type == "text_contains" else not found
        return _result(check, passed, f"matched={found}", [relpath(path, root)])

    if check_type == "frontmatter":
        path = _resolve_vault_path(root, str(check["path"]))
        if not path.is_file():
            return _result(check, False, "目标文件不存在", [relpath(path, root)])
        frontmatter, _ = parse_frontmatter(path)
        if frontmatter is None:
            return _result(check, False, "缺少 frontmatter", [relpath(path, root)])
        actual = _nested_value(frontmatter, str(check["field"]))
        operator = check.get("operator", "nonempty")
        if operator == "nonempty":
            passed = actual is not None and actual != "" and actual != []
        elif operator == "equals":
            passed = actual == check.get("expected")
        else:
            expected = check.get("expected")
            passed = expected in actual if isinstance(actual, (str, list, tuple, set)) else False
        return _result(check, passed, f"actual={actual!r}", [relpath(path, root)])

    if check_type == "harness_passes":
        script = str(check["script"])
        if script not in ALLOWED_HARNESS_SCRIPTS:
            return _result(check, False, f"Harness 不在允许列表：{script}")
        script_path = Path(__file__).resolve().parent / script
        completed = subprocess.run(
            [sys.executable, str(script_path), "--root", str(root), "--format", "text"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
            timeout=60,
        )
        tail = completed.stdout.strip().splitlines()[-10:]
        return _result(check, completed.returncode == 0, f"exit_code={completed.returncode}", tail)

    return _result(check, False, f"未知检查类型：{check_type}")


def load_self_assessment(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    return load_yaml(path)


def evaluate_rubric(contract: dict[str, Any], assessment: dict[str, Any]) -> tuple[list[dict[str, Any]], int | None]:
    definitions = contract.get("rubric") or []
    if not definitions:
        return [], None
    if assessment.get("contract_id") != contract.get("id"):
        provided: dict[str, Any] = {}
    else:
        raw = assessment.get("rubric")
        provided = raw if isinstance(raw, dict) else {}

    results: list[dict[str, Any]] = []
    weighted = 0.0
    total_weight = 0.0
    for definition in definitions:
        rubric_id = str(definition["id"])
        response = provided.get(rubric_id)
        response = response if isinstance(response, dict) else {}
        score = response.get("score")
        evidence = response.get("evidence")
        if isinstance(evidence, str):
            evidence = [evidence]
        valid_evidence = isinstance(evidence, list) and bool(evidence) and all(_non_empty_string(item) for item in evidence)
        valid_score = isinstance(score, (int, float)) and not isinstance(score, bool) and 0 <= score <= SCORE_MAX
        passed = bool(valid_score and valid_evidence and score >= definition["min_score"])
        numeric_score = float(score) if valid_score else 0.0
        weight = float(definition.get("weight", 1))
        weighted += numeric_score * weight
        total_weight += SCORE_MAX * weight
        results.append(
            {
                "id": rubric_id,
                "pass": passed,
                "score": score if valid_score else None,
                "min_score": definition["min_score"],
                "weight": definition.get("weight", 1),
                "evidence": evidence if valid_evidence else [],
                "notes": "complete" if valid_score and valid_evidence else "缺少有效 score 或 evidence",
            }
        )
    score = round((weighted / total_weight) * 100) if total_weight else 0
    return results, score


def evaluate_task_contract(
    root: Path,
    contract: dict[str, Any],
    assessment: dict[str, Any] | None = None,
    iteration: int = 1,
) -> dict[str, Any]:
    errors = validate_task_contract(contract)
    if errors:
        raise TaskContractError("；".join(errors))
    check_results = [evaluate_check(root, check) for check in contract["checks"]]
    rubric_results, semantic_score = evaluate_rubric(contract, assessment or {})
    required_checks = [item for item in check_results if item["required"]]
    deterministic_score = round(
        (sum(1 for item in required_checks if item["pass"]) / len(required_checks)) * 100
    ) if required_checks else 100
    deterministic_pass = all(item["pass"] for item in required_checks)
    semantic_pass = all(item["pass"] for item in rubric_results)
    passed = deterministic_pass and semantic_pass
    if semantic_score is None:
        score = deterministic_score
    else:
        score = round((deterministic_score + semantic_score) / 2)
    failures = [item["id"] for item in check_results if item["required"] and not item["pass"]]
    failures.extend(item["id"] for item in rubric_results if not item["pass"])
    return {
        "iteration": iteration,
        "pass": passed,
        "score": score,
        "deterministic_score": deterministic_score,
        "semantic_score": semantic_score,
        "checks": check_results,
        "rubric": rubric_results,
        "failures": failures,
        "assessment_summary": str((assessment or {}).get("summary") or ""),
        "next_action": str((assessment or {}).get("next_action") or ""),
        "needs_user": (assessment or {}).get("needs_user") is True,
    }


def update_run_state(
    state: dict[str, Any] | None,
    contract: dict[str, Any],
    attempt: dict[str, Any],
    run_id: str,
) -> dict[str, Any]:
    digest = contract_digest(contract)
    if state:
        if state.get("contract_id") != contract["id"] or state.get("contract_sha256") != digest:
            raise TaskContractError("已有 run state 与当前 Task Contract 不一致")
        if state.get("run_id") != run_id:
            raise TaskContractError("已有 run state 与当前 run id 不一致")
        if state.get("status") == "pass":
            raise TaskContractError("Task Completion Run 已通过，不能继续追加迭代")
        attempts = list(state.get("attempts") or [])
    else:
        attempts = []
    expected_iteration = len(attempts) + 1
    if attempt["iteration"] != expected_iteration:
        raise TaskContractError(f"iteration 应为 {expected_iteration}")
    attempts.append(attempt)
    converged = any(item["pass"] for item in attempts)
    max_iterations = int(contract.get("max_iterations", 3))
    if converged:
        status = "pass"
    elif attempt["needs_user"]:
        status = "needs_user"
    elif len(attempts) >= max_iterations:
        status = "exhausted"
    else:
        status = "retryable"
    return {
        "kind": "task_completion_run",
        "run_id": run_id,
        "contract_id": contract["id"],
        "contract_sha256": digest,
        "skill": contract["skill"],
        "objective": contract["objective"],
        "max_iterations": max_iterations,
        "status": status,
        "metrics": {
            "pass_at_1": bool(attempts and attempts[0]["pass"]),
            "pass_at_k": converged,
            "iterations": len(attempts),
            "best_score": max(item["score"] for item in attempts),
        },
        "attempts": attempts,
    }
