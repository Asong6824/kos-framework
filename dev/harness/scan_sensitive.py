#!/usr/bin/env python3
from __future__ import annotations

import re
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SKIP_FILES = {
    Path("SECURITY.md"),
    Path("dev/harness/scan_sensitive.py"),
}
SKIP_PARTS = {".git", "__pycache__", "node_modules"}
PATTERNS = [
    re.compile(r"/Users/[A-Za-z0-9._-]+/"),
    re.compile(r"/home/[A-Za-z0-9._-]+/"),
    re.compile(r"WEREAD_API_KEY\s*=\s*(?![\"']?\$WEREAD_API_KEY\b)(?![\"']?<)[^ \t\n]+"),
    re.compile(r"(api[_-]?key|token|secret|password)\s*=\s*[\"'][^\"']{8,}[\"']", re.I),
    re.compile(r"(api[_-]?key|token|secret|password)\s*:\s*[\"'][^\"']{8,}[\"']", re.I),
]
ALLOW_PATTERNS = [
    re.compile(r"WEREAD_API_KEY\s*=\s*[\"']?\$WEREAD_API_KEY[\"']?"),
    re.compile(
        r"(api[_-]?key|token|secret|password)\s*[:=]\s*[\"']\$\{?[A-Z][A-Z0-9_]*\}?[\"']",
        re.I,
    ),
    re.compile(r"\b([A-Z][A-Z0-9_]*)\s*=\s*[\"']\1[\"']"),
    re.compile(r"/Users/(badlogic|nicobailon)/"),
    re.compile(r"/home/user/"),
]


def repository_files() -> list[Path]:
    """Return files that could enter a commit, excluding .gitignore output."""
    try:
        output = subprocess.check_output(
            [
                "git",
                "-C",
                str(REPO_ROOT),
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
            ]
        )
    except (OSError, subprocess.CalledProcessError):
        return [path for path in REPO_ROOT.rglob("*") if path.is_file()]
    return [REPO_ROOT / item.decode("utf-8") for item in output.split(b"\0") if item]


def is_vendored_reference(rel: Path) -> bool:
    """Pi's fixed snapshot retains upstream tests, docs, examples, and changelog fixtures."""
    parts = rel.parts
    if len(parts) < 4 or parts[:2] != ("agent", "packages"):
        return False
    return parts[3] in {"test", "docs", "examples", "README.md", "CHANGELOG.md"}


def main() -> int:
    findings: list[str] = []
    for path in sorted(repository_files()):
        if not path.is_file():
            continue
        rel = path.relative_to(REPO_ROOT)
        if rel in SKIP_FILES or is_vendored_reference(rel) or any(part in SKIP_PARTS for part in rel.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            if any(pattern.search(line) for pattern in ALLOW_PATTERNS):
                continue
            if any(pattern.search(line) for pattern in PATTERNS):
                findings.append(f"{rel}:{line_number}: {line.strip()}")

    if findings:
        print("Sensitive-path scan failed")
        for finding in findings:
            print(finding)
        return 1
    print("Sensitive-path scan passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
