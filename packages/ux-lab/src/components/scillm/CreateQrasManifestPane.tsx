import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Check, Copy, Download, FileJson, GitCompare, Loader2, RefreshCw, TerminalSquare } from "lucide-react";
import { EMBRY } from "../common/EmbryStyle";
import { SharedRightPane } from "../common/SharedRightPane";
import {
	createPatchedTailManifest,
	type BatchJobState,
	type LogEntry,
	type PatchedTailResponse,
	useOrchestratorDetail,
} from "../../hooks/useScillmData";

const MONO = '"JetBrains Mono", "SF Mono", monospace';

function SmallStat({ label, value, color = EMBRY.white }: { label: string; value: string; color?: string }) {
	return (
		<div
			style={{
				padding: 10,
				border: `1px solid ${EMBRY.border}`,
				backgroundColor: EMBRY.bgPanel,
				display: "flex",
				flexDirection: "column",
				gap: 4,
			}}
		>
			<div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: EMBRY.dim }}>
				{label}
			</div>
			<div style={{ fontSize: 14, fontWeight: 800, color, fontFamily: MONO }}>{value}</div>
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
			<div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: EMBRY.dim }}>
				{title}
			</div>
			{children}
		</section>
	);
}

function JsonBlock({ value }: { value: unknown }) {
	return (
		<pre
			style={{
				margin: 0,
				padding: 12,
				backgroundColor: EMBRY.bgPanel,
				border: `1px solid ${EMBRY.border}`,
				fontSize: 10,
				fontFamily: MONO,
				color: EMBRY.white,
				overflow: "auto",
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
			}}
		>
			{JSON.stringify(value, null, 2)}
		</pre>
	);
}

function TraceTable({ rows }: { rows: LogEntry[] }) {
	if (rows.length === 0) {
		return <div style={{ fontSize: 11, color: EMBRY.dim }}>No matching scillm rows yet.</div>;
	}

	return (
		<div style={{ border: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bgPanel }}>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1.2fr 1fr 0.8fr 0.8fr",
					gap: 8,
					padding: "8px 10px",
					borderBottom: `1px solid ${EMBRY.border}`,
					fontSize: 9,
					fontWeight: 800,
					letterSpacing: "0.08em",
					textTransform: "uppercase",
					color: EMBRY.dim,
				}}
			>
				<div>Item</div>
				<div>Model</div>
				<div>Status</div>
				<div>Last Seen</div>
			</div>
			{rows.slice(0, 50).map((row) => (
				<div
					key={row._key}
					style={{
						display: "grid",
						gridTemplateColumns: "1.2fr 1fr 0.8fr 0.8fr",
						gap: 8,
						padding: "8px 10px",
						borderBottom: `1px solid ${EMBRY.border}`,
						fontSize: 10,
						color: EMBRY.white,
					}}
				>
					<div style={{ fontFamily: MONO }}>{row.metadata?.item_id || "—"}</div>
					<div style={{ fontFamily: MONO }}>{row.model_served || row.model_requested}</div>
					<div style={{ color: row.status === "error" ? EMBRY.red : EMBRY.green, fontWeight: 700 }}>{row.status}</div>
					<div style={{ color: EMBRY.dim }}>{new Date(row.ts).toLocaleTimeString()}</div>
				</div>
			))}
		</div>
	);
}

export function CreateQrasManifestPane({
	job,
	onClose,
}: {
	job: BatchJobState;
	onClose: () => void;
}) {
	const { detail, loading, error, refresh } = useOrchestratorDetail(job.name);
	const [tab, setTab] = useState<"manifest" | "trace" | "diff">("manifest");
	const [revision, setRevision] = useState<"original" | "patched">("original");
	const [patch, setPatch] = useState<PatchedTailResponse | null>(null);
	const [patching, setPatching] = useState(false);
	const [copied, setCopied] = useState<"review" | "manifest" | null>(null);

	const activeManifest = revision === "patched" ? patch?.manifest : detail?.manifest;
	const activeDiff = revision === "patched" ? patch?.diff : detail?.tail_diff;
	const activeTrace = detail?.chunk_calls?.length ? detail.chunk_calls : detail?.calls || [];
	const chunkJobs = detail?.chunk_jobs || [];

	const headline = useMemo(() => {
		const state = detail?.state || job.state;
		if (!state) return job.name;
		return `${job.name} · ${state.phase || "idle"} · ${state.status || "unknown"}`;
	}, [detail?.state, job.name, job.state]);

	async function ensurePatch() {
		if (patch) return patch;
		setPatching(true);
		try {
			const next = await createPatchedTailManifest(job.name);
			setPatch(next);
			setRevision("patched");
			return next;
		} finally {
			setPatching(false);
		}
	}

	async function copyCli(kind: "review" | "manifest") {
		const generated = await ensurePatch();
		await navigator.clipboard.writeText(generated.copy_cli[kind]);
		setCopied(kind);
		setTimeout(() => setCopied(null), 2000);
	}

	async function downloadPatchedManifest() {
		const generated = await ensurePatch();
		const blob = new Blob([JSON.stringify(generated.manifest, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = generated.manifest_path.split("/").pop() || "patched-tail-manifest.json";
		a.click();
		URL.revokeObjectURL(url);
	}

	return (
		<SharedRightPane
			title="Manifest Dossier"
			subtitle={headline}
			tabs={[
				{ id: "manifest", label: "Manifest" },
				{ id: "trace", label: "Trace" },
				{ id: "diff", label: "Diff" },
			]}
			activeTab={tab}
			onTabChange={(next) => setTab(next as "manifest" | "trace" | "diff")}
			onClose={onClose}
			actions={
				<>
					<button
						data-qid="create-qras-pane:refresh"
						title="Refresh dossier"
						onClick={refresh}
						style={actionButton()}
					>
						<RefreshCw size={12} />
						Refresh
					</button>
					<button
						data-qid="create-qras-pane:generate-patch"
						title="Generate tail manifest from current chunk onward"
						onClick={() => void ensurePatch()}
						style={actionButton(EMBRY.amber)}
					>
						{patching ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <GitCompare size={12} />}
						Patch Tail
					</button>
					<button
						data-qid="create-qras-pane:copy-review-cli"
						title="Copy review command with absolute paths"
						onClick={() => void copyCli("review")}
						style={actionButton(copied === "review" ? EMBRY.green : EMBRY.blue)}
					>
						{copied === "review" ? <Check size={12} /> : <TerminalSquare size={12} />}
						Review CLI
					</button>
					<button
						data-qid="create-qras-pane:copy-manifest-cli"
						title="Copy manifest command with absolute paths"
						onClick={() => void copyCli("manifest")}
						style={actionButton(copied === "manifest" ? EMBRY.green : EMBRY.blue)}
					>
						{copied === "manifest" ? <Check size={12} /> : <Copy size={12} />}
						Run CLI
					</button>
					<button
						data-qid="create-qras-pane:download-patch"
						title="Download patched tail manifest"
						onClick={() => void downloadPatchedManifest()}
						style={actionButton(EMBRY.green)}
					>
						<Download size={12} />
						Download
					</button>
				</>
			}
		>
			<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
				<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
					<button
						data-qid="create-qras-pane:revision:original"
						title="Show original manifest"
						onClick={() => setRevision("original")}
						style={revisionButton(revision === "original")}
					>
						Original
					</button>
					<button
						data-qid="create-qras-pane:revision:patched"
						title="Show patched tail manifest"
						onClick={() => setRevision("patched")}
						disabled={!patch}
						style={revisionButton(revision === "patched", !patch)}
					>
						Patched Tail
					</button>
				</div>

				{loading && <div style={{ fontSize: 11, color: EMBRY.dim }}>Loading dossier…</div>}
				{error && <div style={{ fontSize: 11, color: EMBRY.red }}>{error}</div>}

				{detail?.rollout && (
					<div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
						<SmallStat label="Tonight" value={`${detail.rollout.tonight_completed_jobs}/${detail.rollout.tonight_total_jobs}`} color={EMBRY.blue} />
						<SmallStat label="Queued" value={`${detail.rollout.tonight_remaining_jobs}`} color={EMBRY.amber} />
						<SmallStat label="Tranche" value={`${detail.rollout.current_tranche_completed_jobs}/${detail.rollout.current_tranche_total_jobs}`} />
						<SmallStat label="Stage" value={detail.rollout.current_tranche_label || "—"} />
					</div>
				)}

				{tab === "manifest" && (
					<>
						<Section title="Current Chunk">
							<div style={{ fontSize: 11, color: EMBRY.dim }}>
								This is the active tranche. The overnight rollout is larger. Right now the monitor shows the current chunk and tranche, while the summary above shows tonight’s broader plan.
							</div>
							<div style={{ border: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bgPanel }}>
								{chunkJobs.length === 0 ? (
									<div style={{ padding: 12, fontSize: 11, color: EMBRY.dim }}>No chunk window available yet.</div>
								) : (
									chunkJobs.map((jobRow) => (
										<div
											key={jobRow.job_id}
											style={{
												padding: 10,
												borderBottom: `1px solid ${EMBRY.border}`,
												display: "flex",
												flexDirection: "column",
												gap: 4,
											}}
										>
											<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
												<div style={{ fontSize: 11, fontWeight: 700, color: EMBRY.white, fontFamily: MONO }}>{jobRow.job_id}</div>
												<div style={{ fontSize: 10, color: EMBRY.dim }}>{jobRow.job_type}</div>
											</div>
											<div style={{ fontSize: 10, color: EMBRY.dim }}>
												{jobRow.reason_selected || jobRow.prompt_kind || "No selection rationale"}
											</div>
										</div>
									))
								)}
							</div>
						</Section>

						<Section title="Manifest JSON">
							{activeManifest ? <JsonBlock value={activeManifest} /> : <div style={{ fontSize: 11, color: EMBRY.dim }}>Manifest not loaded.</div>}
						</Section>
					</>
				)}

				{tab === "trace" && (
					<>
						<Section title="Chunk Trace">
							<div style={{ fontSize: 11, color: EMBRY.dim }}>
								Merged truth: manifest intent on top, scillm trace below. Matching is `item_id` first, then falls back to the broader create-qras call window for this run.
							</div>
							<TraceTable rows={activeTrace} />
						</Section>
						<Section title="Chunk Item IDs">
							<JsonBlock value={detail?.chunk_item_ids || []} />
						</Section>
					</>
				)}

				{tab === "diff" && (
					<>
						<Section title="Tail Patch Diff">
							<div style={{ fontSize: 11, color: EMBRY.dim }}>
								Read-only patching. The generated tail manifest starts at the current chunk and includes all remaining work from this tranche onward.
							</div>
							{activeDiff ? <JsonBlock value={activeDiff} /> : <div style={{ fontSize: 11, color: EMBRY.dim }}>Generate a tail patch to inspect the diff.</div>}
						</Section>
						{patch && (
							<Section title="Absolute Paths">
								<JsonBlock value={patch.copy_cli} />
							</Section>
						)}
					</>
				)}
			</div>
		</SharedRightPane>
	);
}

function actionButton(color: string = EMBRY.blue): CSSProperties {
	return {
		display: "flex",
		alignItems: "center",
		gap: 6,
		padding: "6px 10px",
		border: `1px solid ${color}55`,
		backgroundColor: `${color}18`,
		color,
		cursor: "pointer",
		fontSize: 10,
		fontWeight: 800,
		textTransform: "uppercase",
		letterSpacing: "0.06em",
	};
}

function revisionButton(active: boolean, disabled = false): CSSProperties {
	return {
		padding: "6px 10px",
		border: `1px solid ${active ? EMBRY.blue : EMBRY.border}`,
		backgroundColor: active ? `${EMBRY.blue}20` : EMBRY.bgPanel,
		color: disabled ? EMBRY.dim : active ? EMBRY.blue : EMBRY.white,
		cursor: disabled ? "not-allowed" : "pointer",
		fontSize: 10,
		fontWeight: 800,
		textTransform: "uppercase",
		letterSpacing: "0.08em",
		opacity: disabled ? 0.6 : 1,
	};
}
