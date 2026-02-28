import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // 30 seconds for API calls
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 8, // cap parallelism — 50 test files on 48 cores causes OOM/hang
      },
    },
    server: {
      deps: {
        external: [/@silvia-odwyer\/photon-node/],
      },
    },
  },
});
