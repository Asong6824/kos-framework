#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path
from typing import Any

from harness_common import find_vault_root, relpath
from weread_common import (
    extract_book_id,
    find_book_source,
    format_seconds,
    load_api_key,
    replace_block,
    unix_date,
    weread_call,
)


def chapter_title(chapters: list[dict[str, Any]], chapter_uid: Any) -> str:
    for chapter in chapters:
        if str(chapter.get("chapterUid")) == str(chapter_uid):
            return str(chapter.get("title") or f"chapterUid={chapter_uid}")
    return f"chapterUid={chapter_uid}" if chapter_uid else "待补充"


def reading_status(progress: int, started: int, finish_time: Any) -> str:
    if progress == 100 and finish_time:
        return "finished"
    if progress > 0 or started:
        return "reading"
    return "unread"


def build_sync_block(book_id: str, progress_payload: dict[str, Any], chapters: list[dict[str, Any]], today: str) -> str:
    book_progress = progress_payload.get("book") or {}
    progress = int(book_progress.get("progress") or 0)
    current_chapter_uid = book_progress.get("chapterUid") or ""
    finish_time = book_progress.get("finishTime")
    record_seconds = book_progress.get("recordReadingTime") or 0
    return f"""- bookId: {book_id}
- 最近同步：{today}
- 阅读状态：{reading_status(progress, int(book_progress.get("isStartReading") or 0), finish_time)}
- 阅读进度：{progress}%
- 当前章节：{chapter_title(chapters, current_chapter_uid)}
- 当前章节 UID：{current_chapter_uid or "待补充"}
- 章节内偏移：{book_progress.get("chapterOffset", "待补充")}
- 累计阅读时长：{format_seconds(record_seconds)}
- 累计阅读时长秒数：{record_seconds}
- 最后阅读时间：{unix_date(book_progress.get("updateTime"))}
- 读完时间：{unix_date(finish_time)}"""


def main() -> int:
    parser = argparse.ArgumentParser(description="同步微信读书单本书阅读进度到 kos Source")
    parser.add_argument("query", help="书籍 Source 路径、标题或 bookId")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--dry-run", action="store_true", help="只预览，不写入文件")
    args = parser.parse_args()

    root = Path(args.root).resolve() if args.root else find_vault_root()
    source_path = find_book_source(root, args.query)
    source_text = source_path.read_text(encoding="utf-8")
    book_id = extract_book_id(source_text)
    api_key = load_api_key()
    today = dt.date.today().isoformat()

    progress = weread_call(api_key, {"api_name": "/book/getprogress", "bookId": book_id})
    chapter_result = weread_call(api_key, {"api_name": "/book/chapterinfo", "bookId": book_id})
    chapters = chapter_result.get("chapters") or []
    chapters = chapters if isinstance(chapters, list) else []
    sync_block = build_sync_block(book_id, progress, chapters, today)
    new_text = replace_block(source_text, "<!-- weread-sync:start -->", "<!-- weread-sync:end -->", sync_block)

    book_progress = progress.get("book") or {}
    if args.dry_run:
        print("DRY_RUN=true")
        print(f"SOURCE={source_path}")
        print(f"BOOK_ID={book_id}")
        print(f"PROGRESS={book_progress.get('progress', 0)}%")
        print(f"READING_TIME_SECONDS={book_progress.get('recordReadingTime', 0)}")
        return 0

    source_path.write_text(new_text, encoding="utf-8")
    print("ACTION=update")
    print(f"SOURCE={relpath(source_path, root)}")
    print(f"BOOK_ID={book_id}")
    print(f"PROGRESS={book_progress.get('progress', 0)}%")
    print(f"READING_TIME_SECONDS={book_progress.get('recordReadingTime', 0)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
