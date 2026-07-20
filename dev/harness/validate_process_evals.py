#!/usr/bin/env python3
from __future__ import annotations

from process_eval_common import PROCESS_CONTRACT_DIR, validate_process_contracts


def main() -> int:
    errors = validate_process_contracts()
    if errors:
        print("Process Eval contract validation failed")
        for error in errors:
            print(f"- {error}")
        return 1
    count = len(list(PROCESS_CONTRACT_DIR.glob("*.process.yaml")))
    print(f"Process Eval contract validation passed: {count} contracts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
