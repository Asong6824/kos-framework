#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import re
from pathlib import Path
from typing import Any

import yaml

from harness_common import find_vault_root, parse_frontmatter, relpath


INSUFFICIENT_MARKERS = [
    "正文尚未抓取",
    "补充原始正文",
    "访问限制",
    "验证码",
    "仅记录了来源元信息",
]


def slug_filename(title: str) -> str:
    value = re.sub(r"[\\/:*?\"<>|\n\r\t]+", "_", title).strip(" ._")
    value = re.sub(r"\s+", "_", value)
    return value or "未命名来源"


def wikilink(path: Path, root: Path) -> str:
    return f"[[{relpath(path, root).removesuffix('.md')}]]"


def find_source(root: Path, query: str | None) -> Path:
    sources: list[tuple[Path, dict[str, Any]]] = []
    for path in sorted((root / "11_原材料").rglob("*.md")):
        fm, _ = parse_frontmatter(path)
        if fm and fm.get("type") == "source":
            sources.append((path, fm))

    if not sources:
        raise SystemExit("未找到 Source 文件")

    if not query:
        captured = [(p, fm) for p, fm in sources if fm.get("status") == "captured"]
        if len(captured) == 1:
            return captured[0][0]
        raise SystemExit("请提供 Source 路径或标题；当前无法唯一定位")

    q = query.strip()
    candidate = (root / q).resolve()
    if candidate.exists() and candidate.is_file():
        return candidate

    matches = []
    for path, fm in sources:
        rel = relpath(path, root)
        title = str(fm.get("title") or "")
        if q in rel or q in path.stem or q in title:
            matches.append(path)
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise SystemExit(f"未找到匹配 Source：{query}")
    lines = "\n".join(f"- {relpath(path, root)}" for path in matches[:20])
    raise SystemExit(f"匹配到多个 Source，请提供更精确路径：\n{lines}")


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


def content_is_insufficient(text: str) -> bool:
    return any(marker in text for marker in INSUFFICIENT_MARKERS)


def make_summary_body(source_path: Path, root: Path, source_fm: dict[str, Any], source_body: str) -> tuple[str, bool]:
    title = str(source_fm.get("title") or source_path.stem)
    author = str(source_fm.get("author") or "")
    url = str(source_fm.get("source_url") or "")
    insufficient = content_is_insufficient(source_body)

    if insufficient:
        what = (
            "当前 Source 只有来源元信息和处理说明，尚未包含完整原文。"
            "因此本摘要只能作为元信息摘要，不能视为对原文观点的完整概括。"
        )
        core = [
            "材料主题与 Hermes Agent 的自进化机制、Prompt、Context、Harness 设计实践相关。",
            "由于原文未抓取，暂不能提炼作者的完整论证链。",
        ]
        arguments = [
            "待补充原文后再提取关键论证。",
        ]
        cases = [
            "待补充原文后再识别案例。",
        ]
        questions = [
            "Hermes Agent 的自进化闭环具体由哪些组件触发？",
            "Prompt、Context、Harness 在系统稳定性中分别承担什么职责？",
            "这些机制对 kos 的 Skill 演化和 Harness 防腐有什么可借鉴之处？",
        ]
    else:
        what = "以下摘要基于 Source 文件中的现有正文生成，仍需人工审核。"
        lines = [line.strip() for line in source_body.splitlines() if line.strip()]
        excerpt = " ".join(lines[:20])
        core = [
            excerpt[:300] + ("..." if len(excerpt) > 300 else ""),
        ]
        arguments = ["待人工审核并补充论证链。"]
        cases = ["待人工审核并补充案例。"]
        questions = ["这份材料是否需要升级为研究报告或沉淀为原子概念？"]

    source_line = f"- 来源：{wikilink(source_path, root)}"
    if url:
        source_line += f"\n- URL：{url}"
    if author:
        source_line += f"\n- 作者：{author}"

    return (
        f"""# 摘要：{title}

## 这份材料在讲什么

{what}

{source_line}

## 作者想解决的问题

- 待补充原文后确认。

## 核心观点

{chr(10).join(f"- {item}" for item in core)}

## 结构拆解

- 当前无法可靠拆解全文结构；需要先补充 Source 原文。

## 关键论证

{chr(10).join(f"- {item}" for item in arguments)}

## 重要案例

{chr(10).join(f"- {item}" for item in cases)}

## 关键概念

- Hermes Agent
- 自进化
- Prompt
- Context
- Harness

## 与我已有知识的可能关联

- [[30_项目/kos认知操作系统建设]]
- kos Harness 防腐层
- Hermes Skill 演化机制

## 我需要进一步追问的问题

{chr(10).join(f"- {item}" for item in questions)}

## 可能进入的后续对象

- 研究报告：Hermes Agent 自进化机制对 kos 的启发
- 原子概念：Harness、防腐层、Skill 自进化
- 项目：[[30_项目/kos认知操作系统建设]]
- 日记/认知记录：待人工判断

## 待人工审核

- [ ] 补充或确认 Source 原文
- [ ] 核对摘要是否忠实
- [ ] 判断是否升级为研究报告
- [ ] 判断是否沉淀关键概念
""",
        insufficient,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="为 Source 生成 Summary 并更新回链")
    parser.add_argument("query", nargs="?", help="Source 路径、标题或关键词；省略时自动选择唯一 captured Source")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--dry-run", action="store_true", help="只输出将要写入的内容，不创建或更新文件")
    args = parser.parse_args()

    root = Path(args.root).resolve() if args.root else find_vault_root()
    source_path = find_source(root, args.query)
    source_text = source_path.read_text(encoding="utf-8")
    source_fm, source_body = parse_frontmatter(source_path)
    if not source_fm or source_fm.get("type") != "source":
        raise SystemExit(f"目标不是 Source：{relpath(source_path, root)}")

    title = str(source_fm.get("title") or source_path.stem)
    today = dt.date.today().isoformat()
    summary_name = f"{slug_filename(title)}_摘要.md"
    summary_path = root / "20_处理区" / "摘要" / summary_name
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    body, insufficient = make_summary_body(source_path, root, source_fm, source_body)
    summary_fm = {
        "type": "summary",
        "source": wikilink(source_path, root),
        "created": today,
        "generated_by": "ai",
        "reviewed": False,
        "tags": ["summary"],
    }

    if args.dry_run:
        preview_source_fm = dict(source_fm)
        preview_source_fm["summary_file"] = wikilink(summary_path, root)
        if not insufficient and preview_source_fm.get("status") in {"captured", "extracted"}:
            preview_source_fm["status"] = "summarized"
        print("DRY_RUN=true")
        print(f"SUMMARY={summary_path}")
        print(f"SOURCE={source_path}")
        print(f"CONTENT_INSUFFICIENT={str(insufficient).lower()}")
        print(f"SOURCE_STATUS={preview_source_fm.get('status')}")
        print(f"---\n{dump_frontmatter(summary_fm)}\n---\n{body}")
        return 0

    summary_path.write_text(f"---\n{dump_frontmatter(summary_fm)}\n---\n{body}", encoding="utf-8")

    source_fm["summary_file"] = wikilink(summary_path, root)
    if not insufficient and source_fm.get("status") in {"captured", "extracted"}:
        source_fm["status"] = "summarized"
    updated_source = replace_frontmatter(source_text, source_fm)
    source_path.write_text(updated_source, encoding="utf-8")

    print(f"SUMMARY={summary_path}")
    print(f"SOURCE={source_path}")
    print(f"CONTENT_INSUFFICIENT={str(insufficient).lower()}")
    print(f"SOURCE_STATUS={source_fm.get('status')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
