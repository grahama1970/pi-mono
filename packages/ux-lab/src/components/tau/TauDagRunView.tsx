import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleCheck, FileJson, GitBranch, ListChecks, ShieldCheck, TriangleAlert } from "lucide-react";
import { EMBRY } from "../common/EmbryStyle";
import { TransportReactFlowDagWorkspace } from "../scillm/transport/TransportReactFlowDagWorkspace";
import type { TransportDagEvidenceNode } from "../scillm/transport/transportClient";
import { buildTauDagEvidence, loadTauDagRun, type LoadedTauDagRun } from "./tauDagEvidenceAdapter";
import "../scillm/transport/transport-room.css";

function normalizeArray(value: unknown): string[] {
	return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function statusTone(status?: string): string {
	const value = (status || "").toLowerCase();
	if (["pass", "passed", "success", "accepted"].includes(value)) return EMBRY.green;
	if (["blocked", "failed", "error", "missing_required_evidence"].includes(value)) return EMBRY.red;
	if (["review", "warn", "warning", "partial"].includes(value)) return EMBRY.amber;
	return EMBRY.dim;
}

export function TauDagRunView() {
	const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined);
	const [loaded, setLoaded] = useState<LoadedTauDagRun | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		loadTauDagRun(selectedRunId)
			.then((run) => {
				if (cancelled) return;
				setLoaded(run);
				setSelectedRunId(run.selected.id);
				setSelectedNodeId(null);
				setError(null);
			})
			.catch((caught: unknown) => {
				if (cancelled) return;
				setError(caught instanceof Error ? caught.message : String(caught));
			});
		return () => {
			cancelled = true;
		};
	}, [selectedRunId]);

	const evidence = useMemo(() => (loaded ? buildTauDagEvidence(loaded) : null), [loaded]);
	const selectedNode = useMemo(
		() => evidence?.nodes.find((node) => node.id === selectedNodeId) || null,
		[evidence, selectedNodeId],
	);

	const handleSelectNode = useCallback((node: TransportDagEvidenceNode) => {
		setSelectedNodeId(node.id);
	}, []);

	const proves = normalizeArray(loaded?.receipt.proof_scope?.proves);
	const doesNotProve = normalizeArray(loaded?.receipt.proof_scope?.does_not_prove);
	const alerts = loaded?.receipt.alerts || [];
	const artifacts = loaded?.receipt.artifact_refs || [];

	return (
		<section className="tau-dag-root" data-qid="tau:dag:artifact-viewer">
			<style>{`
        .tau-dag-root {
          min-height: calc(100vh - 112px);
          color: ${EMBRY.white};
          background: ${EMBRY.bg};
          display: flex;
          flex-direction: column;
        }
        .tau-dag-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 14px 18px;
          border-bottom: 1px solid ${EMBRY.border};
          background: rgba(9, 11, 16, .94);
        }
        .tau-dag-title {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .tau-dag-title h2 {
          margin: 0;
          font-size: 18px;
          line-height: 24px;
        }
        .tau-dag-title p {
          margin: 2px 0 0;
          color: ${EMBRY.dim};
          font-size: 12px;
          line-height: 16px;
        }
        .tau-dag-controls select {
          min-width: 260px;
          color: ${EMBRY.white};
          background: ${EMBRY.bgCard};
          border: 1px solid ${EMBRY.border};
          border-radius: 8px;
          padding: 8px 10px;
          font-weight: 700;
        }
        .tau-dag-body {
          display: grid;
          grid-template-columns: minmax(720px, 1fr) 360px;
          min-height: calc(100vh - 178px);
        }
        .tau-dag-graph {
          min-width: 0;
          border-right: 1px solid ${EMBRY.border};
        }
        .tau-dag-graph .transport-room,
        .tau-dag-graph .transport-room__shell {
          min-height: calc(100vh - 178px);
        }
        .tau-dag-side {
          padding: 14px;
          display: grid;
          gap: 12px;
          align-content: start;
          background: rgba(8, 10, 14, .76);
          overflow-y: auto;
          max-height: calc(100vh - 178px);
        }
        .tau-dag-section {
          padding: 12px;
          border: 1px solid ${EMBRY.border};
          border-radius: 8px;
          background: rgba(255,255,255,.035);
        }
        .tau-dag-section h3 {
          margin: 0 0 9px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
        }
        .tau-dag-kv {
          display: grid;
          grid-template-columns: 112px minmax(0,1fr);
          gap: 6px 10px;
          color: ${EMBRY.dim};
          font-size: 12px;
        }
        .tau-dag-kv strong {
          color: ${EMBRY.white};
          overflow-wrap: anywhere;
        }
        .tau-dag-list {
          margin: 0;
          padding-left: 18px;
          color: ${EMBRY.dim};
          font-size: 12px;
          line-height: 17px;
        }
        .tau-dag-paths {
          display: grid;
          gap: 7px;
          color: ${EMBRY.dim};
          font-size: 12px;
        }
        .tau-dag-paths code {
          color: ${EMBRY.blue};
          white-space: normal;
          overflow-wrap: anywhere;
        }
        .tau-dag-error {
          padding: 18px;
          color: ${EMBRY.red};
        }
        @media (max-width: 980px) {
          .tau-dag-body {
            grid-template-columns: 1fr;
          }
          .tau-dag-graph {
            border-right: 0;
            border-bottom: 1px solid ${EMBRY.border};
          }
          .tau-dag-side {
            max-height: none;
          }
        }
      `}</style>

			<div className="tau-dag-toolbar">
				<div className="tau-dag-title">
					<GitBranch color={EMBRY.blue} size={22} />
					<div>
						<h2>{loaded?.contract.dag_id || "Tau DAG Evidence"}</h2>
						<p>Read-only React Flow view of Tau DAG contracts, receipts, and proof boundaries.</p>
					</div>
				</div>
				<div className="tau-dag-controls">
					<select
						data-qid="tau:dag:run-select"
						aria-label="Tau DAG run"
						value={selectedRunId || ""}
						onChange={(event) => setSelectedRunId(event.target.value)}
					>
						{(loaded?.manifest.runs || []).map((run) => (
							<option key={run.id} value={run.id}>
								{run.label}
							</option>
						))}
					</select>
				</div>
			</div>

			{error ? (
				<div className="tau-dag-error">Failed to load Tau DAG artifacts: {error}</div>
			) : !loaded || !evidence ? (
				<div className="tau-dag-error">Loading Tau DAG artifacts...</div>
			) : (
				<div className="tau-dag-body">
					<div className="tau-dag-graph" data-qid="tau:dag:canvas">
						<div className="transport-room transport-room--live" data-qid="transport:room:root">
							<div className="transport-room__shell transport-room__shell--meta-open">
								<TransportReactFlowDagWorkspace
									evidence={evidence}
									loading={false}
									error={null}
									selectedNodeId={selectedNodeId}
									onSelectNode={handleSelectNode}
									onSelectCall={() => {}}
									runFinished
									collapsed={false}
								/>
							</div>
						</div>
					</div>
					<aside className="tau-dag-side" data-qid="tau:dag:evidence-panel">
						<div className="tau-dag-section">
							<h3>
								<ShieldCheck size={16} color={statusTone(loaded.receipt.status)} /> Receipt Status
							</h3>
							<div className="tau-dag-kv">
								<span>status</span>
								<strong style={{ color: statusTone(loaded.receipt.status) }}>{loaded.receipt.status || "UNKNOWN"}</strong>
								<span>dag id</span>
								<strong>{loaded.receipt.dag_id || loaded.contract.dag_id}</strong>
								<span>goal hash</span>
								<strong>{loaded.receipt.goal_hash || loaded.contract.goal?.goal_hash || "missing"}</strong>
								<span>mocked</span>
								<strong>{String(loaded.receipt.mocked ?? "not stated")}</strong>
								<span>live</span>
								<strong>{String(loaded.receipt.live ?? "not stated")}</strong>
								<span>provider live</span>
								<strong>{String(loaded.receipt.provider_live ?? "not stated")}</strong>
								<span>source</span>
								<strong>{loaded.receipt.source || loaded.selected.source}</strong>
							</div>
						</div>

						<div className="tau-dag-section" data-qid="tau:dag:selected-node">
							<h3>
								<CircleCheck size={16} color={selectedNode ? statusTone(selectedNode.status) : EMBRY.dim} /> Selected
								Node
							</h3>
							{selectedNode ? (
								<div className="tau-dag-kv">
									<span>node</span>
									<strong>{selectedNode.id}</strong>
									<span>status</span>
									<strong style={{ color: statusTone(selectedNode.status) }}>{selectedNode.status}</strong>
									<span>role</span>
									<strong>{selectedNode.role || selectedNode.skills.join(", ")}</strong>
									<span>evidence</span>
									<strong>{selectedNode.request_summary || "not declared"}</strong>
									<span>receipt</span>
									<strong>{selectedNode.response || "not attached"}</strong>
								</div>
							) : (
								<p className="tau-dag-list">Select a node in the graph to inspect its receipt-backed fields.</p>
							)}
						</div>

						<div className="tau-dag-section">
							<h3>
								<TriangleAlert size={16} color={alerts.length ? EMBRY.amber : EMBRY.green} /> Alerts
							</h3>
							{alerts.length ? (
								<ul className="tau-dag-list">
									{alerts.map((alert, index) => (
										<li key={`${alert.code || "alert"}-${index}`}>
											{alert.severity || "ALERT"} {alert.code || "unknown"} {alert.message || ""}
										</li>
									))}
								</ul>
							) : (
								<p className="tau-dag-list">No alerts are present in this selected receipt.</p>
							)}
						</div>

						<div className="tau-dag-section">
							<h3>
								<ListChecks size={16} color={EMBRY.blue} /> Proof Boundary
							</h3>
							<ul className="tau-dag-list">
								{proves.map((item) => (
									<li key={item}>{item}</li>
								))}
							</ul>
							<h3 style={{ marginTop: 12 }}>
								<TriangleAlert size={16} color={EMBRY.amber} /> Does Not Prove
							</h3>
							<ul className="tau-dag-list">
								{doesNotProve.map((item) => (
									<li key={item}>{item}</li>
								))}
							</ul>
						</div>

						<div className="tau-dag-section">
							<h3>
								<FileJson size={16} color={EMBRY.blue} /> Artifacts
							</h3>
							<div className="tau-dag-paths">
								<div>
									contract <code>{loaded.selected.path}/dag-contract.json</code>
								</div>
								<div>
									receipt <code>{loaded.selected.path}/dag-receipt.json</code>
								</div>
								{artifacts.map((artifact, index) => (
									<div key={`${artifact.kind || "artifact"}-${index}`}>
										{artifact.kind || "artifact"} <code>{artifact.path || artifact.sha || "missing path"}</code>
									</div>
								))}
							</div>
						</div>
					</aside>
				</div>
			)}
		</section>
	);
}
