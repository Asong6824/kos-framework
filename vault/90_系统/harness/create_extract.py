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


def dump_frontmatter(data: dict[str, Any]) -> str:
    return yaml.safe_dump(data, allow_unicode=True, sort_keys=False).strip()


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
        captured = [(p, fm) for p, fm in sources if fm.get("status") in {"captured", "converted", "selected"}]
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


def source_main_text(source_body: str) -> str:
    lines = []
    for line in source_body.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            continue
        if stripped.startswith("- [ ]"):
            continue
        if stripped.startswith("<!--"):
            continue
        lines.append(stripped)
    return "\n".join(lines)


def pick_lines(text: str, limit: int = 10) -> list[str]:
    lines = [line.strip().lstrip("-").strip() for line in text.splitlines() if line.strip()]
    useful = [line for line in lines if len(line) >= 12]
    return useful[:limit]


def build_body(source_path: Path, root: Path, source_fm: dict[str, Any], source_body: str) -> tuple[str, bool]:
    title = str(source_fm.get("title") or source_path.stem)
    author = str(source_fm.get("author") or "")
    url = str(source_fm.get("source_url") or "")
    insufficient = content_is_insufficient(source_body)
    source_text = source_main_text(source_body)
    picked = pick_lines(source_text)

    if insufficient:
        extract_content = (
            "- 当前 Source 正文不足，不能可靠摘录原文。\n"
            "- 这里只记录可追溯的来源元信息和待补充事项，待补充全文后重新摘录。"
        )
        definitions = "- 待补充原文后提取。"
        arguments = "- 待补充原文后提取。"
        quotes = "- 待补充原文后提取。"
    else:
        extract_content = "\n".join(f"> {line}" for line in picked) or "> 待人工补充摘录。"
        definitions = "- 待人工审核并补充关键定义。"
        arguments = "- 待人工审核并补充重要论证。"
        quotes = "- 待人工审核并补充可引用表达。"

    return (
        f"""# 摘录：{title}

## 来源

- 原始材料：{wikilink(source_path, root)}
- 作者：{author or "待补充"}
- 来源链接：{url or "待补充"}
- 原始位置：{source_fm.get("source_url") or "Source 正文"}

## 摘录原则

本文件保存材料中的关键内容，尽量忠实于原文，不代表我的最终理解。AI 生成摘录必须保持 `review_status: pending`，等待人工审核。

## 摘录内容

{extract_content}

## 关键定义

{definitions}

## 核心观点

{extract_content}

## 重要论证

{arguments}

## 案例与数据

- 待人工审核并补充案例或数据。

## 值得引用的表达

{quotes}

## 需要进一步理解的片段

- [ ] 是否需要补充完整原文
- [ ] 摘录是否忠实于原文
- [ ] 哪些片段应进入 Summary / Research / Concept
""",
        insufficient,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="为 Source 生成 Extract 并更新回链")
    parser.add_argument("query", nargs="?", help="Source 路径、标题或关键词；省略时自动选择唯一待处理 Source")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--location", default="", help="章节、页码或时间戳")
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
    extract_name = f"{slug_filename(title)}_摘录.md"
    extract_path = root / "20_处理区" / "摘录" / extract_name
    extract_path.parent.mkdir(parents=True, exist_ok=True)
    body, insufficient = build_body(source_path, root, source_fm, source_body)
    extract_fm = {
        "type": "extract",
        "source": wikilink(source_path, root),
        "created": today,
        "extracted_by": "ai",
        "review_status": "pending",
        "location": args.location.strip(),
        "tags": ["extract"],
    }

    preview_source_fm = dict(source_fm)
    preview_source_fm["extract_file"] = wikilink(extract_path, root)
    if not insufficient and preview_source_fm.get("status") in {"captured", "selected", "converted"}:
        preview_source_fm["status"] = "extracted"

    if args.dry_run:
        print("DRY_RUN=true")
        print(f"EXTRACT={extract_path}")
        print(f"SOURCE={source_path}")
        print(f"CONTENT_INSUFFICIENT={str(insufficient).lower()}")
        print(f"SOURCE_STATUS={preview_source_fm.get('status')}")
        print(f"---\n{dump_frontmatter(extract_fm)}\n---\n{body}")
        return 0

    extract_path.write_text(f"---\n{dump_frontmatter(extract_fm)}\n---\n{body}", encoding="utf-8")
    source_fm["extract_file"] = wikilink(extract_path, root)
    if not insufficient and source_fm.get("status") in {"captured", "selected", "converted"}:
        source_fm["status"] = "extracted"
    source_path.write_text(replace_frontmatter(source_text, source_fm), encoding="utf-8")

    print(f"EXTRACT={extract_path}")
    print(f"SOURCE={source_path}")
    print(f"CONTENT_INSUFFICIENT={str(insufficient).lower()}")
    print(f"SOURCE_STATUS={source_fm.get('status')}")
    print(f"RELATIVE={relpath(extract_path, root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
