import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vendored upstream tests are retained with their own aliases, dependencies,
    // and fixtures. kos runs selected adopted tests through a dedicated config
    // once their production modules enter the plugin build.
    // Process-contract tests start a real kos-agent child and have a strict
    // handshake timeout, so do not make them compete with other test files.
    fileParallelism: false,
    include: ['tests/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.tsx'],
    exclude: [
      'tests/sync-livesync-journal.test.ts',
      'tests/sync-livesync-database.test.ts',
      'tests/sync-livesync-engine.test.ts',
      'tests/sync-r2-live.integration.test.ts',
    ],
  },
});
