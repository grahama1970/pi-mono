import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		hookTimeout: 20000,
		teardownTimeout: 10000,
		pool: "forks",
		fileParallelism: false,
		poolOptions: {
			forks: {
				maxForks: 1,
			},
		},
	},
});
