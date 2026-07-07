#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import re
from pathlib import Path
from typing import Any

import yaml

from harness_common import find_vault_root, parse_frontmatter, relpath


CATEGORY_VALUES = {"learning", "research", "writing", "product", "coding", "investment", "career", "system", "other"}
PRIORITY_VALUES = {"P0", "P1", "P2", "P3", "P4"}


def slug_filename(title: str) -> str:
    value = re.sub(r"[\\/:*?\"<>|\n\r\t]+", "_", title).strip(" ._")
    value = re.sub(r"\s+", "_", value)
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


def read_source(root: Path, source: str | None) -> tuple[str, str]:
    if not source:
        return "内联输入", ""
    path = (root / source).resolve()
    if not path.exists() or not path.is_file():
        return source, ""
    _, body = parse_frontmatter(path)
    return relpath(path, root), body.strip()


def title_from_idea(idea: str) -> str:
    line = ""
    for candidate in idea.splitlines():
        stripped = candidate.strip().lstrip("#").strip()
        if stripped:
            line = stripped
            break
    line = re.sub(r"^(项目|计划|想法|我要|我想|需要|希望|搭建|实现)[:：\s]+", "", line)
    line = line[:40].strip(" ，。,.;；")
    return line or "未命名项目"


def wikilink(path: Path, root: Path) -> str:
    return f"[[{relpath(path, root).removesuffix('.md')}]]"


def find_related(root: Path, query: str, limit: int = 8) -> list[str]:
    words = [part for part in re.split(r"[\s,，。；;：:/\\|]+", query) if len(part) >= 2]
    if not words:
        return []
    matches: list[tuple[int, Path, dict[str, Any]]] = []
    for base in ["11_原材料", "20_处理区", "21_研究", "22_知识库", "24_认知记录", "30_项目", "40_方法库", "50_信息雷达"]:
        root_base = root / base
        if not root_base.exists():
            continue
        for path in sorted(root_base.rglob("*.md")):
            fm, body = parse_frontmatter(path)
            if not fm:
                continue
            haystack = f"{path.stem}\n{fm.get('title') or ''}\n{body[:1200]}"
            score = sum(1 for word in words if word in haystack)
            if score:
                matches.append((score, path, fm))
    matches.sort(key=lambda item: (-item[0], relpath(item[1], root)))
    return [f"{wikilink(path, root)} — type: {fm.get('type')}" for _, path, fm in matches[:limit]]


def bullets(items: list[str], fallback: str = "待补充。") -> str:
    if not items:
        return f"- {fallback}"
    return "\n".join(f"- {item}" for item in items)


def checkboxes(items: list[str], fallback: str) -> str:
    if not items:
        return f"- [ ] {fallback}"
    return "\n".join(f"- [ ] {item}" for item in items)


def validate_choice(name: str, value: str, allowed: set[str]) -> str:
    if value not in allowed:
        raise SystemExit(f"{name}={value!r} 不合法，可选值：{', '.join(sorted(allowed))}")
    return value


def build_body(args: argparse.Namespace, today: str, source_label: str, idea: str, related: list[str]) -> str:
    title = args.title.strip() or title_from_idea(idea)
    goal = args.goal.strip() or idea.splitlines()[0].strip() if idea.strip() else ""
    tasks = split_items(args.task)
    success = split_items(args.success)
    constraints = split_items(args.constraint)
    risks = split_items(args.risk)

    return f"""# 项目启动计划：{title}

## 来源

- 来源：{source_label}

## 原始想法

{idea.strip() or "待补充。"}

## 目标澄清

### 一句话目标

{goal or "待补充。"}

### 为什么值得做

{args.why.strip() or "待补充。"}

### 不做什么

{bullets(split_items(args.out_of_scope), "待确认边界。")}

## 项目结构建议

- 建议项目名：{title}
- 建议类别：{args.category}
- 建议优先级：{args.priority}
- 建议状态：idea
- 所属领域：{args.area.strip() or "[[未分类]]"}
- 截止日期：{args.due.strip() or "待确认"}

## 相关上下文

{bullets(related, "未发现明显相关对象。")}

## 项目大纲草案

### 背景

{args.context.strip() or "待补充。"}

### 阶段

{checkboxes(split_items(args.phase), "定义第一阶段")}

### 成功指标

{checkboxes(success, "定义可验收的成功标准")}

### 初始任务

{checkboxes(tasks, "明确下一步行动")}

### 限制条件

{bullets(constraints or ["时间：", "资源：", "依赖："])}

### 风险与阻碍

{bullets(risks, "待识别。")}

## 澄清问题

- [ ] 这个项目的完成标准是否足够明确？
- [ ] 时间线或截止日期是什么？
- [ ] 优先级是否应从 {args.priority} 调整？
- [ ] 是否有必须关联的 Source / Research / Concept / Method？
- [ ] 创建 Project 时应设为 idea 还是 active？

## 执行建议

确认本计划后，可执行：

```bash
python3 90_系统/harness/create_project.py "{title}" \\
  --status idea \\
  --category {args.category} \\
  --priority {args.priority} \\
  --area "{args.area.strip() or '[[未分类]]'}" \\
  --goal "{goal or '待补充'}" \\
  --why "{args.why.strip() or '待补充'}" \\
  --current-stage "启动计划已生成，待人工确认立项" \\
  --problem "根据启动计划补齐澄清问题" \\
  --success "完成启动计划中的成功指标确认" \\
  --task "根据启动计划创建项目并确认第一步行动" \\
  --tag "project"
```

## 版本记录

- {today}：创建 kickoff plan。
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="创建 kos 项目启动计划")
    parser.add_argument("idea", nargs="*", help="项目想法；可留空配合 --source")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--source", default="", help="来源文件路径")
    parser.add_argument("--title", default="", help="项目名")
    parser.add_argument("--category", default="other", help="项目类别")
    parser.add_argument("--priority", default="P2", help="优先级")
    parser.add_argument("--area", default="[[未分类]]", help="所属领域")
    parser.add_argument("--goal", default="", help="项目目标")
    parser.add_argument("--why", default="", help="为什么做")
    parser.add_argument("--context", default="", help="项目背景")
    parser.add_argument("--due", default="", help="截止日期")
    parser.add_argument("--phase", action="append", help="阶段，可重复")
    parser.add_argument("--task", action="append", help="初始任务，可重复")
    parser.add_argument("--success", action="append", help="成功指标，可重复")
    parser.add_argument("--constraint", action="append", help="限制条件，可重复")
    parser.add_argument("--risk", action="append", help="风险，可重复")
    parser.add_argument("--out-of-scope", action="append", help="不做什么，可重复")
    parser.add_argument("--dry-run", action="store_true", help="只输出将要写入的内容，不创建文件")
    args = parser.parse_args()

    args.category = validate_choice("category", args.category, CATEGORY_VALUES)
    args.priority = validate_choice("priority", args.priority, PRIORITY_VALUES)

    root = Path(args.root).resolve() if args.root else find_vault_root()
    source_label, source_body = read_source(root, args.source.strip() or None)
    inline_idea = " ".join(args.idea).strip()
    idea = inline_idea or source_body
    if not idea.strip():
        raise SystemExit("缺少项目想法：请提供内联文本或 --source 文件")

    today = dt.date.today().isoformat()
    title = args.title.strip() or title_from_idea(idea)
    frontmatter = {
        "type": "workflow_note",
        "workflow": "project_kickoff",
        "title": f"项目启动计划：{title}",
        "created": today,
        "status": "draft",
        "target_project": title,
        "tags": ["kos", "kickoff", "project"],
    }
    target_dir = root / "90_系统" / "工作流" / "项目启动计划"
    target_path = unique_path(target_dir / f"Plan_{today}_Kickoff_{slug_filename(title)}.md")
    related = find_related(root, f"{title}\n{idea}")
    content = f"---\n{dump_frontmatter(frontmatter)}\n---\n{build_body(args, today, source_label, idea, related)}"

    if args.dry_run:
        print("DRY_RUN=true")
        print(f"KICKOFF_PLAN={target_path}")
        print(content)
        return 0

    target_dir.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")
    print(f"KICKOFF_PLAN={target_path}")
    print("STATUS=draft")
    print(f"RELATIVE={relpath(target_path, root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
