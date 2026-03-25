import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    target: 'node20',
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    pool: 'forks',
    fileParallelism: false,
    poolOptions: {
      forks: {
        maxForks: 1,
      },
    },
    server: {
      deps: {
        external: [/@silvia-odwyer\/photon-node/],
      },
    },
  },
});
