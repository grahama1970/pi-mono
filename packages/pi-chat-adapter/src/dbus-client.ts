/**
 * D-Bus client for org.embry.Agent — consumes signals, emits structured events.
 *
 * This is a CLIENT of the embry-agent daemon. No Pi internals are modified.
 * It connects to the session bus, calls AskAsync, and listens for signals.
 */
import dbus from "dbus-next";

const BUS_NAME = "org.embry.Agent";
const OBJ_PATH = "/org/embry/Agent";
const IFACE_NAME = "org.embry.Agent";

export interface PiEvent {
	type: "message_update" | "tool_execution" | "agent_end" | "error";
	requestId: string;
	/** For message_update: streaming text delta */
	text?: string;
	/** For tool_execution: tool name */
	tool?: string;
	/** For tool_execution: JSON-stringified args */
	args?: string;
	/** For agent_end: final text response */
	response?: string;
	/** For error: error message */
	message?: string;
}

export type PiEventHandler = (event: PiEvent) => void;

/**
 * Persistent D-Bus client connection to embry-agent.
 * Maintains a single bus connection and dispatches signals by requestId.
 */
export class PiDbusClient {
	private bus: dbus.MessageBus | null = null;
	private iface: dbus.ClientInterface | null = null;
	private listeners = new Map<string, PiEventHandler[]>();
	private globalListeners: PiEventHandler[] = [];

	async connect(): Promise<void> {
		this.bus = dbus.sessionBus();
		const proxy = await this.bus.getProxyObject(BUS_NAME, OBJ_PATH);
		this.iface = proxy.getInterface(IFACE_NAME);

		// Wire up signal handlers
		this.iface.on("MessageUpdate", (requestId: string, text: string) => {
			this.dispatch({ type: "message_update", requestId, text });
		});

		this.iface.on("ToolExecution", (requestId: string, tool: string, args: string) => {
			this.dispatch({ type: "tool_execution", requestId, tool, args });
		});

		this.iface.on("AgentEnd", (requestId: string, response: string) => {
			this.dispatch({ type: "agent_end", requestId, response });
			// Clean up per-request listeners
			this.listeners.delete(requestId);
		});

		this.iface.on("Error", (requestId: string, message: string) => {
			this.dispatch({ type: "error", requestId, message });
			this.listeners.delete(requestId);
		});
	}

	disconnect(): void {
		if (this.bus) {
			this.bus.disconnect();
			this.bus = null;
			this.iface = null;
		}
		this.listeners.clear();
		this.globalListeners = [];
	}

	/** Call AskAsync — returns requestId for signal correlation */
	async askAsync(prompt: string): Promise<string> {
		if (!this.iface) throw new Error("Not connected");
		return await this.iface.AskAsync(prompt);
	}

	/** Call AskAs — ask as a specific persona */
	async askAs(persona: string, prompt: string): Promise<string> {
		if (!this.iface) throw new Error("Not connected");
		return await this.iface.AskAs(persona, prompt);
	}

	/** Call AskWithHints — prompt with model/thinking hints */
	async askWithHints(prompt: string, hints: Record<string, unknown>): Promise<string> {
		if (!this.iface) throw new Error("Not connected");
		return await this.iface.AskWithHints(prompt, JSON.stringify(hints));
	}

	/** Health check */
	async ping(): Promise<string> {
		if (!this.iface) throw new Error("Not connected");
		return await this.iface.Ping();
	}

	/** Get agent state */
	async getState(): Promise<Record<string, unknown>> {
		if (!this.iface) throw new Error("Not connected");
		const raw = await this.iface.GetState();
		return JSON.parse(raw as string);
	}

	/** Subscribe to events for a specific requestId */
	onRequest(requestId: string, handler: PiEventHandler): void {
		const handlers = this.listeners.get(requestId) ?? [];
		handlers.push(handler);
		this.listeners.set(requestId, handlers);
	}

	/** Subscribe to all events (for logging/debugging) */
	onAll(handler: PiEventHandler): void {
		this.globalListeners.push(handler);
	}

	private dispatch(event: PiEvent): void {
		// Per-request handlers
		const handlers = this.listeners.get(event.requestId);
		if (handlers) {
			for (const h of handlers) h(event);
		}
		// Global handlers
		for (const h of this.globalListeners) h(event);
	}
}
