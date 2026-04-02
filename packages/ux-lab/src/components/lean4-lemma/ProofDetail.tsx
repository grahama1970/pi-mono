/**
 * ProofDetail — Lean4 proof code viewer with tactics, imports, and compilation status.
 * Uses shared-chat MarkdownRenderer for syntax-highlighted Lean4 code.
 */
import { EMBRY, card, heading, label, glowDot } from "../common/EmbryStyle";
import type { Lean4Proof } from "./useLean4Data";

interface ProofDetailProps {
	proof: Lean4Proof | null;
	onTacticClick?: (tactic: string) => void;
}

export function ProofDetail({ proof, onTacticClick }: ProofDetailProps) {
	if (!proof) {
		return (
			<div style={{ padding: 16, color: EMBRY.muted, fontSize: 11, fontStyle: "italic" }}>
				Select a proof node to view Lean4 code
			</div>
		);
	}

	const hasSorry = proof.lean_code?.includes("sorry") ?? false;
	const statusColor = hasSorry ? EMBRY.red : EMBRY.green;
	const statusLabel = hasSorry ? "SORRY (incomplete)" : "COMPILED";

	return (
		<div style={{ ...card, padding: 0, overflow: "hidden" }}>
			{/* Header */}
			<div
				style={{
					padding: "10px 14px",
					borderBottom: `1px solid ${EMBRY.border}`,
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
				}}
			>
				<div>
					<div style={heading}>{proof.theorem_name}</div>
					<div style={{ ...label, marginTop: 2 }}>
						{proof.needs_mathlib ? "Mathlib" : "Lean4"}
						{proof.imports?.length > 0 && ` · imports: ${proof.imports.join(", ")}`}
					</div>
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						fontSize: 10,
						fontWeight: 700,
						color: statusColor,
					}}
				>
					<div style={glowDot(statusColor, 6)} />
					{statusLabel}
				</div>
			</div>

			{/* Problem description */}
			{proof.problem_description && (
				<div
					style={{
						padding: "8px 14px",
						borderBottom: `1px solid ${EMBRY.border}`,
						fontSize: 11,
						color: EMBRY.white,
						lineHeight: 1.5,
						opacity: 0.8,
					}}
				>
					{proof.problem_description.length > 200
						? `${proof.problem_description.slice(0, 200)}…`
						: proof.problem_description}
				</div>
			)}

			{/* Tactics */}
			{proof.tactics?.length > 0 && (
				<div
					style={{
						padding: "8px 14px",
						borderBottom: `1px solid ${EMBRY.border}`,
						display: "flex",
						flexWrap: "wrap",
						gap: 4,
						alignItems: "center",
					}}
				>
					<span
						style={{
							fontSize: 8,
							fontWeight: 700,
							color: EMBRY.dim,
							textTransform: "uppercase",
							marginRight: 4,
						}}
					>
						Tactics:
					</span>
					{proof.tactics.map((t) => (
						<code
							key={t}
							onClick={() => onTacticClick?.(t)}
							style={{
								fontSize: 9,
								padding: "1px 5px",
								background: "#0d0d1a",
								border: `1px solid #9C27B033`,
								color: "#ce93d8",
								borderRadius: 3,
								fontFamily: "JetBrains Mono, monospace",
								cursor: onTacticClick ? "pointer" : "default",
							}}
						>
							{t}
						</code>
					))}
				</div>
			)}

			{/* Lean4 code */}
			<div style={{ padding: "8px 14px", maxHeight: 400, overflow: "auto" }}>
				<div
					style={{
						fontSize: 8,
						fontWeight: 700,
						color: EMBRY.dim,
						textTransform: "uppercase",
						marginBottom: 6,
					}}
				>
					LEAN4 CODE
				</div>
				<pre
					style={{
						fontSize: 11,
						color: "#a5b4fc",
						margin: 0,
						whiteSpace: "pre-wrap",
						fontFamily: "JetBrains Mono, monospace",
						background: "#050505",
						padding: 10,
						border: `1px solid ${EMBRY.border}`,
						borderRadius: 4,
						lineHeight: 1.6,
					}}
				>
					{proof.lean_code}
				</pre>
			</div>
		</div>
	);
}
