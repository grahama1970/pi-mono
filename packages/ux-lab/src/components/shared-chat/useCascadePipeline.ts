/**
 * useCascadePipeline — Shared hook for recall → intent → LLM agent pipeline.
 *
 * Used by: Embry Terminal, SPARTA Explorer, Datalake Explorer, Binary Explorer, ChatFab.
 * Each project provides its own backendUrl and scope; the pipeline is the same.
 */
import { useCallback, useRef, useState } from "react";
import type { ReasoningStep, RecallResult } from "./types";

export interface CascadeConfig {
	/** Base URL for the agent API (e.g., http://127.0.0.1:8640/api or /api) */
	backendUrl: string;
	/** Auth headers (e.g., { Authorization: 'Bearer token' }) */
	authHeaders: Record<string, string>;
	/** Project name for scoped recall */
	project?: string;
	/** Memory scope for recall */
	scope?: string;
	/** Number of recall results */
	recallK?: number;
}

export interface CascadeResult {
	content: string;
	recall?: RecallResult;
	grounded: boolean;
	backend?: string;
	model?: string;
	steps: ReasoningStep[];
}

export interface CascadePipeline {
	send: (message: string, options?: { skill?: string; model?: string }) => Promise<CascadeResult>;
	isLoading: boolean;
	error: string | null;
}

export function useCascadePipeline(config: CascadeConfig): CascadePipeline {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const send = useCallback(
		async (message: string, options?: { skill?: string; model?: string }): Promise<CascadeResult> => {
			// Abort previous request
			abortRef.current?.abort();
			const ctrl = new AbortController();
			abortRef.current = ctrl;

			setIsLoading(true);
			setError(null);

			const steps: ReasoningStep[] = [];
			let recall: RecallResult | undefined;

			try {
				// Step 1: Memory recall
				const recallStep: ReasoningStep = {
					id: `recall-${Date.now()}`,
					type: "recall",
					skill: "memory",
					status: "running",
					summary: "Searching memory...",
				};
				steps.push(recallStep);

				try {
					const recallRes = await fetch(`${config.backendUrl}/memory/recall`, {
						method: "POST",
						headers: { ...config.authHeaders, "Content-Type": "application/json" },
						body: JSON.stringify({
							query: message,
							scope: config.scope || config.project || "",
							k: config.recallK || 5,
						}),
						signal: ctrl.signal,
					});

					if (recallRes.ok) {
						const raw = await recallRes.json();
						if (raw.found && raw.items?.length > 0) {
							recall = {
								found: true,
								confidence: raw.confidence || 0,
								items: raw.items.slice(0, 5),
							};
							recallStep.status = "done";
							recallStep.summary = `Recalled ${raw.items.length} results (conf ${Math.round((raw.confidence || 0) * 100)}%)`;
							recallStep.confidence = raw.confidence;
							recallStep.duration = Date.now() - Number.parseInt(recallStep.id.split("-")[1], 10);
						} else {
							recallStep.status = "done";
							recallStep.summary = "No relevant memory found";
						}
					} else {
						recallStep.status = "failed";
						recallStep.summary = "Memory service unavailable";
					}
				} catch {
					recallStep.status = "done";
					recallStep.summary = "Memory unavailable — proceeding without context";
				}

				// Step 2: Agent call (scillm or skill)
				const agentStep: ReasoningStep = {
					id: `agent-${Date.now()}`,
					type: "skill",
					skill: options?.skill || "scillm",
					status: "running",
					summary: options?.skill ? `Running /${options.skill}...` : "Generating response...",
				};
				steps.push(agentStep);

				const agentRes = await fetch(`${config.backendUrl}/agent/message`, {
					method: "POST",
					headers: { ...config.authHeaders, "Content-Type": "application/json" },
					body: JSON.stringify({
						message,
						backend: options?.skill ? "skill" : "scillm",
						skill: options?.skill,
						model: options?.model || "text",
						project: config.project,
					}),
					signal: ctrl.signal,
				});

				if (!agentRes.ok) {
					const err = await agentRes.json().catch(() => ({ error: "Agent unavailable" }));
					throw new Error(err.error || `Agent returned ${agentRes.status}`);
				}

				const agentData = await agentRes.json();
				agentStep.status = "done";
				agentStep.summary = `Response generated (${agentData.backend || "scillm"})`;
				agentStep.duration = Date.now() - Number.parseInt(agentStep.id.split("-")[1], 10);

				setIsLoading(false);
				return {
					content: agentData.content || "",
					recall,
					grounded: !!agentData.grounded,
					backend: agentData.backend,
					model: agentData.model,
					steps,
				};
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : "Pipeline failed";
				if (msg !== "The user aborted a request.") {
					setError(msg);
				}
				setIsLoading(false);
				return { content: `Error: ${msg}`, recall, grounded: false, steps };
			}
		},
		[config.backendUrl, config.authHeaders, config.project, config.scope, config.recallK],
	);

	return { send, isLoading, error };
}
