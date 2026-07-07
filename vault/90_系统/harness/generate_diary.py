#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from typing import Any

import yaml

from harness_common import find_vault_root, parse_args, parse_frontmatter, relpath


MANUAL_BLOCK_RE = re.compile(
    r"<!-- 人手动添加 -->.*?<!-- /人手动添加 -->",
    re.S,
)


def dump_frontmatter(data: dict[str, Any]) -> str:
    return yaml.safe_dump(data, allow_unicode=True, sort_keys=False).strip()


def section_text(markdown: str, heading: str) -> str:
    pattern = re.compile(r"^(#{2,6})\s+" + re.escape(heading) + r"\s*$", re.M)
    match = pattern.search(markdown)
    if not match:
        return ""
    level = len(match.group(1))
    start = match.end()
    next_heading = re.compile(r"^#{2," + str(level) + r"}\s+.+$", re.M)
    next_match = next_heading.search(markdown, start)
    end = next_match.start() if next_match else len(markdown)
    return markdown[start:end].strip()


def preserve_manual_blocks(old: str | None, new: str) -> str:
    if not old:
        return new
    old_blocks = MANUAL_BLOCK_RE.findall(old)
    if not old_blocks:
        return new
    index = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal index
        if index < len(old_blocks):
            value = old_blocks[index]
            index += 1
            return value
        return match.group(0)

    return MANUAL_BLOCK_RE.sub(repl, new)


def checkbox_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip().startswith("- [")]


def list_or_empty(items: list[str], empty: str = "- ") -> str:
    return "\n".join(items) if items else empty


def dashboard_summary(root: Path) -> dict[str, Any]:
    dashboard = root / "00_工作台" / "今日工作台.md"
    if not dashboard.exists():
        return {}
    text = dashboard.read_text(encoding="utf-8")
    return {
        "focus_candidates": section_text(text, "今日主线候选"),
        "projects": section_text(text, "Active 项目"),
        "pending": section_text(text, "待审核"),
        "tasks": checkbox_lines(section_text(text, "今日任务")),
        "thinking": section_text(text, "今日思考"),
        "review": section_text(text, "日终回顾"),
    }


def active_project_links(root: Path) -> list[str]:
    links: list[str] = []
    base = root / "30_项目"
    if not base.exists():
        return links
    for path in sorted(base.rglob("*.md")):
        fm, _ = parse_frontmatter(path)
        if fm and fm.get("type") == "project" and fm.get("status") == "active":
            title = str(fm.get("title") or path.stem)
            links.append(f"[[{relpath(path, root).removesuffix('.md')}|{title}]]")
    return links


def build_diary(root: Path, date: dt.date) -> str:
    dash = dashboard_summary(root)
    projects = active_project_links(root)
    frontmatter = {
        "type": "diary",
        "created": date.isoformat(),
        "date": date.isoformat(),
        "day_of_week": date.strftime("%A"),
        "week_number": int(date.strftime("%V")),
        "mood": "",
        "energy": 3,
        "tags": ["daily"],
    }
    tasks = dash.get("tasks") or []
    return f"""---
{dump_frontmatter(frontmatter)}
---
# {date.isoformat()}

## 今日主线

<!-- 人手动添加 -->

- 

<!-- /人手动添加 -->

## 今天推进了什么

<!-- 人手动添加 -->

- 

<!-- /人手动添加 -->

## 今天学习了什么

<!-- 人手动添加 -->

- 

<!-- /人手动添加 -->

## 今天产生的重要想法

<!-- 人手动添加 -->

- 

<!-- /人手动添加 -->

## 判断变化

<!-- 人手动添加 -->

- 

<!-- /人手动添加 -->

## 遇到的问题

<!-- 人手动添加 -->

- 

<!-- /人手动添加 -->

## 项目相关记录

{list_or_empty([f'- {item}' for item in projects])}

## 今日任务快照

{list_or_empty(tasks, '- [ ] 暂无')}

## 待审核内容

{dash.get('pending') or '- 暂无'}

## 明天继续

<!-- 人手动添加 -->

- 

<!-- /人手动添加 -->

## 可提炼为认知记录的内容

<!-- 人手动添加 -->

- 

<!-- /人手动添加 -->

## 来源

- [[00_工作台/今日工作台]]
"""


def main() -> int:
    args = parse_args("生成或更新 kos 日记")
    root = Path(args.root).resolve() if args.root else find_vault_root()
    today = dt.date.today()
    target = root / "23_日记" / f"{today:%Y}" / f"{today:%m}" / f"{today.isoformat()}.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    old = target.read_text(encoding="utf-8") if target.exists() else None
    content = preserve_manual_blocks(old, build_diary(root, today))
    target.write_text(content, encoding="utf-8")
    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
