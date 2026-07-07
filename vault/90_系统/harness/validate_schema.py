#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from harness_common import (
    Finding,
    check_kind,
    find_vault_root,
    has_errors,
    iter_markdown_objects,
    load_schemas,
    parse_args,
    parse_frontmatter,
    print_findings,
    relpath,
)


def validate_file(path: Path, root: Path, schemas: dict) -> list[Finding]:
    findings: list[Finding] = []
    rel = relpath(path, root)
    frontmatter, _ = parse_frontmatter(path)
    if frontmatter is None:
        findings.append(Finding("WARN", rel, "缺少 frontmatter"))
        return findings
    obj_type = frontmatter.get("type")
    if not obj_type:
        findings.append(Finding("WARN", rel, "缺少 type 字段"))
        return findings
    schema = schemas.get(str(obj_type))
    if not schema:
        findings.append(Finding("INFO", rel, f"type={obj_type} 暂无 schema，跳过字段校验"))
        return findings
    for field, rule in (schema.get("required") or {}).items():
        if field not in frontmatter:
            findings.append(Finding("ERROR", rel, f"缺少必填字段 `{field}`"))
            continue
        error = check_kind(frontmatter[field], rule)
        if error:
            findings.append(Finding("ERROR", rel, f"`{field}` {error}，当前值：{frontmatter[field]!r}"))
    for field, value in frontmatter.items():
        rule = (schema.get("required") or {}).get(field) or (schema.get("optional") or {}).get(field)
        if rule:
            error = check_kind(value, rule)
            if error:
                findings.append(Finding("ERROR", rel, f"`{field}` {error}，当前值：{value!r}"))
    return findings


def main() -> int:
    args = parse_args("校验 kos 对象 frontmatter schema")
    root = Path(args.root).resolve() if args.root else find_vault_root()
    schemas = load_schemas()
    findings: list[Finding] = []
    for path in iter_markdown_objects(root):
        findings.extend(validate_file(path, root, schemas))
    print_findings(findings, "Schema 检查报告", markdown=args.format == "markdown")
    return 1 if has_errors(findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
