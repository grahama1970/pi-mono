import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Code2, GitBranch, MessageSquareText, RefreshCw, ServerCog } from "lucide-react";
import { apiUrl } from "../../lib/apiBase";
import { useRegisterAction } from "../../hooks/useRegisterAction";
import "./scillm-dashboard.css";

type JsonRecord = Record<string, unknown>;

type NicoTurn = {
  label?: string;
  turn_id?: string;
  prompt?: string;
  steer_text?: string | null;
  final_text?: string;
  terminal_turn?: {
    status?: string;
    durationMs?: number;
  };
};

type AppServerSnapshot = {
  ok: boolean;
  error?: string;
  detail?: string;
  phase_id?: string;
  source?: Record<string, string>;
  call_varieties?: Array<{ id: string; label: string; implemented_interface: string }>;
  selected_call_variety?: string;
  runtime?: JsonRecord;
  phase_status?: JsonRecord | null;
  summary?: JsonRecord;
  transcript?: NicoTurn[];
  event_summary?: JsonRecord;
  network_blocked_event_summary?: JsonRecord;
  recent_events?: JsonRecord[];
  pytest_log?: string;
  workspace_diff?: string;
  workspace_status?: string;
};

function textValue(value: unknown, fallback = "not reported"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function formatDuration(ms?: number): string {
  if (!Number.isFinite(ms)) return "not reported";
  const seconds = Math.round((ms ?? 0) / 100) / 10;
  return `${seconds}s`;
}

function shortPath(path?: string): string {
  if (!path) return "not reported";
  const marker = "/scillm/";
  const index = path.indexOf(marker);
  return index >= 0 ? `scillm/${path.slice(index + marker.length)}` : path;
}

function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="scillm-appserver-section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="scillm-appserver-section__body">{children}</div>
    </details>
  );
}

export function ScillmAppServerSession() {
  const [snapshot, setSnapshot] = useState<AppServerSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useRegisterAction("scillm:app-server:refresh", {
    app: "ux-lab",
    action: "SCILLM_APP_SERVER_REFRESH",
    label: "Refresh Codex App Server session",
    description: "Reload the latest app-server Nico collaboration artifacts",
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(apiUrl("/scillm/app-server/sessions/latest"));
      const data = await response.json() as AppServerSnapshot;
      if (!response.ok || data.ok === false) {
        throw new Error(data.detail || data.error || `HTTP ${response.status}`);
      }
      setSnapshot(data);
    } catch (err) {
      setSnapshot(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const turns = snapshot?.transcript ?? [];
  const summary = snapshot?.summary ?? {};
  const runtime = snapshot?.runtime ?? {};
  const source = snapshot?.source ?? {};
  const callVarieties = snapshot?.call_varieties ?? [];
  const files = Array.isArray(summary.files) ? summary.files.map(String) : [];
  const eventMethods = Array.isArray(snapshot?.event_summary?.method_counts)
    ? snapshot?.event_summary?.method_counts as Array<{ method?: string; count?: number }>
    : [];
  const changedFiles = files.filter((file) => !file.includes("__pycache__") && !file.endsWith(".pyc"));
  const protocolFacts = useMemo(() => [
    ["Call variety", textValue(snapshot?.selected_call_variety)],
    ["Runtime", textValue(runtime.backing_runtime)],
    ["Persona", textValue(runtime.persona)],
    ["Model", textValue(runtime.model)],
    ["Permission", `${textValue(runtime.sandbox)} / approval ${textValue(runtime.approval_policy)}`],
    ["Terminal typing", runtime.terminal_input_simulation === false ? "no" : textValue(runtime.terminal_input_simulation)],
    ["subagent-runner", runtime.subagent_runner === false ? "no" : textValue(runtime.subagent_runner)],
  ], [runtime, snapshot?.selected_call_variety]);

  if (loading) {
    return (
      <div className="scillm-appserver" data-qid="scillm:app-server">
        <div className="scillm-card">Loading Codex App Server session artifacts...</div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="scillm-appserver" data-qid="scillm:app-server">
        <div className="scillm-appserver-empty">
          <AlertTriangle size={18} />
          <div>
            <div className="scillm-heading-md">Codex App Server evidence unavailable</div>
            <p>{error ?? "No app-server session snapshot was returned."}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scillm-appserver" data-qid="scillm:app-server">
      <header className="scillm-appserver-header">
        <div>
          <div className="scillm-label">Codex App Server via scillm</div>
          <h2>Nico collaboration session</h2>
          <p>{textValue(snapshot.phase_id)} · thread {textValue(summary.thread_id)}</p>
        </div>
        <button
          type="button"
          className="scillm-button scillm-button--refresh"
          data-qid="scillm:app-server:refresh"
          data-qs-action="SCILLM_APP_SERVER_REFRESH"
          title="Refresh latest app-server session artifacts"
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </header>

      <main className="scillm-appserver-grid">
        <section className="scillm-appserver-main">
          <Section title="Conversation Turns">
            <div className="scillm-appserver-turns">
              {turns.map((turn, index) => (
                <article className="scillm-appserver-turn" key={turn.turn_id ?? turn.label ?? index}>
                  <div className="scillm-appserver-turn__rail">
                    <span>{index + 1}</span>
                  </div>
                  <div className="scillm-appserver-turn__content">
                    <div className="scillm-appserver-turn__meta">
                      <span>{turn.label ?? `turn-${index + 1}`}</span>
                      <span>{textValue(turn.terminal_turn?.status)} · {formatDuration(turn.terminal_turn?.durationMs)}</span>
                    </div>
                    <div className="scillm-appserver-speaker">
                      <MessageSquareText size={14} />
                      Project agent / human prompt
                    </div>
                    <pre>{turn.prompt ?? "Prompt not reported"}</pre>
                    {turn.steer_text ? (
                      <>
                        <div className="scillm-appserver-speaker">Course correction</div>
                        <pre>{turn.steer_text}</pre>
                      </>
                    ) : null}
                    <div className="scillm-appserver-speaker scillm-appserver-speaker--nico">
                      <ServerCog size={14} />
                      Nico response from Codex App Server
                    </div>
                    <pre>{turn.final_text ?? "Response not reported"}</pre>
                  </div>
                </article>
              ))}
            </div>
          </Section>

          <Section title="Changed Files And Test Proof">
            <div className="scillm-appserver-proof-grid">
              <div>
                <div className="scillm-label">Files from session summary</div>
                <ul className="scillm-appserver-list">
                  {changedFiles.map((file) => <li key={file}>{file}</li>)}
                </ul>
              </div>
              <div>
                <div className="scillm-label">Pytest log</div>
                <pre className="scillm-appserver-code">{snapshot.pytest_log || "No pytest log recorded."}</pre>
              </div>
            </div>
          </Section>

          <Section title="Workspace Diff" defaultOpen={false}>
            <pre className="scillm-appserver-code scillm-appserver-code--large">{snapshot.workspace_diff || "No diff recorded."}</pre>
          </Section>

          <Section title="Protocol Events" defaultOpen={false}>
            <div className="scillm-appserver-methods">
              {eventMethods.map((item) => (
                <span key={item.method}>{item.method}: {item.count}</span>
              ))}
            </div>
            <pre className="scillm-appserver-code scillm-appserver-code--large">
              {JSON.stringify(snapshot.recent_events?.slice(0, 24) ?? [], null, 2)}
            </pre>
          </Section>
        </section>

        <aside className="scillm-appserver-aside">
          <section className="scillm-appserver-card">
            <div className="scillm-appserver-card__title">
              <ServerCog size={15} />
              Runtime Contract
            </div>
            <dl className="scillm-appserver-dl">
              {protocolFacts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="scillm-appserver-card">
            <div className="scillm-appserver-card__title">
              <GitBranch size={15} />
              Call Varieties
            </div>
            <div className="scillm-appserver-call-varieties">
              {callVarieties.map((item) => (
                <div className={item.id === snapshot.selected_call_variety ? "selected" : ""} key={item.id}>
                  <strong>{item.label}</strong>
                  <span>{item.implemented_interface}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="scillm-appserver-card">
            <div className="scillm-appserver-card__title">
              <CheckCircle2 size={15} />
              Evidence
            </div>
            <dl className="scillm-appserver-dl">
              <div>
                <dt>Turns</dt>
                <dd>{textValue(summary.turn_count)}</dd>
              </div>
              <div>
                <dt>Tests</dt>
                <dd>{textValue(summary.pytest_exit_code) === "0" ? "pytest passed" : `pytest exit ${textValue(summary.pytest_exit_code)}`}</dd>
              </div>
              <div>
                <dt>Diff</dt>
                <dd>{summary.diff_nonempty ? "non-empty" : "not reported"}</dd>
              </div>
              <div>
                <dt>Events</dt>
                <dd>{textValue(snapshot.event_summary?.total)}</dd>
              </div>
            </dl>
          </section>

          <section className="scillm-appserver-card">
            <div className="scillm-appserver-card__title">
              <Code2 size={15} />
              Artifact Paths
            </div>
            <ul className="scillm-appserver-paths">
              {Object.entries(source).map(([key, value]) => (
                <li key={key}>
                  <span>{key}</span>
                  <code>{shortPath(value)}</code>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </main>
    </div>
  );
}
