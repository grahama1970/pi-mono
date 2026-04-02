/**
 * Datalake Explorer ChatFAB — Floating chat using shared-chat components.
 *
 * Composes: MarkdownRenderer, highlightEntities, SkillPalette, RecallCard, useCascadePipeline.
 * COTS compliant: fonts ≥12px, touch ≥44px, tooltips, contrast.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import {
	MarkdownRenderer,
	highlightEntities,
	SkillPalette,
	RecallCard,
	useCascadePipeline,
} from "../shared-chat";
import type { ChatMessage, Skill } from "../shared-chat";
import { useRegisterAction } from '../../hooks/useRegisterAction'

interface ChatFABProps {
	currentView: string;
	selectedDocId?: string;
	selectedSection?: string;
	backendUrl?: string;
}

const BACKEND = "/api";
const AUTH: Record<string, string> = {};

export default function ChatFAB({ currentView, selectedDocId, selectedSection, backendUrl }: ChatFABProps) {
  // QuerySpec action registrations (data-qid -> voice/NL/agent control)
  useRegisterAction('chat:close-chat', { app: 'datalake-explorer', action: 'CLOSE_CHAT', label: 'Close Chat', description: 'Close Chat in ChatFAB' })
  useRegisterAction('chat:input-row', { app: 'datalake-explorer', action: 'INPUT_ROW', label: 'Input Row', description: 'Input Row in ChatFAB' })
  useRegisterAction('chat:send-message', { app: 'datalake-explorer', action: 'SEND_MESSAGE', label: 'Send Message', description: 'Send Message in ChatFAB' })
  useRegisterAction('chat:el-3', { app: 'datalake-explorer', action: 'TOGGLE_FAB', label: 'Toggle chat', description: 'Toggle chat' })


	const [open, setOpen] = useState(false);
	const [input, setInput] = useState("");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [skills, setSkills] = useState<Skill[]>([]);
	const [showPalette, setShowPalette] = useState(false);
	const [skillFilter, setSkillFilter] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const drawerRef = useRef<HTMLDivElement>(null);
	const paletteKeyHandler = useRef<((e: React.KeyboardEvent) => boolean) | null>(null);

	const pipeline = useCascadePipeline({
		backendUrl: backendUrl || BACKEND,
		authHeaders: AUTH,
		project: "datalake",
		scope: currentView,
	});

	const contextParts: string[] = [];
	if (currentView) contextParts.push(`view=${currentView}`);
	if (selectedDocId) contextParts.push(`doc=${selectedDocId}`);
	if (selectedSection) contextParts.push(`section=${selectedSection}`);
	const contextStr = contextParts.join(", ");

	// Fetch skills once
	useEffect(() => {
		fetch(`${backendUrl || BACKEND}/skills`, { headers: AUTH })
			.then((r) => r.ok ? r.json() : [])
			.then((s) => setSkills(Array.isArray(s) ? s : []))
			.catch(() => {});
	}, [backendUrl]);

	// Keyboard: ? toggles, Esc closes
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "?" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) {
				e.preventDefault();
				setOpen((v) => !v);
			}
			if (e.key === "Escape" && open) setOpen(false);
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open]);

	useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
	useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "auto" }); }, [messages]);

	const sendMessage = useCallback(async () => {
		const text = input.trim();
		if (!text) return;
		setInput("");
		setShowPalette(false);

		const userMsg: ChatMessage = { id: `u${Date.now()}`, role: "user", content: text, timestamp: Date.now() };
		setMessages((prev) => [...prev, userMsg]);

		// ── QuerySpec resolver: try to resolve NL → action → DOM click before LLM ──
		if (!text.startsWith("/")) {
			try {
				const resolveRes = await fetch("/api/queryspec/resolve", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ text, app: "datalake-explorer" }),
				});
				if (resolveRes.ok) {
					const resolved = await resolveRes.json();
					if (resolved.resolved && resolved.confidence >= 0.25) {
						const el = document.querySelector(`[data-qs-action="${resolved.action}"]`) as HTMLElement;
						if (el) {
							el.click();
							el.scrollIntoView({ behavior: "smooth", block: "center" });
							setMessages((prev) => [...prev, {
								id: `a${Date.now()}`, role: "assistant", timestamp: Date.now(),
								content: `Executed **${resolved.label || resolved.action}** (${Math.round(resolved.confidence * 100)}% confidence, ${resolved.method})`,
							}]);
							// Store training pair
							fetch("/api/queryspec/learn", {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ text, action: resolved.action, dom_selector: resolved.dom_selector, confidence: resolved.confidence, app: "datalake-explorer", success: true }),
							}).catch(() => {});
							return;
						}
					} else if (resolved.candidates?.length > 0 && !resolved.resolved) {
						const labels = resolved.candidates.slice(0, 3).map((c: { label?: string; action: string }) => c.label || c.action).join(", ");
						setMessages((prev) => [...prev, {
							id: `a${Date.now()}`, role: "assistant", timestamp: Date.now(),
							content: `I'm not sure what you mean. Did you mean: **${labels}**?`,
						}]);
						return;
					}
				}
			} catch { /* resolver unavailable — fall through to LLM */ }
		}

		const skillMatch = text.match(/^\/([a-z][\w-]*)/);
		const result = await pipeline.send(text, { skill: skillMatch?.[1] });

		const agentMsg: ChatMessage = {
			id: `a${Date.now()}`,
			role: "assistant",
			content: result.content,
			timestamp: Date.now(),
			recall: result.recall,
			reasoningSteps: result.steps,
			skillUsed: skillMatch?.[1],
		};
		setMessages((prev) => [...prev, agentMsg]);
	}, [input, pipeline]);

	const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const val = e.target.value;
		setInput(val);
		const lastWord = val.split(/\s+/).pop() || "";
		if (lastWord.startsWith("/") && lastWord.length > 1) {
			setShowPalette(true);
			setSkillFilter(lastWord.slice(1));
		} else {
			setShowPalette(false);
		}
	}, []);

	const handleSkillSelect = useCallback((name: string) => {
		const words = input.split(/\s+/);
		words[words.length - 1] = `/${name} `;
		setInput(words.join(" "));
		setShowPalette(false);
		inputRef.current?.focus();
	}, [input]);

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (showPalette && paletteKeyHandler.current?.(e)) return;
		if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
	}, [sendMessage, showPalette]);

	return (
		<>
			{open && (
				<div ref={drawerRef} role="dialog" aria-modal="true" aria-label="Embry Agent chat" style={{
					position: "fixed", right: 0, bottom: 0, top: 0, width: 420,
					background: "#111114", borderLeft: "1px solid rgba(255,255,255,0.1)",
					display: "flex", flexDirection: "column", zIndex: 200,
				}}>
					{/* Header */}
					<div style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
						<span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>Embry Agent</span>
						<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
							{contextStr && <span style={{ fontSize: 12, color: "#94a3b8", background: "#1a1a1a", padding: "2px 8px", borderRadius: 4 }}>{contextStr}</span>}
							<button data-qid="chat:close-chat" data-qs-action="CHAT_CLOSE_CHAT" title="Close Chat" aria-label="Close chat" title="Close chat (Esc)" onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 18, padding: 8, minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>&times;</button>
						</div>
					</div>

					{/* Messages */}
					<div role="log" aria-label="Chat messages" style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
						{messages.length === 0 && (
							<div style={{ color: "#64748b", fontSize: 13, textAlign: "center", marginTop: 32 }}>
								Ask about {currentView || "the datalake"}
								<div style={{ fontSize: 12, marginTop: 8 }}>Type / for skills, ? to toggle</div>
							</div>
						)}
						{messages.map((msg) => {
							const isUser = msg.role === "user";


							return (
								<div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
									<div style={{
										maxWidth: "85%", padding: "10px 14px", borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
										background: isUser ? "rgba(74,158,255,0.06)" : "#18181b",
										border: `1px solid ${isUser ? "rgba(74,158,255,0.12)" : "rgba(255,255,255,0.06)"}`,
										fontSize: 14, lineHeight: 1.6, color: "#e2e8f0",
									}}>
										{isUser ? highlightEntities(msg.content) : <MarkdownRenderer content={msg.content} />}
									</div>
									{/* RecallCard for agent messages */}
									{!isUser && msg.recall && msg.recall.found && (
										<div style={{ maxWidth: "85%", marginTop: 4 }}>
											<RecallCard items={msg.recall.items} resultCount={msg.recall.items.length} confidence={msg.recall.confidence} />
										</div>
									)}
								</div>
							);
						})}
						<div ref={messagesEndRef} />
					</div>

					{/* Input */}
					<div style={{ flexShrink: 0, padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.08)", position: "relative" }}>
						{showPalette && skills.length > 0 && (
							<div style={{ position: "absolute", bottom: "100%", left: 16, right: 16 }}>
								<SkillPalette filter={skillFilter} skills={skills} onSelect={handleSkillSelect} onClose={() => setShowPalette(false)} onKeyNav={(handler) => { paletteKeyHandler.current = handler; }} />
							</div>
						)}
						<div data-qid="chat:input-row" data-qs-action="CHAT_INPUT_ROW" title="Chat Input Row" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
							<textarea
								ref={inputRef}
								data-qid="datalake-chat:input" data-qs-action="DATALAKE-CHAT_INPUT" title="Chat message input" aria-label="Chat message input"
								value={input}
								onChange={handleInputChange}
								onKeyDown={handleKeyDown}
								placeholder={`Message Embry Agent… (/ for skills)`}
								rows={2}
								style={{
									flex: 1, background: "#0b1220", border: "1px solid rgba(255,255,255,0.1)",
									borderRadius: 8, color: "#e2e8f0", fontSize: 14, padding: "10px 12px",
									fontFamily: "var(--font-ui)", resize: "none", outline: "none",
								}}
							/>
							<button data-qid="chat:send-message" data-qs-action="CHAT_SEND_MESSAGE" title="Send Message"
								aria-label="Send message"
								title="Send message (Enter)"
								onClick={sendMessage}
								disabled={!input.trim() || pipeline.isLoading}
								style={{
									width: 44, height: 44, borderRadius: 8, border: "none",
									background: input.trim() ? "#7c3aed" : "#27272a",
									color: input.trim() ? "white" : "#64748b",
									cursor: input.trim() ? "pointer" : "default",
									display: "flex", alignItems: "center", justifyContent: "center",
									fontSize: 14, fontWeight: 700,
								}}
							>↑</button>
						</div>
						<div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
							Enter to send · Shift+Enter for newline · Esc to close · ? to toggle
						</div>
					</div>
				</div>
			)}

			{/* FAB button */}
			<button data-qid="chat:el-3" data-qs-action="CHAT_TOGGLE_FAB" title="Toggle chat"
				aria-label={open ? "Close Embry Agent" : "Open Embry Agent (press ? to toggle)"}
				aria-expanded={open}
				title={open ? "Close Embry Agent" : "Open Embry Agent chat"}
				onClick={() => setOpen((v) => !v)}
				style={{
					position: "fixed", bottom: 44, right: 20,
					width: 48, height: 48, borderRadius: 24,
					background: open ? "#ff4444" : "#7c3aed",
					border: "none", display: "flex", alignItems: "center", justifyContent: "center",
					cursor: "pointer", zIndex: 201, boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
				}}
			>
				<svg viewBox="0 0 24 24" width={22} height={22} fill="white">
					{open
						? <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
						: <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
					}
				</svg>
			</button>
		</>
	);
}
