# kos integration inventory

The immutable `source/` snapshot has no local modifications. kos-specific work
is kept outside it:

| kos file | Upstream boundary | Purpose |
| --- | --- | --- |
| `upstream/livesync/kos-database.ts` | `LiveSyncLocalDB` and manager stack | Supplies a narrow, UI-free kos host while preserving upstream path, hash, chunk, entry, and tombstone implementations. |
| `src/sync/upstream/livesync-runtime.js` | browser PouchDB + adopted LiveSync exports | Configures the IndexedDB adapter and exposes only the Journal/database symbols used by kos. |
| `src/sync/livesync-engine.ts` | `JournalSyncCore` + `LiveSyncLocalDB` | Connects persistent checkpoints, Vault reflection, remote application and the KOS conflict-copy/delete policy. |
| `src/sync/obsidian-livesync.ts` | Obsidian Vault/adapter APIs | Implements binary Vault I/O and serializes checkpoint Sets in plugin-private state. |
| `src/sync/upstream/livesync-storage.ts` | `IJournalStorage` | Adapts the audited kos R2 transport to LiveSync's boolean/false storage contract. |
| `src/sync/upstream/r2-storage.ts` | `MinioStorageAdapter` | Fixed Cloudflare R2 endpoint, prefix, retries, current audited AWS SDK, and upstream-compatible empty `StartAfter` handling. |
| `src/sync/upstream/obsidian-http-handler.ts` | Obsidian request handler | Uses Obsidian `requestUrl` for mobile network access. |
| `esbuild.config.mjs` | upstream aliases and `bgWorker.mock.ts` | Compiles the selected browser graph and uses upstream's own synchronous worker mock because worker generation is disabled by fixed policy. |
| `tests/sync-livesync-journal.test.ts` | `JournalSyncCore` | Proves two independent PouchDB databases can create, update, and delete through a shared unencrypted Journal. |
| `tests/sync-livesync-database.test.ts` | `LiveSyncLocalDB` + `JournalSyncCore` | Proves the original manager stack creates chunks/tombstones and reconstructs a chunked Unicode Markdown file after Journal transfer. |
| `tests/sync-livesync-engine.test.ts` | production `KosLiveSyncEngine` boundary | Proves two persistent IndexedDB devices create, update, preserve concurrent edits, and propagate deletion through one Journal. |
| `tests/sync-r2-live.integration.test.ts` | production engine + private R2 | Opt-in credentialed test proving create, reverse update, deletion and isolated-prefix cleanup against real Cloudflare R2. |
| `dev/harness/verify_new_user_sync.mjs` | installed release + two Obsidian profiles + private R2 | Replays first-device setup, join-code UI, create/update/delete, Runtime baseline preservation, credential removal and isolated-prefix cleanup from two freshly installed kos Vaults. |
| `vitest.livesync.config.ts` | Upstream aliases/tests | Runs retained upstream Journal tests separately from kos unit tests. |

Dependency differences:

- kos pins current AWS SDK/Smithy packages instead of the upstream lower bounds.
- PouchDB 9 is retained for protocol compatibility.
- `uuid` is overridden to `11.1.1` to remove the advisory affecting the
  transitive PouchDB dependency. The adopted Journal suite and kos two-Vault
  suite must pass with this override.

No upstream UI, CouchDB, P2P, E2EE, path obfuscation, hidden-file sync, or
customisation-sync entry is reachable from the kos production entry.

Additional kos safety patches discovered by the fresh-user journey:

- Plugin-private checkpoint state is schema v2 and records its owning Vault ID.
  Importing a join code for another Vault resets checkpoint/reflection state
  instead of treating the previous Vault's reflection cache as current truth.
- A new device with an existing remote Journal receives remote content before
  reflecting local files. Identical pre-populated Runtime files are byte-level
  deduplicated; divergent local content becomes a conflict copy; local-only
  content is uploaded in the following pass. This prevents PouchDB conflict
  revision cleanup from being propagated as whole-file tombstones.
- The production regression suite includes pre-populated two-Vault joining and
  a subsequent sync round, because a create/update/delete-only fixture did not
  detect deletion of unrelated Runtime files.
