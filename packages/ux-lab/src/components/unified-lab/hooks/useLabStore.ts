import { useCallback, useState } from "react";

export type TabId =
	| "classification"
	| "rationale"
	| "convergence"
	| "regression"
	| "cascade"
	| "annotations"
	| "sweeps"
	| "model-health";

export type AgentMode = "agent-driving" | "human-override" | "paused";

export interface TrainingMetrics {
	epoch: number;
	loss: number;
	f1: number;
	accuracy: number;
}

export function useLabStore() {
	const [activeTab, setActiveTab] = useState<TabId>("rationale");
	const [agentMode, setAgentMode] = useState<AgentMode>("agent-driving");
	const [metrics, setMetrics] = useState<TrainingMetrics>({
		epoch: 5,
		loss: 0.31,
		f1: 0.87,
		accuracy: 0.91,
	});

	const updateMetrics = useCallback((partial: Partial<TrainingMetrics>) => {
		setMetrics((prev) => ({ ...prev, ...partial }));
	}, []);

	return {
		activeTab,
		setActiveTab,
		agentMode,
		setAgentMode,
		metrics,
		updateMetrics,
	};
}
