#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path
from typing import Any

from harness_common import find_vault_root, parse_frontmatter, relpath
from weread_common import (
    dump_frontmatter,
    extract_book_id,
    find_book_source,
    load_api_key,
    replace_block,
    slug_filename,
    unix_date,
    weread_call,
    wikilink,
)


def chapter_map(chapters: list[dict[str, Any]]) -> dict[str, str]:
    result: dict[str, str] = {}
    for chapter in chapters:
        uid = str(chapter.get("chapterUid") or "")
        if uid:
            result[uid] = str(chapter.get("title") or f"chapterUid={uid}")
    return result


def deep_link(book_id: str, chapter_uid: Any, range_value: str) -> str:
    if not chapter_uid or "-" not in range_value:
        return f"weread://reading?bId={book_id}"
    start, end = range_value.split("-", 1)
    return (
        "weread://bestbookmark?"
        f"bookId={book_id}&chapterUid={chapter_uid}&rangeStart={start}&rangeEnd={end}"
    )


def fetch_mine_reviews(api_key: str, book_id: str, max_pages: int = 20) -> list[dict[str, Any]]:
    reviews: list[dict[str, Any]] = []
    synckey = 0
    for _ in range(max_pages):
        payload: dict[str, Any] = {
            "api_name": "/review/list/mine",
            "bookid": book_id,
            "count": 20,
        }
        if synckey:
            payload["synckey"] = synckey
        result = weread_call(api_key, payload)
        page_reviews = result.get("reviews") or []
        if isinstance(page_reviews, list):
            reviews.extend(page_reviews)
        if not result.get("hasMore"):
            break
        next_synckey = result.get("synckey")
        if not next_synckey or next_synckey == synckey:
            break
        synckey = next_synckey
    return reviews


def normalize_review(item: dict[str, Any]) -> dict[str, Any]:
    review = item.get("review") if isinstance(item.get("review"), dict) else item
    if isinstance(review.get("review"), dict):
        review = review["review"]
    return review if isinstance(review, dict) else {}


def group_reviews(reviews: list[dict[str, Any]]) -> tuple[dict[tuple[str, str], list[dict[str, Any]]], list[dict[str, Any]]]:
    by_position: dict[tuple[str, str], list[dict[str, Any]]] = {}
    loose: list[dict[str, Any]] = []
    for item in reviews:
        review = normalize_review(item)
        chapter_uid = str(review.get("chapterUid") or "")
        range_value = str(review.get("range") or "")
        if chapter_uid and range_value:
            by_position.setdefault((chapter_uid, range_value), []).append(review)
        else:
            loose.append(review)
    return by_position, loose


def build_highlight_lines(book_id: str, highlights: list[dict[str, Any]], chapters: dict[str, str], reviews: list[dict[str, Any]]) -> str:
    reviews_by_position, loose_reviews = group_reviews(reviews)
    lines: list[str] = []
    current_chapter = None
    for item in sorted(highlights, key=lambda value: (int(value.get("chapterUid") or 0), str(value.get("range") or ""))):
        chapter_uid = str(item.get("chapterUid") or "")
        chapter_title = chapters.get(chapter_uid, f"chapterUid={chapter_uid}" if chapter_uid else "未定位章节")
        if chapter_title != current_chapter:
            lines.append(f"\n## 章节：{chapter_title}\n")
            current_chapter = chapter_title
        mark_text = str(item.get("markText") or "").strip()
        range_value = str(item.get("range") or "")
        lines.append(f"> {mark_text or '空划线内容'}\n")
        lines.append(f"- bookmarkId: {item.get('bookmarkId') or '待补充'}")
        lines.append(f"- chapterUid: {chapter_uid or '待补充'}")
        lines.append(f"- range: {range_value or '待补充'}")
        lines.append(f"- createTime: {unix_date(item.get('createTime'))}")
        lines.append(f"- deep link: {deep_link(book_id, chapter_uid, range_value)}")
        matched_reviews = reviews_by_position.get((chapter_uid, range_value), [])
        if matched_reviews:
            lines.append("\n### 我的原始想法\n")
            for review in matched_reviews:
                content = str(review.get("content") or "").strip()
                if content:
                    lines.append(f"- reviewId: {review.get('reviewId') or '待补充'}")
                    lines.append(f"  内容：{content}")
        lines.append("")

    if loose_reviews:
        lines.append("\n## 未绑定到具体划线的个人想法\n")
        for review in loose_reviews:
            content = str(review.get("content") or "").strip()
            if content:
                chapter_name = review.get("chapterName") or "整本书 / 未定位章节"
                lines.append(f"- {chapter_name} | reviewId: {review.get('reviewId') or '待补充'}")
                lines.append(f"  内容：{content}")

    return "\n".join(lines).strip() or "暂无微信读书划线。"


def replace_frontmatter(text: str, data: dict[str, Any]) -> str:
    new_fm = f"---\n{dump_frontmatter(data)}\n---"
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            tail_start = text.find("\n", end + 4)
            tail = text[tail_start + 1 :] if tail_start != -1 else ""
            return f"{new_fm}\n{tail}"
    return f"{new_fm}\n{text}"


def build_extract(source_path: Path, root: Path, source_fm: dict[str, Any], book_id: str, lines: str, today: str) -> str:
    title = str(source_fm.get("title") or source_path.stem)
    frontmatter = {
        "type": "extract",
        "source": wikilink(source_path, root),
        "created": today,
        "extracted_by": "human",
        "review_status": "pending",
        "location": "微信读书划线",
        "tags": ["book", "weread", "highlight"],
    }
    return f"""---
{dump_frontmatter(frontmatter)}
---
# 摘录：{title}

## 来源

- 原始材料：{wikilink(source_path, root)}
- 微信读书链接：weread://reading?bId={book_id}

## 同步说明

- 划线来自微信读书个人划线。
- 想法来自微信读书个人想法 / 点评。
- 本文件是材料层，不等于最终理解。

<!-- weread-highlights:start -->
{lines}
<!-- weread-highlights:end -->

<!-- human-notes:start -->
## 人工整理

- 哪些摘录值得进入 Summary：
- 哪些摘录值得沉淀 Concept：
- 哪些摘录需要复读：
<!-- human-notes:end -->
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="同步微信读书划线和个人想法为 kos Extract")
    parser.add_argument("query", help="书籍 Source 路径、标题或 bookId")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--dry-run", action="store_true", help="只预览，不写入文件")
    parser.add_argument("--create-empty", action="store_true", help="无划线时也创建空 Extract")
    args = parser.parse_args()

    root = Path(args.root).resolve() if args.root else find_vault_root()
    source_path = find_book_source(root, args.query)
    source_text = source_path.read_text(encoding="utf-8")
    source_fm, _ = parse_frontmatter(source_path)
    if not source_fm:
        raise SystemExit(f"Source 缺少 frontmatter：{relpath(source_path, root)}")
    book_id = extract_book_id(source_text)
    api_key = load_api_key()
    today = dt.date.today().isoformat()

    bookmark_result = weread_call(api_key, {"api_name": "/book/bookmarklist", "bookId": book_id})
    highlights = bookmark_result.get("updated") or []
    highlights = highlights if isinstance(highlights, list) else []
    chapters = bookmark_result.get("chapters") or []
    chapters = chapters if isinstance(chapters, list) else []
    reviews = fetch_mine_reviews(api_key, book_id)

    if not highlights and not args.create_empty:
        print("ACTION=skip")
        print(f"SOURCE={relpath(source_path, root)}")
        print(f"BOOK_ID={book_id}")
        print("HIGHLIGHT_COUNT=0")
        print(f"REVIEW_COUNT={len(reviews)}")
        print("MESSAGE=当前没有微信读书划线，未创建 Extract")
        return 0

    title = str(source_fm.get("title") or source_path.stem)
    extract_path = root / "20_处理区" / "摘录" / f"{slug_filename(title)}_微信读书划线摘录.md"
    lines = build_highlight_lines(book_id, highlights, chapter_map(chapters), reviews)
    if extract_path.exists():
        old_text = extract_path.read_text(encoding="utf-8")
        new_text = replace_block(old_text, "<!-- weread-highlights:start -->", "<!-- weread-highlights:end -->", lines)
        action = "update"
    else:
        new_text = build_extract(source_path, root, source_fm, book_id, lines, today)
        action = "create"

    source_preview = dict(source_fm)
    source_preview["extract_file"] = wikilink(extract_path, root)
    if source_preview.get("status") == "captured":
        source_preview["status"] = "extracted"

    if args.dry_run:
        print("DRY_RUN=true")
        print(f"ACTION={action}")
        print(f"EXTRACT={extract_path}")
        print(f"HIGHLIGHT_COUNT={len(highlights)}")
        print(f"REVIEW_COUNT={len(reviews)}")
        return 0

    extract_path.parent.mkdir(parents=True, exist_ok=True)
    extract_path.write_text(new_text, encoding="utf-8")
    updated_source = replace_frontmatter(source_text, source_preview)
    source_path.write_text(updated_source, encoding="utf-8")
    print(f"ACTION={action}")
    print(f"EXTRACT={relpath(extract_path, root)}")
    print(f"HIGHLIGHT_COUNT={len(highlights)}")
    print(f"REVIEW_COUNT={len(reviews)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
