---
name: kos-framework-doc-writer
description: Write kos-framework documentation that explains both operational usage and the design rationale behind each mechanism.
version: 0.1.0
metadata:
  development:
    scope: framework
    published_to_runtime: false
---
# kos-framework-doc-writer

## When to Use

Use when creating or revising public repository docs or in-vault runtime documentation.

## Rules

- Explain how to use a mechanism and why it exists.
- Distinguish current implementation from future design.
- Keep private design reasoning in ignored `local-docs/`.
- Put runtime user documentation in `vault/90_系统/文档/`.
- Put framework development documentation and design reasoning in `local-docs/`.
- Verify commands against a freshly initialized vault.
