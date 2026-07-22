# WeRead Integration Copy

This directory stores a framework-side copy of the personal `kos-reading` WeRead integration.

It is not part of the runtime `vault/` distribution because `kos-framework` currently publishes only core runtime capabilities. The integration remains useful here as a development reference and candidate extension source.

Layout:

```text
skill/kos-reading/   # Hermes Skill and references
harness/             # WeRead-specific harness scripts
```

Runtime installation target, when explicitly installed into a personal kos vault:

```text
80_Skills/integrations/weread/kos-reading/
90_系统/harness/import_weread_book.py
90_系统/harness/sync_weread_highlights.py
90_系统/harness/sync_weread_progress.py
90_系统/harness/weread_common.py
```

Do not commit API keys, cookies, tokens, or generated WeRead sync output here.
