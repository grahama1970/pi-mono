import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		testTimeout: 15_000,
		hookTimeout: 10000,
		teardownTimeout: 5000,
		pool: "forks",
		fileParallelism: false,
		poolOptions: {
			forks: {
				maxForks: 1,
			},
		},
	},
});
