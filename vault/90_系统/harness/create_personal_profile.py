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
    return value or "个人操作画像"


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
    for base in [
        "11_原材料",
        "21_研究",
        "22_知识库",
        "23_日记",
        "24_认知记录",
        "30_项目",
        "40_方法库",
    ]:
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


def link_many(root: Path, values: list[str], allowed_types: set[str]) -> list[str]:
    links: list[str] = []
    for value in values:
        match = find_object(root, value, allowed_types)
        links.append(wikilink(match[0], root) if match else value)
    return links


def bullets(items: list[str], fallback: str = "待补充。") -> str:
    if not items:
        return f"- {fallback}"
    return "\n".join(f"- {item}" for item in items)


def build_body(args: argparse.Namespace, today: str) -> str:
    return f"""# {args.title.strip()}

## 当前可用结论

{bullets(split_items(args.conclusion), "待用户确认。")}

## 支持证据

{bullets(split_items(args.evidence), "待补充测评、日记、复盘、项目行为或交互观察证据。")}

## 适用场景

{bullets(split_items(args.applies_to), "待补充。")}

## 不适用场景

{bullets(split_items(args.not_applies_to), "待补充，避免把画像泛化成性格定论。")}

## 协作偏好

{bullets(split_items(args.collaboration_preference), "待补充。")}

## 高能量任务

{bullets(split_items(args.high_energy_task), "待验证。")}

## 低能量任务

{bullets(split_items(args.low_energy_task), "待验证。")}

## 决策盲区

{bullets(split_items(args.blind_spot), "待验证。")}

## Agent 应如何使用

{bullets(split_items(args.agent_guideline), "只作为协作假设使用，不得宣称理解用户本质。")}

## 仍需验证的假设

{bullets(split_items(args.hypothesis), "待补充。")}

## 已被推翻的旧判断

{bullets(split_items(args.rejected_belief), "暂无。")}

## 版本记录

- {today}：创建 draft Personal Operating Profile。
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="创建 kos Personal Operating Profile draft")
    parser.add_argument("title", help="画像标题")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--category", default="默认", help="画像分类目录")
    parser.add_argument("--source", action="append", help="来源 Source/Research，可重复")
    parser.add_argument("--related-reflection", action="append", help="相关 Reflection，可重复")
    parser.add_argument("--related-method", action="append", help="相关 Method，可重复")
    parser.add_argument("--related-project", action="append", help="相关 Project，可重复")
    parser.add_argument("--applies-to-skill", action="append", help="可参考该画像的 Skill 名，可重复")
    parser.add_argument("--conclusion", action="append", help="当前可用结论，可重复")
    parser.add_argument("--evidence", action="append", help="支持证据，可重复")
    parser.add_argument("--applies-to", action="append", help="适用场景，可重复")
    parser.add_argument("--not-applies-to", action="append", help="不适用场景，可重复")
    parser.add_argument("--collaboration-preference", action="append", help="协作偏好，可重复")
    parser.add_argument("--high-energy-task", action="append", help="高能量任务，可重复")
    parser.add_argument("--low-energy-task", action="append", help="低能量任务，可重复")
    parser.add_argument("--blind-spot", action="append", help="决策盲区，可重复")
    parser.add_argument("--agent-guideline", action="append", help="Agent 使用方式，可重复")
    parser.add_argument("--hypothesis", action="append", help="仍需验证的假设，可重复")
    parser.add_argument("--rejected-belief", action="append", help="已推翻旧判断，可重复")
    parser.add_argument("--tag", action="append", help="标签，可重复；也可用分号分隔")
    parser.add_argument("--dry-run", action="store_true", help="只输出将要写入的内容，不创建文件")
    args = parser.parse_args()

    if not args.title.strip():
        raise SystemExit("画像标题不能为空")

    root = Path(args.root).resolve() if args.root else find_vault_root()
    today = dt.date.today().isoformat()

    sources = link_many(root, split_items(args.source), {"source", "research", "summary"})
    related_reflections = link_many(root, split_items(args.related_reflection), {"reflection"})
    related_methods = link_many(root, split_items(args.related_method), {"method"})
    related_projects = link_many(root, split_items(args.related_project), {"project"})

    frontmatter = {
        "type": "personal_operating_profile",
        "title": args.title.strip(),
        "status": "draft",
        "confidence": "draft",
        "created": today,
        "updated": today,
        "sources": sources,
        "related_reflections": related_reflections,
        "related_methods": related_methods,
        "related_projects": related_projects,
        "applies_to_skills": split_items(args.applies_to_skill),
        "reviewed": False,
        "tags": split_items(args.tag),
    }
    target_dir = root / "25_个人操作画像" / slug_filename(args.category)
    target_path = unique_path(target_dir / f"{slug_filename(args.title)}.md")
    content = f"---\n{dump_frontmatter(frontmatter)}\n---\n{build_body(args, today)}"

    if args.dry_run:
        print("DRY_RUN=true")
        print(f"PROFILE={target_path}")
        print(content)
        return 0

    target_dir.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")
    print(f"PROFILE={target_path}")
    print("STATUS=draft")
    print("CONFIDENCE=draft")
    print(f"RELATIVE={relpath(target_path, root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
