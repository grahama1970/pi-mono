/**
 * JobsTable — Hierarchical Jobs → Calls table (GitHub Actions pattern)
 *
 * Jobs are grouped by caller + batch_id. Click to expand and see individual calls.
 * This replaces both the Callers sidebar AND the flat log table.
 */
import React, { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, Copy, Check, AlertTriangle, Search } from "lucide-react";
import { EMBRY } from "../common/EmbryStyle";
import { useRegisterAction } from "../../hooks/useRegisterAction";
import type { LogEntry } from "../../hooks/useScillmData";

const MONO = '"JetBrains Mono", "SF Mono", monospace';

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: EMBRY.dim,
};

const META_STYLE: React.CSSProperties = {
  fontSize: 10,
  color: EMBRY.dim,
};

const WHITE_HEADING_STYLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: EMBRY.white,
};

const FLEX_COL_GAP4: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const FLEX_COL_GAP8: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const FLEX_ROW_CENTER_GAP8: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const FLEX_ROW_CENTER_GAP12: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const TABLE_BORDER_BOTTOM: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: `1px solid ${EMBRY.border}`,
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: EMBRY.dim,
};

const LINE_CLAMP2: React.CSSProperties = {
  overflow: "hidden",
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  wordBreak: "break-word",
  lineHeight: 1.35,
};

const BUTTON_BASE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  cursor: "pointer",
};


// Spinner animation for in-progress items
const spinnerKeyframes = `
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`;
if (typeof document !== "undefined" && !document.getElementById("jobs-table-styles")) {
  const style = document.createElement("style");
  style.id = "jobs-table-styles";
  style.textContent = spinnerKeyframes;
  document.head.appendChild(style);
}

// Health evaluation beyond transport-level success
type CallHealth = {
  level: "ok" | "warning" | "error";
  reason: string;
  detail?: string;
};

// Expected model alias mappings (requested → served patterns)
const EXPECTED_ALIASES: Record<string, RegExp[]> = {
  "text": [/deepseek/i, /chutes/i, /gemini/i, /qwen/i],
  "text-research": [/deepseek/i, /chutes/i],
  "text-gemini": [/gemini/i],
  "text-gemini-3": [/gemini/i],
  "text-deepseek": [/deepseek/i],
  "vlm": [/gemini/i, /claude/i, /gpt/i, /codex/i],
  "vlm-claude": [/claude/i],
  "vlm-codex": [/gpt/i, /codex/i],
  "local-text": [/qwen/i, /ollama/i],
};

function formatCallCategory(category: string): string {
  return category
    .replace(/^sparta_/, "SPARTA ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function deriveLegacyCreateQrasCategory(call: LogEntry): string | null {
  const itemId = call.metadata?.item_id || "";
  const batchId = call.metadata?.batch_id || "";
  if (itemId.includes("->")) {
    const [sourceId, targetId] = itemId.split("->");
    if (sourceId.startsWith("DE-") && targetId.startsWith("CM")) return "SPARTA Technique Countermeasure Relationship";
    if (sourceId.startsWith("DE-") && targetId.startsWith("ST")) return "SPARTA Tactic Technique Relationship";
    if (batchId.includes("relationship")) return "SPARTA Relationship";
  }
  if (itemId.startsWith("DE-")) return "SPARTA Technique Canonical";
  if (itemId.startsWith("CM")) return "SPARTA Countermeasure Canonical";
  if (itemId.startsWith("ST")) return "SPARTA Tactic Canonical";
  if (batchId.includes("canonical")) return "SPARTA Canonical";
  if (batchId.includes("relationship")) return "SPARTA Relationship";
  return null;
}

function deriveCallCategory(call: LogEntry): string | null {
  const explicit = call.metadata?.call_category || call.metadata?.prompt_kind;
  if (explicit) return formatCallCategory(explicit);
  if (call.caller === "create-qras") return deriveLegacyCreateQrasCategory(call);
  return null;
}

function getCallHealth(call: LogEntry): CallHealth {
  // 1. Transport error - most severe
  if (call.status === "error") {
    return { level: "error", reason: "ERROR", detail: call.error || "Transport failure" };
  }

  // 2. Empty response (no completion tokens at all)
  if (call.total_tokens === 0 || call.completion_tokens === 0) {
    return { level: "warning", reason: "EMPTY", detail: "No completion tokens returned" };
  }

  // 3. Unexpected model routing (not a known alias)
  const requested = call.model_requested?.toLowerCase() || "";
  const served = call.model_served?.toLowerCase() || "";

  if (requested && served && requested !== served) {
    // Check if this is an expected alias
    const expectedPatterns = EXPECTED_ALIASES[requested];
    if (expectedPatterns) {
      const isExpected = expectedPatterns.some(pattern => pattern.test(served));
      if (!isExpected) {
        return {
          level: "warning",
          reason: "FALLBACK",
          detail: `Requested ${call.model_requested}, got ${call.model_served}`
        };
      }
    } else if (!served.includes(requested.replace("text-", "").replace("vlm-", ""))) {
      // Unknown alias - check if served contains any part of requested
      return {
        level: "warning",
        reason: "ROUTED",
        detail: `${call.model_requested} → ${call.model_served}`
      };
    }
  }

  // 4. All checks passed
  return { level: "ok", reason: "OK", detail: undefined };
}

export interface Chunk {
  index: number;
  total: number;
  calls: LogEntry[];
  completedCalls: number;
  errors: number;
  status: "running" | "completed" | "failed";
  totalDurationMs: number;
}

export interface Job {
  id: string;
  caller: string;
  batchId: string | null;
  calls: LogEntry[];
  chunks: Chunk[];  // Grouped by chunk_index
  ungroupedCalls: LogEntry[];  // Calls without chunk metadata (legacy)
  hasChunks: boolean;  // True if any calls have chunk_index metadata
  totalCalls: number;
  expectedTotal: number | null;  // From scillm_metadata.expected_total
  chunkTotal: number | null;  // From scillm_metadata.chunk_total
  completedCalls: number;
  errors: number;
  warnings: number;
  totalCost: number;
  avgLatency: number;
  status: "running" | "completed" | "failed";
  lastActivity: string;
  firstError: string | null;
  firstWarning: string | null;
}

interface Props {
  logs: LogEntry[];
  onCallClick?: (call: LogEntry) => void;
}

type SortKey = "caller" | "progress" | "status" | "latency" | "cost" | "activity";
type SortDirection = "asc" | "desc";

// Group calls into chunks
function groupCallsIntoChunks(calls: LogEntry[]): Chunk[] {
  const chunkMap = new Map<number, LogEntry[]>();

  for (const call of calls) {
    // Only group calls that have actual chunk metadata (skip null/undefined)
    const chunkIdx = call.metadata?.chunk_index;
    if (typeof chunkIdx !== "number") continue;  // Skip calls without chunk data
    if (!chunkMap.has(chunkIdx)) chunkMap.set(chunkIdx, []);
    chunkMap.get(chunkIdx)!.push(call);
  }

  const chunks: Chunk[] = [];
  for (const [index, chunkCalls] of chunkMap) {
    // Sort by item_index_in_chunk if available, otherwise by timestamp
    chunkCalls.sort((a, b) => {
      const aIdx = a.metadata?.item_index_in_chunk || 0;
      const bIdx = b.metadata?.item_index_in_chunk || 0;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return (a.ts || "").localeCompare(b.ts || "");
    });

    const healthResults = chunkCalls.map(c => getCallHealth(c));
    const errors = healthResults.filter(h => h.level === "error").length;
    const completed = healthResults.filter(h => h.level === "ok").length;
    const total = chunkCalls[0]?.metadata?.chunk_total || chunkMap.size;

    let status: Chunk["status"] = "completed";
    if (errors === chunkCalls.length) status = "failed";
    else if (errors > 0) status = "failed";
    else if (completed < chunkCalls.length) status = "running";

    const totalDurationMs = chunkCalls.reduce((sum, c) => sum + (c.duration_ms || 0), 0);

    chunks.push({
      index,
      total,
      calls: chunkCalls,
      completedCalls: completed,
      errors,
      status,
      totalDurationMs,
    });
  }

  // Sort by chunk index
  chunks.sort((a, b) => a.index - b.index);
  return chunks;
}

// Group logs into Jobs by caller + batch_id
function groupLogsIntoJobs(logs: LogEntry[]): Job[] {
  const jobMap = new Map<string, LogEntry[]>();

  for (const log of logs) {
    // Key: caller + batch_id (or just caller if no batch)
    const batchId = log.metadata?.batch_id || null;
    const key = batchId ? `${log.caller}::${batchId}` : `${log.caller}::_single_`;

    if (!jobMap.has(key)) jobMap.set(key, []);
    jobMap.get(key)!.push(log);
  }

  const jobs: Job[] = [];
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  for (const [key, calls] of jobMap) {
    const [caller, batchPart] = key.split("::");
    const batchId = batchPart === "_single_" ? null : batchPart;

    // Sort calls by timestamp descending
    calls.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));

    // Group into chunks if chunk metadata exists (must be a real number, not null/undefined)
    const hasChunks = calls.some(c => typeof c.metadata?.chunk_index === "number");
    const chunks = hasChunks ? groupCallsIntoChunks(calls) : [];
    const ungroupedCalls = calls.filter(c => typeof c.metadata?.chunk_index !== "number");

    // Evaluate health for each call
    const healthResults = calls.map(c => getCallHealth(c));
    const errors = healthResults.filter(h => h.level === "error").length;
    const warnings = healthResults.filter(h => h.level === "warning").length;
    const completed = healthResults.filter(h => h.level === "ok").length;

    const lastActivity = calls[0]?.ts || "";
    const isRecent = lastActivity >= fiveMinutesAgo;

    // Extract expected_total and chunk_total from metadata
    const expectedTotal = calls.find(c => c.metadata?.expected_total)?.metadata?.expected_total || null;
    const chunkTotal = calls.find(c => c.metadata?.chunk_total)?.metadata?.chunk_total || null;

    // Determine status - use expectedTotal if available for accurate progress
    const targetTotal = expectedTotal || calls.length;
    let status: Job["status"] = "completed";
    if (errors === calls.length) status = "failed";
    else if (calls.length < targetTotal) status = "running";  // Not yet complete
    else if (isRecent && completed < calls.length) status = "running";
    else if (errors > 0) status = "failed";

    // Calculate avg latency (only for successful calls with latency)
    const withLatency = calls.filter(c => c.duration_ms != null && c.status === "ok");
    const avgLatency = withLatency.length > 0
      ? Math.round(withLatency.reduce((sum, c) => sum + (c.duration_ms || 0), 0) / withLatency.length)
      : 0;

    // Total cost
    const totalCost = calls.reduce((sum, c) => sum + (c.cost_usd || 0), 0);

    // First error and warning messages
    const firstErrorIdx = healthResults.findIndex(h => h.level === "error");
    const firstWarningIdx = healthResults.findIndex(h => h.level === "warning");
    const firstError = firstErrorIdx >= 0 ? healthResults[firstErrorIdx].detail || null : null;
    const firstWarning = firstWarningIdx >= 0 ? healthResults[firstWarningIdx].detail || null : null;

    jobs.push({
      id: key,
      caller: caller || "unknown",
      batchId,
      calls,
      chunks,
      ungroupedCalls,
      hasChunks,
      totalCalls: calls.length,
      expectedTotal,
      chunkTotal,
      completedCalls: completed,
      errors,
      warnings,
      totalCost,
      avgLatency,
      status,
      lastActivity,
      firstError,
      firstWarning,
    });
  }

  // Sort: running first, then by last activity
  jobs.sort((a, b) => {
    const statusOrder = { running: 0, failed: 1, completed: 2 };
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    return (b.lastActivity || "").localeCompare(a.lastActivity || "");
  });

  return jobs;
}

function StatusPill({ status }: { status: Job["status"] }) {
  // GitHub Actions style: amber spinner for running, green check for done, red X for failed
  if (status === "running") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid #d29922", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        <span style={{ fontSize: 10, color: "#d29922", fontWeight: 600 }}>In progress</span>
      </span>
    );
  }
  const config = {
    completed: { icon: "✓", color: "#3fb950", label: "Success" },
    failed: { icon: "✗", color: "#ff7b72", label: "Failed" },
  }[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ color: config.color, fontWeight: 700 }}>{config.icon}</span>
      <span style={{ fontSize: 10, color: config.color, fontWeight: 600 }}>{config.label}</span>
    </span>
  );
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div style={{ ...FLEX_ROW_CENTER_GAP8 }}>
      <div
        style={{
          width: 80,
          height: 6,
          backgroundColor: EMBRY.bgDeep,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            backgroundColor: EMBRY.green,
            transition: "width 0.6s cubic-bezier(0.2, 0, 0, 1)",
          }}
        />
      </div>
      <span className="tabular-nums" style={{ ...META_STYLE, fontFamily: MONO }}>
        {completed}/{total}
      </span>
    </div>
  );
}

function summarizeCallResponse(call: LogEntry): string {
  if (call.error) return call.error;
  const raw = call.response_content?.trim();
  if (!raw) return "No response content captured";

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.skipped_reason === "string" && parsed.skipped_reason) return parsed.skipped_reason;
    if (Array.isArray(parsed?.pairs) && parsed.pairs.length > 0) {
      const firstPair = parsed.pairs[0];
      if (typeof firstPair?.answer === "string" && firstPair.answer) return firstPair.answer;
      if (typeof firstPair?.reasoning === "string" && firstPair.reasoning) return firstPair.reasoning;
      if (typeof firstPair?.question === "string" && firstPair.question) return firstPair.question;
    }
    if (typeof parsed?.answer === "string" && parsed.answer) return parsed.answer;
    if (typeof parsed?.reasoning === "string" && parsed.reasoning) return parsed.reasoning;
    if (typeof parsed?.question === "string" && parsed.question) return parsed.question;
  } catch {
    return raw.length > 180 ? `${raw.slice(0, 177)}...` : raw;
  }

  return raw.length > 180 ? `${raw.slice(0, 177)}...` : raw;
}

// Render a single call row (used in both chunk and non-chunk views)
function CallRow({
  call,
  indentLevel,
  isLast,
  onCallClick,
  copiedKey,
  onCopyPrompt,
}: {
  call: LogEntry;
  indentLevel: number;
  isLast: boolean;
  onCallClick?: (call: LogEntry) => void;
  copiedKey: string | null;
  onCopyPrompt: (e: React.MouseEvent, call: LogEntry) => void;
}) {
  const prefix = isLast ? "└─" : "├─";
  const paddingLeft = 24 + indentLevel * 16;
  const health = getCallHealth(call);
  const summary = summarizeCallResponse(call);
  const summaryColor = health.level === "error" ? EMBRY.red : health.level === "warning" ? EMBRY.amber : EMBRY.dim;

  return (
    <tr
      key={call._key}
      data-qid={`scillm:call:row:${call._key}`}
      onClick={(e) => {
        e.stopPropagation();
        onCallClick?.(call);
      }}
      className="scillm-row"
      style={{
        backgroundColor: EMBRY.bg,
        cursor: "pointer",
        borderLeft: `4px solid transparent`,
      }}
    >
      <td style={{ padding: `8px 16px 8px ${paddingLeft}px`, fontSize: 11 }}>
        <div style={{ ...FLEX_COL_GAP4 }}>
          <div>
            <span style={{ color: EMBRY.dim }}>{prefix}</span>{" "}
            <span style={{ color: EMBRY.white, fontFamily: MONO }}>
              {call.metadata?.item_id || call.model_served || call.model_requested}
            </span>
          </div>
          {deriveCallCategory(call) && (
            <div style={{ color: EMBRY.dim, fontSize: 9, fontFamily: "Inter, sans-serif" }}>
              {deriveCallCategory(call)}
            </div>
          )}
          <div
            style={{
              color: summaryColor,
              fontSize: 10,
              lineHeight: 1.35,
              maxWidth: 480,
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
            title={summary}
          >
            {summary}
          </div>
        </div>
      </td>
      <td className="tabular-nums" style={{ ...META_STYLE, padding: "8px" }}>
        {call.total_tokens || 0} tokens
      </td>
      <td style={{ padding: "8px" }}>
        {(() => {
          const color = health.level === "error" ? EMBRY.red
            : health.level === "warning" ? EMBRY.amber
            : EMBRY.green;
          return (
            <span
              style={{
                fontSize: 10,
                color,
                fontFamily: MONO,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
              title={health.detail || ""}
            >
              {health.level === "warning" && <AlertTriangle size={10} />}
              {health.reason}
            </span>
          );
        })()}
      </td>
      <td className="tabular-nums" style={{
        ...META_STYLE,
        padding: "8px",
        fontFamily: MONO
      }}>
        {call.duration_ms != null ? `${(call.duration_ms / 1000).toFixed(1)}s` : "—"}
      </td>
      <td className="tabular-nums" style={{
        ...META_STYLE,
        padding: "8px",
        fontFamily: MONO
      }}>
        ${(call.cost_usd || 0).toFixed(4)}
      </td>
      <td className="tabular-nums" style={{ ...META_STYLE, padding: "8px" }}>
        {new Date(call.ts).toLocaleTimeString("en-US", { hour12: false })}
      </td>
      <td style={{ padding: "8px" }}>
        <button
          data-qid={`scillm:call:copy-prompt:${call._key}`}
          data-qs-action="SCILLM_COPY_PROMPT"
          title={call.request_prompt ? "Copy prompt to clipboard" : "No prompt captured"}
          onClick={(e) => onCopyPrompt(e, call)}
          className="press-scale scillm-focus"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            fontSize: 9,
            fontWeight: 700,
            border: "none",
            backgroundColor: copiedKey === call._key ? `${EMBRY.green}20` : `${EMBRY.blue}20`,
            color: copiedKey === call._key ? EMBRY.green : EMBRY.blue,
            cursor: call.request_prompt ? "pointer" : "not-allowed",
            opacity: call.request_prompt ? 1 : 0.4,
          }}
        >
          {copiedKey === call._key ? <Check size={10} /> : <Copy size={10} />}
          {copiedKey === call._key ? "Copied" : "Prompt"}
        </button>
      </td>
    </tr>
  );
}

function JobRow({
  job,
  isExpanded,
  expandedChunks,
  onToggle,
  onToggleChunk,
  onCallClick,
}: {
  job: Job;
  isExpanded: boolean;
  expandedChunks: Set<number>;
  onToggle: () => void;
  onToggleChunk: (chunkIndex: number) => void;
  onCallClick?: (call: LogEntry) => void;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [callFilter, setCallFilter] = useState<"all" | "completed" | "issues">("all");
  const borderColor = job.status === "failed" ? EMBRY.red : job.status === "running" ? EMBRY.blue : EMBRY.green;
  const completedCalls = useMemo(
    () => job.calls.filter((call) => getCallHealth(call).level === "ok"),
    [job.calls],
  );
  const issueCalls = useMemo(
    () => job.calls.filter((call) => getCallHealth(call).level !== "ok"),
    [job.calls],
  );

  const handleCopyPrompt = async (e: React.MouseEvent, call: LogEntry) => {
    e.stopPropagation();
    const text = call.request_prompt || "(no prompt captured)";
    await navigator.clipboard.writeText(text);
    setCopiedKey(call._key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const getVisibleCalls = (calls: LogEntry[]) => {
    if (callFilter === "completed") return calls.filter((call) => getCallHealth(call).level === "ok");
    if (callFilter === "issues") return calls.filter((call) => getCallHealth(call).level !== "ok");
    return calls;
  };

  return (
    <>
      {/* Parent Job Row */}
      <tr
        data-qid={`scillm:job:row:${job.id}`}
        onClick={onToggle}
        className="scillm-row"
        style={{
          backgroundColor: EMBRY.bgCard,
          cursor: "pointer",
          borderLeft: `4px solid ${borderColor}`,
        }}
      >
        <td style={{ ...FLEX_ROW_CENTER_GAP8, padding: "12px 16px" }}>
          {isExpanded ? <ChevronDown size={14} color={EMBRY.dim} /> : <ChevronRight size={14} color={EMBRY.dim} />}
          <span style={{ fontWeight: 700, color: EMBRY.white }}>{job.caller}</span>
          {job.batchId && (
            <span style={{ ...META_STYLE, fontFamily: MONO }}>
              #{job.batchId.slice(0, 8)}
            </span>
          )}
          {job.hasChunks && job.chunkTotal && (
            <span style={{ fontSize: 9, color: EMBRY.blue, fontFamily: MONO }}>
              {job.chunks.length}/{job.chunkTotal} chunks
            </span>
          )}
        </td>
        <td style={{ padding: "12px 8px" }}>
          <ProgressBar completed={job.completedCalls} total={job.expectedTotal || job.totalCalls} />
        </td>
        <td style={{ padding: "12px 8px" }}>
          {job.errors > 0 ? (
            <span
              style={{ fontSize: 11, fontWeight: 700, color: EMBRY.red }}
              title={job.firstError || ""}
            >
              {job.errors} error{job.errors > 1 ? "s" : ""}
            </span>
          ) : job.warnings > 0 ? (
            <span
              style={{ fontSize: 11, fontWeight: 700, color: EMBRY.amber, display: "flex", alignItems: "center", gap: 4 }}
              title={job.firstWarning || ""}
            >
              <AlertTriangle size={12} />
              {job.warnings} warn
            </span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <StatusPill status={job.status} />
              {job.status === "running" && job.avgLatency > 0 && job.expectedTotal && (
                <span style={{ fontSize: 9, color: EMBRY.dim, fontFamily: MONO }}>
                  ETA: {Math.round(((job.expectedTotal - job.totalCalls) * job.avgLatency) / 60000)}m
                </span>
              )}
            </div>
          )}
        </td>
        <td className="tabular-nums" style={{ padding: "12px 8px", fontFamily: MONO, fontSize: 11, color: EMBRY.dim }}>
          {job.avgLatency > 0 ? `${(job.avgLatency / 1000).toFixed(1)}s` : "—"}
        </td>
        <td className="tabular-nums" style={{ padding: "12px 8px", fontFamily: MONO, fontSize: 11, color: EMBRY.amber }}>
          ${job.totalCost.toFixed(3)}
        </td>
        <td className="tabular-nums" style={{ padding: "12px 8px" }}>
          <span style={{ ...META_STYLE }}>
            {new Date(job.lastActivity).toLocaleTimeString("en-US", { hour12: false })}
          </span>
        </td>
        <td style={{ padding: "12px 8px" }} />
      </tr>

      {isExpanded && (
        <tr style={{ backgroundColor: EMBRY.bgPanel, borderLeft: `4px solid ${borderColor}55` }}>
          <td colSpan={7} style={{ padding: "8px 16px", fontSize: 10 }}>
            <div style={{
              ...FLEX_ROW_CENTER_GAP12,
              justifyContent: "space-between",
              flexWrap: "wrap"
            }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  { key: "all", label: `All calls (${job.calls.length})` },
                  { key: "completed", label: `Completed (${completedCalls.length})` },
                  { key: "issues", label: `Issues (${issueCalls.length})` },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    data-qid={`scillm:job:${job.id}:filter:${key}`}
                    data-qs-action={`SCILLM_JOB_FILTER_${key.toUpperCase()}`}
                    title={`Filter calls by ${key}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCallFilter(key as typeof callFilter);
                    }}
                    className="press-scale scillm-focus"
                    style={{
                      padding: "6px 10px",
                      border: `1px solid ${callFilter === key ? EMBRY.blue : EMBRY.border}`,
                      backgroundColor: callFilter === key ? `${EMBRY.blue}20` : EMBRY.bgDeep,
                      color: callFilter === key ? EMBRY.blue : EMBRY.white,
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
              <div style={{ ...META_STYLE }}>
                Completed responses stay visible here even while the parent job is still running.
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* Expanded: Show chunks if available, otherwise flat calls */}
      {isExpanded && job.hasChunks ? (
        <>
        {/* Hierarchical chunk view */}
        {job.chunks.map((chunk) => {
          const isChunkExpanded = expandedChunks.has(chunk.index);
          const chunkStatusColor = chunk.status === "failed" ? EMBRY.red
            : chunk.status === "running" ? EMBRY.blue
            : EMBRY.green;
          const chunkStatusIcon = chunk.status === "completed" ? "✓"
            : chunk.status === "failed" ? "✗"
            : "⋯";

          return (
            <React.Fragment key={`chunk-${chunk.index}`}>
              {/* Chunk Row */}
              <tr
                data-qid={`scillm:chunk:row:${chunk.index}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleChunk(chunk.index);
                }}
                className="scillm-row"
                style={{
                  backgroundColor: EMBRY.bgDeep,
                  cursor: "pointer",
                  borderLeft: `4px solid ${chunkStatusColor}40`,
                }}
              >
                <td style={{ padding: "8px 16px 8px 32px", fontSize: 11 }}>
                  {isChunkExpanded ? <ChevronDown size={12} color={EMBRY.dim} style={{ marginRight: 4, verticalAlign: "middle" }} />
                    : <ChevronRight size={12} color={EMBRY.dim} style={{ marginRight: 4, verticalAlign: "middle" }} />}
                  <span style={{ color: EMBRY.white, fontWeight: 600 }}>
                    Chunk {chunk.index}/{chunk.total}
                  </span>
                  <span style={{ ...META_STYLE, marginLeft: 8 }}>
                    ({chunk.completedCalls}/{chunk.calls.length} complete)
                  </span>
                  <span style={{ color: chunkStatusColor, marginLeft: 8, fontSize: 12 }}>
                    {chunkStatusIcon}
                  </span>
                </td>
                <td style={{ padding: "8px" }} />
                <td className="tabular-nums" style={{ padding: "8px" }}>
                  {chunk.errors > 0 && (
                    <span style={{ fontSize: 10, color: EMBRY.red, fontFamily: MONO }}>
                      {chunk.errors} err
                    </span>
                  )}
                </td>
                <td className="tabular-nums" style={{
                  ...META_STYLE,
                  padding: "8px",
                  fontFamily: MONO
                }}>
                  {(chunk.totalDurationMs / 1000).toFixed(1)}s
                </td>
                <td style={{ padding: "8px" }} />
                <td style={{ padding: "8px" }} />
                <td style={{ padding: "8px" }} />
              </tr>

              {/* Expanded Chunk Calls */}
              {isChunkExpanded && getVisibleCalls(chunk.calls).map((call, callIdx, visibleCalls) => (
                <CallRow
                  key={call._key}
                  call={call}
                  indentLevel={2}
                  isLast={callIdx === visibleCalls.length - 1}
                  onCallClick={onCallClick}
                  copiedKey={copiedKey}
                  onCopyPrompt={handleCopyPrompt}
                />
              ))}
            </React.Fragment>
          );
        })}
        {/* In-flight chunk indicator when job is running */}
        {job.status === "running" && job.chunkTotal && (
          <tr style={{ backgroundColor: EMBRY.bgDeep, borderLeft: `4px solid ${EMBRY.blue}` }}>
            <td style={{
              ...FLEX_ROW_CENTER_GAP8,
              padding: "8px 16px 8px 32px",
              fontSize: 11
            }}>
              <span style={{ display: "inline-block", width: 12, height: 12, border: `2px solid ${EMBRY.blue}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              <span style={{ color: EMBRY.blue, fontWeight: 600 }}>
                Chunk {(job.chunks.length > 0 ? Math.max(...job.chunks.map(c => c.index)) : 0) + 1}/{job.chunkTotal}
              </span>
              <span style={{ ...META_STYLE }}>processing...</span>
            </td>
            <td colSpan={6} style={{ ...META_STYLE, padding: "8px" }}>
              4 calls in-flight
            </td>
          </tr>
        )}
        {/* Legacy calls without chunk metadata */}
        {job.ungroupedCalls.length > 0 && (
          <tr style={{ backgroundColor: EMBRY.bgDeep, borderLeft: `4px solid ${EMBRY.dim}40` }}>
            <td colSpan={7} style={{ padding: "8px 16px 8px 32px", fontSize: 11 }}>
              <span style={{ color: EMBRY.dim }}>Legacy ({job.ungroupedCalls.length} calls without chunk metadata)</span>
            </td>
          </tr>
        )}
        {getVisibleCalls(job.ungroupedCalls).map((call, idx, visibleCalls) => (
          <CallRow
            key={call._key}
            call={call}
            indentLevel={1}
            isLast={idx === visibleCalls.length - 1}
            onCallClick={onCallClick}
            copiedKey={copiedKey}
            onCopyPrompt={handleCopyPrompt}
          />
        ))}
      </>
      ) : isExpanded ? (
        // Flat call view (no chunks)
        getVisibleCalls(job.calls).map((call, idx, visibleCalls) => (
          <CallRow
            key={call._key}
            call={call}
            indentLevel={1}
            isLast={idx === visibleCalls.length - 1}
            onCallClick={onCallClick}
            copiedKey={copiedKey}
            onCopyPrompt={handleCopyPrompt}
          />
        ))
      ) : null}
    </>
  );
}

export function JobsTable({ logs, onCallClick }: Props) {
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [expandedChunks, setExpandedChunks] = useState<Map<string, Set<number>>>(new Map());
  const [filter, setFilter] = useState<"all" | "running" | "completed" | "errors">("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("activity");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useRegisterAction("scillm:jobs:filter:all", { app: "ux-lab", action: "SCILLM_JOBS_FILTER_ALL", label: "Jobs Filter: All", description: "Show all jobs" });
  useRegisterAction("scillm:jobs:filter:running", { app: "ux-lab", action: "SCILLM_JOBS_FILTER_RUNNING", label: "Jobs Filter: Running", description: "Show running jobs" });
  useRegisterAction("scillm:jobs:filter:completed", { app: "ux-lab", action: "SCILLM_JOBS_FILTER_COMPLETED", label: "Jobs Filter: Completed", description: "Show completed jobs" });
  useRegisterAction("scillm:jobs:filter:errors", { app: "ux-lab", action: "SCILLM_JOBS_FILTER_ERRORS", label: "Jobs Filter: Errors", description: "Show jobs with errors" });
  useRegisterAction("scillm:jobs:search:clear", { app: "ux-lab", action: "SCILLM_JOBS_CLEAR_SEARCH", label: "Clear Jobs Search", description: "Clear jobs search filter" });

  const jobs = useMemo(() => groupLogsIntoJobs(logs), [logs]);

  const filteredJobs = useMemo(() => {
    let next = jobs;

    if (filter === "running") next = next.filter(j => j.status === "running");
    else if (filter === "completed") next = next.filter(j => j.status === "completed");
    else if (filter === "errors") next = next.filter(j => j.errors > 0);

    const query = search.trim().toLowerCase();
    if (query) {
      next = next.filter((job) => {
        const jobFields = [
          job.caller,
          job.batchId,
          job.firstError,
          job.firstWarning,
        ];
        const jobMatch = jobFields.some((value) => value?.toLowerCase().includes(query));
        if (jobMatch) return true;
        return job.calls.some((call) =>
          [
            call.metadata?.item_id,
            call.model_served,
            call.model_requested,
            call.error,
          ].some((value) => value?.toLowerCase().includes(query))
        );
      });
    }

    const statusOrder = { running: 0, failed: 1, completed: 2 };
    const sorted = [...next].sort((a, b) => {
      const direction = sortDirection === "asc" ? 1 : -1;

      switch (sortKey) {
        case "caller":
          return direction * a.caller.localeCompare(b.caller);
        case "progress": {
          const aRatio = (a.expectedTotal || a.totalCalls) > 0 ? a.completedCalls / (a.expectedTotal || a.totalCalls) : 0;
          const bRatio = (b.expectedTotal || b.totalCalls) > 0 ? b.completedCalls / (b.expectedTotal || b.totalCalls) : 0;
          if (aRatio !== bRatio) return direction * (aRatio - bRatio);
          return direction * (a.completedCalls - b.completedCalls);
        }
        case "status":
          return direction * (statusOrder[a.status] - statusOrder[b.status]);
        case "latency":
          return direction * (a.avgLatency - b.avgLatency);
        case "cost":
          return direction * (a.totalCost - b.totalCost);
        case "activity":
        default:
          return direction * a.lastActivity.localeCompare(b.lastActivity);
      }
    });

    return sorted;
  }, [jobs, filter, search, sortDirection, sortKey]);

  const toggleJob = (jobId: string) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const toggleChunk = (jobId: string, chunkIndex: number) => {
    setExpandedChunks((prev) => {
      const next = new Map(prev);
      const jobChunks = next.get(jobId) || new Set();
      const newJobChunks = new Set(jobChunks);
      if (newJobChunks.has(chunkIndex)) newJobChunks.delete(chunkIndex);
      else newJobChunks.add(chunkIndex);
      next.set(jobId, newJobChunks);
      return next;
    });
  };

  const stats = useMemo(() => ({
    total: jobs.length,
    running: jobs.filter(j => j.status === "running").length,
    completed: jobs.filter(j => j.status === "completed").length,
    withErrors: jobs.filter(j => j.errors > 0).length,
  }), [jobs]);

  const toggleSort = (key: SortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDirection((prevDirection) => (prevDirection === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setSortDirection(key === "caller" ? "asc" : "desc");
      return key;
    });
  };

  const renderSortLabel = (label: string, key: SortKey) => {
    const isActive = sortKey === key;
    const suffix = isActive ? (sortDirection === "asc" ? " ↑" : " ↓") : "";
    return `${label}${suffix}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
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
          { key: "running", label: "Running", count: stats.running },
          { key: "completed", label: "Completed", count: stats.completed },
          { key: "errors", label: "Errors", count: stats.withErrors },
        ].map(({ key, label, count }) => (
          <button
            key={key}
            data-qid={`scillm:jobs:filter:${key}`}
            data-qs-action={`SCILLM_JOBS_FILTER_${key.toUpperCase()}`}
            title={`Filter jobs by ${label}`}
            onClick={() => setFilter(key as typeof filter)}
            className="press-scale scillm-focus"
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

      <div
        style={{
          ...FLEX_ROW_CENTER_GAP8,
          padding: "10px 16px",
          borderBottom: `1px solid ${EMBRY.border}`,
          backgroundColor: EMBRY.bgPanel
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            border: `1px solid ${EMBRY.border}`,
            backgroundColor: EMBRY.bgDeep,
            minWidth: 280,
          }}
        >
          <Search size={12} color={EMBRY.dim} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search caller, batch, item id, model, error..."
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
        </div>
        <div style={{ ...META_STYLE }}>
          {filteredJobs.length} shown
        </div>
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
              <th style={{ padding: "10px 16px" }}>
                <button data-qid="scillm:jobs:sort:caller" data-qs-action="SCILLM_JOBS_SORT_CALLER" title="Sort by caller" className="press-scale scillm-focus" onClick={() => toggleSort("caller")} style={headerButtonStyle}>
                  {renderSortLabel("Job / Caller", "caller")}
                </button>
              </th>
              <th style={{ padding: "10px 8px" }}>
                <button data-qid="scillm:jobs:sort:progress" data-qs-action="SCILLM_JOBS_SORT_PROGRESS" title="Sort by progress" className="press-scale scillm-focus" onClick={() => toggleSort("progress")} style={headerButtonStyle}>
                  {renderSortLabel("Progress", "progress")}
                </button>
              </th>
              <th style={{ padding: "10px 8px" }}>
                <button data-qid="scillm:jobs:sort:status" data-qs-action="SCILLM_JOBS_SORT_STATUS" title="Sort by status" className="press-scale scillm-focus" onClick={() => toggleSort("status")} style={headerButtonStyle}>
                  {renderSortLabel("Status", "status")}
                </button>
              </th>
              <th style={{ padding: "10px 8px" }}>
                <button data-qid="scillm:jobs:sort:latency" data-qs-action="SCILLM_JOBS_SORT_LATENCY" title="Sort by latency" className="press-scale scillm-focus" onClick={() => toggleSort("latency")} style={headerButtonStyle}>
                  {renderSortLabel("Avg Latency", "latency")}
                </button>
              </th>
              <th style={{ padding: "10px 8px" }}>
                <button data-qid="scillm:jobs:sort:cost" data-qs-action="SCILLM_JOBS_SORT_COST" title="Sort by cost" className="press-scale scillm-focus" onClick={() => toggleSort("cost")} style={headerButtonStyle}>
                  {renderSortLabel("Cost", "cost")}
                </button>
              </th>
              <th style={{ padding: "10px 8px" }}>
                <button data-qid="scillm:jobs:sort:activity" data-qs-action="SCILLM_JOBS_SORT_ACTIVITY" title="Sort by activity" className="press-scale scillm-focus" onClick={() => toggleSort("activity")} style={headerButtonStyle}>
                  {renderSortLabel("Last Activity", "activity")}
                </button>
              </th>
              <th style={{ padding: "10px 8px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: "center", color: EMBRY.dim }}>
                  No jobs found
                </td>
              </tr>
            ) : (
              filteredJobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  isExpanded={expandedJobs.has(job.id)}
                  expandedChunks={expandedChunks.get(job.id) || new Set()}
                  onToggle={() => toggleJob(job.id)}
                  onToggleChunk={(chunkIndex) => toggleChunk(job.id, chunkIndex)}
                  onCallClick={onCallClick}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const headerButtonStyle: React.CSSProperties = {
  padding: 0,
  border: "none",
  background: "none",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  letterSpacing: "inherit",
  textTransform: "inherit",
};
