#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from harness_common import (
    Finding,
    REQUIRED_DIRS,
    find_vault_root,
    has_errors,
    iter_markdown_objects,
    load_schemas,
    parse_args,
    parse_frontmatter,
    print_findings,
    relpath,
)


def path_allowed(rel: str, schema: dict) -> bool:
    allowed = schema.get("paths") or []
    return any(rel == prefix or rel.startswith(f"{prefix}/") for prefix in allowed)


def main() -> int:
    args = parse_args("校验 kos 对象路径和目录归属")
    root = Path(args.root).resolve() if args.root else find_vault_root()
    schemas = load_schemas()
    findings: list[Finding] = []

    for rel in REQUIRED_DIRS:
        path = root / rel
        if not path.is_dir():
            findings.append(Finding("ERROR", rel, "缺少框架要求的目录"))

    nested = root / root.name
    if nested.exists():
        findings.append(
            Finding(
                "ERROR",
                relpath(nested, root),
                "发现嵌套 vault 目录，通常表示写入时错误使用了 `kos/` 路径前缀",
            )
        )

    for path in iter_markdown_objects(root):
        rel = relpath(path, root)
        frontmatter, _ = parse_frontmatter(path)
        if not frontmatter:
            continue
        obj_type = frontmatter.get("type")
        if not obj_type:
            continue
        schema = schemas.get(str(obj_type))
        if schema and not path_allowed(rel, schema):
            findings.append(
                Finding(
                    "ERROR",
                    rel,
                    f"type={obj_type} 不应放在此目录；允许目录：{schema.get('paths')}",
                )
            )

    print_findings(findings, "路径检查报告", markdown=args.format == "markdown")
    return 1 if has_errors(findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
