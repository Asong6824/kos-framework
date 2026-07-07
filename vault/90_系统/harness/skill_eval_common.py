from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from harness_common import parse_frontmatter


EVAL_DIR = Path("90_系统/evals")
EVAL_SKILL_DIR = EVAL_DIR / "skills"


@dataclass
class EvalCase:
    id: str
    skill: str
    should_trigger: bool
    prompt: str
    expected_checks: list[str]
    notes: str
    source_file: Path


@dataclass
class CheckResult:
    id: str
    passed: bool
    notes: str


def load_eval_cases(root: Path, suite: str | None = None) -> list[EvalCase]:
    skill_dir = root / EVAL_SKILL_DIR
    files = sorted(skill_dir.glob("*.prompts.csv"))
    if suite:
        target = skill_dir / suite
        if target.suffix != ".csv":
            target = skill_dir / f"{suite}.prompts.csv"
        files = [target]

    cases: list[EvalCase] = []
    for path in files:
        with path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                raw_should = (row.get("should_trigger") or "").strip().lower()
                checks = [
                    item.strip()
                    for item in (row.get("expected_checks") or "").split("|")
                    if item.strip()
                ]
                cases.append(
                    EvalCase(
                        id=(row.get("id") or "").strip(),
                        skill=(row.get("skill") or "").strip(),
                        should_trigger=raw_should == "true",
                        prompt=row.get("prompt") or "",
                        expected_checks=checks,
                        notes=row.get("notes") or "",
                        source_file=path,
                    )
                )
    return cases


def find_skill_file(root: Path, skill_name: str) -> Path | None:
    for path in sorted((root / "41_Skills").rglob("SKILL.md")):
        frontmatter, _ = parse_frontmatter(path)
        if frontmatter and frontmatter.get("name") == skill_name:
            return path
    return None


def read_skill(root: Path, skill_name: str) -> tuple[Path | None, dict, str]:
    path = find_skill_file(root, skill_name)
    if not path:
        return None, {}, ""
    frontmatter, body = parse_frontmatter(path)
    return path, frontmatter or {}, body


def nested_get(data: dict, *keys: str):
    cur = data
    for key in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def text_has_all(text: str, fragments: list[str]) -> bool:
    return all(fragment in text for fragment in fragments)


def build_checkers(root: Path) -> dict[str, Callable[[EvalCase], CheckResult]]:
    def skill_exists(case: EvalCase) -> CheckResult:
        path = find_skill_file(root, case.skill)
        return CheckResult("skill_exists", path is not None, str(path) if path else "Skill 不存在")

    def metadata_scope(expected: str) -> Callable[[EvalCase], CheckResult]:
        def check(case: EvalCase) -> CheckResult:
            _, fm, _ = read_skill(root, case.skill)
            actual = nested_get(fm, "metadata", "kos", "scope")
            return CheckResult(f"metadata_scope_{expected}", actual == expected, f"scope={actual!r}")

        return check

    def has_external_systems(case: EvalCase) -> CheckResult:
        _, fm, _ = read_skill(root, case.skill)
        systems = nested_get(fm, "metadata", "kos", "external_systems")
        return CheckResult("has_external_systems", isinstance(systems, list) and bool(systems), f"external_systems={systems!r}")

    def core_pinned(case: EvalCase) -> CheckResult:
        _, fm, _ = read_skill(root, case.skill)
        pinned = nested_get(fm, "metadata", "hermes", "pinned")
        return CheckResult("core_pinned", pinned is True, f"pinned={pinned!r}")

    def body_contains(check_id: str, fragments: list[str]) -> Callable[[EvalCase], CheckResult]:
        def check(case: EvalCase) -> CheckResult:
            _, _, body = read_skill(root, case.skill)
            ok = text_has_all(body, fragments)
            return CheckResult(check_id, ok, " / ".join(fragments))

        return check

    def has_required_sections(case: EvalCase) -> CheckResult:
        _, _, body = read_skill(root, case.skill)
        sections = [
            "## When to Use",
            "## Prerequisites",
            "## How to Run",
            "## Quick Reference",
            "## Procedure",
            "## Pitfalls",
            "## Verification",
        ]
        missing = [section for section in sections if section not in body]
        return CheckResult(
            "has_required_sections",
            not missing,
            "complete" if not missing else f"missing={missing}",
        )

    def path_exists(check_id: str, relative_parts: list[str]) -> Callable[[EvalCase], CheckResult]:
        def check(case: EvalCase) -> CheckResult:
            skill_path = find_skill_file(root, case.skill)
            if not skill_path:
                return CheckResult(check_id, False, "Skill 不存在")
            target = skill_path.parent.joinpath(*relative_parts)
            return CheckResult(check_id, target.exists(), str(target))

        return check

    return {
        "skill_exists": skill_exists,
        "metadata_scope_core": metadata_scope("core"),
        "metadata_scope_integration": metadata_scope("integration"),
        "metadata_scope_personal": metadata_scope("personal"),
        "has_external_systems": has_external_systems,
        "core_pinned": core_pinned,
        "has_required_sections": has_required_sections,
        "mentions_wait_for_transcript": body_contains("mentions_wait_for_transcript", ["等待转录确认"]),
        "mentions_10_inbox": body_contains("mentions_10_inbox", ["10_收件箱"]),
        "mentions_11_video": body_contains("mentions_11_video", ["11_原材料/视频"]),
        "no_legacy_00_inbox": body_contains("no_legacy_00_inbox", ["不要写入 `00_收件箱/`"]),
        "preserves_extend_config": path_exists("preserves_extend_config", ["config", "EXTEND.md"]),
        "does_not_default_write_kos": body_contains("does_not_default_write_kos", ["默认不", "写入 kos"]),
        "has_rules": path_exists("has_rules", ["rules"]),
        "has_strategies": path_exists("has_strategies", ["strategies"]),
        "asks_when_missing_experience": body_contains("asks_when_missing_experience", ["素材不足", "先询问"]),
        "no_fabrication_rule": body_contains("no_fabrication_rule", ["不可虚构"]),
        "incubator_promotion_requires_human": body_contains("incubator_promotion_requires_human", ["用户明确确认", "晋升"]),
        "promotion_requires_eval": body_contains("promotion_requires_eval", ["eval", "晋升"]),
    }
