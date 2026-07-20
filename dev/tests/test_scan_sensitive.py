from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "harness" / "scan_sensitive.py"
SPEC = importlib.util.spec_from_file_location("scan_sensitive", MODULE_PATH)
assert SPEC and SPEC.loader
scan_sensitive = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scan_sensitive)


class SensitiveScanTests(unittest.TestCase):
    def test_only_upstream_reference_surfaces_are_exempt(self) -> None:
        self.assertTrue(scan_sensitive.is_vendored_reference(Path("agent/packages/ai/test/provider.test.ts")))
        self.assertTrue(scan_sensitive.is_vendored_reference(Path("agent/packages/kos-agent/docs/rpc.md")))
        self.assertTrue(scan_sensitive.is_vendored_reference(Path("agent/packages/ai/README.md")))
        self.assertFalse(scan_sensitive.is_vendored_reference(Path("agent/packages/ai/src/provider.ts")))
        self.assertFalse(scan_sensitive.is_vendored_reference(Path("agent/scripts/live-rpc-smoke.mjs")))

    def test_env_references_are_allowed_but_literal_keys_are_not(self) -> None:
        env_line = 'apiKey: "$CUSTOM_API_KEY"'
        secret_line = 'apiKey: "' + "sk-live-" + 'secret-value"'
        self.assertTrue(any(pattern.search(env_line) for pattern in scan_sensitive.ALLOW_PATTERNS))
        self.assertFalse(any(pattern.search(secret_line) for pattern in scan_sensitive.ALLOW_PATTERNS))
        self.assertTrue(any(pattern.search(secret_line) for pattern in scan_sensitive.PATTERNS))


if __name__ == "__main__":
    unittest.main()
