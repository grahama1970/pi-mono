import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/wrap-ansi.test.ts"],
		testTimeout: 30000,
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
