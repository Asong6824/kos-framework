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
    return value or "未命名概念"


def area_dir_name(area: str) -> str:
    value = area.strip()
    if value.startswith("[[") and value.endswith("]]"):
        value = value[2:-2].split("|", 1)[0]
    return slug_filename(value or "未分类")


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
    for base in ["11_原材料", "20_处理区", "21_研究", "22_知识库", "30_项目"]:
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


def build_body(args: argparse.Namespace, today: str) -> str:
    title = args.title.strip()
    definition = args.definition.strip()
    problem = args.problem.strip()
    importance = args.importance.strip()
    understanding = args.understanding.strip()
    examples = split_items(args.example)
    pitfalls = split_items(args.pitfall)
    scenarios = split_items(args.scenario)
    related = split_items(args.related_concept)

    return f"""# {title}

## 定义

{definition or "待人工补充或确认。"}

## 解决什么问题

{problem or "待补充。"}

## 为什么重要

{importance or "待补充。"}

## 我的理解

> 这里必须沉淀为用户自己的表达。AI 生成时保持 draft。

{understanding or "待人工确认。"}

## 示例

{bullets(examples)}

## 常见误区

{bullets(pitfalls)}

## 相关概念

{bullets(related)}

## 来源与参考

{bullets(split_items(args.related_source) + split_items(args.related_research))}

## 应用场景

{bullets(scenarios)}

## 待确认

- [ ] 定义是否是我自己的表达
- [ ] 来源是否充分
- [ ] 是否需要关联更多 Research / Project
- [ ] 是否可以从 draft 升级为 verified

## 版本记录

- {today}：创建 draft Concept。
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="创建 kos Concept draft")
    parser.add_argument("title", help="概念名")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--area", default="[[未分类]]", help="所属领域")
    parser.add_argument("--definition", default="", help="定义")
    parser.add_argument("--problem", default="", help="解决什么问题")
    parser.add_argument("--importance", default="", help="为什么重要")
    parser.add_argument("--understanding", default="", help="我的理解")
    parser.add_argument("--example", action="append", help="示例，可重复")
    parser.add_argument("--pitfall", action="append", help="常见误区，可重复")
    parser.add_argument("--scenario", action="append", help="应用场景，可重复")
    parser.add_argument("--source", default="", help="单一来源路径/标题")
    parser.add_argument("--related-source", action="append", help="相关 Source/Summary 路径/标题，可重复")
    parser.add_argument("--related-research", action="append", help="相关 Research 路径/标题，可重复")
    parser.add_argument("--related-project", action="append", help="相关 Project 路径/标题，可重复")
    parser.add_argument("--related-concept", action="append", help="相关 Concept，可重复")
    parser.add_argument("--alias", action="append", help="别名，可重复")
    parser.add_argument("--tag", action="append", help="标签，可重复；也可用分号分隔")
    parser.add_argument("--dry-run", action="store_true", help="只输出将要写入的内容，不创建文件")
    args = parser.parse_args()

    if not args.title.strip():
        raise SystemExit("概念名不能为空")

    root = Path(args.root).resolve() if args.root else find_vault_root()
    today = dt.date.today().isoformat()
    area = args.area.strip() or "[[未分类]]"

    source_link = ""
    source_type = ""
    source_match = find_object(root, args.source, {"source", "summary", "research"}) if args.source else None
    if source_match:
        source_link = wikilink(source_match[0], root)
        source_type = str(source_match[1].get("type") or "")

    related_sources = split_items(args.related_source)
    related_research = split_items(args.related_research)
    related_projects = split_items(args.related_project)

    for field, values, allowed in [
        ("related_sources", related_sources, {"source", "summary"}),
        ("related_research", related_research, {"research"}),
        ("related_projects", related_projects, {"project"}),
    ]:
        resolved: list[str] = []
        for value in values:
            match = find_object(root, value, allowed)
            resolved.append(wikilink(match[0], root) if match else value)
        if field == "related_sources":
            related_sources = resolved
        elif field == "related_research":
            related_research = resolved
        else:
            related_projects = resolved

    if source_link and source_link not in related_sources and source_link not in related_research:
        if source_type == "research":
            related_research.append(source_link)
        else:
            related_sources.append(source_link)

    frontmatter = {
        "type": "concept",
        "title": args.title.strip(),
        "status": "draft",
        "confidence": "draft",
        "area": area,
        "created": today,
        "updated": today,
        "aliases": split_items(args.alias),
        "source": source_link,
        "related_sources": related_sources,
        "related_research": related_research,
        "related_projects": related_projects,
        "related_concepts": split_items(args.related_concept),
        "tags": split_items(args.tag),
    }
    concept_dir = root / "22_知识库" / area_dir_name(area)
    concept_path = unique_path(concept_dir / f"{slug_filename(args.title)}.md")
    content = f"---\n{dump_frontmatter(frontmatter)}\n---\n{build_body(args, today)}"

    if args.dry_run:
        print("DRY_RUN=true")
        print(f"CONCEPT={concept_path}")
        print(content)
        return 0

    concept_dir.mkdir(parents=True, exist_ok=True)
    concept_path.write_text(content, encoding="utf-8")
    print(f"CONCEPT={concept_path}")
    print("STATUS=draft")
    print("CONFIDENCE=draft")
    print(f"RELATIVE={relpath(concept_path, root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
