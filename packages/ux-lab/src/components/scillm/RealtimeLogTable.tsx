/**
 * RealtimeLogTable — scrolling log of recent LLM calls with status pills
 */
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { EMBRY, panel, label as labelStyle, glowDot } from "../common/EmbryStyle";
import type { LogEntry } from "../../hooks/useScillmData";

interface Props {
  logs: LogEntry[];
  onRowClick?: (log: LogEntry) => void;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

function inferCallerFromUA(ua: string): string {
  // Extract useful info from user-agent strings
  const lower = ua.toLowerCase();
  if (lower.includes("python-httpx")) return "httpx";
  if (lower.includes("openai/python")) return "openai-py";
  if (lower.includes("anthropic-sdk")) return "anthropic-sdk";
  if (lower.includes("curl")) return "curl";
  if (lower.includes("node")) return "node";
  // Return first 12 chars if no match
  return ua.slice(0, 12) + (ua.length > 12 ? "..." : "");
}

function StatusPill({ status, error }: { status: string; error: string | null }) {
  const [copied, setCopied] = useState(false);
  const isError = status === "error";
  const color = isError ? EMBRY.red : EMBRY.green;

  // Truncate long error names for display, full text in tooltip
  const displayError = error
    ? (error.length > 12 ? error.slice(0, 12) + "…" : error)
    : "error";

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (error) {
      await navigator.clipboard.writeText(error);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: "2px 6px",
          borderRadius: 0,
          color,
          backgroundColor: `${color}18`,
          border: `1px solid ${color}33`,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          cursor: isError ? "help" : "default",
        }}
        title={isError ? `Error: ${error || "unknown"}` : "Success"}
      >
        {isError ? displayError : "ok"}
      </span>
      {isError && error && (
        <button
          onClick={handleCopy}
          style={{
            background: "none",
            border: "none",
            padding: 2,
            cursor: "pointer",
            color: copied ? EMBRY.green : EMBRY.dim,
            display: "flex",
            alignItems: "center",
          }}
          title="Copy error to clipboard"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      )}
    </div>
  );
}

export function RealtimeLogTable({ logs, onRowClick }: Props) {
  return (
    <div style={{ ...panel, padding: 0, overflow: "hidden", borderRadius: 0, border: "none" }}>
      {/* Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "70px 1fr 100px 80px 70px 60px",
          gap: 8,
          padding: "10px 12px",
          backgroundColor: EMBRY.bgDeep,
          borderBottom: `1px solid ${EMBRY.border}`,
        }}
      >
        {["Time", "Model", "Caller", "Latency", "Tokens", "Status"].map((h) => (
          <span key={h} style={labelStyle}>
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ maxHeight: 400, overflowY: "auto" }}>
        {logs.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: EMBRY.dim,
              fontSize: 12,
            }}
          >
            No logs yet
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log._key}
              onClick={() => onRowClick?.(log)}
              style={{
                display: "grid",
                gridTemplateColumns: "70px 1fr 100px 80px 70px 60px",
                gap: 8,
                padding: "8px 12px",
                borderBottom: `1px solid ${EMBRY.border}`,
                cursor: onRowClick ? "pointer" : "default",
                transition: "background-color 0.15s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = EMBRY.bgCard)
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              <span style={{ fontSize: 11, color: EMBRY.dim, fontFamily: "monospace" }}>
                {formatTime(log.ts)}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: EMBRY.white,
                  fontFamily: "monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={`${log.model_requested} → ${log.model_served}`}
              >
                {log.model_served || log.model_requested}
              </span>
              <span
                style={{
                  fontSize: log.caller ? 11 : 9,
                  color: log.caller ? EMBRY.blue : EMBRY.amber,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontStyle: log.caller ? "normal" : "italic",
                }}
                title={log.caller || log.caller_info?.user_agent || "Missing X-Caller-Skill header"}
              >
                {log.caller || (log.caller_info?.user_agent ? inferCallerFromUA(log.caller_info.user_agent) : "no header")}
              </span>
              <span style={{ fontSize: 11, color: EMBRY.dim, fontFamily: "monospace" }}>
                {log.duration_ms != null ? `${log.duration_ms}ms` : "—"}
              </span>
              <span style={{ fontSize: 11, color: EMBRY.dim, fontFamily: "monospace" }}>
                {log.total_tokens || "—"}
              </span>
              <StatusPill status={log.status} error={log.error} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
