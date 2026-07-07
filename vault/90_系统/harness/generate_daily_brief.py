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
HEADING_RE = re.compile(r"^(#{2,6})\s+(.+?)\s*$", re.M)


def dump_frontmatter(data: dict[str, Any]) -> str:
    return yaml.safe_dump(data, allow_unicode=True, sort_keys=False).strip()


def wikilink(path: Path, root: Path, title: str | None = None) -> str:
    label = title or path.stem
    return f"[[{relpath(path, root).removesuffix('.md')}|{label}]]"


def section_text(markdown: str, heading: str) -> str:
    matches = list(HEADING_RE.finditer(markdown))
    for idx, match in enumerate(matches):
        if match.group(2).strip() != heading:
            continue
        start = match.end()
        level = len(match.group(1))
        end = len(markdown)
        for next_match in matches[idx + 1 :]:
            if len(next_match.group(1)) <= level:
                end = next_match.start()
                break
        return markdown[start:end].strip()
    return ""


def first_nonempty_line(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped and stripped != "- 待补充。":
            return stripped.lstrip("-").strip()
    return ""


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


def signal_records(root: Path, date: dt.date) -> list[tuple[Path, dict[str, Any], str]]:
    records: list[tuple[Path, dict[str, Any], str]] = []
    base = root / "50_信息雷达"
    if not base.exists():
        return records
    for path in sorted(base.rglob("*.md")):
        fm, body = parse_frontmatter(path)
        if not fm or str(fm.get("type") or "") != "signal":
            continue
        if str(fm.get("signal_type") or "") == "daily_brief":
            continue
        signal_date = str(fm.get("date") or fm.get("event_date") or fm.get("created") or "")
        importance = str(fm.get("importance") or "")
        if signal_date == date.isoformat() or importance in {"high", "critical"} or fm.get("requires_research") is True:
            records.append((path, fm, body))
    return records


def items_or_empty(items: list[str]) -> str:
    if not items:
        return "- 暂无"
    return "\n".join(f"- {item}" for item in items)


def build_brief(root: Path, date: dt.date, records: list[tuple[Path, dict[str, Any], str]]) -> str:
    important: list[str] = []
    topic_updates: list[str] = []
    company_updates: list[str] = []
    macro_policy: list[str] = []
    tech_updates: list[str] = []
    impacts: list[str] = []
    noise: list[str] = []
    questions: list[str] = []
    links: list[str] = []
    sources: list[str] = []

    for path, fm, body in records:
        title = str(fm.get("title") or path.stem)
        item = wikilink(path, root, title)
        importance = str(fm.get("importance") or "medium")
        signal_type = str(fm.get("signal_type") or "")
        status = str(fm.get("status") or "")
        fact = first_nonempty_line(section_text(body, "事实层：发生了什么"))
        impact = first_nonempty_line(section_text(body, "可能影响的已有判断"))
        question_text = section_text(body, "需要进一步研究的问题")
        line = f"{item} — {importance}"
        if fact:
            line += f"；{fact}"
        sources.extend(str(value) for value in (fm.get("sources") or []) if value)

        if status == "noise" or importance == "low":
            noise.append(line)
        if importance in {"high", "critical"}:
            important.append(line)
        if signal_type in {"news", "research", "social", "other"}:
            topic_updates.append(line)
        if signal_type in {"earnings"} or fm.get("related_companies"):
            company_updates.append(line)
        if signal_type in {"policy", "market", "macro"}:
            macro_policy.append(line)
        if signal_type in {"product"}:
            tech_updates.append(line)
        if impact:
            impacts.append(f"{item} — {impact}")
        if fm.get("requires_research") is True:
            questions.append(item)
        for line_text in question_text.splitlines():
            stripped = line_text.strip().lstrip("-").strip()
            if stripped and stripped != "待补充。":
                questions.append(f"{item} — {stripped}")
        for field in ["related_topics", "related_companies", "related_projects", "related_research", "related_concepts"]:
            links.extend(str(value) for value in (fm.get(field) or []) if value)

    frontmatter = {
        "type": "signal",
        "signal_type": "daily_brief",
        "date": date.isoformat(),
        "created": date.isoformat(),
        "sources": sorted(set(sources)),
        "importance": "high" if important else "medium",
        "requires_research": bool(questions),
        "tags": ["radar", "daily_brief"],
    }

    return f"""---
{dump_frontmatter(frontmatter)}
---
# 每日信息雷达 {date.isoformat()}

## 今日重要变化

{items_or_empty(important)}

## 关注主题更新

{items_or_empty(topic_updates)}

## 关注公司更新

{items_or_empty(company_updates)}

## 宏观与政策变化

{items_or_empty(macro_policy)}

## 技术趋势变化

{items_or_empty(tech_updates)}

## 可能影响我判断的信息

{items_or_empty(impacts)}

## 噪音或低价值信息

{items_or_empty(noise)}

## 需要进一步研究的问题

{items_or_empty(sorted(set(questions)))}

## 建议关联到的项目 / 研究 / 概念

{items_or_empty(sorted(set(links)))}

## 我的确认与批注

<!-- 人手动添加 -->


<!-- /人手动添加 -->
"""


def main() -> int:
    args = parse_args("生成 kos 每日信息雷达简报")
    root = Path(args.root).resolve() if args.root else find_vault_root()
    date = dt.date.today()
    target = root / "50_信息雷达" / "每日简报" / f"{date.isoformat()}.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    old = target.read_text(encoding="utf-8") if target.exists() else None
    content = preserve_manual_blocks(old, build_brief(root, date, signal_records(root, date)))
    target.write_text(content, encoding="utf-8")
    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
