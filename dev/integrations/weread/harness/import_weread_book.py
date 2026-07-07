#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path
from typing import Any

from harness_common import find_vault_root, parse_frontmatter, relpath
from weread_common import (
    dump_frontmatter,
    load_api_key,
    looks_like_book_id,
    replace_block,
    slug_filename,
    weread_call,
    wikilink,
)


def search_book(api_key: str, query: str) -> dict[str, Any]:
    result = weread_call(
        api_key,
        {
            "api_name": "/store/search",
            "keyword": query,
            "scope": 10,
        },
    )
    candidates: list[dict[str, Any]] = []
    for group in result.get("results") or []:
        for item in group.get("books") or []:
            info = item.get("bookInfo") or {}
            if info.get("bookId"):
                candidates.append(info)
    if not candidates:
        raise SystemExit(f"微信读书未找到书籍：{query}")

    exact = [item for item in candidates if str(item.get("title") or "").strip() == query.strip()]
    if len(exact) == 1:
        return exact[0]
    if len(candidates) == 1:
        return candidates[0]

    lines = []
    for idx, item in enumerate(candidates[:10], start=1):
        lines.append(f"{idx}. {item.get('title')} / {item.get('author')} / bookId={item.get('bookId')}")
    raise SystemExit("匹配到多个候选，请改用 bookId 导入：\n" + "\n".join(lines))


def get_book_info(api_key: str, query: str) -> dict[str, Any]:
    if looks_like_book_id(query):
        return weread_call(api_key, {"api_name": "/book/info", "bookId": query})
    candidate = search_book(api_key, query)
    return weread_call(api_key, {"api_name": "/book/info", "bookId": candidate["bookId"]})


def get_chapters(api_key: str, book_id: str) -> list[dict[str, Any]]:
    result = weread_call(api_key, {"api_name": "/book/chapterinfo", "bookId": book_id})
    chapters = result.get("chapters") or []
    return chapters if isinstance(chapters, list) else []


def find_existing_source(root: Path, book_id: str) -> Path | None:
    marker = f"bookId: {book_id}"
    for path in sorted((root / "11_原材料" / "书籍").glob("*.md")):
        text = path.read_text(encoding="utf-8")
        frontmatter, _ = parse_frontmatter(path)
        if frontmatter and frontmatter.get("type") == "source" and frontmatter.get("format") == "book" and marker in text:
            return path
    return None


def chapter_lines(chapters: list[dict[str, Any]]) -> str:
    lines = []
    for chapter in chapters:
        title = str(chapter.get("title") or "未命名章节")
        level = int(chapter.get("level") or 1)
        indent = "  " * max(level - 1, 0)
        word_count = chapter.get("wordCount")
        suffix = f"（{word_count} 字）" if word_count else ""
        lines.append(f"{indent}- {title}{suffix} `chapterUid={chapter.get('chapterUid')}`")
    return "\n".join(lines) or "待同步章节目录。"


def build_source(book: dict[str, Any], chapters: list[dict[str, Any]], today: str) -> str:
    title = str(book.get("title") or "未命名书籍")
    author = str(book.get("author") or "")
    book_id = str(book.get("bookId") or "")
    source_location = f"weread://reading?bId={book_id}" if book_id else ""
    frontmatter = {
        "type": "source",
        "format": "book",
        "title": title,
        "author": author,
        "source_url": "",
        "source_location": source_location,
        "created": today,
        "status": "captured",
        "related_topics": [],
        "related_projects": [],
        "importance": "medium",
        "summary_file": "",
        "extract_file": "",
        "tags": ["book", "weread"],
    }
    return f"""---
{dump_frontmatter(frontmatter)}
---
# {title}

> 来源：微信读书 | {author or "作者待补充"} | 收集日期 {today}

## 来源信息

- 书名：{title}
- 作者：{author or "待补充"}
- 译者：{book.get("translator") or "待补充"}
- 出版社：{book.get("publisher") or "待补充"}
- 出版时间：{book.get("publishTime") or "待补充"}
- ISBN：{book.get("isbn") or "待补充"}
- 微信读书链接：{source_location or "待补充"}
- 微信读书评分：{book.get("newRating") or "待补充"}

## 阅读目的

<!-- human-notes:start -->
- 我为什么读这本书：
- 希望解决的问题：
- 关联项目：
- 关联研究：
<!-- human-notes:end -->

## 微信读书同步元信息

<!-- weread-sync:start -->
- bookId: {book_id}
- 最近同步：{today}
- 阅读状态：unread
- 阅读进度：待同步
- 当前章节：待同步
- 累计阅读时长：待同步
- 读完时间：待同步
<!-- weread-sync:end -->

## 目录

<!-- weread-chapters:start -->
{chapter_lines(chapters)}
<!-- weread-chapters:end -->

## 待处理

- [ ] 是否同步划线
- [ ] 是否生成摘要
- [ ] 是否写读后复盘
- [ ] 是否沉淀 Concept / Research / Method
"""


def update_existing(text: str, book: dict[str, Any], chapters: list[dict[str, Any]], today: str) -> str:
    book_id = str(book.get("bookId") or "")
    sync = f"""- bookId: {book_id}
- 最近同步：{today}
- 阅读状态：待同步
- 阅读进度：待同步
- 当前章节：待同步
- 累计阅读时长：待同步
- 读完时间：待同步"""
    text = replace_block(text, "<!-- weread-sync:start -->", "<!-- weread-sync:end -->", sync)
    text = replace_block(text, "<!-- weread-chapters:start -->", "<!-- weread-chapters:end -->", chapter_lines(chapters))
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description="从微信读书导入一本书为 kos Source")
    parser.add_argument("query", help="微信读书 bookId 或书名")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--dry-run", action="store_true", help="只预览，不写入文件")
    args = parser.parse_args()

    api_key = load_api_key()

    root = Path(args.root).resolve() if args.root else find_vault_root()
    book = get_book_info(api_key, args.query)
    book_id = str(book.get("bookId") or "")
    if not book_id:
        raise SystemExit("微信读书返回缺少 bookId")
    chapters = get_chapters(api_key, book_id)
    today = dt.date.today().isoformat()

    existing = find_existing_source(root, book_id)
    if existing:
        old_text = existing.read_text(encoding="utf-8")
        new_text = update_existing(old_text, book, chapters, today)
        target = existing
        action = "update"
    else:
        title = str(book.get("title") or "未命名书籍")
        target = root / "11_原材料" / "书籍" / f"{slug_filename(title)}.md"
        new_text = build_source(book, chapters, today)
        action = "create"

    if args.dry_run:
        print(f"DRY_RUN=true")
        print(f"ACTION={action}")
        print(f"TARGET={target}")
        print(f"BOOK_ID={book_id}")
        print(f"CHAPTER_COUNT={len(chapters)}")
        return 0

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(new_text, encoding="utf-8")
    print(f"ACTION={action}")
    print(f"TARGET={target}")
    print(f"BOOK_ID={book_id}")
    print(f"CHAPTER_COUNT={len(chapters)}")
    print(f"WIKILINK={wikilink(target, root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
