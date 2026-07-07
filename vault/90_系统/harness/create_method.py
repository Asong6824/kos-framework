#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import re
from pathlib import Path
from typing import Any

import yaml

from harness_common import find_vault_root, parse_frontmatter, relpath


def slug_filename(title: str) -> str:
    value = re.sub(r"[\\/:*?\"<>|\n\r\t]+", "_", title).strip(" ._")
    value = re.sub(r"\s+", "_", value)
    return value or "未命名方法"


def dump_frontmatter(data: dict[str, Any]) -> str:
    return yaml.safe_dump(data, allow_unicode=True, sort_keys=False).strip()


def split_items(values: list[str] | None) -> list[str]:
    if not values:
        return []
    items: list[str] = []
    for value in values:
        for part in re.split(r"[;\n]", value):
            part = part.strip().lstrip("-").strip()
            if part:
                items.append(part)
    return items


def unique_path(base: Path) -> Path:
    if not base.exists():
        return base
    stem = base.stem
    suffix = base.suffix
    parent = base.parent
    for index in range(2, 100):
        candidate = parent / f"{stem}-{index}{suffix}"
        if not candidate.exists():
            return candidate
    raise SystemExit(f"无法生成不冲突文件名：{base}")


def wikilink(path: Path, root: Path) -> str:
    return f"[[{relpath(path, root).removesuffix('.md')}]]"


def find_object(root: Path, query: str | None, allowed_types: set[str]) -> tuple[Path, dict[str, Any]] | None:
    if not query:
        return None
    q = query.strip()
    candidate = (root / q).resolve()
    if candidate.exists() and candidate.is_file():
        fm, _ = parse_frontmatter(candidate)
        if fm and str(fm.get("type") or "") in allowed_types:
            return candidate, fm
        return None

    matches: list[tuple[Path, dict[str, Any]]] = []
    for base in ["21_研究", "22_知识库", "24_认知记录", "30_项目", "40_方法库"]:
        root_base = root / base
        if not root_base.exists():
            continue
        for path in sorted(root_base.rglob("*.md")):
            fm, _ = parse_frontmatter(path)
            if not fm or str(fm.get("type") or "") not in allowed_types:
                continue
            title = str(fm.get("title") or "")
            rel = relpath(path, root)
            if q in rel or q in path.stem or q in title:
                matches.append((path, fm))
    if len(matches) == 1:
        return matches[0]
    return None


def bullets(items: list[str], fallback: str = "待补充。") -> str:
    if not items:
        return f"- {fallback}"
    return "\n".join(f"- {item}" for item in items)


def numbered(items: list[str]) -> str:
    if not items:
        return "1. 待补充。"
    return "\n".join(f"{idx}. {item}" for idx, item in enumerate(items, start=1))


def resolve_links(root: Path, values: list[str], allowed: set[str]) -> list[str]:
    out: list[str] = []
    for value in values:
        match = find_object(root, value, allowed)
        out.append(wikilink(match[0], root) if match else value)
    return out


def build_body(args: argparse.Namespace, today: str, related_cases: list[str]) -> str:
    return f"""# {args.title.strip()}

## 方法解决什么问题

{args.problem.strip() or "待补充。"}

## 适用场景

{bullets(split_items(args.scenario))}

## 不适用场景

{bullets(split_items(args.not_scenario))}

## 前置条件

{bullets(split_items(args.prerequisite))}

## 执行步骤

{numbered(split_items(args.step))}

## 判断标准

{bullets(split_items(args.criteria))}

## 常见坑

{bullets(split_items(args.pitfall))}

## 验证方式

{bullets(split_items(args.validation))}

## 使用记录

- {today}：创建 candidate，尚未验证。

## 相关案例

{bullets(related_cases)}

## 相关概念

{bullets(split_items(args.related_concept))}

## 可转化为 Skill 的部分

{args.skill_candidate.strip() or "待验证后再转化为 Hermes Skill。"}

## 版本记录

- {today}：创建 candidate Method。
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="创建 kos Method candidate")
    parser.add_argument("title", help="方法名")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--category", default="未分类", help="方法分类目录")
    parser.add_argument("--problem", default="", help="方法解决什么问题")
    parser.add_argument("--scenario", action="append", help="适用场景，可重复")
    parser.add_argument("--not-scenario", action="append", help="不适用场景，可重复")
    parser.add_argument("--prerequisite", action="append", help="前置条件，可重复")
    parser.add_argument("--step", action="append", help="执行步骤，可重复")
    parser.add_argument("--criteria", action="append", help="判断标准，可重复")
    parser.add_argument("--pitfall", action="append", help="常见坑，可重复")
    parser.add_argument("--validation", action="append", help="验证方式，可重复")
    parser.add_argument("--source-project", action="append", help="来源 Project，可重复")
    parser.add_argument("--source-reflection", action="append", help="来源 Reflection，可重复")
    parser.add_argument("--related-concept", action="append", help="相关 Concept，可重复")
    parser.add_argument("--tag", action="append", help="标签，可重复；也可用分号分隔")
    parser.add_argument("--skill-candidate", default="", help="可转化为 Skill 的部分")
    parser.add_argument("--dry-run", action="store_true", help="只输出将要写入的内容，不创建文件")
    args = parser.parse_args()

    if not args.title.strip():
        raise SystemExit("方法名不能为空")

    root = Path(args.root).resolve() if args.root else find_vault_root()
    today = dt.date.today().isoformat()

    source_projects = resolve_links(root, split_items(args.source_project), {"project"})
    source_reflections = resolve_links(root, split_items(args.source_reflection), {"reflection"})
    related_concepts = resolve_links(root, split_items(args.related_concept), {"concept"})

    frontmatter = {
        "type": "method",
        "title": args.title.strip(),
        "status": "candidate",
        "created": today,
        "updated": today,
        "applicable_scenarios": split_items(args.scenario),
        "validated_times": 0,
        "related_projects": source_projects,
        "related_concepts": related_concepts,
        "tags": split_items(args.tag),
    }
    target_dir = root / "40_方法库" / slug_filename(args.category)
    target_path = unique_path(target_dir / f"{slug_filename(args.title)}.md")
    related_cases = source_projects + source_reflections
    content = f"---\n{dump_frontmatter(frontmatter)}\n---\n{build_body(args, today, related_cases)}"

    if args.dry_run:
        print("DRY_RUN=true")
        print(f"METHOD={target_path}")
        print(content)
        return 0

    target_dir.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")
    print(f"METHOD={target_path}")
    print("STATUS=candidate")
    print("VALIDATED_TIMES=0")
    print(f"RELATIVE={relpath(target_path, root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
