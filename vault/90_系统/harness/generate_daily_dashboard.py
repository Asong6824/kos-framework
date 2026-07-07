#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from typing import Any

from harness_common import find_vault_root, parse_args, parse_frontmatter, relpath


MANUAL_BLOCK_RE = re.compile(
    r"<!-- 人手动添加 -->.*?<!-- /人手动添加 -->",
    re.S,
)
HEADING_RE = re.compile(r"^(#{2,6})\s+(.+?)\s*$", re.M)
CHECKBOX_RE = re.compile(r"^\s*-\s+\[\s\]\s+(.+?)\s*$", re.M)


def object_files(root: Path) -> list[tuple[Path, dict[str, Any]]]:
    targets = [
        "10_收件箱",
        "11_原材料",
        "20_处理区",
        "21_研究",
        "22_知识库",
        "24_认知记录",
        "30_项目",
        "31_任务",
        "40_方法库",
        "50_信息雷达",
    ]
    out: list[tuple[Path, dict[str, Any]]] = []
    for prefix in targets:
        base = root / prefix
        if not base.exists():
            continue
        for path in sorted(base.rglob("*.md")):
            fm, _ = parse_frontmatter(path)
            if fm:
                out.append((path, fm))
    return out


def link(path: Path, root: Path, title: str | None = None) -> str:
    rel = relpath(path, root).removesuffix(".md")
    label = title or path.stem
    return f"[[{rel}|{label}]]"


def items_or_empty(items: list[str]) -> str:
    if not items:
        return "- 暂无"
    return "\n".join(f"- {item}" for item in items)


def task_items_or_empty(items: list[str]) -> str:
    if not items:
        return "- [ ] 暂无"
    return "\n".join(f"- [ ] {item}" for item in items)


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
        if stripped and not stripped.startswith("- ["):
            return stripped.lstrip("-").strip()
    return ""


def checkbox_tasks(text: str) -> list[str]:
    return [match.group(1).strip() for match in CHECKBOX_RE.finditer(text)]


def days_since(value: Any, today: dt.date) -> int | None:
    if isinstance(value, dt.datetime):
        date_value = value.date()
    elif isinstance(value, dt.date):
        date_value = value
    elif isinstance(value, str):
        try:
            date_value = dt.date.fromisoformat(value[:10])
        except ValueError:
            return None
    else:
        return None
    return (today - date_value).days


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


def build_dashboard(root: Path, date: dt.date, now: dt.datetime) -> str:
    records = object_files(root)

    active_projects: list[str] = []
    idea_projects: list[str] = []
    blocked_projects: list[str] = []
    paused_projects: list[str] = []
    stale_projects: list[str] = []
    inbox_items: list[str] = []
    need_extract: list[str] = []
    need_summary: list[str] = []
    need_review: list[str] = []
    tasks: list[str] = []
    radar_changes: list[str] = []
    radar_questions: list[str] = []
    focus_candidates: list[str] = []

    for path, fm in records:
        obj_type = str(fm.get("type") or "")
        status = str(fm.get("status") or "")
        title = str(fm.get("title") or path.stem)
        item = link(path, root, title)
        if obj_type == "project":
            body = path.read_text(encoding="utf-8")
            goal = str(fm.get("goal") or "").strip()
            stage = str(fm.get("current_stage") or "").strip()
            priority = str(fm.get("priority") or "").strip()
            updated = fm.get("updated")
            current_problem = first_nonempty_line(section_text(body, "当前问题"))
            project_tasks = checkbox_tasks(section_text(body, "当前任务"))
            due = str(fm.get("due") or "").strip()
            meta_parts = [part for part in [priority, stage] if part]
            if due:
                meta_parts.append(f"due: {due}")
            meta = "；".join(meta_parts) if meta_parts else status
            project_line = f"{item} — {meta}"
            if goal:
                project_line += f"；目标：{goal}"
            if current_problem:
                project_line += f"；当前问题：{current_problem}"

            if status == "active":
                active_projects.append(project_line)
            elif status == "idea":
                idea_projects.append(project_line)
            elif status == "blocked":
                blocked_projects.append(project_line)
            elif status == "paused":
                paused_projects.append(project_line)

            stale_days = days_since(updated, date)
            if status == "active" and stale_days is not None and stale_days >= 3:
                stale_projects.append(f"{item} — {stale_days} 天未更新")

            for task in project_tasks:
                tasks.append(f"{task}（{item}）")

            if status == "active":
                reason_parts = []
                if priority in {"P0", "P1"}:
                    reason_parts.append(f"优先级 {priority}")
                if current_problem:
                    reason_parts.append("存在当前问题需要推进")
                if project_tasks:
                    reason_parts.append("已有明确下一步任务")
                if not reason_parts:
                    reason_parts.append("active 项目")
                next_action = project_tasks[0] if project_tasks else "明确今天的下一步行动"
                focus_candidates.append(
                    f"{item} — 建议推进：{next_action}；理由：{'、'.join(reason_parts)}"
                )
        elif obj_type == "source":
            if status == "captured":
                need_extract.append(item)
                need_summary.append(item)
            elif status in {"extracted", "summarized"}:
                need_review.append(f"{item} — {status}")
        elif obj_type == "summary" and fm.get("reviewed") is False:
            need_review.append(f"{item} — summary reviewed=false")
        elif obj_type == "research" and status == "draft":
            need_review.append(f"{item} — research draft")
        elif obj_type == "concept" and status == "draft":
            need_review.append(f"{item} — concept draft")
        elif obj_type == "reflection" and status == "raw":
            need_review.append(f"{item} — reflection raw")
        elif obj_type == "method" and status == "candidate":
            need_review.append(f"{item} — method candidate")
        elif obj_type == "task" and status in {"todo", "doing", "blocked"}:
            tasks.append(f"{item} — {status}")
        elif obj_type == "signal":
            importance = str(fm.get("importance") or "")
            signal_date = str(fm.get("date") or fm.get("created") or "")
            if signal_date == date.isoformat() or importance in {"high", "critical"}:
                radar_changes.append(f"{item} — {importance or 'signal'}")
            if fm.get("requires_research") is True:
                radar_questions.append(item)

    for path in sorted((root / "10_收件箱").glob("*.md")) if (root / "10_收件箱").exists() else []:
        inbox_items.append(link(path, root))

    suggestions: list[str] = []
    if focus_candidates:
        suggestions.append("请从“今日主线候选”中选择一个作为今日主线；AI 只能建议，最终由你确认。")
    if need_summary:
        suggestions.append("优先处理 captured 输入源，至少完成摘要或确认忽略。")
    if need_review:
        suggestions.append("存在待审核 AI 产物，请人工确认后再进入 reviewed/verified 状态。")
    if not suggestions:
        suggestions.append("当前系统负载较轻，可以新增输入源、推进项目或补充日记。")

    return f"""---
type: dashboard
dashboard_type: daily
date: {date.isoformat()}
created: {date.isoformat()}
auto_generated: true
last_updated: "{now.strftime('%Y-%m-%dT%H:%M:%S')}"
tags: [dashboard]
---
# 今日工作台 - {date.isoformat()}

## 1. 今日状态

<!-- 人手动添加 -->

- 精力状态：
- 今日主线：
- 今天最重要的一件事：

<!-- /人手动添加 -->

### 今日主线候选

{items_or_empty(focus_candidates)}

## 2. 当前项目

### Active 项目

{items_or_empty(active_projects)}

### Idea 项目

{items_or_empty(idea_projects)}

### Blocked 项目

{items_or_empty(blocked_projects)}

### Paused 项目

{items_or_empty(paused_projects)}

### 太久未推进项目

{items_or_empty(stale_projects)}

## 3. 待处理输入源

### 收件箱

{items_or_empty(inbox_items)}

### 待摘录

{items_or_empty(need_extract)}

### 待摘要

{items_or_empty(need_summary)}

### 待审核

{items_or_empty(need_review)}

## 4. 今日任务

{task_items_or_empty(tasks)}

## 5. 信息雷达摘要

### 今日重要变化

{items_or_empty(radar_changes)}

### 需要进一步研究的问题

{items_or_empty(radar_questions)}

## 6. 今日思考

<!-- 人手动添加 -->

### 重要想法


### 判断变化


### 新问题


<!-- /人手动添加 -->

## 7. 日终回顾

<!-- 人手动添加 -->

### 今天推进了什么


### 今天学到了什么


### 今天的判断变化


### 明天继续


<!-- /人手动添加 -->

## 8. AI 建议

{items_or_empty(suggestions)}
"""


def main() -> int:
    args = parse_args("生成或更新今日工作台")
    root = Path(args.root).resolve() if args.root else find_vault_root()
    today = dt.date.today()
    now = dt.datetime.now()
    target = root / "00_工作台" / "今日工作台.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    old = target.read_text(encoding="utf-8") if target.exists() else None
    content = preserve_manual_blocks(old, build_dashboard(root, today, now))
    target.write_text(content, encoding="utf-8")
    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
