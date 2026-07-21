from __future__ import annotations

import csv
import datetime as dt
import fnmatch
import hashlib
import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from kos_test import build_pi_argv


REPO_ROOT = Path(__file__).resolve().parents[2]
PROCESS_CONTRACT_DIR = REPO_ROOT / "dev/evals/process"
CORE_PROMPT_DIR = REPO_ROOT / "dev/evals/core"
CONTRACT_VERSION = 1
ALLOWED_PROTOCOL_FIELDS = {
    "required_skill_reads",
    "required_reads",
    "required_tools",
    "required_commands",
    "forbidden_tools",
    "forbidden_commands",
    "forbidden_path_fragments",
    "forbid_vault_changes",
}
SNAPSHOT_EXCLUDED_PREFIXES = (
    ".pi",
    "90_系统/evals/artifacts",
    "90_系统/framework-backups",
)
SNAPSHOT_EXCLUDED_FILES = {".kos-test.json", "90_系统/framework.yaml"}


class ProcessEvalError(RuntimeError):
    pass


@dataclass(frozen=True)
class PromptCase:
    id: str
    skill: str
    should_trigger: bool
    prompt: str
    source_file: Path


@dataclass(frozen=True)
class ProcessContract:
    id: str
    prompt_file: str
    prompt_case_id: str
    backend: str
    timeout_seconds: int
    tools: list[str]
    thinking_level: str
    protocol: dict[str, Any]
    source_file: Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _required_string(data: dict[str, Any], key: str, errors: list[str]) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{key} must be a non-empty string")
        return ""
    return value.strip()


def _string_list(data: dict[str, Any], key: str, errors: list[str]) -> list[str]:
    value = data.get(key, [])
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        errors.append(f"{key} must be an array of non-empty strings")
        return []
    return list(value)


def load_process_contract(path: Path) -> ProcessContract:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ProcessEvalError(f"Cannot load process contract {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise ProcessEvalError(f"Process contract must be a mapping: {path}")

    errors: list[str] = []
    if raw.get("version") != CONTRACT_VERSION:
        errors.append(f"version must be {CONTRACT_VERSION}")
    contract_id = _required_string(raw, "id", errors)
    prompt_file = _required_string(raw, "prompt_file", errors)
    prompt_case_id = _required_string(raw, "prompt_case_id", errors)
    backend = _required_string(raw, "backend", errors)
    if backend and backend != "pi":
        errors.append("backend must be pi")
    timeout_seconds = raw.get("timeout_seconds", 120)
    if not isinstance(timeout_seconds, int) or isinstance(timeout_seconds, bool) or not 1 <= timeout_seconds <= 600:
        errors.append("timeout_seconds must be an integer from 1 to 600")
        timeout_seconds = 120
    tools = _string_list(raw, "tools", errors)
    if not tools:
        errors.append("tools must not be empty")
    thinking_level = raw.get("thinking_level", "low")
    if thinking_level not in {"off", "minimal", "low", "medium", "high", "xhigh", "max"}:
        errors.append("thinking_level is invalid")
        thinking_level = "low"

    protocol = raw.get("protocol")
    if not isinstance(protocol, dict):
        errors.append("protocol must be a mapping")
        protocol = {}
    unknown_protocol = sorted(set(protocol) - ALLOWED_PROTOCOL_FIELDS)
    if unknown_protocol:
        errors.append(f"unknown protocol fields: {unknown_protocol}")
    normalized_protocol: dict[str, Any] = {}
    for key in sorted(ALLOWED_PROTOCOL_FIELDS - {"forbid_vault_changes"}):
        normalized_protocol[key] = _string_list(protocol, key, errors)
    forbid_changes = protocol.get("forbid_vault_changes", True)
    if not isinstance(forbid_changes, bool):
        errors.append("protocol.forbid_vault_changes must be boolean")
        forbid_changes = True
    normalized_protocol["forbid_vault_changes"] = forbid_changes

    if Path(prompt_file).name != prompt_file or not prompt_file.endswith(".prompts.csv"):
        errors.append("prompt_file must be a .prompts.csv basename")
    if errors:
        raise ProcessEvalError(f"Invalid process contract {path}: {'; '.join(errors)}")
    return ProcessContract(
        id=contract_id,
        prompt_file=prompt_file,
        prompt_case_id=prompt_case_id,
        backend=backend,
        timeout_seconds=timeout_seconds,
        tools=tools,
        thinking_level=thinking_level,
        protocol=normalized_protocol,
        source_file=path,
    )


def load_prompt_case(contract: ProcessContract) -> PromptCase:
    path = CORE_PROMPT_DIR / contract.prompt_file
    if not path.is_file():
        raise ProcessEvalError(f"Prompt file not found for {contract.id}: {path}")
    with path.open(newline="", encoding="utf-8") as handle:
        rows = [row for row in csv.DictReader(handle) if (row.get("id") or "").strip() == contract.prompt_case_id]
    if len(rows) != 1:
        raise ProcessEvalError(
            f"Expected exactly one prompt case {contract.prompt_case_id} in {contract.prompt_file}"
        )
    row = rows[0]
    raw_should_trigger = (row.get("should_trigger") or "").strip().lower()
    if raw_should_trigger not in {"true", "false"}:
        raise ProcessEvalError(f"Invalid should_trigger for {contract.prompt_case_id}")
    return PromptCase(
        id=contract.prompt_case_id,
        skill=(row.get("skill") or "").strip(),
        should_trigger=raw_should_trigger == "true",
        prompt=row.get("prompt") or "",
        source_file=path,
    )


def load_process_contracts(suite: str | None = None, case_id: str | None = None) -> list[ProcessContract]:
    contracts = [load_process_contract(path) for path in sorted(PROCESS_CONTRACT_DIR.glob("*.process.yaml"))]
    if suite:
        contracts = [
            contract
            for contract in contracts
            if contract.prompt_file == f"{suite}.prompts.csv" or contract.id == suite
        ]
    if case_id:
        contracts = [contract for contract in contracts if contract.prompt_case_id == case_id or contract.id == case_id]
    return contracts


def validate_process_contracts() -> list[str]:
    errors: list[str] = []
    paths = sorted(PROCESS_CONTRACT_DIR.glob("*.process.yaml"))
    if not paths:
        return ["no process eval contracts found"]
    seen_ids: set[str] = set()
    has_positive = False
    has_negative = False
    for path in paths:
        try:
            contract = load_process_contract(path)
            prompt = load_prompt_case(contract)
        except ProcessEvalError as exc:
            errors.append(str(exc))
            continue
        if contract.id in seen_ids:
            errors.append(f"duplicate process contract id: {contract.id}")
        seen_ids.add(contract.id)
        has_positive = has_positive or prompt.should_trigger
        has_negative = has_negative or not prompt.should_trigger
        required_skills = set(contract.protocol["required_skill_reads"])
        if prompt.should_trigger and prompt.skill not in required_skills:
            errors.append(f"{contract.id}: positive case must require reading {prompt.skill}")
        if not prompt.should_trigger and prompt.skill in required_skills:
            errors.append(f"{contract.id}: negative case must not require reading {prompt.skill}")
        missing_tools = sorted(set(contract.protocol["required_tools"]) - set(contract.tools))
        if missing_tools:
            errors.append(f"{contract.id}: required tools are not enabled: {missing_tools}")
        enabled_forbidden = sorted(set(contract.protocol["forbidden_tools"]) & set(contract.tools))
        if enabled_forbidden:
            errors.append(f"{contract.id}: forbidden tools are enabled: {enabled_forbidden}")
        if contract.protocol["required_commands"] and "bash" not in contract.tools:
            errors.append(f"{contract.id}: required commands need the bash tool")
    schema_dir = PROCESS_CONTRACT_DIR.parent / "schemas"
    for name in [
        "process_eval_contract.schema.json",
        "agent_trace.schema.json",
        "process_eval_result.schema.json",
    ]:
        path = schema_dir / name
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"invalid Process Eval schema {path}: {exc}")
    if not has_positive:
        errors.append("process evals need at least one positive case")
    if not has_negative:
        errors.append("process evals need at least one negative case")
    return errors


def redact_home(text: str) -> str:
    text = re.sub(r"/Users/[^/\s\"']+", "~", text)
    return re.sub(r"/home/[^/\s\"']+", "~", text)


def normalize_path(value: str, cwd: Path) -> str:
    expanded = Path(value).expanduser()
    if expanded.is_absolute():
        try:
            return expanded.resolve().relative_to(cwd.resolve()).as_posix()
        except ValueError:
            return redact_home(value)
    return Path(value).as_posix()


def normalize_args(value: Any, cwd: Path, key: str | None = None) -> Any:
    if isinstance(value, dict):
        return {item_key: normalize_args(item_value, cwd, item_key) for item_key, item_value in value.items()}
    if isinstance(value, list):
        return [normalize_args(item, cwd, key) for item in value]
    if isinstance(value, str):
        if key in {"path", "file", "cwd", "root"}:
            return normalize_path(value, cwd)
        return redact_home(value)
    return value


def normalize_pi_jsonl(stdout: str, cwd: Path, *, exit_code: int, stderr: str = "") -> dict[str, Any]:
    events: list[dict[str, Any]] = []
    final_text = ""
    provider = ""
    model = ""
    api = ""
    parse_errors: list[str] = []
    for line_number, raw_line in enumerate(stdout.splitlines(), start=1):
        if not raw_line.strip():
            continue
        try:
            event = json.loads(raw_line)
        except json.JSONDecodeError:
            parse_errors.append(f"line {line_number}: invalid JSON")
            continue
        event_type = event.get("type")
        message = event.get("message") or {}
        if isinstance(message, dict) and message.get("role") == "assistant":
            provider = str(message.get("provider") or provider)
            model = str(message.get("model") or model)
            api = str(message.get("api") or api)
        if event_type == "tool_execution_start":
            events.append(
                {
                    "type": "tool_call",
                    "id": str(event.get("toolCallId") or ""),
                    "tool": str(event.get("toolName") or ""),
                    "args": normalize_args(event.get("args") or {}, cwd),
                }
            )
        elif event_type == "tool_execution_end":
            events.append(
                {
                    "type": "tool_result",
                    "id": str(event.get("toolCallId") or ""),
                    "tool": str(event.get("toolName") or ""),
                    "is_error": bool(event.get("isError")),
                }
            )
        elif event_type == "message_end" and isinstance(message, dict) and message.get("role") == "assistant":
            texts = [
                item.get("text", "")
                for item in message.get("content") or []
                if isinstance(item, dict) and item.get("type") == "text" and item.get("text")
            ]
            if texts:
                final_text = redact_home("\n".join(texts))
    return {
        "kind": "kos_agent_trace",
        "version": 1,
        "backend": "pi",
        "provider": provider,
        "model": model,
        "api": api,
        "exit_code": exit_code,
        "parse_errors": parse_errors,
        "stderr": redact_home(stderr.strip()),
        "events": events,
        "final_text": final_text,
    }


def run_pi_trace(
    pi_path: str,
    vault: Path,
    prompt: str,
    *,
    tools: list[str],
    thinking_level: str,
    timeout_seconds: int,
) -> dict[str, Any]:
    argv = build_pi_argv(
        pi_path,
        vault,
        [
            "--mode",
            "json",
            "--no-session",
            "--tools",
            ",".join(tools),
            "--thinking",
            thinking_level,
            "-p",
            prompt,
        ],
    )
    env = os.environ.copy()
    env.update(
        {
            "PYTHONDONTWRITEBYTECODE": "1",
            "PI_SKIP_VERSION_CHECK": "1",
            "PI_TELEMETRY": "0",
        }
    )
    try:
        completed = subprocess.run(
            argv,
            cwd=vault,
            env=env,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
        )
        return normalize_pi_jsonl(
            completed.stdout,
            vault,
            exit_code=completed.returncode,
            stderr=completed.stderr,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        stderr = exc.stderr.decode() if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        trace = normalize_pi_jsonl(stdout, vault, exit_code=124, stderr=stderr)
        trace["timed_out"] = True
        return trace


def _snapshot_excluded(relative: Path) -> bool:
    if relative.as_posix() in SNAPSHOT_EXCLUDED_FILES:
        return True
    if "__pycache__" in relative.parts:
        return True
    value = relative.as_posix()
    return any(value == prefix or value.startswith(f"{prefix}/") for prefix in SNAPSHOT_EXCLUDED_PREFIXES)


def snapshot_vault(root: Path) -> dict[str, str]:
    snapshot: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if _snapshot_excluded(relative) or path.suffix == ".pyc":
            continue
        snapshot[relative.as_posix()] = sha256_file(path)
    return snapshot


def diff_snapshots(before: dict[str, str], after: dict[str, str]) -> dict[str, list[str]]:
    return {
        "added": sorted(set(after) - set(before)),
        "modified": sorted(path for path in set(before) & set(after) if before[path] != after[path]),
        "deleted": sorted(set(before) - set(after)),
    }


def _skill_reads(trace: dict[str, Any]) -> set[str]:
    names: set[str] = set()
    for event in trace["events"]:
        if event.get("type") != "tool_call" or event.get("tool") != "read":
            continue
        path = str((event.get("args") or {}).get("path") or "")
        match = re.search(r"(?:^|/)41_Skills/(?:[^/]+/)*([^/]+)/SKILL\.md$", path)
        if match:
            names.add(match.group(1))
    return names


def _read_paths(trace: dict[str, Any]) -> list[str]:
    return [
        str((event.get("args") or {}).get("path") or "")
        for event in trace["events"]
        if event.get("type") == "tool_call" and event.get("tool") == "read"
    ]


def _commands(trace: dict[str, Any]) -> list[str]:
    return [
        str((event.get("args") or {}).get("command") or "")
        for event in trace["events"]
        if event.get("type") == "tool_call" and event.get("tool") == "bash"
    ]


def evaluate_process_trace(
    contract: ProcessContract,
    prompt: PromptCase,
    trace: dict[str, Any],
    vault_changes: dict[str, list[str]],
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    required_check_ids: list[str] = []
    violation_check_ids: list[str] = []

    def add(check_id: str, passed: bool, evidence: Any, *, required: bool = False, violation: bool = False) -> None:
        checks.append({"id": check_id, "pass": passed, "evidence": evidence})
        if required:
            required_check_ids.append(check_id)
        if violation:
            violation_check_ids.append(check_id)

    loaded_skills = _skill_reads(trace)
    read_paths = _read_paths(trace)
    commands = _commands(trace)
    tool_calls = [event for event in trace["events"] if event.get("type") == "tool_call"]
    tool_names = [str(event.get("tool") or "") for event in tool_calls]

    route_pass = prompt.skill in loaded_skills if prompt.should_trigger else prompt.skill not in loaded_skills
    add(
        "route",
        route_pass,
        {"expected_skill": prompt.skill, "should_trigger": prompt.should_trigger, "loaded_skills": sorted(loaded_skills)},
    )
    add("process_exit", trace.get("exit_code") == 0, {"exit_code": trace.get("exit_code")})
    add("trace_parse", not trace.get("parse_errors"), trace.get("parse_errors") or [])

    for skill in contract.protocol["required_skill_reads"]:
        add(
            f"required_skill:{skill}",
            skill in loaded_skills,
            sorted(loaded_skills),
            required=True,
        )
    for pattern in contract.protocol["required_reads"]:
        matched = [path for path in read_paths if fnmatch.fnmatch(path, pattern)]
        add(f"required_read:{pattern}", bool(matched), matched, required=True)
    for tool in contract.protocol["required_tools"]:
        count = tool_names.count(tool)
        add(f"required_tool:{tool}", count > 0, {"count": count}, required=True)
    for fragment in contract.protocol["required_commands"]:
        matched = [command for command in commands if fragment in command]
        add(f"required_command:{fragment}", bool(matched), matched, required=True)

    for tool in contract.protocol["forbidden_tools"]:
        matched = [event for event in tool_calls if event.get("tool") == tool]
        add(f"forbidden_tool:{tool}", not matched, {"count": len(matched)}, violation=True)
    for fragment in contract.protocol["forbidden_commands"]:
        matched = [command for command in commands if fragment in command]
        add(f"forbidden_command:{fragment}", not matched, matched, violation=True)
    serialized_args = [json.dumps(event.get("args") or {}, ensure_ascii=False, sort_keys=True) for event in tool_calls]
    for fragment in contract.protocol["forbidden_path_fragments"]:
        matched = [args for args in serialized_args if fragment in args]
        add(f"forbidden_path:{fragment}", not matched, matched, violation=True)

    changed_paths = sorted(vault_changes["added"] + vault_changes["modified"] + vault_changes["deleted"])
    if contract.protocol["forbid_vault_changes"]:
        add("vault_unchanged", not changed_paths, vault_changes, violation=True)
    tool_errors = [event for event in trace["events"] if event.get("type") == "tool_result" and event.get("is_error")]
    add("tool_errors", not tool_errors, {"count": len(tool_errors)}, violation=True)

    required_passed = sum(1 for check in checks if check["id"] in required_check_ids and check["pass"])
    required_total = len(required_check_ids)
    violation_count = sum(1 for check in checks if check["id"] in violation_check_ids and not check["pass"])
    protocol_checks = [check for check in checks if check["id"] != "route"]
    protocol_pass = all(check["pass"] for check in protocol_checks)
    return {
        "id": contract.id,
        "prompt_case_id": prompt.id,
        "prompt_file": prompt.source_file.name,
        "skill": prompt.skill,
        "should_trigger": prompt.should_trigger,
        "route_pass": route_pass,
        "protocol_pass": protocol_pass,
        "overall_pass": route_pass and protocol_pass,
        "metrics": {
            "required_step_coverage": round(required_passed / required_total, 4) if required_total else 1.0,
            "required_steps_passed": required_passed,
            "required_steps_total": required_total,
            "forbidden_violation_count": violation_count,
        },
        "checks": checks,
        "vault_changes": vault_changes,
        "trace": trace,
    }


def aggregate_process_results(results: list[dict[str, Any]]) -> dict[str, Any]:
    tp = sum(1 for item in results if item["should_trigger"] and item["route_pass"])
    fn = sum(1 for item in results if item["should_trigger"] and not item["route_pass"])
    tn = sum(1 for item in results if not item["should_trigger"] and item["route_pass"])
    fp = sum(1 for item in results if not item["should_trigger"] and not item["route_pass"])
    required_passed = sum(item["metrics"]["required_steps_passed"] for item in results)
    required_total = sum(item["metrics"]["required_steps_total"] for item in results)
    violations = sum(item["metrics"]["forbidden_violation_count"] for item in results)
    return {
        "case_count": len(results),
        "passed_cases": sum(1 for item in results if item["overall_pass"]),
        "route": {
            "true_positive": tp,
            "false_negative": fn,
            "true_negative": tn,
            "false_positive": fp,
            "precision": round(tp / (tp + fp), 4) if tp + fp else None,
            "recall": round(tp / (tp + fn), 4) if tp + fn else None,
        },
        "required_step_coverage": round(required_passed / required_total, 4) if required_total else 1.0,
        "forbidden_violation_count": violations,
    }


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
