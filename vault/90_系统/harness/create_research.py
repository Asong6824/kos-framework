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
    return value or "未命名研究"


def area_dir_name(area: str) -> str:
    value = area.strip()
    if value.startswith("[[") and value.endswith("]]"):
        value = value[2:-2].split("|", 1)[0]
    return slug_filename(value or "未分类")


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


def wikilink(path: Path, root: Path) -> str:
    return f"[[{relpath(path, root).removesuffix('.md')}]]"


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


def all_objects(root: Path) -> list[tuple[Path, dict[str, Any], str]]:
    targets = ["11_原材料", "20_处理区", "21_研究", "22_知识库", "30_项目"]
    records: list[tuple[Path, dict[str, Any], str]] = []
    for prefix in targets:
        base = root / prefix
        if not base.exists():
            continue
        for path in sorted(base.rglob("*.md")):
            fm, body = parse_frontmatter(path)
            if fm:
                records.append((path, fm, body))
    return records


def tokenize(text: str) -> set[str]:
    words = set(re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", text.lower()))
    chinese_chunks = set(re.findall(r"[\u4e00-\u9fff]{2,}", text))
    return words | chinese_chunks


def score_record(query_tokens: set[str], path: Path, fm: dict[str, Any], body: str) -> int:
    haystack = " ".join(
        [
            path.as_posix(),
            str(fm.get("title") or ""),
            str(fm.get("question") or ""),
            str(fm.get("tags") or ""),
            body[:2000],
        ]
    )
    tokens = tokenize(haystack)
    return len(query_tokens & tokens)


def discover_related(root: Path, question: str, explicit: list[str]) -> dict[str, list[str]]:
    records = all_objects(root)
    query_tokens = tokenize(question)
    related = {
        "sources": [],
        "summaries": [],
        "concepts": [],
        "projects": [],
    }

    for item in explicit:
        match = find_by_query(root, records, item)
        if not match:
            continue
        path, fm, _ = match
        obj_type = str(fm.get("type") or "")
        target = {
            "source": "sources",
            "summary": "summaries",
            "concept": "concepts",
            "project": "projects",
        }.get(obj_type)
        if target:
            related[target].append(wikilink(path, root))

    scored: list[tuple[int, Path, dict[str, Any]]] = []
    if query_tokens:
        for path, fm, body in records:
            obj_type = str(fm.get("type") or "")
            if obj_type not in {"source", "summary", "concept", "project"}:
                continue
            score = score_record(query_tokens, path, fm, body)
            if score:
                scored.append((score, path, fm))

    for _, path, fm in sorted(scored, key=lambda item: (-item[0], relpath(item[1], root)))[:12]:
        obj_type = str(fm.get("type") or "")
        target = {
            "source": "sources",
            "summary": "summaries",
            "concept": "concepts",
            "project": "projects",
        }.get(obj_type)
        if not target:
            continue
        link = wikilink(path, root)
        if link not in related[target]:
            related[target].append(link)

    return related


def find_by_query(
    root: Path,
    records: list[tuple[Path, dict[str, Any], str]],
    query: str,
) -> tuple[Path, dict[str, Any], str] | None:
    q = query.strip()
    if not q:
        return None
    candidate = (root / q).resolve()
    if candidate.exists() and candidate.is_file():
        fm, body = parse_frontmatter(candidate)
        return (candidate, fm or {}, body)

    matches = []
    for path, fm, body in records:
        title = str(fm.get("title") or "")
        rel = relpath(path, root)
        if q in rel or q in path.stem or q in title:
            matches.append((path, fm, body))
    if len(matches) == 1:
        return matches[0]
    return None


def bullets(items: list[str], fallback: str = "暂无") -> str:
    if not items:
        return f"- {fallback}"
    return "\n".join(f"- {item}" for item in items)


def concept_candidates(args: argparse.Namespace, question: str) -> list[str]:
    explicit = split_items(args.concept_candidate)
    if explicit:
        return explicit
    candidates: list[str] = []
    for token in ["Hermes Agent", "Prompt", "Context", "Harness", "自进化", "防腐层", "Skill 自进化"]:
        if token.lower() in question.lower() or token in question:
            candidates.append(token)
    return candidates


def build_body(args: argparse.Namespace, today: str, related: dict[str, list[str]], concepts: list[str]) -> str:
    title = args.title.strip()
    question = args.question.strip()
    background = args.background.strip()
    goal = args.goal.strip()
    sources = related["sources"] + related["summaries"]
    project_links = related["projects"]
    concept_links = related["concepts"]

    return f"""# 研究报告：{title}

## 研究问题

{question}

## 研究目标

{goal or "形成一个可被人工审核的研究初稿，明确已有证据、初步判断、疑点和后续动作。"}

## 背景

{background or "待补充。"}

## 资料来源

{bullets(sources, "暂未绑定明确来源；需要补充 Source 或 Summary。")}

## 核心结论

- 这是 AI 生成的研究初稿，结论必须人工审核。
- 当前只基于 vault 中已发现的材料和用户问题组织结构，不应视为最终判断。
- 如果资料来源不足，下一步应先补充来源，再提升研究可信度。

## 关键论证

- 已有材料：{len(sources)} 个来源或摘要。
- 相关项目：{len(project_links)} 个。
- 相关概念：{len(concept_links)} 个已存在概念，{len(concepts)} 个候选概念。

## 不同观点之间的关系

- 待补充更多来源后比较。

## 我的理解

> AI 可以起草，但这里最终必须由人确认。

- 初步看，这个问题需要同时区分事实材料、系统设计原则和个人使用场景。
- 研究应优先服务相关项目，而不是停留在资料汇总。

## 我的质疑

- 当前来源是否足够？
- 是否存在未经验证的外部观点？
- 哪些判断必须由你亲自确认？

## 对项目的影响

{bullets(project_links, "暂未绑定项目。")}

## 候选 Concept

{bullets(concepts, "暂无；人工审核后再决定是否沉淀。")}

## 已有关联 Concept

{bullets(concept_links, "暂无")}

## 下一步问题

- [ ] 补充或确认资料来源。
- [ ] 人工审核核心结论。
- [ ] 判断哪些候选 Concept 值得进入 `22_知识库/`。
- [ ] 判断是否需要继续拆分子研究问题。

## 待确认

- [ ] 资料是否充分
- [ ] 结论是否可信
- [ ] 是否可沉淀为 Concept
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="创建 kos Research draft")
    parser.add_argument("question", help="研究问题")
    parser.add_argument("--root", default=None, help="kos vault 根目录")
    parser.add_argument("--title", default="", help="研究标题；默认从问题生成")
    parser.add_argument("--area", default="[[未分类]]", help="所属领域")
    parser.add_argument("--goal", default="", help="研究目标")
    parser.add_argument("--background", default="", help="背景")
    parser.add_argument("--related", action="append", help="显式关联对象路径或标题，可重复")
    parser.add_argument("--concept-candidate", action="append", help="候选 Concept，可重复")
    parser.add_argument("--tag", action="append", help="标签，可重复；也可用分号分隔")
    parser.add_argument("--dry-run", action="store_true", help="只输出将要写入的内容，不创建文件")
    args = parser.parse_args()

    if not args.question.strip():
        raise SystemExit("研究问题不能为空")

    root = Path(args.root).resolve() if args.root else find_vault_root()
    today = dt.date.today().isoformat()
    title = args.title.strip() or args.question.strip().rstrip("？?")
    area = args.area.strip() or "[[未分类]]"
    explicit_related = split_items(args.related)
    related = discover_related(root, args.question, explicit_related)
    concepts = concept_candidates(args, args.question)
    frontmatter = {
        "type": "research",
        "title": title,
        "question": args.question.strip(),
        "status": "draft",
        "confidence": "draft",
        "area": area,
        "created": today,
        "updated": today,
        "related_sources": related["sources"] + related["summaries"],
        "related_concepts": related["concepts"],
        "related_projects": related["projects"],
        "tags": split_items(args.tag) or ["research"],
    }
    research_dir = root / "21_研究" / area_dir_name(area)
    research_path = unique_path(research_dir / f"{slug_filename(title)}.md")
    body = build_body(args, today, related, concepts)
    content = f"---\n{dump_frontmatter(frontmatter)}\n---\n{body}"

    if args.dry_run:
        print("DRY_RUN=true")
        print(f"RESEARCH={research_path}")
        print(content)
        return 0

    research_dir.mkdir(parents=True, exist_ok=True)
    research_path.write_text(content, encoding="utf-8")
    print(f"RESEARCH={research_path}")
    print("STATUS=draft")
    print("CONFIDENCE=draft")
    print(f"RELATED_SOURCES={len(frontmatter['related_sources'])}")
    print(f"RELATED_CONCEPTS={len(frontmatter['related_concepts'])}")
    print(f"RELATED_PROJECTS={len(frontmatter['related_projects'])}")
    print(f"RELATIVE={relpath(research_path, root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
