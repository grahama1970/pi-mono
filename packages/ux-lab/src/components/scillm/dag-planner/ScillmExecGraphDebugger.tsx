import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { GitBranchPlus, LocateFixed, Maximize2, Move, ShieldPlus, SquarePlus, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  analyzeExecGraphRuntimeReadiness,
  applyNicoPlanProposal,
  applyPlanPatch,
  cloneExecGraph,
  diffExecGraphPlan,
  validateExecGraphPlan,
  type NicoPlanProposal,
  type PlanDiffItem,
  type PlanValidationIssue,
  type PlanValidationResult,
  type RuntimeReadinessNodeReport,
  type RuntimeReadinessReport,
} from "./execGraphPlanEditor";
import { buildDagViewModel, type DagMode } from "./dagViewModel";

export type ExecNodeState =
  | "pending"
  | "ready"
  | "queued"
  | "running"
  | "paused"
  | "passed"
  | "needs_attention"
  | "failed"
  | "skipped"
  | "stopped";

export type ExecGraphNode = {
  id: string;
  type: string;
  node_goal: string;
  revision_id?: string;
  depends_on?: string[];
  protocol_role?: string;
  persona_ref?: string;
  model?: string;
  prompt?: string;
  review_scopes?: ReviewScopeSpec[];
  messages?: Array<Record<string, unknown>>;
  output_schema?: Record<string, unknown>;
  template_id?: string;
  template_version?: string;
  template_sha256?: string;
  catalog_id?: string;
  catalog_version?: string;
  catalog_sha256?: string;
  inline_overrides?: Record<string, unknown>;
  retry_policy?: Record<string, unknown>;
  gate_policy?: Record<string, unknown>;
  disabled?: boolean;
  archived?: boolean;
  superseded_by?: string;
  metadata?: Record<string, unknown>;
};

export type ReviewScopeSpec = {
  scope?: string;
  contract?: string;
  agent?: string;
  model?: string;
  review_level?: "default" | "risk_expanded" | "adversarial" | "proof_gapfill" | string;
  proof_level?: "proven" | "static_confirmed" | "likely" | "speculative" | string;
  reducer_policy?: string;
  read_only?: boolean;
  evidence_required?: boolean;
  closure_authority?: string;
  risk_triggers?: string[];
  best_practice_skills?: string[];
  prompt_preset?: string;
  prompt?: string;
  catalog_id?: string;
  catalog_version?: string;
  catalog_sha256?: string;
  inline_overrides?: Record<string, unknown>;
  enabled?: boolean;
};

export type ReviewCatalogEntry = {
  id: string;
  version?: string;
  kind?: "agent" | "contract";
  catalog_id?: string;
  catalog_sha256?: string;
  label?: string;
  description?: string;
  default_agent?: string;
  default_model?: string;
  default_preset?: string;
  review_level?: string;
  proof_level?: string;
  reducer_policy?: string;
  read_only?: boolean;
  evidence_required?: boolean;
  closure_authority?: string;
  risk_triggers?: string[];
  best_practice_skills?: string[];
  compatible_node_types?: string[];
  compatible_upstream_types?: string[];
  compatible_downstream_types?: string[];
  required_fields?: string[];
  default?: boolean;
  order?: number;
  prompt?: string;
  source_path?: string;
};

export type ReviewCatalog = {
  schema_version?: string;
  skill?: string;
  source_root?: string;
  agents?: ReviewCatalogEntry[];
  contracts?: ReviewCatalogEntry[];
  default_contracts?: string[];
};

export type ExecGraph = {
  exec_graph_version: string;
  graph_id: string;
  graph_goal: string;
  self_improvement_iterations?: number;
  review_fanout_limits?: ReviewDomainLimits;
  review_iteration_limits?: ReviewDomainLimits;
  nodes: ExecGraphNode[];
};

export type ReviewDomainLimits = {
  review_code?: number;
  review_design?: number;
  review_prompt?: number;
};

export type ExecStatus = {
  run_id?: string;
  state?: string;
  updated_at?: string;
  node_results?: Record<string, Record<string, unknown>>;
  paused?: boolean;
  paused_graph?: boolean;
  paused_node_ids?: string[];
  disabled_node_ids?: string[];
  running_node_ids?: string[];
  runtime_actions?: RuntimeActionRecord[];
};

export type RuntimeActionRecord = {
  schema_version?: string;
  action_id?: string;
  run_id?: string;
  action?: string;
  target?: "graph" | "node" | "subtree";
  node_id?: string | null;
  affected_node_ids?: string[];
  actor?: string;
  reason?: string | null;
  provenance?: Record<string, unknown>;
  status?: string;
  created_at?: string;
};

export type RuntimeActionRequest = {
  action: "pause" | "resume" | "disable" | "cancel" | "stop";
  target: "graph" | "node" | "subtree";
  node_id?: string;
  actor?: string;
  reason?: string;
  provenance?: Record<string, unknown>;
};

export type ExecEvent = {
  ts?: string;
  type: string;
  node_id?: string;
  text?: string;
  state?: ExecNodeState;
};

export type ExecGraphDebuggerConnection = {
  state: "live" | "loading" | "error" | "static";
  label: string;
  updated_at?: string;
  error?: string;
};

type LayoutNode = ExecGraphNode & {
  x: number;
  y: number;
  depth: number;
  state: ExecNodeState;
};

type LayoutEdge = {
  id: string;
  source: LayoutNode;
  target: LayoutNode;
  path: string;
};

type LayoutBand = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  sideLabel?: string;
};

type LayoutLabel = {
  id: string;
  x: number;
  y: number;
  text: string;
};

type GraphViewport = {
  zoom: number;
  offsetX: number;
  offsetY: number;
  panMode: boolean;
};

type ContextMenuState = {
  x: number;
  y: number;
} | null;

type DebuggerMode = "evidence" | "plan_edit" | "nico_proposals";
type EventFilter = "all" | ExecNodeState;
type AmendPlanContext = {
  baseGraph: ExecGraph;
  baseGraphHash: string;
  operations: unknown[];
  diff: PlanDiffItem[];
  validation: PlanValidationResult;
  warning_acceptance?: {
    accepted: boolean;
    actor: string;
    accepted_at: string;
    warnings: PlanValidationIssue[];
  };
};
type AmendPlanHandler = (graph: ExecGraph, context: AmendPlanContext) => unknown | Promise<unknown>;
export type ExecGraphAmendmentStatus = "proposed" | "approved" | "rejected" | "superseded";
export type ExecGraphAmendment = {
  _key: string;
  graph_id: string;
  run_id?: string;
  base_graph_sha256?: string;
  draft_graph_sha256?: string;
  base_graph_hash?: string;
  baseGraphHash?: string;
  status: ExecGraphAmendmentStatus;
  apply_status?: "applied";
  applied_by?: string;
  applied_at?: string;
  applied_graph_sha256?: string;
  apply_reason?: string;
  actor?: string;
  status_actor?: string;
  status_reason?: string;
  created_at?: string;
  updated_at?: string;
  base_graph?: ExecGraph;
  draft_graph?: ExecGraph;
  diff?: PlanDiffItem[];
};
export type AmendmentsLoadState =
  | { status: "idle" | "loading" | "loaded"; message?: string }
  | { status: "error"; message: string };
type AmendmentStatusHandler = (amendmentKey: string, status: Exclude<ExecGraphAmendmentStatus, "proposed">, reason?: string) => unknown | Promise<unknown>;
type AmendmentApplyHandler = (amendment: ExecGraphAmendment, reason?: string) => unknown | Promise<unknown>;
type SaveReviewCatalogEntryHandler = (kind: "agents" | "contracts", entry: ReviewCatalogEntry) => unknown | Promise<unknown>;
type RuntimeActionHandler = (action: RuntimeActionRequest) => unknown | Promise<unknown>;
type RuntimeActionUiState = { status: "idle" | "submitting" | "ok" | "error"; message?: string };
type AmendmentDraftSaveResult = { amendment_key?: string; amendmentId?: string; baseGraphHash?: string; status?: string };
type PlanAuditEntry = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  details: string;
  diffRefs?: string[];
  before?: unknown;
  after?: unknown;
};

const nodeWidth = 220;
const nodeHeight = 88;

const fallbackReviewCodeContracts: ReviewCatalogEntry[] = [
  { id: "correctness_regression", label: "Correctness / Regression", default_agent: "correctness-reviewer", default_model: "oc-kimi", default_preset: "scope_default", review_level: "default", proof_level: "static_confirmed", reducer_policy: "evidence_backed_only", read_only: true, evidence_required: true, closure_authority: "final_review_gate", best_practice_skills: ["best-practices-scillm", "best-practices-self-improvement-loop", "best-practices-python", "best-practices-d3"], default: true },
  { id: "tests_validation", label: "Tests / Validation", default_agent: "validation-reviewer", default_model: "oc-deepseek", default_preset: "scope_default", review_level: "default", proof_level: "proven", reducer_policy: "evidence_backed_only", read_only: true, evidence_required: true, closure_authority: "final_review_gate", best_practice_skills: ["best-practices-scillm", "best-practices-self-improvement-loop", "best-practices-python", "best-practices-d3"], default: true },
  { id: "simplicity_maintainability", label: "Simplicity / Maintainability", default_agent: "maintainability-reviewer", default_model: "oc-glm", default_preset: "scope_default", review_level: "default", proof_level: "static_confirmed", reducer_policy: "evidence_backed_only", read_only: true, evidence_required: true, closure_authority: "final_review_gate", best_practice_skills: ["best-practices-scillm", "best-practices-self-improvement-loop", "best-practices-python", "best-practices-d3"], default: true },
  { id: "evidence_closure_safety", label: "Evidence / Closure Safety", default_agent: "scillm-evidence-reviewer", default_model: "gpt-5.5", default_preset: "scope_default", review_level: "default", proof_level: "proven", reducer_policy: "fail_closed_evidence_closure", read_only: true, evidence_required: true, closure_authority: "final_review_gate", best_practice_skills: ["best-practices-scillm", "best-practices-self-improvement-loop", "best-practices-d3"], risk_triggers: ["evidence", "phase_closure", "artifacts", "orchestration"] },
  { id: "security", label: "Security", default_agent: "security-reviewer", default_model: "gpt-5.5", default_preset: "scope_default", review_level: "risk_expanded", proof_level: "static_confirmed", reducer_policy: "evidence_backed_only", read_only: true, evidence_required: true, closure_authority: "final_review_gate", best_practice_skills: ["best-practices-security", "best-practices-scillm"], risk_triggers: ["auth", "permissions", "secrets", "shell", "file_io", "network", "deserialization", "tokens"] },
];

const fallbackReviewCodeAgents: ReviewCatalogEntry[] = [
  { id: "correctness-reviewer", label: "Correctness Reviewer", default_model: "oc-kimi" },
  { id: "validation-reviewer", label: "Validation Reviewer", default_model: "oc-deepseek" },
  { id: "maintainability-reviewer", label: "Maintainability Reviewer", default_model: "oc-glm" },
  { id: "scillm-evidence-reviewer", label: "scillm Evidence Reviewer", default_model: "gpt-5.5" },
  { id: "security-reviewer", label: "Security Reviewer", default_model: "gpt-5.5" },
];

const reviewCodeContractFallbackIds = [
  "correctness_regression",
  "tests_validation",
  "simplicity_maintainability",
  "evidence_closure_safety",
  "security",
];

const reviewCodeModelOptions = [
  "gpt-5.5",
  "oc-kimi",
  "oc-glm",
  "oc-deepseek",
  "oc-qwen",
];

function isDeprecatedReviewModel(model?: string): boolean {
  const value = String(model ?? "").trim();
  return value === "text" || value.startsWith("text-") || value === "local-text" || value === "moonshot-text";
}

const reviewLevelOptions = [
  { id: "default", label: "Default" },
  { id: "risk_expanded", label: "Risk expanded" },
  { id: "adversarial", label: "Adversarial" },
  { id: "proof_gapfill", label: "Proof gapfill" },
];

const proofLevelOptions = [
  { id: "proven", label: "Proven" },
  { id: "static_confirmed", label: "Static-confirmed" },
  { id: "likely", label: "Likely" },
  { id: "speculative", label: "Speculative" },
];

const reviewCodePromptPresetOptions = [
  { id: "scope_default", label: "Contract default" },
  { id: "prior_round_followup", label: "Prior round follow-up" },
  { id: "strict_blocker_hunt", label: "Strict blocker hunt" },
  { id: "custom", label: "Custom" },
];

const stateLabel: Record<ExecNodeState, string> = {
  pending: "Pending",
  ready: "Ready",
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  passed: "Passed",
  needs_attention: "Needs attention",
  failed: "Failed",
  skipped: "Skipped",
  stopped: "Stopped",
};

const stateColor: Record<ExecNodeState, string> = {
  pending: "var(--exec-pending, #64748b)",
  ready: "var(--exec-ready, #3b82f6)",
  queued: "var(--exec-ready, #3b82f6)",
  running: "var(--exec-running, #f59e0b)",
  paused: "var(--exec-paused, #a855f7)",
  passed: "var(--exec-passed, #22c55e)",
  needs_attention: "var(--exec-needs, #fb923c)",
  failed: "var(--exec-failed, #ef4444)",
  skipped: "var(--exec-skipped, #475569)",
  stopped: "var(--exec-stopped, #111827)",
};

const dimColor = "var(--exec-dim-contrast, #b8c2d6)";

function useRegisterAction(_qid: string, _details: Record<string, unknown>) {
  // Replace with ux-lab's real useRegisterAction hook when integrated.
}

function useSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 900, height: 620 });

  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ width: Math.max(360, rect.width), height: Math.max(360, rect.height) });
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

function resultState(result: Record<string, unknown> | undefined): ExecNodeState {
  if (!result) return "pending";
  const status = String(result.status ?? "").toLowerCase();
  const failure = String(result.failure_type ?? "").toLowerCase();
  if (status === "skipped" || failure === "dependency_failed") return "skipped";
  if (status === "cancelled" || failure === "cancelled") return "stopped";
  if (result.ok === true) return "passed";
  if (result.ok === false) return "failed";
  return "pending";
}

function nodeResult(status: ExecStatus | undefined, nodeId: string) {
  return status?.node_results?.[nodeId];
}

function isOptionalNode(node: ExecGraphNode, result?: Record<string, unknown>) {
  if (result?.optional === true || result?.required === false) return true;
  return node.id.includes("optional") || node.type.includes("optional");
}

function runSummary(graph: ExecGraph, status: ExecStatus | undefined, states: Record<string, ExecNodeState>) {
  const lifecycle = String(status?.state ?? "unknown");
  let passed = 0;
  let failed = 0;
  let optionalFailed = 0;
  let requiredFailed = 0;
  let running = 0;
  let pending = 0;

  for (const node of graph.nodes) {
    const state = states[node.id] ?? "pending";
    const result = nodeResult(status, node.id);
    if (state === "passed") passed += 1;
    if (state === "failed") {
      failed += 1;
      if (isOptionalNode(node, result)) optionalFailed += 1;
      else requiredFailed += 1;
    }
    if (state === "running") running += 1;
    if (state === "pending" || state === "ready" || state === "queued") pending += 1;
  }

  const result =
    requiredFailed > 0
      ? `Failed · ${requiredFailed} required failed`
      : optionalFailed > 0
        ? lifecycle === "completed"
          ? `Passed with ${optionalFailed} optional failure${optionalFailed === 1 ? "" : "s"}`
          : `Required clear so far · ${optionalFailed} optional failure${optionalFailed === 1 ? "" : "s"}`
        : lifecycle === "completed"
          ? "Passed"
          : running > 0
            ? "Running"
            : "Pending";

  return { lifecycle, result, passed, failed, optionalFailed, requiredFailed, running, pending };
}

function buildStates(graph: ExecGraph, status?: ExecStatus, events: ExecEvent[] = []): Record<string, ExecNodeState> {
  const states: Record<string, ExecNodeState> = {};
  for (const node of graph.nodes) states[node.id] = "pending";

  for (const event of events) {
    if (!event.node_id) continue;
    if (event.type === "node_scheduled") states[event.node_id] = "queued";
    if (event.type === "node_started") states[event.node_id] = "running";
    if (event.type === "breakpoint_hit") states[event.node_id] = "paused";
    if (event.type === "node_finished") states[event.node_id] = "passed";
    if (event.type === "node_failed") states[event.node_id] = "failed";
    if (event.type === "node_skipped") states[event.node_id] = "skipped";
    if (event.type === "needs_attention") states[event.node_id] = "needs_attention";
  }

  for (const node of graph.nodes) {
    const terminalState = resultState(status?.node_results?.[node.id]);
    if (terminalState !== "pending") states[node.id] = terminalState;
  }

  for (const node of graph.nodes) {
    if (states[node.id] !== "pending") continue;
    const deps = node.depends_on ?? [];
    if (deps.length === 0 || deps.every((dep) => states[dep] === "passed")) states[node.id] = "ready";
  }
  return states;
}

function graphDepths(graph: ExecGraph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const computeDepth = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0;
    const node = byId.get(id);
    const deps = (node?.depends_on ?? []).filter((dependency) => byId.has(dependency));
    visiting.add(id);
    const value = deps.length === 0 ? 0 : Math.max(...deps.map(computeDepth)) + 1;
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };

  for (const node of graph.nodes) computeDepth(node.id);
  return depth;
}

function graphCanvasSize(graph: ExecGraph, width: number, height: number) {
  if (isPlanIterateGraph(graph)) {
    return {
      width: Math.max(width, 1500),
      height: Math.max(height, 920),
    };
  }
  const depth = graphDepths(graph);
  const maxDepth = Math.max(0, ...Array.from(depth.values()));
  const layers = d3.group(graph.nodes, (node) => depth.get(node.id) ?? 0);
  const widestLayer = Math.max(1, ...Array.from(layers.values()).map((layerNodes) => layerNodes.length));
  return {
    width: Math.max(width, 300 + (maxDepth + 1) * (nodeWidth + 110)),
    height: Math.max(height, 160 + widestLayer * (nodeHeight + 80)),
  };
}

function isPlanIterateGraph(graph: ExecGraph) {
  const ids = new Set(graph.nodes.map((node) => node.id));
  return ids.has("project-agent-synthesize-round-1")
    && ids.has("review-code-round-1")
    && ids.has("review-prompt-round-1")
    && ids.has("project-agent-aggregate-round-1");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampViewport(viewport: GraphViewport, canvas: { width: number; height: number }): GraphViewport {
  const zoom = clamp(viewport.zoom, 0.5, 2.5);
  const viewWidth = canvas.width / zoom;
  const viewHeight = canvas.height / zoom;
  return {
    ...viewport,
    zoom,
    offsetX: clamp(viewport.offsetX, 0, Math.max(0, canvas.width - viewWidth)),
    offsetY: clamp(viewport.offsetY, 0, Math.max(0, canvas.height - viewHeight)),
  };
}

function layout(graph: ExecGraph, states: Record<string, ExecNodeState>, width: number, height: number) {
  if (isPlanIterateGraph(graph)) return planIterateLayout(graph, states, width, height);

  const depth = graphDepths(graph);
  const maxDepth = Math.max(0, ...Array.from(depth.values()));
  const layers = d3.group(graph.nodes, (node) => depth.get(node.id) ?? 0);
  const horizontalPadding = nodeWidth / 2 + 90;
  const xScale = d3.scalePoint<number>().domain(d3.range(maxDepth + 1)).range([horizontalPadding, Math.max(horizontalPadding + nodeWidth + 96, width - horizontalPadding)]).padding(0.5);
  const nodes: LayoutNode[] = [];

  for (const [layer, layerNodes] of layers) {
    const verticalPadding = nodeHeight / 2 + 32;
    const yScale = d3.scalePoint<string>().domain(layerNodes.map((node) => node.id)).range([verticalPadding, Math.max(verticalPadding + 48, height - verticalPadding)]).padding(0.8);
    for (const node of layerNodes) {
      nodes.push({ ...node, depth: layer, state: states[node.id] ?? "pending", x: xScale(layer) ?? 120, y: yScale(node.id) ?? height / 2 });
    }
  }

  const layoutById = new Map(nodes.map((node) => [node.id, node]));
  const line = d3.line<[number, number]>().curve(d3.curveBumpX);
  const edges: LayoutEdge[] = [];
  for (const target of nodes) {
    for (const dep of target.depends_on ?? []) {
      const source = layoutById.get(dep);
      if (!source) continue;
      const mid = (source.x + target.x) / 2;
      edges.push({
        id: `${source.id}->${target.id}`,
        source,
        target,
        path: line([[source.x + nodeWidth / 2, source.y], [mid, source.y], [mid, target.y], [target.x - nodeWidth / 2, target.y]]) ?? "",
      });
    }
  }
  return { nodes, edges, bands: [] as LayoutBand[], labels: [] as LayoutLabel[] };
}

function planIterateLayout(graph: ExecGraph, states: Record<string, ExecNodeState>, width: number, height: number) {
  const center = width / 2;
  const laneGap = Math.min(470, Math.max(320, width / 4.2));
  const codeX = center - laneGap;
  const promptX = center;
  const designX = center + laneGap;
  const yGoal = 112;
  const yRound = 470;
  const ySummary = 690;
  const yValidate = Math.min(height - 110, 820);
  const fallbackDepth = graphDepths(graph);

  const positionById = new Map<string, { x: number; y: number }>([
    ["project-agent-synthesize-round-1", { x: center, y: yGoal }],
    ["review-code-round-1", { x: codeX, y: yRound }],
    ["review-prompt-round-1", { x: promptX, y: yRound }],
    ["test-interactions-round-1", { x: designX - 135, y: yRound }],
    ["review-design-round-1", { x: designX + 135, y: yRound }],
    ["project-agent-aggregate-round-1", { x: center, y: ySummary }],
    ["plan-iterate-validate-round-1", { x: center, y: yValidate }],
  ]);

  const nodes = graph.nodes.map((node, index) => {
    const fallbackX = center + ((fallbackDepth.get(node.id) ?? 0) - 2) * 260;
    const fallbackY = 180 + index * 120;
    const position = positionById.get(node.id) ?? { x: fallbackX, y: fallbackY };
    return { ...node, depth: fallbackDepth.get(node.id) ?? 0, state: states[node.id] ?? "pending", ...position };
  });

  const layoutById = new Map(nodes.map((node) => [node.id, node]));
  const line = d3.line<[number, number]>().curve(d3.curveBumpY);
  const edges: LayoutEdge[] = [];
  for (const target of nodes) {
    for (const dep of target.depends_on ?? []) {
      const source = layoutById.get(dep);
      if (!source) continue;
      const midY = (source.y + target.y) / 2;
      edges.push({
        id: `${source.id}->${target.id}`,
        source,
        target,
        path: line([[source.x, source.y + nodeHeight / 2], [source.x, midY], [target.x, midY], [target.x, target.y - nodeHeight / 2]]) ?? "",
      });
    }
  }

  return {
    nodes,
    edges,
    bands: [{
      id: "round-1",
      x: 120,
      y: yRound - 92,
      width: Math.max(0, width - 240),
      height: 184,
      label: "Round 1",
      sideLabel: "current round",
    }],
    labels: [
      { id: "lane-review-code", x: codeX, y: yRound - 142, text: "review-code" },
      { id: "lane-review-prompt", x: promptX, y: yRound - 142, text: "review-prompt" },
      { id: "lane-review-design", x: designX, y: yRound - 142, text: "review-design" },
      { id: "summary-label", x: center, y: ySummary + 82, text: "Summary" },
    ],
  };
}

function formatTimestamp(value?: string) {
  if (!value) return "no timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().replace(/\.\d{3}Z$/, "").replace("T", " ")} UTC`;
}

function jsonHeaders(headers?: HeadersInit): HeadersInit {
  const merged = new Headers(headers);
  merged.set("Content-Type", "application/json");
  return merged;
}

function formatEventTime(value?: string) {
  if (!value) return "no time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(11, 19);
}

function formatEvidenceValue(label: string, value: unknown) {
  if (value === undefined || value === null || value === "") return value;
  const lowerLabel = label.toLowerCase();
  if (lowerLabel.includes("started") || lowerLabel.includes("completed") || lowerLabel.includes("time")) {
    return formatTimestamp(String(value));
  }
  return value;
}

function titleCase(value: string) {
  return value ? value.slice(0, 1).toUpperCase() + value.slice(1).replaceAll("_", " ") : "Unknown";
}

function isReviewCodeNode(node: ExecGraphNode) {
  return /review-code|review_code/i.test(`${node.type} ${node.protocol_role ?? ""} ${node.node_goal}`);
}

function reviewContractName(scope: ReviewScopeSpec) {
  return String(scope.contract ?? scope.scope ?? "").trim();
}

function reviewCatalogAgents(catalog?: ReviewCatalog) {
  return catalog?.agents?.length ? catalog.agents : fallbackReviewCodeAgents;
}

function reviewCatalogContracts(catalog?: ReviewCatalog) {
  return catalog?.contracts?.length ? catalog.contracts : fallbackReviewCodeContracts;
}

function reviewCatalogDefaultContracts(catalog?: ReviewCatalog) {
  const contracts = reviewCatalogContracts(catalog);
  const catalogDefaults = catalog?.default_contracts?.filter(Boolean);
  if (catalogDefaults?.length) return catalogDefaults;
  const frontmatterDefaults = contracts.filter((contract) => contract.default).map((contract) => contract.id);
  return frontmatterDefaults.length ? frontmatterDefaults : reviewCodeContractFallbackIds.slice(0, 3);
}

function contractRiskTriggered(contract: string, node: ExecGraphNode, catalog?: ReviewCatalog, allNodes: ExecGraphNode[] = []) {
  const entry = reviewContractEntry(contract, catalog);
  const haystack = JSON.stringify({
    node,
    adjacent: allNodes.filter((candidate) => candidate.id === node.id || (node.depends_on ?? []).includes(candidate.id)),
  }).toLowerCase();
  if (contract === "evidence_closure_safety") {
    return /scillm|plan-iterate|phase|closure|evidence|artifact|provenance|review|orchestration|execution_result|hash/.test(haystack);
  }
  if (contract === "security") {
    return /auth|permission|secret|shell|command|file|network|deserialize|token|credential|oauth|path/.test(haystack);
  }
  const triggers = entry?.risk_triggers ?? [];
  return triggers.some((trigger) => haystack.includes(trigger.toLowerCase()));
}

function reviewCatalogDefaultContractsForNode(node: ExecGraphNode, catalog?: ReviewCatalog, allNodes: ExecGraphNode[] = []) {
  const defaults = reviewCatalogDefaultContracts(catalog);
  const contracts = reviewCatalogContracts(catalog);
  const triggered = contracts.filter((contract) => !defaults.includes(contract.id) && contractRiskTriggered(contract.id, node, catalog, allNodes)).map((contract) => contract.id);
  return [...defaults, ...triggered];
}

function _mergeReviewCatalogEntry(catalog: ReviewCatalog | undefined, kind: "agents" | "contracts", entry: ReviewCatalogEntry): ReviewCatalog {
  const base: ReviewCatalog = catalog ?? { schema_version: "scillm.exec.review_catalog.v1", skill: "review-code" };
  const current = kind === "agents" ? reviewCatalogAgents(base) : reviewCatalogContracts(base);
  const merged = [...current.filter((candidate) => candidate.id !== entry.id), entry].sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.id.localeCompare(b.id));
  return kind === "agents" ? { ...base, agents: merged } : { ...base, contracts: merged };
}

function reviewContractEntry(contract: string, catalog?: ReviewCatalog) {
  return reviewCatalogContracts(catalog).find((entry) => entry.id === contract);
}

function defaultReviewAgentForContract(contract: string, catalog?: ReviewCatalog) {
  return reviewContractEntry(contract, catalog)?.default_agent ?? "correctness-reviewer";
}

function defaultReviewModelForContract(contract: string, catalog?: ReviewCatalog) {
  const contractEntry = reviewContractEntry(contract, catalog);
  const agentEntry = reviewCatalogAgents(catalog).find((entry) => entry.id === contractEntry?.default_agent);
  return contractEntry?.default_model ?? agentEntry?.default_model ?? "oc-kimi";
}

function defaultBestPracticeSkillsForContract(contract: string, catalog?: ReviewCatalog) {
  const entry = reviewContractEntry(contract, catalog);
  if (entry?.best_practice_skills?.length) return entry.best_practice_skills;
  if (contract === "security") return ["best-practices-security", "best-practices-scillm"];
  if (contract === "evidence_closure_safety") return ["best-practices-scillm", "best-practices-self-improvement-loop", "best-practices-d3"];
  return ["best-practices-scillm", "best-practices-self-improvement-loop", "best-practices-python", "best-practices-d3"];
}

function catalogIdentityFields(entry?: ReviewCatalogEntry): Pick<ReviewScopeSpec, "catalog_id" | "catalog_version" | "catalog_sha256"> {
  return {
    catalog_id: entry?.catalog_id,
    catalog_version: entry?.version,
    catalog_sha256: entry?.catalog_sha256,
  };
}

function formatBestPracticeSkills(skills?: string[]) {
  return (skills ?? []).join(", ");
}

function parseBestPracticeSkills(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function defaultReviewScopeForContract(contract: string, node: ExecGraphNode, catalog?: ReviewCatalog): ReviewScopeSpec {
  const entry = reviewContractEntry(contract, catalog);
  return {
    scope: contract,
    contract,
    ...catalogIdentityFields(entry),
    agent: defaultReviewAgentForContract(contract, catalog),
    model: node.model || defaultReviewModelForContract(contract, catalog),
    review_level: entry?.review_level ?? (contract === "security" ? "risk_expanded" : "default"),
    proof_level: entry?.proof_level ?? (contract === "tests_validation" || contract === "evidence_closure_safety" ? "proven" : "static_confirmed"),
    reducer_policy: entry?.reducer_policy ?? (contract === "evidence_closure_safety" ? "fail_closed_evidence_closure" : "evidence_backed_only"),
    read_only: entry?.read_only ?? true,
    evidence_required: entry?.evidence_required ?? true,
    closure_authority: entry?.closure_authority ?? "final_review_gate",
    risk_triggers: entry?.risk_triggers,
    best_practice_skills: defaultBestPracticeSkillsForContract(contract, catalog),
    prompt_preset: entry?.default_preset ?? "scope_default",
    prompt: defaultReviewContractPrompt(contract, entry?.default_preset ?? "scope_default", catalog),
    inline_overrides: {},
    enabled: true,
  };
}

function defaultReviewContractPrompt(contract: string, preset = "scope_default", catalog?: ReviewCatalog) {
  const catalogPrompt = reviewContractEntry(contract, catalog)?.prompt?.trim();
  if (catalogPrompt) {
    if (preset === "prior_round_followup") {
      return `${catalogPrompt} Check the prior-round adjudication table first: implemented findings, deferred accepted findings, and rejected reviewer claims with rationale. Do not repeat rejected unsupported claims unless new evidence contradicts the rejection.`;
    }
    if (preset === "strict_blocker_hunt") {
      return `${catalogPrompt} Report only concrete merge-blocking findings with file/diff/test/log/artifact evidence. Put unsupported concerns in unsupported_or_rejected_concerns.`;
    }
    return catalogPrompt;
  }
  const contractPrompts: Record<string, string> = {
    correctness_regression: "Determine whether the diff satisfies the requested change without breaking existing behavior. Return strict JSON using the review-code scoped evidence schema.",
    tests_validation: "Determine whether validation is sufficient for the risk introduced by the diff. Return strict JSON using the review-code scoped evidence schema.",
    simplicity_maintainability: "Identify concrete unnecessary complexity introduced by this diff. Return strict JSON using the review-code scoped evidence schema.",
    evidence_closure_safety: "Check scillm evidence, provenance, artifact, review, and phase-closure invariants. Return strict JSON using the review-code scoped evidence schema.",
    security: "Review auth, permissions, secrets, shell commands, file IO, network IO, deserialization, user input, path handling, tokens, and sensitive logs. Return strict JSON using the review-code scoped evidence schema.",
  };
  if (preset === "prior_round_followup") {
    return `${contractPrompts[contract] ?? "Run this evidence contract."} Check the prior-round adjudication table first: implemented findings, deferred accepted findings, and rejected reviewer claims with rationale. Do not repeat rejected unsupported claims unless new evidence contradicts the rejection.`;
  }
  if (preset === "strict_blocker_hunt") {
    return `${contractPrompts[contract] ?? "Run this evidence contract."} Report only concrete merge-blocking findings with file/diff/test/log/artifact evidence. Put unsupported concerns in unsupported_or_rejected_concerns.`;
  }
  return contractPrompts[contract] ?? "Run this evidence contract and return strict JSON using the review-code scoped evidence schema.";
}

function modelChoices(availableModels?: string[], currentModel?: string) {
  const values = new Set(["", ...reviewCodeModelOptions, ...(availableModels ?? [])]);
  if (currentModel) values.add(currentModel);
  return Array.from(values);
}

function reviewScopeModelChoices(availableModels?: string[], scopes: ReviewScopeSpec[] = []) {
  const values = new Set(["", ...reviewCodeModelOptions, ...(availableModels ?? []).filter((model) => !isDeprecatedReviewModel(model))]);
  for (const scope of scopes) {
    if (scope.model) values.add(scope.model);
  }
  return Array.from(values);
}

function eventTone(event: ExecEvent): ExecNodeState {
  if (event.type.includes("failed") || event.state === "failed") return "failed";
  if (event.type.includes("needs_attention") || event.state === "needs_attention") return "needs_attention";
  if (event.type.includes("finished") || event.state === "passed") return "passed";
  if (event.type.includes("started") || event.state === "running") return "running";
  if (event.type.includes("skipped") || event.state === "skipped") return "skipped";
  if (event.type.includes("paused") || event.state === "paused") return "paused";
  if (event.type.includes("stopped") || event.state === "stopped") return "stopped";
  return "pending";
}

function nodeById(graph: ExecGraph, nodeId: string) {
  return graph.nodes.find((node) => node.id === nodeId);
}

function patchAuditEntry(actor: string, patch: Parameters<typeof applyPlanPatch>[1], beforeGraph: ExecGraph, afterGraph: ExecGraph): PlanAuditEntry {
  const beforeNode = "node_id" in patch ? nodeById(beforeGraph, patch.node_id) : undefined;
  const afterNode = "node_id" in patch ? nodeById(afterGraph, patch.node_id) : patch.op === "add_node" ? nodeById(afterGraph, patch.node.id) : undefined;
  const ts = new Date().toISOString();

  if (patch.op === "update_node") {
    const fields = Object.keys(patch.fields).join(", ");
    return {
      id: `${ts}-${patch.op}-${patch.node_id}`,
      ts,
      actor,
      action: "node updated",
      details: `${patch.node_id}: ${fields}`,
      before: beforeNode,
      after: afterNode,
    };
  }

  if (patch.op === "add_dependency" || patch.op === "remove_dependency") {
    return {
      id: `${ts}-${patch.op}-${patch.node_id}-${patch.depends_on}`,
      ts,
      actor,
      action: patch.op === "add_dependency" ? "dependency added" : "dependency removed",
      details: `${patch.depends_on} -> ${patch.node_id}`,
      before: beforeNode?.depends_on ?? [],
      after: afterNode?.depends_on ?? [],
    };
  }

  if (patch.op === "add_node") {
    return {
      id: `${ts}-${patch.op}-${patch.node.id}`,
      ts,
      actor,
      action: "node added",
      details: patch.node.id,
      after: nodeById(afterGraph, patch.node.id),
    };
  }

  return {
    id: `${ts}-${patch.op}-${patch.node_id}`,
    ts,
    actor,
    action: "node removed",
    details: patch.node_id,
    before: beforeNode,
  };
}

function diffRefsForChange(beforeGraph: ExecGraph, afterGraph: ExecGraph): string[] {
  return diffExecGraphPlan(beforeGraph, afterGraph).map((_, index) => `Diff ${index + 1}`);
}

function resetAuditEntry(beforeGraph: ExecGraph, afterGraph: ExecGraph): PlanAuditEntry {
  const ts = new Date().toISOString();
  return {
    id: `${ts}-reset-draft`,
    ts,
    actor: "local editor",
    action: "draft reset",
    details: "Draft returned to immutable execution graph.",
    before: beforeGraph,
    after: afterGraph,
  };
}

function rejectedPatchAuditEntry(actor: string, patch: Parameters<typeof applyPlanPatch>[1], graph: ExecGraph, issue: PlanValidationIssue, selectedNodeId: string): PlanAuditEntry {
  const ts = new Date().toISOString();
  const attemptedOperation = patchSummary(patch);
  return {
    id: `${ts}-rejected-${attemptedOperation.replaceAll(" ", "-")}`,
    ts,
    actor,
    action: "rejected patch attempt",
    details: `${attemptedOperation} · mutated_draft: false · ${issue.message}`,
    before: {
      selected_node_id: selectedNodeId,
      attempted_operation: patch,
      validation_result: issue,
      mutated_draft: false,
    },
    after: graph,
  };
}

type AmendState =
  | { status: "idle" }
  | { status: "saving"; message: string }
  | { status: "saved"; message: string; amendment_key?: string; local_amendment_id: string; diff_hash: string; saved_at: string; graph_id: string; diff_count: number; acknowledged_warning_ids: string[]; proposal_ids: string[] }
  | { status: "error"; message: string };

function formatJsonBlock(value: unknown) {
  return JSON.stringify(value ?? null, null, 2);
}

function patchSummary(patch: Parameters<typeof applyPlanPatch>[1]) {
  if (patch.op === "update_node") return `update_node ${patch.node_id}.${Object.keys(patch.fields).join(",")}`;
  if (patch.op === "add_node") return `add_node ${patch.node.id}`;
  if (patch.op === "remove_node") return `remove_node ${patch.node_id}`;
  if (patch.op === "add_dependency") return `add_dependency ${patch.depends_on} -> ${patch.node_id}`;
  return `remove_dependency ${patch.depends_on} -> ${patch.node_id}`;
}

function diffNodeIds(item: PlanDiffItem): string[] {
  const ids = new Set<string>([item.node_id]);
  if (item.dependency) ids.add(item.dependency);
  return Array.from(ids);
}

function diffParticipationSummary(item: PlanDiffItem, nodeId: string) {
  if (item.kind === "dependency_added" && item.node_id === nodeId) return `dependency added from ${String(item.dependency)}`;
  if (item.kind === "dependency_added" && item.dependency === nodeId) return `added dependency to ${item.node_id}`;
  if (item.kind === "dependency_removed" && item.node_id === nodeId) return `dependency removed: ${String(item.dependency)}`;
  if (item.kind === "dependency_removed" && item.dependency === nodeId) return `removed dependency from ${item.node_id}`;
  if (item.kind === "node_updated") return `updated ${String(item.field ?? "node")}`;
  if (item.kind === "node_added") return "added node";
  if (item.kind === "node_removed") return "removed node";
  return item.label;
}

function warningIdentity(issue: PlanValidationIssue) {
  return `${issue.code}:${issue.node_id ?? "graph"}`;
}

function localIdentity(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `local-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function cyclePathForDependency(nodeId: string, dependencyId: string, allNodes: ExecGraphNode[]) {
  const byId = new Map(allNodes.map((item) => [item.id, item]));
  const visit = (currentId: string, path: string[]): string[] | undefined => {
    if (currentId === nodeId) return [...path, currentId];
    const current = byId.get(currentId);
    for (const next of current?.depends_on ?? []) {
      if (next === nodeId) return [...path, currentId, next];
      if (path.includes(next)) continue;
      const result = visit(next, [...path, currentId]);
      if (result) return result;
    }
    return undefined;
  };
  const path = visit(dependencyId, [nodeId]);
  return path ? path.join(" -> ") : "";
}

function dependencyList(value: unknown, addedDependency?: string) {
  if (!Array.isArray(value)) return value ? [String(value)] : [];
  return value.map((item) => String(item)).map((item) => item === addedDependency ? `+ ${item}` : item);
}

function downstreamNodeIds(nodeId: string, allNodes: ExecGraphNode[]) {
  const children = new Map<string, string[]>();
  for (const node of allNodes) {
    for (const dependency of node.depends_on ?? []) {
      const existing = children.get(dependency) ?? [];
      existing.push(node.id);
      children.set(dependency, existing);
    }
  }
  const seen = new Set<string>([nodeId]);
  const stack = [...(children.get(nodeId) ?? [])];
  while (stack.length) {
    const child = stack.pop();
    if (!child || seen.has(child)) continue;
    seen.add(child);
    stack.push(...(children.get(child) ?? []));
  }
  return Array.from(seen).sort();
}

function runImpact(summary: ReturnType<typeof runSummary>) {
  if (summary.requiredFailed > 0) return `Blocking required nodes failed: ${summary.requiredFailed}`;
  if (summary.optionalFailed > 0 && summary.lifecycle === "completed") return "Run passed because 0 required nodes failed.";
  if (summary.optionalFailed > 0) return "No required failures yet; optional failure is non-blocking.";
  if (summary.lifecycle === "completed") return "Run passed because all required nodes passed.";
  return "Run result is still pending.";
}

function currentVerdict(summary: ReturnType<typeof runSummary>, terminal: boolean) {
  if (terminal) return { label: "Final result", text: summary.result };
  if (summary.requiredFailed > 0) return { label: "Current verdict", text: `Blocked — ${summary.requiredFailed} required failure${summary.requiredFailed === 1 ? "" : "s"}` };
  if (summary.optionalFailed > 0) return { label: "Current verdict", text: `Required clear so far — ${summary.optionalFailed} optional failure${summary.optionalFailed === 1 ? "" : "s"}` };
  if (summary.running > 0) return { label: "Current verdict", text: "Running" };
  return { label: "Current verdict", text: summary.result };
}

function nodeImpact(optional: boolean, state: ExecNodeState) {
  if (optional && state === "failed") return "Non-blocking because REQUIRED = no";
  if (state === "failed") return "Blocking required failure";
  if (state === "passed") return "Satisfied required evidence";
  return "No terminal impact yet";
}

function evidenceState(label: string, value: unknown, node: ExecGraphNode, optional: boolean) {
  if (value !== undefined && value !== null && value !== "") {
    return { text: String(value), tone: "present", note: "" };
  }
  const lowerLabel = label.toLowerCase();
  if (lowerLabel.includes("hash")) {
    if (optional) return { text: "Allowed optional absence", tone: "optional", note: "Optional evidence not reported." };
    if (node.type === "claude_print") return { text: "Not applicable for claude_print", tone: "na", note: "This runtime does not produce an output hash." };
    return { text: "Missing required output hash", tone: "missing", note: "Required evidence is absent." };
  }
  if (optional) return { text: "Allowed optional absence", tone: "optional", note: "Optional evidence not reported." };
  return { text: "Not reported", tone: "missing", note: "Required evidence is not reported." };
}

function outputHashState(value: unknown, optional: boolean) {
  if (value !== undefined && value !== null && value !== "") {
    return { text: String(value), tone: "present", note: "" };
  }
  if (optional) return { text: "Not reported", tone: "optional", note: "Hash not reported for optional node." };
  return { text: "Missing required output hash", tone: "missing", note: "Required evidence is absent." };
}

function evidenceStatus(result: Record<string, unknown> | undefined, optional: boolean) {
  if (optional && !result?.output_hash) return "Allowed optional absence";
  if (result?.output_hash) return "Evidence hash reported";
  return optional ? "Optional evidence not reported" : "Required evidence incomplete";
}

function artifactLabel(value: unknown) {
  return value ? "Reported artifact" : "Artifact";
}

export function ScillmExecGraphDebugger({
  graph,
  status,
  events = [],
  enablePlanEditing = false,
  nicoProposals = [],
  onAmendPlan,
  baseGraphHash = "backend-hash-unavailable",
  amendBackendLabel = "DAG-viewer draft endpoint",
  availableModels,
  reviewCatalog,
  runtimeReadiness,
  onSaveReviewCatalogEntry,
  amendments = [],
  amendmentsState = { status: "idle" },
  onRefreshAmendments,
  onSetAmendmentStatus,
  onApplyAmendment,
  onRuntimeAction,
}: {
  graph: ExecGraph;
  baseGraphHash?: string;
  status?: ExecStatus;
  events?: ExecEvent[];
  enablePlanEditing?: boolean;
  nicoProposals?: NicoPlanProposal[];
  onAmendPlan?: AmendPlanHandler;
  amendBackendLabel?: string;
  availableModels?: string[];
  reviewCatalog?: ReviewCatalog;
  runtimeReadiness?: RuntimeReadinessReport;
  onSaveReviewCatalogEntry?: SaveReviewCatalogEntryHandler;
  amendments?: ExecGraphAmendment[];
  amendmentsState?: AmendmentsLoadState;
  onRefreshAmendments?: () => void;
  onSetAmendmentStatus?: AmendmentStatusHandler;
  onApplyAmendment?: AmendmentApplyHandler;
  onRuntimeAction?: RuntimeActionHandler;
}) {
  return <ScillmExecGraphDebuggerView graph={graph} baseGraphHash={baseGraphHash} status={status} events={events} connection={{ state: "static", label: "Static snapshot" }} enablePlanEditing={enablePlanEditing} nicoProposals={nicoProposals} onAmendPlan={onAmendPlan} amendBackendLabel={amendBackendLabel} amendments={amendments} amendmentsState={amendmentsState} onRefreshAmendments={onRefreshAmendments} onSetAmendmentStatus={onSetAmendmentStatus} onApplyAmendment={onApplyAmendment} onRuntimeAction={onRuntimeAction} availableModels={availableModels} reviewCatalog={reviewCatalog} runtimeReadiness={runtimeReadiness} onSaveReviewCatalogEntry={onSaveReviewCatalogEntry} />;
}

export function ScillmExecGraphDebuggerLive({
  graph,
  runId,
  baseUrl = "",
  headers,
  pollIntervalMs = 2000,
  fetcher = fetch,
  enablePlanEditing = false,
  nicoProposals = [],
  onAmendPlan,
  availableModels: suppliedModels,
  reviewCatalog: suppliedReviewCatalog,
  runtimeReadiness,
  baseGraphHash = graph.graph_id,
}: {
  graph: ExecGraph;
  runId: string;
  baseUrl?: string;
  headers?: HeadersInit;
  pollIntervalMs?: number;
  fetcher?: typeof fetch;
  enablePlanEditing?: boolean;
  nicoProposals?: NicoPlanProposal[];
  onAmendPlan?: AmendPlanHandler;
  availableModels?: string[];
  reviewCatalog?: ReviewCatalog;
  runtimeReadiness?: RuntimeReadinessReport;
  baseGraphHash?: string;
}) {
  const [status, setStatus] = useState<ExecStatus | undefined>();
  const [events, setEvents] = useState<ExecEvent[]>([]);
  const [amendments, setAmendments] = useState<ExecGraphAmendment[]>([]);
  const [amendmentsState, setAmendmentsState] = useState<AmendmentsLoadState>({ status: "idle" });
  const [connection, setConnection] = useState<ExecGraphDebuggerConnection>({ state: "loading", label: "Connecting to exec run" });
  const [liveModels, setLiveModels] = useState<string[]>(suppliedModels ?? reviewCodeModelOptions);
  const [liveReviewCatalog, setLiveReviewCatalog] = useState<ReviewCatalog | undefined>(suppliedReviewCatalog);
  const requestSeq = useRef(0);

  async function loadAmendments() {
    setAmendmentsState({ status: "loading", message: "Loading Memory amendments." });
    try {
      const response = await fetcher(`${baseUrl}/v1/scillm/exec/graph/${encodeURIComponent(graph.graph_id)}/amendments?limit=50`, { headers });
      if (!response.ok) throw new Error(`amendments ${response.status}`);
      const payload = await response.json();
      setAmendments(Array.isArray(payload.amendments) ? payload.amendments : []);
      setAmendmentsState({ status: "loaded", message: `${Array.isArray(payload.amendments) ? payload.amendments.length : 0} amendment records loaded.` });
    } catch (error) {
      setAmendmentsState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const seq = requestSeq.current + 1;
      requestSeq.current = seq;
      try {
        const [statusResponse, eventsResponse] = await Promise.all([
          fetcher(`${baseUrl}/v1/scillm/exec/${encodeURIComponent(runId)}/status`, { headers }),
          fetcher(`${baseUrl}/v1/scillm/exec/${encodeURIComponent(runId)}/events?tail=200`, { headers }),
        ]);
        if (!statusResponse.ok) throw new Error(`status ${statusResponse.status}`);
        if (!eventsResponse.ok) throw new Error(`events ${eventsResponse.status}`);

        const nextStatus = await statusResponse.json();
        const eventPayload = await eventsResponse.json();
        if (cancelled || seq !== requestSeq.current) return;

        setStatus(nextStatus);
        setEvents(Array.isArray(eventPayload.events) ? eventPayload.events : []);
        setConnection({
          state: "live",
          label: `Live exec run · ${String(nextStatus.state ?? "unknown")}`,
          updated_at: String(nextStatus.updated_at ?? new Date().toISOString()),
        });
      } catch (error) {
        if (cancelled || seq !== requestSeq.current) return;
        setConnection({ state: "error", label: "Live exec run unavailable", error: error instanceof Error ? error.message : String(error) });
      }
    }

    void load();
    const interval = window.setInterval(() => void load(), Math.max(500, pollIntervalMs));
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [baseUrl, fetcher, headers, pollIntervalMs, runId]);

  useEffect(() => {
    if (!enablePlanEditing) return;
    void loadAmendments();
  }, [baseUrl, enablePlanEditing, graph.graph_id, headers]);

  useEffect(() => {
    if (suppliedModels?.length) {
      setLiveModels(suppliedModels.filter((model) => !isDeprecatedReviewModel(model)));
      return;
    }
    let cancelled = false;
    async function loadModels() {
      try {
        const response = await fetcher(`${baseUrl}/v1/scillm/models`, { headers });
        if (!response.ok) return;
        const payload = await response.json();
        const registry = payload && typeof payload === "object"
          ? (payload as {
              groups?: Record<string, unknown>;
              models?: Record<string, unknown>;
              aliases?: Record<string, unknown>;
              review_fanout_models?: string[];
              selectable_models?: string[];
            })
          : undefined;
        const endpointModels = registry?.review_fanout_models?.length
          ? registry.review_fanout_models
          : registry?.selectable_models?.length
            ? registry.selectable_models
            : [
                ...Object.keys(registry?.models ?? {}),
                ...Object.keys(registry?.groups ?? {}),
                ...Object.keys(registry?.aliases ?? {}),
              ];
        const modelNames = new Set(endpointModels.filter((model) => !isDeprecatedReviewModel(model)));
        if (!modelNames.size || cancelled) return;
        setLiveModels(Array.from(modelNames).sort());
      } catch {
        if (!cancelled) setLiveModels(reviewCodeModelOptions);
      }
    }
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, fetcher, headers, suppliedModels]);

  useEffect(() => {
    if (suppliedReviewCatalog) {
      setLiveReviewCatalog(suppliedReviewCatalog);
      return;
    }
    let cancelled = false;
    async function loadReviewCatalog() {
      try {
        const response = await fetcher(`${baseUrl}/v1/scillm/exec/review-catalog?skill=review-code`, { headers });
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled || !payload || typeof payload !== "object") return;
        setLiveReviewCatalog(payload as ReviewCatalog);
      } catch {
        if (!cancelled) setLiveReviewCatalog(undefined);
      }
    }
    void loadReviewCatalog();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, fetcher, headers, suppliedReviewCatalog]);

  const memoryAmendPlan: AmendPlanHandler = async (draftGraph, context) => {
    const response = await fetcher(`${baseUrl}/v1/scillm/exec/graph/amendments`, {
      method: "POST",
      headers: jsonHeaders(headers),
      body: JSON.stringify({
        graph_id: graph.graph_id,
        run_id: runId,
        base_graph_hash: context.baseGraphHash,
        base_graph: context.baseGraph,
        draft_graph: draftGraph,
        operations: context.operations,
        diff: context.diff,
        validation: context.validation,
        warning_acceptance: context.warning_acceptance,
        actor: "scillm-exec-graph-editor",
        provenance: {
          source: "ScillmExecGraphDebuggerLive",
          run_id: runId,
          status_updated_at: status?.updated_at,
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`memory amendment ${response.status}: ${text.slice(0, 240)}`);
    }
    const result = await response.json();
    await loadAmendments();
    return result;
  };

  const memorySetAmendmentStatus: AmendmentStatusHandler = async (amendmentKey, nextStatus, reason) => {
    const response = await fetcher(`${baseUrl}/v1/scillm/exec/graph/amendments/${encodeURIComponent(amendmentKey)}/status`, {
      method: "POST",
      headers: jsonHeaders(headers),
      body: JSON.stringify({
        status: nextStatus,
        actor: "scillm-exec-graph-editor",
        reason,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`amendment status ${response.status}: ${text.slice(0, 240)}`);
    }
    await loadAmendments();
    return response.json();
  };

  const memoryApplyAmendment: AmendmentApplyHandler = async (amendment, reason) => {
    const response = await fetcher(`${baseUrl}/v1/scillm/exec/graph/amendments/${encodeURIComponent(amendment._key)}/apply`, {
      method: "POST",
      headers: jsonHeaders(headers),
      body: JSON.stringify({
        actor: "scillm-exec-graph-editor",
        reason: reason ?? "Applied approved amendment from DAG editor.",
        expected_base_graph_sha256: amendment.base_graph_sha256 ?? amendment.base_graph_hash ?? amendment.baseGraphHash,
        provenance: {
          source: "ScillmExecGraphDebuggerLive",
          graph_id: amendment.graph_id,
          run_id: runId,
          status_updated_at: status?.updated_at,
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`amendment apply ${response.status}: ${text.slice(0, 240)}`);
    }
    const result = await response.json();
    await loadAmendments();
    return result;
  };

  const saveReviewCatalogEntry: SaveReviewCatalogEntryHandler = async (kind, entry) => {
    const response = await fetcher(`${baseUrl}/v1/scillm/exec/review-catalog/${kind}?skill=review-code`, {
      method: "POST",
      headers: jsonHeaders(headers),
      body: JSON.stringify({ ...entry, overwrite: true }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`review catalog save ${response.status}: ${text.slice(0, 240)}`);
    }
    const result = await response.json();
    setLiveReviewCatalog(_mergeReviewCatalogEntry(liveReviewCatalog, kind, result.entry as ReviewCatalogEntry));
    return result;
  };

  const runtimeAction: RuntimeActionHandler = async (action) => {
    const actionRunId = status?.run_id ?? runId;
    const response = await fetcher(`${baseUrl}/v1/scillm/exec/${encodeURIComponent(actionRunId)}/actions`, {
      method: "POST",
      headers: jsonHeaders(headers),
      body: JSON.stringify({
        ...action,
        actor: action.actor ?? "scillm-exec-graph-editor",
        provenance: {
          source: "ScillmExecGraphDebuggerLive",
          graph_id: graph.graph_id,
          run_id: actionRunId,
          status_updated_at: status?.updated_at,
          ...(action.provenance ?? {}),
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`runtime action ${response.status}: ${text.slice(0, 240)}`);
    }
    const result = await response.json();
    setStatus((current) => ({
      ...(current ?? {}),
      run_id: actionRunId,
      state: result.cancel_requested ? "cancel_requested" : result.paused ? "paused" : current?.state === "paused" ? "running" : current?.state,
      paused: Boolean(result.paused),
      disabled_node_ids: Array.isArray(result.disabled_node_ids) ? result.disabled_node_ids : current?.disabled_node_ids,
      runtime_actions: Array.isArray(result.runtime_actions) ? result.runtime_actions : current?.runtime_actions,
      updated_at: new Date().toISOString(),
    }));
    return result;
  };

  return <ScillmExecGraphDebuggerView graph={graph} baseGraphHash={baseGraphHash} status={status} events={events} connection={connection} enablePlanEditing={enablePlanEditing} nicoProposals={nicoProposals} onAmendPlan={onAmendPlan ?? memoryAmendPlan} amendBackendLabel="ArangoDB through Memory /upsert" amendments={amendments} amendmentsState={amendmentsState} onRefreshAmendments={loadAmendments} onSetAmendmentStatus={memorySetAmendmentStatus} onApplyAmendment={memoryApplyAmendment} onRuntimeAction={runtimeAction} availableModels={liveModels} reviewCatalog={liveReviewCatalog} runtimeReadiness={runtimeReadiness} onSaveReviewCatalogEntry={saveReviewCatalogEntry} />;
}

function ScillmExecGraphDebuggerView({
  graph,
  baseGraphHash,
  status,
  events = [],
  connection,
  enablePlanEditing = false,
  nicoProposals = [],
  onAmendPlan,
  amendBackendLabel = "No amendment backend",
  amendments = [],
  amendmentsState = { status: "idle" },
  onRefreshAmendments,
  onSetAmendmentStatus,
  onApplyAmendment,
  availableModels,
  reviewCatalog,
  runtimeReadiness,
  onSaveReviewCatalogEntry,
  onRuntimeAction,
}: {
  graph: ExecGraph;
  baseGraphHash: string;
  status?: ExecStatus;
  events?: ExecEvent[];
  connection: ExecGraphDebuggerConnection;
  enablePlanEditing?: boolean;
  nicoProposals?: NicoPlanProposal[];
  onAmendPlan?: AmendPlanHandler;
  amendBackendLabel?: string;
  amendments?: ExecGraphAmendment[];
  amendmentsState?: AmendmentsLoadState;
  onRefreshAmendments?: () => void;
  onSetAmendmentStatus?: AmendmentStatusHandler;
  onApplyAmendment?: AmendmentApplyHandler;
  availableModels?: string[];
  reviewCatalog?: ReviewCatalog;
  runtimeReadiness?: RuntimeReadinessReport;
  onSaveReviewCatalogEntry?: SaveReviewCatalogEntryHandler;
  onRuntimeAction?: RuntimeActionHandler;
}) {
  useRegisterAction("scillm-exec-graph:node:inspect", { app: "scillm", action: "SCILLM_EXEC_NODE_INSPECT", label: "Inspect node" });
  useRegisterAction("scillm-exec-graph:summary:optional-failed", { app: "scillm", action: "SCILLM_EXEC_GRAPH_SELECT_OPTIONAL_FAILURE", label: "Show optional failed node" });
  useRegisterAction("scillm-exec-graph:event:select", { app: "scillm", action: "SCILLM_EXEC_EVENT_SELECT", label: "Select event node" });
  useRegisterAction("scillm-exec-graph:event:filter", { app: "scillm", action: "SCILLM_EXEC_EVENT_FILTER", label: "Filter events" });
  useRegisterAction("scillm-exec-graph:mode:evidence", { app: "scillm", action: "SCILLM_EXEC_GRAPH_MODE_EVIDENCE", label: "Show evidence mode" });
  useRegisterAction("scillm-exec-graph:mode:plan-edit", { app: "scillm", action: "SCILLM_EXEC_GRAPH_MODE_PLAN_EDIT", label: "Show plan edit mode" });
  useRegisterAction("scillm-exec-graph:mode:nico-proposals", { app: "scillm", action: "SCILLM_EXEC_GRAPH_MODE_NICO_PROPOSALS", label: "Show Nico proposals" });
  useRegisterAction("scillm-exec-graph:amendment:load", { app: "scillm", action: "SCILLM_EXEC_AMENDMENT_LOAD_DRAFT", label: "Load amendment draft" });
  useRegisterAction("scillm-exec-graph:amendment:set-status", { app: "scillm", action: "SCILLM_EXEC_AMENDMENT_SET_STATUS", label: "Set amendment status" });
  useRegisterAction("scillm-exec-graph:amendment:apply", { app: "scillm", action: "SCILLM_EXEC_AMENDMENT_APPLY", label: "Apply approved amendment" });

  const { ref, size } = useSize();
  const [selectedId, setSelectedId] = useState(graph.nodes[0]?.id ?? "");
  const [productMode, setProductMode] = useState<DagMode>(enablePlanEditing ? "build" : "debug");
  const [mode, setMode] = useState<DebuggerMode>(enablePlanEditing ? "plan_edit" : "evidence");
  const [draftGraph, setDraftGraph] = useState<ExecGraph>(() => cloneExecGraph(graph));
  const [draftBaseGraphHash, setDraftBaseGraphHash] = useState(baseGraphHash);
  const [draftHistory, setDraftHistory] = useState<ExecGraph[]>([]);
  const [draftFuture, setDraftFuture] = useState<ExecGraph[]>([]);
  const [lastPlanIssue, setLastPlanIssue] = useState<PlanValidationIssue | undefined>();
  const [appliedProposalIds, setAppliedProposalIds] = useState<Set<string>>(() => new Set());
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [draftAuditLog, setDraftAuditLog] = useState<PlanAuditEntry[]>([]);
  const [amendState, setAmendState] = useState<AmendState>({ status: "idle" });
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [formalDiffCopied, setFormalDiffCopied] = useState(false);
  const [runtimeActionState, setRuntimeActionState] = useState<RuntimeActionUiState>({ status: "idle" });
  const [viewport, setViewport] = useState<GraphViewport>({ zoom: 1, offsetX: 0, offsetY: 0, panMode: false });
  const [followExecution, setFollowExecution] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const panDrag = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const activeGraph = mode === "evidence" ? graph : draftGraph;
  const states = useMemo(() => buildStates(graph, status, events), [events, graph, status]);
  const draftStates = useMemo(() => buildStates(draftGraph, status, events), [draftGraph, events, status]);
  const activeStates = mode === "evidence" ? states : draftStates;
  const canvasSize = useMemo(() => graphCanvasSize(activeGraph, size.width, size.height), [activeGraph, size.height, size.width]);
  const safeViewport = useMemo(() => clampViewport(viewport, canvasSize), [canvasSize, viewport]);
  const viewBoxWidth = canvasSize.width / safeViewport.zoom;
  const viewBoxHeight = canvasSize.height / safeViewport.zoom;
  const { nodes, edges, bands, labels } = useMemo(() => layout(activeGraph, activeStates, canvasSize.width, canvasSize.height), [activeGraph, activeStates, canvasSize.height, canvasSize.width]);
  const selected = activeGraph.nodes.find((node) => node.id === selectedId) ?? activeGraph.nodes[0];
  const selectedResult = selected ? nodeResult(status, selected.id) : undefined;
  const summary = useMemo(() => runSummary(graph, status, states), [graph, status, states]);
  const planValidation = useMemo(() => validateExecGraphPlan(draftGraph), [draftGraph]);
  const planDiff = useMemo(() => diffExecGraphPlan(graph, draftGraph), [draftGraph, graph]);
  const draftRuntimeReadiness = useMemo(() => runtimeReadiness ?? analyzeExecGraphRuntimeReadiness(draftGraph), [draftGraph, runtimeReadiness]);
  const dagViewModel = useMemo(() => buildDagViewModel({
    mode: productMode,
    graph,
    baseGraphHash,
    draftBaseGraphHash,
    status,
    events,
    states,
    diff: planDiff,
    validation: planValidation,
  }), [baseGraphHash, draftBaseGraphHash, events, graph, planDiff, planValidation, productMode, states, status]);
  const planDirty = planDiff.length > 0;
  const isCompleted = summary.lifecycle === "completed";
  const isTerminal = ["completed", "stopped", "failed", "cancelled"].includes(summary.lifecycle);
  const runtimeControlsDisabled = isTerminal || !onRuntimeAction || runtimeActionState.status === "submitting";
  const runtimeControlsReason = isTerminal
    ? "Runtime controls are closed because this run is terminal."
    : !onRuntimeAction
      ? "Runtime evidence is read-only because no backend action handler was provided."
      : runtimeActionState.status === "submitting"
        ? "Runtime action is being submitted."
        : "";
  const runtimeActionSummary = `${status?.paused ? "Paused" : "Running"} · ${status?.disabled_node_ids?.length ?? 0} disabled · ${status?.runtime_actions?.length ?? 0} actions`;
  const verdict = currentVerdict(summary, isTerminal);
  const currentExecutionNodeId = useMemo(() => {
    const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
    const runningNodeId = graph.nodes.find((node) => status?.running_node_ids?.includes(node.id) || states[node.id] === "running")?.id;
    if (runningNodeId) return runningNodeId;
    const latestEventNodeId = [...events].reverse().find((event) => event.node_id && graphNodeIds.has(event.node_id))?.node_id;
    if (latestEventNodeId) return latestEventNodeId;
    return graph.nodes.find((node) => states[node.id] === "pending")?.id ?? graph.nodes[0]?.id ?? "";
  }, [events, graph.nodes, states, status?.running_node_ids]);
  const filteredEvents = eventFilter === "all" ? events : events.filter((event) => event.state === eventFilter || eventTone(event) === eventFilter);
  const visibleEvents = filteredEvents.slice(-12).reverse();
  const statusTitle = [
    `Lifecycle: ${titleCase(summary.lifecycle)}`,
    `${verdict.label}: ${verdict.text}`,
    runImpact(summary),
    connection.updated_at ? `${isCompleted ? "UI last refreshed at" : "Auto-refresh checked at"} ${formatTimestamp(connection.updated_at)}` : "",
    connection.error ? `Error: ${connection.error}` : "",
  ].filter(Boolean).join("\n");
  const firstOptionalFailed = graph.nodes.find((node) => states[node.id] === "failed" && isOptionalNode(node, nodeResult(status, node.id)));
  const liveControlsReasonId = "graph-controls-unwired-reason";
  const dispatchRuntimeAction = async (action: RuntimeActionRequest) => {
    if (!onRuntimeAction || runtimeControlsDisabled) return;
    setRuntimeActionState({ status: "submitting", message: `${titleCase(action.action)} ${action.target}` });
    try {
      await onRuntimeAction(action);
      setRuntimeActionState({ status: "ok", message: `${titleCase(action.action)} accepted for ${action.target}.` });
    } catch (error) {
      setRuntimeActionState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };
  const selectNode = (nodeId: string) => {
    setFollowExecution(false);
    setSelectedId(nodeId);
    setInspectorOpen(true);
  };
  const setPrimaryMode = (nextMode: DagMode) => {
    setProductMode(nextMode);
    if (nextMode === "build") {
      setMode(mode === "nico_proposals" ? "nico_proposals" : "plan_edit");
    } else {
      setMode("evidence");
    }
  };
  const viewportControls = {
    zoomIn: () => {
      setContextMenu(null);
      setViewport((current) => {
        const nextZoom = clamp(current.zoom * 1.2, 0.5, 2.5);
        const currentViewWidth = canvasSize.width / current.zoom;
        const currentViewHeight = canvasSize.height / current.zoom;
        const nextViewWidth = canvasSize.width / nextZoom;
        const nextViewHeight = canvasSize.height / nextZoom;
        return clampViewport({
          ...current,
          zoom: nextZoom,
          offsetX: current.offsetX + (currentViewWidth - nextViewWidth) / 2,
          offsetY: current.offsetY + (currentViewHeight - nextViewHeight) / 2,
        }, canvasSize);
      });
    },
    zoomOut: () => {
      setContextMenu(null);
      setViewport((current) => {
        const nextZoom = clamp(current.zoom / 1.2, 0.5, 2.5);
        const currentViewWidth = canvasSize.width / current.zoom;
        const currentViewHeight = canvasSize.height / current.zoom;
        const nextViewWidth = canvasSize.width / nextZoom;
        const nextViewHeight = canvasSize.height / nextZoom;
        return clampViewport({
          ...current,
          zoom: nextZoom,
          offsetX: current.offsetX + (currentViewWidth - nextViewWidth) / 2,
          offsetY: current.offsetY + (currentViewHeight - nextViewHeight) / 2,
        }, canvasSize);
      });
    },
    fit: () => {
      setContextMenu(null);
      setViewport((current) => ({ ...current, zoom: 1, offsetX: 0, offsetY: 0 }));
    },
    follow: () => {
      setContextMenu(null);
      setFollowExecution((current) => !current);
    },
    togglePan: () => {
      setContextMenu(null);
      setViewport((current) => ({ ...current, panMode: !current.panMode }));
    },
  };

  function handleCanvasPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!safeViewport.panMode && event.button !== 1) return;
    if ((event.target as Element).closest(".exec-node-button")) return;
    event.preventDefault();
    setFollowExecution(false);
    setContextMenu(null);
    panDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: safeViewport.offsetX,
      offsetY: safeViewport.offsetY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = panDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = (event.clientX - drag.startX) / safeViewport.zoom;
    const deltaY = (event.clientY - drag.startY) / safeViewport.zoom;
    setViewport((current) => clampViewport({
      ...current,
      offsetX: drag.offsetX - deltaX,
      offsetY: drag.offsetY - deltaY,
    }, canvasSize));
  }

  function handleCanvasPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (panDrag.current?.pointerId !== event.pointerId) return;
    panDrag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  useEffect(() => {
    setDraftGraph(cloneExecGraph(graph));
    setDraftBaseGraphHash(baseGraphHash);
    setDraftHistory([]);
    setDraftFuture([]);
    setLastPlanIssue(undefined);
    setAppliedProposalIds(new Set());
    setDraftAuditLog([]);
    setAmendState({ status: "idle" });
  }, [baseGraphHash, graph]);

  useEffect(() => {
    setWarningsAcknowledged(false);
  }, [planValidation.warnings.length, planDirty]);

  useEffect(() => {
    if (mode !== "evidence" && !enablePlanEditing) setMode("evidence");
  }, [enablePlanEditing, mode]);

  useEffect(() => {
    if (!followExecution || !currentExecutionNodeId) return;
    const target = nodes.find((node) => node.id === currentExecutionNodeId);
    if (!target) return;
    setSelectedId(target.id);
    setViewport((current) => {
      const viewWidth = canvasSize.width / current.zoom;
      const viewHeight = canvasSize.height / current.zoom;
      return clampViewport({
        ...current,
        offsetX: target.x - viewWidth / 2,
        offsetY: target.y - viewHeight / 2,
      }, canvasSize);
    });
  }, [canvasSize, currentExecutionNodeId, followExecution, nodes]);

  useEffect(() => {
    if (activeGraph.nodes.some((node) => node.id === selectedId)) return;
    setSelectedId(activeGraph.nodes[0]?.id ?? "");
  }, [activeGraph.nodes, selectedId]);

  useEffect(() => {
    if (!isCompleted || !firstOptionalFailed) return;
    if (mode !== "evidence") return;
    if (selectedId !== graph.nodes[0]?.id) return;
    selectNode(firstOptionalFailed.id);
  }, [firstOptionalFailed, graph.nodes, isCompleted, mode, selectedId]);

  function patchDraft(patch: Parameters<typeof applyPlanPatch>[1]) {
    setDraftGraph((current) => {
      const result = applyPlanPatch(current, patch);
      setLastPlanIssue(result.issue);
      if (!result.applied) {
        if (result.issue) {
          setDraftAuditLog((log) => [rejectedPatchAuditEntry("local editor", patch, current, result.issue!, selectedId), ...log].slice(0, 12));
        }
        return current;
      }
      setDraftHistory((history) => [...history, cloneExecGraph(current)]);
      setDraftFuture([]);
      setDraftAuditLog((log) => [patchAuditEntry("local editor", patch, current, result.graph), ...log].slice(0, 12));
      setAmendState({ status: "idle" });
      setWarningsAcknowledged(false);
      return result.graph;
    });
  }

  function uniqueDraftNodeId(seed: string) {
    const safeSeed = seed.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "node";
    let index = 1;
    let candidate = `${safeSeed}-draft-${index}`;
    const ids = new Set(draftGraph.nodes.map((node) => node.id));
    while (ids.has(candidate)) {
      index += 1;
      candidate = `${safeSeed}-draft-${index}`;
    }
    return candidate;
  }

  function addDraftNode(kind: "child" | "sibling" | "gate", anchorNode: ExecGraphNode) {
    const id = uniqueDraftNodeId(kind === "gate" ? `${anchorNode.id}-gate` : `${anchorNode.id}-${kind}`);
    const node: ExecGraphNode = {
      id,
      type: kind === "gate" ? "manual_gate" : anchorNode.type,
      node_goal: kind === "gate" ? `Gate approval for ${anchorNode.id}` : `${kind === "child" ? "Child" : "Sibling"} draft for ${anchorNode.node_goal}`,
      depends_on: kind === "child" || kind === "gate" ? [anchorNode.id] : [...(anchorNode.depends_on ?? [])],
      protocol_role: kind === "gate" ? "verifier" : anchorNode.protocol_role ?? "worker",
      persona_ref: anchorNode.persona_ref,
      model: kind === "gate" ? undefined : anchorNode.model,
      prompt: kind === "gate" ? "Human gate: review upstream evidence before continuing." : "",
      gate_policy: kind === "gate" ? { kind: "human_approval", required: true, source: "dag_viewer_build_mode" } : undefined,
      metadata: { draft_only: true, created_by: "ux-lab.scillm-dag-planner", anchor_node_id: anchorNode.id, draft_operation: `add_${kind}` },
    };
    patchDraft({ op: "add_node", node });
    setSelectedId(id);
  }

  function markCommittedNode(kind: "disabled" | "archived", anchorNode: ExecGraphNode) {
    patchDraft({
      op: "update_node",
      node_id: anchorNode.id,
      fields: {
        [kind]: true,
        metadata: {
          ...(anchorNode.metadata ?? {}),
          amendment_state: kind,
          amendment_reason: `${kind} from DAG Viewer-Planner Build mode`,
        },
      },
    });
  }

  function applyProposal(proposal: NicoPlanProposal) {
    setDraftGraph((current) => {
      const result = applyNicoPlanProposal(current, proposal);
      setLastPlanIssue(result.issue);
      if (!result.applied) return current;
      setDraftHistory((history) => [...history, cloneExecGraph(current)]);
      setDraftFuture([]);
      setAppliedProposalIds((ids) => new Set(ids).add(proposal.id));
      setAmendState({ status: "idle" });
      setWarningsAcknowledged(false);
      setDraftAuditLog((log) => [
        {
          id: `${new Date().toISOString()}-proposal-${proposal.id}`,
          ts: new Date().toISOString(),
          actor: proposal.proposed_by,
          action: "proposal applied",
          details: `${proposal.title} · ${proposal.patches.length} patch${proposal.patches.length === 1 ? "" : "es"}`,
          diffRefs: diffRefsForChange(current, result.graph),
          before: current,
          after: result.graph,
        },
        ...log,
      ].slice(0, 12));
      return result.graph;
    });
  }

  function loadAmendmentDraft(amendment: ExecGraphAmendment) {
    if (!amendment.draft_graph) return;
    setMode("plan_edit");
    setDraftGraph(cloneExecGraph(amendment.draft_graph));
    setDraftBaseGraphHash(amendment.baseGraphHash ?? amendment.base_graph_hash ?? baseGraphHash);
    setDraftHistory((history) => [...history, cloneExecGraph(draftGraph)]);
    setDraftFuture([]);
    setLastPlanIssue(undefined);
    setAmendState({
      status: "saved",
      message: `Loaded amendment ${amendment._key} from Memory.`,
      amendment_key: amendment._key,
      local_amendment_id: amendment._key,
      diff_hash: localIdentity(amendment.diff ?? []),
      saved_at: amendment.updated_at ?? amendment.created_at ?? new Date().toISOString(),
      graph_id: amendment.graph_id,
      diff_count: amendment.diff?.length ?? diffExecGraphPlan(graph, amendment.draft_graph).length,
      acknowledged_warning_ids: [],
      proposal_ids: [],
    });
    setDraftAuditLog((log) => [
      {
        id: `${new Date().toISOString()}-load-amendment-${amendment._key}`,
        ts: new Date().toISOString(),
        actor: amendment.actor ?? "Memory",
        action: "amendment loaded",
        details: `${amendment._key} · ${amendment.status}`,
        before: draftGraph,
        after: amendment.draft_graph,
      },
      ...log,
    ].slice(0, 12));
  }

  function undoDraft() {
    setDraftHistory((history) => {
      const previous = history[history.length - 1];
      if (!previous) return history;
      setDraftGraph((current) => {
        setDraftFuture((future) => [cloneExecGraph(current), ...future]);
        setDraftAuditLog((log) => [{
          id: `${new Date().toISOString()}-undo-draft`,
          ts: new Date().toISOString(),
          actor: "local editor",
          action: "undo",
          details: "Returned to previous draft revision.",
          before: current,
          after: previous,
        }, ...log].slice(0, 12));
        setAmendState({ status: "idle" });
        setWarningsAcknowledged(false);
        return cloneExecGraph(previous);
      });
      return history.slice(0, -1);
    });
    setLastPlanIssue(undefined);
  }

  function redoDraft() {
    setDraftFuture((future) => {
      const next = future[0];
      if (!next) return future;
      setDraftGraph((current) => {
        setDraftHistory((history) => [...history, cloneExecGraph(current)]);
        setDraftAuditLog((log) => [{
          id: `${new Date().toISOString()}-redo-draft`,
          ts: new Date().toISOString(),
          actor: "local editor",
          action: "redo",
          details: "Restored next draft revision.",
          before: current,
          after: next,
        }, ...log].slice(0, 12));
        setAmendState({ status: "idle" });
        setWarningsAcknowledged(false);
        return cloneExecGraph(next);
      });
      return future.slice(1);
    });
    setLastPlanIssue(undefined);
  }

  async function amendDraft() {
    if (!onAmendPlan || !planDirty || amendState.status === "saving") return;
    if (dagViewModel.draft?.staleBaseGraph) {
      setAmendState({ status: "error", message: "Base graph hash changed since this draft was created. Refresh before saving the amendment draft." });
      return;
    }
    if (planValidation.warnings.length && !warningsAcknowledged) return;
    const warningAcceptance = planValidation.warnings.length
      ? {
        accepted: true,
        actor: "scillm-exec-graph-editor",
        accepted_at: new Date().toISOString(),
        warning_ids: planValidation.warnings.map(warningIdentity),
        acknowledgement_version: "scillm.exec.graph.warning_ack.v1",
        acknowledgement_text: planValidation.warnings.map((issue) => issue.code === "missing_prompt_contract" ? `I acknowledge this amendment is being saved with missing prompt contract warning for ${issue.node_id ?? "graph"}.` : `I acknowledge this amendment is being saved with ${issue.code} warning for ${issue.node_id ?? "graph"}.`),
        warnings: planValidation.warnings,
      }
      : undefined;
    setAmendState({ status: "saving", message: "Saving amendment record to shared Memory." });
    try {
      const result = await onAmendPlan(draftGraph, { baseGraph: graph, baseGraphHash, operations: dagViewModel.draft?.operations ?? [], diff: planDiff, validation: planValidation, warning_acceptance: warningAcceptance });
      const maybeResult = result as AmendmentDraftSaveResult | undefined;
      const amendmentKey = maybeResult?.amendment_key ?? maybeResult?.amendmentId;
      setAmendState({
        status: "saved",
        message: amendmentKey ? `Saved draft amendment: ${amendmentKey}` : "Saved draft amendment.",
        amendment_key: amendmentKey,
        local_amendment_id: amendmentKey ?? localIdentity({ graph_id: graph.graph_id, diff: planDiff, actor: "scillm-exec-graph-editor" }),
        diff_hash: localIdentity(planDiff),
        saved_at: new Date().toISOString(),
        graph_id: graph.graph_id,
        diff_count: planDiff.length,
        acknowledged_warning_ids: planValidation.warnings.map(warningIdentity),
        proposal_ids: Array.from(appliedProposalIds),
      });
    } catch (error) {
      setAmendState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <section className="scillm-exec-debugger" data-qid="scillm-exec-graph:debugger" aria-label="scillm exec graph debugger">
      <style>{execGraphDebuggerCss}</style>
      <div style={{ display: "grid", gridTemplateRows: "auto minmax(360px, 1fr) auto", alignContent: "start", minWidth: 0, minHeight: 0 }}>
        <header style={{ padding: 16, background: "var(--exec-panel, #151923)", borderBottom: "1px solid var(--exec-border, rgba(255,255,255,0.14))" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ color: dimColor, fontSize: 12, letterSpacing: 0, textTransform: "uppercase" }}>scillm exec graph</div>
              <h2 style={{ margin: "4px 0 0", fontSize: 18 }}>{graph.graph_id}</h2>
              <div data-qid="scillm-exec-graph:live-status" title={statusTitle} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, minHeight: 24, color: connection.state === "error" ? "var(--exec-failed, #ef4444)" : dimColor, fontSize: 12, flexWrap: "wrap" }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: summary.requiredFailed > 0 ? "var(--exec-failed, #ef4444)" : summary.optionalFailed > 0 ? "var(--exec-warning, #facc15)" : connection.state === "live" ? "var(--exec-passed, #22c55e)" : connection.state === "error" ? "var(--exec-failed, #ef4444)" : "var(--exec-running, #f59e0b)" }} />
                <strong style={{ color: connection.state === "error" ? "var(--exec-failed, #ef4444)" : "var(--exec-text, #e5e7eb)", fontWeight: 600 }}>Lifecycle: {titleCase(summary.lifecycle)}</strong>
                <strong style={{ color: summary.requiredFailed > 0 ? "var(--exec-failed, #ef4444)" : summary.optionalFailed > 0 ? "var(--exec-warning, #facc15)" : "var(--exec-passed, #22c55e)", fontWeight: 600 }}>{verdict.label}: {verdict.text}</strong>
                <span className={summary.requiredFailed > 0 ? "exec-verdict-impact exec-verdict-impact-failed" : "exec-verdict-impact"}>{runImpact(summary)}</span>
                {connection.error ? <span style={{ color: "var(--exec-failed, #ef4444)", maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{connection.error}</span> : null}
              </div>
              {connection.updated_at ? <div style={{ marginTop: 4, color: dimColor, fontSize: 12 }}>{isCompleted ? "UI last refreshed at" : "Auto-refresh checked at"} {formatTimestamp(connection.updated_at)}</div> : null}
            </div>
            <div className="exec-controls-cluster" aria-describedby={liveControlsReasonId}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  className="exec-control-button exec-control-button-compact"
                  type="button"
                  data-qid="scillm-exec-graph:runtime:pause-graph"
                  data-qs-action="SCILLM_EXEC_RUNTIME_PAUSE_GRAPH"
                  disabled={runtimeControlsDisabled}
                  aria-disabled={runtimeControlsDisabled}
                  onClick={() => void dispatchRuntimeAction({ action: "pause", target: "graph", reason: "Pause graph scheduling from DAG viewer." })}
                >
                  Pause
                </button>
                <button
                  className="exec-control-button exec-control-button-compact"
                  type="button"
                  data-qid="scillm-exec-graph:runtime:resume-graph"
                  data-qs-action="SCILLM_EXEC_RUNTIME_RESUME_GRAPH"
                  disabled={runtimeControlsDisabled}
                  aria-disabled={runtimeControlsDisabled}
                  onClick={() => void dispatchRuntimeAction({ action: "resume", target: "graph", reason: "Resume graph scheduling from DAG viewer." })}
                >
                  Resume
                </button>
                <button
                  className="exec-control-button exec-control-button-compact exec-control-button-danger"
                  type="button"
                  data-qid="scillm-exec-graph:runtime:stop-graph"
                  data-qs-action="SCILLM_EXEC_RUNTIME_STOP_GRAPH"
                  disabled={runtimeControlsDisabled}
                  aria-disabled={runtimeControlsDisabled}
                  onClick={() => void dispatchRuntimeAction({ action: "stop", target: "graph", reason: "Stop graph run from DAG viewer." })}
                >
                  Stop
                </button>
              </div>
              <div id={liveControlsReasonId} className={runtimeActionState.status === "error" ? "exec-controls-reason exec-controls-reason-error" : "exec-controls-reason"}>
                {runtimeControlsReason || runtimeActionState.message || runtimeActionSummary}
              </div>
            </div>
          </div>
          <p style={{ margin: "8px 0 0", color: dimColor, fontSize: 13, lineHeight: 1.45 }}>{graph.graph_goal}</p>
          <div className="exec-primary-mode-row" data-qid="scillm-exec-graph:primary-modes">
            {(["build", "run", "debug"] as DagMode[]).map((item) => (
              <button
                key={item}
                type="button"
                className={productMode === item ? "exec-primary-mode exec-primary-mode-active" : "exec-primary-mode"}
                data-qid={`scillm-exec-graph:primary-mode:${item}`}
                data-qs-action={`SCILLM_EXEC_PRIMARY_MODE_${item.toUpperCase()}`}
                title={item === "build" ? "Edit a draft amendment without mutating active execution" : item === "run" ? "Inspect committed/materialized runtime evidence" : "Inspect evidence, artifacts, logs, prompts, and replay context"}
                onClick={() => setPrimaryMode(item)}
              >
                <b>{titleCase(item)}</b>
                <span>{item === "build" ? "draft amendments" : item === "run" ? "read-only runtime" : "evidence trace"}</span>
              </button>
            ))}
          </div>
          <div className="exec-execution-strip" data-qid="scillm-exec-graph:execution-strip">
            <ExecutionStripGroup label="Previous" values={dagViewModel.execution.previous} empty="none" />
            <ExecutionStripGroup label="Running" values={dagViewModel.execution.running} empty="none" tone="running" />
            <ExecutionStripGroup label="Queued" values={dagViewModel.execution.queued} empty="none" />
            <ExecutionStripGroup label="Gated" values={dagViewModel.execution.gated} empty="none" tone="warning" />
            <ExecutionStripGroup label="Blocked" values={dagViewModel.execution.blocked} empty="none" tone="failed" />
          </div>
          <div className="exec-view-model-strip" data-qid="scillm-exec-graph:view-model-contract">
            <span><b>View model</b>{dagViewModel.executableNodes.length} executable nodes · {dagViewModel.executableEdges.length} executable edges</span>
            <span><b>Render-only</b>{dagViewModel.layout.syntheticNodes.length} goal · {dagViewModel.lanes.length} lanes · {dagViewModel.rounds.length} round</span>
            <span><b>Draft</b>{dagViewModel.draft ? `${dagViewModel.draft.operations.length} operations · ${dagViewModel.draft.status}` : "no semantic draft"}</span>
            <span className={dagViewModel.draft?.staleBaseGraph ? "exec-view-model-stale" : undefined}><b>Base hash</b>{baseGraphHash.slice(0, 12)}{dagViewModel.draft?.staleBaseGraph ? " · stale draft" : ""}</span>
          </div>
          {dagViewModel.draft?.staleBaseGraph ? (
            <div className="exec-stale-base-warning" data-qid="scillm-exec-graph:stale-base-warning">
              Base graph hash changed since this draft was created. Save is blocked until the DAG snapshot is refreshed or the draft is rebased.
            </div>
          ) : null}
          {enablePlanEditing ? (
            <div className="exec-mode-row" data-qid="scillm-exec-graph:mode-tabs">
              <div className="exec-mode-tabs" role="tablist" aria-label="DAG debugger mode">
                <button type="button" className={mode === "evidence" ? "exec-mode-tab exec-mode-tab-active" : "exec-mode-tab"} role="tab" aria-selected={mode === "evidence"} data-qid="scillm-exec-graph:mode:evidence" data-qs-action="SCILLM_EXEC_GRAPH_MODE_EVIDENCE" title="Show immutable execution evidence" onClick={() => setMode("evidence")}>Evidence</button>
                <button type="button" className={mode === "plan_edit" ? "exec-mode-tab exec-mode-tab-active" : "exec-mode-tab"} role="tab" aria-selected={mode === "plan_edit"} data-qid="scillm-exec-graph:mode:plan-edit" data-qs-action="SCILLM_EXEC_GRAPH_MODE_PLAN_EDIT" title={planDirty ? "Show draft plan editor; unsaved draft changes exist" : "Show draft plan editor"} onClick={() => setMode("plan_edit")}>Plan edit{planDirty ? " *" : ""}</button>
                <button type="button" className={mode === "nico_proposals" ? "exec-mode-tab exec-mode-tab-active" : "exec-mode-tab"} role="tab" aria-selected={mode === "nico_proposals"} data-qid="scillm-exec-graph:mode:nico-proposals" data-qs-action="SCILLM_EXEC_GRAPH_MODE_NICO_PROPOSALS" title="Show Nico plan proposals" onClick={() => setMode("nico_proposals")}>Nico proposals</button>
              </div>
              <span className={!planValidation.canApply ? "exec-plan-chip exec-plan-chip-blocking" : planDirty ? "exec-plan-chip exec-plan-chip-dirty" : "exec-plan-chip exec-plan-chip-ok"} data-qid="scillm-exec-graph:plan-validation-chip">
                {planDirty ? "Unsaved draft · " : ""}{planValidation.blocking.length} blocking · {planValidation.warnings.length} warnings · {planDiff.length} changes
              </span>
              <span className={draftRuntimeReadiness.can_execute_runtime ? "exec-plan-chip exec-plan-chip-ok" : "exec-plan-chip exec-plan-chip-blocking"} data-qid="scillm-exec-graph:runtime-readiness-chip" title="Plan-iterate execution readiness for the current draft graph">
                {draftRuntimeReadiness.summary.blocked_node_count} missing-field nodes · {draftRuntimeReadiness.summary.manual_node_count} manual
              </span>
              {mode === "evidence" ? <span className="exec-plan-chip exec-plan-chip-readonly">Read-only evidence</span> : null}
            </div>
          ) : null}
          <div data-qid="scillm-exec-graph:run-summary" title="Run result summary" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
            <span className="exec-summary-label">Summary</span>
            <span className="exec-summary-chip exec-summary-chip-passed">{summary.passed} passed</span>
            {summary.optionalFailed ? (
              <>
                <span className="exec-summary-chip exec-summary-chip-warning">{summary.optionalFailed} optional failed</span>
                <button className="exec-summary-action-button" type="button" data-qid="scillm-exec-graph:summary:optional-failed" data-qs-action="SCILLM_EXEC_GRAPH_SELECT_OPTIONAL_FAILURE" title="Focus optional failure node" aria-label={`Focus optional failure node${summary.optionalFailed === 1 ? "" : "s"}`} onClick={() => {
                  if (firstOptionalFailed) selectNode(firstOptionalFailed.id);
                }}>Focus optional failure</button>
              </>
            ) : null}
            {summary.requiredFailed ? <span className="exec-summary-chip exec-summary-chip-failed">{summary.requiredFailed} required failed</span> : null}
            <span className="exec-summary-chip">{summary.running} running</span>
          </div>
        </header>

        <div
          ref={ref}
          data-qid="scillm-exec-graph:canvas"
          title="Execution graph canvas"
          style={{ minHeight: 0, position: "relative" }}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <div className="exec-canvas-toolbar" data-qid="scillm-exec-graph:canvas:toolbar" aria-label="Graph viewport controls">
            <button type="button" className="exec-canvas-tool-button" data-qid="scillm-exec-graph:canvas:zoom-in" data-qs-action="SCILLM_EXEC_CANVAS_ZOOM_IN" title="Zoom in" onClick={viewportControls.zoomIn}><ZoomIn size={15} /></button>
            <button type="button" className="exec-canvas-tool-button" data-qid="scillm-exec-graph:canvas:zoom-out" data-qs-action="SCILLM_EXEC_CANVAS_ZOOM_OUT" title="Zoom out" onClick={viewportControls.zoomOut}><ZoomOut size={15} /></button>
            <button type="button" className={followExecution ? "exec-canvas-tool-button exec-canvas-tool-button-active" : "exec-canvas-tool-button"} data-qid="scillm-exec-graph:canvas:follow-current" data-qs-action="SCILLM_EXEC_CANVAS_FOLLOW_CURRENT" title={currentExecutionNodeId ? `${followExecution ? "Following" : "Follow"} current node: ${currentExecutionNodeId}` : "Follow current execution node"} onClick={viewportControls.follow}><LocateFixed size={15} /></button>
            <button type="button" className={safeViewport.panMode ? "exec-canvas-tool-button exec-canvas-tool-button-active" : "exec-canvas-tool-button"} data-qid="scillm-exec-graph:canvas:pan" data-qs-action="SCILLM_EXEC_CANVAS_TOGGLE_PAN" title={safeViewport.panMode ? "Move mode on: drag the graph to pan" : "Move graph"} onClick={viewportControls.togglePan}><Move size={15} /></button>
            <button type="button" className="exec-canvas-tool-button" data-qid="scillm-exec-graph:canvas:fit" data-qs-action="SCILLM_EXEC_CANVAS_FIT" title="Fit graph" onClick={viewportControls.fit}><Maximize2 size={15} /></button>
            <span className="exec-canvas-zoom-label">{Math.round(safeViewport.zoom * 100)}%</span>
          </div>
          <div className="exec-canvas-legend">{mode === "evidence" ? "Evidence edges" : "Draft dependencies"} <span aria-hidden>→</span></div>
          <div className="exec-canvas-keyboard-hint">Keyboard: Tab to a node, arrows move selection, Enter or Space inspects.</div>
          {contextMenu ? (
            <div className="exec-canvas-context-menu" data-qid="scillm-exec-graph:canvas:context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu">
              <button type="button" role="menuitem" onClick={viewportControls.zoomIn}><ZoomIn size={14} />Zoom in</button>
              <button type="button" role="menuitem" onClick={viewportControls.zoomOut}><ZoomOut size={14} />Zoom out</button>
              <button type="button" role="menuitem" onClick={viewportControls.follow}><LocateFixed size={14} />{followExecution ? "Stop following" : "Follow current"}</button>
              <button type="button" role="menuitem" onClick={viewportControls.togglePan}><Move size={14} />{safeViewport.panMode ? "Turn move off" : "Move graph"}</button>
              <button type="button" role="menuitem" onClick={viewportControls.fit}><Maximize2 size={14} />Fit graph</button>
            </div>
          ) : null}
          <svg
            role="img"
            aria-label={mode === "evidence" ? "Live scillm exec DAG" : "Draft scillm exec DAG"}
            viewBox={`${safeViewport.offsetX} ${safeViewport.offsetY} ${viewBoxWidth} ${viewBoxHeight}`}
            preserveAspectRatio="xMidYMid meet"
            data-pan-mode={safeViewport.panMode ? "true" : "false"}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerCancel={handleCanvasPointerUp}
            onClick={() => setContextMenu(null)}
            style={{ display: "block", width: "100%", height: "100%", cursor: safeViewport.panMode ? "grab" : "default" }}
          >
            <defs><marker id="exec-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--exec-dim, #94a3b8)" /></marker></defs>
            <g aria-hidden="true">{bands.map((band) => (
              <g key={band.id}>
                <rect className="exec-round-band" x={band.x} y={band.y} width={band.width} height={band.height} rx="28" />
                <text className="exec-round-band-label" x={band.x + 42} y={band.y + band.height / 2 + 5}>{band.label}</text>
                {band.sideLabel ? <text className="exec-round-band-side-label" x={band.x + band.width + 28} y={band.y + band.height / 2 - 8}>{band.sideLabel}</text> : null}
              </g>
            ))}</g>
            <g aria-hidden="true">{labels.map((label) => (
              <text key={label.id} className="exec-lane-label" x={label.x} y={label.y}>{label.text}</text>
            ))}</g>
            <g aria-hidden="true">{edges.map((edge) => {
              const selectedEdge = edge.source.id === selected?.id || edge.target.id === selected?.id;
              return <path key={edge.id} d={edge.path} fill="none" stroke={selectedEdge ? "var(--exec-selected-ring, #22d3ee)" : "var(--exec-edge, #6b7280)"} strokeWidth={selectedEdge ? 2.5 : 1.75} opacity={selectedEdge ? 0.95 : 0.72} markerEnd="url(#exec-arrow)" />;
            })}</g>
            <g>{nodes.map((node, index) => {
              const nodeIssues = mode === "evidence" ? [] : planValidation.issues.filter((issue) => issue.node_id === node.id);
              return <GraphNode key={node.id} node={node} result={nodeResult(status, node.id)} optional={isOptionalNode(node, nodeResult(status, node.id))} selected={node.id === selected?.id} validationIssues={nodeIssues} onSelect={() => selectNode(node.id)} onSelectAdjacent={(direction) => {
              const next = nodes[(index + direction + nodes.length) % nodes.length];
              if (next) selectNode(next.id);
            }} />;
            })}</g>
          </svg>
        </div>

        <footer style={{ padding: 12, background: "var(--exec-panel, #151923)", borderTop: "1px solid var(--exec-border, rgba(255,255,255,0.14))" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, color: "var(--exec-dim-contrast)", fontSize: 13, lineHeight: "18px", fontWeight: 600, marginBottom: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span>Recent events · time UTC; full timestamp on hover</span>
              <StateLegend />
              <label className="exec-event-filter">
                <span>Filter</span>
                <select
                  value={eventFilter}
                  className="exec-plan-input exec-event-filter-select"
                  data-qid="scillm-exec-graph:event:filter"
                  data-qs-action="SCILLM_EXEC_EVENT_FILTER"
                  title="Filter recent events by state"
                  onChange={(event) => setEventFilter(event.target.value as EventFilter)}
                >
                  <option value="all">All</option>
                  <option value="passed">Passed</option>
                  <option value="running">Running</option>
                  <option value="failed">Failed</option>
                  <option value="pending">Pending</option>
                  <option value="needs_attention">Needs attention</option>
                  <option value="skipped">Skipped</option>
                  <option value="paused">Paused</option>
                  <option value="stopped">Stopped</option>
                </select>
              </label>
            </div>
            <span>Showing {visibleEvents.length} of {filteredEvents.length} filtered events · {activeGraph.nodes.length} nodes</span>
          </div>
          {enablePlanEditing && mode !== "evidence" ? (
            <PlanDraftPanel
              mode={mode}
              validation={planValidation}
              diff={planDiff}
              runtimeReadiness={draftRuntimeReadiness}
              dirty={planDirty}
              lastIssue={lastPlanIssue}
              nicoProposals={nicoProposals}
              draftGraph={draftGraph}
              auditLog={draftAuditLog}
              appliedProposalIds={appliedProposalIds}
              canAmend={Boolean(onAmendPlan)}
              graphId={graph.graph_id}
              baseGraphHash={baseGraphHash}
              draftBaseGraphHash={draftBaseGraphHash}
              staleBaseGraph={Boolean(dagViewModel.draft?.staleBaseGraph)}
              amendmentOperations={dagViewModel.draft?.operations ?? []}
              amendBackendLabel={amendBackendLabel}
              amendState={amendState}
              warningsAcknowledged={warningsAcknowledged}
              onWarningsAcknowledgedChange={setWarningsAcknowledged}
              formalDiffCopied={formalDiffCopied}
              amendments={amendments}
              amendmentsState={amendmentsState}
              canUndo={draftHistory.length > 0}
              canRedo={draftFuture.length > 0}
              onUndo={undoDraft}
              onRedo={redoDraft}
              onReset={() => {
                const original = cloneExecGraph(graph);
                setDraftAuditLog((log) => [resetAuditEntry(draftGraph, original), ...log].slice(0, 12));
                setDraftGraph(cloneExecGraph(graph));
                setDraftBaseGraphHash(baseGraphHash);
                setDraftHistory([]);
                setDraftFuture([]);
                setLastPlanIssue(undefined);
                setAppliedProposalIds(new Set());
                setAmendState({ status: "idle" });
                setWarningsAcknowledged(false);
              }}
              onExportDiff={() => {
                void navigator.clipboard?.writeText(JSON.stringify({
                  graph_id: graph.graph_id,
                  actor: "scillm-exec-graph-editor",
                  timestamp: new Date().toISOString(),
                  base_graph_hash: baseGraphHash,
                  draft_base_graph_hash: draftBaseGraphHash,
                  base_graph_revision: status?.updated_at ?? null,
                  amendment_id: amendState.status === "saved" ? amendState.local_amendment_id : null,
                  diff_hash: localIdentity(planDiff),
                  operations: dagViewModel.draft?.operations ?? [],
                  warning_acknowledgements: planValidation.warnings.map((issue) => ({ id: warningIdentity(issue), code: issue.code, node_id: issue.node_id ?? null, acknowledged: warningsAcknowledged })),
                  proposal_provenance: Array.from(appliedProposalIds),
                  base_graph: graph,
                  draft_graph: draftGraph,
                  diff: planDiff,
                }, null, 2));
                setFormalDiffCopied(true);
                window.setTimeout(() => setFormalDiffCopied(false), 1400);
              }}
              onAmend={() => void amendDraft()}
              onRefreshAmendments={onRefreshAmendments}
              onLoadAmendment={loadAmendmentDraft}
              onSetAmendmentStatus={onSetAmendmentStatus}
              onApplyAmendment={onApplyAmendment}
              onApplyProposal={applyProposal}
              onSelectNode={selectNode}
            />
          ) : null}
          <div className="exec-events-list">{visibleEvents.map((event, index) => {
            const canSelect = Boolean(event.node_id && activeGraph.nodes.some((node) => node.id === event.node_id));
            return (
            <button
              key={`${event.ts ?? "event"}-${index}`}
              type="button"
              className={event.node_id === selectedId ? "exec-event-row exec-event-row-selected" : "exec-event-row"}
              data-qid={`scillm-exec-graph:event:${event.node_id ?? "system"}:${index}`}
              data-qs-action="SCILLM_EXEC_EVENT_SELECT"
              title={[event.ts, event.type, event.node_id ? `Select node ${event.node_id}` : "System event", event.text].filter(Boolean).join(" · ")}
              disabled={!canSelect}
              aria-disabled={!canSelect}
              aria-current={event.node_id === selectedId ? "true" : undefined}
              onClick={() => {
              if (event.node_id) selectNode(event.node_id);
            }}>
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: stateColor[eventTone(event)] }} />
              <span className="exec-event-time">{formatEventTime(event.ts)}</span>
              <strong>{event.type}</strong>
              <span>{event.node_id ? `${event.node_id}${event.text ? ` · ${event.text}` : ""}` : event.text ?? "system"}</span>
            </button>
          );})}</div>
        </footer>
      </div>

      {selected && !inspectorOpen ? (
        <button
          type="button"
          className="exec-inspector-reopen"
          data-qid="scillm-exec-graph:node-inspector:open"
          title="Open node inspector"
          onClick={() => setInspectorOpen(true)}
        >
          Node Inspector
        </button>
      ) : null}

      <aside
        data-qid="scillm-exec-graph:node-inspector"
        data-open={inspectorOpen ? "true" : "false"}
        className="exec-node-inspector-slideout"
        aria-hidden={!inspectorOpen}
      >
        <div className="exec-node-inspector-bar">
          <span>Node Inspector</span>
          <button type="button" className="exec-canvas-tool-button" data-qid="scillm-exec-graph:node-inspector:close" data-qs-action="SCILLM_EXEC_NODE_INSPECTOR_CLOSE" title="Close node inspector" onClick={() => setInspectorOpen(false)}>
            <X size={15} />
          </button>
        </div>
        {selected ? (
          <Inspector
            node={selected}
            state={activeStates[selected.id] ?? "pending"}
            result={selectedResult}
            optional={isOptionalNode(selected, selectedResult)}
            onSelectNode={selectNode}
            mode={mode}
            allNodes={activeGraph.nodes}
            validation={planValidation}
            diff={planDiff}
            runtimeReadinessNode={mode === "evidence" ? undefined : draftRuntimeReadiness.nodes.find((report) => report.node_id === selected.id)}
            onUpdateNode={mode === "plan_edit" ? (fields) => patchDraft({ op: "update_node", node_id: selected.id, fields }) : undefined}
            onAddDependency={mode === "plan_edit" ? (dependency) => patchDraft({ op: "add_dependency", node_id: selected.id, depends_on: dependency }) : undefined}
            onRemoveDependency={mode === "plan_edit" ? (dependency) => patchDraft({ op: "remove_dependency", node_id: selected.id, depends_on: dependency }) : undefined}
            onAddChild={mode === "plan_edit" ? () => addDraftNode("child", selected) : undefined}
            onAddSibling={mode === "plan_edit" ? () => addDraftNode("sibling", selected) : undefined}
            onAddGate={mode === "plan_edit" ? () => addDraftNode("gate", selected) : undefined}
            onDisableNode={mode === "plan_edit" ? () => markCommittedNode("disabled", selected) : undefined}
            onArchiveNode={mode === "plan_edit" ? () => markCommittedNode("archived", selected) : undefined}
            availableModels={availableModels}
            reviewCatalog={reviewCatalog}
            onSaveReviewCatalogEntry={onSaveReviewCatalogEntry}
            status={status}
            runTerminal={isTerminal}
            onRuntimeAction={onRuntimeAction ? dispatchRuntimeAction : undefined}
            runtimeActionState={runtimeActionState}
          />
        ) : <div style={{ padding: 16 }}>Select a node.</div>}
      </aside>
    </section>
  );
}

function ExecutionStripGroup({ label, values, empty, tone }: { label: string; values: string[]; empty: string; tone?: "running" | "warning" | "failed" }) {
  return (
    <div className={`exec-execution-group${tone ? ` exec-execution-group-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{values.length ? values.slice(-3).join(", ") : empty}</strong>
    </div>
  );
}

function StateLegend() {
  const states: ExecNodeState[] = ["passed", "running", "failed", "pending", "needs_attention", "skipped"];
  return (
    <span aria-label="Node state legend" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      {states.map((state) => (
        <span key={state} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: stateColor[state] }} />
          <span>{stateLabel[state]}</span>
        </span>
      ))}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span aria-hidden style={{ width: 14, height: 10, borderRadius: 999, border: "2px solid var(--exec-selected-ring, #7aa2ff)" }} />
        <span>Selected node</span>
      </span>
      <span>Edges: depends on</span>
    </span>
  );
}

function GraphNode({ node, result, optional, selected, validationIssues, onSelect, onSelectAdjacent }: { node: LayoutNode; result?: Record<string, unknown>; optional: boolean; selected: boolean; validationIssues: PlanValidationIssue[]; onSelect: () => void; onSelectAdjacent: (direction: -1 | 1) => void }) {
  const statusText = optional && node.state === "failed" ? "Optional failed" : stateLabel[node.state];
  const hasBlockingIssue = validationIssues.some((issue) => issue.severity === "blocking");
  const hasValidationIssue = validationIssues.length > 0;
  const blockingCount = validationIssues.filter((issue) => issue.severity === "blocking").length;
  const optionalBorder = optional ? "2px dashed var(--exec-optional-border, #9ca35a)" : `2px solid ${stateColor[node.state]}`;
  const validationBorder = hasBlockingIssue ? "3px solid var(--exec-failed, #ef4444)" : hasValidationIssue ? "2px dashed var(--exec-warning, #facc15)" : optionalBorder;
  const nodeClassName = [
    "exec-node-button",
    selected ? "exec-node-button-selected" : "",
    hasBlockingIssue ? "exec-node-button-blocking" : "",
  ].filter(Boolean).join(" ");

  return (
    <foreignObject x={node.x - nodeWidth / 2 - 8} y={node.y - nodeHeight / 2 - 8} width={nodeWidth + 16} height={nodeHeight + 16}>
      <button
        className={nodeClassName}
        data-qid={`scillm-exec-graph:node:${node.id}`}
        data-qs-action="SCILLM_EXEC_NODE_INSPECT"
        aria-label={`Inspect node ${node.id}, ${statusText}${hasBlockingIssue ? `, ${blockingCount} blocking plan issue${blockingCount === 1 ? "" : "s"}` : ""}`}
        aria-current={selected ? "true" : undefined}
        title={`Inspect ${node.id}\nType: ${node.type}\nState: ${statusText}${hasValidationIssue ? `\nPlan validation: ${validationIssues.map((issue) => issue.message).join("; ")}` : ""}\nGoal: ${node.node_goal}`}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            onSelectAdjacent(1);
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            onSelectAdjacent(-1);
          }
        }}
        style={{
          width: `${nodeWidth}px`,
          minHeight: `${nodeHeight}px`,
          boxSizing: "border-box",
          borderRadius: 8,
          border: validationBorder,
          background: "var(--exec-card, #1c2230)",
          color: "var(--exec-text, #e5e7eb)",
          cursor: "pointer",
          display: "grid",
          gridTemplateColumns: "22px minmax(0, 1fr)",
          gridTemplateRows: "auto auto auto",
          alignItems: "center",
          columnGap: 8,
          rowGap: 3,
          padding: "10px 12px",
          textAlign: "left",
          font: "inherit",
        }}
      >
        {hasBlockingIssue ? <span className="exec-node-blocking-icon" aria-hidden>!</span> : <span aria-hidden style={{ gridRow: "1 / span 3", width: 14, height: 14, borderRadius: 999, background: stateColor[node.state] }} />}
        <span style={{ minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere", fontSize: 12, lineHeight: "15px", fontWeight: 700 }}>{node.id}</span>
        <span style={{ minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere", color: dimColor, fontSize: 11, lineHeight: "14px" }}>{node.type}</span>
        <span className={optional && node.state === "failed" ? "exec-node-status exec-node-status-warning" : "exec-node-status"}>{statusText}</span>
        {optional ? <span className="exec-node-optional-badge">Optional</span> : null}
        {hasValidationIssue ? <span className={hasBlockingIssue ? "exec-node-validation-badge exec-node-validation-badge-blocking" : "exec-node-validation-badge"}>{hasBlockingIssue ? `${blockingCount} Block` : "Plan warning"}</span> : null}
      </button>
    </foreignObject>
  );
}

function Inspector({
  node,
  state,
  result,
  optional,
  onSelectNode,
  mode = "evidence",
  allNodes = [],
  validation,
  diff,
  runtimeReadinessNode,
  onUpdateNode,
  onAddDependency,
  onRemoveDependency,
  onAddChild,
  onAddSibling,
  onAddGate,
  onDisableNode,
  onArchiveNode,
  availableModels,
  reviewCatalog,
  onSaveReviewCatalogEntry,
  status,
  runTerminal = false,
  onRuntimeAction,
  runtimeActionState,
}: {
  node: ExecGraphNode;
  state: ExecNodeState;
  result?: Record<string, unknown>;
  optional: boolean;
  onSelectNode: (nodeId: string) => void;
  mode?: DebuggerMode;
  allNodes?: ExecGraphNode[];
  validation?: PlanValidationResult;
  diff?: PlanDiffItem[];
  runtimeReadinessNode?: RuntimeReadinessNodeReport;
  onUpdateNode?: (fields: Partial<ExecGraphNode>) => void;
  onAddDependency?: (nodeId: string) => void;
  onRemoveDependency?: (nodeId: string) => void;
  onAddChild?: () => void;
  onAddSibling?: () => void;
  onAddGate?: () => void;
  onDisableNode?: () => void;
  onArchiveNode?: () => void;
  availableModels?: string[];
  reviewCatalog?: ReviewCatalog;
  onSaveReviewCatalogEntry?: SaveReviewCatalogEntryHandler;
  status?: ExecStatus;
  runTerminal?: boolean;
  onRuntimeAction?: RuntimeActionHandler;
  runtimeActionState?: RuntimeActionUiState;
}) {
  useRegisterAction("scillm-exec-graph:plan-edit:goal", { app: "scillm", action: "SCILLM_EXEC_PLAN_EDIT_GOAL", label: "Edit node goal" });
  useRegisterAction("scillm-exec-graph:plan-edit:type", { app: "scillm", action: "SCILLM_EXEC_PLAN_EDIT_TYPE", label: "Edit node type" });
  useRegisterAction("scillm-exec-graph:plan-edit:role", { app: "scillm", action: "SCILLM_EXEC_PLAN_EDIT_ROLE", label: "Edit node role" });
  useRegisterAction("scillm-exec-graph:plan-edit:persona", { app: "scillm", action: "SCILLM_EXEC_PLAN_EDIT_PERSONA", label: "Edit node persona" });
  useRegisterAction("scillm-exec-graph:plan-edit:model", { app: "scillm", action: "SCILLM_EXEC_PLAN_EDIT_MODEL", label: "Edit node model" });
  useRegisterAction("scillm-exec-graph:plan-edit:prompt", { app: "scillm", action: "SCILLM_EXEC_PLAN_EDIT_PROMPT", label: "Edit node prompt" });
  useRegisterAction("scillm-exec-graph:plan-edit:review-contract", { app: "scillm", action: "SCILLM_EXEC_PLAN_EDIT_REVIEW_CONTRACT", label: "Edit review contract" });
  useRegisterAction("scillm-exec-graph:plan-edit:review-contract-agent", { app: "scillm", action: "SCILLM_EXEC_PLAN_EDIT_REVIEW_CONTRACT_AGENT", label: "Edit review contract agent" });
  useRegisterAction("scillm-exec-graph:plan-edit:review-contract-model", { app: "scillm", action: "SCILLM_EXEC_PLAN_EDIT_REVIEW_CONTRACT_MODEL", label: "Edit review contract model" });
  useRegisterAction("scillm-exec-graph:plan-edit:review-level", { app: "scillm", action: "SCILLM_EXEC_PLAN_EDIT_REVIEW_LEVEL", label: "Edit review level" });
  useRegisterAction("scillm-exec-graph:plan-edit:review-proof-level", { app: "scillm", action: "SCILLM_EXEC_PLAN_EDIT_REVIEW_PROOF_LEVEL", label: "Edit review proof level" });
  useRegisterAction("scillm-exec-graph:plan-edit:review-read-only", { app: "scillm", action: "SCILLM_EXEC_PLAN_EDIT_REVIEW_READ_ONLY", label: "Edit review read-only flag" });
  useRegisterAction("scillm-exec-graph:plan-edit:review-contract-prompt", { app: "scillm", action: "SCILLM_EXEC_PLAN_EDIT_REVIEW_CONTRACT_PROMPT", label: "Edit review contract prompt" });
  useRegisterAction("scillm-exec-graph:plan-edit:review-contract-preset", { app: "scillm", action: "SCILLM_EXEC_PLAN_EDIT_REVIEW_CONTRACT_PRESET", label: "Edit review contract preset" });
  useRegisterAction("scillm-exec-graph:plan-edit:review-contract-duplicate", { app: "scillm", action: "SCILLM_EXEC_PLAN_DUPLICATE_REVIEW_SCOPE", label: "Duplicate review contract row" });
  useRegisterAction("scillm-exec-graph:plan-edit:dependency-select", { app: "scillm", action: "SCILLM_EXEC_PLAN_SELECT_DEPENDENCY", label: "Select dependency" });
  useRegisterAction("scillm-exec-graph:plan-edit:add-dependency", { app: "scillm", action: "SCILLM_EXEC_PLAN_ADD_DEPENDENCY", label: "Add dependency" });
  useRegisterAction("scillm-exec-graph:plan-edit:remove-dependency", { app: "scillm", action: "SCILLM_EXEC_PLAN_REMOVE_DEPENDENCY", label: "Remove dependency" });
  useRegisterAction("scillm-exec-graph:plan-edit:add-child", { app: "scillm", action: "SCILLM_EXEC_PLAN_ADD_CHILD", label: "Add child node" });
  useRegisterAction("scillm-exec-graph:plan-edit:add-sibling", { app: "scillm", action: "SCILLM_EXEC_PLAN_ADD_SIBLING", label: "Add sibling node" });
  useRegisterAction("scillm-exec-graph:plan-edit:add-gate", { app: "scillm", action: "SCILLM_EXEC_PLAN_ADD_GATE", label: "Add gate node" });
  useRegisterAction("scillm-exec-graph:plan-edit:disable-node", { app: "scillm", action: "SCILLM_EXEC_PLAN_DISABLE_NODE", label: "Disable node" });
  useRegisterAction("scillm-exec-graph:plan-edit:archive-node", { app: "scillm", action: "SCILLM_EXEC_PLAN_ARCHIVE_NODE", label: "Archive node" });
  useRegisterAction("scillm-exec-graph:runtime:pause-node", { app: "scillm", action: "SCILLM_EXEC_RUNTIME_PAUSE_NODE", label: "Pause node" });
  useRegisterAction("scillm-exec-graph:runtime:resume-node", { app: "scillm", action: "SCILLM_EXEC_RUNTIME_RESUME_NODE", label: "Resume node" });
  useRegisterAction("scillm-exec-graph:runtime:disable-node", { app: "scillm", action: "SCILLM_EXEC_RUNTIME_DISABLE_NODE", label: "Disable runtime node" });
  useRegisterAction("scillm-exec-graph:runtime:pause-subtree", { app: "scillm", action: "SCILLM_EXEC_RUNTIME_PAUSE_SUBTREE", label: "Pause subtree" });
  useRegisterAction("scillm-exec-graph:runtime:resume-subtree", { app: "scillm", action: "SCILLM_EXEC_RUNTIME_RESUME_SUBTREE", label: "Resume subtree" });
  useRegisterAction("scillm-exec-graph:runtime:disable-subtree", { app: "scillm", action: "SCILLM_EXEC_RUNTIME_DISABLE_SUBTREE", label: "Disable runtime subtree" });
  useRegisterAction("scillm-exec-graph:runtime:stop-node", { app: "scillm", action: "SCILLM_EXEC_RUNTIME_STOP_NODE", label: "Stop run from node" });
  useRegisterAction("scillm-exec-graph:runtime:stop-subtree", { app: "scillm", action: "SCILLM_EXEC_RUNTIME_STOP_SUBTREE", label: "Stop run from subtree" });
  const [copied, setCopied] = useState(false);
  const [catalogSaveState, setCatalogSaveState] = useState<string>("");
  const [dependencyChoice, setDependencyChoice] = useState("");
  const promptPayload = JSON.stringify({ prompt: node.prompt, review_scopes: node.review_scopes, messages: node.messages, output_schema: node.output_schema }, null, 2);
  const hasPromptPayload = Boolean(node.prompt || node.review_scopes?.length || node.messages?.length || node.output_schema);
  const dependencies = node.depends_on ?? [];
  const dependencyOptions = allNodes
    .filter((candidate) => candidate.id !== node.id && !dependencies.includes(candidate.id))
    .map((candidate) => {
      const cyclePath = cyclePathForDependency(node.id, candidate.id, allNodes);
      return { node: candidate, cyclePath };
    });
  const selectedDependencyOption = dependencyOptions.find((candidate) => candidate.node.id === dependencyChoice);
  const nodeValidationIssues = validation?.issues.filter((issue) => issue.node_id === node.id) ?? [];
  const nodeBlockingIssues = nodeValidationIssues.filter((issue) => issue.severity === "blocking");
  const nodeWarnings = nodeValidationIssues.filter((issue) => issue.severity === "warning");
  const nodeDiffItems = (diff ?? []).filter((item) => diffNodeIds(item).includes(node.id));
  const artifactValue = result?.artifact ?? result?.artifacts;
  const outputHash = outputHashState(result?.output_hash, optional);
  const artifactLabelText = artifactLabel(artifactValue);
  const evidenceStatusText = evidenceStatus(result, optional);
  const modeContext = mode === "evidence" ? "Evidence node" : "Draft node";
  const dataContext = mode === "evidence" ? "Read-only evidence" : "Last run evidence below";
  const reviewScopes = node.review_scopes ?? [];
  const catalogAgents = reviewCatalogAgents(reviewCatalog);
  const catalogContracts = reviewCatalogContracts(reviewCatalog);
  const defaultCatalogContracts = reviewCatalogDefaultContractsForNode(node, reviewCatalog, allNodes ?? []);
  const topLevelModelChoices = modelChoices(availableModels, node.model);
  const scopeModelChoices = reviewScopeModelChoices(availableModels, reviewScopes);
  const runningNodeIds = new Set(status?.running_node_ids ?? []);
  const pausedNodeIds = new Set(status?.paused_node_ids ?? []);
  const disabledNodeIds = new Set(status?.disabled_node_ids ?? []);
  const subtreeIds = downstreamNodeIds(node.id, allNodes);
  const runningSubtreeIds = subtreeIds.filter((nodeId) => runningNodeIds.has(nodeId));
  const pausedSubtreeIds = subtreeIds.filter((nodeId) => pausedNodeIds.has(nodeId));
  const nodeTerminal = ["passed", "failed", "skipped"].includes(state) || disabledNodeIds.has(node.id);
  const nodeRunning = state === "running" || runningNodeIds.has(node.id);
  const runtimeBusy = runtimeActionState?.status === "submitting";
  const runtimeNodeActionDisabled = !onRuntimeAction || runtimeBusy || runTerminal || nodeTerminal || nodeRunning;
  const runtimeResumeDisabled = !onRuntimeAction || runtimeBusy || runTerminal || nodeTerminal || !pausedNodeIds.has(node.id);
  const runtimeSubtreeActionDisabled = !onRuntimeAction || runtimeBusy || runTerminal || nodeTerminal || runningSubtreeIds.length > 0;
  const runtimeSubtreeResumeDisabled = !onRuntimeAction || runtimeBusy || runTerminal || nodeTerminal || pausedSubtreeIds.length === 0;
  const runtimeStopDisabled = !onRuntimeAction || runtimeBusy || runTerminal;
  const runtimeControlReason = !onRuntimeAction
    ? "Live node/subtree controls require the backend action contract."
    : runtimeBusy
      ? "Runtime action is being submitted."
      : runTerminal
        ? "Runtime controls are closed because this run is terminal."
        : nodeTerminal
        ? "Runtime controls are closed because this node has terminal evidence."
        : nodeRunning
          ? "Running nodes cannot be paused or disabled; use graph stop to terminate active work."
          : runningSubtreeIds.length
            ? `Subtree contains running node(s): ${runningSubtreeIds.join(", ")}.`
            : runtimeActionState?.message ?? "Node and subtree actions write runtime amendment evidence.";
  function updateReviewScope(index: number, fields: Partial<ReviewScopeSpec>) {
    const next = reviewScopes.map((scope, scopeIndex) => scopeIndex === index ? { ...scope, ...fields } : { ...scope });
    onUpdateNode?.({ review_scopes: next });
  }
  function addReviewScope(contractName = "correctness_regression") {
    const existing = new Set(reviewScopes.map(reviewContractName));
    const selectedContract = catalogContracts.map((contract) => contract.id).find((option) => !existing.has(option)) ?? contractName;
    onUpdateNode?.({
      review_scopes: [
        ...reviewScopes,
        defaultReviewScopeForContract(selectedContract, node, reviewCatalog),
      ],
    });
  }
  function addDefaultReviewScopes() {
    const existing = new Set(reviewScopes.map(reviewContractName));
    const additions = defaultCatalogContracts
      .filter((contract) => !existing.has(contract))
      .map((contract) => defaultReviewScopeForContract(contract, node, reviewCatalog));
    if (additions.length) onUpdateNode?.({ review_scopes: [...reviewScopes, ...additions] });
  }
  function setReviewScopePreset(index: number, preset: string) {
    const scope = reviewScopes[index];
    if (!scope) return;
    const contract = reviewContractName(scope);
    const priorOverrides = scope.inline_overrides ?? {};
    updateReviewScope(index, {
      prompt_preset: preset,
      prompt: preset === "custom" ? scope.prompt : defaultReviewContractPrompt(contract, preset, reviewCatalog),
      inline_overrides: preset === "custom" ? { ...priorOverrides, prompt: true } : {},
    });
  }
  function duplicateReviewScope(index: number) {
    const scope = reviewScopes[index];
    if (!scope) return;
    const baseContract = reviewContractName(scope);
    const existing = new Set(reviewScopes.map(reviewContractName));
    const duplicateContract = `${baseContract || "custom_contract"}_copy`;
    const nextContract = existing.has(duplicateContract) ? `${duplicateContract}_${reviewScopes.length + 1}` : duplicateContract;
    const duplicate = {
      ...scope,
      scope: nextContract,
      contract: nextContract,
      prompt_preset: "custom",
      enabled: true,
    };
    onUpdateNode?.({ review_scopes: [...reviewScopes.slice(0, index + 1), duplicate, ...reviewScopes.slice(index + 1)] });
  }
  async function saveReviewContract(index: number) {
    const scope = reviewScopes[index];
    if (!scope || !onSaveReviewCatalogEntry) return;
    const contract = reviewContractName(scope);
    if (!contract) return;
    setCatalogSaveState(`Saving ${contract}`);
    try {
      await onSaveReviewCatalogEntry("contracts", {
        id: contract,
        version: scope.catalog_version ?? reviewContractEntry(contract, reviewCatalog)?.version ?? "1",
        label: reviewContractEntry(contract, reviewCatalog)?.label ?? titleCase(contract),
        default_agent: scope.agent ?? defaultReviewAgentForContract(contract, reviewCatalog),
        default_model: scope.model ?? node.model ?? defaultReviewModelForContract(contract, reviewCatalog),
        default_preset: scope.prompt_preset ?? "custom",
        review_level: scope.review_level ?? reviewContractEntry(contract, reviewCatalog)?.review_level ?? "default",
        proof_level: scope.proof_level ?? reviewContractEntry(contract, reviewCatalog)?.proof_level ?? "static_confirmed",
        reducer_policy: scope.reducer_policy ?? reviewContractEntry(contract, reviewCatalog)?.reducer_policy ?? "evidence_backed_only",
        read_only: scope.read_only ?? true,
        evidence_required: scope.evidence_required ?? true,
        closure_authority: scope.closure_authority ?? "final_review_gate",
        risk_triggers: scope.risk_triggers ?? reviewContractEntry(contract, reviewCatalog)?.risk_triggers,
        best_practice_skills: scope.best_practice_skills?.length ? scope.best_practice_skills : defaultBestPracticeSkillsForContract(contract, reviewCatalog),
        compatible_node_types: reviewContractEntry(contract, reviewCatalog)?.compatible_node_types ?? ["review-code"],
        required_fields: reviewContractEntry(contract, reviewCatalog)?.required_fields ?? ["agent", "model", "contract", "proof_level", "best_practice_skills"],
        default: reviewCatalogDefaultContracts(reviewCatalog).includes(contract),
        prompt: scope.prompt ?? "",
      });
      setCatalogSaveState(`Saved ${contract}`);
      window.setTimeout(() => setCatalogSaveState(""), 1600);
    } catch (error) {
      setCatalogSaveState(error instanceof Error ? error.message : String(error));
    }
  }
  async function saveReviewAgent(index: number) {
    const scope = reviewScopes[index];
    if (!scope?.agent || !onSaveReviewCatalogEntry) return;
    const agent = scope.agent;
    setCatalogSaveState(`Saving ${agent}`);
    try {
      await onSaveReviewCatalogEntry("agents", {
        id: agent,
        version: reviewCatalogAgents(reviewCatalog).find((entry) => entry.id === agent)?.version ?? "1",
        label: reviewCatalogAgents(reviewCatalog).find((entry) => entry.id === agent)?.label ?? titleCase(agent),
        default_model: scope.model ?? node.model ?? "oc-kimi",
        compatible_node_types: reviewCatalogAgents(reviewCatalog).find((entry) => entry.id === agent)?.compatible_node_types ?? ["review-code"],
        read_only: scope.read_only ?? true,
        evidence_required: scope.evidence_required ?? true,
        prompt: reviewCatalogAgents(reviewCatalog).find((entry) => entry.id === agent)?.prompt ?? "Stay read-only. Ground every finding in concrete file, diff, test, log, command, or artifact evidence.",
      });
      setCatalogSaveState(`Saved ${agent}`);
      window.setTimeout(() => setCatalogSaveState(""), 1600);
    } catch (error) {
      setCatalogSaveState(error instanceof Error ? error.message : String(error));
    }
  }
  function removeReviewScope(index: number) {
    onUpdateNode?.({ review_scopes: reviewScopes.filter((_, scopeIndex) => scopeIndex !== index) });
  }
  useEffect(() => {
    setDependencyChoice("");
  }, [node.id]);
  async function copyPromptPayload() {
    await navigator.clipboard?.writeText(promptPayload);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      <div className="exec-inspector-header exec-inspector-sticky-summary">
        <div style={{ color: dimColor, fontSize: 12, textTransform: "uppercase", letterSpacing: 0 }}>Node frame</div>
        <h3 style={{ margin: "4px 0", fontSize: 18 }}>Selected node: {node.id}</h3>
        <div className="exec-mode-badge-row" aria-label="Inspector mode and data source">
          <span className={mode === "evidence" ? "exec-readonly-node-badge" : "exec-draft-node-badge"}>{modeContext}</span>
          <span className="exec-source-node-badge">{dataContext}</span>
        </div>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 12 }}><span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: stateColor[state] }} />{optional && state === "failed" ? "Optional failed" : stateLabel[state]} · {node.type}</span>
        <div className="exec-inspector-proof-summary">{optional && state === "failed" ? "Optional failure - Non-blocking - REQUIRED = no - Evidence absence allowed" : `${stateLabel[state]} - ${optional ? "Optional node" : "Required node"} - Inspector selection`}</div>
        <div className="exec-compliance-summary-heading">Compliance summary</div>
        <div className="exec-node-summary-grid">
          <Info label="Impact" value={nodeImpact(optional, state)} />
          <Info label="Required" value={optional ? "No" : "Yes"} />
          <Info label={artifactLabelText} value={String(artifactValue ?? "Not reported")} />
          <Info label="Output hash" value={outputHash.text}><EvidenceBadge tone={outputHash.tone} text={outputHash.text} /></Info>
          <Info label="Evidence status" value={evidenceStatusText}><EvidenceBadge tone={optional ? "optional" : outputHash.tone} text={evidenceStatusText} /></Info>
          <Info label="Plan issues" value={`${nodeBlockingIssues.length} blocking, ${nodeWarnings.length} warnings`}>
            <span className={nodeBlockingIssues.length ? "exec-compliance-issue-badge exec-compliance-issue-badge-blocking" : nodeWarnings.length ? "exec-compliance-issue-badge exec-compliance-issue-badge-warning" : "exec-compliance-issue-badge"}>
              {nodeBlockingIssues.length ? `${nodeBlockingIssues.length} blocking` : nodeWarnings.length ? `${nodeWarnings.length} warning${nodeWarnings.length === 1 ? "" : "s"}` : "No node issues"}
            </span>
          </Info>
          <Info label="Draft diff" value={nodeDiffItems.length ? nodeDiffItems.map((item) => diffParticipationSummary(item, node.id)).join("; ") : "Not in current draft diff"}>
            {nodeDiffItems.length ? (
              <span className="exec-compliance-issue-badge">Participates in draft diff: {diffParticipationSummary(nodeDiffItems[0], node.id)}</span>
            ) : (
              <span className="exec-compliance-issue-badge">Not in current draft diff</span>
            )}
          </Info>
        </div>
      </div>
      <Section title="Contract"><Info label="Goal" value={node.node_goal} /><Info label="Role" value={node.protocol_role ?? "worker"} /><Info label="Persona" value={node.persona_ref ?? "none"} /><Info label="Required" value={optional ? "no, optional node" : "yes"} /><Info label="Failure classification" value={optional && state === "failed" ? "Optional failure" : state === "failed" ? "Required failure" : "No failure"} /><Info label="Impact on run result" value={nodeImpact(optional, state)} /></Section>
      <Section title="Runtime">
        <div className="exec-build-quick-actions" data-qid="scillm-exec-graph:runtime:node-actions">
          <button
            className="exec-control-button exec-control-button-compact"
            type="button"
            data-qid="scillm-exec-graph:runtime:pause-node"
            data-qs-action="SCILLM_EXEC_RUNTIME_PAUSE_NODE"
            title={runtimeControlReason}
            disabled={runtimeNodeActionDisabled}
            aria-disabled={runtimeNodeActionDisabled}
            onClick={() => void onRuntimeAction?.({ action: "pause", target: "node", node_id: node.id, reason: `Pause node ${node.id} scheduling from DAG viewer.` })}
          >
            Pause node
          </button>
          <button
            className="exec-control-button exec-control-button-compact"
            type="button"
            data-qid="scillm-exec-graph:runtime:resume-node"
            data-qs-action="SCILLM_EXEC_RUNTIME_RESUME_NODE"
            title={runtimeControlReason}
            disabled={runtimeResumeDisabled}
            aria-disabled={runtimeResumeDisabled}
            onClick={() => void onRuntimeAction?.({ action: "resume", target: "node", node_id: node.id, reason: `Resume node ${node.id} scheduling from DAG viewer.` })}
          >
            Resume node
          </button>
          <button
            className="exec-control-button exec-control-button-compact"
            type="button"
            data-qid="scillm-exec-graph:runtime:disable-node"
            data-qs-action="SCILLM_EXEC_RUNTIME_DISABLE_NODE"
            title={runtimeControlReason}
            disabled={runtimeNodeActionDisabled}
            aria-disabled={runtimeNodeActionDisabled}
            onClick={() => void onRuntimeAction?.({ action: "disable", target: "node", node_id: node.id, reason: `Disable pending node ${node.id} from DAG viewer.` })}
          >
            Disable node
          </button>
          <button
            className="exec-control-button exec-control-button-compact"
            type="button"
            data-qid="scillm-exec-graph:runtime:pause-subtree"
            data-qs-action="SCILLM_EXEC_RUNTIME_PAUSE_SUBTREE"
            title={runtimeControlReason}
            disabled={runtimeSubtreeActionDisabled}
            aria-disabled={runtimeSubtreeActionDisabled}
            onClick={() => void onRuntimeAction?.({ action: "pause", target: "subtree", node_id: node.id, reason: `Pause pending subtree rooted at ${node.id} from DAG viewer.` })}
          >
            Pause subtree
          </button>
          <button
            className="exec-control-button exec-control-button-compact"
            type="button"
            data-qid="scillm-exec-graph:runtime:resume-subtree"
            data-qs-action="SCILLM_EXEC_RUNTIME_RESUME_SUBTREE"
            title={runtimeControlReason}
            disabled={runtimeSubtreeResumeDisabled}
            aria-disabled={runtimeSubtreeResumeDisabled}
            onClick={() => void onRuntimeAction?.({ action: "resume", target: "subtree", node_id: node.id, reason: `Resume pending subtree rooted at ${node.id} from DAG viewer.` })}
          >
            Resume subtree
          </button>
          <button
            className="exec-control-button exec-control-button-compact"
            type="button"
            data-qid="scillm-exec-graph:runtime:disable-subtree"
            data-qs-action="SCILLM_EXEC_RUNTIME_DISABLE_SUBTREE"
            title={runtimeControlReason}
            disabled={runtimeSubtreeActionDisabled}
            aria-disabled={runtimeSubtreeActionDisabled}
            onClick={() => void onRuntimeAction?.({ action: "disable", target: "subtree", node_id: node.id, reason: `Disable pending subtree rooted at ${node.id} from DAG viewer.` })}
          >
            Disable subtree
          </button>
          <button
            className="exec-control-button exec-control-button-compact exec-control-button-danger"
            type="button"
            data-qid="scillm-exec-graph:runtime:stop-node"
            data-qs-action="SCILLM_EXEC_RUNTIME_STOP_NODE"
            title="Stop cancels the active run and records selected-node provenance."
            disabled={runtimeStopDisabled}
            aria-disabled={runtimeStopDisabled}
            onClick={() => void onRuntimeAction?.({ action: "stop", target: "node", node_id: node.id, reason: `Stop active run from selected node ${node.id}.` })}
          >
            Stop from node
          </button>
          <button
            className="exec-control-button exec-control-button-compact exec-control-button-danger"
            type="button"
            data-qid="scillm-exec-graph:runtime:stop-subtree"
            data-qs-action="SCILLM_EXEC_RUNTIME_STOP_SUBTREE"
            title="Stop cancels the active run and records selected-subtree provenance."
            disabled={runtimeStopDisabled}
            aria-disabled={runtimeStopDisabled}
            onClick={() => void onRuntimeAction?.({ action: "stop", target: "subtree", node_id: node.id, reason: `Stop active run from subtree rooted at ${node.id}.` })}
          >
            Stop from subtree
          </button>
        </div>
        <div className={runtimeActionState?.status === "error" ? "exec-controls-reason exec-controls-reason-error" : "exec-controls-reason"} style={{ textAlign: "left", maxWidth: "100%" }}>
          {runtimeControlReason}
        </div>
        <Info label="Type" value={node.type} />
        <Info label="Model" value={node.model ?? "default"} />
        <Info label="Depends on" value={dependencies.length ? dependencies.join(", ") : "none"}>
          {dependencies.length ? (
            <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {dependencies.map((dependency) => (
                <button key={dependency} className="exec-link-button" type="button" onClick={() => onSelectNode(dependency)} title={`Select dependency ${dependency}`}>{dependency}</button>
              ))}
            </span>
          ) : null}
        </Info>
      </Section>
      {mode === "plan_edit" ? (
        <Section title="Plan edit">
          <div className="exec-build-quick-actions" data-qid="scillm-exec-graph:plan-edit:quick-actions">
            <button className="exec-control-button exec-control-button-compact" type="button" data-qid="scillm-exec-graph:plan-edit:add-child" data-qs-action="SCILLM_EXEC_PLAN_ADD_CHILD" title="Create an unsaved draft child node that depends on this node" onClick={onAddChild}><SquarePlus size={14} />Add child</button>
            <button className="exec-control-button exec-control-button-compact" type="button" data-qid="scillm-exec-graph:plan-edit:add-sibling" data-qs-action="SCILLM_EXEC_PLAN_ADD_SIBLING" title="Create an unsaved draft sibling node with the same dependencies" onClick={onAddSibling}><GitBranchPlus size={14} />Add sibling</button>
            <button className="exec-control-button exec-control-button-compact" type="button" data-qid="scillm-exec-graph:plan-edit:add-gate" data-qs-action="SCILLM_EXEC_PLAN_ADD_GATE" title="Create an unsaved draft human approval gate after this node" onClick={onAddGate}><ShieldPlus size={14} />Add gate</button>
            <button className="exec-control-button exec-control-button-compact" type="button" data-qid="scillm-exec-graph:plan-edit:disable-node" data-qs-action="SCILLM_EXEC_PLAN_DISABLE_NODE" title="Mark this committed node disabled in the draft amendment; does not hard-delete execution evidence" disabled={Boolean(node.disabled)} aria-disabled={Boolean(node.disabled)} onClick={onDisableNode}>Disable</button>
            <button className="exec-control-button exec-control-button-compact" type="button" data-qid="scillm-exec-graph:plan-edit:archive-node" data-qs-action="SCILLM_EXEC_PLAN_ARCHIVE_NODE" title="Mark this committed node archived in the draft amendment; does not hard-delete execution evidence" disabled={Boolean(node.archived)} aria-disabled={Boolean(node.archived)} onClick={onArchiveNode}>Archive</button>
          </div>
          <div className="exec-plan-inline-help">These controls mutate only the local amendment draft. Run evidence stays read-only; approved amendments are applied from the Memory amendments list with provenance.</div>
          <label className="exec-plan-field">
            <span>Goal</span>
            <textarea className="exec-plan-input exec-plan-textarea" data-qid="scillm-exec-graph:plan-edit:goal" data-qs-action="SCILLM_EXEC_PLAN_EDIT_GOAL" title="Edit selected node goal" value={node.node_goal} onChange={(event) => onUpdateNode?.({ node_goal: event.target.value })} />
          </label>
          <label className="exec-plan-field">
            <span>Type</span>
            <input className="exec-plan-input" data-qid="scillm-exec-graph:plan-edit:type" data-qs-action="SCILLM_EXEC_PLAN_EDIT_TYPE" title="Edit selected node type" value={node.type} onChange={(event) => onUpdateNode?.({ type: event.target.value })} />
          </label>
          <div className="exec-plan-sensitive-group">
            <div className="exec-plan-subheading">AI model and compliance contract</div>
            <label className="exec-plan-field">
              <span>Role</span>
              <select className="exec-plan-input" data-qid="scillm-exec-graph:plan-edit:role" data-qs-action="SCILLM_EXEC_PLAN_EDIT_ROLE" title="Select verified protocol role" value={node.protocol_role ?? ""} onChange={(event) => onUpdateNode?.({ protocol_role: event.target.value })}>
                <option value="">worker</option>
                <option value="worker">worker</option>
                <option value="reviewer">reviewer</option>
                <option value="verifier">verifier</option>
                <option value="planner">planner</option>
                <option value="tool">tool</option>
              </select>
              <span className="exec-plan-inline-help">Verified role controls how this node is reviewed and gated.</span>
            </label>
            <label className="exec-plan-field">
              <span>Persona</span>
              <select className="exec-plan-input" data-qid="scillm-exec-graph:plan-edit:persona" data-qs-action="SCILLM_EXEC_PLAN_EDIT_PERSONA" title="Select review persona" value={node.persona_ref ?? ""} onChange={(event) => onUpdateNode?.({ persona_ref: event.target.value })}>
                <option value="">none</option>
                <option value="nico-bailon">nico-bailon</option>
                <option value="margaret-chen">margaret-chen</option>
                <option value="brandon-bailey">brandon-bailey</option>
                <option value="rob-armstrong">rob-armstrong</option>
              </select>
              <span className="exec-plan-inline-help">Persona selection affects compliance and design review posture.</span>
            </label>
            <label className="exec-plan-field">
              <span>Model</span>
              <select className="exec-plan-input" data-qid="scillm-exec-graph:plan-edit:model" data-qs-action="SCILLM_EXEC_PLAN_EDIT_MODEL" title="Select selected node model" value={node.model ?? ""} onChange={(event) => onUpdateNode?.({ model: event.target.value || undefined })}>
                {topLevelModelChoices.map((option) => <option key={option || "default"} value={option}>{option || "default"}</option>)}
              </select>
            </label>
            {isReviewCodeNode(node) ? (
              <div className="exec-review-scope-editor" data-qid="scillm-exec-graph:plan-edit:review-scopes">
                <div className="exec-plan-panel-heading exec-plan-panel-heading-row">
                  <span>review-code fanout</span>
                  <span className="exec-review-scope-toolbar">
                    <button
                      className="exec-control-button exec-control-button-compact"
                      type="button"
                      data-qid="scillm-exec-graph:plan-edit:add-default-review-scopes"
                      data-qs-action="SCILLM_EXEC_PLAN_ADD_DEFAULT_REVIEW_SCOPES"
                      title="Add default review-code fanout contracts"
                      onClick={() => addDefaultReviewScopes()}
                    >
                      Add defaults
                    </button>
                    <button
                      className="exec-control-button exec-control-button-compact"
                      type="button"
                      data-qid="scillm-exec-graph:plan-edit:add-review-scope"
                      data-qs-action="SCILLM_EXEC_PLAN_ADD_REVIEW_SCOPE"
                      title="Add one review-code fanout contract"
                      onClick={() => addReviewScope()}
                    >
                      Add contract
                    </button>
                  </span>
                </div>
                {reviewScopes.length ? (
                  <div className="exec-review-scope-list">
                    {reviewScopes.map((scope, index) => {
                      const contract = reviewContractName(scope);
                      const bestPracticeSkills = scope.best_practice_skills ?? defaultBestPracticeSkillsForContract(contract, reviewCatalog);
                      return (
                      <div key={`${contract || "contract"}-${index}`} className="exec-review-scope-row" data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}`}>
                        <label className="exec-plan-field">
                          <span>Agent</span>
                          <select
                            className="exec-plan-input"
                            data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}:agent`}
                            data-qs-action="SCILLM_EXEC_PLAN_EDIT_REVIEW_CONTRACT_AGENT"
                            title="Select reviewer agent for this contract"
                            value={scope.agent ?? defaultReviewAgentForContract(contract, reviewCatalog)}
                            onChange={(event) => updateReviewScope(index, { agent: event.target.value })}
                          >
                            {scope.agent && !catalogAgents.some((option) => option.id === scope.agent) ? <option value={scope.agent}>{scope.agent} (draft)</option> : null}
                            {catalogAgents.map((option) => <option key={option.id} value={option.id}>{option.label ?? option.id}</option>)}
                          </select>
                        </label>
                        <label className="exec-plan-field">
                          <span>Contract</span>
                          <select
                            className="exec-plan-input"
                            data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}:contract`}
                            data-qs-action="SCILLM_EXEC_PLAN_EDIT_REVIEW_CONTRACT"
                            title="Select evidence contract for this fanout row"
                            value={contract}
                            onChange={(event) => updateReviewScope(index, {
                              scope: event.target.value,
                              contract: event.target.value,
                              ...catalogIdentityFields(reviewContractEntry(event.target.value, reviewCatalog)),
                              agent: defaultReviewAgentForContract(event.target.value, reviewCatalog),
                              model: node.model || defaultReviewModelForContract(event.target.value, reviewCatalog),
                              review_level: reviewContractEntry(event.target.value, reviewCatalog)?.review_level ?? (event.target.value === "security" ? "risk_expanded" : "default"),
                              proof_level: reviewContractEntry(event.target.value, reviewCatalog)?.proof_level ?? (event.target.value === "tests_validation" || event.target.value === "evidence_closure_safety" ? "proven" : "static_confirmed"),
                              reducer_policy: reviewContractEntry(event.target.value, reviewCatalog)?.reducer_policy ?? (event.target.value === "evidence_closure_safety" ? "fail_closed_evidence_closure" : "evidence_backed_only"),
                              read_only: reviewContractEntry(event.target.value, reviewCatalog)?.read_only ?? true,
                              evidence_required: reviewContractEntry(event.target.value, reviewCatalog)?.evidence_required ?? true,
                              closure_authority: reviewContractEntry(event.target.value, reviewCatalog)?.closure_authority ?? "final_review_gate",
                              risk_triggers: reviewContractEntry(event.target.value, reviewCatalog)?.risk_triggers,
                              best_practice_skills: defaultBestPracticeSkillsForContract(event.target.value, reviewCatalog),
                              prompt: defaultReviewContractPrompt(event.target.value, reviewContractEntry(event.target.value, reviewCatalog)?.default_preset ?? "scope_default", reviewCatalog),
                              prompt_preset: reviewContractEntry(event.target.value, reviewCatalog)?.default_preset ?? "scope_default",
                              inline_overrides: {},
                            })}
                          >
                            {contract && !catalogContracts.some((option) => option.id === contract) ? <option value={contract}>{contract} (draft)</option> : null}
                            {catalogContracts.map((option) => <option key={option.id} value={option.id}>{option.label ?? option.id}</option>)}
                          </select>
                        </label>
                        <label className="exec-plan-field">
                          <span>Model</span>
                          <select
                            className="exec-plan-input"
                            data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}:model`}
                            data-qs-action="SCILLM_EXEC_PLAN_EDIT_REVIEW_CONTRACT_MODEL"
                            title="Select scillm model alias for this contract"
                            value={scope.model ?? node.model ?? "oc-kimi"}
                            onChange={(event) => updateReviewScope(index, { model: event.target.value })}
                          >
                            {scopeModelChoices.filter(Boolean).map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </label>
                        <label className="exec-plan-field">
                          <span>Review level</span>
                          <select
                            className="exec-plan-input"
                            data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}:review-level`}
                            data-qs-action="SCILLM_EXEC_PLAN_EDIT_REVIEW_LEVEL"
                            title="Select review expansion level for this evidence contract"
                            value={scope.review_level ?? reviewContractEntry(contract, reviewCatalog)?.review_level ?? "default"}
                            onChange={(event) => updateReviewScope(index, { review_level: event.target.value })}
                          >
                            {reviewLevelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                          </select>
                        </label>
                        <label className="exec-plan-field">
                          <span>Proof floor</span>
                          <select
                            className="exec-plan-input"
                            data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}:proof-level`}
                            data-qs-action="SCILLM_EXEC_PLAN_EDIT_REVIEW_PROOF_LEVEL"
                            title="Select the minimum proof level accepted by the reducer"
                            value={scope.proof_level ?? reviewContractEntry(contract, reviewCatalog)?.proof_level ?? "static_confirmed"}
                            onChange={(event) => updateReviewScope(index, { proof_level: event.target.value })}
                          >
                            {proofLevelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                          </select>
                        </label>
                        <label className="exec-plan-field">
                          <span>Contract preset</span>
                          <select
                            className="exec-plan-input"
                            data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}:prompt-preset`}
                            data-qs-action="SCILLM_EXEC_PLAN_EDIT_REVIEW_CONTRACT_PRESET"
                            title="Select prompt preset for this evidence contract"
                            value={scope.prompt_preset ?? "custom"}
                            onChange={(event) => setReviewScopePreset(index, event.target.value)}
                          >
                            {reviewCodePromptPresetOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                          </select>
                        </label>
                        <label className="exec-plan-field exec-review-scope-best-practices">
                          <span>Best-practice skills</span>
                          <textarea
                            className="exec-plan-input exec-plan-textarea exec-review-scope-best-practices-input"
                            data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}:best-practice-skills`}
                            data-qs-action="SCILLM_EXEC_PLAN_EDIT_REVIEW_BEST_PRACTICES"
                            title="Comma- or newline-separated best-practices-* skills that must be loaded before this fanout reviewer runs"
                            value={formatBestPracticeSkills(bestPracticeSkills)}
                            onChange={(event) => updateReviewScope(index, { best_practice_skills: parseBestPracticeSkills(event.target.value) })}
                          />
                          {bestPracticeSkills.length ? null : <span className="exec-plan-inline-warning">best-practices-* skills are required for this fanout row.</span>}
                        </label>
                        <label className="exec-plan-field exec-review-scope-enabled">
                          <span>Enabled</span>
                          <input
                            type="checkbox"
                            checked={scope.enabled !== false}
                            data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}:enabled`}
                            data-qs-action="SCILLM_EXEC_PLAN_EDIT_REVIEW_SCOPE_ENABLED"
                            title="Enable this fanout review call"
                            onChange={(event) => updateReviewScope(index, { enabled: event.target.checked })}
                          />
                        </label>
                        <label className="exec-plan-field exec-review-scope-enabled">
                          <span>Read-only</span>
                          <input
                            type="checkbox"
                            checked={scope.read_only !== false}
                            data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}:read-only`}
                            data-qs-action="SCILLM_EXEC_PLAN_EDIT_REVIEW_READ_ONLY"
                            title="Review fanout calls must stay read-only by default"
                            onChange={(event) => updateReviewScope(index, { read_only: event.target.checked })}
                          />
                        </label>
                        <label className="exec-plan-field exec-review-scope-prompt">
                          <span>Prompt contract</span>
                          <textarea
                            className="exec-plan-input exec-plan-textarea"
                            data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}:prompt`}
                            data-qs-action="SCILLM_EXEC_PLAN_EDIT_REVIEW_CONTRACT_PROMPT"
                            title="Edit this evidence contract prompt body"
                            value={scope.prompt ?? ""}
                            onChange={(event) => updateReviewScope(index, { prompt: event.target.value, prompt_preset: "custom", inline_overrides: { ...(scope.inline_overrides ?? {}), prompt: true } })}
                          />
                        </label>
                        <button
                          className="exec-control-button exec-control-button-compact exec-review-scope-remove"
                          type="button"
                          data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}:save-contract`}
                          data-qs-action="SCILLM_EXEC_PLAN_SAVE_REVIEW_CONTRACT"
                          title={onSaveReviewCatalogEntry ? `Save review contract ${contract || index + 1} to the catalog` : "No review catalog save backend connected"}
                          disabled={!onSaveReviewCatalogEntry || !contract}
                          onClick={() => void saveReviewContract(index)}
                        >
                          Save contract
                        </button>
                        <button
                          className="exec-control-button exec-control-button-compact exec-review-scope-remove"
                          type="button"
                          data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}:save-agent`}
                          data-qs-action="SCILLM_EXEC_PLAN_SAVE_REVIEW_AGENT"
                          title={onSaveReviewCatalogEntry ? `Save review agent ${scope.agent || index + 1} to the catalog` : "No review catalog save backend connected"}
                          disabled={!onSaveReviewCatalogEntry || !scope.agent}
                          onClick={() => void saveReviewAgent(index)}
                        >
                          Save agent
                        </button>
                        <button
                          className="exec-control-button exec-control-button-compact exec-review-scope-remove"
                          type="button"
                          data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}:duplicate`}
                          data-qs-action="SCILLM_EXEC_PLAN_DUPLICATE_REVIEW_SCOPE"
                          title={`Duplicate review contract ${contract || index + 1}`}
                          onClick={() => duplicateReviewScope(index)}
                        >
                          Duplicate
                        </button>
                        <button
                          className="exec-control-button exec-control-button-compact exec-review-scope-remove"
                          type="button"
                          data-qid={`scillm-exec-graph:plan-edit:review-scope:${index}:remove`}
                          data-qs-action="SCILLM_EXEC_PLAN_REMOVE_REVIEW_SCOPE"
                          title={`Remove review contract ${contract || index + 1}`}
                          onClick={() => removeReviewScope(index)}
                        >
                          Remove
                        </button>
                      </div>
                    )})}
                  </div>
                ) : <div className="exec-empty-state">Agent has not selected review fanout contracts for this review-code node.</div>}
                {catalogSaveState ? <div className="exec-plan-inline-help">{catalogSaveState}</div> : null}
                <div className="exec-plan-inline-help">Enabled fanout rows require agent, evidence contract, model, proof floor, and best-practices-* skills. Agents/contracts load from /v1/scillm/exec/review-catalog; review-safe models load from /v1/scillm/models review_fanout_models/selectable_models. Save contract or agent updates the catalog; Save amendment persists the DAG edit.</div>
              </div>
            ) : null}
            <div className="exec-plan-obligation-summary" aria-label="Verification gates for this draft node">
              <span><b>Obligation status</b>Draft contract under review</span>
              <span><b>Gate</b>Plan validation plus reviewer evidence</span>
              <span><b>Persistence</b>Memory amendment record after save</span>
            </div>
            <label className="exec-plan-field">
              <span>Prompt</span>
              <textarea className="exec-plan-input exec-plan-textarea" data-qid="scillm-exec-graph:plan-edit:prompt" data-qs-action="SCILLM_EXEC_PLAN_EDIT_PROMPT" title="Edit selected node prompt contract" value={node.prompt ?? ""} onChange={(event) => onUpdateNode?.({ prompt: event.target.value })} />
              {nodeValidationIssues.some((issue) => issue.code === "missing_prompt_contract") ? <span className="exec-plan-inline-warning">Prompt-like node is missing a prompt or messages.</span> : null}
            </label>
          </div>
          <div className="exec-plan-dependencies" data-qid="scillm-exec-graph:plan-edit:dependencies">
            <div className="exec-info-label">Dependencies</div>
            <div className="exec-plan-inline-help">Keyboard: focus the selector, choose a node, then press Enter or Space on Add dependency.</div>
            {dependencies.length ? (
              <div className="exec-plan-list">
                {dependencies.map((dependency) => (
                  <span key={dependency} className="exec-plan-dependency-pill">
                    <button className="exec-link-button" type="button" onClick={() => onSelectNode(dependency)}>{dependency}</button>
                    <button className="exec-plan-remove-button" type="button" data-qid={`scillm-exec-graph:plan-edit:remove-dependency:${dependency}`} data-qs-action="SCILLM_EXEC_PLAN_REMOVE_DEPENDENCY" title={`Remove dependency ${dependency}`} onClick={() => onRemoveDependency?.(dependency)}>Remove</button>
                  </span>
                ))}
              </div>
            ) : <div className="exec-empty-state">No dependencies. Use the options below to add one.</div>}
            <div className="exec-plan-add-dependency">
              <select className="exec-plan-input" value={dependencyChoice} data-qid="scillm-exec-graph:plan-edit:dependency-select" data-qs-action="SCILLM_EXEC_PLAN_SELECT_DEPENDENCY" title="Select dependency to add" onChange={(event) => setDependencyChoice(event.target.value)}>
                <option value="">Select node</option>
                {dependencyOptions.map((candidate) => <option key={candidate.node.id} value={candidate.node.id} disabled={Boolean(candidate.cyclePath)}>{candidate.node.id}{candidate.cyclePath ? " (would create cycle)" : ""}</option>)}
              </select>
              <button className="exec-control-button exec-control-button-compact" type="button" data-qid="scillm-exec-graph:plan-edit:add-dependency" data-qs-action="SCILLM_EXEC_PLAN_ADD_DEPENDENCY" title={selectedDependencyOption?.cyclePath ? `Would create cycle: ${selectedDependencyOption.cyclePath}` : dependencyChoice ? "Add selected dependency to draft; keyboard Enter or Space activates this button" : "Select a dependency first"} disabled={!dependencyChoice || Boolean(selectedDependencyOption?.cyclePath)} aria-disabled={!dependencyChoice || Boolean(selectedDependencyOption?.cyclePath)} onClick={() => {
                if (!dependencyChoice || selectedDependencyOption?.cyclePath) return;
                onAddDependency?.(dependencyChoice);
                setDependencyChoice("");
              }}>Add dependency</button>
            </div>
            {dependencyOptions.length ? (
              <div className="exec-plan-available-dependencies" aria-label="Available dependencies">
                {dependencyOptions.map((candidate) => (
                  <button
                    key={candidate.node.id}
                    className="exec-control-button exec-control-button-compact"
                    type="button"
                    data-qid={`scillm-exec-graph:plan-edit:add-dependency:${candidate.node.id}`}
                    data-qs-action="SCILLM_EXEC_PLAN_ADD_DEPENDENCY"
                    title={candidate.cyclePath ? `Would create cycle: ${candidate.cyclePath}` : `Add dependency ${candidate.node.id}`}
                    disabled={Boolean(candidate.cyclePath)}
                    aria-disabled={Boolean(candidate.cyclePath)}
                    onClick={() => {
                      if (candidate.cyclePath) return;
                      onAddDependency?.(candidate.node.id);
                    }}
                  >
                    {candidate.cyclePath ? `Blocked ${candidate.node.id}` : `Add ${candidate.node.id}`}
                  </button>
                ))}
              </div>
            ) : null}
            {dependencyOptions.some((candidate) => candidate.cyclePath) ? (
              <div className="exec-plan-invalid-dependencies">
                {dependencyOptions.filter((candidate) => candidate.cyclePath).map((candidate) => (
                  <span key={candidate.node.id}>Would create cycle: {candidate.cyclePath}</span>
                ))}
              </div>
            ) : null}
          </div>
          {nodeValidationIssues.length ? <ValidationIssueList issues={nodeValidationIssues} onSelectNode={onSelectNode} /> : <div className="exec-plan-issue exec-plan-issue-info">No node issues.</div>}
        </Section>
      ) : null}
      {mode === "plan_edit" && runtimeReadinessNode ? (
        <Section title="Plan-iterate readiness">
          <Info label="Adapter" value={runtimeReadinessNode.adapter} />
          <Info label="Status" value={runtimeReadinessNode.status.replaceAll("_", " ")} />
          <Info label="Missing fields" value={runtimeReadinessNode.missing_fields.length ? runtimeReadinessNode.missing_fields.join(", ") : "none"}>
            {runtimeReadinessNode.missing_fields.length ? (
              <span className="exec-readiness-field-list">
                {runtimeReadinessNode.missing_fields.map((field) => <span key={field} className="exec-readiness-field">{field}</span>)}
              </span>
            ) : <span className="exec-compliance-issue-badge">No missing fields</span>}
          </Info>
          <Info label="Present fields" value={runtimeReadinessNode.present_fields.length ? runtimeReadinessNode.present_fields.join(", ") : "none"} />
          <Info label="Next action" value={runtimeReadinessNode.next_action} />
          {runtimeReadinessNode.inferred_fields.length ? (
            <Info label="Inferred fields" value={runtimeReadinessNode.inferred_fields.map((field) => `${field.field} from ${field.source}`).join("; ")} />
          ) : null}
        </Section>
      ) : null}
      <Section title={mode === "evidence" ? "Execution evidence" : "Last run evidence"}>
        <div className="exec-evidence-note">Node execution timestamps are UTC.</div>
        <Info label="Node ID" value={node.id} />
        <EvidenceInfo label="Attempt" value={result?.attempt_id ?? result?.attempt} node={node} optional={optional} />
        <EvidenceInfo label="Started at UTC" value={result?.started_at ?? result?.start_time} node={node} optional={optional} />
        <EvidenceInfo label="Completed at UTC" value={result?.completed_at ?? result?.end_time} node={node} optional={optional} />
        <EvidenceInfo label="Duration" value={result?.duration_ms ? `${result.duration_ms} ms` : undefined} node={node} optional={optional} />
        <EvidenceInfo label={artifactLabelText} value={artifactValue} node={node} optional={optional} />
        <Info label="Output hash" value={outputHash.text}>
          <EvidenceBadge tone={outputHash.tone} text={outputHash.text} />
          {outputHash.note ? <div className="exec-evidence-note">{outputHash.note}</div> : null}
        </Info>
        <Info label="Evidence status" value={evidenceStatusText}><EvidenceBadge tone={optional ? "optional" : outputHash.tone} text={evidenceStatusText} /></Info>
      </Section>
      <Section
        title="Prompt payload"
        action={<button className="exec-control-button exec-control-button-compact" data-qid="scillm-exec-graph:prompt-payload:copy" data-qs-action="SCILLM_EXEC_PROMPT_PAYLOAD_COPY" title={hasPromptPayload ? "Copy prompt payload JSON" : "No prompt payload to copy"} disabled={!hasPromptPayload} aria-disabled={!hasPromptPayload} onClick={() => void copyPromptPayload()}>{copied ? "Copied" : "Copy payload"}</button>}
      >
        <details open={hasPromptPayload}>
          <summary style={{ cursor: "pointer", color: dimColor, fontSize: 12, marginBottom: 10 }}>Rendered JSON payload</summary>
          {hasPromptPayload ? <pre className="exec-json-pre" style={preStyle()}>{promptPayload}</pre> : <div className="exec-empty-state">No prompt payload for this node.</div>}
        </details>
      </Section>
    </div>
  );
}

function PlanDraftPanel({
  mode,
  validation,
  diff,
  runtimeReadiness,
  dirty,
  lastIssue,
  nicoProposals,
  draftGraph,
  auditLog,
  appliedProposalIds,
  canAmend,
  graphId,
  baseGraphHash,
  draftBaseGraphHash,
  staleBaseGraph,
  amendmentOperations,
  amendBackendLabel,
  amendState,
  warningsAcknowledged,
  formalDiffCopied,
  amendments,
  amendmentsState,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onReset,
  onExportDiff,
  onAmend,
  onRefreshAmendments,
  onLoadAmendment,
  onSetAmendmentStatus,
  onApplyAmendment,
  onWarningsAcknowledgedChange,
  onApplyProposal,
  onSelectNode,
}: {
  mode: DebuggerMode;
  validation: PlanValidationResult;
  diff: PlanDiffItem[];
  runtimeReadiness: RuntimeReadinessReport;
  dirty: boolean;
  lastIssue?: PlanValidationIssue;
  nicoProposals: NicoPlanProposal[];
  draftGraph: ExecGraph;
  auditLog: PlanAuditEntry[];
  appliedProposalIds: Set<string>;
  canAmend: boolean;
  graphId: string;
  baseGraphHash: string;
  draftBaseGraphHash: string;
  staleBaseGraph: boolean;
  amendmentOperations: unknown[];
  amendBackendLabel: string;
  amendState: AmendState;
  warningsAcknowledged: boolean;
  formalDiffCopied: boolean;
  amendments: ExecGraphAmendment[];
  amendmentsState: AmendmentsLoadState;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onExportDiff: () => void;
  onAmend: () => void;
  onRefreshAmendments?: () => void;
  onLoadAmendment: (amendment: ExecGraphAmendment) => void;
  onSetAmendmentStatus?: AmendmentStatusHandler;
  onApplyAmendment?: AmendmentApplyHandler;
  onWarningsAcknowledgedChange: (value: boolean) => void;
  onApplyProposal: (proposal: NicoPlanProposal) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  useRegisterAction("scillm-exec-graph:plan-edit:reset", { app: "scillm", action: "SCILLM_EXEC_PLAN_RESET_DRAFT", label: "Reset draft" });
  useRegisterAction("scillm-exec-graph:plan-edit:undo", { app: "scillm", action: "SCILLM_EXEC_PLAN_UNDO", label: "Undo draft change" });
  useRegisterAction("scillm-exec-graph:plan-edit:redo", { app: "scillm", action: "SCILLM_EXEC_PLAN_REDO", label: "Redo draft change" });
  useRegisterAction("scillm-exec-graph:plan-edit:export-diff", { app: "scillm", action: "SCILLM_EXEC_PLAN_COPY_DIFF", label: "Copy plan diff" });
  useRegisterAction("scillm-exec-graph:plan-edit:save-draft-amendment", { app: "scillm", action: "SCILLM_EXEC_PLAN_SAVE_DRAFT_AMENDMENT", label: "Save draft amendment" });
  useRegisterAction("scillm-exec-graph:nico-proposal:apply", { app: "scillm", action: "SCILLM_EXEC_PLAN_APPLY_NICO_PROPOSAL", label: "Apply Nico proposal" });
  useRegisterAction("scillm-exec-graph:amendment:refresh", { app: "scillm", action: "SCILLM_EXEC_AMENDMENT_REFRESH", label: "Refresh amendments" });
  const warningCount = validation.warnings.length;
  const warningAckRequired = warningCount > 0;
  const diffHash = localIdentity(diff);
  const diffCountLabel = amendState.status === "saved" ? "Persisted diffs" : "Pending diffs";
  const amendDisabled = staleBaseGraph || !dirty || !canAmend || amendState.status === "saving" || amendState.status === "saved" || (warningAckRequired && !warningsAcknowledged);
  const amendTitle = !canAmend
    ? "No shared Memory amendment backend is connected."
    : staleBaseGraph
      ? "Base graph hash changed since this draft was created; refresh or rebase before saving."
    : !dirty
      ? "No draft changes to save."
      : amendState.status === "saving"
            ? "Saving draft amendment."
            : amendState.status === "saved"
              ? amendState.message
            : warningAckRequired && !warningsAcknowledged
              ? "Acknowledge the listed warnings before saving this amendment."
            : warningCount
              ? `Save this draft amendment with ${warningCount} accepted validation warning${warningCount === 1 ? "" : "s"}.`
              : "Save this draft amendment. Approve and apply it from the Memory amendments list.";
  const amendVisibleReason = !canAmend
    ? "Save unavailable: no shared Memory amendment backend is connected."
    : staleBaseGraph
      ? `Save blocked: draft base hash ${draftBaseGraphHash.slice(0, 12)} no longer matches current graph hash ${baseGraphHash.slice(0, 12)}.`
    : !dirty
      ? "Save unavailable: no draft changes."
        : amendState.status === "saved"
          ? amendState.message
          : amendState.status === "error"
            ? `Memory amendment failed: ${amendState.message}`
            : warningAckRequired && !warningsAcknowledged
              ? `Save blocked: acknowledge ${warningCount} validation warning${warningCount === 1 ? "" : "s"} first.`
            : warningCount
              ? `Ready to save amendment · ${warningCount} warning${warningCount === 1 ? "" : "s"} requires acknowledgement`
              : "Ready to save draft amendment; run evidence remains read-only.";
  const saveStatusLabel = !canAmend
    ? "No Memory backend"
    : amendState.status === "saved"
      ? "Draft status: Saved amendment"
      : amendState.status === "error"
        ? "Memory status: Save failed"
        : amendState.status === "saving"
          ? "Memory status: Saving..."
          : "Memory status: Not saved";
  const saveStatusClass = amendState.status === "saved"
    ? "exec-plan-audit-status-ok"
    : !canAmend || amendState.status === "error"
      ? "exec-plan-audit-status-attention"
      : undefined;

  return (
    <div className="exec-plan-panel" data-qid={mode === "nico_proposals" ? "scillm-exec-graph:nico-proposals" : "scillm-exec-graph:plan-draft"}>
      <div className={dirty ? "exec-plan-audit-banner exec-plan-audit-banner-dirty" : "exec-plan-audit-banner"} data-qid="scillm-exec-graph:plan-audit-status">
        <strong>Draft revision</strong>
        <span className={dirty && amendState.status !== "saved" ? "exec-plan-audit-status-attention" : undefined}><b>Unsaved</b><em>{amendState.status === "saved" ? "No" : dirty ? "Yes" : "No"}</em></span>
        <span><b>Run evidence</b><em>Read-only</em></span>
        <span className={saveStatusClass} title="Saves the amendment draft operations, structured diff, validation result, provenance, and audit metadata. Approved amendments are applied from the Memory amendments list."><b>Save</b><em>{saveStatusLabel}</em></span>
        <span className={diff.length ? "exec-plan-audit-status-attention exec-plan-audit-diff-status" : "exec-plan-audit-diff-status"}>
          <b>{diffCountLabel}</b>
          <em>{diff.length}</em>
          {diff.length ? (
            <button
              className="exec-plan-inline-action"
              type="button"
              onClick={() => document.querySelector('[data-qid="scillm-exec-graph:plan-diff"]')?.scrollIntoView({ block: "nearest" })}
              title="Jump to the draft diff evidence"
            >
              View formal diff
            </button>
          ) : null}
        </span>
        <span title="The DAG-viewer amendment endpoint stores one draft record with base graph hash, operations, diff, validation, actor, provenance, and warnings."><b>Persistence</b>{amendBackendLabel}</span>
        <span><b>Audit source</b>Diff, validation, proposal provenance, local change log</span>
        <span className={staleBaseGraph ? "exec-plan-audit-status-attention" : undefined}><b>Base graph hash</b><em>{draftBaseGraphHash.slice(0, 12)}{staleBaseGraph ? " stale" : " current"}</em></span>
        <span><b>Amendment ops</b><em>{amendmentOperations.length}</em></span>
        <span><b>{amendState.status === "saved" ? "Saved diff hash" : "Draft diff hash"}</b><em>{diff.length ? diffHash : "none"}</em></span>
      </div>
      {staleBaseGraph ? (
        <div className="exec-plan-stale-warning" data-qid="scillm-exec-graph:plan-edit:stale-base-warning">
          Base graph hash changed since this draft was created. Saving is blocked to prevent drafting against stale execution semantics.
        </div>
      ) : null}
      <div className="exec-plan-audit-log" data-qid="scillm-exec-graph:plan-audit-log">
        <div className="exec-plan-panel-heading">Local audit log</div>
        {auditLog.length ? (
          <div className="exec-plan-list">
            {auditLog.map((entry) => (
              <details key={entry.id} className="exec-plan-audit-entry">
                <summary>
                  <span>{formatEventTime(entry.ts)}</span>
                  <strong>{entry.action}</strong>
                  <span>{entry.actor}</span>
                  <span>{entry.diffRefs?.length ? `${entry.details} · produced ${entry.diffRefs.join(", ")}` : entry.details}</span>
                </summary>
                <pre className="exec-json-pre">{formatJsonBlock({ before: entry.before, after: entry.after })}</pre>
              </details>
            ))}
          </div>
        ) : <div className="exec-empty-state">No local draft changes recorded yet.</div>}
      </div>
      {amendState.status === "saved" ? (
        <div className="exec-plan-saved-memory" data-qid="scillm-exec-graph:plan-saved-memory">
          <strong>Saved draft amendment</strong>
          <span className="exec-plan-saved-memory-primary"><b>Amendment key</b>{amendState.amendment_key ?? amendState.local_amendment_id}</span>
          <span className="exec-plan-saved-memory-primary"><b>Diff hash</b>{amendState.diff_hash}</span>
          <span className="exec-plan-saved-memory-primary"><b>Saved at UTC</b>{formatTimestamp(amendState.saved_at)}</span>
          <span><b>Graph</b>{amendState.graph_id}</span>
          <span><b>Status</b>draft</span>
          <span><b>Actor</b>scillm-exec-graph-editor</span>
          <span><b>Diff count</b>{amendState.diff_count}</span>
          <span className={amendState.acknowledged_warning_ids.length ? "exec-plan-saved-memory-accepted-warning" : undefined}><b>Accepted warnings</b>{amendState.acknowledged_warning_ids.length ? amendState.acknowledged_warning_ids.join(", ") : "none"}</span>
          <span><b>Applied proposals</b>{amendState.proposal_ids.length ? amendState.proposal_ids.join(", ") : "none"}</span>
          <span><b>Mutation rule</b>Committed execution is unchanged; any new draft edit clears this saved identity.</span>
        </div>
      ) : null}
      <MemoryAmendmentsPanel
        amendments={amendments}
        state={amendmentsState}
        onRefresh={onRefreshAmendments}
        onLoadAmendment={onLoadAmendment}
        onSetAmendmentStatus={onSetAmendmentStatus}
        onApplyAmendment={onApplyAmendment}
      />
      {mode === "nico_proposals" ? (
        <div className="exec-plan-column">
          <div className="exec-plan-panel-heading">Nico proposals</div>
          {nicoProposals.length ? (
            <div className="exec-plan-list">
              {nicoProposals.map((proposal) => {
                const applied = appliedProposalIds.has(proposal.id);
                const proposalAudit = auditLog.find((entry) => entry.id.includes(proposal.id));
                const preview = applyNicoPlanProposal(draftGraph, proposal);
                const proposalDiff = preview.applied ? diffExecGraphPlan(draftGraph, preview.graph) : [];
                const affectedNodeIds = Array.from(new Set(proposal.patches.map((patch) => patch.op === "add_node" ? patch.node.id : patch.node_id)));
                return (
                  <div key={proposal.id} className={applied ? "exec-plan-proposal exec-plan-proposal-applied" : "exec-plan-proposal"} data-qid={`scillm-exec-graph:nico-proposal:${proposal.id}`}>
                    <div>
                      <strong>{proposal.title}</strong>
                      <div className="exec-plan-muted">Proposed by {proposal.proposed_by} · {proposal.patches.length} patch{proposal.patches.length === 1 ? "" : "es"}</div>
                      {proposal.rationale ? <div className="exec-plan-muted">{proposal.rationale}</div> : null}
                      {affectedNodeIds.length ? (
                        <div className="exec-plan-proposal-targets" aria-label="Proposal affected nodes">
                          <span>Affects</span>
                          {affectedNodeIds.map((nodeId) => (
                            <button key={nodeId} className="exec-link-button" type="button" onClick={() => onSelectNode(nodeId)} title={`Select affected node ${nodeId}`}>{nodeId}</button>
                          ))}
                        </div>
                      ) : null}
                      <div className="exec-plan-proposal-diff">
                        <span className="exec-info-label">Proposal-specific diff</span>
                        {applied ? proposal.patches.map((patch, index) => <span key={`${proposal.id}-patch-${index}`}>Applied patch: {patchSummary(patch)}</span>) : null}
                        {applied && proposalAudit ? <span>Applied at: {formatEventTime(proposalAudit.ts)} UTC · Produced: {proposalAudit.diffRefs?.join(", ") ?? "formal diff"} · Patch count: {proposal.patches.length}</span> : null}
                        {proposalDiff.length ? proposalDiff.map((item, index) => <span key={`${proposal.id}-${index}`}>Resulting formal diff: Diff {index + 1} · {item.kind.replaceAll("_", " ")}</span>) : <span>{preview.issue ? preview.issue.message : "This proposal's changes are incorporated into the draft."}</span>}
                      </div>
                    </div>
                    {applied ? <span className="exec-plan-status-badge">Applied</span> : <button className="exec-control-button exec-control-button-compact" type="button" data-qid={`scillm-exec-graph:nico-proposal:${proposal.id}:apply`} data-qs-action="SCILLM_EXEC_PLAN_APPLY_NICO_PROPOSAL" title={`Apply Nico proposal ${proposal.title} to draft`} onClick={() => onApplyProposal(proposal)}>Apply to draft</button>}
                  </div>
                );
              })}
            </div>
          ) : <div className="exec-empty-state">No Nico proposal source is connected for this graph.</div>}
        </div>
      ) : null}
      <div className="exec-plan-column" data-qid="scillm-exec-graph:plan-validation">
        <div className="exec-plan-panel-heading">Validation</div>
        <div className={validation.blocking.length ? "exec-plan-validation-summary exec-plan-validation-summary-blocking" : "exec-plan-validation-summary"}>
          Current validation: {validation.blocking.length} blocking · {validation.warnings.length} warning{validation.warnings.length === 1 ? "" : "s"}
        </div>
        {lastIssue ? <div className="exec-plan-issue exec-plan-rejected-patch"><strong>Rejected patch attempt — not applied to current draft</strong><span>{lastIssue.message}</span></div> : null}
        {validation.issues.length ? <ValidationIssueList issues={validation.issues} onSelectNode={onSelectNode} /> : <div className="exec-plan-issue exec-plan-issue-info">Draft is valid for amendment.</div>}
      </div>
      <div className="exec-plan-column" data-qid="scillm-exec-graph:runtime-readiness">
        <div className="exec-plan-panel-heading">Plan-iterate execution readiness</div>
        <div className={runtimeReadiness.can_execute_runtime ? "exec-plan-validation-summary" : "exec-plan-validation-summary exec-plan-validation-summary-blocking"}>
          Runtime readiness: {runtimeReadiness.summary.blocked_node_count} missing-field node{runtimeReadiness.summary.blocked_node_count === 1 ? "" : "s"} · {runtimeReadiness.summary.manual_node_count} manual node{runtimeReadiness.summary.manual_node_count === 1 ? "" : "s"}
        </div>
        {runtimeReadiness.nodes.filter((node) => node.missing_fields.length || node.status === "manual_action_required").length ? (
          <div className="exec-plan-list">
            {runtimeReadiness.nodes.filter((node) => node.missing_fields.length || node.status === "manual_action_required").map((node) => (
              <button key={node.node_id} className={`exec-plan-issue ${node.status === "runtime_ready" ? "exec-plan-issue-info" : "exec-plan-issue-blocking"}`} type="button" onClick={() => onSelectNode(node.node_id)} title={`Select ${node.node_id} to edit missing runtime fields`}>
                <span className="exec-plan-issue-code">{node.status.replaceAll("_", " ")}</span>
                <span className="exec-plan-issue-message">{node.node_id}: {node.missing_fields.length ? node.missing_fields.join(", ") : "manual action required"}</span>
              </button>
            ))}
          </div>
        ) : <div className="exec-plan-issue exec-plan-issue-info">All nodes have the fields needed for runtime compilation.</div>}
      </div>
      <div className="exec-plan-column" data-qid="scillm-exec-graph:plan-diff">
        <div className="exec-plan-panel-heading">Formal plan diff</div>
        {diff.length ? (
          <div className="exec-plan-list">
            {diff.map((item, index) => (
              <div key={`${item.kind}-${item.node_id}-${item.field ?? ""}-${index}`} className="exec-plan-diff-row">
                <strong>{item.kind.replaceAll("_", " ")}</strong>
                <span className="exec-plan-diff-index">Diff {index + 1} of {diff.length}</span>
                <span className="exec-plan-diff-detail">{item.label}</span>
                <span className="exec-plan-proposal-targets">
                  {diffNodeIds(item).map((nodeId) => (
                    <button key={nodeId} className="exec-link-button" type="button" onClick={() => onSelectNode(nodeId)} title={`Select diff node ${nodeId}`}>{nodeId}</button>
                  ))}
                </span>
                {(item.kind === "dependency_added" || item.kind === "dependency_removed") ? (
                  <div className="exec-plan-diff-before-after">
                    <span><b>Before dependencies</b><em>{dependencyList(item.before).join(", ") || "none"}</em></span>
                    <span><b>After dependencies</b><em>{dependencyList(item.after, item.kind === "dependency_added" ? item.dependency : undefined).join(", ") || "none"}</em></span>
                    {item.dependency ? <span className="exec-plan-obligation">Obligation: {item.node_id} must now consume evidence from {dependencyList(item.after).join(" and ")}.</span> : null}
                  </div>
                ) : null}
                {item.kind === "node_updated" ? (
                  <details className="exec-plan-json-diff">
                    <summary>Field JSON before/after</summary>
                    <pre className="exec-json-pre">{formatJsonBlock({ field: item.field, before: item.before, after: item.after })}</pre>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        ) : <div className="exec-empty-state">No draft changes.</div>}
      </div>
      <div className="exec-plan-actions">
        <button className="exec-control-button exec-control-button-compact" type="button" data-qid="scillm-exec-graph:plan-edit:undo" data-qs-action="SCILLM_EXEC_PLAN_UNDO" title={canUndo ? "Undo last draft change" : "No draft change to undo"} disabled={!canUndo} aria-disabled={!canUndo} onClick={onUndo}>Undo</button>
        <button className="exec-control-button exec-control-button-compact" type="button" data-qid="scillm-exec-graph:plan-edit:redo" data-qs-action="SCILLM_EXEC_PLAN_REDO" title={canRedo ? "Redo next draft change" : "No draft change to redo"} disabled={!canRedo} aria-disabled={!canRedo} onClick={onRedo}>Redo</button>
        <button className="exec-control-button exec-control-button-compact" type="button" data-qid="scillm-exec-graph:plan-edit:reset" data-qs-action="SCILLM_EXEC_PLAN_RESET_DRAFT" title={dirty ? "Reset draft to original evidence graph" : "No draft changes to reset"} disabled={!dirty} aria-disabled={!dirty} onClick={onReset}>Reset draft</button>
        <button className="exec-control-button exec-control-button-compact" type="button" data-qid="scillm-exec-graph:plan-edit:export-diff" data-qs-action="SCILLM_EXEC_PLAN_COPY_DIFF" title={dirty ? "Copy formal plan diff JSON with graph id, actor, timestamp, amendment identity, warning acknowledgements, proposal provenance, and diff hash." : "No draft changes to copy"} disabled={!dirty} aria-disabled={!dirty} onClick={onExportDiff}>{formalDiffCopied ? "Copied formal diff" : "Copy formal diff"}</button>
        <button className="exec-control-button exec-control-button-compact" type="button" data-qid="scillm-exec-graph:plan-edit:save-draft-amendment" data-qs-action="SCILLM_EXEC_PLAN_SAVE_DRAFT_AMENDMENT" disabled={amendDisabled} aria-disabled={amendDisabled} title={amendTitle} onClick={onAmend}>{amendState.status === "saving" ? "Saving draft..." : amendState.status === "saved" ? "Saved draft amendment" : staleBaseGraph ? "Refresh before save" : warningAckRequired && !warningsAcknowledged ? "Acknowledge warning to save" : warningCount ? `Save draft with ${warningCount} warning${warningCount === 1 ? "" : "s"}` : "Save draft amendment"}</button>
      </div>
      {warningAckRequired && amendState.status !== "saved" ? (
        <label className="exec-plan-warning-ack" data-qid="scillm-exec-graph:plan-warning-ack">
          <input type="checkbox" checked={warningsAcknowledged} onChange={(event) => onWarningsAcknowledgedChange(event.target.checked)} />
          <span>I acknowledge this amendment is being saved with {warningCount} validation warning{warningCount === 1 ? "" : "s"}: {validation.warnings.map((issue) => issue.code === "missing_prompt_contract" ? `missing prompt contract for ${issue.node_id ?? "graph"}` : `${issue.code} for ${issue.node_id ?? "graph"}`).join("; ")}. Acknowledgement id{warningCount === 1 ? "" : "s"} persisted: {validation.warnings.map(warningIdentity).join(", ")}</span>
        </label>
      ) : warningAckRequired && amendState.status === "saved" ? (
        <div className="exec-plan-warning-ack exec-plan-warning-ack-readonly" data-qid="scillm-exec-graph:plan-warning-ack">
          <strong>Accepted warning acknowledgement</strong>
          <span>Persisted acknowledgement: {amendState.acknowledged_warning_ids.join(", ")} accepted by scillm-exec-graph-editor at {formatTimestamp(amendState.saved_at)}.</span>
        </div>
      ) : null}
      <div className={validation.canApply && amendState.status !== "error" ? "exec-plan-amend-note" : "exec-plan-amend-note exec-plan-amend-note-blocking"}>{amendVisibleReason}</div>
    </div>
  );
}

function MemoryAmendmentsPanel({
  amendments,
  state,
  onRefresh,
  onLoadAmendment,
  onSetAmendmentStatus,
  onApplyAmendment,
}: {
  amendments: ExecGraphAmendment[];
  state: AmendmentsLoadState;
  onRefresh?: () => unknown | Promise<unknown>;
  onLoadAmendment: (amendment: ExecGraphAmendment) => void;
  onSetAmendmentStatus?: AmendmentStatusHandler;
  onApplyAmendment?: AmendmentApplyHandler;
}) {
  const [busyKey, setBusyKey] = useState<string | undefined>();
  const statusOptions: Array<Exclude<ExecGraphAmendmentStatus, "proposed">> = ["approved", "rejected", "superseded"];
  const loading = state.status === "loading";

  async function refresh() {
    if (!onRefresh || loading) return;
    setBusyKey("refresh");
    try {
      await onRefresh();
    } finally {
      setBusyKey(undefined);
    }
  }

  async function setStatus(amendment: ExecGraphAmendment, nextStatus: Exclude<ExecGraphAmendmentStatus, "proposed">) {
    if (!onSetAmendmentStatus || amendment.status === nextStatus) return;
    const nextBusyKey = `${amendment._key}:${nextStatus}`;
    setBusyKey(nextBusyKey);
    try {
      await onSetAmendmentStatus(amendment._key, nextStatus, `Marked ${nextStatus} from DAG editor.`);
    } finally {
      setBusyKey(undefined);
    }
  }

  async function applyAmendment(amendment: ExecGraphAmendment) {
    if (!onApplyAmendment || amendment.status !== "approved" || amendment.apply_status === "applied") return;
    const nextBusyKey = `${amendment._key}:apply`;
    setBusyKey(nextBusyKey);
    try {
      await onApplyAmendment(amendment, "Applied approved amendment from DAG editor.");
    } finally {
      setBusyKey(undefined);
    }
  }

  return (
    <div className="exec-plan-column" data-qid="scillm-exec-graph:memory-amendments">
      <div className="exec-plan-panel-heading exec-plan-panel-heading-row">
        <span>Memory amendments</span>
        <button
          className="exec-control-button exec-control-button-compact"
          type="button"
          data-qid="scillm-exec-graph:amendment:refresh"
          data-qs-action="SCILLM_EXEC_AMENDMENT_REFRESH"
          title={onRefresh ? "Refresh saved Memory amendments" : "No Memory amendment reader is connected."}
          disabled={!onRefresh || loading || busyKey === "refresh"}
          aria-disabled={!onRefresh || loading || busyKey === "refresh"}
          onClick={() => void refresh()}
        >
          {loading || busyKey === "refresh" ? "Refreshing" : "Refresh"}
        </button>
      </div>
      {state.status === "error" ? <div className="exec-plan-issue exec-plan-issue-warning">Memory amendment load failed: {state.message}</div> : null}
      {state.status !== "error" && state.message ? <div className="exec-plan-muted">{state.message}</div> : null}
      {amendments.length ? (
        <div className="exec-plan-list">
          {amendments.map((amendment) => {
            const canLoadDraft = Boolean(amendment.draft_graph);
            const timestamp = formatTimestamp(amendment.updated_at ?? amendment.created_at);
            const diffCount = amendment.diff?.length ?? 0;
            const applied = amendment.apply_status === "applied";
            const canApply = amendment.status === "approved" && !applied;
            const applyBusy = busyKey === `${amendment._key}:apply`;
            const applyDisabled = !onApplyAmendment || !canApply || applyBusy;
            const applyTitle = !onApplyAmendment
              ? "No Memory amendment apply writer is connected."
              : applied
                ? `Applied${amendment.applied_at ? ` at ${formatTimestamp(amendment.applied_at)}` : ""}.`
                : amendment.status !== "approved"
                  ? "Approve this amendment before applying it."
                  : "Apply this approved amendment as a provenance-recorded runtime decision overlay.";
            return (
              <div key={amendment._key} className="exec-plan-proposal exec-plan-amendment-record" data-qid={`scillm-exec-graph:amendment:${amendment._key}`}>
                <div>
                  <strong>{amendment._key}</strong>
                  <div className="exec-plan-muted">Graph {amendment.graph_id} · {timestamp}</div>
                  <div className="exec-plan-proposal-targets" aria-label="Amendment metadata">
                    <span>Status</span>
                    <b className={`exec-plan-status-badge exec-plan-status-badge-${amendment.status}`}>{amendment.status}</b>
                    <span>Diffs</span>
                    <b>{diffCount}</b>
                    <span>Apply</span>
                    <b className={`exec-plan-status-badge exec-plan-status-badge-${applied ? "approved" : "proposed"}`}>{applied ? "applied" : "not applied"}</b>
                    {amendment.actor ? <><span>Author</span><b>{amendment.actor}</b></> : null}
                  </div>
                  {amendment.status_reason ? <div className="exec-plan-muted">Status reason: {amendment.status_reason}</div> : null}
                  {amendment.status_actor ? <div className="exec-plan-muted">Status actor: {amendment.status_actor}</div> : null}
                  {applied ? <div className="exec-plan-muted">Applied by {amendment.applied_by ?? "unknown"} · {formatTimestamp(amendment.applied_at)} · graph {amendment.applied_graph_sha256?.slice(0, 16) ?? "hash unavailable"}</div> : null}
                  {amendment.apply_reason ? <div className="exec-plan-muted">Apply reason: {amendment.apply_reason}</div> : null}
                </div>
                <div className="exec-plan-amendment-actions">
                  <button
                    className="exec-control-button exec-control-button-compact"
                    type="button"
                    data-qid={`scillm-exec-graph:amendment:${amendment._key}:load`}
                    data-qs-action="SCILLM_EXEC_AMENDMENT_LOAD_DRAFT"
                    title={canLoadDraft ? "Load this saved amendment draft into the editor" : "This amendment record has no draft graph payload."}
                    disabled={!canLoadDraft}
                    aria-disabled={!canLoadDraft}
                    onClick={() => onLoadAmendment(amendment)}
                  >
                    Load draft
                  </button>
                  {statusOptions.map((nextStatus) => {
                    const buttonBusy = busyKey === `${amendment._key}:${nextStatus}`;
                    const disabled = !onSetAmendmentStatus || amendment.status === nextStatus || buttonBusy;
                    return (
                      <button
                        key={nextStatus}
                        className="exec-control-button exec-control-button-compact"
                        type="button"
                        data-qid={`scillm-exec-graph:amendment:${amendment._key}:${nextStatus}`}
                        data-qs-action="SCILLM_EXEC_AMENDMENT_SET_STATUS"
                        title={onSetAmendmentStatus ? `Mark amendment ${nextStatus}` : "No Memory amendment status writer is connected."}
                        disabled={disabled}
                        aria-disabled={disabled}
                        onClick={() => void setStatus(amendment, nextStatus)}
                      >
                        {buttonBusy ? "Saving" : nextStatus}
                      </button>
                    );
                  })}
                  <button
                    className="exec-control-button exec-control-button-compact"
                    type="button"
                    data-qid={`scillm-exec-graph:amendment:${amendment._key}:apply`}
                    data-qs-action="SCILLM_EXEC_AMENDMENT_APPLY"
                    title={applyTitle}
                    disabled={applyDisabled}
                    aria-disabled={applyDisabled}
                    onClick={() => void applyAmendment(amendment)}
                  >
                    {applyBusy ? "Applying" : applied ? "Applied" : "Apply"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : state.status === "loading" ? (
        <div className="exec-empty-state">Loading saved Memory amendments.</div>
      ) : (
        <div className="exec-empty-state">No saved Memory amendments for this graph.</div>
      )}
    </div>
  );
}

function ValidationIssueList({ issues, onSelectNode }: { issues: PlanValidationIssue[]; onSelectNode?: (nodeId: string) => void }) {
  return (
    <div className="exec-plan-list">
      {issues.map((issue, index) => (
        <div key={`${issue.code}-${issue.node_id ?? "graph"}-${index}`} className={`exec-plan-issue exec-plan-issue-${issue.severity}`}>
          <strong>{issue.severity.toUpperCase()} · {issue.code}</strong>
          <span className="exec-plan-issue-message">
            {issue.node_id && onSelectNode ? (
              <button className="exec-link-button" type="button" onClick={() => onSelectNode(issue.node_id!)} title={`Select node ${issue.node_id}`}>{issue.node_id}</button>
            ) : issue.node_id ? `${issue.node_id}: ` : ""}
            {issue.message}
          </span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section style={{ padding: 14, border: "1px solid var(--exec-border, rgba(255,255,255,0.14))", borderRadius: 8, background: "var(--exec-card, #1c2230)" }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}><h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: "20px" }}>{title}</h4>{action}</div><div style={{ display: "grid", gap: 12 }}>{children}</div></section>;
}

function Info({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return <div className="exec-info-row"><div className="exec-info-label">{label}</div><div className="exec-info-value">{children ?? value}</div></div>;
}

function EvidenceInfo({ label, value, node, optional }: { label: string; value: unknown; node: ExecGraphNode; optional: boolean }) {
  const state = evidenceState(label, formatEvidenceValue(label, value), node, optional);
  return (
    <Info label={label} value={state.text}>
      <EvidenceBadge tone={state.tone} text={state.text} />
      {state.note ? <div className="exec-evidence-note">{state.note}</div> : null}
    </Info>
  );
}

function EvidenceBadge({ tone, text }: { tone: string; text: string }) {
  return <span className={`exec-evidence-badge exec-evidence-badge-${tone}`}>{text}</span>;
}

function preStyle(): React.CSSProperties {
  return { margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--exec-json-text, #d5deee)", fontSize: 11, lineHeight: 1.5 };
}

const execGraphDebuggerCss = `
.scillm-exec-debugger {
  --exec-dim-contrast: #b8c2d6;
  --exec-border-highlight: rgba(184, 194, 214, 0.72);
  --exec-disabled-fg: #e0e5ee;
  --exec-disabled-bg: #10151c;
  --exec-disabled-border: #3a4552;
  --exec-warning: #fff7ed;
  --exec-warning-strong: #fdba74;
  --exec-warning-border: #f59e0b;
  --exec-warning-bg: #4a2b06;
  --exec-warning-solid-text: #111827;
  --exec-warning-solid-bg: #fbbf24;
  --exec-warning-solid-border: #f59e0b;
  --exec-optional-border: #9ca35a;
  --exec-focus: #63b3ed;
  display: grid;
  grid-template-columns: minmax(520px, 1fr);
  position: relative;
  min-height: 640px;
  background: var(--exec-bg, #0f1115);
  color: var(--exec-text, #e5e7eb);
  border: 1px solid var(--exec-border, rgba(255,255,255,0.14));
  border-radius: 12px;
  overflow: hidden;
}
.scillm-exec-debugger * {
  box-sizing: border-box;
}
.scillm-exec-debugger :focus-visible {
  outline: 3px solid var(--exec-focus, #63b3ed);
  outline-offset: 3px;
  box-shadow: 0 0 0 6px rgba(99, 179, 237, 0.22);
}
.exec-control-button {
  min-height: 44px;
  min-width: 44px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--exec-border, rgba(255,255,255,0.14));
  background: var(--exec-card, #1c2230);
  color: var(--exec-text, #e5e7eb);
  cursor: pointer;
  font: inherit;
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}
.exec-control-button:hover {
  border-color: var(--exec-border-highlight);
  background: rgba(147,197,253,0.13);
}
.exec-control-button:disabled,
.exec-control-button[aria-disabled="true"] {
  color: var(--exec-disabled-fg, #e0e5ee);
  background: var(--exec-disabled-bg, #10151c);
  border-color: var(--exec-disabled-border, #3a4552);
  cursor: not-allowed;
  transform: none;
  opacity: 1;
}
.exec-control-button:disabled:hover,
.exec-control-button[aria-disabled="true"]:hover {
  border-color: var(--exec-disabled-border, #303642);
  background: var(--exec-disabled-bg, #1e2532);
}
.exec-control-button:active {
  background: rgba(255,255,255,0.1);
  transform: translateY(1px);
}
.exec-control-button-danger:hover {
  border-color: rgba(239, 68, 68, 0.75);
  background: rgba(239, 68, 68, 0.14);
}
.exec-control-button-compact {
  min-height: 44px;
  padding: 6px 10px;
  font-size: 12px;
}
.exec-controls-cluster {
  display: grid;
  justify-items: end;
  gap: 8px;
}
.exec-controls-reason {
  max-width: 300px;
  color: var(--exec-dim-contrast);
  font-size: 12px;
  line-height: 16px;
  text-align: right;
}
.exec-controls-reason-error {
  color: var(--exec-failed, #ef4444);
}
.exec-controls-unwired {
  max-width: 320px;
  padding: 10px 12px;
  border: 1px solid var(--exec-warning, #facc15);
  border-radius: 8px;
  background: rgba(250, 204, 21, 0.08);
  color: var(--exec-warning, #facc15);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-align: right;
}
.exec-node-button:hover {
  border-color: var(--exec-border-highlight) !important;
  background: color-mix(in srgb, var(--exec-card, #1c2230), #93c5fd 12%) !important;
}
.exec-node-button-selected {
  box-shadow: 0 0 0 4px var(--exec-card, #1c2230), 0 0 0 8px var(--exec-selected-ring, #22d3ee);
}
.exec-round-band {
  fill: rgba(34, 197, 94, 0.035);
  stroke: rgba(34, 197, 94, 0.78);
  stroke-width: 3px;
}
.exec-round-band-label,
.exec-round-band-side-label,
.exec-lane-label {
  fill: var(--exec-dim-contrast);
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0;
  text-anchor: middle;
}
.exec-round-band-label {
  text-anchor: start;
}
.exec-round-band-side-label {
  fill: var(--exec-passed, #22c55e);
  font-size: 14px;
}
.exec-lane-label {
  fill: var(--exec-text, #e5e7eb);
}
.exec-node-button-blocking {
  background: #23181b !important;
  box-shadow: 0 0 0 2px rgba(239,68,68,0.35), 0 0 18px rgba(239,68,68,0.28);
}
.exec-node-button:focus-visible {
  outline: 0;
  box-shadow: inset 0 0 0 3px var(--exec-focus, #63b3ed), 0 0 0 2px var(--exec-focus, #63b3ed), 0 0 0 7px rgba(99,179,237,0.22);
}
.exec-node-button-selected:focus-visible {
  box-shadow: inset 0 0 0 3px var(--exec-focus, #63b3ed), 0 0 0 4px var(--exec-card, #1c2230), 0 0 0 8px var(--exec-selected-ring, #22d3ee), 0 0 0 11px var(--exec-focus, #63b3ed);
}
.exec-node-button:active {
  transform: translateY(1px);
}
.exec-node-status {
  justify-self: start;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.16);
  padding: 2px 7px;
  font-size: 10px;
  line-height: 13px;
  color: var(--exec-text, #e5e7eb);
  background: rgba(255,255,255,0.06);
}
.exec-node-status-warning {
  color: var(--exec-warning-solid-text, #111827);
  border-color: var(--exec-warning-solid-border, #f59e0b);
  background: var(--exec-warning-solid-bg, #fbbf24);
  font-weight: 800;
}
.exec-node-optional-badge {
  justify-self: start;
  border-radius: 8px;
  border: 1px solid var(--exec-optional-border, #9ca35a);
  background: rgba(156,163,90,0.1);
  color: #d9df8f;
  padding: 2px 7px;
  font-size: 10px;
  line-height: 13px;
}
.exec-node-blocking-icon {
  grid-row: 1 / span 3;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--exec-failed, #ef4444);
  color: #ffffff;
  font-size: 13px;
  font-weight: 800;
  line-height: 18px;
}
.exec-node-validation-badge {
  justify-self: start;
  border-radius: 8px;
  border: 1px solid var(--exec-warning-solid-border, #f59e0b);
  background: var(--exec-warning-solid-bg, #fbbf24);
  color: var(--exec-warning-solid-text, #111827);
  padding: 2px 7px;
  font-size: 10px;
  line-height: 13px;
  font-weight: 800;
}
.exec-node-validation-badge-blocking {
  border-color: var(--exec-failed, #ef4444);
  background: var(--exec-failed, #ef4444);
  color: #ffffff;
  font-weight: 800;
  text-transform: uppercase;
}
.exec-verdict-impact {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid rgba(250, 204, 21, 0.38);
  background: rgba(250, 204, 21, 0.1);
  color: var(--exec-warning, #facc15);
  padding: 2px 8px;
}
.exec-verdict-impact-failed {
  border-color: rgba(239,68,68,0.5);
  background: rgba(239,68,68,0.12);
  color: var(--exec-failed, #ef4444);
}
.exec-summary-chip {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
  color: var(--exec-dim-contrast);
  padding: 4px 10px;
  font-size: 12px;
  font: inherit;
}
.exec-summary-label {
  color: var(--exec-dim-contrast);
  font-size: 12px;
  font-weight: 600;
}
button.exec-summary-chip {
  cursor: pointer;
}
.exec-summary-chip-action {
  margin-left: 8px;
  color: var(--exec-selected-ring, #22d3ee);
  border-color: rgba(34, 211, 238, 0.42);
  background: rgba(34, 211, 238, 0.08);
}
.exec-summary-chip-action:hover {
  background: rgba(34, 211, 238, 0.16);
}
.exec-summary-action-button {
  min-height: 44px;
  border: 1px solid rgba(34, 211, 238, 0.5);
  border-radius: 8px;
  background: rgba(34, 211, 238, 0.1);
  color: var(--exec-selected-ring, #22d3ee);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 6px 12px;
  margin-left: 8px;
}
.exec-summary-action-button:hover {
  border-color: var(--exec-selected-ring, #22d3ee);
  background: rgba(34, 211, 238, 0.18);
}
.exec-summary-chip-passed {
  color: var(--exec-passed, #22c55e);
  border-color: rgba(34,197,94,0.34);
}
.exec-summary-chip-warning {
  color: var(--exec-warning, #facc15);
  border-color: var(--exec-warning-border, #8a6a1f);
  background: var(--exec-warning-bg, #3a2a0a);
}
.exec-inspector-header {
  border-left: 3px solid var(--exec-selected-ring, #22d3ee);
  padding-left: 10px;
}
.exec-inspector-sticky-summary {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 12px 12px 12px 10px;
  background: color-mix(in srgb, var(--exec-panel, #151923), #000 6%);
  border-bottom: 1px solid var(--exec-border, rgba(255,255,255,0.14));
  box-shadow: 0 10px 18px rgba(0,0,0,0.24);
}
.exec-inspector-proof-summary {
  margin-top: 10px;
  color: var(--exec-text, #e5e7eb);
  font-size: 12px;
  line-height: 17px;
  font-weight: 600;
}
.exec-mode-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 4px 0 8px;
}
.exec-compliance-summary-heading {
  margin-top: 12px;
  color: var(--exec-dim-contrast);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.exec-compliance-issue-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 8px;
  border: 1px solid rgba(34,197,94,0.34);
  background: rgba(34,197,94,0.1);
  color: var(--exec-passed, #22c55e);
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 800;
}
.exec-compliance-issue-badge-blocking {
  border-color: var(--exec-failed, #ef4444);
  background: var(--exec-failed, #ef4444);
  color: #ffffff;
}
.exec-compliance-issue-badge-warning {
  border-color: var(--exec-warning-solid-border, #f59e0b);
  background: var(--exec-warning-solid-bg, #fbbf24);
  color: var(--exec-warning-solid-text, #111827);
}
.exec-readiness-field-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.exec-readiness-field {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 3px 7px;
  border: 1px solid var(--exec-failed, #ef4444);
  border-radius: 6px;
  background: rgba(127, 29, 29, 0.45);
  color: #fecaca;
  font-size: 11px;
  line-height: 15px;
  overflow-wrap: anywhere;
}
.exec-node-summary-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  margin-top: 12px;
}
.exec-info-row {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.exec-info-label {
  color: var(--exec-dim-contrast);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.exec-info-value {
  min-width: 0;
  font-size: 13px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.exec-evidence-badge {
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  border-radius: 999px;
  padding: 3px 8px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: var(--exec-text, #e5e7eb);
}
.exec-evidence-badge-present {
  border-color: rgba(34,197,94,0.34);
  background: rgba(34,197,94,0.1);
  color: var(--exec-passed, #22c55e);
}
.exec-evidence-badge-optional {
  border-color: var(--exec-warning-solid-border, #f59e0b);
  background: var(--exec-warning-solid-bg, #fbbf24);
  color: var(--exec-warning-solid-text, #111827);
  font-weight: 800;
}
.exec-evidence-badge-missing {
  border-color: rgba(239,68,68,0.56);
  background: var(--exec-evidence-missing-bg, #3b1d1d);
  color: var(--exec-evidence-missing-text, #fecaca);
}
.exec-evidence-badge-na {
  border-color: rgba(209,213,219,0.18);
  background: var(--exec-evidence-na-bg, #1f2937);
  color: var(--exec-evidence-na-text, #d1d5db);
}
.exec-evidence-note {
  margin-top: 4px;
  color: var(--exec-dim-contrast);
  font-size: 12px;
  line-height: 16px;
}
.exec-link-button {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(34, 211, 238, 0.42);
  border-radius: 999px;
  background: rgba(34, 211, 238, 0.08);
  color: var(--exec-selected-ring, #22d3ee);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 8px 12px;
}
.exec-link-button:hover {
  background: rgba(34, 211, 238, 0.16);
}
.exec-primary-mode-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 14px;
}
.exec-primary-mode {
  min-height: 52px;
  display: grid;
  gap: 2px;
  align-content: center;
  border: 1px solid var(--exec-border, rgba(255,255,255,0.14));
  border-radius: 8px;
  background: rgba(0,0,0,0.12);
  color: var(--exec-dim-contrast);
  cursor: pointer;
  font: inherit;
  padding: 8px 10px;
  text-align: left;
}
.exec-primary-mode b {
  color: var(--exec-text, #e5e7eb);
  font-size: 13px;
}
.exec-primary-mode span {
  font-size: 11px;
}
.exec-primary-mode:hover,
.exec-primary-mode-active {
  border-color: var(--exec-selected-ring, #22d3ee);
  background: rgba(34, 211, 238, 0.13);
}
.exec-execution-strip,
.exec-view-model-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.exec-execution-group,
.exec-view-model-strip span {
  min-height: 36px;
  display: inline-grid;
  align-content: center;
  gap: 2px;
  border: 1px solid var(--exec-border, rgba(255,255,255,0.14));
  border-radius: 8px;
  background: rgba(0,0,0,0.14);
  color: var(--exec-dim-contrast);
  padding: 5px 9px;
  font-size: 11px;
}
.exec-execution-group strong,
.exec-view-model-strip b {
  color: var(--exec-text, #e5e7eb);
  font-size: 12px;
}
.exec-execution-group-running strong {
  color: var(--exec-running, #f59e0b);
}
.exec-execution-group-warning strong {
  color: var(--exec-warning, #facc15);
}
.exec-execution-group-failed strong {
  color: var(--exec-failed, #ef4444);
}
.exec-view-model-strip .exec-view-model-stale {
  border-color: rgba(245,158,11,0.5);
  background: rgba(245,158,11,0.12);
  color: var(--exec-warning, #facc15);
}
.exec-stale-base-warning,
.exec-plan-stale-warning {
  margin-top: 10px;
  border: 1px solid rgba(245,158,11,0.52);
  border-radius: 8px;
  background: rgba(245,158,11,0.11);
  color: var(--exec-warning, #facc15);
  padding: 9px 10px;
  font-size: 12px;
  line-height: 17px;
  font-weight: 700;
}
.exec-mode-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.exec-mode-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--exec-border, rgba(255,255,255,0.14));
  border-radius: 8px;
  background: rgba(0,0,0,0.14);
}
.exec-mode-tab {
  min-height: 44px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--exec-dim-contrast);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 6px 10px;
}
.exec-mode-tab:hover {
  background: rgba(255,255,255,0.08);
  color: var(--exec-text, #e5e7eb);
}
.exec-mode-tab-active {
  background: rgba(34, 211, 238, 0.16);
  color: var(--exec-selected-ring, #22d3ee);
}
.exec-plan-chip {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.14);
  padding: 4px 10px;
  font-size: 12px;
}
.exec-plan-chip-ok {
  color: var(--exec-passed, #22c55e);
  border-color: rgba(34,197,94,0.34);
  background: rgba(34,197,94,0.1);
}
.exec-plan-chip-blocking {
  color: var(--exec-failed, #ef4444);
  border-color: rgba(239,68,68,0.5);
  background: rgba(239,68,68,0.12);
}
.exec-plan-chip-readonly {
  color: var(--exec-dim-contrast);
  border-color: #3a4552;
  background: #222936;
}
.exec-plan-chip-dirty {
  color: var(--exec-warning, #facc15);
  border-color: var(--exec-warning-border, #8a6a1f);
  background: var(--exec-warning-bg, #3a2a0a);
}
.exec-plan-panel {
  display: grid;
  grid-template-columns: minmax(190px, 1fr) minmax(220px, 1.2fr) auto;
  gap: 16px;
  align-items: start;
  margin-bottom: 10px;
  padding: 10px;
  border: 1px solid var(--exec-border, rgba(255,255,255,0.14));
  border-radius: 8px;
  background: rgba(0,0,0,0.12);
}
.exec-plan-audit-banner {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 12px;
  align-items: center;
  border-radius: 8px;
  border: 1px solid rgba(34, 211, 238, 0.32);
  background: rgba(34, 211, 238, 0.08);
  color: var(--exec-text, #e5e7eb);
  padding: 12px 14px;
  font-size: 12px;
  line-height: 16px;
}
.exec-plan-audit-banner strong {
  grid-column: 1 / -1;
  color: var(--exec-text, #e5e7eb);
  font-size: 13px;
}
.exec-plan-audit-banner span {
  display: grid;
  gap: 2px;
}
.exec-plan-audit-banner em {
  color: var(--exec-text, #e5e7eb);
  font-style: normal;
  font-weight: 650;
}
.exec-plan-audit-banner b {
  color: var(--exec-dim-contrast);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.exec-plan-audit-banner-dirty {
  border-color: var(--exec-warning-border, #8a6a1f);
  background: var(--exec-warning-bg, #3a2a0a);
}
.exec-plan-audit-status-attention {
  border-left: 3px solid var(--exec-warning-border, #f59e0b);
  padding-left: 8px;
}
.exec-plan-audit-status-attention em {
  color: var(--exec-warning-strong, #fdba74);
}
.exec-plan-audit-status-ok em {
  color: #86efac;
}
.exec-plan-audit-diff-status {
  min-height: 44px;
}
.exec-plan-inline-action {
  justify-self: start;
  min-height: 28px;
  border: 1px solid rgba(253, 186, 116, 0.62);
  border-radius: 8px;
  background: rgba(253, 186, 116, 0.1);
  color: var(--exec-warning, #fff7ed);
  padding: 4px 8px;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}
.exec-plan-inline-action:hover {
  border-color: var(--exec-warning-strong, #fdba74);
  background: rgba(253, 186, 116, 0.18);
}
.exec-plan-audit-log {
  grid-column: 1 / -1;
  display: grid;
  gap: 8px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(0,0,0,0.14);
  padding: 8px;
}
.exec-plan-audit-entry {
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.04);
  color: var(--exec-text, #e5e7eb);
}
.exec-plan-audit-entry summary {
  min-height: 44px;
  display: grid;
  grid-template-columns: 72px minmax(100px, auto) minmax(90px, auto) minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  cursor: pointer;
  padding: 6px 8px;
  font-size: 13px;
  line-height: 18px;
}
.exec-plan-saved-memory {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px 14px;
  border-radius: 8px;
  border: 1px solid rgba(34,197,94,0.38);
  background: rgba(34,197,94,0.08);
  color: var(--exec-text, #e5e7eb);
  padding: 10px;
  font-size: 12px;
  line-height: 16px;
}
.exec-plan-saved-memory strong {
  grid-column: 1 / -1;
  font-size: 13px;
}
.exec-plan-saved-memory span {
  display: grid;
  gap: 2px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.exec-plan-saved-memory-primary {
  border-radius: 8px;
  border: 1px solid rgba(34,197,94,0.42);
  background: rgba(34,197,94,0.12);
  padding: 8px;
}
.exec-plan-saved-memory-accepted-warning {
  border-radius: 8px;
  border: 1px solid rgba(34,211,238,0.38);
  background: rgba(34,211,238,0.1);
  padding: 8px;
}
.exec-plan-saved-memory b {
  color: var(--exec-dim-contrast);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.exec-plan-column {
  min-width: 0;
  display: grid;
  gap: 16px;
}
.exec-plan-panel-heading {
  color: var(--exec-dim-contrast);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.exec-plan-panel-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.exec-plan-list {
  display: grid;
  gap: 6px;
}
.exec-plan-field {
  display: grid;
  gap: 6px;
  color: var(--exec-dim-contrast);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.exec-build-quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  border: 1px solid var(--exec-border, rgba(255,255,255,0.14));
  border-radius: 8px;
  background: rgba(34, 211, 238, 0.07);
  padding: 8px;
}
.exec-build-quick-actions .exec-control-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.exec-plan-sensitive-group {
  display: grid;
  gap: 12px;
  border-radius: 8px;
  border: 2px solid #6a7d90;
  background: #1a2430;
  padding: 10px;
}
.exec-plan-subheading {
  color: #d5deee;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.exec-plan-obligation-summary {
  display: grid;
  gap: 8px;
  border-radius: 8px;
  border: 1px dashed rgba(34, 211, 238, 0.38);
  background: rgba(34, 211, 238, 0.08);
  padding: 8px;
  color: var(--exec-text, #e5e7eb);
  font-size: 12px;
  line-height: 16px;
  text-transform: none;
  letter-spacing: 0;
}
.exec-plan-obligation-summary span {
  display: grid;
  gap: 2px;
}
.exec-plan-obligation-summary b {
  color: var(--exec-dim-contrast);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.exec-review-scope-editor {
  display: grid;
  gap: 10px;
  border-radius: 8px;
  border: 1px solid rgba(34, 211, 238, 0.34);
  background: rgba(34, 211, 238, 0.06);
  padding: 10px;
}
.exec-review-scope-list {
  display: grid;
  gap: 10px;
}
.exec-review-scope-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 8px;
  align-items: end;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(0,0,0,0.14);
  padding: 8px;
}
.exec-review-scope-toolbar {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.exec-review-scope-enabled {
  justify-items: start;
}
.exec-review-scope-enabled input {
  width: 44px;
  height: 44px;
  margin: 0;
  accent-color: var(--exec-selected-ring, #22d3ee);
}
.exec-review-scope-prompt {
  grid-column: 1 / -1;
}
.exec-review-scope-best-practices {
  grid-column: 1 / -1;
}
.exec-review-scope-best-practices-input {
  min-height: 64px;
}
.exec-review-scope-remove {
  align-self: end;
}
.exec-plan-inline-help,
.exec-plan-inline-warning {
  color: var(--exec-dim-contrast);
  font-size: 12px;
  line-height: 16px;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
}
.exec-plan-inline-warning {
  justify-self: start;
  border-radius: 8px;
  border: 1px solid var(--exec-warning-solid-border, #f59e0b);
  background: var(--exec-warning-solid-bg, #fbbf24);
  color: var(--exec-warning-solid-text, #111827);
  padding: 4px 8px;
  font-weight: 800;
}
.exec-plan-input {
  width: 100%;
  min-height: 44px;
  border: 1px solid rgba(34, 211, 238, 0.48);
  border-radius: 8px;
  background: #202a3a;
  color: var(--exec-text, #e5e7eb);
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  padding: 8px 10px;
  box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.18);
}
.exec-plan-input:hover {
  border-color: rgba(34, 211, 238, 0.72);
  background: #263449;
}
.exec-plan-input:focus,
.exec-plan-input:focus-visible {
  outline: 3px solid var(--exec-focus, #63b3ed);
  outline-offset: 2px;
  box-shadow: 0 0 0 6px rgba(99, 179, 237, 0.22);
}
.exec-plan-textarea {
  min-height: 84px;
  resize: vertical;
}
.exec-plan-dependencies {
  display: grid;
  gap: 8px;
}
.exec-plan-dependency-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.exec-plan-add-dependency {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
.exec-plan-remove-button {
  min-height: 44px;
  border: 1px solid rgba(239,68,68,0.5);
  border-radius: 999px;
  background: rgba(239,68,68,0.1);
  color: var(--exec-evidence-missing-text, #fecaca);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 3px 8px;
}
.exec-plan-available-dependencies {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.exec-plan-invalid-dependencies {
  display: grid;
  gap: 4px;
  border-radius: 8px;
  border: 1px solid rgba(148,163,184,0.34);
  background: rgba(148,163,184,0.08);
  color: var(--exec-dim-contrast);
  padding: 8px;
  font-size: 12px;
  line-height: 16px;
}
.exec-plan-issue {
  display: grid;
  gap: 2px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.12);
  padding: 8px;
  font-size: 12px;
  line-height: 16px;
}
.exec-plan-issue-blocking {
  border-color: rgba(239,68,68,0.5);
  background: rgba(239,68,68,0.12);
  color: var(--exec-evidence-missing-text, #fecaca);
}
.exec-plan-issue-warning {
  border-color: var(--exec-warning-solid-border, #f59e0b);
  background: var(--exec-warning-solid-bg, #fbbf24);
  color: var(--exec-warning-solid-text, #111827);
  box-shadow: inset 4px 0 0 #111827;
  font-weight: 800;
}
.exec-plan-issue-info {
  border-color: rgba(34,211,238,0.32);
  background: rgba(34,211,238,0.08);
  color: var(--exec-selected-ring, #22d3ee);
}
.exec-plan-rejected-patch {
  border-color: rgba(148,163,184,0.34);
  background: rgba(148,163,184,0.08);
  color: var(--exec-text, #e5e7eb);
}
.exec-plan-validation-summary {
  min-height: 36px;
  display: flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid rgba(34,211,238,0.32);
  background: rgba(34,211,238,0.08);
  color: var(--exec-selected-ring, #22d3ee);
  padding: 6px 8px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 800;
}
.exec-plan-validation-summary-blocking {
  border-color: rgba(239,68,68,0.5);
  background: rgba(239,68,68,0.12);
  color: var(--exec-evidence-missing-text, #fecaca);
}
.exec-plan-issue-message {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.exec-plan-diff-row,
.exec-plan-proposal {
  display: grid;
  gap: 3px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.12);
  padding: 8px;
  font-size: 12px;
  line-height: 16px;
  color: var(--exec-text, #e5e7eb);
}
.exec-plan-proposal {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}
.exec-plan-proposal-applied {
  border-color: rgba(34,197,94,0.34);
  background: rgba(34,197,94,0.08);
}
.exec-plan-amendment-record {
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}
.exec-plan-amendment-record strong {
  overflow-wrap: anywhere;
}
.exec-plan-amendment-actions {
  display: flex;
  justify-content: flex-start;
  gap: 6px;
  flex-wrap: wrap;
}
.exec-plan-proposal-diff {
  display: grid;
  gap: 8px;
  margin-top: 8px;
  border-radius: 8px;
  border: 1px dashed rgba(34, 211, 238, 0.32);
  padding: 8px;
  color: var(--exec-text, #e5e7eb);
}
.exec-plan-proposal-targets {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.exec-plan-proposal-targets span {
  color: var(--exec-dim-contrast);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.exec-plan-proposal-diff .exec-info-label {
  border-bottom: 1px solid rgba(255,255,255,0.14);
  padding-bottom: 6px;
}
.exec-plan-status-badge {
  justify-self: end;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid rgba(34,197,94,0.42);
  background: rgba(34,197,94,0.12);
  color: var(--exec-passed, #22c55e);
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 800;
}
.exec-plan-status-badge-rejected {
  border-color: rgba(239,68,68,0.5);
  background: rgba(239,68,68,0.12);
  color: var(--exec-failed, #ef4444);
}
.exec-plan-status-badge-superseded {
  border-color: rgba(148,163,184,0.42);
  background: rgba(148,163,184,0.12);
  color: var(--exec-dim-contrast);
}
.exec-plan-status-badge-proposed {
  border-color: rgba(34,211,238,0.34);
  background: rgba(34,211,238,0.08);
  color: var(--exec-selected-ring, #22d3ee);
}
.exec-plan-diff-detail {
  font-weight: 600;
}
.exec-plan-diff-before-after {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-top: 6px;
}
.exec-plan-diff-before-after span {
  display: grid;
  gap: 2px;
}
.exec-plan-diff-before-after b {
  color: var(--exec-dim-contrast);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.exec-plan-diff-before-after em {
  color: var(--exec-text, #e5e7eb);
  font-style: normal;
  overflow-wrap: anywhere;
}
.exec-plan-obligation {
  grid-column: 1 / -1;
  border-radius: 8px;
  background: rgba(34,211,238,0.08);
  border: 1px solid rgba(34,211,238,0.28);
  padding: 6px 8px;
  color: var(--exec-selected-ring, #22d3ee);
  font-size: 12px;
  line-height: 16px;
}
.exec-plan-warning-ack {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  border-radius: 8px;
  border: 1px solid #d6a800;
  background: #fff8db;
  color: var(--exec-warning-solid-text, #111827);
  padding: 8px 10px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 800;
}
.exec-plan-warning-ack input {
  width: 18px;
  height: 18px;
  margin-top: 1px;
}
.exec-plan-warning-ack-readonly {
  grid-template-columns: minmax(0, 1fr);
  border-color: rgba(34,211,238,0.45);
  background: rgba(34,211,238,0.1);
  color: var(--exec-text, #e5e7eb);
}
.exec-plan-warning-ack-readonly strong {
  color: var(--exec-selected-ring, #22d3ee);
}
.exec-plan-json-diff {
  margin-top: 6px;
}
.exec-plan-json-diff summary {
  min-height: 32px;
  cursor: pointer;
  color: var(--exec-selected-ring, #22d3ee);
  font-size: 12px;
}
.exec-draft-node-badge {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  border-radius: 8px;
  border: 1px solid rgba(56, 161, 105, 0.42);
  background: rgba(56, 161, 105, 0.18);
  color: #ffffff;
  padding: 3px 8px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 800;
}
.exec-readonly-node-badge {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  border-radius: 8px;
  border: 1px solid #3a4552;
  background: #222936;
  color: var(--exec-dim-contrast);
  padding: 3px 8px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 800;
}
.exec-source-node-badge {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
  color: var(--exec-dim-contrast);
  padding: 3px 8px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 700;
}
.exec-plan-muted {
  color: var(--exec-dim-contrast);
  font-size: 12px;
  line-height: 16px;
}
.exec-plan-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.exec-plan-commit-note {
  grid-column: 1 / -1;
  min-height: 32px;
  display: flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid var(--exec-disabled-border, #3a4552);
  background: var(--exec-disabled-bg, #10151c);
  color: var(--exec-disabled-fg, #e0e5ee);
  padding: 6px 8px;
  font-size: 12px;
  line-height: 16px;
}
.exec-plan-amend-note {
  grid-column: 1 / -1;
  min-height: 32px;
  display: flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid rgba(34,211,238,0.32);
  background: rgba(34,211,238,0.08);
  color: var(--exec-selected-ring, #22d3ee);
  padding: 6px 8px;
  font-size: 12px;
  line-height: 16px;
}
.exec-plan-amend-note-blocking {
  border-color: rgba(239,68,68,0.5);
  background: rgba(239,68,68,0.12);
  color: var(--exec-evidence-missing-text, #fecaca);
}
.exec-summary-chip-failed {
  color: var(--exec-failed, #ef4444);
  border-color: rgba(239,68,68,0.5);
  background: rgba(239,68,68,0.12);
}
.exec-events-list {
  min-height: 92px;
  max-height: 174px;
  resize: vertical;
  overflow: auto;
  display: grid;
  gap: 4px;
  scrollbar-color: rgba(184,194,214,0.42) rgba(255,255,255,0.04);
}
.exec-event-row {
  display: grid;
  grid-template-columns: 10px 94px minmax(118px, auto) minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  min-height: 52px;
  border: 0;
  background: transparent;
  color: var(--exec-text, #e5e7eb);
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}
.exec-event-row:hover:not(:disabled) {
  color: var(--exec-text, #e5e7eb);
  background: rgba(255,255,255,0.05);
}
.exec-event-row-selected {
  color: var(--exec-text, #e5e7eb);
  background: rgba(34, 211, 238, 0.1);
  box-shadow: inset 3px 0 0 var(--exec-selected-ring, #22d3ee);
}
.exec-event-row:disabled {
  cursor: default;
  color: var(--exec-disabled-fg, #c0c8d6);
}
.exec-event-row strong {
  color: var(--exec-text, #e5e7eb);
  font-weight: 600;
}
.exec-event-time {
  white-space: nowrap;
  color: var(--exec-dim-contrast);
  font-variant-numeric: tabular-nums;
}
.exec-event-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--exec-dim-contrast);
}
.exec-event-filter-select {
  width: auto;
  min-width: 116px;
  min-height: 44px;
}
.exec-canvas-legend {
  position: absolute;
  top: 56px;
  right: 12px;
  z-index: 1;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 999px;
  background: rgba(15,17,21,0.78);
  color: var(--exec-dim-contrast);
  padding: 3px 9px;
  font-size: 12px;
  line-height: 18px;
}
.exec-canvas-toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 3;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 8px;
  background: rgba(15,17,21,0.92);
  padding: 4px;
  box-shadow: 0 12px 30px rgba(0,0,0,0.28);
}
.exec-canvas-tool-button {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--exec-text, #e5e7eb);
  cursor: pointer;
}
.exec-canvas-tool-button:hover,
.exec-canvas-tool-button-active {
  border-color: var(--exec-selected-ring, #22d3ee);
  background: rgba(34, 211, 238, 0.14);
}
.exec-canvas-zoom-label {
  min-width: 40px;
  padding: 0 4px;
  color: var(--exec-dim-contrast);
  font-size: 11px;
  font-weight: 700;
  text-align: center;
}
.exec-canvas-context-menu {
  position: fixed;
  z-index: 20;
  min-width: 148px;
  display: grid;
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--exec-border-highlight);
  border-radius: 8px;
  background: var(--exec-panel, #151923);
  box-shadow: 0 18px 42px rgba(0,0,0,0.4);
}
.exec-canvas-context-menu button {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--exec-text, #e5e7eb);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.exec-canvas-context-menu button:hover {
  background: rgba(34, 211, 238, 0.14);
}
.exec-node-inspector-slideout {
  position: absolute;
  top: 16px;
  right: 16px;
  bottom: 16px;
  z-index: 8;
  width: min(420px, calc(100% - 40px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--exec-panel, #151923);
  border: 1px solid var(--exec-selected-ring, #22d3ee);
  border-radius: 12px;
  box-shadow: 0 22px 56px rgba(0,0,0,0.46);
  overflow: hidden;
  transform: translateX(calc(100% + 24px));
  opacity: 0;
  pointer-events: none;
  transition: transform 180ms ease, opacity 180ms ease;
}
.exec-node-inspector-slideout[data-open="true"] {
  transform: translateX(0);
  opacity: 1;
  pointer-events: auto;
}
.exec-node-inspector-slideout > div:last-child,
.exec-node-inspector-slideout > section,
.exec-node-inspector-slideout > article {
  min-height: 0;
  overflow: auto;
}
.exec-node-inspector-bar {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px 6px 14px;
  border-bottom: 1px solid var(--exec-border, rgba(255,255,255,0.14));
  color: var(--exec-text, #e5e7eb);
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.exec-inspector-reopen {
  position: absolute;
  top: 18px;
  right: 18px;
  z-index: 7;
  min-height: 36px;
  border: 1px solid var(--exec-selected-ring, #22d3ee);
  border-radius: 999px;
  background: rgba(15,17,21,0.9);
  color: var(--exec-text, #e5e7eb);
  padding: 0 12px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.exec-canvas-keyboard-hint {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 1;
  max-width: min(520px, calc(100% - 24px));
  border: 1px solid rgba(99,179,237,0.48);
  border-radius: 8px;
  background: rgba(15,17,21,0.86);
  color: var(--exec-text, #e5e7eb);
  padding: 6px 9px;
  font-size: 12px;
  line-height: 16px;
}
.exec-json-pre {
  max-height: 320px;
  overflow: auto;
  padding: 10px;
  border-radius: 8px;
  background: rgba(0,0,0,0.22);
  border: 1px solid rgba(255,255,255,0.08);
  scrollbar-color: rgba(184,194,214,0.42) rgba(255,255,255,0.04);
}
.exec-empty-state {
  min-height: 44px;
  display: flex;
  align-items: center;
  padding: 10px;
  border-radius: 8px;
  background: rgba(0,0,0,0.16);
  border: 1px dashed rgba(255,255,255,0.12);
  color: var(--exec-dim-contrast);
  font-size: 12px;
  line-height: 18px;
}
@media (max-width: 900px) {
  .scillm-exec-debugger {
    grid-template-columns: 1fr;
  }
  .exec-plan-panel {
    grid-template-columns: 1fr;
  }
  .exec-plan-audit-banner {
    grid-template-columns: 1fr;
  }
  .exec-plan-audit-entry summary {
    grid-template-columns: 1fr;
  }
}
`;

export default ScillmExecGraphDebugger;
