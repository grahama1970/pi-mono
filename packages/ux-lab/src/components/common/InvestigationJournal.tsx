/**
 * InvestigationJournal — records every user interaction as a timestamped step.
 *
 * Timeline view with replay, delete, inline notes, and markdown/JSON export.
 * Rendered as a collapsible panel in the right pane of BinaryExplorerView.
 *
 * All actions are logged automatically with ISO-8601 timestamps. Manual notes
 * can be attached to any step. Exports support both human writeups (Markdown)
 * and machine-readable JSON for agentic pipeline training.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
	MousePointerClick,
	Expand,
	MessageSquare,
	Eye,
	LayoutGrid,
	Trash2,
	ChevronDown,
	ChevronRight,
	Play,
	StickyNote,
	Download,
	X,
	Eraser,
	FileText,
	Camera,
	Search,
	Lightbulb,
	Braces,
} from "lucide-react";
import { EMBRY, panel, label, heading } from "./EmbryStyle";

/* ────────────────────────── Types ────────────────────────── */

export type StepActionType =
	| "node_click"
	| "expand"
	| "chat"
	| "perspective_change"
	| "layout_change"
	| "scene_clear"
	| "query"
	| "finding";

export interface Step {
	/** ISO-8601 timestamp */
	timestamp: string;
	/** Discriminated action type */
	action: StepActionType;
	/** Human-readable description of the step */
	description: string;
	/** Optional user annotation */
	note?: string;
	/** Serialised scene snapshot for replay (opaque to this component) */
	snapshot?: unknown;
	/** Base-64 data URL of the graph screenshot at this step (for writeup embed) */
	screenshotUrl?: string;
}

export interface InvestigationJournalProps {
	steps: Step[];
	onReplay: (stepIndex: number) => void;
	onDelete: (stepIndex: number) => void;
	onAddNote: (stepIndex: number, note: string) => void;
	/** CTF challenge name — used as the writeup title and export filename */
	challengeTitle?: string;
	/** Called when the user edits the challenge title inline */
	onChallengeTitleChange?: (title: string) => void;
}

/* ────────────────────────── Icon map ────────────────────────── */

const ACTION_META: Record<
	StepActionType,
	{ icon: typeof MousePointerClick; color: string; label: string }
> = {
	node_click: { icon: MousePointerClick, color: EMBRY.blue, label: "Click" },
	expand: { icon: Expand, color: EMBRY.green, label: "Expand" },
	chat: { icon: MessageSquare, color: EMBRY.accent, label: "Chat" },
	perspective_change: { icon: Eye, color: EMBRY.amber, label: "Perspective" },
	layout_change: { icon: LayoutGrid, color: EMBRY.white, label: "Layout" },
	scene_clear: { icon: Eraser, color: EMBRY.red, label: "Clear" },
	query: { icon: Search, color: "#7dd3fc", label: "Query" },
	finding: { icon: Lightbulb, color: "#86efac", label: "Finding" },
};

/* ────────────────────────── Helpers ────────────────────────── */

function formatTime(iso: string): string {
	try {
		const d = new Date(iso);
		return d.toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	} catch {
		return iso;
	}
}

function exportMarkdown(steps: Step[]): string {
	const lines: string[] = [
		"# Investigation Journal",
		"",
		`Exported: ${new Date().toISOString()}`,
		"",
		"| # | Time | Action | Description | Note |",
		"|---|------|--------|-------------|------|",
	];
	steps.forEach((s, i) => {
		const meta = ACTION_META[s.action];
		const note = s.note ? s.note.replace(/\|/g, "\\|") : "";
		const desc = s.description.replace(/\|/g, "\\|");
		lines.push(
			`| ${i + 1} | ${formatTime(s.timestamp)} | ${meta.label} | ${desc} | ${note} |`,
		);
	});
	return lines.join("\n");
}

function exportWriteup(steps: Step[], challengeTitle = "CTF Challenge"): string {
	const lines: string[] = [
		`# ${challengeTitle} — Writeup`,
		"",
		`*Generated: ${new Date().toISOString()}*`,
		"",
		"## Overview",
		"",
		"> Replace this section with a brief challenge description.",
		"",
		"## Analysis",
		"",
	];
	steps.forEach((s, i) => {
		const meta = ACTION_META[s.action];
		lines.push(`### Step ${i + 1} — ${meta.label}`);
		lines.push("");
		lines.push(`**Time:** ${formatTime(s.timestamp)}`);
		lines.push("");
		lines.push(s.description);
		if (s.screenshotUrl) {
			lines.push("");
			lines.push(`![Step ${i + 1} graph screenshot](${s.screenshotUrl})`);
		} else if (s.snapshot) {
			lines.push("");
			lines.push("*Graph state captured (no screenshot)*");
		}
		if (s.note) {
			lines.push("");
			lines.push(`> **Note:** ${s.note}`);
		}
		lines.push("");
	});
	lines.push("## Conclusion", "", "> Replace with your findings and flag.");
	return lines.join("\n");
}

/** JSON export for agentic pipeline training — one record per step. */
function exportJson(steps: Step[], challengeTitle: string): string {
	return JSON.stringify(
		{
			challenge: challengeTitle || null,
			exported: new Date().toISOString(),
			steps: steps.map((s, i) => ({
				index: i + 1,
				timestamp: s.timestamp,
				action: s.action,
				description: s.description,
				note: s.note ?? null,
				hasSnapshot: s.snapshot !== undefined,
				screenshotUrl: s.screenshotUrl ?? null,
			})),
		},
		null,
		2,
	);
}

function downloadBlob(content: string, filename: string, mime = "text/markdown") {
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

/* ────────────────────────── Styles ────────────────────────── */

const MONO = "JetBrains Mono, Consolas, monospace";

const styles = {
	wrapper: {
		...panel,
		display: "flex",
		flexDirection: "column" as const,
		gap: 8,
		maxHeight: 480,
		overflow: "hidden",
	},
	header: {
		display: "flex",
		alignItems: "center" as const,
		justifyContent: "space-between" as const,
		cursor: "pointer",
		userSelect: "none" as const,
	},
	headerLeft: {
		display: "flex",
		alignItems: "center" as const,
		gap: 6,
	},
	toolbar: {
		display: "flex",
		alignItems: "center" as const,
		gap: 4,
	},
	iconBtn: {
		background: "none",
		border: "none",
		cursor: "pointer",
		padding: 4,
		borderRadius: 4,
		color: EMBRY.dim,
		display: "flex",
		alignItems: "center" as const,
		justifyContent: "center" as const,
	} satisfies React.CSSProperties,
	timeline: {
		flex: 1,
		overflowY: "auto" as const,
		display: "flex",
		flexDirection: "column" as const,
		gap: 2,
		paddingRight: 4,
	},
	stepRow: {
		display: "flex",
		alignItems: "flex-start" as const,
		gap: 8,
		padding: "6px 8px",
		borderRadius: 8,
		border: `1px solid transparent`,
		transition: "background 0.15s, border-color 0.15s",
		cursor: "default",
	} satisfies React.CSSProperties,
	stepRowHover: {
		backgroundColor: "rgba(255,255,255,0.04)",
		borderColor: EMBRY.border,
	},
	railDot: (color: string) =>
		({
			width: 10,
			height: 10,
			borderRadius: "50%",
			backgroundColor: color,
			boxShadow: `0 0 6px ${color}66`,
			flexShrink: 0,
			marginTop: 3,
		}) satisfies React.CSSProperties,
	stepBody: {
		flex: 1,
		minWidth: 0,
	},
	stepMeta: {
		display: "flex",
		alignItems: "center" as const,
		gap: 6,
		marginBottom: 2,
	},
	timestamp: {
		fontFamily: MONO,
		fontSize: 10,
		color: EMBRY.dim,
		flexShrink: 0,
	},
	actionLabel: {
		...label,
		fontSize: 9,
		margin: 0,
	},
	description: {
		fontSize: 11,
		color: EMBRY.white,
		lineHeight: 1.5,
		overflowWrap: "break-word" as const,
		whiteSpace: "normal" as const,
	},
	note: {
		fontSize: 11,
		color: EMBRY.amber,
		fontStyle: "italic" as const,
		marginTop: 2,
	},
	noteInput: {
		width: "100%",
		fontSize: 11,
		fontFamily: MONO,
		padding: "3px 6px",
		borderRadius: 4,
		border: `1px solid ${EMBRY.border}`,
		backgroundColor: EMBRY.bgDeep,
		color: EMBRY.white,
		outline: "none",
		marginTop: 4,
		resize: "vertical",
		minHeight: 52,
	} satisfies React.CSSProperties,
	snapshotBadge: {
		fontFamily: MONO,
		fontSize: 9,
		color: EMBRY.blue,
		display: "flex",
		alignItems: "center" as const,
		gap: 2,
		marginTop: 2,
	},
	actions: {
		display: "flex",
		alignItems: "center" as const,
		gap: 2,
		flexShrink: 0,
		marginLeft: 4,
	},
	empty: {
		fontSize: 12,
		color: EMBRY.muted,
		textAlign: "center" as const,
		padding: 24,
	},
	badge: {
		fontFamily: MONO,
		fontSize: 10,
		color: EMBRY.dim,
		backgroundColor: "rgba(255,255,255,0.06)",
		borderRadius: 6,
		padding: "1px 6px",
		marginLeft: 6,
	},
};

/* ────────────────────────── Component ────────────────────────── */

export function InvestigationJournal({
	steps,
	onReplay,
	onDelete,
	onAddNote,
	challengeTitle = "",
	onChallengeTitleChange,
}: InvestigationJournalProps) {
	const [collapsed, setCollapsed] = useState(false);
	const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
	const [editingIdx, setEditingIdx] = useState<number | null>(null);
	const [noteText, setNoteText] = useState("");
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState(challengeTitle);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const titleInputRef = useRef<HTMLInputElement>(null);
	const timelineRef = useRef<HTMLDivElement>(null);

	/* Auto-scroll to latest step */
	useEffect(() => {
		if (timelineRef.current && steps.length > 0) {
			timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
		}
	}, [steps.length]);

	/* Focus input when editing starts */
	useEffect(() => {
		if (editingIdx !== null) {
			inputRef.current?.focus();
		}
	}, [editingIdx]);

	/* Focus title input */
	useEffect(() => {
		if (editingTitle) {
			titleInputRef.current?.focus();
			titleInputRef.current?.select();
		}
	}, [editingTitle]);

	const handleSaveTitle = useCallback(() => {
		setEditingTitle(false);
		onChallengeTitleChange?.(titleDraft.trim());
	}, [titleDraft, onChallengeTitleChange]);

	const handleStartNote = useCallback(
		(idx: number) => {
			setEditingIdx(idx);
			setNoteText(steps[idx]?.note ?? "");
		},
		[steps],
	);

	const handleSaveNote = useCallback(() => {
		if (editingIdx !== null) {
			onAddNote(editingIdx, noteText.trim());
			setEditingIdx(null);
			setNoteText("");
		}
	}, [editingIdx, noteText, onAddNote]);

	const handleCancelNote = useCallback(() => {
		setEditingIdx(null);
		setNoteText("");
	}, []);

	const handleExport = useCallback(() => {
		const md = exportMarkdown(steps);
		const ts = new Date().toISOString().slice(0, 10);
		downloadBlob(md, `investigation-journal-${ts}.md`);
	}, [steps]);

	const handleExportWriteup = useCallback(() => {
		const title = challengeTitle.trim() || "CTF Challenge";
		const md = exportWriteup(steps, title);
		const slug = title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
		const ts = new Date().toISOString().slice(0, 10);
		downloadBlob(md, `${slug || "ctf-writeup"}-${ts}.md`);
	}, [steps, challengeTitle]);

	const handleExportJson = useCallback(() => {
		const json = exportJson(steps, challengeTitle);
		const ts = new Date().toISOString().slice(0, 10);
		downloadBlob(json, `investigation-journal-${ts}.json`, "application/json");
	}, [steps, challengeTitle]);

	const Chevron = collapsed ? ChevronRight : ChevronDown;

	return (
		<div style={styles.wrapper}>
			{/* ── Header ── */}
			<div
				style={styles.header}
				onClick={() => setCollapsed((c) => !c)}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") setCollapsed((c) => !c);
				}}
			>
				<div style={styles.headerLeft}>
					<Chevron size={14} color={EMBRY.dim} />
					<span style={heading}>Investigation Journal</span>
					<span style={styles.badge}>{steps.length}</span>
				</div>

				{!collapsed && onChallengeTitleChange && (
					<div
						style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, marginLeft: 8 }}
						onClick={(e) => e.stopPropagation()}
					>
						{editingTitle ? (
							<input
								ref={titleInputRef}
								value={titleDraft}
								onChange={(e) => setTitleDraft(e.target.value)}
								onBlur={handleSaveTitle}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleSaveTitle();
									if (e.key === "Escape") { setEditingTitle(false); setTitleDraft(challengeTitle); }
								}}
								placeholder="Challenge name…"
								style={{
									fontSize: 11,
									fontFamily: MONO,
									background: EMBRY.bgDeep,
									border: `1px solid ${EMBRY.border}`,
									borderRadius: 4,
									color: EMBRY.white,
									padding: "2px 6px",
									outline: "none",
									width: 160,
								}}
							/>
						) : (
							<span
								title="Click to set challenge title for writeup"
								onClick={() => setEditingTitle(true)}
								style={{ fontSize: 11, color: challengeTitle ? EMBRY.amber : EMBRY.muted, cursor: "text", fontStyle: challengeTitle ? "normal" : "italic" }}
							>
								{challengeTitle || "set challenge title…"}
							</span>
						)}
					</div>
				)}

				{!collapsed && (
					<div
						style={styles.toolbar}
						onClick={(e) => e.stopPropagation()}
						role="toolbar"
					>
						<button
							id="be-journal-export-writeup"
							style={{ ...styles.iconBtn, display: 'flex', alignItems: 'center', gap: 3 }}
							title="Export as CTF Writeup (Markdown)"
							onClick={handleExportWriteup}
							disabled={steps.length === 0}
						>
							<FileText size={11} color={EMBRY.amber} />
							<span style={{ fontSize: 8, color: EMBRY.amber, fontWeight: 600 }}>WRITEUP</span>
						</button>
						<button
							id="be-journal-export-md"
							style={{ ...styles.iconBtn, display: 'flex', alignItems: 'center', gap: 3 }}
							title="Export raw journal (Markdown table)"
							onClick={handleExport}
							disabled={steps.length === 0}
						>
							<Download size={11} />
							<span style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 600 }}>MD</span>
						</button>
						<button
							id="be-journal-export-json"
							style={{ ...styles.iconBtn, display: 'flex', alignItems: 'center', gap: 3 }}
							title="Export as JSON (agentic pipeline / training data)"
							onClick={handleExportJson}
							disabled={steps.length === 0}
						>
							<Braces size={11} color="#7dd3fc" />
							<span style={{ fontSize: 8, color: '#7dd3fc', fontWeight: 600 }}>JSON</span>
						</button>
					</div>
				)}
			</div>

			{/* ── Timeline ── */}
			{!collapsed && (
				<div style={styles.timeline} ref={timelineRef}>
					{steps.length === 0 && (
						<div style={styles.empty}>
							All actions are logged automatically with timestamps.
							Interact with the graph to begin — clicks, queries, and findings
							are recorded. Add manual notes to any step for your writeup.
						</div>
					)}

					{steps.map((step, idx) => {
						const meta = ACTION_META[step.action];
						const Icon = meta.icon;
						const isHovered = hoveredIdx === idx;
						const isEditing = editingIdx === idx;

						return (
							<div
								key={`${step.timestamp}-${idx}`}
								style={{
									...styles.stepRow,
									...(isHovered ? styles.stepRowHover : {}),
								}}
								onMouseEnter={() => setHoveredIdx(idx)}
								onMouseLeave={() => setHoveredIdx(null)}
							>
								{/* Rail dot */}
								<div style={styles.railDot(meta.color)} />

								{/* Body */}
								<div style={styles.stepBody}>
									<div style={styles.stepMeta}>
										<Icon size={11} color={meta.color} />
										<span
											style={{
												...styles.actionLabel,
												color: meta.color,
											}}
										>
											{meta.label}
										</span>
										<span style={styles.timestamp}>
											{formatTime(step.timestamp)}
										</span>
									</div>
									<div style={styles.description}>
										{step.description}
									</div>

									{/* Snapshot indicator */}
									{step.snapshot && (
										<div style={styles.snapshotBadge}>
											<Camera size={9} color={EMBRY.blue} />
											snapshot captured
										</div>
									)}

									{/* Note display */}
									{step.note && !isEditing && (
										<div style={styles.note}>{step.note}</div>
									)}

									{/* Note input */}
									{isEditing && (
										<div
											style={{
												display: "flex",
												flexDirection: "column",
												gap: 4,
												marginTop: 4,
											}}
										>
											<textarea
												ref={inputRef}
												style={styles.noteInput}
												value={noteText}
												rows={3}
												onChange={(e) =>
													setNoteText(e.target.value)
												}
												onKeyDown={(e) => {
													if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
														handleSaveNote();
													if (e.key === "Escape")
														handleCancelNote();
												}}
												placeholder="Add a manual note (Ctrl+Enter to save)..."
											/>
											<div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
												<button
													style={{ ...styles.iconBtn, fontSize: 10, color: EMBRY.green }}
													onClick={handleSaveNote}
													title="Save note"
												>
													Save
												</button>
												<button
													style={styles.iconBtn}
													onClick={handleCancelNote}
													title="Cancel"
												>
													<X size={12} />
												</button>
											</div>
										</div>
									)}
								</div>

								{/* Actions (visible on hover) */}
								{isHovered && !isEditing && (
									<div style={styles.actions}>
										<button
											style={styles.iconBtn}
											title="Replay to this step"
											onClick={() => onReplay(idx)}
										>
											<Play
												size={12}
												color={EMBRY.green}
											/>
										</button>
										<button
											style={styles.iconBtn}
											title="Add note"
											onClick={() =>
												handleStartNote(idx)
											}
										>
											<StickyNote
												size={12}
												color={EMBRY.amber}
											/>
										</button>
										<button
											style={styles.iconBtn}
											title="Delete step"
											onClick={() => onDelete(idx)}
										>
											<Trash2
												size={12}
												color={EMBRY.red}
											/>
										</button>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

export default InvestigationJournal;
