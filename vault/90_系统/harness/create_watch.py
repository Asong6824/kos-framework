#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import re
from pathlib import Path
from typing import Any

import yaml

from harness_common import find_vault_root, parse_frontmatter, relpath


STATUS_VALUES = {"active", "paused", "archived"}


def slug_filename(title: str) -> str:
    value = re.sub(r"[\\/:*?\"<>|\n\r\t]+", "_", title).strip(" ._")
    value = re.sub(r"\s+", "_", value)
    return value or "未命名监控"


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
            title = str(fm.get("title") or fm.get("company") or "")
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


def bullets(items: list[str], fallback: str = "待补充。") -> str:
    if not items:
        return f"- {fallback}"
    return "\n".join(f"- {item}" for item in items)


def build_topic_body(args: argparse.Namespace, related_projects: list[str], related_research: list[str]) -> str:
    title = args.name.strip()
    return f"""# 主题监控：{title}

## 为什么关注这个主题

{args.why.strip() or "待补充。"}

## 核心问题

{bullets(split_items(args.question))}

## 关键词

{bullets(split_items(args.keyword))}

## 主要信息源

{bullets(split_items(args.source))}

## 重要信号记录

- 待从 Signal 回流。

## 当前判断

<!-- 人手动添加 -->

{args.current_view.strip()}

<!-- /人手动添加 -->

## 判断变化

- 待记录。

## 相关研究报告

{bullets(related_research)}

## 相关项目

{bullets(related_projects)}

## 下一步关注

{bullets(split_items(args.next))}
"""


def build_company_body(args: argparse.Namespace, related_topics: list[str], related_projects: list[str], related_research: list[str]) -> str:
    company = args.name.strip()
    return f"""# 公司监控：{company}

## 为什么关注这家公司

{args.why.strip() or "待补充。"}

## 基本信息

- 公司：{company}
- Ticker：{args.ticker.strip() or "待补充"}
- 市场：{args.market.strip() or "待补充"}

## 核心业务

{bullets(split_items(args.business))}

## 关键跟踪指标

{bullets(split_items(args.metric))}

## 重要事件

- 待从 Signal 回流。

## 财报与公告

- 待补充。

## 市场观点

- 待补充。

## 当前判断

<!-- 人手动添加 -->

{args.current_view.strip()}

<!-- /人手动添加 -->

## 判断变化

- 待记录。

## 相关主题

{bullets(related_topics)}

## 相关研究报告

{bullets(related_research)}

## 相关项目

{bullets(related_projects)}

## 需要进一步研究的问题

{bullets(split_items(args.question))}
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="创建 kos Topic Watch 或 Company Watch")
    parser.add_argument("name", help="主题名或公司名")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--kind", choices=["topic", "company"], default="topic", help="Watch 类型")
    parser.add_argument("--status", default="active", choices=sorted(STATUS_VALUES), help="状态")
    parser.add_argument("--why", default="", help="为什么关注")
    parser.add_argument("--question", action="append", help="核心问题/研究问题，可重复")
    parser.add_argument("--keyword", action="append", help="关键词，仅 topic watch 使用，可重复")
    parser.add_argument("--source", action="append", help="主要信息源，仅 topic watch 使用，可重复")
    parser.add_argument("--next", action="append", help="下一步关注，仅 topic watch 使用，可重复")
    parser.add_argument("--current-view", default="", help="当前判断，保留在人工确认区")
    parser.add_argument("--ticker", default="", help="股票代码，仅 company watch 使用")
    parser.add_argument("--market", default="", help="市场，仅 company watch 使用")
    parser.add_argument("--business", action="append", help="核心业务，仅 company watch 使用，可重复")
    parser.add_argument("--metric", action="append", help="关键跟踪指标，仅 company watch 使用，可重复")
    parser.add_argument("--related-topic", action="append", help="相关 Topic Watch，可重复")
    parser.add_argument("--related-project", action="append", help="相关 Project，可重复")
    parser.add_argument("--related-research", action="append", help="相关 Research，可重复")
    parser.add_argument("--related-concept", action="append", help="相关 Concept，可重复")
    parser.add_argument("--tag", action="append", help="标签，可重复；也可用分号分隔")
    parser.add_argument("--dry-run", action="store_true", help="只输出将要写入的内容，不创建文件")
    args = parser.parse_args()

    if not args.name.strip():
        raise SystemExit("Watch 名称不能为空")

    root = Path(args.root).resolve() if args.root else find_vault_root()
    today = dt.date.today().isoformat()
    related_projects = resolve_links(root, split_items(args.related_project), {"project"})
    related_research = resolve_links(root, split_items(args.related_research), {"research"})
    related_concepts = resolve_links(root, split_items(args.related_concept), {"concept"})
    related_topics = resolve_links(root, split_items(args.related_topic), {"topic_watch"})

    if args.kind == "topic":
        frontmatter = {
            "type": "topic_watch",
            "title": args.name.strip(),
            "status": args.status,
            "created": today,
            "updated": today,
            "keywords": split_items(args.keyword),
            "tracked_sources": split_items(args.source),
            "related_projects": related_projects,
            "related_research": related_research,
            "related_concepts": related_concepts,
            "last_reviewed_at": "",
            "tags": split_items(args.tag),
        }
        target_dir = root / "50_信息雷达" / "主题监控"
        target_path = unique_path(target_dir / f"{slug_filename(args.name)}.md")
        body = build_topic_body(args, related_projects, related_research)
    else:
        frontmatter = {
            "type": "company_watch",
            "company": args.name.strip(),
            "title": f"公司监控：{args.name.strip()}",
            "ticker": args.ticker.strip(),
            "market": args.market.strip(),
            "status": args.status,
            "created": today,
            "updated": today,
            "related_topics": related_topics,
            "related_projects": related_projects,
            "related_research": related_research,
            "last_reviewed_at": "",
            "tags": split_items(args.tag),
        }
        target_dir = root / "50_信息雷达" / "公司监控"
        target_path = unique_path(target_dir / f"{slug_filename(args.name)}.md")
        body = build_company_body(args, related_topics, related_projects, related_research)

    content = f"---\n{dump_frontmatter(frontmatter)}\n---\n{body}"
    if args.dry_run:
        print("DRY_RUN=true")
        print(f"WATCH={target_path}")
        print(content)
        return 0

    target_dir.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")
    print(f"WATCH={target_path}")
    print(f"TYPE={frontmatter['type']}")
    print(f"STATUS={args.status}")
    print(f"RELATIVE={relpath(target_path, root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
