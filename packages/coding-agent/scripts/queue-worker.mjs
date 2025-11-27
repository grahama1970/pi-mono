import { readFileSync } from "fs";
import { resolve } from "path";
import { Database, aql } from "arangojs";
import { spawnSync } from "child_process";

function loadPollerConfig() {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	const baseDir = envDir
		? resolve(envDir)
		: resolve(process.cwd(), "..", "..", "packages/coding-agent/src/poller");
	const settingsPath = resolve(baseDir, "settings.json");
	const raw = readFileSync(settingsPath, "utf-8");
	const json = JSON.parse(raw);
	if (!json.poller || !json.poller.arango) {
		throw new Error(`No poller.arango block found in ${settingsPath}`);
	}
	return {
		agentId: json.poller.agentId ?? "ProjectA",
		leaseMs: json.poller.leaseMs ?? 120_000,
		arango: json.poller.arango,
	};
}

async function processOnce() {
	const { agentId, leaseMs, arango } = loadPollerConfig();

	console.log("[worker] Using Arango config:", {
		url: arango.url,
		database: arango.database,
		messagesCollection: arango.messagesCollection,
		hasUsername: Boolean(arango.username),
	});

	const db = new Database({
		url: arango.url,
		databaseName: arango.database,
		auth:
			arango.username && arango.password
				? { username: arango.username, password: arango.password }
				: undefined,
	});

	const collection = db.collection(arango.messagesCollection);
	const now = Date.now();
	const cursor = await db.query(aql`
		FOR m IN ${collection}
			FILTER m.to_agent == ${agentId}
				AND m.status == "queued"
				AND (m.claimed_by == null OR m.lease_until == null OR m.lease_until < ${now})
			LIMIT 5
			RETURN { key: m._key, doc: m }
	`);

	const jobs = await cursor.all();
	if (jobs.length === 0) {
		console.log("[worker] No queued messages found.");
		return;
	}

	console.log(`[worker] Found ${jobs.length} queued message(s).`);

	for (const job of jobs) {
		const id = job.key as string;
		const msg = job.doc as Record<string, unknown>;

		const leaseUntil = Date.now() + leaseMs;
		await db.query(aql`
			UPDATE ${id} WITH {
				status: "in_progress",
				claimed_by: ${agentId},
				lease_until: ${leaseUntil}
			} IN ${collection}
		`);

		const type = String(msg.type ?? "task");
		const fromAgent = String(msg.from_agent ?? "unknown");
		const correlation = msg.correlation_id ? ` (corr=${String(msg.correlation_id)})` : "";
		const payloadRef = msg.payload_ref ? `Payload reference: ${String(msg.payload_ref)}` : "";
		const promptParts = [
			`[System] Incoming ${type} from ${fromAgent}${correlation}`,
			payloadRef,
			"Instructions:",
			"- Read the task description from the shared messages store.",
			"- Perform the required changes.",
			"- Exit with code 0 on success, non-zero on failure.",
		].filter((line) => line.length > 0);
		const prompt = promptParts.join("\n");

		const cliPath = resolve(process.cwd(), "dist/cli.js");
		console.log(`[worker] Running coding-agent for message ${id} ...`);
		const result = spawnSync("node", [cliPath, "-p", prompt, "--mode", "json", "--no-session"], {
			stdio: "inherit",
		});

		const success = result.status === 0;
		const newStatus = success ? "done" : "failed";

		await db.query(aql`
			UPDATE ${id} WITH {
				status: ${newStatus},
				claimed_by: null,
				lease_until: null
			} IN ${collection}
		`);

		console.log(`[worker] Message ${id} marked as ${newStatus}.`);
	}
}

processOnce().catch((err) => {
	console.error("[worker] queue-worker failed:", err);
	process.exit(1);
});

