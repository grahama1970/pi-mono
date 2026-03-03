#!/usr/bin/env node

/**
 * CLI entry point for the Embry Agent D-Bus bridge.
 *
 * Usage: pi-dbus [--cwd DIR] [--provider PROVIDER] [--model MODEL]
 *
 * Registers org.embry.Agent on the session bus and keeps running
 * until SIGTERM/SIGINT.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentDBusBridge } from "./bridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs(): {
	cwd?: string;
	provider?: string;
	model?: string;
	sessionFile?: string;
	minWorkers?: number;
	maxWorkers?: number;
} {
	const args = process.argv.slice(2);
	const result: Record<string, string> = {};

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--cwd":
				result.cwd = args[++i];
				break;
			case "--provider":
				result.provider = args[++i];
				break;
			case "--model":
				result.model = args[++i];
				break;
			case "--session":
				result.sessionFile = args[++i];
				break;
			case "--min-workers":
				result.minWorkers = args[++i];
				break;
			case "--max-workers":
				result.maxWorkers = args[++i];
				break;
			case "--help":
			case "-h":
				console.log("Usage: pi-dbus [--cwd DIR] [--provider PROVIDER] [--model MODEL] [--session FILE]");
				console.log("              [--min-workers N] [--max-workers N]");
				console.log("");
				console.log("Registers org.embry.Agent on the D-Bus session bus.");
				console.log("Pi runs as child process(es) in RPC mode via a worker pool.");
				console.log("");
				console.log("Options:");
				console.log("  --session FILE     Resume from a specific session file");
				console.log("  --min-workers N    Minimum worker pool size (default: 1, env: EMBRY_MIN_WORKERS)");
				console.log("  --max-workers N    Maximum worker pool size (default: 4, env: EMBRY_MAX_WORKERS)");
				process.exit(0);
		}
	}

	return {
		...result,
		minWorkers: result.minWorkers ? Number.parseInt(result.minWorkers, 10) : undefined,
		maxWorkers: result.maxWorkers ? Number.parseInt(result.maxWorkers, 10) : undefined,
	} as any;
}

async function main(): Promise<void> {
	const opts = parseArgs();

	// Pi CLI is at dist/cli.js, two dirs up from dist/dbus/cli.js
	const piCliPath = resolve(__dirname, "..", "cli.js");

	// Pool sizing: CLI flags > env vars > defaults
	const minWorkers =
		opts.minWorkers ??
		(process.env.EMBRY_MIN_WORKERS ? Number.parseInt(process.env.EMBRY_MIN_WORKERS, 10) : undefined);
	const maxWorkers =
		opts.maxWorkers ??
		(process.env.EMBRY_MAX_WORKERS ? Number.parseInt(process.env.EMBRY_MAX_WORKERS, 10) : undefined);

	const bridge = new AgentDBusBridge(
		{
			cwd: opts.cwd ?? process.cwd(),
			provider: opts.provider,
			model: opts.model,
			cliPath: piCliPath,
			sessionFile: opts.sessionFile,
		},
		{ minWorkers, maxWorkers },
	);

	// Graceful shutdown
	const shutdown = async () => {
		console.log("\n[embry-agent] Shutting down...");
		await bridge.stop();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	try {
		await bridge.start();
		console.log("[embry-agent] Ready. Listening on D-Bus session bus.");
	} catch (err) {
		console.error(`[embry-agent] Failed to start: ${err}`);
		process.exit(1);
	}
}

main();
