/**
 * Lean4LemmaView — Lean4 proof graph explorer.
 *
 * Architecture: Shares ALL core components with Binary Explorer and SPARTA Lemma:
 * - GraphExplorer (D3 engine) via LemmaGraph wrapper (proof status, sorry contamination)
 * - LeftPane (theorem browser sidebar)
 * - shared-chat (MarkdownRenderer, ChatMessage types, SuggestionCard)
 * - EmbryStyle, ContextMenu, InvestigationJournal
 *
 * Data: lean4_proofs + proof_requirement_edges from ArangoDB.
 */
import { useState, useRef, useCallback } from "react";
import { EMBRY, card, heading, label, glowDot } from "../common/EmbryStyle";
import {
	LeftPane,
	LeftPaneSection,
	paneItemStyle,
	useLeftPaneSearch,
} from "../common/LeftPane";
import { LemmaGraph } from "../sparta/lemma-graph/LemmaGraph";
import type { GraphNode } from "../sparta/lemma-graph/LemmaGraph";
import { ProofDetail } from "./ProofDetail";
import { useLean4Data } from "./useLean4Data";
import type { ChatMessage } from "../shared-chat";

const API = "http://localhost:3001";

export function Lean4LemmaView() {
	const data = useLean4Data();
	const [selectedProofKey, setSelectedProofKey] = useState<string | null>(null);
	const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
	const [chatInput, setChatInput] = useState("");
	const [chatLoading, setChatLoading] = useState(false);
	const [detailTab, setDetailTab] = useState<"proof" | "chat">("proof");
	const chatScrollRef = useRef<HTMLDivElement>(null);

	// LeftPane search
	const { query: lpQuery, setQuery: setLpQuery, matches: lpMatches } =
		useLeftPaneSearch(
			data.proofs.map((p) => ({
				id: p._key,
				label: p.theorem_name,
				searchText: `${p.theorem_name} ${p.problem_description ?? ""} ${(p.tactics ?? []).join(" ")}`,
			})),
		);

	const selectedProof = data.proofs.find((p) => p._key === selectedProofKey) ?? null;

	// Graph node click → select proof
	const handleNodeClick = useCallback(
		(node: GraphNode) => {
			const proof = data.proofs.find(
				(p) => p._id === node.id || p._key === node.id.split("/").pop(),
			);
			if (proof) {
				setSelectedProofKey(proof._key);
				setDetailTab("proof");
			}
		},
		[data.proofs],
	);

	// Chat submit
	const handleChatSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			if (!chatInput.trim() || chatLoading) return;

			const userMsg: ChatMessage = { role: "user", content: chatInput };
			setChatMessages((prev) => [...prev, userMsg]);
			setChatInput("");
			setChatLoading(true);

			try {
				const context = selectedProof
					? `Theorem: ${selectedProof.theorem_name}\nTactics: ${(selectedProof.tactics ?? []).join(", ")}\nCode:\n${selectedProof.lean_code?.slice(0, 500)}`
					: `Lean4 proof library: ${data.stats.totalProofs} proofs, ${data.stats.compiledCount} compiled, ${data.stats.sorryCount} sorry`;

				const res = await fetch(
					"http://localhost:4001/v1/chat/completions",
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: "Bearer sk-dev-proxy-123",
						},
						body: JSON.stringify({
							model: "text",
							messages: [
								{
									role: "system",
									content: `You are a Lean4 proof assistant. Help the user understand formal proofs, tactics, and theorem structures. Be concise.\n\nContext:\n${context}`,
								},
								...chatMessages.slice(-6).map((m) => ({
									role: m.role,
									content: m.content,
								})),
								{ role: "user", content: chatInput },
							],
							temperature: 0.3,
							max_tokens: 600,
						}),
					},
				);
				const json = await res.json();
				const reply =
					json.choices?.[0]?.message?.content ?? "No response";
				setChatMessages((prev) => [
					...prev,
					{ role: "assistant", content: reply },
				]);
			} catch (err) {
				setChatMessages((prev) => [
					...prev,
					{
						role: "assistant",
						content: `Error: ${String(err)}`,
					},
				]);
			} finally {
				setChatLoading(false);
				setTimeout(() => chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" }), 100);
			}
		},
		[chatInput, chatLoading, chatMessages, selectedProof, data.stats],
	);

	// Suggested queries
	const suggestedQueries = selectedProof
		? [
				`Explain the tactics used in ${selectedProof.theorem_name}`,
				`What does ${(selectedProof.tactics ?? [])[0] ?? "ring_nf"} do in Lean4?`,
				`How could this proof be simplified?`,
				`What Mathlib lemmas does this depend on?`,
			]
		: [
				`What proof tactics are most common in this library?`,
				`How many proofs use sorry? What are they missing?`,
				`Explain the proof structure of a typical theorem`,
				`What is the difference between axiom and sorry?`,
			];

	if (data.loading) {
		return (
			<div style={{ padding: 40, color: EMBRY.muted, fontSize: 12 }}>
				Loading Lean4 proofs from ArangoDB...
			</div>
		);
	}

	if (data.error) {
		return (
			<div style={{ padding: 40, color: EMBRY.red, fontSize: 12 }}>
				Error: {data.error}
			</div>
		);
	}

	return (
		<div
			style={{
				display: "flex",
				height: "100%",
				background: EMBRY.bgDeep,
				color: EMBRY.white,
				fontFamily: "JetBrains Mono, monospace",
			}}
		>
			{/* Left Pane — Theorem browser */}
			<LeftPane
				search={lpQuery}
				onSearchChange={setLpQuery}
				searchPlaceholder="Filter theorems..."
			>
				<LeftPaneSection title={`Proofs (${data.proofs.length})`} defaultOpen>
					{(lpMatches.length > 0 ? lpMatches : data.proofs)
						.slice(0, 100)
						.map((p) => {
							const proof = "theorem_name" in p ? p : data.proofs.find((pr) => pr._key === p.id);
							if (!proof || !("theorem_name" in proof)) return null;
							const isSelected = proof._key === selectedProofKey;
							const hasSorry = proof.lean_code?.includes("sorry");
							return (
								<div
									key={proof._key}
									onClick={() => {
										setSelectedProofKey(proof._key);
										setDetailTab("proof");
									}}
									style={{
										...paneItemStyle,
										background: isSelected
											? `${EMBRY.accent}15`
											: "transparent",
										borderLeft: isSelected
											? `2px solid ${EMBRY.accent}`
											: "2px solid transparent",
									}}
								>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: 6,
										}}
									>
										<div
											style={glowDot(
												hasSorry ? EMBRY.red : EMBRY.green,
												5,
											)}
										/>
										<span
											style={{
												fontSize: 10,
												color: isSelected
													? EMBRY.white
													: EMBRY.dim,
											}}
										>
											{proof.theorem_name.length > 25
												? `${proof.theorem_name.slice(0, 23)}…`
												: proof.theorem_name}
										</span>
									</div>
								</div>
							);
						})}
				</LeftPaneSection>
				<LeftPaneSection title="Stats">
					<div style={{ padding: "4px 8px", fontSize: 9 }}>
						<div style={{ color: EMBRY.dim }}>
							{data.stats.totalProofs} proofs · {data.stats.totalEdges} edges
						</div>
						<div style={{ color: EMBRY.green, marginTop: 2 }}>
							{data.stats.compiledCount} compiled
						</div>
						{data.stats.sorryCount > 0 && (
							<div style={{ color: EMBRY.red, marginTop: 2 }}>
								{data.stats.sorryCount} sorry
							</div>
						)}
					</div>
				</LeftPaneSection>
			</LeftPane>

			{/* Main content */}
			<div
				style={{
					flex: 1,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}
			>
				{/* Graph */}
				<div style={{ flex: "1 1 50%", minHeight: 200 }}>
					<LemmaGraph
						nodes={data.graphNodes}
						edges={data.graphEdges}
						onNodeClick={handleNodeClick}
					/>
				</div>

				{/* Detail/Chat tabs */}
				<div
					style={{
						flex: "1 1 50%",
						borderTop: `1px solid ${EMBRY.border}`,
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
					}}
				>
					{/* Tab bar */}
					<div
						style={{
							display: "flex",
							borderBottom: `1px solid ${EMBRY.border}`,
							fontSize: 10,
						}}
					>
						{(["proof", "chat"] as const).map((tab) => (
							<button
								key={tab}
								onClick={() => setDetailTab(tab)}
								style={{
									padding: "6px 16px",
									cursor: "pointer",
									border: "none",
									borderBottom:
										detailTab === tab
											? `2px solid ${EMBRY.accent}`
											: "2px solid transparent",
									background: "transparent",
									color:
										detailTab === tab
											? EMBRY.white
											: EMBRY.dim,
									fontWeight: detailTab === tab ? 700 : 400,
									fontFamily: "JetBrains Mono, monospace",
									textTransform: "uppercase",
								}}
							>
								{tab === "proof" ? "Proof Detail" : "Chat"}
							</button>
						))}
					</div>

					{/* Tab content */}
					<div style={{ flex: 1, overflow: "auto" }}>
						{detailTab === "proof" && (
							<ProofDetail
								proof={selectedProof}
								onTacticClick={(t) => {
									setChatInput(`What does the ${t} tactic do in Lean4?`);
									setDetailTab("chat");
								}}
							/>
						)}

						{detailTab === "chat" && (
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									height: "100%",
								}}
							>
								{/* Messages */}
								<div
									ref={chatScrollRef}
									style={{
										flex: 1,
										overflow: "auto",
										padding: 10,
									}}
								>
									{chatMessages.length === 0 && (
										<div style={{ padding: 10 }}>
											<div
												style={{
													fontSize: 8,
													color: EMBRY.dim,
													fontWeight: 800,
													marginBottom: 6,
												}}
											>
												SUGGESTED QUERIES{" "}
												<span
													style={{
														fontWeight: 400,
														opacity: 0.6,
													}}
												>
													— click to ask
												</span>
											</div>
											{suggestedQueries.map((q, i) => (
												<div
													key={i}
													role="button"
													tabIndex={0}
													onClick={() => {
														setChatInput(q);
														setTimeout(() => {
															const form =
																document.querySelector(
																	"#lean4-chat-input",
																)
																	?.closest(
																		"form",
																	);
															if (form)
																form.dispatchEvent(
																	new Event(
																		"submit",
																		{
																			bubbles: true,
																			cancelable: true,
																		},
																	),
																);
														}, 100);
													}}
													onKeyDown={(e) => {
														if (e.key === "Enter")
															e.currentTarget.click();
													}}
													style={{
														fontSize: 10,
														color: EMBRY.accent,
														padding: "5px 10px",
														background: `${EMBRY.accent}08`,
														border: `1px solid ${EMBRY.accent}22`,
														borderRadius: 4,
														cursor: "pointer",
														marginBottom: 4,
													}}
												>
													<span
														style={{
															marginRight: 4,
															fontSize: 12,
														}}
													>
														→
													</span>
													{q}
												</div>
											))}
										</div>
									)}
									{chatMessages.map((m, i) => (
										<div
											key={i}
											style={{
												marginBottom: 10,
												padding: "6px 10px",
												borderRadius: 6,
												background:
													m.role === "user"
														? `${EMBRY.accent}10`
														: "#0a0a0a",
												border: `1px solid ${m.role === "user" ? `${EMBRY.accent}22` : EMBRY.border}`,
												fontSize: 11,
												lineHeight: 1.6,
												whiteSpace: "pre-wrap",
											}}
										>
											<div
												style={{
													fontSize: 8,
													color: EMBRY.dim,
													marginBottom: 4,
													fontWeight: 700,
												}}
											>
												{m.role === "user"
													? "YOU"
													: "LEAN4 ASSISTANT"}
											</div>
											{m.content}
										</div>
									))}
									{chatLoading && (
										<div
											style={{
												fontSize: 10,
												color: EMBRY.accent,
												padding: 6,
											}}
										>
											Analyzing...
										</div>
									)}
								</div>

								{/* Input */}
								<form
									onSubmit={handleChatSubmit}
									style={{
										padding: "6px 10px",
										borderTop: `1px solid ${EMBRY.border}`,
										display: "flex",
										gap: 6,
									}}
								>
									<input
										id="lean4-chat-input"
										value={chatInput}
										onChange={(e) =>
											setChatInput(e.target.value)
										}
										placeholder="Ask about proofs, tactics, theorems..."
										style={{
											flex: 1,
											background: "#0a0a0a",
											border: `1px solid ${EMBRY.border}`,
											borderRadius: 4,
											padding: "5px 8px",
											color: EMBRY.white,
											fontSize: 10,
											fontFamily:
												"JetBrains Mono, monospace",
											outline: "none",
										}}
									/>
									<button
										type="submit"
										disabled={chatLoading}
										style={{
											padding: "5px 12px",
											background: EMBRY.accent,
											border: "none",
											borderRadius: 4,
											color: "#000",
											fontSize: 10,
											fontWeight: 700,
											cursor: chatLoading
												? "wait"
												: "pointer",
										}}
									>
										Ask
									</button>
								</form>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
