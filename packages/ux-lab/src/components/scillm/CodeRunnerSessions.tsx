/**
 * CodeRunnerSessions — Task progression view for code-runner sessions
 *
 * Shows code-runner self-improvement loops with:
 * - Round-by-round score progression (sparkline)
 * - Strategy escalation tracking
 * - DoD pass/fail status
 * - Final commit info
 */
import React, { useState, useMemo } from "react";
import {
	ChevronRight,
	ChevronDown,
	Check,
	X,
	TrendingUp,
	TrendingDown,
	Minus,
	GitCommit,
	AlertTriangle,
	Clock,
	Target,
} from "lucide-react";
import { EMBRY } from "../common/EmbryStyle";
import {
	useCodeRunnerSessions,
	type CodeRunnerSession,
	type CodeRunnerRound,
	STRATEGY_ORDER,
	type Strategy,
} from "../../hooks/useCodeRunnerSessions";

const MONO = '"JetBrains Mono", "SF Mono", monospace';

// Strategy colors for visual distinction
const STRATEGY_COLORS: Record<Strategy, string> = {
	direct_fix: EMBRY.green,
	structured_analysis: EMBRY.blue,
	different_approach: EMBRY.amber,
	simplify: "#c084fc", // violet
	escalate: EMBRY.red,
};

// Mini sparkline showing score progression
function ScoreSparkline({ scores }: { scores: (number | null)[] }) {
	const validScores = scores.filter((s): s is number => s !== null);
	if (validScores.length === 0) {
		return <span style={{ color: EMBRY.dim, fontSize: 10 }}>No scores</span>;
	}

	const maxScore = Math.max(...validScores, 1);
	const height = 20;
	const width = Math.min(scores.length * 8, 80);

	return (
		<svg width={width} height={height} style={{ display: "block" }}>
			{scores.map((score, i) => {
				const x = i * 8 + 4;
				const normalizedScore = score !== null ? score / maxScore : 0;
				const barHeight = Math.max(normalizedScore * (height - 4), 2);
				const color =
					score === null
						? EMBRY.dim
						: score >= 0.8
							? EMBRY.green
							: score >= 0.5
								? EMBRY.amber
								: EMBRY.red;

				return (
					<rect
						key={i}
						x={x - 2}
						y={height - barHeight - 2}
						width={4}
						height={barHeight}
						fill={color}
						opacity={0.8}
					/>
				);
			})}
		</svg>
	);
}

// Progress dots showing keep/discard decisions
function RoundDots({ rounds }: { rounds: CodeRunnerRound[] }) {
	return (
		<div style={{ display: "flex", gap: 3, alignItems: "center" }}>
			{rounds.slice(0, 10).map((round, i) => {
				const color = round.outcome === "success" ? EMBRY.green : EMBRY.red;
				const strategy = extractStrategyFromTags(round.tags);
				const strategyColor = STRATEGY_COLORS[strategy];

				return (
					<div
						key={i}
						title={`Round ${round.round}: ${round.outcome} (${strategy})`}
						style={{
							width: 8,
							height: 8,
							borderRadius: "50%",
							backgroundColor: color,
							border: `2px solid ${strategyColor}`,
							boxSizing: "border-box",
						}}
					/>
				);
			})}
			{rounds.length > 10 && (
				<span style={{ fontSize: 9, color: EMBRY.dim }}>+{rounds.length - 10}</span>
			)}
		</div>
	);
}

function extractStrategyFromTags(tags: string[]): Strategy {
	for (const tag of tags) {
		if (tag.startsWith("strategy:")) {
			const s = tag.replace("strategy:", "") as Strategy;
			if (STRATEGY_ORDER.includes(s)) return s;
		}
	}
	return "direct_fix";
}

// Strategy badge with color
function StrategyBadge({ strategy }: { strategy: Strategy }) {
	const color = STRATEGY_COLORS[strategy];
	const labels: Record<Strategy, string> = {
		direct_fix: "Direct",
		structured_analysis: "Analyze",
		different_approach: "Pivot",
		simplify: "Simplify",
		escalate: "Escalate",
	};

	return (
		<span
			style={{
				fontSize: 9,
				fontWeight: 700,
				padding: "2px 6px",
				backgroundColor: `${color}20`,
				color,
				border: `1px solid ${color}40`,
				textTransform: "uppercase",
				letterSpacing: "0.05em",
			}}
		>
			{labels[strategy]}
		</span>
	);
}

// DoD status indicator
function DoDStatus({ passed }: { passed: boolean }) {
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				fontSize: 10,
				fontWeight: 700,
				color: passed ? EMBRY.green : EMBRY.red,
			}}
		>
			{passed ? <Check size={12} /> : <X size={12} />}
			DoD {passed ? "Passed" : "Failed"}
		</span>
	);
}

// Score trend indicator
function ScoreTrend({ improved, bestScore }: { improved: boolean; bestScore: number | null }) {
	if (bestScore === null) return null;

	const Icon = improved ? TrendingUp : TrendingDown;
	const color = improved ? EMBRY.green : EMBRY.red;

	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				fontSize: 10,
				color,
			}}
		>
			<Icon size={12} />
			{(bestScore * 100).toFixed(0)}%
		</span>
	);
}

// Single round row (expanded view)
function RoundRow({ round }: { round: CodeRunnerRound }) {
	const strategy = extractStrategyFromTags(round.tags);
	const scoreColor =
		round.score === null
			? EMBRY.dim
			: round.score >= 0.8
				? EMBRY.green
				: round.score >= 0.5
					? EMBRY.amber
					: EMBRY.red;

	return (
		<tr
			style={{
				backgroundColor: EMBRY.bg,
				borderLeft: `3px solid ${round.outcome === "success" ? EMBRY.green : EMBRY.red}40`,
			}}
		>
			<td style={{ padding: "8px 16px 8px 40px", fontSize: 11 }}>
				<span style={{ color: EMBRY.dim }}>R{round.round}</span>
			</td>
			<td style={{ padding: "8px" }}>
				<StrategyBadge strategy={strategy} />
			</td>
			<td style={{ padding: "8px", fontFamily: MONO, fontSize: 11, color: scoreColor }}>
				{round.score !== null ? (round.score * 100).toFixed(0) + "%" : "--"}
			</td>
			<td style={{ padding: "8px" }}>
				<span
					style={{
						fontSize: 9,
						fontWeight: 700,
						color: round.outcome === "success" ? EMBRY.green : EMBRY.red,
					}}
				>
					{round.outcome === "success" ? "KEEP" : "DISCARD"}
				</span>
			</td>
			<td style={{ padding: "8px", fontFamily: MONO, fontSize: 10, color: EMBRY.dim }}>
				{round.duration_ms ? `${(round.duration_ms / 1000).toFixed(1)}s` : "--"}
			</td>
			<td style={{ padding: "8px", fontSize: 10, color: EMBRY.dim }}>
				{round.metadata?.dod_passed && <Check size={12} color={EMBRY.green} />}
			</td>
		</tr>
	);
}

// Session row with expandable rounds
function SessionRow({
	session,
	isExpanded,
	onToggle,
}: {
	session: CodeRunnerSession;
	isExpanded: boolean;
	onToggle: () => void;
}) {
	const borderColor = session.dodPassed
		? EMBRY.green
		: session.errorCount > 0
			? EMBRY.red
			: EMBRY.amber;

	return (
		<>
			<tr
				onClick={onToggle}
				style={{
					backgroundColor: EMBRY.bgCard,
					cursor: "pointer",
					borderLeft: `4px solid ${borderColor}`,
				}}
				onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = EMBRY.bgPanel)}
				onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = EMBRY.bgCard)}
			>
				<td style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 8 }}>
					{isExpanded ? (
						<ChevronDown size={14} color={EMBRY.dim} />
					) : (
						<ChevronRight size={14} color={EMBRY.dim} />
					)}
					<div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
						<span style={{ fontWeight: 700, color: EMBRY.white }}>{session.task_id}</span>
						<span style={{ fontSize: 9, color: EMBRY.dim, fontFamily: MONO }}>
							{session.session_key.slice(-12)}
						</span>
					</div>
				</td>

				<td style={{ padding: "12px 8px" }}>
					<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						<RoundDots rounds={session.rounds} />
						<span style={{ fontSize: 9, color: EMBRY.dim }}>
							{session.keptRounds}/{session.roundCount} kept
						</span>
					</div>
				</td>

				<td style={{ padding: "12px 8px" }}>
					<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						<ScoreSparkline scores={session.scores} />
						<ScoreTrend improved={session.scoreImproved} bestScore={session.bestScore} />
					</div>
				</td>

				<td style={{ padding: "12px 8px" }}>
					<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						<StrategyBadge strategy={session.maxStrategyReached} />
						{session.strategyEscalations > 0 && (
							<span style={{ fontSize: 9, color: EMBRY.amber }}>
								<AlertTriangle size={10} style={{ verticalAlign: "middle" }} />{" "}
								{session.strategyEscalations} escalation{session.strategyEscalations > 1 ? "s" : ""}
							</span>
						)}
					</div>
				</td>

				<td style={{ padding: "12px 8px" }}>
					<DoDStatus passed={session.dodPassed} />
				</td>

				<td style={{ padding: "12px 8px" }}>
					{session.finalCommit ? (
						<span
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 4,
								fontSize: 10,
								fontFamily: MONO,
								color: EMBRY.green,
							}}
						>
							<GitCommit size={12} />
							{session.finalCommit.slice(0, 7)}
						</span>
					) : (
						<span style={{ fontSize: 10, color: EMBRY.dim }}>--</span>
					)}
				</td>

				<td style={{ padding: "12px 8px", fontSize: 10, color: EMBRY.dim }}>
					<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
						<Clock size={10} />
						{(session.totalDurationMs / 1000).toFixed(0)}s
					</div>
				</td>
			</tr>

			{/* Expanded rounds */}
			{isExpanded &&
				session.rounds.map((round) => <RoundRow key={round._key} round={round} />)}
		</>
	);
}

export function CodeRunnerSessions() {
	const { sessions, loading, error, lastUpdate, refresh } = useCodeRunnerSessions();
	const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
	const [filter, setFilter] = useState<"all" | "passed" | "failed">("all");

	const filteredSessions = useMemo(() => {
		if (filter === "all") return sessions;
		if (filter === "passed") return sessions.filter((s) => s.dodPassed);
		if (filter === "failed") return sessions.filter((s) => !s.dodPassed);
		return sessions;
	}, [sessions, filter]);

	const stats = useMemo(
		() => ({
			total: sessions.length,
			passed: sessions.filter((s) => s.dodPassed).length,
			failed: sessions.filter((s) => !s.dodPassed).length,
			avgRounds:
				sessions.length > 0
					? (sessions.reduce((sum, s) => sum + s.roundCount, 0) / sessions.length).toFixed(1)
					: "0",
		}),
		[sessions]
	);

	const toggleSession = (key: string) => {
		setExpandedSessions((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	if (loading && sessions.length === 0) {
		return (
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					height: "100%",
					color: EMBRY.dim,
				}}
			>
				Loading code-runner sessions...
			</div>
		);
	}

	if (error) {
		return (
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					height: "100%",
					color: EMBRY.red,
				}}
			>
				Error: {error}
			</div>
		);
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			{/* Stats Header */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 16,
					padding: "12px 16px",
					backgroundColor: EMBRY.bgDeep,
					borderBottom: `1px solid ${EMBRY.border}`,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<Target size={16} color={EMBRY.blue} />
					<span style={{ fontSize: 12, fontWeight: 700, color: EMBRY.white }}>
						Code Runner Sessions
					</span>
				</div>

				<div style={{ display: "flex", gap: 16 }}>
					<StatPill label="Total" value={stats.total.toString()} color={EMBRY.white} />
					<StatPill label="Passed" value={stats.passed.toString()} color={EMBRY.green} />
					<StatPill label="Failed" value={stats.failed.toString()} color={EMBRY.red} />
					<StatPill label="Avg Rounds" value={stats.avgRounds} color={EMBRY.blue} />
				</div>

				<div style={{ flex: 1 }} />

				<span style={{ fontSize: 9, color: EMBRY.dim }}>
					{lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : ""}
				</span>

				<button
					onClick={refresh}
					style={{
						fontSize: 9,
						fontWeight: 700,
						textTransform: "uppercase",
						letterSpacing: "0.1em",
						padding: "4px 10px",
						border: `1px solid ${EMBRY.border}`,
						backgroundColor: "transparent",
						color: EMBRY.white,
						cursor: "pointer",
					}}
				>
					Refresh
				</button>
			</div>

			{/* Filter Tabs */}
			<div
				style={{
					display: "flex",
					gap: 0,
					borderBottom: `1px solid ${EMBRY.border}`,
					backgroundColor: EMBRY.bgPanel,
				}}
			>
				{[
					{ key: "all", label: "All", count: stats.total },
					{ key: "passed", label: "Passed", count: stats.passed },
					{ key: "failed", label: "Failed", count: stats.failed },
				].map(({ key, label, count }) => (
					<button
						key={key}
						onClick={() => setFilter(key as typeof filter)}
						style={{
							padding: "10px 16px",
							fontSize: 11,
							fontWeight: 700,
							textTransform: "uppercase",
							letterSpacing: "0.05em",
							border: "none",
							borderBottom: filter === key ? `2px solid ${EMBRY.blue}` : "2px solid transparent",
							backgroundColor: "transparent",
							color: filter === key ? EMBRY.white : EMBRY.dim,
							cursor: "pointer",
						}}
					>
						{label} ({count})
					</button>
				))}
			</div>

			{/* Table */}
			<div style={{ flex: 1, overflowY: "auto" }}>
				<table style={{ width: "100%", borderCollapse: "collapse" }}>
					<thead>
						<tr
							style={{
								textAlign: "left",
								color: EMBRY.dim,
								fontSize: 9,
								fontWeight: 700,
								textTransform: "uppercase",
								letterSpacing: "0.1em",
								borderBottom: `1px solid ${EMBRY.border}`,
								backgroundColor: EMBRY.bgDeep,
							}}
						>
							<th style={{ padding: "10px 16px" }}>Task / Session</th>
							<th style={{ padding: "10px 8px" }}>Rounds</th>
							<th style={{ padding: "10px 8px" }}>Score</th>
							<th style={{ padding: "10px 8px" }}>Strategy</th>
							<th style={{ padding: "10px 8px" }}>DoD</th>
							<th style={{ padding: "10px 8px" }}>Commit</th>
							<th style={{ padding: "10px 8px" }}>Duration</th>
						</tr>
					</thead>
					<tbody>
						{filteredSessions.length === 0 ? (
							<tr>
								<td colSpan={7} style={{ padding: 24, textAlign: "center", color: EMBRY.dim }}>
									No code-runner sessions found
								</td>
							</tr>
						) : (
							filteredSessions.map((session) => (
								<SessionRow
									key={session.session_key}
									session={session}
									isExpanded={expandedSessions.has(session.session_key)}
									onToggle={() => toggleSession(session.session_key)}
								/>
							))
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}

// Small stat pill for the header
function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
			<span
				style={{
					fontSize: 9,
					fontWeight: 700,
					textTransform: "uppercase",
					letterSpacing: "0.1em",
					color: EMBRY.dim,
				}}
			>
				{label}
			</span>
			<span style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO, color }}>{value}</span>
		</div>
	);
}
