from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import yaml

from harness_common import parse_frontmatter, relpath


GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway"
SKILL_VERSION = "1.0.3"
DEFAULT_SECRET_FILE = Path.home() / ".config" / "kos" / "weread.env"


class FlowList(list):
    pass


def _flow_list_representer(dumper: yaml.Dumper, data: FlowList) -> yaml.Node:
    return dumper.represent_sequence("tag:yaml.org,2002:seq", data, flow_style=True)


yaml.SafeDumper.add_representer(FlowList, _flow_list_representer)


def flow_lists(value: Any) -> Any:
    if isinstance(value, list):
        return FlowList(flow_lists(item) for item in value)
    if isinstance(value, dict):
        return {key: flow_lists(item) for key, item in value.items()}
    return value


def dump_frontmatter(data: dict[str, Any]) -> str:
    return yaml.safe_dump(flow_lists(data), allow_unicode=True, sort_keys=False).strip()


def slug_filename(title: str) -> str:
    value = re.sub(r"[\\/:*?\"<>|\n\r\t]+", "_", title).strip(" ._")
    value = re.sub(r"\s+", "_", value)
    return value or "未命名"


def wikilink(path: Path, root: Path) -> str:
    return f"[[{relpath(path, root).removesuffix('.md')}]]"


def replace_block(text: str, start: str, end: str, replacement: str) -> str:
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    block = f"{start}\n{replacement.rstrip()}\n{end}"
    if pattern.search(text):
        return pattern.sub(block, text)
    return text.rstrip() + "\n\n" + block + "\n"


def load_api_key() -> str:
    value = os.environ.get("WEREAD_API_KEY")
    if value:
        return value.strip()

    if DEFAULT_SECRET_FILE.is_file():
        for line in DEFAULT_SECRET_FILE.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, raw_value = stripped.split("=", 1)
            if key.strip() == "WEREAD_API_KEY" and raw_value.strip():
                return raw_value.strip().strip("\"'")

    raise SystemExit(f"缺少 WEREAD_API_KEY；请设置环境变量或写入 {DEFAULT_SECRET_FILE}")


def weread_call(api_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    body = dict(payload)
    body.setdefault("skill_version", SKILL_VERSION)
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        GATEWAY_URL,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        try:
            result = json.loads(text)
        except Exception:
            raise SystemExit(f"微信读书接口 HTTP {exc.code}: {text[:300]}") from exc

    if isinstance(result, dict) and result.get("upgrade_info"):
        upgrade = result["upgrade_info"]
        message = upgrade.get("message") if isinstance(upgrade, dict) else upgrade
        raise SystemExit(f"微信读书 skill 需要升级：{message}")
    if isinstance(result, dict) and result.get("errcode"):
        raise SystemExit(f"微信读书接口错误：{result.get('errmsg') or result.get('errcode')}")
    if not isinstance(result, dict):
        raise SystemExit("微信读书接口返回格式不是 JSON object")
    return result


def looks_like_book_id(value: str) -> bool:
    return bool(re.fullmatch(r"[0-9A-Za-z_-]{6,}", value.strip()))


def find_book_source(root: Path, query: str) -> Path:
    q = query.strip()
    candidate = (root / q).resolve()
    if candidate.exists() and candidate.is_file():
        return candidate

    matches: list[Path] = []
    for path in sorted((root / "11_原材料" / "书籍").glob("*.md")):
        text = path.read_text(encoding="utf-8")
        frontmatter, _ = parse_frontmatter(path)
        if not frontmatter or frontmatter.get("type") != "source" or frontmatter.get("format") != "book":
            continue
        title = str(frontmatter.get("title") or "")
        if q in relpath(path, root) or q in path.stem or q in title or f"bookId: {q}" in text:
            matches.append(path)
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise SystemExit(f"未找到匹配书籍 Source：{query}")
    lines = "\n".join(f"- {relpath(path, root)}" for path in matches[:20])
    raise SystemExit(f"匹配到多个书籍 Source，请提供更精确路径或 bookId：\n{lines}")


def extract_book_id(text: str) -> str:
    patterns = [
        r"bookId:\s*([0-9A-Za-z_-]+)",
        r"bId=([0-9A-Za-z_-]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    raise SystemExit("Source 中未找到微信读书 bookId")


def format_seconds(value: Any) -> str:
    try:
        seconds = int(value or 0)
    except Exception:
        seconds = 0
    hours, remainder = divmod(seconds, 3600)
    minutes, sec = divmod(remainder, 60)
    if hours:
        return f"{hours}小时{minutes}分钟"
    if minutes:
        return f"{minutes}分钟{sec}秒"
    return f"{sec}秒"


def unix_date(value: Any) -> str:
    try:
        timestamp = int(value)
    except Exception:
        return "待补充"
    if timestamp <= 0:
        return "待补充"
    import datetime as dt

    return dt.datetime.fromtimestamp(timestamp).date().isoformat()
