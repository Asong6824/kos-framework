#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import re
from pathlib import Path
from typing import Any

import yaml

from harness_common import find_vault_root, parse_frontmatter, relpath


HEADING_RE = re.compile(r"^(#{2,6})\s+(.+?)\s*$", re.M)
PROTECTED_STATUS = {"completed", "archived", "cancelled"}


def dump_frontmatter(data: dict[str, Any]) -> str:
    return yaml.safe_dump(data, allow_unicode=True, sort_keys=False).strip()


def replace_frontmatter(text: str, data: dict[str, Any]) -> str:
    new_fm = f"---\n{dump_frontmatter(data)}\n---"
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            tail_start = text.find("\n", end + 4)
            tail = text[tail_start + 1 :] if tail_start != -1 else ""
            return f"{new_fm}\n{tail}"
    return f"{new_fm}\n{text}"


def find_project(root: Path, query: str | None) -> Path:
    projects: list[tuple[Path, dict[str, Any]]] = []
    for path in sorted((root / "30_项目").rglob("*.md")):
        fm, _ = parse_frontmatter(path)
        if fm and fm.get("type") == "project":
            projects.append((path, fm))
    if not projects:
        raise SystemExit("未找到 Project")
    if not query:
        active = [(p, fm) for p, fm in projects if fm.get("status") == "active"]
        if len(active) == 1:
            return active[0][0]
        raise SystemExit("请提供项目路径或标题；当前无法唯一定位")
    q = query.strip()
    candidate = (root / q).resolve()
    if candidate.exists() and candidate.is_file():
        return candidate
    matches = []
    for path, fm in projects:
        title = str(fm.get("title") or "")
        rel = relpath(path, root)
        if q in rel or q in path.stem or q in title:
            matches.append(path)
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise SystemExit(f"未找到匹配 Project：{query}")
    lines = "\n".join(f"- {relpath(path, root)}" for path in matches[:20])
    raise SystemExit(f"匹配到多个 Project，请提供更精确路径：\n{lines}")


def append_to_section(markdown: str, heading: str, lines: list[str]) -> str:
    if not lines:
        return markdown
    matches = list(HEADING_RE.finditer(markdown))
    for idx, match in enumerate(matches):
        if match.group(2).strip() != heading:
            continue
        level = len(match.group(1))
        insert_at = len(markdown)
        for next_match in matches[idx + 1 :]:
            if len(next_match.group(1)) <= level:
                insert_at = next_match.start()
                break
        block = "\n".join(lines).rstrip() + "\n\n"
        prefix = markdown[:insert_at].rstrip() + "\n\n"
        suffix = markdown[insert_at:].lstrip("\n")
        return prefix + block + suffix
    return markdown.rstrip() + f"\n\n## {heading}\n\n" + "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="更新 kos Project 的进展、任务、决策或复盘")
    parser.add_argument("query", nargs="?", help="Project 路径或标题；省略时选择唯一 active 项目")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--progress", action="append", help="进展记录，可重复")
    parser.add_argument("--task", action="append", help="新增当前任务，可重复")
    parser.add_argument("--decision", action="append", help="决策记录，可重复")
    parser.add_argument("--review", action="append", help="阶段性复盘记录，可重复")
    parser.add_argument("--final-result", action="append", help="最终成果记录，可重复")
    parser.add_argument("--final-insight", action="append", help="最终沉淀记录，可重复")
    parser.add_argument("--status", default="", help="新状态；completed/archived/cancelled 需要 --human-confirmed")
    parser.add_argument("--current-stage", default="", help="更新 current_stage")
    parser.add_argument("--problem", action="append", help="追加当前问题，可重复")
    parser.add_argument("--human-confirmed", action="store_true", help="确认受保护状态变更由人授权")
    args = parser.parse_args()

    root = Path(args.root).resolve() if args.root else find_vault_root()
    project_path = find_project(root, args.query)
    text = project_path.read_text(encoding="utf-8")
    fm, body = parse_frontmatter(project_path)
    if not fm or fm.get("type") != "project":
        raise SystemExit(f"目标不是 Project：{relpath(project_path, root)}")

    today = dt.date.today().isoformat()
    fm["updated"] = today
    if args.current_stage.strip():
        fm["current_stage"] = args.current_stage.strip()
    if args.status.strip():
        new_status = args.status.strip()
        if new_status in PROTECTED_STATUS and not args.human_confirmed:
            raise SystemExit(f"Project status={new_status} 需要 --human-confirmed")
        old_status = str(fm.get("status") or "")
        fm["status"] = new_status
        if args.human_confirmed:
            fm["human_confirmed"] = True
            fm["confirmed_by"] = "human"
    else:
        old_status = str(fm.get("status") or "")

    updated = replace_frontmatter(text, fm)

    if args.progress:
        updated = append_to_section(updated, "进展", [f"- {today}：{item}" for item in args.progress])
    if args.task:
        updated = append_to_section(updated, "当前任务", [f"- [ ] {item}" for item in args.task])
    if args.decision:
        lines = []
        for item in args.decision:
            lines.extend([f"- {today}：", f"  - 情境：{item}", "  - 选择：待补充。", "  - 理由：待补充。", "  - 风险：待补充。"])
        updated = append_to_section(updated, "决策日志", lines)
    if args.review:
        updated = append_to_section(updated, "阶段性复盘", [f"- {today}：{item}" for item in args.review])
    if args.final_result:
        updated = append_to_section(updated, "最终成果", [f"- {today}：{item}" for item in args.final_result])
    if args.final_insight:
        updated = append_to_section(updated, "最终沉淀", [f"- {today}：{item}" for item in args.final_insight])
    if args.problem:
        updated = append_to_section(updated, "当前问题", [f"- {item}" for item in args.problem])
    if args.status.strip():
        confirm_text = "人工确认" if args.human_confirmed else "未人工确认"
        updated = append_to_section(
            updated,
            "状态变更记录",
            [f"- {today}：`{old_status}` → `{args.status.strip()}`（{confirm_text}）"],
        )

    project_path.write_text(updated, encoding="utf-8")
    print(f"PROJECT={project_path}")
    print(f"STATUS={fm.get('status')}")
    print(f"UPDATED={today}")
    print(f"RELATIVE={relpath(project_path, root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
