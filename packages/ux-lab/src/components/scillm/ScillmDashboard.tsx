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
import { useEffect, useMemo, useState } from "react";
import { Search, X, Activity, Clock, AlertTriangle, DollarSign, Copy, Check, Sparkles, Loader2, Send, Terminal, Zap, Eye, ChevronDown, ChevronRight } from "lucide-react";
import { EMBRY, glowDot } from "../common/EmbryStyle";
import { useScillmData, useProviderAuth, useBatchJobState, useOrchestratorDetail, type LogEntry, type AuthStatusResponse, type BatchJobState } from "../../hooks/useScillmData";
import { JobsTable } from "./JobsTable";
import { CodeRunnerSessions } from "./CodeRunnerSessions";
import { CreateQrasManifestPane } from "./CreateQrasManifestPane";

const MONO = '"JetBrains Mono", "SF Mono", monospace';

// Inject spin animation for loader
if (typeof document !== "undefined" && !document.getElementById("scillm-animations")) {
  const style = document.createElement("style");
  style.id = "scillm-animations";
  style.textContent = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
}

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
}: {
  label: string;
  value: string;
  color?: string;
  icon?: React.ComponentType<{ size: number; color: string }>;
  small?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: EMBRY.dim,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {Icon && <Icon size={10} color={EMBRY.dim} />}
        {label}
      </span>
      <span
        style={{
          fontSize: small ? 12 : 16,
          fontWeight: 700,
          fontFamily: MONO,
          color,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// Budget uses StatPill pattern - no extra elements
function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const percent = Math.min((spent / budget) * 100, 100);
  const color = percent > 90 ? EMBRY.red : percent > 70 ? EMBRY.amber : EMBRY.green;

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
        Budget
      </span>
      <span
        style={{
          fontSize: 16,
          fontWeight: 700,
          fontFamily: MONO,
          color,
        }}
      >
        {percent.toFixed(0)}%
        <span style={{ fontSize: 10, color: EMBRY.dim }}> (${budget})</span>
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
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      {providers.map(({ name, data, key }) => {
        if (!data) return null;
        const color = getStatusColor(data.status);
        const expiry = "expires_in_s" in data ? formatExpiry(typeof data.expires_in_s === 'number' ? data.expires_in_s : undefined) : "";

        return (
          <div
            key={key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
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
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: color,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
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

function ResizeGrip({ onMouseDown }: { onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        height: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "ns-resize",
        background: EMBRY.bgPanel,
        borderTop: `1px solid ${EMBRY.border}`,
      }}
      title="Drag to resize"
    >
      <div
        style={{
          width: 56,
          height: 4,
          borderRadius: 999,
          background: EMBRY.border,
        }}
      />
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
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 6px",
    border: `1px solid ${color}55`,
    backgroundColor: `${color}12`,
    color,
    borderRadius: 999,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
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

function ActiveCreateQrasTable({
  detail,
  onCallClick,
  onInspect,
  collapsed,
  onToggleCollapsed,
  tableHeight,
  onResizeStart,
}: {
  detail: any | null;
  onCallClick: (log: LogEntry) => void;
  onInspect: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  tableHeight: number;
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "complete" | "pending" | "transport" | "schema" | "empty" | "skipped">("all");
  const rows = useMemo(() => {
    const manifestJobs = Array.isArray(detail?.manifest?.jobs) ? detail.manifest.jobs : [];
    const calls = Array.isArray(detail?.calls)
      ? detail.calls.filter((call: unknown): call is LogEntry => Boolean(call && typeof call === "object"))
      : [];
    const outcomePriority: Record<OutcomeStatus, number> = {
      ok: 0,
      skipped: 1,
      failed: 2,
      invalid: 3,
      unknown: 4,
      pending: 5,
    };
    const callByItemId = new Map<string, LogEntry>();
    for (const call of calls) {
      const itemId = call.metadata?.item_id;
      if (itemId && !callByItemId.has(itemId)) callByItemId.set(itemId, call);
    }
    return manifestJobs
      .filter((job: unknown): job is Record<string, any> => Boolean(job && typeof job === "object"))
      .map((job: Record<string, any>, index: number): WholeJobRow => {
        const itemId = deriveManifestJobItemId(job);
        const log = callByItemId.get(itemId) || null;
        return {
          key: job.job_id || `${itemId}-${index}`,
          itemId,
          promptKind: job.prompt_kind || job.job_type || "unknown",
          log,
          outcome: parseCallOutcome(log),
          manifestIndex: index,
        };
      })
      .sort((a: WholeJobRow, b: WholeJobRow) => {
        const priorityDiff = (outcomePriority[a.outcome.status] ?? 99) - (outcomePriority[b.outcome.status] ?? 99);
        if (priorityDiff !== 0) return priorityDiff;
        const tsA = a.log?.ts ? Date.parse(a.log.ts) : Number.NaN;
        const tsB = b.log?.ts ? Date.parse(b.log.ts) : Number.NaN;
        if (Number.isFinite(tsA) && Number.isFinite(tsB) && tsA !== tsB) return tsB - tsA;
        return a.manifestIndex - b.manifestIndex;
      });
  }, [detail]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row: WholeJobRow) => {
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
        row.itemId,
        row.promptKind,
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

  if (!detail?.state || rows.length === 0) return null;

  return (
    <section
      style={{
        borderBottom: `1px solid ${EMBRY.border}`,
        padding: "12px 16px 8px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
          <button
            onClick={onToggleCollapsed}
            style={{
              marginTop: 1,
              padding: 2,
              border: "none",
              background: "transparent",
              color: EMBRY.dim,
              cursor: "pointer",
            }}
            title={collapsed ? "Expand Whole job" : "Collapse Whole job"}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: EMBRY.white }}>
              Whole job
            </div>
            <div style={{ fontSize: 10, color: EMBRY.dim }}>Manifest rows sorted with completed responses first.</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
          <div
            style={{
              minWidth: 280,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              background: EMBRY.bgPanel,
              border: `1px solid ${EMBRY.border}`,
            }}
          >
            <Search size={12} color={EMBRY.dim} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search item, prompt, response, scillm error..."
              style={{
                flex: 1,
                background: "none",
                border: "none",
                outline: "none",
                color: EMBRY.white,
                fontSize: 11,
                fontFamily: MONO,
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{ background: "none", border: "none", color: EMBRY.dim, cursor: "pointer", padding: 2 }}
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div style={{ fontSize: 10, color: EMBRY.dim }}>
            {filteredRows.length}/{rows.length} shown
          </div>
          <button
            onClick={onInspect}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "6px 10px",
              border: `1px solid ${EMBRY.border}`,
              background: EMBRY.bgPanel,
              color: EMBRY.white,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Eye size={12} />
            Inspect Manifest
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {[
              { key: "all", label: `All (${rows.length})` },
              { key: "complete", label: `Complete (${rows.filter((row: WholeJobRow) => row.outcome.status === "ok").length})` },
              { key: "pending", label: `Pending (${rows.filter((row: WholeJobRow) => row.outcome.status === "pending").length})` },
              { key: "transport", label: `Transport (${rows.filter((row: WholeJobRow) => row.outcome.label === "Transport").length})` },
              { key: "schema", label: `Schema (${rows.filter((row: WholeJobRow) => row.outcome.label === "Schema").length})` },
              { key: "empty", label: `Empty (${rows.filter((row: WholeJobRow) => row.outcome.label === "Empty").length})` },
              { key: "skipped", label: `Skipped (${rows.filter((row: WholeJobRow) => row.outcome.status === "skipped").length})` },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key as typeof filter)}
                style={{
                  padding: "4px 8px",
                  border: `1px solid ${filter === key ? EMBRY.blue : EMBRY.border}`,
                  backgroundColor: filter === key ? `${EMBRY.blue}20` : EMBRY.bgPanel,
                  color: filter === key ? EMBRY.blue : EMBRY.white,
                  cursor: "pointer",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: EMBRY.dim }}>
            Filters: <span style={{ color: EMBRY.red }}>Transport</span> means the proxy call itself failed. <span style={{ color: EMBRY.amber }}>Schema</span> and <span style={{ color: EMBRY.amber }}>Empty</span> mean scillm returned a payload that did not ground into valid evidence output.
          </div>

          <div style={{ border: `1px solid ${EMBRY.border}`, background: EMBRY.bgPanel, overflow: "auto", height: tableHeight }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.35fr 0.9fr 88px 0.8fr minmax(360px, 3.4fr)",
              gap: 8,
              padding: "8px 10px",
                borderBottom: `1px solid ${EMBRY.border}`,
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: EMBRY.dim,
                position: "sticky",
                top: 0,
                background: EMBRY.bgPanel,
                zIndex: 1,
              }}
            >
              <div>Item</div>
              <div>Prompt</div>
              <div>Duration</div>
              <div>Model</div>
              <div>Response / Error</div>
            </div>
            {filteredRows.map((row: WholeJobRow) => (
              <button
                key={row.key}
                onClick={() => row.log && onCallClick(row.log)}
                disabled={!row.log}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.35fr 0.9fr 88px 0.8fr minmax(360px, 3.4fr)",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 10px",
                  border: "none",
                  borderBottom: `1px solid ${EMBRY.border}`,
                  background: "transparent",
                  color: EMBRY.white,
                  cursor: row.log ? "pointer" : "default",
                  fontSize: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, fontFamily: MONO }}>
                  <div
                    title={`${row.outcome.label}: ${row.outcome.summary}`}
                    style={{
                      ...outcomeChipStyle(row.outcome),
                      width: 28,
                      height: 28,
                      padding: 0,
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {renderOutcomeIcon(row.outcome)}
                  </div>
                  <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.itemId}
                  </div>
                </div>
                <div style={{ color: EMBRY.dim }}>{row.promptKind}</div>
                <div style={{ fontFamily: MONO }}>{row.log?.duration_ms != null ? `${row.log.duration_ms}ms` : "—"}</div>
                <div style={{ fontSize: 9, color: EMBRY.dim }}>{row.log?.model_served || row.log?.model_requested || "—"}</div>
                <div
                  style={{
                    color: row.outcome.error ? EMBRY.red : EMBRY.white,
                    whiteSpace: "normal",
                    wordBreak: "break-word",
                    lineHeight: 1.35,
                  }}
                >
                  {row.outcome.summary}
                </div>
              </button>
            ))}
            {filteredRows.length === 0 && (
              <div style={{ padding: 16, fontSize: 11, color: EMBRY.dim }}>
                No manifest rows match the current Whole job search.
              </div>
            )}
          </div>
          <ResizeGrip onMouseDown={onResizeStart} />
        </>
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
      style={{
        borderBottom: `1px solid ${EMBRY.border}`,
        backgroundColor: EMBRY.bgPanel,
        position: "sticky",
        top: 0,
        zIndex: 3,
      }}
    >
      <div
        style={{
          padding: "8px 16px",
        display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: `1px solid ${EMBRY.border}`,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: EMBRY.dim }}>
          Batch Progress
        </span>
        <span style={{ fontSize: 10, color: EMBRY.dim }}>
          Manifest-level ribbon. Inspect opens the full diagnostic dossier.
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
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(260px, 1.2fr) minmax(320px, 1fr) minmax(220px, 0.8fr) auto",
              gap: 16,
              alignItems: "center",
              padding: "10px 16px",
              borderTop: index > 0 ? `1px solid ${EMBRY.border}` : "none",
              borderLeft: `3px solid ${statusBorder}`,
              backgroundColor: EMBRY.bgPanel,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <div style={glowDot(color)} />
                <div style={{ fontSize: 12, fontWeight: 800, color: EMBRY.white, minWidth: 0 }}>{job.name}</div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: `1px solid ${color}55`,
                    backgroundColor: `${color}12`,
                    color,
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  {statusLabel}
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, color, fontFamily: MONO, marginLeft: "auto" }}>
                  {progressPct.toFixed(0)}%
                </div>
              </div>
              <div style={{ height: 6, backgroundColor: EMBRY.bg, border: `1px solid ${EMBRY.border}`, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.max(0, Math.min(progressPct, 100))}%`,
                    height: "100%",
                    backgroundColor: color,
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <StatPill label="Jobs" value={totalJobs ? `${completedJobs}/${totalJobs}` : `${completedJobs}`} small />
              <StatPill label="Stored" value={`${state?.stored_qras ?? 0}`} small color={EMBRY.green} />
              <StatPill label="Fail" value={`${failedJobs}`} small color={failedJobs > 0 ? EMBRY.red : EMBRY.dim} />
              <StatPill label="ETA" value={formatEta(eta.tonightEtaSeconds)} small color={EMBRY.white} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: EMBRY.dim }}>
                {state?.phase || "idle"}
                {state?.chunk_num && state?.total_chunks ? ` · chunk ${state.chunk_num}/${state.total_chunks}` : ""}
                {state?.range_start && state?.range_end ? ` · range ${state.range_start}-${state.range_end}` : ""}
              </div>
              <div style={{ fontSize: 10, color: EMBRY.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {state?.current_item || state?.last_error || state?.last_message || "No active item"}
              </div>
            </div>

            <button
              data-qid={`scillm:orchestrator:inspect:${job.name}`}
              title={`Inspect ${job.name}`}
              onClick={() => onInspect(job)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 10px",
                border: `1px solid ${EMBRY.border}`,
                backgroundColor: EMBRY.bgDeep,
                color: EMBRY.white,
                cursor: "pointer",
                fontSize: 9,
                fontWeight: 800,
                textTransform: "uppercase",
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
      style={{
        marginBottom: 16,
        padding: 12,
        backgroundColor: EMBRY.bgDeep,
        border: `1px solid ${isEmpty ? EMBRY.border : EMBRY.blue}40`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {Icon && <Icon size={12} />}
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: isEmpty ? EMBRY.dim : EMBRY.blue,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            {title}
          </span>
        </div>
        {!isEmpty && (
          <button
            onClick={handleCopy}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              backgroundColor: copied ? `${EMBRY.green}20` : `${EMBRY.blue}20`,
              border: `1px solid ${copied ? EMBRY.green : EMBRY.blue}50`,
              color: copied ? EMBRY.green : EMBRY.blue,
              cursor: "pointer",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        )}
      </div>
      <pre
        style={{
          fontSize: 11,
          fontFamily: MONO,
          color: isEmpty ? EMBRY.dim : EMBRY.white,
          backgroundColor: EMBRY.bgPanel,
          padding: 10,
          margin: 0,
          overflow: "auto",
          maxHeight: 200,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontStyle: isEmpty ? "italic" : "normal",
        }}
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

  const analyzeCall = async () => {
    setAnalyzing(true);
    try {
      const prompt = `You are an LLM proxy debugger. Analyze this API call and provide a concise diagnosis.

## Call Details
- **Status:** ${log.status}
- **Error:** ${log.error || "None"}
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

      const resp = await fetch("http://localhost:4001/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-dev-proxy-123",
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
**Status:** ${log.status}${log.error ? ` (${log.error})` : ""}

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
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: 420,
        height: "100%",
        backgroundColor: EMBRY.bgPanel,
        borderLeft: `1px solid ${EMBRY.border}`,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        boxShadow: "-4px 0 20px rgba(0,0,0,0.5)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${EMBRY.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: EMBRY.white }}>
          Call Trace
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: EMBRY.dim,
            cursor: "pointer",
            padding: 4,
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {/* Status */}
        <div style={{ marginBottom: 16 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "4px 8px",
              backgroundColor: log.status === "error" ? `${EMBRY.red}20` : `${EMBRY.green}20`,
              color: log.status === "error" ? EMBRY.red : EMBRY.green,
              textTransform: "uppercase",
            }}
          >
            {log.status}
          </span>
          <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 8 }}>
            {new Date(log.ts).toLocaleString()}
          </span>
        </div>

        {/* Error message */}
        {log.error && (
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              backgroundColor: `${EMBRY.red}10`,
              border: `1px solid ${EMBRY.red}30`,
            }}
          >
            <span style={{ fontSize: 9, fontWeight: 700, color: EMBRY.red, textTransform: "uppercase" }}>
              Error
            </span>
            <div style={{ fontSize: 11, color: EMBRY.white, marginTop: 4, fontFamily: MONO }}>
              {log.error}
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
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: EMBRY.dim,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 8,
              paddingBottom: 4,
              borderBottom: `1px solid ${EMBRY.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>LLM Debugger</span>
            {!analysis && (
              <button
                onClick={analyzeCall}
                disabled={analyzing}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 8px",
                  fontSize: 9,
                  fontWeight: 700,
                  border: "none",
                  backgroundColor: `${EMBRY.blue}20`,
                  color: EMBRY.blue,
                  cursor: analyzing ? "wait" : "pointer",
                  opacity: analyzing ? 0.6 : 1,
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
            <div
              style={{
                backgroundColor: EMBRY.bgDeep,
                border: `1px solid ${EMBRY.green}40`,
                padding: 12,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: EMBRY.white,
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.5,
                  marginBottom: 12,
                }}
              >
                {analysis}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={copyAnalysisForAgent}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "6px 12px",
                    fontSize: 10,
                    fontWeight: 700,
                    border: "none",
                    backgroundColor: analysisCopied ? `${EMBRY.green}20` : `${EMBRY.amber}20`,
                    color: analysisCopied ? EMBRY.green : EMBRY.amber,
                    cursor: "pointer",
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
                  onClick={() => setAnalysis(null)}
                  style={{
                    padding: "6px 12px",
                    fontSize: 10,
                    fontWeight: 700,
                    border: "none",
                    backgroundColor: `${EMBRY.dim}20`,
                    color: EMBRY.dim,
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: EMBRY.dim, fontStyle: "italic" }}>
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
          </Section>
        )}

        {/* Raw JSON */}
        <Section title="Raw Log Entry">
          <pre
            style={{
              fontSize: 10,
              fontFamily: MONO,
              color: EMBRY.dim,
              backgroundColor: EMBRY.bgDeep,
              padding: 12,
              overflow: "auto",
              maxHeight: 200,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
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
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: EMBRY.dim,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginBottom: 8,
          paddingBottom: 4,
          borderBottom: `1px solid ${EMBRY.border}`,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ fontSize: 10, color: EMBRY.dim }}>{label}</span>
      <span
        style={{
          fontSize: 10,
          fontFamily: MONO,
          color: highlight ? EMBRY.amber : EMBRY.white,
        }}
      >
        {value}
      </span>
    </div>
  );
}

type ViewMode = "calls" | "code-runner";
type CallsSubview = "manifest" | "debug";

export function ScillmDashboard() {
  const { logs, error, lastUpdate, refresh } = useScillmData();
  const { auth } = useProviderAuth();
  const { batchJobs } = useBatchJobState();
  const [search, setSearch] = useState("");
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [selectedJob, setSelectedJob] = useState<BatchJobState | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("calls");
  const [callsSubview, setCallsSubview] = useState<CallsSubview>("manifest");
  const [wholeJobCollapsed, setWholeJobCollapsed] = useState(false);
  const [wholeJobHeight, setWholeJobHeight] = useState(360);
  const [activeResize, setActiveResize] = useState<{
    panel: "whole-job";
    startY: number;
    startHeight: number;
  } | null>(null);
  const activeCreateQrasJob = useMemo(
    () =>
      batchJobs.find((job) => job.name === "create-qras-manifest" && getOrchestratorDisplayStatus(job) === "running") ||
      batchJobs.find((job) => job.name === "create-qras-manifest") ||
      null,
    [batchJobs],
  );
  const { detail: activeCreateQrasDetail } = useOrchestratorDetail(activeCreateQrasJob?.name || null);
  const hasActiveCreateQrasTable = Boolean(
    activeCreateQrasDetail?.state &&
      Array.isArray(activeCreateQrasDetail?.manifest?.jobs) &&
      activeCreateQrasDetail.manifest.jobs.length > 0,
  );
  const hasOverviewSections = batchJobs.some((job) => job.state) || hasActiveCreateQrasTable;

  // Compute metrics including daily cost
  const metrics = useMemo(() => {
    const total = logs.length;
    const errors = logs.filter((l) => l.status === "error").length;
    const errorRate = total > 0 ? errors / total : 0;

    const withLatency = logs.filter((l) => l.duration_ms != null);
    const avgLatency = withLatency.length > 0
      ? Math.round(withLatency.reduce((sum, l) => sum + (l.duration_ms || 0), 0) / withLatency.length)
      : 0;

    const now = Date.now();
    const recent = logs.filter((l) => now - new Date(l.ts).getTime() < 10 * 60 * 1000);
    const totalTokens = recent.reduce((sum, l) => sum + (l.total_tokens || 0), 0);
    const tpm = Math.round(totalTokens / 10);

    // Daily cost (last 24 hours)
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const dailyCost = logs
      .filter((l) => l.ts >= oneDayAgo)
      .reduce((sum, l) => sum + (l.cost_usd || 0), 0);

    return { total, errors, errorRate, avgLatency, tpm, dailyCost };
  }, [logs]);

  // Filtered logs by search text
  const filteredLogs = useMemo(() => {
    if (!search.trim()) return logs;
    const q = search.toLowerCase();
    return logs.filter(
      (l) =>
        l.model_served?.toLowerCase().includes(q) ||
        l.model_requested?.toLowerCase().includes(q) ||
        l.caller?.toLowerCase().includes(q) ||
        l.provider?.toLowerCase().includes(q) ||
        l.error?.toLowerCase().includes(q)
    );
  }, [logs, search]);

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
    if (filteredLogs.length > 0) return filteredLogs;
    const fallbackLogs = (activeCreateQrasDetail?.calls || []).filter(isRenderableLogEntry);
    if (!search.trim()) return fallbackLogs;
    const q = search.toLowerCase();
    return fallbackLogs.filter(
      (log) =>
        log.model_served?.toLowerCase().includes(q) ||
        log.model_requested?.toLowerCase().includes(q) ||
        log.caller?.toLowerCase().includes(q) ||
        log.provider?.toLowerCase().includes(q) ||
        log.error?.toLowerCase().includes(q) ||
        log.metadata?.item_id?.toLowerCase().includes(q),
    );
  }, [activeCreateQrasDetail?.calls, filteredLogs, search]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        gridTemplateRows: "56px 1fr",
        overflow: "hidden",
        backgroundColor: EMBRY.bg,
      }}
    >
      {/* HEALTH RIBBON */}
      <header
        style={{
          backgroundColor: EMBRY.bgPanel,
          borderBottom: `1px solid ${EMBRY.border}`,
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          gap: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 900, color: EMBRY.blue }}>scillm</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: EMBRY.white }}>Monitor</span>
          <div style={glowDot(error ? EMBRY.red : EMBRY.green)} />
        </div>

        <StatPill label="Throughput" value={`${metrics.tpm.toLocaleString()} tpm`} icon={Activity} />
        <StatPill label="Avg Latency" value={`${metrics.avgLatency}ms`} icon={Clock} />
        <StatPill
          label="Error Rate"
          value={`${(metrics.errorRate * 100).toFixed(2)}%`}
          color={metrics.errorRate > ERROR_CRIT ? EMBRY.red : metrics.errorRate > ERROR_WARN ? EMBRY.amber : EMBRY.green}
          icon={AlertTriangle}
        />
        <StatPill
          label="Daily Cost"
          value={`$${metrics.dailyCost.toFixed(2)}`}
          color={metrics.dailyCost > DAILY_BUDGET_USD * 0.9 ? EMBRY.red : metrics.dailyCost > DAILY_BUDGET_USD * 0.7 ? EMBRY.amber : EMBRY.green}
          icon={DollarSign}
        />

        <BudgetBar spent={metrics.dailyCost} budget={DAILY_BUDGET_USD} />

        {/* Provider auth status */}
        <ProviderAuthStrip auth={auth} />

        {/* View Toggle */}
        <div
          style={{
            display: "flex",
            gap: 0,
            backgroundColor: EMBRY.bgDeep,
            border: `1px solid ${EMBRY.border}`,
          }}
        >
          <button
            onClick={() => setViewMode("calls")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 12px",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              border: "none",
              backgroundColor: viewMode === "calls" ? `${EMBRY.blue}30` : "transparent",
              color: viewMode === "calls" ? EMBRY.blue : EMBRY.dim,
              cursor: "pointer",
              borderRight: `1px solid ${EMBRY.border}`,
            }}
          >
            <Zap size={12} />
            Calls
          </button>
          <button
            onClick={() => setViewMode("code-runner")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 12px",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              border: "none",
              backgroundColor: viewMode === "code-runner" ? `${EMBRY.blue}30` : "transparent",
              color: viewMode === "code-runner" ? EMBRY.blue : EMBRY.dim,
              cursor: "pointer",
            }}
          >
            <Terminal size={12} />
            Code Runner
          </button>
        </div>

        {viewMode === "calls" && (
          <div
            style={{
              display: "flex",
              gap: 0,
              backgroundColor: EMBRY.bgDeep,
              border: `1px solid ${EMBRY.border}`,
            }}
          >
            <button
              onClick={() => setCallsSubview("manifest")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 12px",
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                border: "none",
                backgroundColor: callsSubview === "manifest" ? `${EMBRY.blue}20` : "transparent",
                color: callsSubview === "manifest" ? EMBRY.blue : EMBRY.dim,
                cursor: "pointer",
                borderRight: `1px solid ${EMBRY.border}`,
              }}
            >
              Manifest
            </button>
            <button
              onClick={() => setCallsSubview("debug")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 12px",
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                border: "none",
                backgroundColor: callsSubview === "debug" ? `${EMBRY.blue}20` : "transparent",
                color: callsSubview === "debug" ? EMBRY.blue : EMBRY.dim,
                cursor: "pointer",
              }}
            >
              Debug Logs
            </button>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Search */}
        <div
          style={{
            width: 200,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            background: EMBRY.bgDeep,
            border: `1px solid ${EMBRY.border}`,
          }}
        >
          <Search size={12} color={EMBRY.dim} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter logs..."
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: EMBRY.white,
              fontSize: 11,
              fontFamily: MONO,
            }}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              style={{ background: "none", border: "none", color: EMBRY.dim, cursor: "pointer", padding: 2 }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        <span style={{ fontSize: 10, color: EMBRY.dim }}>
          {lastUpdate ? lastUpdate.toLocaleTimeString() : ""}
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
      </header>

      {/* MAIN: Conditional view based on toggle */}
      <main style={{ overflow: "hidden", backgroundColor: EMBRY.bg, minHeight: 0 }}>
        {viewMode === "calls" ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              overflow: "hidden",
              minHeight: 0,
            }}
          >
            {callsSubview === "manifest" && hasOverviewSections && (
              <div
                style={{
                  flex: "1 1 auto",
                  minHeight: 0,
                  overflowY: "auto",
                  overflowX: "hidden",
                }}
              >
                <OrchestratorStrip batchJobs={batchJobs} onInspect={setSelectedJob} />
                {hasActiveCreateQrasTable && (
                  <ActiveCreateQrasTable
                    detail={activeCreateQrasDetail}
                    onCallClick={setSelectedLog}
                    onInspect={() => activeCreateQrasJob && setSelectedJob(activeCreateQrasJob)}
                    collapsed={wholeJobCollapsed}
                    onToggleCollapsed={() => setWholeJobCollapsed((prev) => !prev)}
                    tableHeight={wholeJobHeight}
                    onResizeStart={startResize("whole-job")}
                  />
                )}
              </div>
            )}
            {callsSubview === "debug" && (
              <section
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: "1 1 auto",
                  minHeight: 0,
                  borderTop: `1px solid ${EMBRY.border}`,
                  backgroundColor: EMBRY.bgPanel,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 16px",
                    borderBottom: `1px solid ${EMBRY.border}`,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: EMBRY.white }}>Raw scillm jobs</div>
                    <div style={{ fontSize: 10, color: EMBRY.dim }}>
                      Proxy/debug view. Use this when you need caller-grouped logs instead of manifest intent.
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: EMBRY.dim }}>
                    {jobsTableLogs.length} call rows in scope
                  </div>
                </div>
                <div style={{ flex: "1 1 auto", minHeight: 0 }}>
                  <JobsTable logs={jobsTableLogs} onCallClick={setSelectedLog} />
                </div>
              </section>
            )}
          </div>
        ) : (
          <CodeRunnerSessions />
        )}
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
