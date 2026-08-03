# LiveSync upstream

kos-sync inherits its object-storage synchronisation protocol from Self-hosted LiveSync rather than reimplementing it.

The pinned source revision and its `livesync-commonlib` submodule revision are recorded in `manifest.json`. The upstream source is MIT licensed; the preserved license is in `LICENSE`.

## Adoption boundary

kos adopts the R2/S3 journal path, local replication model, chunking, conflict handling, checkpoints, and the upstream tests required to prove those behaviours. kos does not adopt the upstream plugin's settings UI, CouchDB, WebRTC, end-to-end encryption, path obfuscation, Hidden File Sync, or Customisation Sync.

The pinned source snapshot is now preserved under `source/` without local
modifications. The production plugin imports only the dependency graph reached
by the kos database and Journal adapters. Persistent IndexedDB, Vault
reflection and R2 transport are integrated; real private-R2 and iPad
verification remain release blockers.

The pinned upstream package declared `@aws-sdk/client-s3` with a lower bound that can resolve to a dependency chain affected by current `fast-xml-parser` advisories. kos keeps the protocol revision pinned but updates the R2 transport SDK independently; release checks must reject known production dependency vulnerabilities.

## Local patch policy

- Keep imported upstream code in a dedicated vendor directory.
- Put Obsidian, R2 configuration, lifecycle, dashboard, and fixed product policy in kos adapters outside the snapshot.
- Record every modification to upstream files as a reviewable patch.
- Review upstream changes before changing the pinned revision.
- Run retained upstream object-storage tests, kos-sync policy tests, desktop Obsidian E2E, and iPad real-device verification before release.
