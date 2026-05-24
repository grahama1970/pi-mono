/**
 * useMemoryHealth — Monitors memory daemon health with adaptive polling.
 *
 * - Polls every 30s when healthy
 * - Polls every 5s when OFFLINE or DEGRADED (faster recovery detection)
 * - Tracks connection restoration for auto-reload
 * - Provides manual retry function
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "../lib/apiBase";

export type HealthStatus = "NOMINAL" | "DEGRADED" | "OFFLINE";

interface HealthState {
	status: HealthStatus;
	details: string;
	lastCheck: number;
	wasOffline: boolean; // true if we just recovered from OFFLINE
}

const API = apiUrl("/memory/health");
const HEALTHY_INTERVAL_MS = 30_000;
const UNHEALTHY_INTERVAL_MS = 5_000;

export function useMemoryHealth() {
	const [state, setState] = useState<HealthState>({
		status: "NOMINAL",
		details: "Checking...",
		lastCheck: 0,
		wasOffline: false,
	});

	const prevStatusRef = useRef<HealthStatus>("NOMINAL");

	const checkHealth = useCallback(async () => {
		try {
			const res = await fetch(API, {
				method: "GET",
				signal: AbortSignal.timeout(5000), // 5s timeout
			});

			if (!res.ok) {
				const wasOffline = prevStatusRef.current === "OFFLINE";
				prevStatusRef.current = "DEGRADED";
				setState({
					status: "DEGRADED",
					details: `API returned ${res.status}`,
					lastCheck: Date.now(),
					wasOffline,
				});
				return;
			}

			const data = await res.json();

			if (data.status === "ok" && data.memory_db_connected) {
				const wasOffline = prevStatusRef.current === "OFFLINE" || prevStatusRef.current === "DEGRADED";
				prevStatusRef.current = "NOMINAL";
				setState({
					status: "NOMINAL",
					details: "Memory daemon connected",
					lastCheck: Date.now(),
					wasOffline: wasOffline && prevStatusRef.current !== "NOMINAL",
				});
			} else {
				const wasOffline = prevStatusRef.current === "OFFLINE";
				prevStatusRef.current = "DEGRADED";
				setState({
					status: "DEGRADED",
					details: data.error || "Memory daemon degraded",
					lastCheck: Date.now(),
					wasOffline,
				});
			}
		} catch (err) {
			const wasOffline = prevStatusRef.current === "OFFLINE";
			prevStatusRef.current = "OFFLINE";
			setState({
				status: "OFFLINE",
				details: err instanceof Error ? err.message : "Connection failed",
				lastCheck: Date.now(),
				wasOffline,
			});
		}
	}, []);

	// Adaptive polling: faster when unhealthy
	useEffect(() => {
		checkHealth(); // Initial check

		const interval = state.status === "NOMINAL" ? HEALTHY_INTERVAL_MS : UNHEALTHY_INTERVAL_MS;
		const timer = setInterval(checkHealth, interval);

		return () => clearInterval(timer);
	}, [checkHealth, state.status]);

	// Clear wasOffline flag after consumer has had a chance to react
	useEffect(() => {
		if (state.wasOffline && state.status === "NOMINAL") {
			const timer = setTimeout(() => {
				setState((prev) => ({ ...prev, wasOffline: false }));
			}, 1000);
			return () => clearTimeout(timer);
		}
	}, [state.wasOffline, state.status]);

	return {
		...state,
		retry: checkHealth,
		isHealthy: state.status === "NOMINAL",
	};
}
