# Vendored source snapshot

- Self-hosted LiveSync: tag `0.25.83`, commit `977d50566d664c4e94eb2bb3047c00b8e1e21eb1`
- `livesync-commonlib`: commit `bbf2539d00af4846e3e1640e72460fb7ed930ca5`
- Imported: `2026-07-30`
- Local modifications inside `source/`: none

`source/` is an unmodified source snapshot used to build the kos adapter against
the upstream Journal and local-replication implementation. It is not included in
the kos Vault runtime distribution. The plugin build imports only the audited
browser-safe dependency graph reached by the kos adapters.

The integration order is:

1. `JournalSyncCore` with encryption disabled — retained upstream tests and
   kos two-Vault create/update/delete tests pass;
2. kos R2 transport adapter — structural bridge implemented and unit tested;
3. upstream browser/IndexedDB local database — narrow UI-free host implemented;
   manager-level chunk/read/tombstone and chunked Journal transfer tests pass,
   and the production bundle uses persistent IndexedDB;
4. Vault event to local database reflection — implemented for create, modify,
   delete, rename and remote application;
5. real R2 and mobile verification — pending.

Any required source change must be recorded as a patch outside `source/` or in a
reviewable patch inventory before the snapshot itself is changed.
