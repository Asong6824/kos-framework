import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@lib\/(.*)$/,
        replacement: `${fileURLToPath(new URL('./upstream/livesync/source/lib/src/', import.meta.url))}$1`,
      },
      {
        find: /^@\/(.*)$/,
        replacement: `${fileURLToPath(new URL('./upstream/livesync/source/', import.meta.url))}$1`,
      },
    ],
  },
  test: {
    // JournalSyncCore uses process-global lock keys; retained suites must not
    // execute in parallel inside the same worker realm.
    fileParallelism: false,
    include: [
      'upstream/livesync/source/lib/src/replication/journal/JournalSyncCore.unit.spec.ts',
      'tests/sync-livesync-journal.test.ts',
      'tests/sync-livesync-database.test.ts',
      'tests/sync-livesync-engine.test.ts',
    ],
  },
});
