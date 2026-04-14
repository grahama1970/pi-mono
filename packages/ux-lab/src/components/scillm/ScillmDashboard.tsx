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
import { useState, useMemo } from "react";
import { Search, X, Activity, Clock, AlertTriangle, DollarSign, Copy, Check, Sparkles, Loader2, Send } from "lucide-react";
import { EMBRY, glowDot } from "../common/EmbryStyle";
import { useScillmData, useProviderAuth, type LogEntry, type AuthStatusResponse } from "../../hooks/useScillmData";
import { JobsTable } from "./JobsTable";

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
        const expiry = "expires_in_s" in data ? formatExpiry(data.expires_in_s) : "";

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

export function ScillmDashboard() {
  const { logs, loading, error, lastUpdate, refresh } = useScillmData();
  const { auth } = useProviderAuth();
  const [search, setSearch] = useState("");
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

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

      {/* MAIN: Jobs Table (GitHub Actions style) */}
      <main style={{ overflow: "hidden", backgroundColor: EMBRY.bg }}>
        <JobsTable logs={filteredLogs} onCallClick={setSelectedLog} />
      </main>

      {/* Trace Panel (slide-out) */}
      {selectedLog && <TracePanel log={selectedLog} onClose={() => setSelectedLog(null)} />}

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
