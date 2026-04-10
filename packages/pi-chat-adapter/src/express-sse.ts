/**
 * Express SSE middleware — bridges D-Bus signals to Server-Sent Events.
 *
 * Usage in ux-lab server:
 *   import { createPiChatRouter } from '@embry/pi-chat-adapter'
 *   app.use('/api/agent', createPiChatRouter())
 *
 * Frontend:
 *   POST /api/agent/ask { query, persona? }
 *   → SSE stream: event: step | text | message | done | error
 */
import { type Request, type Response, Router } from "express";
import { PiDbusClient } from "./dbus-client.js";
import { RequestAssembler } from "./message-assembler.js";

export interface PiChatRouterOptions {
	/** Auto-connect to D-Bus on first request (default: true) */
	lazyConnect?: boolean;
}

export function createPiChatRouter(opts: PiChatRouterOptions = {}): Router {
	const router = Router();
	const client = new PiDbusClient();
	let connected = false;

	async function ensureConnected(): Promise<void> {
		if (!connected) {
			await client.connect();
			connected = true;
		}
	}

	// Starter questions — curated QRAs from the corpus for empty-state chat
	router.get("/starters", async (req: Request, res: Response) => {
		try {
			const datalake = (req.query.datalake as string) || "sparta";
			// Diverse starter topics — one per tactical domain
			const topics = [
				"supply chain attack countermeasures",
				"authentication bypass space systems",
				"firmware tampering avionics controls",
				"jamming satellite communications",
				"encryption key management spacecraft",
				"insider threat ground station",
			];
			// Pick 5 random topics for variety
			const selected = topics.sort(() => Math.random() - 0.5).slice(0, 5);

			const starters: string[] = [];
			for (const topic of selected) {
				try {
					const resp = await fetch("http://localhost/recall", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						// @ts-expect-error -- Node fetch supports unix socket via dispatcher
						dispatcher: new (await import("undici")).Agent({
							connect: { socketPath: "/run/user/1000/embry/memory.sock" },
						}),
						body: JSON.stringify({
							q: topic,
							k: 1,
							collections: ["sparta_qra"],
						}),
					});
					const data = (await resp.json()) as {
						items?: Array<{ question?: string }>;
					};
					if (data.items?.[0]?.question) {
						starters.push(data.items[0].question);
					}
				} catch {
					/* skip failed recall */
				}
			}

			// Fallback to hardcoded if recall is down
			if (starters.length === 0) {
				starters.push(
					"What SPARTA controls cover supply chain attacks?",
					"Show me the F-36 threat matrix",
					"Which controls have no evidence cases?",
				);
			}

			res.json({ starters, datalake });
		} catch (err) {
			res.status(500).json({ error: String(err) });
		}
	});

	// Health check
	router.get("/health", async (_req: Request, res: Response) => {
		try {
			await ensureConnected();
			const pong = await client.ping();
			res.json({ status: "ok", agent: pong });
		} catch (err) {
			res.status(503).json({ status: "error", message: String(err) });
		}
	});

	// Agent state
	router.get("/state", async (_req: Request, res: Response) => {
		try {
			await ensureConnected();
			const state = await client.getState();
			res.json(state);
		} catch (err) {
			res.status(503).json({ error: String(err) });
		}
	});

	/**
	 * POST /ask — send a query to Pi, stream results as SSE.
	 *
	 * Body: { query: string, persona?: string, hints?: object }
	 *
	 * SSE events:
	 *   event: step     data: { tool, args }           — skill started
	 *   event: text     data: { text }                  — streaming text delta
	 *   event: message  data: ChatMessage               — final assembled message
	 *   event: done     data: { requestId }             — stream complete
	 *   event: error    data: { message }               — error
	 */
	router.post("/ask", async (req: Request, res: Response) => {
		const { query, persona, hints } = req.body ?? {};
		if (!query || typeof query !== "string") {
			res.status(400).json({ error: "query is required" });
			return;
		}

		// Set up SSE headers
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});

		const sendEvent = (event: string, data: unknown) => {
			res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
		};

		try {
			await ensureConnected();

			// Send to Pi
			let requestId: string;
			if (persona) {
				requestId = await client.askAs(persona, query);
			} else if (hints) {
				requestId = await client.askWithHints(query, hints);
			} else {
				requestId = await client.askAsync(query);
			}

			sendEvent("started", { requestId });

			// Assemble structured response from signals
			const assembler = new RequestAssembler(requestId);

			let finished = false;
			const finish = () => {
				if (finished) return;
				finished = true;
				clearInterval(pollInterval);
				clearTimeout(timeout);
				const message = assembler.assemble();
				sendEvent("message", message);
				sendEvent("done", { requestId });
				res.end();
			};

			client.onRequest(requestId, (event) => {
				assembler.ingest(event);

				switch (event.type) {
					case "tool_execution":
						sendEvent("step", {
							tool: event.tool,
							args: event.args,
							steps: assembler.currentSteps(),
						});
						break;

					case "message_update":
						sendEvent("text", { text: event.text });
						break;

					case "agent_end":
						finish();
						break;

					case "error":
						if (!finished) {
							finished = true;
							clearInterval(pollInterval);
							clearTimeout(timeout);
							sendEvent("error", { message: event.message });
							res.end();
						}
						break;
				}
			});

			// Fallback: poll agent state to detect turn completion.
			// The bridge may not emit AgentEnd for tool-use turns,
			// so we check isStreaming as a secondary completion signal.
			let lastTextAt = Date.now();
			const pollInterval = setInterval(async () => {
				if (finished) {
					clearInterval(pollInterval);
					return;
				}
				try {
					const state = await client.getState();
					const streaming = state.isStreaming as boolean;
					const msgCount = state.messageCount as number;
					// If agent stopped streaming and we have text, it's done
					if (!streaming && assembler.currentText().length > 0 && Date.now() - lastTextAt > 2000) {
						finish();
					}
				} catch {
					/* non-fatal */
				}
			}, 1500);

			// Track last text event time for idle detection
			const origOnRequest = client.onRequest.bind(client);
			client.onRequest(requestId, () => {
				lastTextAt = Date.now();
			});

			// Timeout safety — don't hang forever
			const timeout = setTimeout(() => {
				if (!finished) {
					finished = true;
					clearInterval(pollInterval);
					const message = assembler.assemble();
					if (assembler.currentText().length > 0) {
						sendEvent("message", message);
					}
					sendEvent("error", { message: "Request timed out after 120s" });
					res.end();
				}
			}, 120_000);

			// Clean up on client disconnect
			req.on("close", () => {
				finished = true;
				clearInterval(pollInterval);
				clearTimeout(timeout);
			});
		} catch (err) {
			sendEvent("error", { message: String(err) });
			res.end();
		}
	});

	return router;
}
