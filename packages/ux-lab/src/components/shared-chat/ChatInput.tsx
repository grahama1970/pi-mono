/**
 * ChatInput — Shared chat input composer with skill palette integration.
 *
 * Used by: Embry Terminal, SPARTA ChatWell, Datalake ChatFAB, Binary Explorer.
 * Features: textarea with / skill palette trigger, send button, keyboard shortcuts.
 * COTS compliant: fonts ≥12px, touch ≥44px, data-qid on all elements.
 */
import { memo, useCallback, useRef, useState } from "react";
import { SkillPalette } from "./SkillPalette";
import type { Skill } from "./types";
import { useRegisterAction } from "../../hooks/useRegisterAction";

interface ChatInputProps {
	onSend: (message: string) => void;
	skills?: Skill[];
	placeholder?: string;
	disabled?: boolean;
	loading?: boolean;
	/** App identifier for QuerySpec */
	app?: string;
}

export const ChatInput = memo(function ChatInput({
	onSend,
	skills,
	placeholder = "Message agent… (/ for skills, ↑↓ for history)",
	disabled = false,
	loading = false,
	app = "shared-chat",
}: ChatInputProps) {
	const [input, setInput] = useState("");
	const [showPalette, setShowPalette] = useState(false);
	const [skillFilter, setSkillFilter] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const paletteKeyHandler = useRef<((e: React.KeyboardEvent) => boolean) | null>(null);

	useRegisterAction("chat:send", { app, action: "CHAT_SEND", label: "Send", description: "Send chat message" });
	useRegisterAction("chat:input", { app, action: "CHAT_FOCUS_INPUT", label: "Focus Input", description: "Focus the chat input field" });

	const handleSend = useCallback(() => {
		const text = input.trim();
		if (!text || disabled || loading) return;
		onSend(text);
		setInput("");
		setShowPalette(false);
	}, [input, onSend, disabled, loading]);

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
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}, [handleSend, showPalette]);

	return (
		<div data-qid="chat:composer" title="Chat input area" style={{ position: "relative" }}>
			{/* Skill Palette */}
			{showPalette && skills && skills.length > 0 && (
				<div style={{ position: "absolute", bottom: "100%", left: 0, right: 0, zIndex: 50 }}>
					<SkillPalette
						filter={skillFilter}
						skills={skills}
						onSelect={handleSkillSelect}
						onClose={() => setShowPalette(false)}
						onKeyNav={(handler) => { paletteKeyHandler.current = handler; }}
					/>
				</div>
			)}

			{/* Input row */}
			<div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
				<textarea
					ref={inputRef}
					data-qid="chat:input"
					data-qs-action="CHAT_FOCUS_INPUT"
					title="Type a message or /skill-name"
					aria-label="Chat message input"
					value={input}
					onChange={handleInputChange}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					disabled={disabled}
					rows={1}
					style={{
						flex: 1,
						background: "var(--embry-bg-deep, #0b1220)",
						border: "1px solid var(--embry-border, rgba(255,255,255,0.1))",
						borderRadius: 8,
						color: "var(--embry-white, #e2e8f0)",
						fontSize: "var(--font-size-body, 14px)",
						padding: "10px 14px",
						fontFamily: "var(--font-ui, sans-serif)",
						resize: "none",
						outline: "none",
						minHeight: 24,
						maxHeight: 120,
						lineHeight: 1.5,
					}}
				/>
				<button
					data-qid="chat:send"
					data-qs-action="CHAT_SEND"
					title="Send message (Enter)"
					aria-label="Send message"
					onClick={handleSend}
					disabled={!input.trim() || disabled || loading}
					style={{
						minWidth: "var(--touch-min, 44px)",
						minHeight: "var(--touch-min, 44px)",
						padding: "0 12px",
						borderRadius: 6,
						border: "none",
						background: input.trim() && !disabled ? "var(--embry-accent, #7c3aed)" : "var(--embry-bg-card, #27272a)",
						color: input.trim() && !disabled ? "white" : "var(--embry-dim, #94a3b8)",
						cursor: input.trim() && !disabled ? "pointer" : "default",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: 12,
						fontWeight: 600,
						transition: "all 0.15s",
						flexShrink: 0,
					}}
				>
					{loading ? "…" : "Send"}
				</button>
			</div>

			{/* Keyboard hints */}
			<div style={{
				display: "flex",
				justifyContent: "center",
				gap: 12,
				fontSize: "var(--font-size-sm, 12px)",
				color: "var(--embry-dim, #94a3b8)",
				marginTop: 6,
				fontFamily: "var(--font-mono, monospace)",
				flexWrap: "wrap",
			}}>
				<span>⏎ send</span>
				<span>/ skills</span>
				<span>↑↓ history</span>
				<span>Shift+⏎ newline</span>
			</div>
		</div>
	);
});
