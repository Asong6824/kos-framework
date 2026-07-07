#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any

from harness_common import (
    Finding,
    find_vault_root,
    has_errors,
    iter_markdown_objects,
    parse_args,
    parse_frontmatter,
    print_findings,
    relpath,
)


CONFIRMATION_FIELDS = ("human_confirmed", "confirmed_by", "reviewed_by")


def has_human_confirmation(frontmatter: dict[str, Any]) -> bool:
    if frontmatter.get("human_confirmed") is True:
        return True
    for field in ("confirmed_by", "reviewed_by"):
        value = frontmatter.get(field)
        if isinstance(value, str) and value.strip():
            return True
    return False


def confirmation_hint() -> str:
    return "需要人工确认元数据，例如 `human_confirmed: true` 或 `confirmed_by`"


def check_permissions(path: Path, root: Path, frontmatter: dict[str, Any]) -> list[Finding]:
    findings: list[Finding] = []
    rel = relpath(path, root)
    obj_type = str(frontmatter.get("type") or "")
    status = frontmatter.get("status")
    confidence = frontmatter.get("confidence")

    if obj_type == "summary":
        if frontmatter.get("generated_by") == "ai" and frontmatter.get("reviewed") is True:
            if not has_human_confirmation(frontmatter):
                findings.append(Finding("ERROR", rel, f"AI Summary 已 reviewed=true，{confirmation_hint()}"))

    if obj_type == "extract":
        if frontmatter.get("extracted_by") == "ai" and frontmatter.get("review_status") == "reviewed":
            if not has_human_confirmation(frontmatter):
                findings.append(Finding("ERROR", rel, f"AI Extract 已 review_status=reviewed，{confirmation_hint()}"))

    if obj_type == "source":
        if status in {"reviewed", "archived"} and not has_human_confirmation(frontmatter):
            findings.append(Finding("WARN", rel, f"Source 处于 {status!r}，{confirmation_hint()}"))

    if obj_type == "research":
        if status in {"reviewed", "complete"} and not has_human_confirmation(frontmatter):
            findings.append(Finding("ERROR", rel, f"Research 处于 {status!r}，{confirmation_hint()}"))
        if confidence in {"verified", "mature"} and not has_human_confirmation(frontmatter):
            findings.append(Finding("ERROR", rel, f"Research confidence={confidence!r}，{confirmation_hint()}"))
        if status == "draft" and confidence != "draft":
            findings.append(Finding("ERROR", rel, "Research status=draft 时 confidence 必须保持 draft"))

    if obj_type == "concept":
        if status in {"verified", "mature"} and not has_human_confirmation(frontmatter):
            findings.append(Finding("ERROR", rel, f"Concept 处于 {status!r}，{confirmation_hint()}"))
        if confidence in {"verified", "mature"} and not has_human_confirmation(frontmatter):
            findings.append(Finding("ERROR", rel, f"Concept confidence={confidence!r}，{confirmation_hint()}"))
        if status == "draft" and confidence != "draft":
            findings.append(Finding("ERROR", rel, "Concept status=draft 时 confidence 必须保持 draft"))

    if obj_type == "method":
        if status in {"usable", "trusted"} and not has_human_confirmation(frontmatter):
            findings.append(Finding("ERROR", rel, f"Method 处于 {status!r}，{confirmation_hint()}"))

    if obj_type == "project":
        if status in {"completed", "archived"} and not has_human_confirmation(frontmatter):
            findings.append(Finding("ERROR", rel, f"Project 处于 {status!r}，{confirmation_hint()}"))

    if obj_type == "reflection":
        if status in {"developed", "archived"} and not has_human_confirmation(frontmatter):
            findings.append(Finding("WARN", rel, f"Reflection 处于 {status!r}，建议补充人工确认元数据"))

    if obj_type == "personal_operating_profile":
        if status in {"reviewed", "active"} and not has_human_confirmation(frontmatter):
            findings.append(
                Finding("ERROR", rel, f"Personal Operating Profile 处于 {status!r}，{confirmation_hint()}")
            )
        if confidence in {"verified", "mature"} and not has_human_confirmation(frontmatter):
            findings.append(
                Finding("ERROR", rel, f"Personal Operating Profile confidence={confidence!r}，{confirmation_hint()}")
            )
        if status == "draft" and confidence != "draft":
            findings.append(Finding("ERROR", rel, "Personal Operating Profile status=draft 时 confidence 必须保持 draft"))

    return findings


def main() -> int:
    args = parse_args("校验 kos 对象的人机权限和人工确认规则")
    root = Path(args.root).resolve() if args.root else find_vault_root()
    findings: list[Finding] = []

    for path in iter_markdown_objects(root):
        frontmatter, _ = parse_frontmatter(path)
        if not frontmatter:
            continue
        findings.extend(check_permissions(path, root, frontmatter))

    print_findings(findings, "权限与人工确认检查报告", markdown=args.format == "markdown")
    return 1 if has_errors(findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
