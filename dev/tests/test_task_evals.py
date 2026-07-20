from __future__ import annotations

import sys
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
RUNTIME_HARNESS = REPO_ROOT / "vault/90_系统/harness"
TASK_EVALUATOR = RUNTIME_HARNESS / "evaluate_task_contract.py"
sys.path.insert(0, str(RUNTIME_HARNESS))

from task_eval_common import (  # noqa: E402
    TaskContractError,
    evaluate_task_contract,
    update_run_state,
    validate_task_contract,
)


def base_contract() -> dict:
    return {
        "version": 1,
        "id": "project-created",
        "skill": "kos-create-project",
        "objective": "创建结构完整的 Project",
        "max_iterations": 3,
        "checks": [
            {
                "id": "project_exists",
                "type": "path_exists",
                "path": "30_项目/测试项目.md",
            },
            {
                "id": "project_status",
                "type": "frontmatter",
                "path": "30_项目/测试项目.md",
                "field": "status",
                "operator": "equals",
                "expected": "idea",
            },
            {
                "id": "has_success_section",
                "type": "text_contains",
                "path": "30_项目/测试项目.md",
                "values": ["### 成功指标"],
            },
        ],
        "rubric": [
            {
                "id": "actionability",
                "description": "下一步行动具体且可执行",
                "min_score": 3,
                "weight": 1,
            }
        ],
    }


class TaskEvalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        (self.root / ".kos.md").write_text("# test\n", encoding="utf-8")
        (self.root / "30_项目").mkdir()

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def write_project(self) -> None:
        (self.root / "30_项目/测试项目.md").write_text(
            "---\ntype: project\nstatus: idea\n---\n\n### 成功指标\n\n- 可以验收\n",
            encoding="utf-8",
        )

    def assessment(self, with_evidence: bool = True) -> dict:
        return {
            "contract_id": "project-created",
            "summary": "项目对象满足任务合同",
            "next_action": "",
            "rubric": {
                "actionability": {
                    "score": 4,
                    "evidence": ["30_项目/测试项目.md#成功指标"] if with_evidence else [],
                }
            },
        }

    def test_contract_rejects_paths_outside_vault(self) -> None:
        contract = base_contract()
        contract["checks"][0]["path"] = "../outside.md"

        errors = validate_task_contract(contract)

        self.assertTrue(any("vault" in error for error in errors))

    def test_contract_rejects_unknown_fields(self) -> None:
        contract = base_contract()
        contract["success_message"] = "looks good"

        errors = validate_task_contract(contract)

        self.assertTrue(any("未知顶层字段" in error for error in errors))

    def test_deterministic_checks_and_evidence_rubric_can_pass(self) -> None:
        self.write_project()

        attempt = evaluate_task_contract(self.root, base_contract(), self.assessment())

        self.assertTrue(attempt["pass"])
        self.assertEqual(attempt["deterministic_score"], 100)
        self.assertEqual(attempt["semantic_score"], 100)

    def test_semantic_score_without_evidence_does_not_pass(self) -> None:
        self.write_project()

        attempt = evaluate_task_contract(self.root, base_contract(), self.assessment(with_evidence=False))

        self.assertFalse(attempt["pass"])
        self.assertIn("actionability", attempt["failures"])

    def test_run_state_records_pass_at_1_and_pass_at_k(self) -> None:
        contract = base_contract()
        first = evaluate_task_contract(self.root, contract, self.assessment(), iteration=1)
        state = update_run_state(None, contract, first, "run-1")
        self.assertEqual(state["status"], "retryable")
        self.assertFalse(state["metrics"]["pass_at_1"])

        self.write_project()
        second = evaluate_task_contract(self.root, contract, self.assessment(), iteration=2)
        state = update_run_state(state, contract, second, "run-1")

        self.assertEqual(state["status"], "pass")
        self.assertFalse(state["metrics"]["pass_at_1"])
        self.assertTrue(state["metrics"]["pass_at_k"])
        self.assertEqual(state["metrics"]["iterations"], 2)

    def test_run_state_rejects_contract_changes_between_iterations(self) -> None:
        contract = base_contract()
        first = evaluate_task_contract(self.root, contract, self.assessment(), iteration=1)
        state = update_run_state(None, contract, first, "run-1")
        contract["checks"] = [contract["checks"][0]]
        second = evaluate_task_contract(self.root, contract, self.assessment(), iteration=2)

        with self.assertRaises(TaskContractError):
            update_run_state(state, contract, second, "run-1")

    def test_run_exhausts_at_contract_iteration_limit(self) -> None:
        contract = base_contract()
        contract["max_iterations"] = 1
        attempt = evaluate_task_contract(self.root, contract, self.assessment(), iteration=1)

        state = update_run_state(None, contract, attempt, "run-1")

        self.assertEqual(state["status"], "exhausted")
        self.assertFalse(state["metrics"]["pass_at_k"])

    def test_run_pauses_when_agent_needs_user(self) -> None:
        contract = base_contract()
        assessment = self.assessment()
        assessment["needs_user"] = True
        attempt = evaluate_task_contract(self.root, contract, assessment, iteration=1)

        state = update_run_state(None, contract, attempt, "run-1")

        self.assertEqual(state["status"], "needs_user")

    def test_cli_accumulates_attempts_in_state_file(self) -> None:
        contract_path = self.root / "project.task.yaml"
        assessment_path = self.root / "assessment.yaml"
        state_path = self.root / "run.json"
        contract_path.write_text(yaml.safe_dump(base_contract(), allow_unicode=True), encoding="utf-8")
        assessment_path.write_text(yaml.safe_dump(self.assessment(), allow_unicode=True), encoding="utf-8")
        command = [
            sys.executable,
            str(TASK_EVALUATOR),
            "--root",
            str(self.root),
            "--contract",
            str(contract_path),
            "--self-assessment",
            str(assessment_path),
            "--state",
            str(state_path),
            "--run-id",
            "run-1",
            "--format",
            "json",
        ]

        first = subprocess.run(command, text=True, capture_output=True, check=False)
        self.assertEqual(first.returncode, 1, first.stdout + first.stderr)

        self.write_project()
        second = subprocess.run(command, text=True, capture_output=True, check=False)
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        state = yaml.safe_load(state_path.read_text(encoding="utf-8"))
        self.assertEqual(state["status"], "pass")
        self.assertEqual(state["metrics"]["iterations"], 2)


if __name__ == "__main__":
    unittest.main()
