#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from collections import Counter
from typing import Any

from harness_common import Finding, find_vault_root, has_errors, parse_args, parse_frontmatter, print_findings, relpath


SCOPE_DIRS = {
    "core": "core",
    "integration": "integrations",
    "personal": "personal",
    "incubator": "incubator",
    "archived": "archived",
}


def nested_get(data: dict[str, Any], *keys: str) -> Any:
    cur: Any = data
    for key in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def expected_scope(path: Path, skill_root: Path) -> str | None:
    rel = path.relative_to(skill_root).parts
    if len(rel) < 3 or rel[-1] != "SKILL.md":
        return None
    top = rel[0]
    if top == "core":
        return "core"
    if top == "integrations":
        return "integration"
    if top == "personal":
        return "personal"
    if top == "incubator":
        return "incubator"
    if top == "archived":
        return "archived"
    return None


def main() -> int:
    args = parse_args("校验 kos Skill 分类和元数据")
    root = Path(args.root).resolve() if args.root else find_vault_root()
    skill_root = root / "41_Skills"
    findings: list[Finding] = []
    counts: Counter[str] = Counter()

    if not skill_root.is_dir():
        findings.append(Finding("ERROR", "41_Skills", "缺少 Skill 根目录"))
        print_findings(findings, "Skill 检查报告", markdown=args.format == "markdown")
        return 1

    for dirname in ["core", "integrations", "personal", "incubator", "archived"]:
        if not (skill_root / dirname).is_dir():
            findings.append(Finding("ERROR", f"41_Skills/{dirname}", "缺少 Skill scope 目录"))

    for skill_file in sorted(skill_root.rglob("SKILL.md")):
        rel = relpath(skill_file, root)
        frontmatter, _ = parse_frontmatter(skill_file)
        if not frontmatter:
            findings.append(Finding("ERROR", rel, "缺少 frontmatter"))
            continue

        name = frontmatter.get("name")
        if not name:
            findings.append(Finding("ERROR", rel, "缺少 name"))
        elif skill_file.parent.name != str(name):
            findings.append(Finding("WARN", rel, f"name 与目录名不一致：name={name}"))

        for field in ["description", "version"]:
            if not frontmatter.get(field):
                findings.append(Finding("ERROR", rel, f"缺少 {field}"))

        scope = nested_get(frontmatter, "metadata", "kos", "scope")
        lifecycle = nested_get(frontmatter, "metadata", "kos", "lifecycle")
        pinned = nested_get(frontmatter, "metadata", "hermes", "pinned")
        promoted = nested_get(frontmatter, "metadata", "kos", "promoted")
        review_required = nested_get(frontmatter, "metadata", "kos", "review_required")
        object_types = nested_get(frontmatter, "metadata", "kos", "object_types")
        external_systems = nested_get(frontmatter, "metadata", "kos", "external_systems")

        expected = expected_scope(skill_file, skill_root)
        if expected is None:
            findings.append(Finding("ERROR", rel, "SKILL.md 不在允许的 scope 目录下"))
        elif scope != expected:
            findings.append(Finding("ERROR", rel, f"metadata.kos.scope 应为 {expected}"))
        else:
            counts[str(scope)] += 1

        if scope not in SCOPE_DIRS:
            findings.append(Finding("ERROR", rel, "metadata.kos.scope 缺失或非法"))
        if lifecycle not in {"active", "experimental", "deprecated", "archived"}:
            findings.append(Finding("ERROR", rel, "metadata.kos.lifecycle 缺失或非法"))
        if not isinstance(pinned, bool):
            findings.append(Finding("ERROR", rel, "metadata.hermes.pinned 必须为布尔值"))
        if not isinstance(promoted, bool):
            findings.append(Finding("ERROR", rel, "metadata.kos.promoted 必须为布尔值"))
        if not isinstance(review_required, bool):
            findings.append(Finding("ERROR", rel, "metadata.kos.review_required 必须为布尔值"))
        if not isinstance(object_types, list):
            findings.append(Finding("ERROR", rel, "metadata.kos.object_types 必须为数组"))
        if not isinstance(external_systems, list):
            findings.append(Finding("ERROR", rel, "metadata.kos.external_systems 必须为数组"))

        if scope == "core" and pinned is not True:
            findings.append(Finding("ERROR", rel, "core Skill 必须 pinned: true"))
        if scope == "integration" and not external_systems:
            findings.append(Finding("ERROR", rel, "integration Skill 必须声明 external_systems"))
        if scope == "incubator":
            if pinned is not False:
                findings.append(Finding("ERROR", rel, "incubator Skill 必须 pinned: false"))
            if promoted is not False:
                findings.append(Finding("ERROR", rel, "incubator Skill 必须 promoted: false"))
            if review_required is not True:
                findings.append(Finding("ERROR", rel, "incubator Skill 必须 review_required: true"))
        if scope == "archived":
            if pinned is not False:
                findings.append(Finding("ERROR", rel, "archived Skill 必须 pinned: false"))
            if lifecycle != "archived":
                findings.append(Finding("ERROR", rel, "archived Skill 必须 lifecycle: archived"))

    total = sum(counts.values())
    findings.append(Finding("INFO", "41_Skills", f"共发现 {total} 个 SKILL.md"))
    for scope in ["core", "integration", "personal", "incubator", "archived"]:
        findings.append(Finding("INFO", f"41_Skills/{SCOPE_DIRS[scope]}", f"{counts.get(scope, 0)} 个 Skill"))

    print_findings(findings, "Skill 检查报告", markdown=args.format == "markdown")
    return 1 if has_errors(findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
