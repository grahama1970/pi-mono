/**
 * InlineArtifact — Renders artifacts inline in chat messages.
 * Supports: SVG, HTML (iframe), code, markdown, react-table, graph (D3).
 * "Expand" opens in right-pane ArtifactPanel.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRegisterAction } from "../../hooks/useRegisterAction";
import DOMPurify from "dompurify";
import type { Artifact, EntityType } from "./types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { classifyEntity, getEntityStyle, highlightEntities } from "./highlightEntities";

interface InlineArtifactProps {
	artifact: Artifact;
	onExpand?: (artifact: Artifact) => void;
	onEntityClick?: (entity: string, type: EntityType) => void;
}

// ── React Table ─────────────────────────────────────────────────────────

interface TableColumn { key: string; label: string; sortable?: boolean }
interface TableData { columns: TableColumn[]; rows: Record<string, unknown>[] }

function isTableData(d: unknown): d is TableData {
	if (!d || typeof d !== "object") return false;
	const obj = d as Record<string, unknown>;
	return Array.isArray(obj.columns) && Array.isArray(obj.rows);
}

const InlineTable = memo(function InlineTable({ data, onEntityClick }: { data: TableData; onEntityClick?: (e: string, t: EntityType) => void }) {
	const [sortKey, setSortKey] = useState<string | null>(null);
	const [sortAsc, setSortAsc] = useState(true);
	const [filter, setFilter] = useState("");

	const handleSort = useCallback((key: string) => {
		if (sortKey === key) setSortAsc(a => !a);
		else { setSortKey(key); setSortAsc(true); }
	}, [sortKey]);

	const rows = useMemo(() => {
		let r = data.rows;
		if (filter) {
			const lf = filter.toLowerCase();
			r = r.filter(row => Object.values(row).some(v => String(v ?? "").toLowerCase().includes(lf)));
		}
		if (sortKey) {
			r = [...r].sort((a, b) => {
				const va = String(a[sortKey] ?? ""), vb = String(b[sortKey] ?? "");
				return sortAsc ? va.localeCompare(vb, undefined, { numeric: true }) : vb.localeCompare(va, undefined, { numeric: true });
			});
		}
		return r;
	}, [data.rows, filter, sortKey, sortAsc]);

	return (
		<div>
			<div style={{ padding: "0 12px 8px" }}>
				<input type="text" placeholder="Filter rows..." data-qs-action="ARTIFACT_TABLE_FILTER" data-qid="artifact:table:filter" title="Filter table rows" value={filter} onChange={e => setFilter(e.target.value)}
					style={{ width: "100%", padding: "6px 10px", fontSize: 12, background: "#0b1220", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "#e2e8f0", fontFamily: "var(--font-mono)", outline: "none" }} />
			</div>
			<div style={{ overflowX: "auto" }}>
				<table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "var(--font-ui)" }}>
					<thead>
						<tr>
							{data.columns.map(col => (
								<th key={col.key} data-qs-action={`ARTIFACT_TABLE_SORT_${col.key.toUpperCase()}`} data-qid={`artifact:table:sort:${col.key}`} title={`Sort by ${col.label}`} onClick={col.sortable !== false ? () => handleSort(col.key) : undefined}
									style={{ padding: "8px 12px", textAlign: "left", color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.08)", position: "sticky", top: 0, background: "#18181b", cursor: col.sortable !== false ? "pointer" : "default", userSelect: "none" }}>
									{col.label}{sortKey === col.key && <span style={{ marginLeft: 4 }}>{sortAsc ? "↑" : "↓"}</span>}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row, idx) => (
							<tr key={idx} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
								{data.columns.map(col => {
									const val = String(row[col.key] ?? "");
									const eType = classifyEntity(val);
									const eStyle = eType ? getEntityStyle(eType) : null;
									return (
										<td key={col.key} onClick={eType && onEntityClick ? () => onEntityClick(val, eType) : undefined}
											style={{ padding: "8px 12px", color: eStyle?.color || "#e2e8f0", borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: eType ? "pointer" : "default", fontFamily: eType ? "var(--font-mono)" : "inherit" }}>
											{val}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div style={{ padding: "6px 12px", fontSize: 10, color: "#64748b", fontFamily: "var(--font-mono)" }}>
				{rows.length} row{rows.length !== 1 ? "s" : ""}{filter ? ` (filtered from ${data.rows.length})` : ""}
			</div>
		</div>
	);
});

// ── D3 Graph (lazy loaded) ──────────────────────────────────────────────

interface GraphNode { id: string; label: string; type?: string; group?: string }
interface GraphEdge { source: string; target: string; label?: string }
interface GraphData { nodes: GraphNode[]; edges: GraphEdge[] }

function isGraphData(d: unknown): d is GraphData {
	if (!d || typeof d !== "object") return false;
	const obj = d as Record<string, unknown>;
	return Array.isArray(obj.nodes) && Array.isArray(obj.edges);
}

const InlineGraph = memo(function InlineGraph({ data, onEntityClick }: { data: GraphData; onEntityClick?: (e: string, t: EntityType) => void }) {
	const svgRef = useRef<SVGSVGElement>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!svgRef.current || !data.nodes.length) return;
		let cancelled = false;

		import("d3").then(d3 => {
			if (cancelled) return;
			const svg = d3.select(svgRef.current);
			svg.selectAll("*").remove();
			const width = svgRef.current!.clientWidth || 600, height = 320;
			const g = svg.append("g");

			svg.call(d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 4]).on("zoom", e => g.attr("transform", e.transform)) as any);

			const nodes = data.nodes.map(n => ({ ...n }));
			const edges = data.edges.map(e => ({ ...e }));
			const groups = [...new Set(data.nodes.map(n => n.group || n.type || "default"))];
			const color = d3.scaleOrdinal(["#4a9eff", "#00ff88", "#ff4444", "#ffaa00", "#7c3aed", "#ec4899"]).domain(groups);

			const sim = d3.forceSimulation(nodes as any)
				.force("link", d3.forceLink(edges as any).id((d: any) => d.id).distance(80))
				.force("charge", d3.forceManyBody().strength(-200))
				.force("center", d3.forceCenter(width / 2, height / 2));

			const link = g.append("g").selectAll("line").data(edges).join("line")
				.attr("stroke", "rgba(255,255,255,0.15)").attr("stroke-width", 1);

			const node = g.append("g").selectAll("circle").data(nodes).join("circle")
				.attr("r", 8).attr("fill", (d: any) => color(d.group || d.type || "default"))
				.attr("stroke", "rgba(255,255,255,0.2)").attr("stroke-width", 1)
				.style("cursor", "pointer")
				.on("click", (_: any, d: any) => {
					if (!onEntityClick) return;
					const t = classifyEntity(d.label || d.id);
					if (t) onEntityClick(d.label || d.id, t);
				});

			const label = g.append("g").selectAll("text").data(nodes).join("text")
				.text((d: any) => d.label || d.id).attr("font-size", 10)
				.attr("fill", "#94a3b8").attr("dx", 12).attr("dy", 4);

			const drag = d3.drag<SVGCircleElement, any>()
				.on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
				.on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
				.on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; });
			node.call(drag as any);

			sim.on("tick", () => {
				link.attr("x1", (d: any) => d.source.x).attr("y1", (d: any) => d.source.y)
					.attr("x2", (d: any) => d.target.x).attr("y2", (d: any) => d.target.y);
				node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);
				label.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
			});

			setLoading(false);
			return () => { sim.stop(); };
		});

		return () => { cancelled = true; };
	}, [data, onEntityClick]);

	return (
		<div style={{ position: "relative" }}>
			{loading && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#0b1220" }}>
				<div style={{ width: 120, height: 16, borderRadius: 4, background: "linear-gradient(90deg, #18181b 0%, #27272a 50%, #18181b 100%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite" }} />
			</div>}
			<svg ref={svgRef} width="100%" height={320} style={{ background: "#0b1220", display: "block" }} />
		</div>
	);
});

// ── Main Component ──────────────────────────────────────────────────────

export const InlineArtifact = memo(function InlineArtifact({ artifact, onExpand, onEntityClick }: InlineArtifactProps) {
	const [copied, setCopied] = useState(false);
	const [mounted, setMounted] = useState(false);

	useEffect(() => { const af = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(af); }, []);
	useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1200); return () => clearTimeout(t); }, [copied]);

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(artifact.content || JSON.stringify(artifact.data, null, 2));
		setCopied(true);
	}, [artifact]);

	useRegisterAction(`artifact:copy:${artifact.id}`, { app: "shared-chat", action: "ARTIFACT_COPY", label: "Copy", description: `Copy ${artifact.title} content` });
	useRegisterAction(`artifact:expand:${artifact.id}`, { app: "shared-chat", action: "ARTIFACT_EXPAND", label: "Expand", description: `Expand ${artifact.title} to full panel` });
	const handleExpand = useCallback(() => onExpand?.(artifact), [artifact, onExpand]);

	return (
		<div className="nvis-card" style={{
			margin: "12px 0", overflow: "hidden",
			opacity: mounted ? 1 : 0, transform: mounted ? "translateY(0)" : "translateY(8px)",
			transition: "opacity 300ms ease-out, transform 300ms ease-out",
		}}>
			<style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
			{/* Header */}
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--nvis-border-subtle, rgba(255,255,255,0.06))", gap: 10 }}>
				<span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{artifact.title}</span>
				<span style={{ fontSize: 10, color: "#64748b", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>{artifact.type}</span>
				<button onClick={handleCopy} data-qs-action="ARTIFACT_COPY" data-qid={`artifact:copy:${artifact.id}`} title="Copy artifact content" style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", color: copied ? "#00ff88" : "#94a3b8", fontSize: 10, padding: "3px 8px", borderRadius: 4, cursor: "pointer", fontFamily: "var(--font-mono)" }}>
					{copied ? "Copied" : "Copy"}
				</button>
				{onExpand && <button onClick={handleExpand} data-qs-action="ARTIFACT_EXPAND" data-qid={`artifact:expand:${artifact.id}`} title="Open in full panel" style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8", fontSize: 10, padding: "3px 8px", borderRadius: 4, cursor: "pointer", fontFamily: "var(--font-mono)" }}>Expand</button>}
			</div>
			{/* Body */}
			<div style={{ maxHeight: 400, overflow: "auto" }}>
				{artifact.type === "svg" && (
					<div style={{ padding: 16, display: "flex", justifyContent: "center" }}
						dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(artifact.content, { USE_PROFILES: { svg: true, svgFilters: true } }) }} />
				)}
				{artifact.type === "html" && (
					<iframe srcDoc={artifact.content} sandbox="allow-scripts" title={artifact.title}
						style={{ width: "100%", height: 360, border: "none", background: "#0b1220" }} />
				)}
				{artifact.type === "code" && (
					<pre style={{ margin: 0, padding: 16, fontFamily: "var(--font-mono)", fontSize: 13, color: "#e2e8f0", lineHeight: 1.5, background: "#0b1220", whiteSpace: "pre-wrap" }}>
						{artifact.content}
					</pre>
				)}
				{artifact.type === "markdown" && (
					<div style={{ padding: 16 }}><MarkdownRenderer content={artifact.content} onEntityClick={onEntityClick} /></div>
				)}
				{artifact.type === "react-table" && isTableData(artifact.data) && (
					<InlineTable data={artifact.data} onEntityClick={onEntityClick} />
				)}
				{artifact.type === "graph" && isGraphData(artifact.data) && (
					<InlineGraph data={artifact.data} onEntityClick={onEntityClick} />
				)}
			</div>
		</div>
	);
});
