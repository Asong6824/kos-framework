#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SKIP_FILES = {
    Path("SECURITY.md"),
    Path("dev/harness/scan_sensitive.py"),
}
SKIP_PARTS = {".git", "__pycache__"}
PATTERNS = [
    re.compile(r"/Users/[A-Za-z0-9._-]+/"),
    re.compile(r"/home/[A-Za-z0-9._-]+/"),
    re.compile(r"WEREAD_API_KEY\s*=\s*(?![\"']?\$WEREAD_API_KEY\b)(?![\"']?<)[^ \t\n]+"),
    re.compile(r"(api[_-]?key|token|secret|password)\s*=\s*[\"'][^\"']{8,}[\"']", re.I),
    re.compile(r"(api[_-]?key|token|secret|password)\s*:\s*[\"'][^\"']{8,}[\"']", re.I),
]
ALLOW_PATTERNS = [
    re.compile(r"WEREAD_API_KEY\s*=\s*[\"']?\$WEREAD_API_KEY[\"']?"),
]


def main() -> int:
    findings: list[str] = []
    for path in sorted(REPO_ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(REPO_ROOT)
        if rel in SKIP_FILES or any(part in SKIP_PARTS for part in rel.parts):
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
