import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bug,
  CheckSquare,
  FileJson,
  GitBranch,
  Network,
  PencilRuler,
  Play,
  ShieldCheck,
  RefreshCcw,
} from "lucide-react";
import { EMBRY } from "../common/EmbryStyle";
import { useRegisterAction } from "../../hooks/useRegisterAction";
import {
  ScillmExecGraphDebugger,
  type AmendmentsLoadState,
  type ExecGraphAmendment,
  type ExecGraphAmendmentStatus,
  type ExecEvent,
  type ExecGraph,
  type ExecStatus,
  type ReviewCatalog,
  type ReviewCatalogEntry,
  type RuntimeActionRequest,
} from "./dag-planner/ScillmExecGraphDebugger";
import { DagExplorerPane, type DagExplorerItem } from "./dag-planner/DagExplorerPane";
import { DagContractEditor } from "./dag-planner/DagContractEditor";

type DagSnapshot = {
  ok: boolean;
  phase_id: string;
  active_phase_id?: string | null;
  requested_phase_id?: string | null;
  phase_matches_active?: boolean | null;
  snapshot_kind?: "runtime_exec_artifacts" | "plan_iterate_phase_plan" | string;
  missing_runtime_artifacts?: Record<string, string>;
  source: Record<string, string>;
  graph: ExecGraph;
  base_graph_hash: string;
  hash_algorithm?: string;
  status: ExecStatus;
  events: ExecEvent[];
  phase_status?: {
    status?: string;
    review_status?: string;
    review_comparison?: { closure_allowed?: boolean; reason?: string };
    known_caveats?: string[];
  } | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; snapshot: DagSnapshot };

type PlannerSurface = "source" | "design" | "trace" | "checkpoints" | "debug";
type SourcePayload = "graph" | "status" | "events" | "phase_status" | "snapshot";

type DagWorkspaceRecord = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  kind: "source" | "draft";
  graph: ExecGraph;
  baseGraphHash: string;
  lastRun?: {
    status: ExecStatus;
    events: ExecEvent[];
    runAt: string;
  };
  source?: Record<string, string>;
  artifactPath?: string;
};

const API_HEADERS = { "Content-Type": "application/json" };

function initialPhaseIdFromLocation() {
  if (typeof window === "undefined") return "";
  const searchPhase = new URLSearchParams(window.location.search).get("phase_id");
  if (searchPhase) return searchPhase;
  const hashQuery = window.location.hash.includes("?") ? window.location.hash.slice(window.location.hash.indexOf("?") + 1) : "";
  return new URLSearchParams(hashQuery).get("phase_id") ?? "";
}

function graphEdgeCount(graph: ExecGraph) {
  return graph.nodes.reduce((count, node) => count + (node.depends_on?.length ?? 0), 0);
}

function dagTitle(graph: ExecGraph) {
  return graph.graph_id
    .replace(/^phase-\d+-/, "")
    .replace(/-run-\d+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .slice(0, 58) || "Untitled DAG";
}

function createStarterDag(seed = Date.now()): ExecGraph {
  return {
    exec_graph_version: "scillm.exec.graph.v1",
    graph_id: `draft-project-dag-${seed}`,
    graph_goal:
      "Create and run a three-step project DAG that defines a goal, validates the goal artifact, and emits a final report.",
    cwd: "/home/graham/workspace/experiments/scillm",
    max_concurrency: 1,
    nodes: [
      {
        id: "define-goal",
        type: "local_command",
        protocol_role: "planner",
        node_goal:
          "Write a concrete project goal artifact that the downstream DAG nodes can validate and summarize.",
        command:
          "python - <<'PY'\nimport json, pathlib, time\ntime.sleep(8)\nartifact = pathlib.Path('/tmp/scillm-dag-starter-goal.json')\npayload = {\n  'project_goal': 'Create a DAG from scratch in the viewer and run it through the SCILLM graph endpoint.',\n  'acceptance': [\n    'the draft contains define, check, and final report nodes',\n    'the validation node reads the goal artifact',\n    'the final report node emits a passed result'\n  ]\n}\nartifact.write_text(json.dumps(payload, indent=2), encoding='utf-8')\nprint(json.dumps({'ok': True, 'artifact': str(artifact), 'acceptance_count': len(payload['acceptance'])}))\nPY",
        metadata: { draft_only: true, created_by: "ux-lab.scillm-dag-explorer", output_artifact: "/tmp/scillm-dag-starter-goal.json" },
      },
      {
        id: "check-goal",
        type: "local_command",
        protocol_role: "validator",
        depends_on: ["define-goal"],
        node_goal:
          "Read the project goal artifact and fail if the starter DAG does not contain enough acceptance criteria to be useful.",
        command:
          "python - <<'PY'\nimport json, pathlib, sys, time\ntime.sleep(8)\nartifact = pathlib.Path('/tmp/scillm-dag-starter-goal.json')\npayload = json.loads(artifact.read_text(encoding='utf-8'))\ncriteria = payload.get('acceptance', [])\nif len(criteria) < 3:\n    raise SystemExit('expected at least three acceptance criteria')\nprint(json.dumps({'ok': True, 'validated_artifact': str(artifact), 'acceptance': criteria}))\nPY",
        metadata: { draft_only: true, created_by: "ux-lab.scillm-dag-explorer", validates: "define-goal" },
      },
      {
        id: "final-report",
        type: "local_command",
        protocol_role: "reporter",
        depends_on: ["check-goal"],
        node_goal:
          "Emit a short final report proving that the new project DAG executed end to end.",
        command:
          "python - <<'PY'\nimport json\nprint(json.dumps({'ok': True, 'final_result': 'passed', 'summary': 'Starter project DAG created, validated, and reported successfully.'}))\nPY",
        metadata: { draft_only: true, created_by: "ux-lab.scillm-dag-explorer", final_report: true },
      },
    ],
  };
}

function cloneGraphForExplorer(graph: ExecGraph, graphId: string): ExecGraph {
  return {
    ...graph,
    graph_id: graphId,
    nodes: graph.nodes.map((node) => ({
      ...node,
      depends_on: node.depends_on ? [...node.depends_on] : undefined,
      review_scopes: node.review_scopes ? node.review_scopes.map((scope) => ({ ...scope })) : undefined,
      messages: node.messages ? node.messages.map((message) => ({ ...message })) : undefined,
      output_schema: node.output_schema ? { ...node.output_schema } : undefined,
      retry_policy: node.retry_policy ? { ...node.retry_policy } : undefined,
      gate_policy: node.gate_policy ? { ...node.gate_policy } : undefined,
      metadata: { ...(node.metadata ?? {}), draft_only: true, duplicated_by: "ux-lab.scillm-dag-explorer" },
    })),
  };
}

export function ScillmDagPlanner() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [reviewCatalog, setReviewCatalog] = useState<ReviewCatalog | undefined>();
  const [catalogState, setCatalogState] = useState("catalog pending");
  const [amendments, setAmendments] = useState<ExecGraphAmendment[]>([]);
  const [amendmentsState, setAmendmentsState] = useState<AmendmentsLoadState>({ status: "idle" });
  const [surface, setSurface] = useState<PlannerSurface>("design");
  const [sourcePayload, setSourcePayload] = useState<SourcePayload>("graph");
  const [hashCheck, setHashCheck] = useState<"idle" | "checking" | "match" | "changed" | "error">("idle");
  const [copiedToken, setCopiedToken] = useState<string>("");
  const [phaseIdOverride, setPhaseIdOverride] = useState(() => initialPhaseIdFromLocation());
  const [dagSearch, setDagSearch] = useState("");
  const [activeDagId, setActiveDagId] = useState("");
  const [localDags, setLocalDags] = useState<DagWorkspaceRecord[]>([]);
  const [closedDagIds, setClosedDagIds] = useState<Set<string>>(() => new Set());
  const [localRunResults, setLocalRunResults] = useState<Record<string, { status: ExecStatus; events: ExecEvent[] }>>({});
  const [dagRunState, setDagRunState] = useState<{ status: "idle" | "running" | "ok" | "error"; message?: string }>({ status: "idle" });

  useRegisterAction("scillm:workspace:dag-refresh", {
    app: "ux-lab",
    action: "SCILLM_DAG_REFRESH",
    label: "Refresh DAG Viewer-Planner",
    description: "Reload the scillm DAG evidence snapshot and review catalog",
  });
  useRegisterAction("scillm:dag-planner:lens:source", {
    app: "ux-lab",
    action: "SCILLM_DAG_LENS_SOURCE",
    label: "Show DAG source lens",
    description: "Open the authoritative DAG source payload lens",
  });
  useRegisterAction("scillm:dag-planner:lens:design", {
    app: "ux-lab",
    action: "SCILLM_DAG_LENS_DESIGN",
    label: "Show DAG design lens",
    description: "Open the DAG viewer-editor design and amendment lens",
  });
  useRegisterAction("scillm:dag-planner:lens:trace", {
    app: "ux-lab",
    action: "SCILLM_DAG_LENS_TRACE",
    label: "Show DAG trace lens",
    description: "Open the DAG execution trace lens",
  });
  useRegisterAction("scillm:dag-planner:lens:checkpoints", {
    app: "ux-lab",
    action: "SCILLM_DAG_LENS_CHECKPOINTS",
    label: "Show DAG checkpoints lens",
    description: "Open the human gate and checkpoint lens",
  });
  useRegisterAction("scillm:dag-planner:lens:debug", {
    app: "ux-lab",
    action: "SCILLM_DAG_LENS_DEBUG",
    label: "Show DAG debug lens",
    description: "Open the missing-evidence and artifact debug lens",
  });
  useRegisterAction("scillm:dag-planner:run-active-dag", {
    app: "ux-lab",
    action: "SCILLM_DAG_RUN_ACTIVE_DAG",
    label: "Run active DAG",
    description: "Submit the selected DAG graph to scillm exec graph and render the returned run result.",
  });

  const saveDagDraft = useCallback(async (record: DagWorkspaceRecord) => {
    const response = await fetch("/api/scillm/dag-viewer/drafts", {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify({
        draftId: record.id.replace(/^draft:/, ""),
        title: record.title,
        subtitle: record.subtitle,
        status: record.status,
        graph: record.graph,
        lastRun: record.lastRun,
        origin: "ux-lab #scillm/dag-planner",
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`draft save failed (${response.status}): ${text.slice(0, 240)}`);
    }
    return response.json();
  }, []);

  const loadDagDrafts = useCallback(async () => {
    try {
      const response = await fetch("/api/scillm/dag-viewer/drafts", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      const drafts = Array.isArray(payload.drafts) ? payload.drafts : [];
      setLocalDags(drafts.map((draft: any) => ({
        id: `draft:${String(draft.draftId ?? draft.graph?.graph_id ?? Date.now())}`,
        title: String(draft.title ?? draft.graph?.graph_id ?? "Draft DAG"),
        subtitle: String(draft.subtitle ?? "saved draft"),
        status: String(draft.status ?? "draft"),
        kind: "draft",
        graph: draft.graph,
        baseGraphHash: String(draft.baseGraphHash ?? (draft.graph ? graphEdgeCount(draft.graph) : "saved-draft")),
        lastRun: draft.lastRun && typeof draft.lastRun === "object" ? {
          status: draft.lastRun.status ?? { state: String(draft.status ?? "draft"), node_results: {} },
          events: Array.isArray(draft.lastRun.events) ? draft.lastRun.events : [],
          runAt: String(draft.lastRun.runAt ?? draft.updatedAt ?? ""),
        } : undefined,
        artifactPath: String(draft.artifactPath ?? ""),
      })).filter((draft: DagWorkspaceRecord) => draft.graph?.nodes?.length));
    } catch {
      setLocalDags([]);
    }
  }, []);

  const loadAmendments = useCallback(async (graphId: string) => {
    setAmendmentsState({ status: "loading", message: "Loading scillm amendment records." });
    try {
      const response = await fetch(`/api/scillm/v1/scillm/exec/graph/${encodeURIComponent(graphId)}/amendments?limit=50`, { cache: "no-store" });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`amendments unavailable (${response.status}): ${text.slice(0, 240)}`);
      }
      const payload = await response.json();
      const records = Array.isArray(payload.amendments) ? payload.amendments as ExecGraphAmendment[] : [];
      setAmendments(records);
      setAmendmentsState({ status: "loaded", message: `${records.length} scillm amendment record${records.length === 1 ? "" : "s"} loaded.` });
      return records;
    } catch (error) {
      setAmendments([]);
      setAmendmentsState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }, []);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const snapshotUrl = phaseIdOverride.trim()
        ? `/api/scillm/dag-viewer/snapshot?phase_id=${encodeURIComponent(phaseIdOverride.trim())}`
        : "/api/scillm/dag-viewer/snapshot";
      const [snapshotResp, modelsResp, catalogResp] = await Promise.all([
        fetch(snapshotUrl),
        fetch("/api/scillm/v1/scillm/models"),
        fetch("/api/scillm/v1/scillm/exec/review-catalog?skill=review-code"),
      ]);
      if (!snapshotResp.ok) {
        const text = await snapshotResp.text();
        throw new Error(`DAG snapshot unavailable (${snapshotResp.status}): ${text.slice(0, 240)}`);
      }
      const snapshot = (await snapshotResp.json()) as DagSnapshot;
      if (!snapshot.ok || !snapshot.graph?.nodes?.length) {
        throw new Error("DAG snapshot did not include a usable graph.");
      }

      if (modelsResp.ok) {
        const modelPayload = await modelsResp.json();
        const reviewModels = Array.isArray(modelPayload.review_fanout_models) ? modelPayload.review_fanout_models : [];
        const selectable = Array.isArray(modelPayload.selectable_models) ? modelPayload.selectable_models : [];
        setAvailableModels(reviewModels.length ? reviewModels : selectable);
      } else {
        setAvailableModels([]);
      }

      if (catalogResp.ok) {
        const catalog = (await catalogResp.json()) as ReviewCatalog;
        setReviewCatalog(catalog);
        setCatalogState(`${catalog.agents?.length ?? 0} agents · ${catalog.contracts?.length ?? 0} contracts`);
      } else {
        setReviewCatalog(undefined);
        setCatalogState(`catalog unavailable (${catalogResp.status})`);
      }

      setState({ status: "ready", snapshot });
      void loadAmendments(snapshot.graph.graph_id);
      void loadDagDrafts();
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      setCatalogState("catalog unavailable");
      setAmendments([]);
      setAmendmentsState({ status: "idle" });
    }
  }, [loadAmendments, loadDagDrafts, phaseIdOverride]);

  useEffect(() => {
    void load();
  }, [load]);

  const phaseBadge = useMemo(() => {
    if (state.status !== "ready") return "loading";
    const phaseStatus = state.snapshot.phase_status?.status ?? "unknown";
    const reviewStatus = state.snapshot.phase_status?.review_status ?? "unknown";
    return `${phaseStatus} · review ${reviewStatus}`;
  }, [state]);

  const sourceDagRecord = useMemo<DagWorkspaceRecord | null>(() => {
    if (state.status !== "ready") return null;
    const snapshot = state.snapshot;
    return {
      id: `source:${snapshot.graph.graph_id}`,
      title: dagTitle(snapshot.graph),
      subtitle: snapshot.phase_id,
      status: snapshot.phase_status?.status ?? snapshot.status.state ?? "source",
      kind: "source",
      graph: snapshot.graph,
      baseGraphHash: snapshot.base_graph_hash,
      source: snapshot.source,
    };
  }, [state]);

  const dagRecords = useMemo(() => {
    const records = sourceDagRecord ? [sourceDagRecord, ...localDags] : localDags;
    return records.filter((record) => !closedDagIds.has(record.id));
  }, [closedDagIds, localDags, sourceDagRecord]);

  useEffect(() => {
    if (!sourceDagRecord) return;
    if (!activeDagId || !dagRecords.some((record) => record.id === activeDagId)) {
      setActiveDagId(dagRecords[0]?.id ?? sourceDagRecord.id);
    }
  }, [activeDagId, dagRecords, sourceDagRecord]);

  const activeDagRecord = dagRecords.find((record) => record.id === activeDagId) ?? dagRecords[0] ?? sourceDagRecord;
  const activeGraph = activeDagRecord?.graph ?? (state.status === "ready" ? state.snapshot.graph : undefined);
  const activeBaseGraphHash = activeDagRecord?.baseGraphHash ?? (state.status === "ready" ? state.snapshot.base_graph_hash : "");
  const activeGraphIsSource = activeDagRecord?.kind !== "draft";
  const localRunResult = activeDagRecord?.id ? localRunResults[activeDagRecord.id] : undefined;
  const persistedRunResult = activeDagRecord?.lastRun;
  const activeStatus = activeGraphIsSource && state.status === "ready" ? state.snapshot.status : localRunResult?.status ?? {
    state: persistedRunResult?.status?.state ?? "draft",
    run_id: persistedRunResult?.status?.run_id,
    node_results: persistedRunResult?.status?.node_results ?? {},
  } satisfies ExecStatus;
  const activeEvents = activeGraphIsSource && state.status === "ready" ? state.snapshot.events : localRunResult?.events ?? persistedRunResult?.events ?? [];
  const dagExplorerItems = useMemo<DagExplorerItem[]>(() => dagRecords.map((record) => ({
    id: record.id,
    title: record.title,
    subtitle: record.subtitle,
    status: record.status,
    kind: record.kind,
    nodeCount: record.graph.nodes.length,
    edgeCount: graphEdgeCount(record.graph),
    active: record.id === activeDagRecord?.id,
    deletable: record.kind === "draft",
  })), [activeDagRecord?.id, dagRecords]);

  const sourceView = useMemo(() => {
    if (state.status !== "ready") return null;
    const snapshot = state.snapshot;
    const graph = activeGraph ?? snapshot.graph;
    const payloads: Record<SourcePayload, unknown> = {
      graph,
      status: activeGraphIsSource ? snapshot.status : activeStatus,
      events: activeGraphIsSource ? snapshot.events : activeEvents,
      phase_status: snapshot.phase_status,
      snapshot: {
        ok: snapshot.ok,
        phase_id: snapshot.phase_id,
        source: activeDagRecord?.source ?? snapshot.source,
        base_graph_hash: activeBaseGraphHash,
        hash_algorithm: snapshot.hash_algorithm,
        graph,
        status: activeGraphIsSource ? snapshot.status : activeStatus,
        events: activeGraphIsSource ? snapshot.events : activeEvents,
        phase_status: snapshot.phase_status,
        snapshot_kind: snapshot.snapshot_kind,
        active_phase_id: snapshot.active_phase_id,
        phase_matches_active: snapshot.phase_matches_active,
        missing_runtime_artifacts: snapshot.missing_runtime_artifacts,
      },
    };
    return {
      payload: payloads[sourcePayload],
      sourcePath: sourcePayload === "snapshot"
        ? activeGraphIsSource ? "/api/scillm/dag-viewer/snapshot" : activeDagRecord?.artifactPath ?? "local draft"
        : activeGraphIsSource ? snapshot.source[sourcePayload] ?? "not reported" : activeDagRecord?.artifactPath ?? "local draft",
    };
  }, [activeBaseGraphHash, activeDagRecord?.artifactPath, activeDagRecord?.source, activeEvents, activeGraph, activeGraphIsSource, activeStatus, sourcePayload, state]);

  const plannerSummary = useMemo(() => {
    if (state.status !== "ready") return null;
    return summarizeDagSnapshot({ ...state.snapshot, graph: activeGraph ?? state.snapshot.graph, status: activeStatus, events: activeEvents });
  }, [activeEvents, activeGraph, activeStatus, state]);

  async function saveReviewCatalogEntry(kind: "agents" | "contracts", entry: ReviewCatalogEntry) {
    const response = await fetch(`/api/scillm/v1/scillm/exec/review-catalog/${kind}?skill=review-code`, {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify({ ...entry, overwrite: true }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`review catalog save failed (${response.status}): ${text.slice(0, 240)}`);
    }
    await load();
    return response.json();
  }

  async function amendPlan(draftGraph: ExecGraph, context: any) {
    const snapshot = state.status === "ready" ? state.snapshot : null;
    if (!snapshot) throw new Error("No DAG snapshot is loaded.");
    const response = await fetch("/api/scillm/v1/scillm/exec/graph/amendments", {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify({
        graph_id: snapshot.graph.graph_id,
        run_id: (snapshot.status as ExecStatus & { run_id?: string }).run_id ?? snapshot.graph.graph_id,
        base_graph: context.baseGraph ?? snapshot.graph,
        draft_graph: draftGraph,
        status: "proposed",
        actor: "ux-lab.scillm-dag-planner",
        operations: context.operations ?? [],
        diff: context.diff,
        validation: context.validation,
        warning_acceptance: context.warning_acceptance,
        provenance: {
          phase_id: snapshot.phase_id,
          source_artifacts: snapshot.source,
          base_graph_hash: snapshot.base_graph_hash,
          hash_algorithm: snapshot.hash_algorithm,
          origin: "ux-lab #scillm/dag-planner",
          operations: context.operations ?? [],
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`amendment save failed (${response.status}): ${text.slice(0, 240)}`);
    }
    const payload = await response.json();
    await loadAmendments(snapshot.graph.graph_id);
    return payload;
  }

  async function setAmendmentStatus(amendmentKey: string, status: Exclude<ExecGraphAmendmentStatus, "proposed">, reason?: string) {
    const snapshot = state.status === "ready" ? state.snapshot : null;
    if (!snapshot) throw new Error("No DAG snapshot is loaded.");
    const response = await fetch(`/api/scillm/v1/scillm/exec/graph/amendments/${encodeURIComponent(amendmentKey)}/status`, {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify({
        status,
        actor: "ux-lab.scillm-dag-planner",
        reason: reason ?? `Marked ${status} from DAG planner.`,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`amendment status failed (${response.status}): ${text.slice(0, 240)}`);
    }
    const payload = await response.json();
    await loadAmendments(snapshot.graph.graph_id);
    return payload;
  }

  async function applyAmendment(amendment: ExecGraphAmendment, reason?: string) {
    const snapshot = state.status === "ready" ? state.snapshot : null;
    if (!snapshot) throw new Error("No DAG snapshot is loaded.");
    const response = await fetch(`/api/scillm/v1/scillm/exec/graph/amendments/${encodeURIComponent(amendment._key)}/apply`, {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify({
        actor: "ux-lab.scillm-dag-planner",
        reason: reason ?? "Applied approved amendment from DAG planner.",
        expected_base_graph_sha256: amendment.base_graph_sha256 ?? amendment.base_graph_hash ?? amendment.baseGraphHash,
        provenance: {
          phase_id: snapshot.phase_id,
          graph_id: amendment.graph_id,
          run_id: (snapshot.status as ExecStatus & { run_id?: string }).run_id ?? snapshot.graph.graph_id,
          source_artifacts: snapshot.source,
          base_graph_hash: snapshot.base_graph_hash,
          hash_algorithm: snapshot.hash_algorithm,
          origin: "ux-lab #scillm/dag-planner",
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`amendment apply failed (${response.status}): ${text.slice(0, 240)}`);
    }
    const payload = await response.json();
    await loadAmendments(snapshot.graph.graph_id);
    return payload;
  }

  async function runtimeAction(action: RuntimeActionRequest) {
    const snapshot = state.status === "ready" ? state.snapshot : null;
    const runId = snapshot?.status.run_id;
    if (!snapshot || !runId) {
      throw new Error("Runtime action requires a live scillm run_id in the DAG snapshot.");
    }
    const response = await fetch(`/api/scillm/v1/scillm/exec/${encodeURIComponent(runId)}/actions`, {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify({
        ...action,
        actor: action.actor ?? "ux-lab.scillm-dag-planner",
        provenance: {
          phase_id: snapshot.phase_id,
          graph_id: snapshot.graph.graph_id,
          run_id: runId,
          source_artifacts: snapshot.source,
          base_graph_hash: snapshot.base_graph_hash,
          hash_algorithm: snapshot.hash_algorithm,
          origin: "ux-lab #scillm/dag-planner",
          ...(action.provenance ?? {}),
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`runtime action failed (${response.status}): ${text.slice(0, 240)}`);
    }
    const payload = await response.json();
    await load();
    return payload;
  }

  async function draftRuntimeAction(action: RuntimeActionRequest) {
    const runId = activeStatus.run_id;
    if (!runId) {
      throw new Error("Runtime action requires a running local draft run_id.");
    }
    const response = await fetch(`/api/scillm/v1/scillm/exec/${encodeURIComponent(runId)}/actions`, {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify({
        ...action,
        actor: action.actor ?? "ux-lab.scillm-dag-planner",
        provenance: {
          graph_id: activeGraph?.graph_id,
          run_id: runId,
          origin: "ux-lab #scillm/dag-planner local draft",
          ...(action.provenance ?? {}),
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`runtime action failed (${response.status}): ${text.slice(0, 240)}`);
    }
    return response.json();
  }

  async function verifyBackendHash() {
    if (state.status !== "ready") return;
    setHashCheck("checking");
    try {
      const snapshotUrl = phaseIdOverride.trim()
        ? `/api/scillm/dag-viewer/snapshot?phase_id=${encodeURIComponent(phaseIdOverride.trim())}`
        : "/api/scillm/dag-viewer/snapshot";
      const response = await fetch(snapshotUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`snapshot ${response.status}`);
      const latest = (await response.json()) as DagSnapshot;
      setHashCheck(latest.base_graph_hash === state.snapshot.base_graph_hash ? "match" : "changed");
    } catch {
      setHashCheck("error");
    }
  }

  function copyText(value: string, token: string) {
    void navigator.clipboard?.writeText(value);
    setCopiedToken(token);
    window.setTimeout(() => setCopiedToken(""), 1400);
  }

  async function addDag() {
    const seed = Date.now();
    const graph = createStarterDag(seed);
    const record: DagWorkspaceRecord = {
      id: `draft:${graph.graph_id}`,
      title: "New project DAG",
      subtitle: "local draft · not saved",
      status: "draft",
      kind: "draft",
      graph,
      baseGraphHash: `local-draft-${seed}`,
    };
    try {
      const payload = await saveDagDraft(record);
      const saved = payload.draft;
      const nextRecord = saved?.graph ? { ...record, baseGraphHash: saved.baseGraphHash ?? record.baseGraphHash, artifactPath: saved.artifactPath } : record;
      setClosedDagIds((ids) => {
        const next = new Set(ids);
        next.delete(record.id);
        return next;
      });
      setLocalDags((records) => [nextRecord, ...records.filter((candidate) => candidate.id !== record.id)]);
      setActiveDagId(record.id);
      setSurface("design");
    } catch (error) {
      setDagRunState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function duplicateDag(id: string) {
    const record = dagRecords.find((candidate) => candidate.id === id);
    if (!record) return;
    const seed = Date.now();
    const graphId = `${record.graph.graph_id}-copy-${seed}`;
    const graph = cloneGraphForExplorer(record.graph, graphId);
    const duplicate: DagWorkspaceRecord = {
      id: `draft:${graphId}`,
      title: `${record.title} copy`,
      subtitle: "local duplicate · not saved",
      status: "draft",
      kind: "draft",
      graph,
      baseGraphHash: `local-duplicate-${seed}`,
    };
    try {
      const payload = await saveDagDraft(duplicate);
      const saved = payload.draft;
      const nextRecord = saved?.graph ? { ...duplicate, baseGraphHash: saved.baseGraphHash ?? duplicate.baseGraphHash, artifactPath: saved.artifactPath } : duplicate;
      setLocalDags((records) => [nextRecord, ...records.filter((candidate) => candidate.id !== duplicate.id)]);
      setActiveDagId(duplicate.id);
      setSurface("design");
    } catch (error) {
      setDagRunState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function persistActiveDraftGraph(nextGraph: ExecGraph) {
    const record = activeDagRecord;
    if (!record) throw new Error("No active DAG is selected.");

    if (record.kind === "draft") {
      const nextRecord: DagWorkspaceRecord = {
        ...record,
        title: dagTitle(nextGraph),
        subtitle: "local draft · saved",
        status: "draft",
        graph: nextGraph,
        lastRun: undefined,
      };
      const payload = await saveDagDraft(nextRecord);
      const saved = payload.draft;
      const persistedRecord = saved?.graph ? {
        ...nextRecord,
        baseGraphHash: saved.baseGraphHash ?? nextRecord.baseGraphHash,
        artifactPath: saved.artifactPath ?? nextRecord.artifactPath,
      } : nextRecord;
      setLocalDags((records) => records.map((candidate) => candidate.id === record.id ? persistedRecord : candidate));
      setLocalRunResults((records) => {
        const next = { ...records };
        delete next[record.id];
        return next;
      });
      return;
    }

    const seed = Date.now();
    const graphId = `${nextGraph.graph_id}-draft-${seed}`;
    const draftGraph = cloneGraphForExplorer(nextGraph, graphId);
    const draftRecord: DagWorkspaceRecord = {
      id: `draft:${graphId}`,
      title: `${dagTitle(nextGraph)} draft`,
      subtitle: "local draft · saved from source edit",
      status: "draft",
      kind: "draft",
      graph: draftGraph,
      baseGraphHash: `source-edit-${seed}`,
    };
    const payload = await saveDagDraft(draftRecord);
    const saved = payload.draft;
    const persistedRecord = saved?.graph ? {
      ...draftRecord,
      baseGraphHash: saved.baseGraphHash ?? draftRecord.baseGraphHash,
      artifactPath: saved.artifactPath ?? draftRecord.artifactPath,
    } : draftRecord;
    setLocalDags((records) => [persistedRecord, ...records.filter((candidate) => candidate.id !== persistedRecord.id)]);
    setClosedDagIds((ids) => {
      const next = new Set(ids);
      next.delete(persistedRecord.id);
      return next;
    });
    setActiveDagId(persistedRecord.id);
    setSurface("design");
  }

  function closeDag(id: string) {
    setClosedDagIds((ids) => new Set(ids).add(id));
    if (id === activeDagId) {
      const nextRecord = dagRecords.find((record) => record.id !== id);
      setActiveDagId(nextRecord?.id ?? "");
    }
  }

  async function deleteDag(id: string) {
    const record = localDags.find((candidate) => candidate.id === id);
    if (record) {
      const draftId = id.replace(/^draft:/, "");
      const response = await fetch(`/api/scillm/dag-viewer/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
      if (!response.ok) {
        const text = await response.text();
        setDagRunState({ status: "error", message: `draft delete failed (${response.status}): ${text.slice(0, 160)}` });
        return;
      }
    }
    setLocalDags((records) => records.filter((record) => record.id !== id));
    setClosedDagIds((ids) => {
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
    if (id === activeDagId) {
      const nextRecord = dagRecords.find((record) => record.id !== id);
      setActiveDagId(nextRecord?.id ?? "");
    }
  }

  async function runActiveDag(graphOverride?: ExecGraph) {
    const record = activeDagRecord;
    const graph = graphOverride ?? activeGraph;
    if (!record || !graph) return;
    const runtimeGraph: ExecGraph = {
      ...graph,
      graph_id: `${graph.graph_id}-run-${Date.now()}`,
      cwd: graph.cwd ?? "/home/graham/workspace/experiments/scillm",
      max_concurrency: graph.max_concurrency ?? 1,
      nodes: graph.nodes.map((node) => ({
        ...node,
        type: node.type === "exec_command" ? "local_command" : node.type === "llm_call" ? "scillm_call" : node.type,
      })),
    };
    const runEvents: ExecEvent[] = [];
    const runningStatus: ExecStatus = {
      state: "running",
      run_id: runtimeGraph.graph_id,
      node_results: {},
      running_node_ids: runtimeGraph.nodes.filter((node) => !node.depends_on?.length).map((node) => node.id),
    };
    setDagRunState({ status: "running", message: `Running ${graph.graph_id}` });
    setLocalRunResults((records) => ({ ...records, [record.id]: { status: runningStatus, events: runEvents } }));
    setSurface("design");
    try {
      const response = await fetch("/api/scillm/v1/scillm/exec/graph", {
        method: "POST",
        headers: API_HEADERS,
        body: JSON.stringify({ ...runtimeGraph, stream: true }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`exec graph failed (${response.status}): ${text.slice(0, 240)}`);
      }
      if (!response.body) throw new Error("exec graph stream returned no response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: any = null;
      const nodeResults: Record<string, Record<string, unknown>> = {};
      let runningNodeIds = new Set(runningStatus.running_node_ids ?? []);
      let pausedNodeIds = new Set<string>();
      const commitStatus = (stateValue: string) => {
        const status: ExecStatus = {
          state: stateValue,
          run_id: runtimeGraph.graph_id,
          node_results: { ...nodeResults },
          running_node_ids: Array.from(runningNodeIds),
          paused_node_ids: Array.from(pausedNodeIds),
          paused: pausedNodeIds.size > 0,
          paused_graph: pausedNodeIds.size > 0,
        };
        setLocalRunResults((records) => ({ ...records, [record.id]: { status, events: [...runEvents] } }));
      };
      const handleStreamEvent = (eventName: string, payload: any) => {
        if (eventName === "heartbeat") return;
        if (eventName === "done") {
          finalResult = payload;
          return;
        }
        const event = { ...(payload as ExecEvent), type: String((payload as ExecEvent).type ?? eventName) } as ExecEvent;
        runEvents.push(event);
        const nodeId = typeof event.node_id === "string" ? event.node_id : "";
        if (event.type === "node_scheduled" || event.type === "node_started") {
          if (nodeId) runningNodeIds.add(nodeId);
          commitStatus("running");
          return;
        }
        if (event.type === "node_finished") {
          if (nodeId) {
            runningNodeIds.delete(nodeId);
            nodeResults[nodeId] = { ok: true, status: "passed", node_id: nodeId };
          }
          commitStatus("running");
          return;
        }
        if (event.type === "node_failed" || event.type === "node_skipped") {
          if (nodeId) {
            runningNodeIds.delete(nodeId);
            nodeResults[nodeId] = { ok: false, status: event.type === "node_skipped" ? "skipped" : "failed", node_id: nodeId };
          }
          commitStatus("running");
          return;
        }
        if (event.type === "node_disabled") {
          if (nodeId) {
            runningNodeIds.delete(nodeId);
            nodeResults[nodeId] = { ok: true, status: "disabled", node_id: nodeId };
          }
          commitStatus("running");
          return;
        }
        if (event.type === "graph_paused") {
          const ids = Array.isArray((event as any).paused_node_ids) ? (event as any).paused_node_ids : [];
          pausedNodeIds = new Set(ids.map(String));
          runningNodeIds = new Set();
          commitStatus("paused");
          return;
        }
        if (event.type === "graph_finished") {
          commitStatus(String((event as any).status ?? "completed"));
        }
      };
      const consumeBlock = (block: string) => {
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        const data = dataLines.join("\n");
        if (!data || data === "[DONE]") return;
        try {
          handleStreamEvent(eventName, JSON.parse(data));
        } catch {
          runEvents.push({ ts: new Date().toISOString(), type: "dag_viewer.stream_parse_error", text: data } as ExecEvent);
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          const blocks = buffer.split(/\n\n/);
          buffer = blocks.pop() ?? "";
          blocks.forEach(consumeBlock);
        }
        if (done) break;
      }
      if (buffer.trim()) consumeBlock(buffer);
      const result = finalResult;
      if (!result) throw new Error("exec graph stream ended without a terminal result");
      const terminalNodeResults = result.node_results && typeof result.node_results === "object" ? result.node_results : {};
      const status: ExecStatus = {
        state: String(result.status ?? "completed"),
        run_id: String(result.run_id ?? runtimeGraph.graph_id),
        node_results: terminalNodeResults,
      };
      const events: ExecEvent[] = [{
        ts: new Date().toISOString(),
        type: "dag_viewer.run_completed",
        text: `DAG run returned ${status.state}.`,
      } as ExecEvent, ...runEvents];
      const runAt = new Date().toISOString();
      const nextRecord: DagWorkspaceRecord = {
        ...record,
        status: status.state ?? "completed",
        subtitle: `local draft · last run ${status.state ?? "completed"}`,
        lastRun: { status, events, runAt },
      };
      setLocalRunResults((records) => ({ ...records, [record.id]: { status, events } }));
      if (record.kind === "draft") {
        setLocalDags((records) => records.map((candidate) => candidate.id === record.id ? nextRecord : candidate));
        void saveDagDraft(nextRecord).catch((error) => {
          setDagRunState({ status: "error", message: `run completed but draft run result was not persisted: ${error instanceof Error ? error.message : String(error)}` });
        });
      }
      setDagRunState({ status: "ok", message: `Run ${status.state}: ${status.run_id}` });
    } catch (error) {
      setDagRunState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="scillm-dashboard scillm-dag-planner" data-qid="scillm:dag-planner">
      <div className="elevated-surface scillm-dashboard__header scillm-dag-planner__header">
        <div className="scillm-flex-row scillm-gap-8 scillm-dag-planner__title">
          <GitBranch size={18} color={EMBRY.blue} />
          <span className="scillm-heading-lg">DAG Viewer-Planner</span>
          <span className="scillm-heading-md">Phase evidence graph</span>
        </div>
        <div className="scillm-flex-row scillm-gap-8 scillm-flex-wrap scillm-dag-planner__status">
          <span className="scillm-chip">Phase: {state.status === "ready" ? state.snapshot.phase_id : "pending"}</span>
          <span className="scillm-chip">State: {phaseBadge}</span>
          <details className="scillm-dag-planner__details">
            <summary>Details</summary>
            <label className="scillm-chip" title="Load a specific plan-iterate phase. Leave blank to use the active phase pointer.">
              Phase override
              <input
                aria-label="DAG phase override"
                value={phaseIdOverride}
                onChange={(event) => setPhaseIdOverride(event.target.value)}
                placeholder="active phase"
                style={{ width: 285, marginLeft: 8, background: "transparent", border: 0, color: "inherit", font: "inherit", outline: "none" }}
              />
            </label>
            {state.status === "ready" ? <span className="scillm-chip">Snapshot: {state.snapshot.snapshot_kind ?? "runtime"}</span> : null}
            <span className="scillm-chip">Review catalog: {catalogState}</span>
          </details>
          <button
            type="button"
            data-qid="scillm:workspace:dag-refresh"
            data-qs-action="SCILLM_DAG_REFRESH"
            title="Reload DAG evidence and catalog"
            onClick={() => void load()}
            className="press-scale scillm-focus scillm-button"
          >
            <RefreshCcw size={13} />
            Refresh
          </button>
        </div>
      </div>

      {state.status === "loading" ? (
        <div className="scillm-card scillm-flex-center" style={{ minHeight: 420 }}>
          <span className="scillm-spinner scillm-spinner--blue" />
          <span className="scillm-meta">Loading real scillm DAG evidence artifacts...</span>
        </div>
      ) : state.status === "error" ? (
        <div className="scillm-card scillm-flex-col scillm-gap-12" style={{ margin: 16 }}>
          <div className="scillm-flex-row scillm-gap-8">
            <AlertTriangle size={18} color={EMBRY.red} />
            <span className="scillm-heading">DAG evidence unavailable</span>
          </div>
          <div className="scillm-meta">
            This tab fails closed when the plan-iterate graph, status, or event artifacts are missing.
          </div>
          <pre className="scillm-pre scillm-pre--empty">{state.message}</pre>
        </div>
      ) : (
        <div className="scillm-dashboard__main" style={{ padding: 0 }}>
          <div className="scillm-dag-workspace">
            <DagExplorerPane
              items={dagExplorerItems}
              search={dagSearch}
              onSearchChange={setDagSearch}
              onSelect={(id) => {
                setActiveDagId(id);
                setSurface("design");
              }}
              onAdd={addDag}
              onDuplicate={duplicateDag}
              onClose={closeDag}
              onDelete={deleteDag}
            />
            <div className="scillm-dag-workspace__main">
              {state.snapshot.phase_matches_active === false ? (
                <div className="scillm-card" style={{ margin: 16, borderColor: `${EMBRY.red}66` }}>
                  <div className="scillm-flex-row scillm-gap-8">
                    <AlertTriangle size={16} color={EMBRY.red} />
                    <span className="scillm-text-red scillm-fw-700">Loaded phase is not the active plan-iterate phase</span>
                  </div>
                  <div className="scillm-meta" style={{ marginTop: 6 }}>
                    Loaded {state.snapshot.phase_id}; active pointer is {state.snapshot.active_phase_id ?? "not reported"}. Use the phase override only for historical inspection.
                  </div>
                </div>
              ) : null}
              {state.snapshot.snapshot_kind === "plan_iterate_phase_plan" ? (
                <div className="scillm-card" style={{ margin: 16, borderColor: `${EMBRY.amber}66` }}>
                  <div className="scillm-flex-row scillm-gap-8">
                    <AlertTriangle size={16} color={EMBRY.amber} />
                    <span className="scillm-text-amber scillm-fw-700">Runtime execution artifacts are not available for this phase</span>
                  </div>
                  <div className="scillm-meta" style={{ marginTop: 6 }}>
                    Showing the authoritative phase plan graph and runtime-readiness artifact. Start/resume state remains inadmissible until runtime graph, status, and event artifacts exist.
                  </div>
                </div>
              ) : null}
              {state.snapshot.phase_status?.review_comparison?.closure_allowed === false ? (
                <div className="scillm-dag-inline-alert">
                  <AlertTriangle size={15} color={EMBRY.bgDeep} />
                  <span className="scillm-text-amber scillm-fw-700">Closure and deploy are blocked</span>
                  <span className="scillm-meta">
                    Review pending; node success is not closure evidence. {state.snapshot.phase_status.review_comparison.reason}
                  </span>
                </div>
              ) : null}
              <div className="scillm-dag-source-shell">
                <div className="scillm-dag-source-shell__bar">
                  <div className="scillm-segmented" role="tablist" aria-label="DAG viewer-editor lenses">
                    {([
                      ["design", "DAG", PencilRuler],
                      ["source", "JSON", FileJson],
                    ] as const).map(([id, label, Icon]) => (
                      <button
                        key={id}
                        type="button"
                        className={`scillm-segmented__button ${surface === id ? "scillm-segmented__button--active" : ""}`}
                        data-qid={`scillm:dag-planner:lens:${id}`}
                        data-qs-action={`SCILLM_DAG_LENS_${id.toUpperCase()}`}
                        title={`Show ${label} lens`}
                        onClick={() => setSurface(id)}
                        role="tab"
                        aria-selected={surface === id}
                      >
                        <Icon size={14} />
                        {label}
                      </button>
                    ))}
                    <details className="scillm-dag-lens-overflow">
                      <summary>More</summary>
                      {([
                        ["trace", "Trace", Activity],
                        ["checkpoints", "Checkpoints", CheckSquare],
                        ["debug", "Debug", Bug],
                      ] as const).map(([id, label, Icon]) => (
                        <button
                          key={id}
                          type="button"
                          className={`scillm-segmented__button ${surface === id ? "scillm-segmented__button--active" : ""}`}
                          data-qid={`scillm:dag-planner:lens:${id}`}
                          data-qs-action={`SCILLM_DAG_LENS_${id.toUpperCase()}`}
                          title={`Show ${label} lens`}
                          onClick={() => setSurface(id)}
                          role="tab"
                          aria-selected={surface === id}
                        >
                          <Icon size={14} />
                          {label}
                        </button>
                      ))}
                    </details>
                  </div>
                  <div className="scillm-dag-source-shell__contract">
                    <button
                      type="button"
                      className="scillm-dag-inline-action"
                      data-qid="scillm:dag-planner:run-active-dag"
                      data-qs-action="SCILLM_DAG_RUN_ACTIVE_DAG"
                      title="Run the selected DAG through scillm exec graph"
                      disabled={dagRunState.status === "running" || !activeGraph}
                      onClick={() => void runActiveDag()}
                    >
                      <Play size={13} />
                      {dagRunState.status === "running" ? "Running" : "Run DAG"}
                    </button>
                    <span>{activeGraphIsSource ? "Backend hash" : "Local draft"}</span>
                    <code>{activeGraphIsSource ? state.snapshot.base_graph_hash.slice(0, 16) : activeBaseGraphHash.slice(0, 20)}</code>
                    <span>{dagRunState.message ?? (activeGraphIsSource ? state.snapshot.hash_algorithm ?? "sha256 canonical executable graph" : "saved draft")}</span>
                  </div>
                </div>

                {plannerSummary && surface !== "design" ? (
                  <DagLensSummary summary={plannerSummary} activeLens={surface} />
                ) : null}

                {surface === "source" && sourceView ? (
                  <section className="scillm-dag-source" aria-label="DAG source JSON viewer">
                    <div className="scillm-dag-source__header">
                      <div>
                        <div className="scillm-dag-source__eyebrow">Authoritative source contract</div>
                        <h2>{activeGraphIsSource ? "Actual DAG JSON" : "Local draft DAG JSON"}</h2>
                        <p>
                          {activeGraphIsSource
                            ? "This is a draft executable graph source contract from the backend adapter. It is not an accepted baseline until phase review passes; layout edits and synthetic visual nodes stay outside it."
                            : "This local draft is for project-agent and human planning. It is not persisted to scillm until the amendment/apply contract accepts it."}
                        </p>
                      </div>
                      <div className="scillm-dag-source__meta">
                        <span>Graph ID</span>
                        <code>{activeGraph?.graph_id ?? state.snapshot.graph.graph_id}</code>
                        <span>Source</span>
                        <code title={sourceView.sourcePath}>{sourceView.sourcePath}</code>
                        <span>Hash check</span>
                        <button
                          type="button"
                          className="scillm-dag-inline-action"
                          disabled={!activeGraphIsSource}
                          onClick={() => void verifyBackendHash()}
                          title={activeGraphIsSource ? "Fetch the current snapshot and compare its backend-computed baseGraphHash to the displayed hash." : "Local draft DAGs do not have a backend hash yet."}
                        >
                          <ShieldCheck size={13} />
                          {activeGraphIsSource ? hashCheck === "checking" ? "Checking" : hashCheck === "match" ? "Hash matches" : hashCheck === "changed" ? "Hash changed" : hashCheck === "error" ? "Check failed" : "Verify hash" : "Local draft"}
                        </button>
                        <span>Copy</span>
                        <button type="button" className="scillm-dag-inline-action" onClick={() => copyText(sourceView.sourcePath, "source-path")}>
                          {copiedToken === "source-path" ? "Copied path" : "Copy path"}
                        </button>
                      </div>
                    </div>
                    <div className="scillm-dag-source__tabs" role="tablist" aria-label="DAG JSON payload">
                      {([
                        ["graph", "Graph"],
                        ["status", "Status"],
                        ["events", "Events"],
                        ["phase_status", "Phase status"],
                        ["snapshot", "Full snapshot"],
                      ] as const).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={`scillm-dag-source__tab ${sourcePayload === id ? "scillm-dag-source__tab--active" : ""}`}
                          onClick={() => setSourcePayload(id)}
                          role="tab"
                          aria-selected={sourcePayload === id}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <HighlightedJson value={sourceView.payload} />
                  </section>
                ) : surface === "design" && activeGraph ? (
                  <DagContractEditor
                    graph={activeGraph}
                    status={activeStatus}
                    events={activeEvents}
                    baseGraphHash={activeBaseGraphHash}
                    availableModels={availableModels}
                    onRunGraph={(graph) => void runActiveDag(graph)}
                    onDraftGraphChange={persistActiveDraftGraph}
                    runGraphDisabled={dagRunState.status === "running" || !activeGraph}
                    runGraphLabel={dagRunState.status === "running" ? "Running" : "Run draft via scillm"}
                  />
                ) : surface === "trace" && plannerSummary ? (
                  <TraceLens snapshot={{ ...state.snapshot, graph: activeGraph ?? state.snapshot.graph, status: activeStatus, events: activeEvents }} summary={plannerSummary} onOpenDesign={() => setSurface("design")} />
                ) : surface === "checkpoints" && plannerSummary ? (
                  <CheckpointLens snapshot={{ ...state.snapshot, graph: activeGraph ?? state.snapshot.graph, status: activeStatus, events: activeEvents }} summary={plannerSummary} onOpenDebug={() => setSurface("debug")} />
                ) : plannerSummary ? (
                  <DebugLens snapshot={{ ...state.snapshot, graph: activeGraph ?? state.snapshot.graph, status: activeStatus, events: activeEvents }} summary={plannerSummary} onCopy={copyText} copiedToken={copiedToken} />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type DagPlannerSummary = {
  nodeCount: number;
  edgeCount: number;
  eventCount: number;
  running: string[];
  queued: string[];
  passed: string[];
  failed: string[];
  incompleteEvidence: string[];
  incompleteEvidenceDetails: Array<{ id: string; reason: string }>;
  checkpointNodes: string[];
  latestEvents: ExecEvent[];
};

function summarizeDagSnapshot(snapshot: DagSnapshot): DagPlannerSummary {
  const nodeResults = (snapshot.status as ExecStatus & { node_results?: Record<string, { ok?: boolean; evidence_status?: string; output_hash?: string }> }).node_results ?? {};
  const states = (snapshot.status as ExecStatus & { node_states?: Record<string, string> }).node_states ?? {};
  const running = Object.entries(states).filter(([, value]) => value === "running").map(([id]) => id);
  const queued = Object.entries(states).filter(([, value]) => value === "queued" || value === "ready").map(([id]) => id);
  const passed = Object.entries(nodeResults).filter(([, result]) => result.ok === true).map(([id]) => id);
  const failed = Object.entries(nodeResults).filter(([, result]) => result.ok === false).map(([id]) => id);
  const incompleteEvidence = Object.entries(nodeResults)
    .filter(([, result]) => !result.output_hash || result.evidence_status === "incomplete")
    .map(([id]) => id);
  const incompleteEvidenceDetails = Object.entries(nodeResults)
    .filter(([, result]) => !result.output_hash || result.evidence_status === "incomplete")
    .map(([id, result]) => ({
      id,
      reason: !result.output_hash
        ? "Missing output hash"
        : result.evidence_status === "incomplete"
          ? "Evidence status incomplete"
          : "Evidence not fully reported",
    }));
  const checkpointNodes = snapshot.graph.nodes
    .filter((node) => /gate|human|interrupt|approval|checkpoint/i.test(`${node.id} ${node.type} ${node.node_goal}`))
    .map((node) => node.id);
  return {
    nodeCount: snapshot.graph.nodes.length,
    edgeCount: snapshot.graph.nodes.reduce((count, node) => count + (node.depends_on?.length ?? 0), 0),
    eventCount: snapshot.events.length,
    running,
    queued,
    passed,
    failed,
    incompleteEvidence,
    incompleteEvidenceDetails,
    checkpointNodes,
    latestEvents: snapshot.events.slice().reverse(),
  };
}

function DagLensSummary({ summary, activeLens }: { summary: DagPlannerSummary; activeLens: PlannerSurface }) {
  return (
    <section className="scillm-dag-lens-summary" aria-label="DAG lens summary">
      <div>
        <div className="scillm-dag-source__eyebrow">Viewer-editor contract</div>
        <h2>{lensTitle(activeLens)}</h2>
        <p>{lensDescription(activeLens)}</p>
      </div>
      <div className="scillm-dag-lens-summary__metrics">
        <Metric label="nodes" value={summary.nodeCount} title="Executable graph nodes from the backend DAG snapshot." />
        <Metric label="edges" value={summary.edgeCount} title="Dependency edges computed from executable node depends_on fields." />
        <Metric label="events" value={summary.eventCount} title="Runtime/review events loaded from the source events artifact." />
        <Metric label="checkpoints" value={summary.checkpointNodes.length} title="Human gate, interrupt, approval, or checkpoint nodes inferred from the graph snapshot." />
      </div>
    </section>
  );
}

function Metric({ label, value, title }: { label: string; value: number; title?: string }) {
  return (
    <div className="scillm-dag-metric" title={title}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function lensTitle(lens: PlannerSurface) {
  switch (lens) {
    case "source": return "Source contract";
    case "design": return "Design graph";
    case "trace": return "Live and review trace";
    case "checkpoints": return "Human checkpoints";
    case "debug": return "Debug evidence";
  }
}

function lensDescription(lens: PlannerSurface) {
  switch (lens) {
    case "source":
      return "The backend adapter payload: executable graph, status, events, phase state, and backend hash. Draft until review is accepted.";
    case "design":
      return "Graph structure and amendment-draft editing. Semantic changes save drafts; active execution is not mutated.";
    case "trace":
      return "Execution replay context: running, queued, passed, failed, and recent event chronology.";
    case "checkpoints":
      return "Human gates and interrupt-style workflow items. This borrows Agent Inbox semantics without inventing actions.";
    case "debug":
      return "Evidence, artifacts, missing output hashes, backend hash, and raw source paths for closure review.";
  }
}

function DesignMap({ graph, summary, onOpenTrace }: { graph: ExecGraph; summary: DagPlannerSummary | null; onOpenTrace: () => void }) {
  const positions: Record<string, { x: number; y: number; label: string; lane?: string }> = {
    "project-agent-synthesize-round-1": { x: 50, y: 44, label: "Goal" },
    "review-code-round-1": { x: 25, y: 142, label: "review-code", lane: "review-code" },
    "review-prompt-round-1": { x: 50, y: 142, label: "review-prompt", lane: "review-prompt" },
    "test-interactions-round-1": { x: 69, y: 142, label: "test-interactions", lane: "review-design" },
    "review-design-round-1": { x: 82, y: 142, label: "review-design", lane: "review-design" },
    "project-agent-aggregate-round-1": { x: 50, y: 228, label: "aggregate" },
    "plan-iterate-validate-round-1": { x: 50, y: 302, label: "validate" },
  };
  const mapNodes = graph.nodes.map((node, index) => ({
    node,
    position: positions[node.id] ?? { x: 16 + (index % 5) * 16, y: 310 + Math.floor(index / 5) * 82, label: node.id },
  }));
  const edges = mapNodes.flatMap(({ node, position }) => (node.depends_on ?? [])
    .map((dep) => ({ source: mapNodes.find((candidate) => candidate.node.id === dep)?.position, target: position, id: `${dep}->${node.id}` }))
    .filter((edge): edge is { source: { x: number; y: number; label: string; lane?: string }; target: { x: number; y: number; label: string; lane?: string }; id: string } => Boolean(edge.source)));
  return (
    <section className="scillm-dag-design-map" aria-label="DAG design overview">
      <div className="scillm-dag-design-map__header">
        <div>
          <div className="scillm-dag-source__eyebrow">Design map</div>
          <h2>Goal to review fan-out to current round</h2>
          <p>Render-only overview. The full editor below creates amendment drafts; this map makes the workflow shape visible before detailed inspection.</p>
        </div>
        <div className="scillm-dag-design-map__actions">
          <button type="button" onClick={onOpenTrace}>Open trace evidence</button>
          <span>{summary?.nodeCount ?? graph.nodes.length} nodes · {summary?.edgeCount ?? graph.nodes.reduce((count, node) => count + (node.depends_on?.length ?? 0), 0)} edges</span>
        </div>
      </div>
      <svg viewBox="0 0 1000 350" role="img" aria-label="DAG fan-out overview">
        <rect x="48" y="112" width="904" height="88" rx="16" className="design-map-round" />
        <text x="74" y="162" className="design-map-band-label">Round 1</text>
        <text x="900" y="162" className="design-map-band-label design-map-band-label-current">current</text>
        {edges.map((edge) => (
          <path key={edge.id} className="design-map-edge" d={`M ${edge.source.x * 10} ${edge.source.y + 34} C ${edge.source.x * 10} ${(edge.source.y + edge.target.y) / 2}, ${edge.target.x * 10} ${(edge.source.y + edge.target.y) / 2}, ${edge.target.x * 10} ${edge.target.y - 34}`} />
        ))}
        {mapNodes.map(({ node, position }) => (
          <g key={node.id} transform={`translate(${position.x * 10 - 76}, ${position.y - 27})`}>
            <rect width="152" height="54" rx="8" className={node.id.includes("validate") || node.id.includes("aggregate") ? "design-map-node design-map-node-summary" : "design-map-node"} />
            <text x="76" y="23" textAnchor="middle" className="design-map-node-title">{position.label}</text>
            <text x="76" y="39" textAnchor="middle" className="design-map-node-id">{node.id.replace(/-round-1$/, "")}</text>
          </g>
        ))}
      </svg>
    </section>
  );
}

function TraceLens({ snapshot, summary, onOpenDesign }: { snapshot: DagSnapshot; summary: DagPlannerSummary; onOpenDesign: () => void }) {
  return (
    <section className="scillm-dag-lens-panel" aria-label="DAG trace lens">
      <div className="scillm-dag-panel-grid">
        <StatusColumn title="Running" items={summary.running} snapshot={snapshot} empty="No nodes currently running." tone="blue" onInspect={onOpenDesign} />
        <StatusColumn title="Queued" items={summary.queued} snapshot={snapshot} empty="No queued nodes reported." tone="amber" onInspect={onOpenDesign} />
        <StatusColumn title="Reported pass" items={summary.passed} snapshot={snapshot} empty="No passed nodes reported." tone="green" onInspect={onOpenDesign} />
        <StatusColumn title="Failed" items={summary.failed} snapshot={snapshot} empty="No failed nodes reported." tone="red" onInspect={onOpenDesign} />
      </div>
      <div className="scillm-dag-timeline">
        <div className="scillm-flex-between">
          <h3>Event stream</h3>
          <span className="scillm-meta" title={snapshot.source.events}>{summary.eventCount} events from {snapshot.source.events}</span>
        </div>
        <div className="scillm-dag-timeline__rail">
          {summary.latestEvents.map((event, index) => (
            <button key={`${event.type}-${event.node_id ?? index}-${index}`} type="button" className="scillm-dag-timeline__event" onClick={onOpenDesign} title="Open Design lens to inspect this node in context.">
              <span className="scillm-dag-timeline__dot" />
              <code>{event.type ?? "event"}</code>
              <span>{event.node_id ?? "graph"}</span>
              <small>{String((event as ExecEvent & { ts?: string; timestamp?: string }).ts ?? (event as ExecEvent & { timestamp?: string }).timestamp ?? "")}</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function CheckpointLens({ snapshot, summary, onOpenDebug }: { snapshot: DagSnapshot; summary: DagPlannerSummary; onOpenDebug: () => void }) {
  const [filter, setFilter] = useState<"all" | "review" | "blocked">("all");
  const pendingReview = snapshot.phase_status?.review_comparison?.closure_allowed === false;
  const items = [
    ...(pendingReview ? [{ id: "phase-review", title: "Phase review pending", detail: snapshot.phase_status?.review_comparison?.reason ?? "Review comparison does not allow closure.", status: "blocked", evidence: snapshot.source.phase_status }] : []),
    ...summary.checkpointNodes.map((nodeId) => ({ id: nodeId, title: nodeId, detail: "Pending review checkpoint: evidence must be inspected before acceptance.", status: "pending_review", evidence: snapshot.source.events })),
  ];
  const visibleItems = items.filter((item) => filter === "all" || (filter === "blocked" ? item.status === "blocked" : item.status !== "blocked"));
  return (
    <section className="scillm-dag-lens-panel" aria-label="DAG checkpoint lens">
      <div className="scillm-dag-checkpoint-layout">
        <div>
          <h3>Checkpoint queue</h3>
          <p className="scillm-meta">Human gates are explicit review items. Approval/rejection is disabled until the backend action contract exists.</p>
          <div className="scillm-dag-checkpoint-filters">
            <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
            <button type="button" className={filter === "review" ? "active" : ""} onClick={() => setFilter("review")}>Needs review</button>
            <button type="button" className={filter === "blocked" ? "active" : ""} onClick={() => setFilter("blocked")}>Blocked</button>
          </div>
        </div>
        <div className="scillm-dag-checkpoint-list">
          {visibleItems.length ? visibleItems.map((item) => (
            <article key={item.id} className="scillm-dag-checkpoint-item">
              <div>
                <h4>{item.title}</h4>
                <p>{item.detail}</p>
                <code title={item.evidence}>{item.evidence}</code>
                <div className="scillm-dag-checkpoint-actions">
                  <button type="button" onClick={onOpenDebug}>Open evidence</button>
                  <button type="button" disabled title="Approve requires the backend checkpoint action contract.">Approve</button>
                  <button type="button" disabled title="Reject requires the backend checkpoint action contract.">Reject</button>
                </div>
              </div>
              <span className={`scillm-dag-state scillm-dag-state--${item.status}`}>{item.status}</span>
            </article>
          )) : (
            <div className="scillm-dag-empty">No checkpoint nodes are present in this graph snapshot.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function DebugLens({ snapshot, summary, onCopy, copiedToken }: { snapshot: DagSnapshot; summary: DagPlannerSummary; onCopy: (value: string, token: string) => void; copiedToken: string }) {
  return (
    <section className="scillm-dag-lens-panel" aria-label="DAG debug lens">
      {summary.incompleteEvidence.length ? (
        <div className="scillm-dag-hard-stop" role="alert">
          <AlertTriangle size={18} color={EMBRY.red} />
          <div>
            <strong>Acceptance blocked by missing evidence hashes</strong>
            <p>These nodes may report execution success, but they are not closure evidence until output hashes or formal exemptions are recorded by the backend.</p>
          </div>
        </div>
      ) : null}
      <div className="scillm-dag-debug-grid">
        <div className="scillm-dag-debug-card">
          <h3>Evidence completeness</h3>
          <StatusColumn title="Missing or incomplete evidence" items={summary.incompleteEvidence} details={summary.incompleteEvidenceDetails} snapshot={snapshot} empty="No incomplete evidence reported by node_results." tone="red" />
        </div>
        <div className="scillm-dag-debug-card">
          <h3>Source artifacts</h3>
          <dl className="scillm-dag-source-list">
            {Object.entries(snapshot.source).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd title={value}>{value}</dd>
                <button type="button" className="scillm-dag-inline-action" onClick={() => onCopy(value, `source-${key}`)}>
                  {copiedToken === `source-${key}` ? "Copied" : "Copy"}
                </button>
              </div>
            ))}
          </dl>
        </div>
        <div className="scillm-dag-debug-card scillm-dag-debug-card--wide">
          <h3>Backend graph hash</h3>
          <code>{snapshot.base_graph_hash}</code>
          <p className="scillm-meta">{snapshot.hash_algorithm ?? "sha256 canonical executable graph"}</p>
        </div>
      </div>
    </section>
  );
}

function StatusColumn({ title, items, empty, tone, snapshot, details, onInspect }: { title: string; items: string[]; empty: string; tone: "green" | "red" | "amber" | "blue"; snapshot?: DagSnapshot; details?: Array<{ id: string; reason: string }>; onInspect?: () => void }) {
  const detailById = new Map((details ?? []).map((item) => [item.id, item.reason]));
  return (
    <div className={`scillm-dag-status-column scillm-dag-status-column--${tone}`}>
      <h3>{title}</h3>
      {items.length ? (
        <ul>
          {items.map((item) => {
            const result = (snapshot?.status as ExecStatus & { node_results?: Record<string, { output_hash?: string; artifact?: string; evidence_status?: string; ok?: boolean }> } | undefined)?.node_results?.[item];
            const reason = detailById.get(item) ?? (result?.output_hash ? `hash ${result.output_hash.slice(0, 12)}` : result?.artifact ? `artifact ${result.artifact}` : result?.ok === true ? "Execution reported ok; evidence missing - not closure evidence" : "Evidence artifact not reported");
            return (
              <li key={item}>
                <button type="button" onClick={onInspect} disabled={!onInspect} title={onInspect ? "Open Design lens for node inspection." : undefined}>
                  <strong>{item}</strong>
                  <span>{reason}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>{empty}</p>
      )}
    </div>
  );
}

function HighlightedJson({ value }: { value: unknown }) {
  const html = useMemo(() => highlightJson(value), [value]);
  return (
    <pre
      className="scillm-json-viewer"
      aria-label="Formatted JSON payload"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function highlightJson(value: unknown) {
  const escaped = escapeHtml(JSON.stringify(value, null, 2));
  return escaped.replace(
    /(&quot;(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\&])*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g,
    (match, stringToken: string | undefined, colon: string | undefined) => {
      if (stringToken) {
        return colon
          ? `<span class="json-key">${stringToken}</span>${colon}`
          : `<span class="json-string">${stringToken}</span>`;
      }
      if (match === "true" || match === "false") return `<span class="json-boolean">${match}</span>`;
      if (match === "null") return `<span class="json-null">${match}</span>`;
      return `<span class="json-number">${match}</span>`;
    },
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
