/**
 * D-Bus ↔ RPC Bridge for org.embry.Agent.
 *
 * Thin translation layer: D-Bus method calls → WorkerPool → Pi RPC workers → D-Bus signals.
 * Delegates all request execution and child process management to the WorkerPool.
 *
 * Uses configureMembers() instead of decorators — dbus-next decorators require
 * TC39 Stage 2 format which is incompatible with TypeScript's legacy decorators.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import dbus from "dbus-next";
import type { RpcExtensionUIRequest } from "../modes/rpc/rpc-types.js";
import { DBUS_BUS_NAME, DBUS_INTERFACE_NAME, DBUS_OBJECT_PATH } from "./interface.js";
import {
	type BridgeOptions,
	type BridgePoolOptions,
	type DBusAgentState,
	type RequestHints,
	RequestPriority,
} from "./types.js";
import { WorkerPool } from "./worker-pool.js";

const { Interface, ACCESS_READ } = dbus.interface;

// Stream Deck conversation topic file — matches format from
// streamdeck/src/streamdeck/utils/conversation_topic.py
const TOPIC_FILE = path.join(os.tmpdir(), "streamdeck_conversation_topic");

/**
 * Write conversation topic for Stream Deck page anticipation.
 * The streamdeck-context service polls this file and feeds it to the
 * page classifier cascade (Tier 0.5 → Tier 1 → Tier 2).
 * Fire-and-forget: never block the D-Bus request path.
 */
function writeConversationTopic(prompt: string, persona?: string): void {
	const data = {
		topic: prompt,
		timestamp: new Date().toISOString(),
		agent: "embry-agent",
		persona: persona ?? "",
		participants: persona ? [persona] : [],
	};
	try {
		fs.writeFileSync(TOPIC_FILE, JSON.stringify(data));
	} catch {
		// Non-fatal — deck just won't update this cycle
	}
}

// Helper to extract text from agent messages
export function extractTextFromMessages(messages: unknown[]): string {
	if (!Array.isArray(messages)) return "";
	const last = messages[messages.length - 1] as any;
	if (!last?.content) return "";
	const parts = Array.isArray(last.content) ? last.content : [last.content];
	return parts
		.filter((p: any) => typeof p === "string" || p?.type === "text")
		.map((p: any) => (typeof p === "string" ? p : (p.text ?? "")))
		.join("");
}

class AgentDBusInterface extends Interface {
	private bridge!: AgentDBusBridge;

	constructor(bridge: AgentDBusBridge) {
		super(DBUS_INTERFACE_NAME);
		this.bridge = bridge;
	}

	// --- Properties (accessed via D-Bus Get/GetAll) ---
	get IsStreaming(): boolean {
		return this.bridge.pool.isStreaming;
	}

	get CurrentModel(): string {
		return this.bridge.pool.currentModel;
	}

	get SessionName(): string {
		return this.bridge.pool.sessionName;
	}

	// --- Methods (called via D-Bus) ---
	async Ask(prompt: string): Promise<string> {
		return this.bridge.enqueueAsk(prompt);
	}

	async AskAsync(prompt: string): Promise<string> {
		return this.bridge.enqueueAskAsync(prompt);
	}

	async Steer(message: string): Promise<void> {
		this.bridge.enqueueSteer(message);
	}

	async FollowUp(message: string): Promise<void> {
		this.bridge.enqueueFollowUp(message);
	}

	async Abort(): Promise<void> {
		this.bridge.enqueueAbort();
	}

	// Fast path — bypasses queue, reads from any healthy worker
	async GetState(): Promise<string> {
		const state = await this.bridge.pool.getState();
		const result: DBusAgentState = {
			isStreaming: state.isStreaming,
			currentModel: state.model ? `${state.model.provider}/${state.model.id}` : "unknown",
			sessionName: state.sessionName ?? "",
			sessionId: state.sessionId,
			thinkingLevel: state.thinkingLevel,
			messageCount: state.messageCount,
		};
		return JSON.stringify(result);
	}

	// Fast path — broadcasts to all workers
	async SetModel(provider: string, model: string): Promise<void> {
		await this.bridge.pool.setModel(provider, model);
	}

	async RespondToUI(id: string, response: string): Promise<void> {
		this.bridge.pool.respondToUI(id, response);
	}

	// Fast path — no queue needed
	Ping(): string {
		return this.bridge.pool.ping();
	}

	async AskWithHints(prompt: string, hintsJson: string): Promise<string> {
		return this.bridge.enqueueAskWithHints(prompt, hintsJson);
	}

	async AskAs(persona: string, prompt: string): Promise<string> {
		return this.bridge.enqueueAskAs(persona, prompt);
	}

	AskAsAsync(persona: string, prompt: string): string {
		return this.bridge.enqueueAskAsAsync(persona, prompt);
	}

	// --- Signals (stubs — replaced by configureMembers) ---
	// Signal methods must RETURN their args; dbus-next uses the return value as signal data.
	// All signals now carry requestId as first argument for event correlation.
	MessageUpdate(requestId: string, text: string): string[] {
		return [requestId, text];
	}
	ToolExecution(requestId: string, name: string, args: string): string[] {
		return [requestId, name, args];
	}
	AgentEnd(requestId: string, response: string): string[] {
		return [requestId, response];
	}
	ExtensionUIRequest(requestId: string, id: string, method: string, title: string, options: string): string[] {
		return [requestId, id, method, title, options];
	}
	Ready(): void {}
	Error(requestId: string, message: string): string[] {
		return [requestId, message];
	}
}

// Configure all D-Bus members without decorators
AgentDBusInterface.configureMembers({
	properties: {
		IsStreaming: { signature: "b", access: ACCESS_READ },
		CurrentModel: { signature: "s", access: ACCESS_READ },
		SessionName: { signature: "s", access: ACCESS_READ },
	},
	methods: {
		Ask: { inSignature: "s", outSignature: "s" },
		AskAsync: { inSignature: "s", outSignature: "s" },
		Steer: { inSignature: "s" },
		FollowUp: { inSignature: "s" },
		Abort: {},
		GetState: { outSignature: "s" },
		SetModel: { inSignature: "ss" },
		RespondToUI: { inSignature: "ss" },
		Ping: { outSignature: "s" },
		AskWithHints: { inSignature: "ss", outSignature: "s" },
		AskAs: { inSignature: "ss", outSignature: "s" },
		AskAsAsync: { inSignature: "ss", outSignature: "s" },
	},
	signals: {
		MessageUpdate: { signature: "ss" },
		ToolExecution: { signature: "sss" },
		AgentEnd: { signature: "ss" },
		ExtensionUIRequest: { signature: "sssss" },
		Ready: { signature: "" },
		Error: { signature: "ss" },
	},
});

export class AgentDBusBridge {
	pool: WorkerPool;
	private bus: dbus.MessageBus | null = null;
	private iface: AgentDBusInterface | null = null;
	private options: BridgeOptions;

	constructor(options: BridgeOptions = {}, poolOptions?: BridgePoolOptions) {
		this.options = options;
		this.pool = new WorkerPool(options, (requestId, event) => this.handlePoolEvent(requestId, event), {
			minWorkers: poolOptions?.minWorkers,
			maxWorkers: poolOptions?.maxWorkers,
		});
	}

	async start(): Promise<void> {
		// Connect to session bus
		this.bus = dbus.sessionBus();

		// Request the bus name
		await this.bus.requestName(DBUS_BUS_NAME, 0);

		// Create and export the interface
		this.iface = new AgentDBusInterface(this);
		this.bus.export(DBUS_OBJECT_PATH, this.iface);

		// Start the worker pool
		await this.pool.start();

		// Emit Ready signal
		this.iface.Ready();

		console.log(`[embry-agent] D-Bus service registered: ${DBUS_BUS_NAME} (workers: ${this.pool.workerCount})`);
	}

	async stop(): Promise<void> {
		await this.pool.stop();
		if (this.bus) {
			this.bus.releaseName(DBUS_BUS_NAME);
			this.bus.disconnect();
			this.bus = null;
		}
		console.log("[embry-agent] Stopped");
	}

	// --- Request submission (all delegate to pool) ---

	enqueueAsk(prompt: string): Promise<string> {
		writeConversationTopic(prompt);
		return new Promise((resolve, reject) => {
			this.pool.submitRequest({
				id: this.pool.nextRequestId(),
				priority: RequestPriority.ASK,
				type: "ask",
				prompt,
				resolve,
				reject,
			});
		});
	}

	enqueueAskAsync(prompt: string): string {
		const requestId = this.pool.nextRequestId();
		this.pool.submitRequest({
			id: requestId,
			priority: RequestPriority.ASK,
			type: "askAsync",
			prompt,
		});
		return requestId;
	}

	enqueueSteer(message: string): void {
		this.pool.submitRequest({
			id: this.pool.nextRequestId(),
			priority: RequestPriority.STEER,
			type: "steer",
			prompt: message,
		});
	}

	enqueueFollowUp(message: string): void {
		this.pool.submitRequest({
			id: this.pool.nextRequestId(),
			priority: RequestPriority.FOLLOWUP,
			type: "followUp",
			prompt: message,
		});
	}

	enqueueAbort(): void {
		this.pool.submitRequest({
			id: this.pool.nextRequestId(),
			priority: RequestPriority.ABORT,
			type: "abort",
		});
	}

	enqueueAskWithHints(prompt: string, hintsJson: string): Promise<string> {
		let hints: RequestHints = {};
		try {
			hints = JSON.parse(hintsJson);
		} catch {
			// Invalid JSON — proceed without hints
		}
		writeConversationTopic(prompt, (hints as any).persona);
		return new Promise((resolve, reject) => {
			this.pool.submitRequest({
				id: this.pool.nextRequestId(),
				priority: RequestPriority.ASK,
				type: "askWithHints",
				prompt,
				hints,
				resolve,
				reject,
			});
		});
	}

	enqueueAskAs(persona: string, prompt: string): Promise<string> {
		writeConversationTopic(prompt, persona);
		return new Promise((resolve, reject) => {
			this.pool.submitRequest({
				id: this.pool.nextRequestId(),
				priority: RequestPriority.ASK,
				type: "askAs",
				prompt,
				persona,
				resolve,
				reject,
			});
		});
	}

	enqueueAskAsAsync(persona: string, prompt: string): string {
		writeConversationTopic(prompt, persona);
		const requestId = this.pool.nextRequestId();
		this.pool.submitRequest({
			id: requestId,
			priority: RequestPriority.ASK,
			type: "askAsAsync",
			prompt,
			persona,
		});
		return requestId;
	}

	// --- Event handling from pool ---

	private handlePoolEvent(requestId: string, event: AgentEvent | RpcExtensionUIRequest): void {
		if (!this.iface) return;

		switch (event.type) {
			case "message_update": {
				const ame = (event as any).assistantMessageEvent;
				if (ame?.type === "text_delta") {
					this.iface.MessageUpdate(requestId, ame.delta);
				}
				break;
			}

			case "tool_execution_start":
				this.iface.ToolExecution(requestId, (event as any).toolName, JSON.stringify((event as any).args));
				break;

			case "agent_end": {
				const text = extractTextFromMessages((event as any).messages);
				this.iface.AgentEnd(requestId, text);
				break;
			}

			case "extension_ui_request": {
				const uiEvent = event as RpcExtensionUIRequest;
				const title = "title" in uiEvent ? ((uiEvent as any).title ?? "") : "";
				const options =
					"options" in uiEvent
						? JSON.stringify((uiEvent as any).options)
						: "message" in uiEvent
							? (uiEvent as any).message
							: "";
				this.iface.ExtensionUIRequest(requestId, uiEvent.id, uiEvent.method, title, options);
				break;
			}
		}
	}
}
