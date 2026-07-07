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
    return value or "未命名反思"


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
    for base in ["11_原材料", "20_处理区", "21_研究", "22_知识库", "23_日记", "30_项目", "50_信息雷达"]:
        root_base = root / base
        if not root_base.exists():
            continue
        for path in sorted(root_base.rglob("*.md")):
            fm, _ = parse_frontmatter(path)
            if not fm or str(fm.get("type") or "") not in allowed_types:
                continue
            title = str(fm.get("title") or fm.get("date") or "")
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


def build_body(args: argparse.Namespace, today: str, related_links: list[str]) -> str:
    return f"""# {args.title.strip()}

## 触发背景

{args.trigger.strip() or "待补充。"}

## 我原来怎么想

{args.previous_view.strip() or "待人工补充。"}

## 现在的变化

{args.changed_view.strip() or "待人工补充。"}

## 为什么发生变化

{args.reason.strip() or "待补充。"}

## 这个变化可能影响什么

{args.impact.strip() or "待补充。"}

## 关联的项目或知识

{bullets(related_links)}

## 后续要验证什么

{bullets(split_items(args.to_verify))}

## 未来回看

- [ ] 这条反思是否仍然成立
- [ ] 是否需要沉淀为 Method
- [ ] 是否需要关联 Concept / Project / Research

## 版本记录

- {today}：创建 raw Reflection。
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="创建 kos Reflection raw")
    parser.add_argument("title", help="反思主题")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--category", default="未分类", help="认知记录分类目录")
    parser.add_argument("--source-diary", default="", help="来源日记路径/日期/标题")
    parser.add_argument("--trigger", default="", help="触发背景")
    parser.add_argument("--previous-view", default="", help="我原来怎么想")
    parser.add_argument("--changed-view", default="", help="现在的变化")
    parser.add_argument("--reason", default="", help="变化原因")
    parser.add_argument("--impact", default="", help="可能影响")
    parser.add_argument("--to-verify", action="append", help="后续要验证什么，可重复")
    parser.add_argument("--related-project", action="append", help="相关 Project，可重复")
    parser.add_argument("--related-source", action="append", help="相关 Source/Summary，可重复")
    parser.add_argument("--related-research", action="append", help="相关 Research，可重复")
    parser.add_argument("--related-concept", action="append", help="相关 Concept，可重复")
    parser.add_argument("--related-method", action="append", help="相关 Method，可重复")
    parser.add_argument("--tag", action="append", help="标签，可重复；也可用分号分隔")
    parser.add_argument("--dry-run", action="store_true", help="只输出将要写入的内容，不创建文件")
    args = parser.parse_args()

    if not args.title.strip():
        raise SystemExit("反思主题不能为空")

    root = Path(args.root).resolve() if args.root else find_vault_root()
    today = dt.date.today().isoformat()

    source_diary = args.source_diary.strip()
    diary_match = find_object(root, source_diary, {"diary"}) if source_diary else None
    if diary_match:
        source_diary = wikilink(diary_match[0], root)

    related_specs = [
        (split_items(args.related_project), {"project"}),
        (split_items(args.related_source), {"source", "summary"}),
        (split_items(args.related_research), {"research"}),
        (split_items(args.related_concept), {"concept"}),
        (split_items(args.related_method), {"method"}),
    ]
    related_links: list[str] = []
    for values, allowed in related_specs:
        for value in values:
            match = find_object(root, value, allowed)
            related_links.append(wikilink(match[0], root) if match else value)

    frontmatter = {
        "type": "reflection",
        "title": args.title.strip(),
        "status": "raw",
        "created": today,
        "source_diary": source_diary,
        "trigger": args.trigger.strip(),
        "tags": split_items(args.tag),
    }
    target_dir = root / "24_认知记录" / slug_filename(args.category)
    target_path = unique_path(target_dir / f"{slug_filename(args.title)}_反思.md")
    content = f"---\n{dump_frontmatter(frontmatter)}\n---\n{build_body(args, today, related_links)}"

    if args.dry_run:
        print("DRY_RUN=true")
        print(f"REFLECTION={target_path}")
        print(content)
        return 0

    target_dir.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")
    print(f"REFLECTION={target_path}")
    print("STATUS=raw")
    print(f"RELATIVE={relpath(target_path, root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
