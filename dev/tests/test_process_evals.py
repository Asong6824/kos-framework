from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
import sys

sys.path.insert(0, str(REPO_ROOT / "dev/harness"))

from process_eval_common import (  # noqa: E402
    ProcessContract,
    PromptCase,
    aggregate_process_results,
    diff_snapshots,
    evaluate_process_trace,
    load_process_contracts,
    normalize_pi_jsonl,
    run_pi_trace,
    snapshot_vault,
    validate_process_contracts,
)


def protocol(**overrides):
    value = {
        "required_skill_reads": [],
        "required_reads": [],
        "required_tools": [],
        "required_commands": [],
        "forbidden_tools": [],
        "forbidden_commands": [],
        "forbidden_path_fragments": [],
        "forbid_vault_changes": True,
    }
    value.update(overrides)
    return value


def contract(**overrides) -> ProcessContract:
    values = {
        "id": "case-1",
        "prompt_file": "kos-system-check.prompts.csv",
        "prompt_case_id": "full-system-01",
        "backend": "pi",
        "timeout_seconds": 30,
        "tools": ["read", "bash"],
        "thinking_level": "low",
        "protocol": protocol(),
        "source_file": REPO_ROOT / "dev/evals/process/kos-system-check-full.process.yaml",
    }
    values.update(overrides)
    return ProcessContract(**values)


def prompt(*, should_trigger: bool = True, skill: str = "kos-system-check") -> PromptCase:
    return PromptCase(
        id="full-system-01",
        skill=skill,
        should_trigger=should_trigger,
        prompt="check",
        source_file=REPO_ROOT / "dev/evals/core/kos-system-check.prompts.csv",
    )


def trace(events, *, exit_code: int = 0):
    return {
        "kind": "kos_agent_trace",
        "version": 1,
        "backend": "pi",
        "provider": "custom",
        "model": "test-model",
        "api": "openai-responses",
        "exit_code": exit_code,
        "parse_errors": [],
        "stderr": "",
        "events": events,
        "final_text": "done",
    }


class ProcessEvalTests(unittest.TestCase):
    def test_checked_in_contracts_are_valid_and_cover_positive_and_negative(self) -> None:
        self.assertEqual(validate_process_contracts(), [])
        contracts = load_process_contracts()
        self.assertGreaterEqual(len(contracts), 2)

    def test_pi_json_normalization_keeps_actions_but_drops_reasoning(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            cwd = Path(tempdir)
            skill_path = cwd / "80_Skills/core/kos-system-check/SKILL.md"
            lines = [
                {"type": "message_update", "secret_reasoning": "must-not-survive"},
                {
                    "type": "message_start",
                    "message": {
                        "role": "assistant",
                        "provider": "custom",
                        "model": "gpt-test",
                        "api": "openai-responses",
                        "content": [],
                    },
                },
                {
                    "type": "tool_execution_start",
                    "toolCallId": "call-1",
                    "toolName": "read",
                    "args": {"path": str(skill_path)},
                },
                {
                    "type": "tool_execution_end",
                    "toolCallId": "call-1",
                    "toolName": "read",
                    "isError": False,
                },
                {
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "finished"}],
                    },
                },
            ]
            normalized = normalize_pi_jsonl(
                "\n".join(json.dumps(item) for item in lines),
                cwd,
                exit_code=0,
            )

        serialized = json.dumps(normalized)
        self.assertNotIn("must-not-survive", serialized)
        self.assertEqual(normalized["provider"], "custom")
        self.assertEqual(normalized["model"], "gpt-test")
        self.assertEqual(
            normalized["events"][0]["args"]["path"],
            "80_Skills/core/kos-system-check/SKILL.md",
        )
        self.assertEqual(normalized["final_text"], "finished")

    def test_positive_case_passes_route_and_protocol(self) -> None:
        current_contract = contract(
            protocol=protocol(
                required_skill_reads=["kos-system-check"],
                required_reads=[".kos.md"],
                required_tools=["bash"],
                required_commands=["kos-harness validate"],
                forbidden_tools=["write", "edit"],
            )
        )
        current_trace = trace(
            [
                {"type": "tool_call", "id": "1", "tool": "read", "args": {"path": ".kos.md"}},
                {
                    "type": "tool_call",
                    "id": "2",
                    "tool": "read",
                    "args": {"path": "80_Skills/core/kos-system-check/SKILL.md"},
                },
                {
                    "type": "tool_call",
                    "id": "3",
                    "tool": "bash",
                    "args": {"command": "kos-harness validate"},
                },
                {"type": "tool_result", "id": "3", "tool": "bash", "is_error": False},
            ]
        )

        result = evaluate_process_trace(
            current_contract,
            prompt(),
            current_trace,
            {"added": [], "modified": [], "deleted": []},
        )

        self.assertTrue(result["overall_pass"])
        self.assertEqual(result["metrics"]["required_step_coverage"], 1.0)
        self.assertEqual(result["metrics"]["forbidden_violation_count"], 0)

    def test_wrong_skill_missing_steps_and_write_are_failures(self) -> None:
        current_contract = contract(
            protocol=protocol(
                required_skill_reads=["kos-system-check"],
                required_commands=["kos-harness validate"],
                forbidden_tools=["write"],
            )
        )
        current_trace = trace(
            [
                {
                    "type": "tool_call",
                    "id": "1",
                    "tool": "read",
                    "args": {"path": "80_Skills/core/kos-eval-skill/SKILL.md"},
                },
                {
                    "type": "tool_call",
                    "id": "2",
                    "tool": "write",
                    "args": {"path": "31_项目/unexpected.md"},
                },
            ]
        )

        result = evaluate_process_trace(
            current_contract,
            prompt(),
            current_trace,
            {"added": ["31_项目/unexpected.md"], "modified": [], "deleted": []},
        )

        failures = {item["id"] for item in result["checks"] if not item["pass"]}
        self.assertFalse(result["route_pass"])
        self.assertFalse(result["protocol_pass"])
        self.assertIn("required_skill:kos-system-check", failures)
        self.assertIn("required_command:kos-harness validate", failures)
        self.assertIn("forbidden_tool:write", failures)
        self.assertIn("vault_unchanged", failures)

    def test_negative_case_passes_when_target_skill_is_not_loaded(self) -> None:
        current_trace = trace(
            [
                {
                    "type": "tool_call",
                    "id": "1",
                    "tool": "read",
                    "args": {"path": "80_Skills/core/kos-create-project/SKILL.md"},
                }
            ]
        )
        result = evaluate_process_trace(
            contract(),
            prompt(should_trigger=False, skill="kos-skill-manager"),
            current_trace,
            {"added": [], "modified": [], "deleted": []},
        )
        self.assertTrue(result["route_pass"])
        self.assertTrue(result["overall_pass"])

        metrics = aggregate_process_results([result])
        self.assertEqual(metrics["route"]["true_negative"], 1)

    def test_snapshot_ignores_generated_adapter_and_reports(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            (root / ".kos.md").write_text("base", encoding="utf-8")
            before = snapshot_vault(root)
            (root / ".pi").mkdir()
            (root / ".pi/settings.json").write_text("{}", encoding="utf-8")
            artifact = root / "90_系统/evals/artifacts/health.json"
            artifact.parent.mkdir(parents=True)
            artifact.write_text("generated", encoding="utf-8")
            (root / ".kos.md").write_text("changed", encoding="utf-8")
            after = snapshot_vault(root)

        diff = diff_snapshots(before, after)
        self.assertEqual(diff["modified"], [".kos.md"])
        self.assertEqual(diff["added"], [])

    def test_run_pi_trace_accepts_a_fake_json_backend(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            (root / "80_Skills/core").mkdir(parents=True)
            fake_pi = root / "fake-pi"
            fake_pi.write_text(
                "#!/usr/bin/env python3\n"
                "import json, sys\n"
                "if '--version' in sys.argv:\n"
                "    print('test')\n"
                "else:\n"
                "    print(json.dumps({'type':'tool_execution_start','toolCallId':'1','toolName':'read','args':{'path':'.kos.md'}}))\n"
                "    print(json.dumps({'type':'message_end','message':{'role':'assistant','provider':'custom','model':'fake','api':'openai-responses','content':[{'type':'text','text':'ok'}]}}))\n",
                encoding="utf-8",
            )
            os.chmod(fake_pi, 0o755)

            result = run_pi_trace(
                str(fake_pi),
                root,
                "prompt",
                tools=["read"],
                thinking_level="off",
                timeout_seconds=10,
            )

        self.assertEqual(result["exit_code"], 0)
        self.assertEqual(result["model"], "fake")
        self.assertEqual(result["final_text"], "ok")


if __name__ == "__main__":
    unittest.main()
