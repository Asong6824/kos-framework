#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import yaml
except Exception as exc:  # pragma: no cover
    print(f"缺少 PyYAML，无法运行 harness: {exc}", file=sys.stderr)
    sys.exit(2)


HARNESS_DIR = Path(__file__).resolve().parent
SCHEMA_DIR = HARNESS_DIR / "schemas"
REPORT_DIR = HARNESS_DIR / "reports"
ROOT_MARKERS = (".kos.md", ".hermes.md")

REQUIRED_DIRS = (
    "00_工作台",
    "10_收件箱",
    "11_原材料",
    "11_原材料/书籍",
    "11_原材料/播客",
    "11_原材料/文章",
    "11_原材料/新闻",
    "11_原材料/研报",
    "11_原材料/视频",
    "11_原材料/论文",
    "20_处理区",
    "20_处理区/摘录",
    "20_处理区/摘要",
    "21_研究",
    "22_知识库",
    "23_日记",
    "24_认知记录",
    "25_个人操作画像",
    "30_项目",
    "31_任务",
    "40_方法库",
    "41_Skills",
    "41_Skills/core",
    "41_Skills/integrations",
    "41_Skills/personal",
    "41_Skills/incubator",
    "41_Skills/archived",
    "50_信息雷达",
    "50_信息雷达/主题监控",
    "50_信息雷达/公司监控",
    "50_信息雷达/宏观监控",
    "50_信息雷达/每日简报",
    "90_系统/规则",
    "90_系统/模板",
    "90_系统/集成",
    "90_系统/harness",
    "90_系统/harness/reports",
    "90_系统/harness/schemas",
    "90_系统/evals",
    "90_系统/evals/contracts",
    "90_系统/evals/skills",
    "90_系统/evals/schemas",
    "90_系统/evals/artifacts",
    "90_系统/工作流",
    "90_系统/工作流/项目启动计划",
    "90_系统/文档",
)

EXCLUDED_DIR_PARTS = {
    ".git",
    ".obsidian",
    "41_Skills",
    "90_系统",
}


@dataclass
class Finding:
    level: str
    path: str
    message: str

    def line(self) -> str:
        return f"[{self.level}] {self.path}: {self.message}"


def find_vault_root(start: Path | None = None) -> Path:
    cur = (start or Path.cwd()).resolve()
    if cur.is_file():
        cur = cur.parent
    for candidate in [cur, *cur.parents]:
        if any((candidate / marker).is_file() for marker in ROOT_MARKERS):
            return candidate
    marker_list = "、".join(ROOT_MARKERS)
    raise SystemExit(f"无法定位 kos vault 根目录：未找到 {marker_list}")


def relpath(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def parse_args(description: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--root",
        default=None,
        help="kos vault 根目录；默认向上查找包含 .kos.md 或 .hermes.md 的目录",
    )
    parser.add_argument(
        "--format",
        choices=["text", "markdown"],
        default="text",
        help="输出格式",
    )
    return parser.parse_args()


def load_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} 不是 YAML mapping")
    return data


def load_schemas() -> dict[str, dict[str, Any]]:
    schemas: dict[str, dict[str, Any]] = {}
    for path in sorted(SCHEMA_DIR.glob("*.schema.yaml")):
        data = load_yaml(path)
        obj_type = str(data.get("type") or "").strip()
        if not obj_type:
            raise ValueError(f"{path} 缺少 type")
        schemas[obj_type] = data
    return schemas


FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", re.S)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_frontmatter(path: Path) -> tuple[dict[str, Any] | None, str]:
    text = path.read_text(encoding="utf-8")
    match = FRONTMATTER_RE.match(text)
    if not match:
        return None, text
    data = yaml.safe_load(match.group(1)) or {}
    if not isinstance(data, dict):
        return {}, text[match.end() :]
    return data, text[match.end() :]


def iter_markdown_objects(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*.md"):
        if path.name in {".kos.md", ".hermes.md", "README.md", "AGENTS.md", "CLAUDE.md", "HERMES.md"}:
            continue
        rel_parts = path.resolve().relative_to(root.resolve()).parts
        if any(part in EXCLUDED_DIR_PARTS for part in rel_parts):
            continue
        files.append(path)
    return sorted(files)


def is_date_value(value: Any) -> bool:
    if isinstance(value, dt.date) and not isinstance(value, dt.datetime):
        return True
    if isinstance(value, str) and DATE_RE.match(value):
        return True
    return False


def check_kind(value: Any, rule: dict[str, Any]) -> str | None:
    kind = rule.get("kind")
    if kind == "string":
        return None if isinstance(value, str) else "应为字符串"
    if kind == "date":
        return None if is_date_value(value) else "应为 YYYY-MM-DD 日期"
    if kind == "int":
        return None if isinstance(value, int) and not isinstance(value, bool) else "应为整数"
    if kind == "bool":
        return None if isinstance(value, bool) else "应为布尔值 true/false"
    if kind == "list":
        return None if isinstance(value, list) else "应为数组"
    if kind == "enum":
        values = rule.get("values") or []
        return None if value in values else f"应为枚举值之一：{values}"
    return f"未知 schema kind: {kind}"


def print_findings(findings: list[Finding], title: str, markdown: bool = False) -> None:
    if markdown:
        print(f"# {title}")
        print()
        grouped = {"ERROR": [], "WARN": [], "INFO": []}
        for finding in findings:
            grouped.setdefault(finding.level, []).append(finding)
        for level, label in [("ERROR", "错误"), ("WARN", "警告"), ("INFO", "信息")]:
            print(f"## {label}")
            if not grouped.get(level):
                print()
                print("无")
                print()
                continue
            print()
            for finding in grouped[level]:
                print(f"- `{finding.path}`：{finding.message}")
            print()
        return

    print(title)
    for finding in findings:
        print(finding.line())
    if not findings:
        print("OK")


def has_errors(findings: list[Finding]) -> bool:
    return any(item.level == "ERROR" for item in findings)
