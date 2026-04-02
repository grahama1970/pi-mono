/**
 * Embry Terminal — PTY + Activity WebSocket Server
 *
 * Port: 8640
 * Auth: Bearer embry-dev-token on all HTTP + WS upgrades
 *
 * HTTP endpoints:
 *   GET  /api/health                       → { status: "ok", ts: number }
 *   GET  /api/projects                     → Project[]
 *   GET  /api/skills                       → Skill[]
 *   POST /api/agent/message                → proxy to scillm; broadcasts agent_completed
 *   POST /api/agent/recall                 → proxy to memory-agent; broadcasts agent_finding
 *   GET  /api/suggestions                  → { suggestions: Suggestion[] }
 *   POST /api/suggestions/:id/accept       → mark accepted; persist to memory (24 h TTL)
 *   POST /api/suggestions/:id/reject       → mark rejected
 *   GET  /api/webhook/test                 → fire a test webhook event; returns { ok, status? }
 *
 * WebSocket endpoints:
 *   ws://…/api/terminal/:id  — PTY session (shell I/O)
 *   ws://…/api/activity      — Activity channel (agent events, presence)
 *
 * Activity events (JSON):
 *   { type: "agent_started",    agentId, query, ts }
 *   { type: "agent_completed",  agentId, query, answer, durationMs, ts }
 *   { type: "agent_finding",    agentId, query, items, confidence, ts }
 *   { type: "presence_update",  clientId, lastSeen, ts }
 *   { type: "suggestion",       text, source, ts }
 *
 * Presence protocol:
 *   Client sends { type: "heartbeat", clientId } every 30 s.
 *   Clients not seen for 90 s are evicted from the presence map.
 *
 * Webhook integration (optional — Slack Block Kit / Teams incoming webhook):
 *   EMBRY_WEBHOOK_URL     — Incoming webhook URL (Slack or Teams). No-op when unset.
 *   EMBRY_WEBHOOK_EVENTS  — Comma-separated event types to forward (default: all).
 *                           e.g. "agent_completed,agent_finding"
 *   EMBRY_WEBHOOK_CHANNEL — Optional Slack channel override (e.g. "#embry-alerts").
 */

import http from "node:http";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import express, { type Request, type Response } from "express";
import { WebSocketServer, WebSocket } from "ws";

// ── Config ───────────────────────────────────────────────────────────────────

const PORT = 8640;
const DEV_TOKEN = "embry-dev-token";
const SCILLM_URL = process.env.SCILLM_URL ?? "http://127.0.0.1:8080";
const MEMORY_URL = process.env.MEMORY_URL ?? "http://127.0.0.1:6333";

// How long (ms) before a presence entry is considered stale
const PRESENCE_TTL_MS = 90_000;
// How often (ms) to sweep stale presence entries
const PRESENCE_SWEEP_MS = 30_000;

// ── Webhook config (optional) ────────────────────────────────────────────────

const WEBHOOK_URL = process.env.EMBRY_WEBHOOK_URL ?? "";
const WEBHOOK_CHANNEL = process.env.EMBRY_WEBHOOK_CHANNEL ?? "";
// Parse allowed event types; empty set means "all events"
const WEBHOOK_EVENTS: Set<string> = (() => {
  const raw = (process.env.EMBRY_WEBHOOK_EVENTS ?? "").trim();
  if (!raw) return new Set<string>();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
})();
const WEBHOOK_TIMEOUT_MS = 5_000;

// ── Bearer-token auth ────────────────────────────────────────────────────────

function validateBearer(authHeader: string | undefined): boolean {
  if (!authHeader) return false;
  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token === DEV_TOKEN;
}

// ── Webhook notify ────────────────────────────────────────────────────────────

/**
 * Fire-and-forget Slack Block Kit (or Teams) webhook notification.
 * Never throws — errors are logged to stderr only.
 *
 * @param event The activity event to forward.
 */
async function webhookNotify(event: ActivityEvent & { ts: number }): Promise<void> {
  // 1. No URL → silently skip
  if (!WEBHOOK_URL) return;

  // 2. Event-type filter — skip if not in the allowed set
  if (WEBHOOK_EVENTS.size > 0 && !WEBHOOK_EVENTS.has(event.type)) return;

  // 3. Build Slack Block Kit payload
  const headerText = `Embry · ${event.type}`;
  const fields: { type: "mrkdwn"; text: string }[] = [];

  if ("agentId" in event && event.agentId) {
    fields.push({ type: "mrkdwn", text: `*Agent:*\n${String(event.agentId)}` });
  }
  if ("query" in event && event.query) {
    const q = String(event.query).slice(0, 200);
    fields.push({ type: "mrkdwn", text: `*Query:*\n${q}` });
  }
  if ("answer" in event && event.answer) {
    const a = String(event.answer).slice(0, 300);
    fields.push({ type: "mrkdwn", text: `*Answer:*\n${a}` });
  }
  if ("confidence" in event && event.confidence !== undefined) {
    fields.push({
      type: "mrkdwn",
      text: `*Confidence:*\n${(Number(event.confidence) * 100).toFixed(0)} %`,
    });
  }
  if ("durationMs" in event && event.durationMs !== undefined) {
    fields.push({
      type: "mrkdwn",
      text: `*Duration:*\n${Number(event.durationMs).toFixed(0)} ms`,
    });
  }

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: headerText, emoji: true } },
  ];
  if (fields.length > 0) {
    blocks.push({ type: "section", fields });
  }
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `ts: ${event.ts}` }] });

  const body: Record<string, unknown> = { blocks };
  if (WEBHOOK_CHANNEL) body.channel = WEBHOOK_CHANNEL;

  // 4. POST with 5 s timeout — never throws
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`[webhook] POST failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[webhook] POST error: ${String(err)}`);
  }
}

// ── Activity subscribers ─────────────────────────────────────────────────────

const activitySubscribers = new Set<WebSocket>();

interface ActivityEvent {
  type:
    | "agent_started"
    | "agent_completed"
    | "agent_finding"
    | "presence_update"
    | "suggestion";
  [key: string]: unknown;
}

function broadcastActivity(event: ActivityEvent): void {
  const stamped = { ...event, ts: Date.now() };
  const payload = JSON.stringify(stamped);
  for (const ws of activitySubscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
  // Auto-create suggestion on high-confidence findings
  if (event.type === "agent_finding") {
    autoCreateSuggestion(event);
  }
  // Forward to optional Slack/Teams webhook (fire-and-forget)
  void webhookNotify(stamped);
}

// ── Suggestions store ─────────────────────────────────────────────────────────

interface Suggestion {
  id: string;
  text: string;
  source: string;
  confidence: number;
  status: "pending" | "accepted" | "rejected";
  agentId: string;
  query: string;
  createdAt: number;
}

const suggestionsStore = new Map<string, Suggestion>();

/** Auto-create a suggestion from an agent_finding event when confidence > 0.5 */
function autoCreateSuggestion(event: ActivityEvent): void {
  const confidence = (event.confidence as number | undefined) ?? 0;
  if (confidence <= 0.5) return;

  const id = `sug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const items = (event.items as unknown[] | undefined) ?? [];
  const firstItem = items[0];
  const text =
    firstItem !== undefined
      ? typeof firstItem === "string"
        ? firstItem
        : JSON.stringify(firstItem)
      : `Finding from ${String(event.agentId ?? "agent")}`;

  suggestionsStore.set(id, {
    id,
    text,
    source: String(event.agentId ?? "agent"),
    confidence,
    status: "pending",
    agentId: String(event.agentId ?? "agent"),
    query: String(event.query ?? ""),
    createdAt: Date.now(),
  });
}

// ── Presence map ─────────────────────────────────────────────────────────────

const presenceMap = new Map<string, number>(); // clientId → lastSeen epoch ms

function touchPresence(clientId: string): void {
  presenceMap.set(clientId, Date.now());
  broadcastActivity({ type: "presence_update", clientId, lastSeen: Date.now() });
}

function sweepPresence(): void {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  for (const [clientId, lastSeen] of presenceMap) {
    if (lastSeen < cutoff) {
      presenceMap.delete(clientId);
    }
  }
}

setInterval(sweepPresence, PRESENCE_SWEEP_MS);

// ── PTY sessions ─────────────────────────────────────────────────────────────

interface PtySession {
  proc: ReturnType<typeof spawn>;
  clients: Set<WebSocket>;
  createdAt: number;
}

const ptySessions = new Map<string, PtySession>();

function getOrCreateSession(sessionId: string): PtySession {
  let session = ptySessions.get(sessionId);
  if (!session) {
    const proc = spawn("bash", ["--login"], {
      env: { ...process.env, TERM: "xterm-256color" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    session = { proc, clients: new Set(), createdAt: Date.now() };
    ptySessions.set(sessionId, session);

    proc.stdout?.on("data", (chunk: Buffer) => {
      const msg = JSON.stringify({ type: "output", data: chunk.toString("base64") });
      for (const ws of session!.clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const msg = JSON.stringify({ type: "output", data: chunk.toString("base64") });
      for (const ws of session!.clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
      }
    });

    proc.on("exit", (code) => {
      const exitMsg = JSON.stringify({ type: "exit", code });
      for (const ws of session!.clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(exitMsg);
          ws.close();
        }
      }
      ptySessions.delete(sessionId);
    });
  }
  return session;
}

// ── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Auth middleware
app.use((req, res, next) => {
  if (!validateBearer(req.headers.authorization)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

// GET /api/health
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    ts: Date.now(),
    sessions: ptySessions.size,
    activitySubscribers: activitySubscribers.size,
    presence: presenceMap.size,
  });
});

// GET /api/projects — workspace project list
app.get("/api/projects", (_req: Request, res: Response) => {
  const workspaceRoot = process.env.WORKSPACE_ROOT ?? "/home/node/workspace";
  // Return a static project for now; extend with fs.readdir for real discovery
  res.json([
    { name: "pi-mono", path: workspaceRoot, branch: "main", exists: true },
  ]);
});

// GET /api/skills — list installed skills
app.get("/api/skills", (_req: Request, res: Response) => {
  res.json([
    { id: "memory", name: "memory", description: "Hybrid semantic recall" },
    { id: "assess", name: "assess", description: "SPARTA posture assessment" },
    { id: "create-evidence-case", name: "create-evidence-case", description: "Build CAE trees" },
    { id: "extract-entities", name: "extract-entities", description: "Extract control IDs" },
  ]);
});

// POST /api/agent/message — proxy to scillm; broadcasts agent_started / agent_completed
app.post("/api/agent/message", async (req: Request, res: Response) => {
  const { query, agentId = "claude", project = "_" } = req.body as {
    query?: string;
    agentId?: string;
    project?: string;
  };

  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  broadcastActivity({ type: "agent_started", agentId, query });
  const startedAt = Date.now();

  try {
    const upstream = await fetch(`${SCILLM_URL}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEV_TOKEN}` },
      body: JSON.stringify({ query, project }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      broadcastActivity({
        type: "agent_completed",
        agentId,
        query,
        answer: null,
        error: text,
        durationMs: Date.now() - startedAt,
      });
      res.status(upstream.status).json({ error: text });
      return;
    }

    const data = await upstream.json() as Record<string, unknown>;
    const answer = (data.answer ?? data.response ?? data.content ?? "") as string;

    broadcastActivity({
      type: "agent_completed",
      agentId,
      query,
      answer,
      durationMs: Date.now() - startedAt,
    });

    res.json(data);
  } catch (err) {
    // scillm unavailable — return a stub so UI stays functional in dev
    const answer = `[scillm unavailable] ${String(err)}`;
    broadcastActivity({
      type: "agent_completed",
      agentId,
      query,
      answer,
      durationMs: Date.now() - startedAt,
      error: String(err),
    });
    res.status(503).json({ error: "scillm unavailable", detail: String(err) });
  }
});

// POST /api/agent/recall — proxy to memory; broadcasts agent_finding
app.post("/api/agent/recall", async (req: Request, res: Response) => {
  const { query, project = "_", agentId = "memory" } = req.body as {
    query?: string;
    project?: string;
    agentId?: string;
  };

  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  try {
    const upstream = await fetch(`${MEMORY_URL}/recall`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, project }),
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: await upstream.text() });
      return;
    }

    const data = await upstream.json() as {
      items?: unknown[];
      confidence?: number;
      [key: string]: unknown;
    };

    broadcastActivity({
      type: "agent_finding",
      agentId,
      query,
      items: data.items ?? [],
      confidence: data.confidence ?? 0,
    });

    res.json(data);
  } catch (err) {
    // memory unavailable — return empty results so UI stays functional
    broadcastActivity({
      type: "agent_finding",
      agentId,
      query,
      items: [],
      confidence: 0,
      error: String(err),
    });
    res.status(503).json({ error: "memory unavailable", detail: String(err) });
  }
});

// ── Suggestion endpoints ──────────────────────────────────────────────────────

const SUGGESTION_TTL_MS = 24 * 60 * 60 * 1_000; // 24 hours

// GET /api/suggestions — list all suggestions (pending + resolved)
app.get("/api/suggestions", (_req: Request, res: Response) => {
  res.json({ suggestions: Array.from(suggestionsStore.values()) });
});

// POST /api/suggestions/:id/accept — accept and persist to memory
app.post("/api/suggestions/:id/accept", async (req: Request, res: Response) => {
  const { id } = req.params;
  const suggestion = suggestionsStore.get(id);
  if (!suggestion) {
    res.status(404).json({ error: "Suggestion not found" });
    return;
  }

  suggestion.status = "accepted";
  suggestionsStore.set(id, suggestion);

  // Persist to memory with 24-hour expiry (fire-and-forget; memory may be unavailable)
  try {
    await fetch(`${MEMORY_URL}/learn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: suggestion.text,
        source: suggestion.source,
        query: suggestion.query,
        agentId: suggestion.agentId,
        ttlMs: SUGGESTION_TTL_MS,
      }),
    });
  } catch {
    // memory unavailable — accepted status is still persisted in-process
  }

  res.json({ ok: true, suggestion });
});

// POST /api/suggestions/:id/reject — reject a suggestion
app.post("/api/suggestions/:id/reject", (_req: Request, res: Response) => {
  const { id } = req.params;
  const suggestion = suggestionsStore.get(id);
  if (!suggestion) {
    res.status(404).json({ error: "Suggestion not found" });
    return;
  }

  suggestion.status = "rejected";
  suggestionsStore.set(id, suggestion);

  res.json({ ok: true, suggestion });
});

// GET /api/webhook/test — fire a synthetic test event and report outcome
app.get("/api/webhook/test", async (_req: Request, res: Response) => {
  if (!WEBHOOK_URL) {
    res.json({ ok: false, reason: "EMBRY_WEBHOOK_URL not configured" });
    return;
  }

  const testEvent: ActivityEvent & { ts: number } = {
    type: "agent_completed",
    agentId: "test",
    query: "Webhook connectivity test",
    answer: "✅ Embry webhook is working!",
    durationMs: 0,
    ts: Date.now(),
  };

  let httpStatus: number | undefined;
  let postError: string | undefined;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    const r = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: [
          { type: "header", text: { type: "plain_text", text: "Embry Webhook Test", emoji: true } },
          {
            type: "section",
            text: { type: "mrkdwn", text: "✅ Embry webhook connectivity test successful." },
          },
        ],
        ...(WEBHOOK_CHANNEL ? { channel: WEBHOOK_CHANNEL } : {}),
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    httpStatus = r.status;
  } catch (err) {
    postError = String(err);
  }

  // Also broadcast the test event to WS subscribers
  broadcastActivity(testEvent);

  if (postError) {
    res.status(502).json({ ok: false, error: postError });
  } else if (httpStatus && httpStatus >= 400) {
    res.status(502).json({ ok: false, status: httpStatus });
  } else {
    res.json({ ok: true, status: httpStatus });
  }
});

// ── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer(app);

// ── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  // Auth gate on upgrade
  if (!validateBearer(request.headers.authorization)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const pathname = url.pathname;

  // Route: /api/activity
  if (pathname === "/api/activity") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("activity", ws, request);
    });
    return;
  }

  // Route: /api/terminal/:id
  const termMatch = pathname.match(/^\/api\/terminal\/([^/]+)$/);
  if (termMatch) {
    const sessionId = termMatch[1];
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("terminal", ws, sessionId);
    });
    return;
  }

  socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
  socket.destroy();
});

// ── Activity channel handler ─────────────────────────────────────────────────

wss.on("activity", (ws: WebSocket) => {
  activitySubscribers.add(ws);

  // Welcome ping so client knows the channel is live
  ws.send(
    JSON.stringify({
      type: "suggestion",
      text: "Activity channel connected. Heartbeat every 30 s.",
      source: "server",
      ts: Date.now(),
    }),
  );

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type?: string; clientId?: string };
      if (msg.type === "heartbeat" && msg.clientId) {
        touchPresence(msg.clientId);
      }
    } catch {
      // ignore malformed frames
    }
  });

  ws.on("close", () => {
    activitySubscribers.delete(ws);
  });

  ws.on("error", () => {
    activitySubscribers.delete(ws);
  });
});

// ── Terminal (PTY) channel handler ───────────────────────────────────────────

wss.on("terminal", (ws: WebSocket, sessionId: string) => {
  const session = getOrCreateSession(sessionId);
  session.clients.add(ws);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as {
        type?: string;
        data?: string;
        cols?: number;
        rows?: number;
      };

      if (msg.type === "input" && msg.data) {
        const decoded = Buffer.from(msg.data, "base64");
        session.proc.stdin?.write(decoded);
      }
      // resize events are accepted but ignored (no node-pty)
    } catch {
      // pass-through raw text for convenience
      const text = raw.toString();
      session.proc.stdin?.write(text);
    }
  });

  ws.on("close", () => {
    session.clients.delete(ws);
    // Leave proc running — other clients may reconnect
  });

  ws.on("error", () => {
    session.clients.delete(ws);
  });
});

// ── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[embry-terminal] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[embry-terminal]   /api/health       — health check`);
  console.log(`[embry-terminal]   /api/activity      — activity WebSocket`);
  console.log(`[embry-terminal]   /api/terminal/:id  — PTY WebSocket`);
});

// ── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(): void {
  console.log("[embry-terminal] Shutting down…");
  for (const [, session] of ptySessions) {
    session.proc.kill();
  }
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
