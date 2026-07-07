#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import re
from pathlib import Path
from typing import Any

import yaml

from harness_common import find_vault_root, relpath


STATUS_VALUES = {"idea", "active", "paused", "blocked", "completed", "archived", "cancelled"}
CATEGORY_VALUES = {"learning", "research", "writing", "product", "coding", "investment", "career", "system", "other"}
PRIORITY_VALUES = {"P0", "P1", "P2", "P3", "P4"}


def slug_filename(title: str) -> str:
    value = re.sub(r"[\\/:*?\"<>|\n\r\t]+", "_", title).strip(" ._")
    value = re.sub(r"\s+", "", value)
    return value or "未命名项目"


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


def validate_choice(name: str, value: str, allowed: set[str]) -> str:
    if value not in allowed:
        raise SystemExit(f"{name}={value!r} 不合法，可选值：{', '.join(sorted(allowed))}")
    return value


def bullets(items: list[str], fallback: str = "") -> str:
    if items:
        return "\n".join(f"- {item}" for item in items)
    if fallback:
        return f"- {fallback}"
    return ""


def checkboxes(items: list[str], fallback: str = "") -> str:
    if items:
        return "\n".join(f"- [ ] {item}" for item in items)
    if fallback:
        return f"- [ ] {fallback}"
    return "- [ ] 明确下一步行动"


def build_body(args: argparse.Namespace, today: str) -> str:
    title = args.title.strip()
    goal = args.goal.strip()
    why = args.why.strip()
    current_stage = args.current_stage.strip()
    problems = split_items(args.problem)
    success = split_items(args.success)
    constraints = split_items(args.constraint)
    tasks = split_items(args.task)

    stage_text = current_stage or ("想法澄清阶段" if args.status == "idea" else "启动阶段")
    problem_text = bullets(problems, "待澄清核心问题")
    success_text = checkboxes(success, "定义可验收的完成标准")
    task_text = checkboxes(tasks)
    constraint_lines = constraints or ["时间：", "资源：", "依赖："]

    return f"""# {title}

## 背景

### 为什么做

{why or "待补充。"}

### 项目目标

{goal or "待补充。"}

### 当前阶段

{stage_text}

### 当前问题

{problem_text}

### 成功指标

{success_text}

### 限制条件

{bullets(constraint_lines)}

## 决策日志

- {today}：
  - 情境：创建项目。
  - 可选方案：待补充。
  - 选择：待补充。
  - 理由：待补充。
  - 风险：待补充。

## 进展

- {today}：
  - 创建项目对象。

## 当前任务

{task_text}

## 阶段性复盘

待补充。

## 最终成果

待补充。

## 最终沉淀

待补充。

## 相关

- 输入源：
- 研究：
- 概念：
- 方法：

## 备注

{args.note.strip() or "待补充。"}
"""


def build_frontmatter(args: argparse.Namespace, today: str) -> dict[str, Any]:
    title = args.title.strip()
    tags = split_items(args.tag)
    return {
        "type": "project",
        "title": title,
        "status": args.status,
        "category": args.category,
        "priority": args.priority,
        "area": args.area.strip(),
        "goal": args.goal.strip(),
        "current_stage": args.current_stage.strip(),
        "due": args.due.strip(),
        "created": today,
        "updated": today,
        "related_sources": split_items(args.related_source),
        "related_research": split_items(args.related_research),
        "related_concepts": split_items(args.related_concept),
        "related_methods": split_items(args.related_method),
        "tags": tags,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="创建 kos Project 对象")
    parser.add_argument("title", help="项目名")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--status", default="idea", help="项目状态")
    parser.add_argument("--category", default="other", help="项目类别")
    parser.add_argument("--priority", default="P2", help="优先级")
    parser.add_argument("--area", default="", help="所属领域 wikilink 或文本")
    parser.add_argument("--goal", default="", help="项目目标")
    parser.add_argument("--why", default="", help="为什么做")
    parser.add_argument("--current-stage", default="", help="当前阶段")
    parser.add_argument("--due", default="", help="截止日期")
    parser.add_argument("--problem", action="append", help="当前问题，可重复")
    parser.add_argument("--success", action="append", help="成功指标，可重复")
    parser.add_argument("--constraint", action="append", help="限制条件，可重复")
    parser.add_argument("--task", action="append", help="当前任务，可重复")
    parser.add_argument("--related-source", action="append", help="相关 Source wikilink，可重复")
    parser.add_argument("--related-research", action="append", help="相关 Research wikilink，可重复")
    parser.add_argument("--related-concept", action="append", help="相关 Concept wikilink，可重复")
    parser.add_argument("--related-method", action="append", help="相关 Method wikilink，可重复")
    parser.add_argument("--tag", action="append", help="标签，可重复；也可用分号分隔")
    parser.add_argument("--note", default="", help="备注")
    parser.add_argument("--dry-run", action="store_true", help="只输出将要写入的内容，不创建文件")
    args = parser.parse_args()

    if not args.title.strip():
        raise SystemExit("项目名不能为空")
    args.status = validate_choice("status", args.status, STATUS_VALUES)
    args.category = validate_choice("category", args.category, CATEGORY_VALUES)
    args.priority = validate_choice("priority", args.priority, PRIORITY_VALUES)

    root = Path(args.root).resolve() if args.root else find_vault_root()
    today = dt.date.today().isoformat()
    project_dir = root / "30_项目"
    project_path = unique_path(project_dir / f"{slug_filename(args.title)}.md")
    frontmatter = build_frontmatter(args, today)
    body = build_body(args, today)
    content = f"---\n{dump_frontmatter(frontmatter)}\n---\n{body}"

    if args.dry_run:
        print(f"DRY_RUN=true")
        print(f"PROJECT={project_path}")
        print(content)
        return 0

    project_dir.mkdir(parents=True, exist_ok=True)
    project_path.write_text(content, encoding="utf-8")
    print(f"PROJECT={project_path}")
    print(f"STATUS={args.status}")
    print(f"CATEGORY={args.category}")
    print(f"PRIORITY={args.priority}")
    print(f"RELATIVE={relpath(project_path, root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
