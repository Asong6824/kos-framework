#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import re
from pathlib import Path
from typing import Any

import yaml

from harness_common import find_vault_root, parse_frontmatter, relpath


SIGNAL_DIRS = {
    "news": "主题监控",
    "earnings": "公司监控",
    "policy": "政策监控",
    "product": "技术趋势",
    "market": "宏观监控",
    "research": "主题监控",
    "social": "主题监控",
    "macro": "宏观监控",
    "other": "主题监控",
}


def slug_filename(title: str) -> str:
    value = re.sub(r"[\\/:*?\"<>|\n\r\t]+", "_", title).strip(" ._")
    value = re.sub(r"\s+", "_", value)
    return value or "未命名信号"


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
    for base in ["21_研究", "22_知识库", "30_项目", "50_信息雷达"]:
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


def resolve_links(root: Path, values: list[str], allowed: set[str]) -> list[str]:
    out: list[str] = []
    for value in values:
        match = find_object(root, value, allowed)
        out.append(wikilink(match[0], root) if match else value)
    return out


def resolve_watch_refs(root: Path, values: list[str], allowed: set[str]) -> list[str]:
    out: list[str] = []
    for value in values:
        match = find_object(root, value, allowed)
        out.append(wikilink(match[0], root) if match else value)
    return out


def bullets(items: list[str], fallback: str = "待补充。") -> str:
    if not items:
        return f"- {fallback}"
    return "\n".join(f"- {item}" for item in items)


def build_body(args: argparse.Namespace, related_links: list[str]) -> str:
    return f"""# {args.title.strip()}

## 事实层：发生了什么

{args.fact.strip() or "待补充。"}

## 来源

- 来源名称：{args.source_name.strip() or "待补充"}
- 来源链接：{args.source_url.strip() or "待补充"}

## 相关主题 / 公司

{bullets(split_items(args.topic) + split_items(args.company))}

## 解释层：可能意味着什么

{args.interpretation.strip() or "待补充。"}

## 可能影响的已有判断

{args.impact.strip() or "待补充。"}

## 需要进一步研究的问题

{bullets(split_items(args.question))}

## 是否进入项目或研究

{bullets(related_links)}

## 我的最终判断

<!-- 人手动添加 -->


<!-- /人手动添加 -->
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="创建 kos Signal")
    parser.add_argument("title", help="信号标题")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument(
        "--signal-type",
        default="news",
        choices=["news", "earnings", "policy", "product", "market", "research", "social", "macro", "other"],
        help="信号类型",
    )
    parser.add_argument("--event-date", default=None, help="事件日期，默认今天")
    parser.add_argument("--source-url", default="", help="来源链接")
    parser.add_argument("--source-name", default="", help="来源名称")
    parser.add_argument("--fact", default="", help="事实层：发生了什么")
    parser.add_argument("--interpretation", default="", help="解释层：可能意味着什么")
    parser.add_argument("--impact", default="", help="可能影响的已有判断")
    parser.add_argument("--importance", default="medium", choices=["low", "medium", "high", "critical"])
    parser.add_argument("--confidence", default="low", choices=["low", "medium", "high"])
    parser.add_argument("--requires-research", action="store_true", help="是否需要进一步研究")
    parser.add_argument("--topic", action="append", help="相关主题，可重复")
    parser.add_argument("--company", action="append", help="相关公司，可重复")
    parser.add_argument("--question", action="append", help="需要进一步研究的问题，可重复")
    parser.add_argument("--related-project", action="append", help="相关 Project，可重复")
    parser.add_argument("--related-research", action="append", help="相关 Research，可重复")
    parser.add_argument("--related-concept", action="append", help="相关 Concept，可重复")
    parser.add_argument("--tag", action="append", help="标签，可重复；也可用分号分隔")
    parser.add_argument("--dry-run", action="store_true", help="只输出将要写入的内容，不创建文件")
    args = parser.parse_args()

    if not args.title.strip():
        raise SystemExit("信号标题不能为空")

    root = Path(args.root).resolve() if args.root else find_vault_root()
    today = dt.date.today().isoformat()
    event_date = args.event_date or today
    try:
        dt.date.fromisoformat(event_date)
    except ValueError as exc:
        raise SystemExit(f"事件日期必须是 YYYY-MM-DD：{event_date}") from exc

    related_topics = resolve_watch_refs(root, split_items(args.topic), {"topic_watch"})
    related_companies = resolve_watch_refs(root, split_items(args.company), {"company_watch"})
    related_projects = resolve_links(root, split_items(args.related_project), {"project"})
    related_research = resolve_links(root, split_items(args.related_research), {"research"})
    related_concepts = resolve_links(root, split_items(args.related_concept), {"concept"})
    related_links = related_projects + related_research + related_concepts

    frontmatter = {
        "type": "signal",
        "title": args.title.strip(),
        "signal_type": args.signal_type,
        "date": event_date,
        "event_date": event_date,
        "created": today,
        "source_url": args.source_url.strip(),
        "source_name": args.source_name.strip(),
        "sources": [value for value in [args.source_url.strip() or args.source_name.strip()] if value],
        "importance": args.importance,
        "confidence": args.confidence,
        "requires_research": bool(args.requires_research),
        "status": "new",
        "related_topics": related_topics,
        "related_companies": related_companies,
        "related_projects": related_projects,
        "related_research": related_research,
        "related_concepts": related_concepts,
        "tags": split_items(args.tag),
    }

    target_dir = root / "50_信息雷达" / SIGNAL_DIRS.get(args.signal_type, "主题监控")
    target_path = unique_path(target_dir / f"{event_date}_{slug_filename(args.title)}.md")
    content = f"---\n{dump_frontmatter(frontmatter)}\n---\n{build_body(args, related_links)}"

    if args.dry_run:
        print("DRY_RUN=true")
        print(f"SIGNAL={target_path}")
        print(content)
        return 0

    target_dir.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")
    print(f"SIGNAL={target_path}")
    print("STATUS=new")
    print(f"IMPORTANCE={args.importance}")
    print(f"REQUIRES_RESEARCH={bool(args.requires_research)}")
    print(f"RELATIVE={relpath(target_path, root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
