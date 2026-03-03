/**
 * Single Pi RPC child lifecycle manager.
 *
 * Each Worker owns one `pi --mode rpc` child process and tracks its state,
 * tags events with the active requestId for correlation, and implements
 * a circuit breaker to stop routing to a repeatedly-failing child.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { RpcClient, type RpcClientOptions } from "../modes/rpc/rpc-client.js";
import type { RpcExtensionUIRequest } from "../modes/rpc/rpc-types.js";
import { extractTextFromMessages } from "./bridge.js";
import { type BridgeOptions, type PooledRequest, type SessionPersistence, WorkerState } from "./types.js";

const SESSION_STATE_DIR = path.join(os.homedir(), ".pi", "state", "dbus-sessions");

export type WorkerEventCallback = (
	workerId: number,
	requestId: string,
	event: AgentEvent | RpcExtensionUIRequest,
) => void;
export type WorkerStateChangeCallback = (workerId: number, state: WorkerState) => void;
export type WorkerRequestDoneCallback = (workerId: number, request: PooledRequest) => void;

export interface WorkerOptions {
	id: number;
	bridgeOptions: BridgeOptions;
	onEvent: WorkerEventCallback;
	onStateChange: WorkerStateChangeCallback;
	onRequestDone: WorkerRequestDoneCallback;
	circuitBreakerThreshold: number;
}

export class Worker {
	readonly id: number;
	state: WorkerState = WorkerState.STARTING;
	personaAffinity: string | null = null;
	activeRequestId: string | null = null;
	lastActiveAt: number = Date.now();

	private rpcClient: RpcClient;
	private bridgeOptions: BridgeOptions;
	private onEvent: WorkerEventCallback;
	private onStateChange: WorkerStateChangeCallback;
	private onRequestDone: WorkerRequestDoneCallback;
	private consecutiveFailures = 0;
	private circuitBreakerThreshold: number;
	private destroyed = false;
	private restartAttempts = 0;
	private maxRestartDelay = 30000;
	private lastResponseText = "";

	constructor(options: WorkerOptions) {
		this.id = options.id;
		this.bridgeOptions = options.bridgeOptions;
		this.onEvent = options.onEvent;
		this.onStateChange = options.onStateChange;
		this.onRequestDone = options.onRequestDone;
		this.circuitBreakerThreshold = options.circuitBreakerThreshold;

		this.rpcClient = this.createRpcClient();
	}

	get isHealthy(): boolean {
		return this.consecutiveFailures < this.circuitBreakerThreshold && this.state !== WorkerState.CRASHED;
	}

	get isAvailable(): boolean {
		return this.state === WorkerState.IDLE && this.isHealthy;
	}

	get sessionFile(): string {
		return path.join(SESSION_STATE_DIR, `worker_${this.id}.json`);
	}

	async start(): Promise<void> {
		this.rpcClient.onEvent((event: AgentEvent | RpcExtensionUIRequest) => {
			this.handleRpcEvent(event);
		});

		await this.rpcClient.start();

		const proc = (this.rpcClient as any).process;
		if (proc) {
			proc.on("exit", (code: number | null) => {
				if (!this.destroyed) {
					const stderr = this.rpcClient.getStderr();
					console.error(`[worker-${this.id}] Pi process exited with code ${code}. Stderr: ${stderr.slice(-500)}`);
					this.consecutiveFailures++;
					if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
						this.setState(WorkerState.CRASHED);
						this.personaAffinity = null;
						console.error(
							`[worker-${this.id}] Circuit breaker tripped after ${this.consecutiveFailures} consecutive failures`,
						);
					} else {
						this.scheduleRestart();
					}
				}
			});
		}

		// Refresh initial state
		try {
			await this.rpcClient.getState();
		} catch {
			// State fetch might fail during init
		}

		this.restartAttempts = 0;
		this.consecutiveFailures = 0;
		this.setState(WorkerState.IDLE);
	}

	async stop(): Promise<void> {
		this.destroyed = true;
		this.persistSession();
		await this.rpcClient.stop();
		console.log(`[worker-${this.id}] Stopped`);
	}

	async executeRequest(request: PooledRequest): Promise<void> {
		this.setState(WorkerState.BUSY);
		this.activeRequestId = request.id;
		this.lastActiveAt = Date.now();
		this.lastResponseText = "";

		// Set persona affinity if this is a persona request
		if (request.persona) {
			this.personaAffinity = request.persona;
		}

		try {
			switch (request.type) {
				case "abort":
					await this.rpcClient.abort();
					break;

				case "steer":
					await this.rpcClient.steer(request.prompt!);
					break;

				case "followUp":
					await this.rpcClient.followUp(request.prompt!);
					break;

				case "ask": {
					const response = await this.doAsk(request.prompt!);
					request.resolve?.(response);
					break;
				}

				case "askAsync":
					await this.rpcClient.prompt(request.prompt!);
					// Completion will be signaled via agent_end event
					return; // Don't mark idle yet — wait for agent_end

				case "askWithHints": {
					if (request.hints?.provider && request.hints?.model) {
						await this.rpcClient.setModel(request.hints.provider, request.hints.model);
					} else if (request.hints?.model) {
						const parts = request.hints.model.split("/");
						if (parts.length === 2) {
							await this.rpcClient.setModel(parts[0], parts[1]);
						}
					}
					if (request.hints?.thinking) {
						await this.rpcClient.setThinkingLevel(request.hints.thinking as any);
					}
					const response = await this.doAsk(request.prompt!);
					request.resolve?.(response);
					break;
				}

				case "askAs": {
					const personaPrompt = this.wrapWithPersona(request.persona!, request.prompt!);
					const response = await this.doAsk(personaPrompt);
					request.resolve?.(response);
					break;
				}

				case "askAsAsync": {
					const asyncPersonaPrompt = this.wrapWithPersona(request.persona!, request.prompt!);
					await this.rpcClient.prompt(asyncPersonaPrompt);
					// Completion will be signaled via agent_end event
					return; // Don't mark idle yet — wait for agent_end
				}
			}

			this.consecutiveFailures = 0;
			this.setState(WorkerState.IDLE);
			this.onRequestDone(this.id, request);
		} catch (err) {
			this.consecutiveFailures++;
			request.reject?.(err);
			if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
				this.setState(WorkerState.CRASHED);
				this.personaAffinity = null;
			} else {
				this.setState(WorkerState.IDLE);
			}
			this.onRequestDone(this.id, request);
		}
	}

	/** Direct access for read-only operations that bypass the queue. */
	async getState(): Promise<any> {
		return this.rpcClient.getState();
	}

	/** Broadcast model change to this worker. */
	async setModel(provider: string, model: string): Promise<void> {
		await this.rpcClient.setModel(provider, model);
	}

	/** Send UI response through this worker's RPC client. */
	respondToUI(id: string, response: string): void {
		const proc = (this.rpcClient as any).process;
		if (proc?.stdin) {
			const rpcResponse = { type: "extension_ui_response" as const, id, value: response };
			proc.stdin.write(`${JSON.stringify(rpcResponse)}\n`);
		}
	}

	/** Attempt to restart a crashed worker after backoff. */
	async respawn(): Promise<void> {
		if (this.state !== WorkerState.CRASHED) return;
		this.destroyed = false;
		this.consecutiveFailures = 0;
		this.rpcClient = this.createRpcClient();
		await this.start();
	}

	// --- Private ---

	private createRpcClient(): RpcClient {
		const rpcOptions: RpcClientOptions = {
			cwd: this.bridgeOptions.cwd,
			provider: this.bridgeOptions.provider,
			model: this.bridgeOptions.model,
			cliPath: this.bridgeOptions.cliPath,
			env: { PI_STDIN_TIMEOUT_MS: "0" },
		};

		// D-Bus workers run lean: no skills (220+ tool definitions bloat the
		// prompt), no extensions (memory-first forces a recall subprocess on
		// every prompt — 30s+ overhead even for "2+2"). Persona context comes
		// from AGENTS.md wrapping, not from Pi's extension system.
		const baseArgs = ["--no-skills", "--no-extensions"];

		// Resume from persisted session if available
		const sessionArgs = this.loadPersistedSession();
		if (sessionArgs.length > 0) {
			rpcOptions.args = [...baseArgs, ...sessionArgs];
		} else {
			rpcOptions.args = baseArgs;
		}

		// CLI --session override takes precedence (only for worker 0)
		if (this.id === 0 && this.bridgeOptions.sessionFile) {
			rpcOptions.args = [...baseArgs, "--session", this.bridgeOptions.sessionFile];
		}

		return new RpcClient(rpcOptions);
	}

	private setState(state: WorkerState): void {
		this.state = state;
		this.onStateChange(this.id, state);
	}

	private async doAsk(prompt: string): Promise<string> {
		this.lastResponseText = "";
		const events = await this.rpcClient.promptAndWait(prompt, undefined, 300000);
		const endEvent = events.find((e) => e.type === "agent_end");
		if (endEvent?.type === "agent_end") {
			return extractTextFromMessages(endEvent.messages);
		}
		return this.lastResponseText;
	}

	private wrapWithPersona(personaName: string, prompt: string): string {
		const agentsMd = this.resolvePersonaAgentsMd(personaName);
		if (!agentsMd) {
			return `[Persona: ${personaName}]\n\n${prompt}`;
		}
		return `<persona-context name="${personaName}">\n${agentsMd}\n</persona-context>\n\n${prompt}`;
	}

	private resolvePersonaAgentsMd(personaName: string): string | null {
		let currentDir = this.bridgeOptions.cwd ?? process.cwd();
		while (true) {
			const candidate = path.join(currentDir, ".pi", "agents", personaName, "AGENTS.md");
			if (fs.existsSync(candidate)) {
				return fs.readFileSync(candidate, "utf-8");
			}
			const parentDir = path.dirname(currentDir);
			if (parentDir === currentDir) return null;
			currentDir = parentDir;
		}
	}

	private handleRpcEvent(event: AgentEvent | RpcExtensionUIRequest): void {
		const requestId = this.activeRequestId ?? "";

		// Track streaming text for doAsk fallback
		if (event.type === "message_update") {
			const ame = (event as any).assistantMessageEvent;
			if (ame?.type === "text_delta") {
				this.lastResponseText += ame.delta;
			}
		}

		// For async requests, agent_end means the request is done
		if (event.type === "agent_end") {
			this.persistSession();
			this.consecutiveFailures = 0;
			this.activeRequestId = null;
			this.setState(WorkerState.IDLE);
			// Find and notify about async request completion
			// (sync requests handle this in executeRequest)
		}

		this.onEvent(this.id, requestId, event);
	}

	private persistSession(): void {
		try {
			const state = (this.rpcClient as any).sessionState;
			if (!state?.sessionFile) return;

			fs.mkdirSync(SESSION_STATE_DIR, { recursive: true });

			const persistence: SessionPersistence = {
				sessionFile: state.sessionFile,
				model: "",
				provider: this.bridgeOptions.provider ?? "",
				timestamp: new Date().toISOString(),
			};

			fs.writeFileSync(this.sessionFile, JSON.stringify(persistence, null, 2));
		} catch (err) {
			console.error(`[worker-${this.id}] Failed to persist session: ${err}`);
		}
	}

	private loadPersistedSession(): string[] {
		try {
			if (!fs.existsSync(this.sessionFile)) return [];
			const raw = fs.readFileSync(this.sessionFile, "utf-8");
			const persistence: SessionPersistence = JSON.parse(raw);
			if (!persistence.sessionFile) return [];
			if (!fs.existsSync(persistence.sessionFile)) {
				console.log(`[worker-${this.id}] Persisted session file gone, starting fresh`);
				return [];
			}
			console.log(`[worker-${this.id}] Resuming session: ${persistence.sessionFile}`);
			return ["--session", persistence.sessionFile];
		} catch {
			return [];
		}
	}

	private scheduleRestart(): void {
		if (this.destroyed) return;
		this.persistSession();

		const delay = Math.min(1000 * 2 ** this.restartAttempts, this.maxRestartDelay);
		this.restartAttempts++;

		console.log(`[worker-${this.id}] Restarting in ${delay}ms (attempt ${this.restartAttempts})`);

		setTimeout(async () => {
			if (this.destroyed) return;
			try {
				this.rpcClient = this.createRpcClient();
				await this.start();
				console.log(`[worker-${this.id}] Restarted successfully`);
			} catch (err) {
				console.error(`[worker-${this.id}] Restart failed: ${err}`);
				this.consecutiveFailures++;
				if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
					this.setState(WorkerState.CRASHED);
					this.personaAffinity = null;
				} else {
					this.scheduleRestart();
				}
			}
		}, delay);
	}
}
