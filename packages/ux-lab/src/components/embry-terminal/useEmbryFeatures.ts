/**
 * useEmbryFeatures — Custom hooks for Embry Terminal enhanced features.
 * Separated from main component to avoid linter conflicts.
 *
 * Features:
 * - Command history (↑/↓ arrow keys)
 * - Health monitoring (Express/Memory/scillm status)
 * - Session export (Markdown/HTML/PDF)
 * - Keyboard shortcuts (Ctrl+K for skill palette)
 */
import { useCallback, useEffect, useState } from "react";

// ── Command History ─────────────────────────────────────────────────────

export function useCommandHistory(maxItems = 50) {
	const [history, setHistory] = useState<string[]>([]);
	const [idx, setIdx] = useState(-1);

	const push = useCallback(
		(cmd: string) => {
			setHistory((prev) => [cmd, ...prev].slice(0, maxItems));
			setIdx(-1);
		},
		[maxItems],
	);

	const up = useCallback(
		(currentInput: string): string | null => {
			if (currentInput !== "" && idx < 0) return null; // only browse when empty or already browsing
			const newIdx = Math.min(idx + 1, history.length - 1);
			setIdx(newIdx);
			return history[newIdx] ?? null;
		},
		[history, idx],
	);

	const down = useCallback((): string | null => {
		if (idx < 0) return null;
		const newIdx = idx - 1;
		setIdx(newIdx);
		return newIdx >= 0 ? history[newIdx] : "";
	}, [history, idx]);

	return { push, up, down, history, idx };
}

// ── Health Monitoring ───────────────────────────────────────────────────

export interface HealthStatus {
	expressUp: boolean;
	memoryUp: boolean;
	scillmUp: boolean;
	latencyMs: number | null;
}

export function useHealthMonitor(backendUrl: string, authHeaders: HeadersInit) {
	const [health, setHealth] = useState<HealthStatus>({
		expressUp: false,
		memoryUp: false,
		scillmUp: false,
		latencyMs: null,
	});

	useEffect(() => {
		const t0 = Date.now();

		// Express backend
		fetch(`${backendUrl}/health`, { headers: authHeaders })
			.then((r) => {
				if (r.ok) setHealth((h) => ({ ...h, expressUp: true, latencyMs: Date.now() - t0 }));
			})
			.catch(() => {});

		// Memory daemon (via Express proxy)
		fetch(`${backendUrl}/agent/recall`, {
			method: "POST",
			headers: { ...Object.fromEntries(new Headers(authHeaders).entries()), "Content-Type": "application/json" },
			body: JSON.stringify({ query: "health-check", project: "_" }),
		})
			.then((r) => r.ok && setHealth((h) => ({ ...h, memoryUp: true })))
			.catch(() => {});

		// scillm (via Express health — avoids CORS)
		fetch(`${backendUrl}/health`, { headers: authHeaders })
			.then((r) => r.json())
			.then((d) => {
				if (d.status === "ok") setHealth((h) => ({ ...h, scillmUp: true }));
			})
			.catch(() => {});
	}, [backendUrl, authHeaders]);

	return health;
}

// ── Session Export ──────────────────────────────────────────────────────

interface ExportMessage {
	role: string;
	content: string;
	agent?: string;
	skillUsed?: string;
	recall?: { confidence: number; items: { problem?: string }[] };
}

export function exportSession(
	messages: ExportMessage[],
	format: "markdown" | "html" | "pdf",
	projectName: string,
	agentName: string,
) {
	const header = [
		`# Embry Terminal Session`,
		``,
		`- **Project:** ${projectName}`,
		`- **Agent:** ${agentName}`,
		`- **Date:** ${new Date().toISOString()}`,
		`- **Audit:** \`/memory recall "session:${Date.now()}"\` for full evidence trail`,
		`- **Queries:** ${messages.filter((m) => m.role === "user").length}`,
		``,
		`---`,
		``,
	].join("\n");

	const body = messages
		.map((m) => {
			let block = m.role === "user" ? `**User:** ${m.content}` : `**Agent (${m.agent || "claude"}):**\n${m.content}`;
			if (m.recall) {
				const confPct =
					m.recall.confidence > 1
						? Math.min(Math.round(m.recall.confidence), 100)
						: Math.round(m.recall.confidence * 100);
				block += `\n\n> Memory recall: ${confPct}% confidence, ${m.recall.items.length} results`;
			}
			if (m.skillUsed) block += `\n\n> Skill: /${m.skillUsed}`;
			return block;
		})
		.join("\n\n---\n\n");

	const content = header + body;

	if (format === "markdown") {
		download(content, `embry-session-${Date.now()}.md`, "text/markdown");
	} else if (format === "html") {
		const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Embry Session</title>
<style>body{background:#141414;color:#e2e8f0;font-family:system-ui;max-width:800px;margin:0 auto;padding:40px;line-height:1.7;font-size:16px}
h1{color:#00ff88;font-size:22px}hr{border:none;border-top:1px solid #333;margin:24px 0}
code{background:#0b1220;padding:2px 6px;border-radius:4px;color:#4a9eff;font-size:14px}
blockquote{border-left:3px solid #4a9eff;padding-left:12px;color:#94a3b8;margin:8px 0}
strong{color:#f8fafc}</style>
</head><body><pre style="white-space:pre-wrap;font-family:system-ui">${content.replace(/</g, "&lt;")}</pre></body></html>`;
		download(html, `embry-session-${Date.now()}.html`, "text/html");
	} else {
		// PDF: open print dialog
		const win = window.open("", "_blank");
		if (win) {
			win.document.write(`<html><head><title>Embry Session</title>
<style>body{font-family:system-ui;max-width:700px;margin:0 auto;padding:40px;line-height:1.6;font-size:12px}
h1{font-size:18px}hr{border:none;border-top:1px solid #ccc;margin:16px 0}
code{background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:11px}
blockquote{border-left:2px solid #666;padding-left:8px;color:#666;margin:4px 0}</style>
</head><body><pre style="white-space:pre-wrap;font-family:system-ui">${content.replace(/</g, "&lt;")}</pre></body></html>`);
			win.document.close();
			win.print();
		}
	}
}

function download(content: string, filename: string, mimeType: string) {
	const blob = new Blob([content], { type: mimeType });
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = filename;
	a.click();
	URL.revokeObjectURL(a.href);
}
