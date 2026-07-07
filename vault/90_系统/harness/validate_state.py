#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from harness_common import (
    Finding,
    find_vault_root,
    has_errors,
    iter_markdown_objects,
    load_schemas,
    parse_args,
    parse_frontmatter,
    print_findings,
    relpath,
)

STATUS_FIELD_BY_TYPE = {
    "source": "status",
    "research": "status",
    "concept": "status",
    "project": "status",
    "task": "status",
    "reflection": "status",
    "method": "status",
    "personal_operating_profile": "status",
    "topic_watch": "status",
    "company_watch": "status",
}


def enum_values(schema: dict, field: str) -> list:
    rule = (schema.get("required") or {}).get(field) or (schema.get("optional") or {}).get(field) or {}
    return list(rule.get("values") or [])


def main() -> int:
    args = parse_args("校验 kos 对象状态字段")
    root = Path(args.root).resolve() if args.root else find_vault_root()
    schemas = load_schemas()
    findings: list[Finding] = []

    for path in iter_markdown_objects(root):
        rel = relpath(path, root)
        frontmatter, _ = parse_frontmatter(path)
        if not frontmatter:
            continue
        obj_type = str(frontmatter.get("type") or "")
        field = STATUS_FIELD_BY_TYPE.get(obj_type)
        if not field:
            continue
        schema = schemas.get(obj_type)
        if not schema:
            continue
        if field not in frontmatter:
            findings.append(Finding("ERROR", rel, f"type={obj_type} 缺少状态字段 `{field}`"))
            continue
        allowed = enum_values(schema, field)
        if allowed and frontmatter[field] not in allowed:
            findings.append(
                Finding("ERROR", rel, f"`{field}` 状态非法：{frontmatter[field]!r}，允许：{allowed}")
            )
        if obj_type in {"concept", "method"} and frontmatter[field] in {"verified", "mature", "usable", "trusted"}:
            findings.append(
                Finding(
                    "WARN",
                    rel,
                    f"`{field}` 为 {frontmatter[field]!r}，确认这是人工审核后的状态",
                )
            )
        if obj_type == "source" and frontmatter[field] == "reviewed":
            findings.append(Finding("WARN", rel, "Source 已 reviewed，确认不是 AI 自动设置"))
        if obj_type == "personal_operating_profile" and frontmatter[field] in {"reviewed", "active"}:
            findings.append(
                Finding(
                    "WARN",
                    rel,
                    f"`{field}` 为 {frontmatter[field]!r}，确认这是人工审核后的个人操作画像",
                )
            )

    print_findings(findings, "状态检查报告", markdown=args.format == "markdown")
    return 1 if has_errors(findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
