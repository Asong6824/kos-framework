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
    fileParallelism: false,
    include: ['tests/sync-r2-live.integration.test.ts'],
  },
});
