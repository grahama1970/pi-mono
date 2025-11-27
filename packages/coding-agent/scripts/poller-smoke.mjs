import { readFileSync } from "fs";
import { resolve } from "path";
import { Database } from "arangojs";

function loadPollerConfig() {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  const baseDir = envDir
    ? resolve(envDir)
    : // default: repo root + packages/coding-agent/src/poller
      resolve(process.cwd(), "..", "..", "packages/coding-agent/src/poller");
  const settingsPath = resolve(baseDir, "settings.json");
  const raw = readFileSync(settingsPath, "utf-8");
  const json = JSON.parse(raw);
  if (!json.poller || !json.poller.arango) {
    throw new Error(`No poller.arango block found in ${settingsPath}`);
  }
  return {
    agentId: json.poller.agentId ?? "ProjectA",
    arango: json.poller.arango,
  };
}

async function main() {
  const { agentId, arango } = loadPollerConfig();

  console.log("[smoke] Using Arango config:", {
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
  if (!(await collection.exists())) {
    await collection.create();
    console.log(
      `[smoke] Created Arango collection "${arango.messagesCollection}"`,
    );
  }

  const doc = {
    to_agent: agentId,
    from_agent: "poller-smoke",
    type: "task",
    status: "queued",
    created_at: Date.now(),
    payload: {
      summary: "Poller smoke test message",
      hint: "You should see this in /poll and a system prompt.",
    },
  };

  const meta = await collection.save(doc);

  console.log("\n[smoke] Inserted queued message:");
  console.log(`  _key: ${meta._key}`);
  console.log(`  to_agent: ${agentId}`);

  console.log(`
Next steps:
  1) Start the coding agent with the same settings directory, for example:
       export PI_CODING_AGENT_DIR=./packages/coding-agent/src/poller
       node packages/coding-agent/dist/cli.js
  2) Wait for the poll interval or run /poll in the TUI.
  3) You should see this message in the inbox and as a system prompt.
  4) Use /poll done ${meta._key} (or ack/failed) to update status.
`);
}

main().catch((err) => {
  console.error("[smoke] Poller smoke test failed:", err);
  process.exit(1);
});
