/**
 * ScillmDashboard — Command Center for scillm proxy
 *
 * Design Principles:
 * - Every pixel answers a question (Is it down? Is it stuck? Who's hogging?)
 * - Traffic light colors: Green=OK, Amber=Slow, Red=Error
 * - Focus mode: Hover to reveal blast radius
 * - Node size = call volume (pre-attentive processing)
 * - Animated edges = active traffic
 *
 * Features:
 * - Trace Panel: Click a log row to see raw request/response data
 * - Cost Tracking: Daily spend with budget progress bar
 * - Blast Radius: Hover to see dependencies
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Activity, Clock, AlertTriangle, DollarSign, Copy, Check, Sparkles, Loader2, Send, Zap, Eye, ChevronRight } from "lucide-react";
import { EMBRY, glowDot } from "../common/EmbryStyle";
import { useScillmData, useProviderAuth, useBatchJobState, useOrchestratorDetail, type LogEntry, type AuthStatusResponse, type BatchJobState } from "../../hooks/useScillmData";
import { useRegisterAction } from "../../hooks/useRegisterAction";
import { JobsTable } from "./JobsTable";
import { CreateQrasManifestPane } from "./CreateQrasManifestPane";
import "./scillm-dashboard.css";

const MONO = '"JetBrains Mono", "SF Mono", monospace';

// Traffic light thresholds for error rate coloring
const ERROR_WARN = 0.01;     // 1% = yellow
const ERROR_CRIT = 0.10;     // 10% = red

// Budget settings
const DAILY_BUDGET_USD = 50;
const ORCHESTRATOR_STALE_MS = 5 * 60 * 1000;

// Stat pill for the health ribbon
function StatPill({
  label,
  value,
  color = EMBRY.blue,
  icon: Icon,
  small,
  noWrap,
}: {
  label: string;
  value: string;
  color?: string;
  icon?: React.ComponentType<{ size: number; color: string }>;
  small?: boolean;
  noWrap?: boolean;
}) {
  return (
    <div className="scillm-flex-col scillm-gap-2">
      <span className="scillm-flex-row scillm-gap-4 scillm-uppercase">
        {Icon && <Icon size={10} color={EMBRY.dim} />}
        {label}
      </span>
      <span
        className="tabular-nums scillm-mono"
        style={{
          fontSize: small ? 12 : 16,
          fontWeight: 700,
          color,
          whiteSpace: noWrap ? "nowrap" : "normal",
        }}
      >
        {value}
      </span>
    </div>
  );
}

// Provider auth status strip - shows which providers are healthy
function ProviderAuthStrip({ auth }: { auth: AuthStatusResponse | null }) {
  if (!auth) return null;

  const providers = [
    { name: "Claude", data: auth.claude, key: "claude" },
    { name: "Codex", data: auth.codex, key: "codex" },
    { name: "Gemini", data: auth.gemini, key: "gemini" },
    { name: "Chutes", data: auth.chutes, key: "chutes" },
    { name: "Ollama", data: auth.ollama, key: "ollama" },
  ];

  const getStatusColor = (status?: string): string => {
    if (!status) return EMBRY.dim;
    if (status === "valid" || status === "configured" || status === "ok") return EMBRY.green;
    if (status === "expired" || status === "error") return EMBRY.red;
    return EMBRY.amber;
  };

  const formatExpiry = (seconds?: number): string => {
    if (!seconds) return "";
    const hours = Math.floor(seconds / 3600);
    if (hours > 0) return `${hours}h`;
    const mins = Math.floor(seconds / 60);
    return `${mins}m`;
  };

  return (
    <div className="scillm-flex-row scillm-gap-12">
      {providers.map(({ name, data, key }) => {
        if (!data) return null;
        const color = getStatusColor(data.status);
        const expiry = "expires_in_s" in data ? formatExpiry(typeof data.expires_in_s === 'number' ? data.expires_in_s : undefined) : "";

        return (
          <div
            key={key}
            className="scillm-flex-row scillm-gap-4"
            title={`${name}: ${data.status}${expiry ? ` (${expiry} remaining)` : ""}`}
          >
            <span
              style={{
                ...glowDot,
                width: 6,
                height: 6,
                backgroundColor: color,
                boxShadow: `0 0 4px ${color}`,
              }}
            />
            <span
              className="scillm-uppercase-sm"
              style={{ color }}
            >
              {name}
            </span>
            {expiry && (
              <span style={{ fontSize: 8, color: EMBRY.dim }}>{expiry}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function getOrchestratorStatusColor(job: BatchJobState): string {
  const status = getOrchestratorDisplayStatus(job);
  if (status === "failed" || job.error) return EMBRY.red;
  if (status === "completed") return EMBRY.green;
  if (status === "running") return EMBRY.blue;
  return EMBRY.amber;
}

function getOrchestratorDisplayStatus(job: BatchJobState): string {
  const status = job.state?.status;
  if (status !== "running") return status || (job.error ? "missing" : "unknown");
  if (!job.lastModified) return status;
  const ageMs = Date.now() - new Date(job.lastModified).getTime();
  return ageMs > ORCHESTRATOR_STALE_MS ? "stalled" : "running";
}

function getVisibleOrchestrators(batchJobs: BatchJobState[]) {
  return batchJobs
    .filter((job) => job.state)
    .sort((a, b) => {
      const aRunning = a.state?.status === "running" ? 1 : 0;
      const bRunning = b.state?.status === "running" ? 1 : 0;
      if (aRunning !== bRunning) return bRunning - aRunning;
      return (b.lastModified || "").localeCompare(a.lastModified || "");
    });
}

function inferTonightRolloutPreview(job: BatchJobState): {
  tonightTotal: number;
  tonightCompleted: number;
  tonightRemaining: number;
  label: string;
} | null {
  const manifestPath = String(job.state?.manifest_path || "");
  if (!manifestPath.includes("sparta_v2_stage_manifest_tonight")) return null;

  let completedBeforeCurrent = 0;
  let label = "Tonight";
  if (manifestPath.endsWith("sparta_v2_stage_manifest_tonight_after50.json")) {
    completedBeforeCurrent = 50;
    label = "Stage 100";
  } else if (manifestPath.endsWith("sparta_v2_stage_manifest_tonight_after150.json")) {
    completedBeforeCurrent = 150;
    label = "Stage 250";
  } else if (manifestPath.endsWith("sparta_v2_stage_manifest_tonight_remainder.json")) {
    completedBeforeCurrent = 400;
    label = "Remainder";
  } else if (manifestPath.endsWith("sparta_v2_stage_manifest_tonight.json")) {
    label = "Stage 50";
  }

  const tonightTotal = 1720;
  const tonightCompleted = completedBeforeCurrent + Number(job.state?.completed_jobs || 0);
  return {
    tonightTotal,
    tonightCompleted,
    tonightRemaining: Math.max(tonightTotal - tonightCompleted, 0),
    label,
  };
}

function formatEta(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(minutes, 1)}m`;
}

function formatFinishTime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const finish = new Date(Date.now() + seconds * 1000);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(finish);
}

function inferEtaPreview(job: BatchJobState, rollout: ReturnType<typeof inferTonightRolloutPreview>) {
  const state = job.state;
  if (!state || state.status !== "running") return { trancheEtaSeconds: null, tonightEtaSeconds: null };
  const startedAt = Number(state.started_at || 0);
  const completedJobs = Number(state.completed_jobs || 0);
  const trancheTotal = Number(state.total_jobs || 0);
  if (!startedAt || completedJobs <= 0 || trancheTotal <= 0) {
    return { trancheEtaSeconds: null, tonightEtaSeconds: null };
  }

  const elapsedSeconds = Math.max(Math.floor(Date.now() / 1000) - startedAt, 1);
  const secondsPerJob = elapsedSeconds / completedJobs;
  const trancheRemaining = Math.max(trancheTotal - completedJobs, 0);
  const tonightRemaining = rollout?.tonightRemaining ?? trancheRemaining;

  return {
    trancheEtaSeconds: trancheRemaining > 0 ? trancheRemaining * secondsPerJob : 0,
    tonightEtaSeconds: tonightRemaining > 0 ? tonightRemaining * secondsPerJob : 0,
  };
}

function isRenderableLogEntry(value: unknown): value is LogEntry {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { _key?: unknown })._key === "string" &&
      typeof (value as { ts?: unknown }).ts === "string",
  );
}

function deriveManifestJobItemId(job: Record<string, any>): string {
  const identity = job?.identity || {};
  const sourceId = identity.source_control_id || identity.technique_id || "";
  const targetId = identity.countermeasure_id || identity.tactic_id || "";
  return sourceId && targetId ? `${sourceId}->${targetId}` : sourceId || job?.job_id || "unknown";
}

type OutcomeStatus = "ok" | "skipped" | "failed" | "invalid" | "unknown" | "pending";
type OutcomeSource = "complete" | "create-evidence" | "scillm" | "pending";

type CallOutcome = {
  status: OutcomeStatus;
  source: OutcomeSource;
  label: string;
  summary: string;
  error?: string | null;
};

type WholeJobRow = {
  key: string;
  itemId: string;
  promptKind: string;
  log: LogEntry | null;
  outcome: CallOutcome;
  manifestIndex: number;
};

type IncomingCallRow = {
  key: string;
  itemLabel: string;
  projectLabel: string;
  callCategory: string | null;
  batchId: string | null;
  log: LogEntry;
  outcome: CallOutcome;
};

function getLogTimestamp(log: LogEntry | null): number {
  if (!log?.ts) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(log.ts);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function shouldReplaceManifestCall(existing: LogEntry, candidate: LogEntry, preferredBatchId?: string | null): boolean {
  const existingBatchId = existing.metadata?.batch_id || null;
  const candidateBatchId = candidate.metadata?.batch_id || null;

  if (preferredBatchId) {
    const existingMatches = existingBatchId === preferredBatchId;
    const candidateMatches = candidateBatchId === preferredBatchId;
    if (existingMatches !== candidateMatches) return candidateMatches;
  }

  const timeDiff = getLogTimestamp(candidate) - getLogTimestamp(existing);
  if (timeDiff !== 0) return timeDiff > 0;

  const candidateHasResponse = Boolean(candidate.response_content?.trim());
  const existingHasResponse = Boolean(existing.response_content?.trim());
  if (candidateHasResponse !== existingHasResponse) return candidateHasResponse;

  const candidateHasPrompt = Boolean(candidate.request_prompt?.trim());
  const existingHasPrompt = Boolean(existing.request_prompt?.trim());
  if (candidateHasPrompt !== existingHasPrompt) return candidateHasPrompt;

  return candidate._key > existing._key;
}

function outcomeBadgeColor(outcome: CallOutcome): string {
  if (outcome.source === "scillm") return EMBRY.red;
  if (outcome.status === "ok") return EMBRY.green;
  if (outcome.status === "pending") return EMBRY.dim;
  return EMBRY.amber;
}

function ResizeGrip({ onMouseDown }: { onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void }) {
  return (
    <div
      data-qid="scillm:resize:grip"
      data-qs-action="SCILLM_RESIZE_PANEL"
      title="Drag to resize panel"
      onMouseDown={onMouseDown}
      className="scillm-resize-grip"
      style={{ background: EMBRY.bgPanel, borderTop: `1px solid ${EMBRY.border}` }}
    >
      <div className="scillm-resize-grip__bar" style={{ background: EMBRY.border }} />
    </div>
  );
}

function parseCallOutcome(log: LogEntry | null): CallOutcome {
  if (!log) return { status: "pending", source: "pending", label: "Pending", summary: "No response yet" };
  if (log.status === "error" || log.error) {
    return {
      status: "failed",
      source: "scillm",
      label: "Transport",
      summary: log.error || "scillm transport error",
      error: log.error || "scillm transport error",
    };
  }
  if (typeof log.response_content !== "string" || !log.response_content.trim()) {
    return {
      status: "failed",
      source: "create-evidence",
      label: "Empty",
      summary: "No create-evidence response body",
      error: "response_content is null/empty",
    };
  }
  try {
    const parsed = JSON.parse(log.response_content);
    const parsedFailure =
      (typeof parsed?.error === "string" && parsed.error) ||
      (typeof parsed?.failure_reason === "string" && parsed.failure_reason) ||
      (Array.isArray(parsed?.errors) && typeof parsed.errors[0] === "string" && parsed.errors[0]) ||
      null;
    if (parsedFailure) {
      return {
        status: "failed",
        source: "create-evidence",
        label: "Schema",
        summary: parsedFailure,
        error: parsedFailure,
      };
    }
    if (parsed?.skipped_reason) return { status: "skipped", source: "create-evidence", label: "Skipped", summary: parsed.skipped_reason };
    if (Array.isArray(parsed?.pairs) && parsed.pairs.length === 0) {
      return { status: "skipped", source: "create-evidence", label: "Zero pairs", summary: "Returned zero pairs" };
    }
    if (Array.isArray(parsed?.pairs) && parsed.pairs.length > 0) {
      const first = parsed.pairs[0];
      return {
        status: "ok",
        source: "complete",
        label: "Complete",
        summary: first?.answer || first?.reasoning || first?.question || `${parsed.pairs.length} pair(s)`,
      };
    }
    if (parsed?.answer || parsed?.question || parsed?.reasoning) {
      return {
        status: "ok",
        source: "complete",
        label: "Complete",
        summary: parsed.answer || parsed.reasoning || parsed.question,
      };
    }
  } catch {
    return {
      status: "invalid",
      source: "create-evidence",
      label: "Schema",
      summary: log.response_content.slice(0, 160),
      error: "Response is not valid JSON",
    };
  }
  return {
    status: "unknown",
    source: "create-evidence",
    label: "Schema",
    summary: "Response did not match expected create-evidence schema",
    error: "Unexpected JSON schema",
  };
}

function summarizeTextPreview(text: string, fallback = "Response captured"): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine || fallback;
}

function isStructuredEvidenceCall(log: LogEntry): boolean {
  const prompt = log.request_prompt || "";
  return prompt.includes("top-level JSON object with keys") || prompt.includes("skipped_reason");
}

function parseIncomingOutcome(log: LogEntry | null): CallOutcome {
  if (!log) return { status: "pending", source: "pending", label: "Pending", summary: "No response yet" };
  if (log.status === "error" || log.error) {
    return {
      status: "failed",
      source: "scillm",
      label: "Transport",
      summary: log.error || "scillm transport error",
      error: log.error || "scillm transport error",
    };
  }
  if (isStructuredEvidenceCall(log)) return parseCallOutcome(log);
  if (typeof log.response_content !== "string" || !log.response_content.trim()) {
    return {
      status: "invalid",
      source: "create-evidence",
      label: "Empty",
      summary: "Response body was empty",
      error: "response_content is null/empty",
    };
  }
  return {
    status: "ok",
    source: "complete",
    label: "Complete",
    summary: summarizeTextPreview(log.response_content, "Response captured"),
  };
}

function deriveProjectLabel(log: LogEntry): string {
  return log.caller?.trim() || "system";
}

function formatCallCategory(category: string): string {
  return category
    .replace(/^sparta_/, "SPARTA ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function deriveLegacyCreateQrasCategory(log: LogEntry): string | null {
  const itemId = log.metadata?.item_id || "";
  const batchId = log.metadata?.batch_id || "";

  if (itemId.includes("->")) {
    const [sourceId, targetId] = itemId.split("->");
    if (sourceId.startsWith("DE-") && targetId.startsWith("CM")) {
      return "SPARTA Technique Countermeasure Relationship";
    }
    if (sourceId.startsWith("DE-") && targetId.startsWith("ST")) {
      return "SPARTA Tactic Technique Relationship";
    }
    if (batchId.includes("relationship")) {
      return "SPARTA Relationship";
    }
  }

  if (itemId.startsWith("DE-")) return "SPARTA Technique Canonical";
  if (itemId.startsWith("CM")) return "SPARTA Countermeasure Canonical";
  if (itemId.startsWith("ST")) return "SPARTA Tactic Canonical";
  if (batchId.includes("canonical")) return "SPARTA Canonical";
  if (batchId.includes("relationship")) return "SPARTA Relationship";
  return null;
}

function deriveCallCategory(log: LogEntry): string | null {
  const explicit = log.metadata?.call_category || log.metadata?.prompt_kind;
  if (explicit) return formatCallCategory(explicit);
  if (log.caller === "create-qras") return deriveLegacyCreateQrasCategory(log);
  return null;
}

function deriveIncomingItemLabel(log: LogEntry): string {
  return log.metadata?.item_id || log._key;
}

function formatEvidenceCaseSummary(outcome: CallOutcome): string {
  if (outcome.status === "ok") return "Complete: grounded response accepted";
  if (outcome.status === "pending") return "Pending: awaiting response";
  if (outcome.status === "skipped") return `Skipped: ${outcome.summary}`;
  return `${outcome.label}: ${outcome.summary}`;
}

function outcomeChipStyle(outcome: CallOutcome): React.CSSProperties {
  const color = outcome.source === "scillm"
    ? EMBRY.red
    : outcome.status === "ok"
      ? EMBRY.green
      : outcome.status === "skipped"
        ? EMBRY.amber
        : outcome.status === "pending"
          ? EMBRY.dim
          : EMBRY.amber;

  return {
    borderColor: `${color}55`,
    backgroundColor: `${color}12`,
    color,
  };
}

function renderOutcomeIcon(outcome: CallOutcome) {
  const color = outcome.source === "scillm"
    ? EMBRY.red
    : outcome.status === "ok"
      ? EMBRY.green
      : outcome.status === "pending"
        ? EMBRY.dim
        : EMBRY.amber;
  const iconStyle = { color, width: 14, height: 14 } as const;

  if (outcome.status === "ok") return <Check size={14} style={iconStyle} />;
  if (outcome.status === "pending") return <Clock size={14} style={iconStyle} />;
  if (outcome.status === "skipped") return <ChevronRight size={14} style={iconStyle} />;
  if (outcome.source === "scillm") return <X size={14} style={iconStyle} />;
  return <AlertTriangle size={14} style={iconStyle} />;
}

function summarizePromptPreview(log: LogEntry | null, fallback: string): string {
  const raw = log?.request_prompt?.trim();
  if (!raw) return fallback;
  const singleLine = raw.replace(/\s+/g, " ").trim();
  return singleLine || fallback;
}

function PromptDialog({
  title,
  prompt,
  onClose,
}: {
  title: string;
  prompt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="scillm-dialog-backdrop"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="scillm-dialog-content elevated-surface"
        style={{
          backgroundColor: EMBRY.bgPanel,
          border: `1px solid ${EMBRY.border}`,
          borderLeft: `3px solid ${EMBRY.blue}`,
        }}
      >
        <div className="scillm-dialog-header">
          <div className="scillm-min-w-0">
            <div className="scillm-meta scillm-uppercase-lg" style={{ marginBottom: 6 }}>
              Full prompt
            </div>
            <div className="scillm-text-13 scillm-fw-700 scillm-text-white" style={{ wordBreak: "break-word" }}>
              {title}
            </div>
          </div>
          <button
            data-qid="scillm:prompt-dialog:close"
            data-qs-action="SCILLM_CLOSE_PROMPT"
            title="Close full prompt dialog"
            onClick={onClose}
            className="press-scale scillm-focus scillm-button"
            style={{
              background: EMBRY.bgDeep,
            }}
          >
            Close
          </button>
        </div>
        <div className="scillm-dialog-body">
          {prompt}
        </div>
      </div>
    </div>
  );
}

function ActiveCreateQrasTable({
  detail,
  logs,
  onCallClick,
  onInspect,
  selectedLog,
  tableHeight,
  onResizeStart,
}: {
  detail: any | null;
  logs: LogEntry[];
  onCallClick: (log: LogEntry) => void;
  onInspect: () => void;
  selectedLog: LogEntry | null;
  tableHeight: number;
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "complete" | "pending" | "transport" | "schema" | "empty" | "skipped">("all");
  const [failureStreamAutoScroll, setFailureStreamAutoScroll] = useState(true);
  const [projectScope, setProjectScope] = useState<string>("all");
  const [batchScope, setBatchScope] = useState<string>("all");
  const [promptDialog, setPromptDialog] = useState<{ title: string; prompt: string } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const failureStreamRef = useRef<HTMLDivElement | null>(null);

  useRegisterAction("scillm:filter:all", { app: "ux-lab", action: "SCILLM_FILTER_ALL", label: "Filter: All", description: "Show all incoming calls" });
  useRegisterAction("scillm:filter:complete", { app: "ux-lab", action: "SCILLM_FILTER_COMPLETE", label: "Filter: Complete", description: "Show complete calls only" });
  useRegisterAction("scillm:filter:pending", { app: "ux-lab", action: "SCILLM_FILTER_PENDING", label: "Filter: Pending", description: "Show pending calls only" });
  useRegisterAction("scillm:filter:skipped", { app: "ux-lab", action: "SCILLM_FILTER_SKIPPED", label: "Filter: Skipped", description: "Show skipped calls only" });
  useRegisterAction("scillm:inspect:batch", { app: "ux-lab", action: "SCILLM_INSPECT_BATCH", label: "Inspect Batch", description: "Inspect active batch details" });
  useRegisterAction("scillm:resize:grip", { app: "ux-lab", action: "SCILLM_RESIZE_PANEL", label: "Resize Panel", description: "Drag to resize incoming table panel" });

  const calls = useMemo(() => logs.filter(isRenderableLogEntry), [logs]);
  const projectOptions = useMemo(() => {
    const options = Array.from(new Set(calls.map((call) => deriveProjectLabel(call))));
    return options.sort((a, b) => a.localeCompare(b));
  }, [calls]);
  const scopedProjectCalls = useMemo(
    () => (projectScope === "all" ? calls : calls.filter((call) => deriveProjectLabel(call) === projectScope)),
    [calls, projectScope],
  );
  const batchOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: string[] = [];
    for (const call of scopedProjectCalls) {
      const batchId = call.metadata?.batch_id;
      if (batchId && !seen.has(batchId)) {
        seen.add(batchId);
        options.push(batchId);
      }
    }
    return options.sort((a, b) => b.localeCompare(a));
  }, [scopedProjectCalls]);

  useEffect(() => {
    if (projectScope !== "all" && !projectOptions.includes(projectScope)) {
      setProjectScope("all");
    }
  }, [projectOptions, projectScope]);

  useEffect(() => {
    if (batchScope !== "all" && !batchOptions.includes(batchScope)) {
      setBatchScope("all");
      return;
    }
  }, [batchOptions, batchScope]);

  const rows = useMemo(() => {
    const scopedCalls = batchScope === "all"
      ? scopedProjectCalls
      : scopedProjectCalls.filter((call: LogEntry) => (call.metadata?.batch_id || "") === batchScope);
    return scopedCalls
      .map((log): IncomingCallRow => ({
        key: log._key,
        itemLabel: deriveIncomingItemLabel(log),
        projectLabel: deriveProjectLabel(log),
        callCategory: deriveCallCategory(log),
        batchId: log.metadata?.batch_id || null,
        log,
        outcome: parseIncomingOutcome(log),
      }))
      .sort((a, b) => getLogTimestamp(b.log) - getLogTimestamp(a.log));
  }, [batchScope, scopedProjectCalls]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row: IncomingCallRow) => {
      const filterMatch =
        filter === "all" ? true
        : filter === "complete" ? row.outcome.status === "ok"
        : filter === "pending" ? row.outcome.status === "pending"
        : filter === "transport" ? row.outcome.label === "Transport"
        : filter === "schema" ? row.outcome.label === "Schema"
        : filter === "empty" ? row.outcome.label === "Empty"
        : filter === "skipped" ? row.outcome.status === "skipped"
        : true;

      if (!filterMatch) return false;
      if (!query) return true;
      return [
        row.itemLabel,
        row.projectLabel,
        row.callCategory,
        row.batchId,
        row.outcome.status,
        row.outcome.source,
        row.outcome.label,
        row.outcome.summary,
        row.outcome.error,
        row.log?.model_served,
        row.log?.model_requested,
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [filter, rows, search]);
  const failureRows = useMemo(() => {
    return rows
      .filter((row: IncomingCallRow) => row.outcome.status !== "ok" && row.outcome.status !== "pending" && row.outcome.status !== "skipped");
  }, [rows]);

  useEffect(() => {
    if (!failureStreamAutoScroll) return;
    failureStreamRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [failureRows.length, failureStreamAutoScroll]);

  if (rows.length === 0) return null;

  return (
    <section className="scillm-panel" style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
      <div className="scillm-flex-between-start scillm-gap-12 scillm-flex-wrap">
        <div className="scillm-flex-row-start scillm-gap-10 scillm-min-w-0">
          <div className="scillm-flex-col scillm-gap-4 scillm-min-w-0">
            <div className="text-balance scillm-heading">
              Incoming
            </div>
            <div className="text-pretty scillm-meta">Live incoming LLM calls across projects. Narrow by project or batch when needed.</div>
          </div>
        </div>
        <div className="scillm-flex-row scillm-gap-8 scillm-flex-wrap scillm-ml-auto">
          {projectOptions.length > 1 && (
            <select
              data-qid="scillm:scope:project"
              data-qs-action="SCILLM_SCOPE_PROJECT"
              title="Filter incoming calls by project"
              value={projectScope}
              onChange={(event) => {
                setProjectScope(event.target.value);
                setBatchScope("all");
              }}
              className="scillm-focus scillm-select"
            >
              <option value="all">All projects</option>
              {projectOptions.map((project) => (
                <option key={project} value={project}>
                  {project}
                </option>
              ))}
            </select>
          )}
          {batchOptions.length > 0 && (
            <select
              data-qid="scillm:scope:batch"
              data-qs-action="SCILLM_SCOPE_BATCH"
              title="Filter incoming calls by batch id"
              value={batchScope}
              onChange={(event) => setBatchScope(event.target.value)}
              className="scillm-focus scillm-select scillm-select--wide"
            >
              <option value="all">All batch ids</option>
              {batchOptions.map((batchId) => (
                <option key={batchId} value={batchId}>
                  {batchId}
                </option>
              ))}
            </select>
          )}
          <div
            className="scillm-search-box scillm-min-w-280"
          >
            <Search size={12} color={EMBRY.dim} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search item, prompt, response, scillm error..."
              className="scillm-input"
            />
            {search && (
              <button
                data-qid="scillm:search:clear"
                data-qs-action="SCILLM_CLEAR_SEARCH"
                title="Clear search"
                onClick={() => setSearch("")}
                className="press-scale scillm-focus scillm-button--icon"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div className="scillm-meta">
            {filteredRows.length}/{rows.length} shown
          </div>
          <button
            data-qid="scillm:inspect:batch"
            data-qs-action="SCILLM_INSPECT_BATCH"
            title="Inspect active batch details"
            onClick={onInspect}
            className="press-scale scillm-focus scillm-button"
            style={{
              background: EMBRY.bgPanel,
              gap: 6,
            }}
          >
            <Eye size={12} />
            Inspect Batch
          </button>
        </div>
      </div>
      <>
          <div className="scillm-flex-row scillm-gap-8 scillm-flex-wrap">
            {[
              { key: "all", label: `All (${rows.length})` },
              { key: "complete", label: `Complete (${rows.filter((row: IncomingCallRow) => row.outcome.status === "ok").length})` },
              { key: "pending", label: `Pending (${rows.filter((row: IncomingCallRow) => row.outcome.status === "pending").length})` },
              { key: "transport", label: `Transport (${rows.filter((row: IncomingCallRow) => row.outcome.label === "Transport").length})` },
              { key: "schema", label: `Schema (${rows.filter((row: IncomingCallRow) => row.outcome.label === "Schema").length})` },
              { key: "empty", label: `Empty (${rows.filter((row: IncomingCallRow) => row.outcome.label === "Empty").length})` },
              { key: "skipped", label: `Skipped (${rows.filter((row: IncomingCallRow) => row.outcome.status === "skipped").length})` },
            ].map(({ key, label }) => (
              <button
                key={key}
                data-qid={`scillm:filter:${key}`}
                data-qs-action={`SCILLM_FILTER_${key.toUpperCase()}`}
                title={`Filter by ${key}`}
                onClick={() => setFilter(key as typeof filter)}
                className={`press-scale scillm-focus scillm-button--filter ${filter === key ? 'scillm-button--filter-active' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="scillm-meta">
            Filters: <span className="scillm-text-red">Transport</span> means the proxy call itself failed. <span className="scillm-text-amber">Schema</span> and <span className="scillm-text-amber">Empty</span> mean the returned payload was malformed or empty.
          </div>

          <div className={failureRows.length > 0 ? "scillm-grid-2" : "scillm-grid-1"}>
            <div style={{ border: `1px solid ${EMBRY.border}`, background: EMBRY.bgPanel, overflow: "auto", height: tableHeight }}>
              <table className="scillm-table">
                <colgroup>
                <col style={{ width: "18%" }} />
                <col style={{ width: "19%" }} />
                <col style={{ width: "29%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "16%" }} />
                </colgroup>
                <thead>
                  <tr>
                    {["Call", "Prompt", "Response", "Evidence case", "Duration", "Model"].map((label) => (
                      <th
                        key={label}
                        className="scillm-th scillm-th--sticky scillm-bg-panel"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row: IncomingCallRow) => {
                    const promptPreview = summarizePromptPreview(row.log, row.projectLabel);
                    const evidenceText = row.outcome.status === "ok" ? row.outcome.summary : "—";
                    const evidenceCaseText = formatEvidenceCaseSummary(row.outcome);
                    const evidenceCaseColor = row.outcome.status === "ok"
                      ? EMBRY.dim
                      : row.outcome.source === "scillm"
                        ? EMBRY.red
                        : row.outcome.status === "pending"
                          ? EMBRY.dim
                          : EMBRY.amber;
                    const isSelected = Boolean(selectedLog && selectedLog._key === row.log._key);

                    return (
                      <tr
                        key={row.key}
                        data-qid={`scillm:incoming:row:${row.key}`}
                        ref={(node) => {
                          if (node) rowRefs.current.set(row.key, node);
                          else rowRefs.current.delete(row.key);
                        }}
                        onClick={() => row.log && onCallClick(row.log)}
                        className={`scillm-row ${isSelected ? "scillm-row-selected" : ""}`}
                        style={{
                          cursor: row.log ? "pointer" : "default",
                          fontSize: 10,
                        }}
                      >
                        <td className="scillm-td">
                          <div className="scillm-flex-row scillm-gap-10 scillm-min-w-0 scillm-mono">
                            <div
                              title={`${row.outcome.label}: ${row.outcome.summary}`}
                              className="scillm-chip scillm-chip--square"
                              style={outcomeChipStyle(row.outcome)}
                            >
                              {renderOutcomeIcon(row.outcome)}
                            </div>
                            <div
                              title={`${row.itemLabel}${row.callCategory ? ` • ${row.callCategory}` : ""}${row.batchId ? ` • ${row.batchId}` : ""}`}
                              className="scillm-ellipsis-box"
                            >
                              <div className="scillm-ellipsis scillm-text-white scillm-fw-700">
                                {row.itemLabel}
                              </div>
                              <div className="scillm-ellipsis scillm-ui scillm-text-dim" style={{ fontSize: 9 }}>
                                {row.projectLabel}
                                {row.callCategory ? ` • ${row.callCategory}` : ""}
                                {row.batchId ? ` • ${row.batchId}` : ""}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td
                          className="scillm-td scillm-text-dim"
                        >
                          <button
                            data-qid={`scillm:incoming:prompt:${row.key}`}
                            data-qs-action="SCILLM_OPEN_PROMPT"
                            title={`Open full prompt for ${row.itemLabel}`}
                            className="press-scale scillm-focus scillm-prompt-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPromptDialog({
                                title: row.itemLabel,
                                prompt: row.log.request_prompt?.trim() || promptPreview,
                              });
                            }}
                          >
                            {promptPreview}
                          </button>
                        </td>
                        <td
                          title={evidenceText}
                          className="scillm-td"
                          style={{ color: row.outcome.status === "ok" ? EMBRY.white : EMBRY.dim }}
                        >
                          <div className="scillm-line-clamp-2">
                            {evidenceText}
                          </div>
                        </td>
                        <td
                          title={evidenceCaseText}
                          className="scillm-td"
                          style={{ color: evidenceCaseColor }}
                        >
                          <div className="scillm-line-clamp-2">
                            {evidenceCaseText}
                          </div>
                        </td>
                        <td className="tabular-nums scillm-td scillm-mono scillm-td--nowrap">
                          {row.log?.duration_ms != null ? `${row.log.duration_ms}ms` : "—"}
                        </td>
                        <td
                          className="tabular-nums scillm-td scillm-ellipsis"
                          title={row.log?.model_served || row.log?.model_requested || "—"}
                          style={{ fontSize: 9, color: EMBRY.dim }}
                        >
                          {row.log?.model_served || row.log?.model_requested || "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="scillm-td--16 scillm-text-11 scillm-text-dim">
                        No incoming calls match the current scope and search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {failureRows.length > 0 && (
              <aside
                className="scillm-aside"
                style={{ height: tableHeight }}
              >
                <div className="scillm-aside-header">
                  <div>
                    <div className="scillm-uppercase scillm-text-red">
                      Failure Stream
                    </div>
                    <div className="scillm-meta">
                      {failureRows.length} failed manifest rows
                    </div>
                  </div>
                  <button
                    onClick={() => setFailureStreamAutoScroll((prev) => !prev)}
                    className={`scillm-button--scope ${failureStreamAutoScroll ? 'scillm-button--scope-active' : ''}`}
                  >
                    Auto-scroll {failureStreamAutoScroll ? "on" : "off"}
                  </button>
                </div>
                <div
                  ref={failureStreamRef}
                  className="scillm-flex-col"
                  style={{ overflowY: "auto", minHeight: 0 }}
                >
                  {failureRows.map((row: IncomingCallRow) => {
                    const isSelected = Boolean(selectedLog && selectedLog._key === row.log._key);
                    return (
                      <button
                        key={`failure-${row.key}`}
                        onClick={() => {
                          rowRefs.current.get(row.key)?.scrollIntoView({ block: "center", behavior: "smooth" });
                          onCallClick(row.log);
                        }}
                        className={`scillm-button--failure ${isSelected ? 'scillm-button--failure-selected' : ''}`}
                        style={{
                          borderLeft: `2px solid ${row.outcome.source === "scillm" ? EMBRY.red : EMBRY.amber}`,
                        }}
                      >
                        <div className="scillm-text-11 scillm-mono scillm-text-white">
                          {row.itemLabel}
                        </div>
                        <div className="scillm-text-11" style={{ color: row.outcome.source === "scillm" ? EMBRY.red : EMBRY.amber }}>
                          {row.projectLabel}
                          {row.callCategory ? ` • ${row.callCategory}` : ""}
                          {` • ${row.outcome.label}`}
                        </div>
                        <div className="scillm-line-clamp-2" style={{ fontSize: 9, color: EMBRY.dim }}>
                          {row.outcome.summary}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </aside>
            )}
          </div>
          <ResizeGrip onMouseDown={onResizeStart} />
      </>
      {promptDialog && (
        <PromptDialog
          title={promptDialog.title}
          prompt={promptDialog.prompt}
          onClose={() => setPromptDialog(null)}
        />
      )}
    </section>
  );
}

function OrchestratorStrip({
  batchJobs,
  onInspect,
}: {
  batchJobs: BatchJobState[];
  onInspect: (job: BatchJobState) => void;
}) {
  const visibleJobs = getVisibleOrchestrators(batchJobs);
  if (visibleJobs.length === 0) return null;

  return (
    <section
      className="scillm-panel--sticky"
      style={{ borderBottom: `1px solid ${EMBRY.border}` }}
    >
      <div className="scillm-orchestrator-header">
        <span className="text-balance scillm-meta scillm-uppercase-lg">
          Batch Progress
        </span>
        <span className="scillm-meta">
          Manifest items, LLM calls, stored QRAs, and skips are separate counters. Inspect opens the full diagnostic dossier.
        </span>
      </div>

      {visibleJobs.map((job, index) => {
        const state = job.state;
        const color = getOrchestratorStatusColor(job);
        const rollout = inferTonightRolloutPreview(job);
        const eta = inferEtaPreview(job, rollout);
        const totalJobs = state?.total_jobs ?? state?.processed ?? 0;
        const completedJobs = state?.completed_jobs ?? state?.processed ?? 0;
        const failedJobs = state?.failed_jobs ?? state?.failed ?? 0;
        const skippedJobs = state?.skipped_jobs ?? state?.skipped ?? 0;
        const llmCalls = state?.llm_calls_started;
        const llmCallsLabel = llmCalls == null ? "legacy" : `${llmCalls}`;
        const progressPct = typeof state?.progress_pct === "number"
          ? state.progress_pct
          : totalJobs > 0
            ? Math.round((completedJobs / totalJobs) * 100)
            : 0;
        const statusLabel = getOrchestratorDisplayStatus(job).toUpperCase();
        const statusBorder = failedJobs > 0 || statusLabel === "STALLED" ? EMBRY.red : color;

        return (
          <div
            key={job.name}
            className="scillm-orchestrator-item"
            style={{
              borderTop: index > 0 ? `1px solid ${EMBRY.border}` : "none",
              borderLeft: `3px solid ${statusBorder}`,
            }}
          >
            <div className="scillm-flex-col scillm-gap-8 scillm-min-w-0">
              <div className="scillm-flex-row scillm-gap-8 scillm-min-w-0">
                <div style={glowDot(color)} />
                <div className="scillm-heading scillm-min-w-0">{job.name}</div>
                <div
                  className="scillm-chip--status"
                  style={{
                    border: `1px solid ${color}55`,
                    backgroundColor: `${color}12`,
                    color,
                  }}
                >
                  {statusLabel}
                </div>
                <div className="tabular-nums scillm-mono scillm-text-12 scillm-fw-800" style={{ color, marginLeft: "auto" }}>
                  {progressPct.toFixed(0)}%
                </div>
              </div>
              <div className="scillm-progress-track">
                <div
                  className="scillm-progress-fill"
                  style={{
                    width: `${Math.max(0, Math.min(progressPct, 100))}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
            </div>

            <div className="scillm-flex-row scillm-gap-16 scillm-flex-wrap">
              <StatPill label="Items" value={totalJobs ? `${completedJobs}/${totalJobs}` : `${completedJobs}`} small />
              <StatPill label="Calls" value={llmCallsLabel} small color={EMBRY.blue} />
              <StatPill label="Stored" value={`${state?.stored_qras ?? 0}`} small color={EMBRY.green} />
              <StatPill label="Skipped" value={`${skippedJobs}`} small color={skippedJobs > 0 ? EMBRY.amber : EMBRY.dim} />
              <StatPill label="Fail" value={`${failedJobs}`} small color={failedJobs > 0 ? EMBRY.red : EMBRY.dim} />
              <StatPill label="ETA" value={formatEta(eta.tonightEtaSeconds)} small color={EMBRY.white} />
            </div>

            <div className="scillm-flex-col scillm-gap-4 scillm-min-w-0">
              <div className="scillm-meta">
                {state?.phase || "idle"}
                {state?.chunk_num && state?.total_chunks ? ` · chunk ${state.chunk_num}/${state.total_chunks}` : ""}
                {state?.range_start && state?.range_end ? ` · range ${state.range_start}-${state.range_end}` : ""}
              </div>
              <div className="scillm-meta scillm-ellipsis" style={{ textOverflow: "ellipsis" }}>
                {state?.current_item || state?.last_error || state?.last_message || "No active item"}
              </div>
            </div>

            <button
              data-qid={`scillm:orchestrator:inspect:${job.name}`}
              data-qs-action="SCILLM_INSPECT_JOB"
              title={`Inspect ${job.name}`}
              className="press-scale scillm-focus scillm-button"
              onClick={() => onInspect(job)}
              style={{
                backgroundColor: EMBRY.bgDeep,
                gap: 4,
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: "0.08em",
              }}
            >
              <Eye size={11} />
              Inspect
            </button>
          </div>
        );
      })}
    </section>
  );
}

// Copyable content section with prominent copy button
function CopyableSection({
  title,
  content,
  emptyText = "Not captured",
  icon: Icon,
}: {
  title: string;
  content: string | null | undefined;
  emptyText?: string;
  icon?: React.ComponentType<{ size?: number }>;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (content) {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isEmpty = !content;

  return (
    <div
      className={`scillm-card ${isEmpty ? '' : 'scillm-card--highlight'}`}
      style={{
        marginBottom: 16,
        borderColor: isEmpty ? EMBRY.border : `${EMBRY.blue}40`,
      }}
    >
      <div className="scillm-copyable-header">
        <div className="scillm-copyable-title">
          {Icon && <Icon size={12} />}
          <span
            className="scillm-uppercase-lg"
            style={{ color: isEmpty ? EMBRY.dim : EMBRY.blue }}
          >
            {title}
          </span>
        </div>
        {!isEmpty && (
          <button
            onClick={handleCopy}
            className="scillm-button--copy"
            style={{
              backgroundColor: copied ? `${EMBRY.green}20` : `${EMBRY.blue}20`,
              border: `1px solid ${copied ? EMBRY.green : EMBRY.blue}50`,
              color: copied ? EMBRY.green : EMBRY.blue,
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        )}
      </div>
      <pre
        className={`scillm-pre ${isEmpty ? 'scillm-pre--empty' : ''}`}
        style={{ backgroundColor: EMBRY.bgPanel }}
      >
        {content || emptyText}
      </pre>
    </div>
  );
}

// Trace Panel - shows raw request/response details
function TracePanel({
  log,
  onClose,
}: {
  log: LogEntry;
  onClose: () => void;
}) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisCopied, setAnalysisCopied] = useState(false);
  const outcome = useMemo(() => parseIncomingOutcome(log), [log]);
  const statusColor = outcomeBadgeColor(outcome);
  const statusText = outcome.label;
  const callTimestamp = log.ts ? new Date(log.ts).toLocaleString() : "Unknown time";
  const headerTitle = log.metadata?.item_id ? `Request Inspector: ${log.metadata.item_id}` : "Request Inspector";
  const renderedError = outcome.error || log.error || null;

  const analyzeCall = async () => {
    setAnalyzing(true);
    try {
      const prompt = `You are an LLM proxy debugger. Analyze this API call and provide a concise diagnosis.

## Call Details
- **Status:** ${statusText}
- **Error:** ${renderedError || "None"}
- **Model Requested:** ${log.model_requested}
- **Model Served:** ${log.model_served || "unknown"}
- **Provider:** ${log.provider || "unknown"}
- **Caller:** ${log.caller || "unknown"}
- **Duration:** ${log.duration_ms != null ? `${log.duration_ms}ms` : "unknown"}
- **Tokens:** prompt=${log.prompt_tokens || 0}, completion=${log.completion_tokens || 0}, total=${log.total_tokens || 0}
- **Cost:** ${log.cost_usd != null ? `$${log.cost_usd.toFixed(4)}` : "unknown"}

## Input Prompt
\`\`\`
${log.request_prompt || "(not captured)"}
\`\`\`

## Response
\`\`\`
${log.response_content || "(not captured)"}
\`\`\`

Provide:
1. **Diagnosis:** What happened? (1-2 sentences)
2. **Root Cause:** Why did this happen? (if error or unexpected behavior)
3. **Recommendation:** How to fix or improve (if applicable)
4. **Action for Agent:** A single actionable command or code snippet the calling agent can use

Keep it concise — under 200 words total.`;

      const scillmUrl = import.meta.env.VITE_SCILLM_URL || "http://localhost:4001/v1/chat/completions";
      const scillmToken = import.meta.env.VITE_SCILLM_TOKEN || "";
      const resp = await fetch(scillmUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: scillmToken ? `Bearer ${scillmToken}` : "",
          "X-Caller-Skill": "ux-lab.scillm-debugger",
        },
        body: JSON.stringify({
          model: "text-gemini",
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!resp.ok) {
        throw new Error(`Analysis failed: ${resp.status}`);
      }

      const data = await resp.json();
      setAnalysis(data.choices?.[0]?.message?.content || "No analysis returned");
    } catch (e) {
      setAnalysis(`Analysis error: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const copyAnalysisForAgent = async () => {
    if (!analysis) return;
    const agentReport = `## scillm Call Analysis

**Call ID:** ${log._key}
**Timestamp:** ${log.ts}
**Caller:** ${log.caller || "unknown"}
**Model:** ${log.model_requested} → ${log.model_served || "unknown"}
**Status:** ${statusText}${renderedError ? ` (${renderedError})` : ""}

### LLM Debugger Analysis
${analysis}

---
*Generated by scillm Command Center*`;

    await navigator.clipboard.writeText(agentReport);
    setAnalysisCopied(true);
    setTimeout(() => setAnalysisCopied(false), 2000);
  };

  return (
    <div
      className="scillm-panel-enter elevated-surface scillm-trace-panel"
      style={{ backgroundColor: EMBRY.bgPanel, borderLeft: `1px solid ${EMBRY.border}` }}
    >
      {/* Header */}
      <div className="scillm-trace-header">
          <span className="scillm-text-12 scillm-fw-700 scillm-text-white">
            {headerTitle}
          </span>
        <button
          data-qid="scillm:trace-panel:close"
          data-qs-action="SCILLM_CLOSE_TRACE"
          title="Close trace panel"
          onClick={onClose}
          className="press-scale scillm-focus scillm-button--icon"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="scillm-trace-content">
        {/* Status */}
        <div className="scillm-section">
          <span
            className="scillm-status-badge"
            style={{
              backgroundColor: `${statusColor}20`,
              color: statusColor,
            }}
          >
            {statusText}
          </span>
          <span className="scillm-meta" style={{ marginLeft: 8 }}>
            {callTimestamp}
          </span>
        </div>

        {/* Error message */}
        {renderedError && (
          <div className="scillm-error-box">
            <span className="scillm-uppercase scillm-text-red">
              Error
            </span>
            <div className="scillm-text-11 scillm-text-white scillm-mono" style={{ marginTop: 4 }}>
              {renderedError}
            </div>
          </div>
        )}

        {/* Input Prompt — Prominent section for easy copy to ChatGPT */}
        <CopyableSection
          title="Input Prompt"
          content={log.request_prompt}
          emptyText="Prompt not captured (cache hit or stream)"
        />

        {/* Response — Output from the LLM */}
        <CopyableSection
          title="Response"
          content={log.response_content}
          emptyText="Response not captured (error or stream)"
        />

        {/* LLM Debugger */}
        <div className="scillm-section">
          <div className="scillm-section-title scillm-section-title--between">
            <span>LLM Debugger</span>
            {!analysis && (
              <button
                data-qid="scillm:trace-panel:analyze"
                data-qs-action="SCILLM_ANALYZE_CALL"
                title="Analyze this scillm call with LLM debugger"
                onClick={analyzeCall}
                disabled={analyzing}
                className="press-scale scillm-focus scillm-button--analyze"
                style={{
                  opacity: analyzing ? 0.6 : 1,
                  cursor: analyzing ? "wait" : "pointer",
                }}
              >
                {analyzing ? (
                  <>
                    <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles size={10} />
                    Analyze Call
                  </>
                )}
              </button>
            )}
          </div>

          {analysis ? (
            <div className="scillm-analysis-box">
              <div className="scillm-analysis-text">
                {analysis}
              </div>
              <div className="scillm-flex-row scillm-gap-8">
                <button
                  data-qid="scillm:trace-panel:copy-analysis"
                  data-qs-action="SCILLM_COPY_ANALYSIS"
                  title="Copy analysis report for agent"
                  onClick={copyAnalysisForAgent}
                  className="press-scale scillm-focus scillm-button--send"
                  style={{
                    backgroundColor: analysisCopied ? `${EMBRY.green}20` : `${EMBRY.amber}20`,
                    color: analysisCopied ? EMBRY.green : EMBRY.amber,
                  }}
                >
                  {analysisCopied ? (
                    <>
                      <Check size={12} />
                      Copied
                    </>
                  ) : (
                    <>
                      <Send size={12} />
                      Copy for Agent
                    </>
                  )}
                </button>
                <button
                  data-qid="scillm:trace-panel:clear-analysis"
                  data-qs-action="SCILLM_CLEAR_ANALYSIS"
                  title="Clear analysis result"
                  onClick={() => setAnalysis(null)}
                  className="press-scale scillm-focus scillm-button--send scillm-meta"
                  style={{
                    backgroundColor: `${EMBRY.dim}20`,
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <div className="scillm-meta" style={{ fontStyle: "italic" }}>
              Click "Analyze Call" to get LLM-powered diagnosis
            </div>
          )}
        </div>

        {/* Request Info */}
        <Section title="Request">
          <Field label="Model Requested" value={log.model_requested} />
          <Field label="Model Served" value={log.model_served || "—"} />
          <Field label="Caller" value={log.caller || "unknown"} />
          <Field label="Provider" value={log.provider || "unknown"} />
        </Section>

        {/* Performance */}
        <Section title="Performance">
          <Field label="Duration" value={log.duration_ms != null ? `${log.duration_ms}ms` : "—"} />
          <Field label="Prompt Tokens" value={log.prompt_tokens?.toLocaleString() || "—"} />
          <Field label="Completion Tokens" value={log.completion_tokens?.toLocaleString() || "—"} />
          <Field label="Total Tokens" value={log.total_tokens?.toLocaleString() || "—"} />
        </Section>

        {/* Cost */}
        <Section title="Cost">
          <Field
            label="Estimated Cost"
            value={log.cost_usd != null ? `$${log.cost_usd.toFixed(4)}` : "—"}
            highlight={log.cost_usd != null && log.cost_usd > 0.01}
          />
        </Section>

        {/* Metadata */}
        {log.metadata && (
          <Section title="Metadata">
            {log.metadata.batch_id && <Field label="Batch ID" value={log.metadata.batch_id} />}
            {log.metadata.item_id && <Field label="Item ID" value={log.metadata.item_id} />}
            {deriveCallCategory(log) && <Field label="Call Category" value={deriveCallCategory(log) || "—"} />}
            {log.metadata.prompt_kind && <Field label="Prompt Kind" value={log.metadata.prompt_kind} />}
          </Section>
        )}

        {/* Raw JSON */}
        <Section title="Raw Log Entry">
          <pre
            className="scillm-pre"
            style={{ backgroundColor: EMBRY.bgDeep }}
          >
            {JSON.stringify(log, null, 2)}
          </pre>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="scillm-section">
      <div className="scillm-section-title">
        {title}
      </div>
      <div className="scillm-section-body">
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="scillm-field">
      <span className="scillm-meta">{label}</span>
      <span
        className="scillm-text-10 scillm-mono"
        style={{ color: highlight ? EMBRY.amber : EMBRY.white }}
      >
        {value}
      </span>
    </div>
  );
}

type CallsSubview = "incoming" | "debug";

export function ScillmDashboard() {
  const { logs, error, lastUpdate, refresh } = useScillmData();
  const { auth } = useProviderAuth();
  const { batchJobs } = useBatchJobState();
  const [search, setSearch] = useState("");
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [selectedJob, setSelectedJob] = useState<BatchJobState | null>(null);
  const [callsSubview, setCallsSubview] = useState<CallsSubview>("incoming");
  const [wholeJobHeight, setWholeJobHeight] = useState(360);
  const [activeResize, setActiveResize] = useState<{
    panel: "whole-job";
    startY: number;
    startHeight: number;
  } | null>(null);

  useRegisterAction("scillm:refresh", { app: "ux-lab", action: "SCILLM_REFRESH", label: "Refresh", description: "Refresh scillm monitor data" });
  useRegisterAction("scillm:tab:incoming", { app: "ux-lab", action: "SCILLM_TAB_INCOMING", label: "Tab: Incoming", description: "Switch to incoming calls view" });
  useRegisterAction("scillm:tab:debug", { app: "ux-lab", action: "SCILLM_TAB_DEBUG", label: "Tab: Debug Logs", description: "Switch to debug logs view" });
  useRegisterAction("scillm:search:clear", { app: "ux-lab", action: "SCILLM_CLEAR_SEARCH", label: "Clear Search", description: "Clear scillm search filter" });
  useRegisterAction("scillm:orchestrator:inspect", { app: "ux-lab", action: "SCILLM_INSPECT_JOB", label: "Inspect Job", description: "Inspect batch job details" });

  const activeCreateQrasJob = useMemo(
    () =>
      batchJobs.find((job) => job.name === "create-qras-manifest" && getOrchestratorDisplayStatus(job) === "running") ||
      batchJobs.find((job) => job.name === "create-qras-manifest") ||
      null,
    [batchJobs],
  );
  const { detail: activeCreateQrasDetail } = useOrchestratorDetail(activeCreateQrasJob?.name || null);
  const activeBatchFailCount =
    activeCreateQrasDetail?.state?.failed_jobs ??
    activeCreateQrasJob?.state?.failed_jobs ??
    activeCreateQrasJob?.state?.failed ??
    0;

  useEffect(() => {
    if (!activeResize) return undefined;

    const handleMouseMove = (event: MouseEvent) => {
      const delta = event.clientY - activeResize.startY;
      const nextHeight = Math.max(180, Math.min(720, activeResize.startHeight + delta));
      if (activeResize.panel === "whole-job") setWholeJobHeight(nextHeight);
    };

    const handleMouseUp = () => setActiveResize(null);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [activeResize]);

  const startResize = (panel: "whole-job") => (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setActiveResize({
      panel,
      startY: event.clientY,
      startHeight: wholeJobHeight,
    });
  };

  const jobsTableLogs = useMemo(() => {
    const incomingLogs = (activeCreateQrasDetail?.calls || []).filter(isRenderableLogEntry);
    const sourceLogs = incomingLogs.length > 0 ? incomingLogs : logs.filter(isRenderableLogEntry);
    if (!search.trim()) return sourceLogs;
    const q = search.toLowerCase();
    return sourceLogs.filter(
      (log) =>
        log.model_served?.toLowerCase().includes(q) ||
        log.model_requested?.toLowerCase().includes(q) ||
        log.caller?.toLowerCase().includes(q) ||
        log.provider?.toLowerCase().includes(q) ||
        log.error?.toLowerCase().includes(q) ||
        log.metadata?.item_id?.toLowerCase().includes(q),
    );
  }, [activeCreateQrasDetail?.calls, logs, search]);
  const monitorLogs = useMemo(() => {
    const scoped = jobsTableLogs.filter(isRenderableLogEntry);
    return scoped.length > 0 ? scoped : logs.filter(isRenderableLogEntry);
  }, [jobsTableLogs, logs]);

  // Compute monitor metrics from the visible/live call stream, not the generic global sample.
  const metrics = useMemo(() => {
    const total = monitorLogs.length;
    const outcomes = monitorLogs.map((log) => parseIncomingOutcome(log));
    const errors = outcomes.filter((outcome) => outcome.status !== "ok" && outcome.status !== "skipped").length;
    const errorRate = total > 0 ? errors / total : 0;

    const withLatency = monitorLogs.filter((l) => l.duration_ms != null);
    const avgLatency = withLatency.length > 0
      ? Math.round(withLatency.reduce((sum, l) => sum + (l.duration_ms || 0), 0) / withLatency.length)
      : 0;

    const now = Date.now();
    const recent = monitorLogs.filter((l) => now - new Date(l.ts).getTime() < 10 * 60 * 1000);
    const totalTokens = recent.reduce((sum, l) => sum + (l.total_tokens || 0), 0);
    const throughputValue = totalTokens > 0 ? Math.round(totalTokens / 10) : recent.length * 6;
    const throughputUnit = totalTokens > 0 ? "tpm" : "calls/min";
    const throughputLabel = totalTokens > 0 ? "Throughput" : "Activity";

    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const dailyCost = monitorLogs
      .filter((l) => l.ts >= oneDayAgo)
      .reduce((sum, l) => sum + (l.cost_usd || 0), 0);

    return { total, errors, errorRate, avgLatency, throughputValue, throughputUnit, throughputLabel, dailyCost };
  }, [monitorLogs]);
  const budgetPercent = Math.min((metrics.dailyCost / DAILY_BUDGET_USD) * 100, 100);
  const budgetColor =
    budgetPercent > 90 ? EMBRY.red : budgetPercent > 70 ? EMBRY.amber : EMBRY.green;
  const hasIncomingCallsTable = jobsTableLogs.length > 0;
  const hasOverviewSections = batchJobs.some((job) => job.state) || hasIncomingCallsTable;

  return (
    <div
      className="scillm-dashboard"
    >
      {/* HEALTH RIBBON */}
      <header
        className="elevated-surface scillm-dashboard__header"
      >
        <div className="scillm-flex-row scillm-gap-8">
          <span className="scillm-heading-lg">scillm</span>
          <span className="scillm-heading-md">Monitor</span>
          <div style={glowDot(error ? EMBRY.red : EMBRY.green)} />
          {activeBatchFailCount > 0 && (
            <div className="scillm-fail-badge">
              {activeBatchFailCount} fails
            </div>
          )}
        </div>

        <div
          className="scillm-flex-row scillm-gap-16"
          style={{
            paddingLeft: 16,
            borderLeft: `1px solid ${EMBRY.border}`,
          }}
        >
          <StatPill label={metrics.throughputLabel} value={`${metrics.throughputValue.toLocaleString()} ${metrics.throughputUnit}`} icon={Activity} />
          <StatPill label="Avg Latency" value={`${metrics.avgLatency}ms`} icon={Clock} />
          <StatPill
            label="Error Rate"
            value={`${(metrics.errorRate * 100).toFixed(2)}%`}
            color={metrics.errorRate > ERROR_CRIT ? EMBRY.red : metrics.errorRate > ERROR_WARN ? EMBRY.amber : EMBRY.green}
            icon={AlertTriangle}
          />
        </div>

        <div
          className="scillm-flex-row scillm-gap-16"
          style={{
            paddingLeft: 16,
            borderLeft: `1px solid ${EMBRY.border}`,
          }}
        >
          {metrics.dailyCost > 0 && (
            <StatPill
              label="Spent"
              value={`$${metrics.dailyCost.toFixed(2)} / $${DAILY_BUDGET_USD.toFixed(0)} · ${budgetPercent.toFixed(0)}%`}
              color={budgetColor}
              icon={DollarSign}
              small
              noWrap
            />
          )}
          <StatPill
            label="Calls"
            value={`${metrics.total.toLocaleString()} · ${metrics.errors} err`}
            color={metrics.errors > 0 ? EMBRY.amber : EMBRY.white}
            icon={Zap}
            small
            noWrap
          />
        </div>

        <div style={{ flex: 1 }} />

        <span className="scillm-meta">
          {lastUpdate ? lastUpdate.toLocaleTimeString() : ""}
        </span>
        <button
          data-qid="scillm:action:refresh"
          data-qs-action="SCILLM_REFRESH"
          title="Refresh scillm monitor data"
          onClick={refresh}
          className="press-scale scillm-focus scillm-button--refresh"
        >
          Refresh
        </button>
      </header>

      <main className="scillm-dashboard__main">
        <div className="scillm-dashboard__content">
          <div
            className="scillm-dashboard__subheader"
          >
            <div className="scillm-dashboard__tabs">
              <button
                data-qid="scillm:tab:incoming"
                data-qs-action="SCILLM_TAB_INCOMING"
                title="Switch to incoming calls view"
                onClick={() => setCallsSubview("incoming")}
                className={`press-scale scillm-focus scillm-button--tab ${callsSubview === "incoming" ? 'scillm-button--filter-active' : 'scillm-text-dim'}`}
                style={{
                  backgroundColor: callsSubview === "incoming" ? `${EMBRY.blue}20` : "transparent",
                  borderRight: `1px solid ${EMBRY.border}`,
                }}
              >
                Incoming
              </button>
              <button
                data-qid="scillm:tab:debug"
                data-qs-action="SCILLM_TAB_DEBUG"
                title="Switch to debug logs view"
                onClick={() => setCallsSubview("debug")}
                className={`press-scale scillm-focus scillm-button--tab ${callsSubview === "debug" ? 'scillm-button--filter-active' : 'scillm-text-dim'}`}
                style={{
                  backgroundColor: callsSubview === "debug" ? `${EMBRY.blue}20` : "transparent",
                }}
              >
                Debug Logs
              </button>
            </div>
            <div className="scillm-meta">
              {callsSubview === "incoming"
                ? "Live incoming calls view. Search stays local to the incoming table."
                : "Raw proxy logs and provider state."}
            </div>
            <div style={{ flex: 1 }} />
            {callsSubview === "debug" && (
              <>
                <ProviderAuthStrip auth={auth} />
                <div
                  className="scillm-search-box scillm-search-box--deep"
                  style={{ width: 240, padding: "4px 10px" }}
                >
                  <Search size={12} color={EMBRY.dim} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter logs..."
                    className="scillm-input"
                  />
                  {search && (
                    <button
                      data-qid="scillm:search:clear"
                      data-qs-action="SCILLM_CLEAR_SEARCH"
                      title="Clear search"
                      onClick={() => setSearch("")}
                      className="press-scale scillm-focus scillm-button--icon"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          {callsSubview === "incoming" && hasOverviewSections && (
            <div className="scillm-dashboard__scroll">
              <OrchestratorStrip batchJobs={batchJobs} onInspect={setSelectedJob} />
              {hasIncomingCallsTable && (
                <ActiveCreateQrasTable
                  detail={activeCreateQrasDetail}
                  logs={jobsTableLogs}
                  onCallClick={setSelectedLog}
                  onInspect={() => activeCreateQrasJob && setSelectedJob(activeCreateQrasJob)}
                  selectedLog={selectedLog}
                  tableHeight={wholeJobHeight}
                  onResizeStart={startResize("whole-job")}
                />
              )}
            </div>
          )}
          {callsSubview === "debug" && (
            <section
              className="scillm-dashboard__section"
            >
              <div
                className="scillm-flex-row scillm-gap-12 scillm-flex-between"
                style={{
                  padding: "10px 16px",
                  borderBottom: `1px solid ${EMBRY.border}`
                }}
              >
                <div>
                  <div className="scillm-heading">Raw scillm jobs</div>
                  <div className="scillm-meta">
                    Proxy/debug view. Use this when you need caller-grouped logs instead of manifest intent.
                  </div>
                </div>
                <div className="scillm-meta">
                  {jobsTableLogs.length} call rows in scope
                </div>
              </div>
              <div style={{ flex: "1 1 auto", minHeight: 0 }}>
                <JobsTable logs={jobsTableLogs} onCallClick={setSelectedLog} />
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Trace Panel (slide-out) */}
      {selectedLog && <TracePanel log={selectedLog} onClose={() => setSelectedLog(null)} />}
      {selectedJob && <CreateQrasManifestPane job={selectedJob} onClose={() => setSelectedJob(null)} />}

      {/* CSS Animations */}
      <style>{`
        @keyframes flowMove {
          from { stroke-dashoffset: 12; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.9); }
        }
      `}</style>
    </div>
  );
}
