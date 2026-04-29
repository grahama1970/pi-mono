import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { EMBRY } from '../common/EmbryStyle'
import { useRegisterAction } from '../../../hooks/useRegisterAction'

const API = 'http://localhost:3001'
const LOCAL_CACHE_KEY = 'sparta.coverageHealth.lastPayload'

interface CoveragePayload {
  generated_at?: string
  stale?: boolean
  refreshing?: boolean
  supervisor?: SupervisorState | null
  corpus?: Record<string, number>
  monitor?: {
    checks?: MonitorCheck[]
    passed?: number
    total?: number
    remaining?: RemainingSummary
    monitor_state?: Record<string, unknown>
  }
  bestPractices?: BestPracticeCheck[]
  promptAudit?: PromptAudit
  artifacts?: {
    recent?: string[]
    c2cAuditPath?: string
    nonC2cAuditPath?: string
  }
}

interface SupervisorLane {
  id?: string
  label?: string
  status?: string
  risk?: string
  owner?: string
  next_action?: string
}

interface SupervisorState {
  generated_at?: string
  heartbeat_at?: string
  snapshot_age_seconds?: number | null
  status?: string
  phase?: string
  remediation_enabled?: boolean
  operator_approval_required?: boolean
  checkpoint_required?: boolean
  command_source_counts?: Record<string, number>
  command_status_counts?: Record<string, number>
  notification_channels?: Record<string, Record<string, unknown>>
  remediation_plans?: Array<Record<string, unknown>>
  source_embedding_coverage?: {
    status?: string
    state?: string
    resume_hint?: string
    target_counts?: Record<string, number> | null
    observed_counts?: Record<string, number | null>
    gaps?: Record<string, unknown>
    backfill?: Record<string, unknown>
  }
  lanes?: SupervisorLane[]
  active_jobs?: Array<Record<string, unknown>>
  blocked?: Array<Record<string, unknown>>
  needs_attention?: Array<Record<string, unknown>>
  next_scheduled_actions?: Array<Record<string, unknown>>
}

interface MonitorCheck {
  dimension?: string
  ok?: boolean
  message?: string
}

interface NativeFrameworkRow {
  framework?: string
  expected_calls?: number
  completed_calls_any_collection?: number
  remaining_calls?: number
}

interface RemainingSummary {
  implemented_backlog_total_if_v2_sparta_native_required?: number
  sparta_control_to_control_gated_pairs?: number
  exact_remaining_calls_total?: number
  sparta_control_to_control_raw_candidate_pairs?: number
  native_by_framework?: NativeFrameworkRow[]
  sparta_v2_remaining_prompt_kinds?: Record<string, number>
}

interface BestPracticeCheck {
  name?: string
  skill?: string
  ok?: boolean
  status?: string
  message?: string
  percent?: number | null
}

interface PromptAudit {
  passed?: number
  total?: number
  all_passed?: number
  all_total?: number
  rows?: PromptAuditRow[]
  allRows?: PromptAuditRow[]
  scopes?: Array<{ source?: string; passed?: number; total?: number }>
}

interface PromptAuditRow {
  source?: string
  prompt_kind?: string
  status?: string
  failures?: string[]
  system_path?: string
  user_path?: string
  path?: string
}

function readLocalCache(): CoveragePayload | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function compactForLocalCache(payload: CoveragePayload): CoveragePayload {
  return {
    generated_at: payload.generated_at,
    stale: payload.stale,
    refreshing: payload.refreshing,
    corpus: payload.corpus,
    monitor: payload.monitor,
    bestPractices: payload.bestPractices,
    promptAudit: payload.promptAudit,
    supervisor: payload.supervisor,
  }
}

function writeLocalCache(payload: CoveragePayload) {
  try {
    window.localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(compactForLocalCache(payload)))
  } catch {
    window.localStorage.removeItem(LOCAL_CACHE_KEY)
  }
}

function formatNum(value: unknown): string {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n.toLocaleString() : '0'
}

function formatMaybe(value: unknown): string {
  if (value == null) return 'not wired'
  return formatNum(value)
}

function getImmediateSteps(data: CoveragePayload | null): string[] {
  const remaining = data?.monitor?.remaining ?? {}
  const failedChecks = data?.monitor?.checks?.filter((check) => !check.ok) ?? []
  const steps: string[] = []
  const exactRemaining = remaining.exact_remaining_calls_total ?? 0
  const implemented = remaining.implemented_backlog_total_if_v2_sparta_native_required ?? 0
  const comparison = remaining.sparta_control_to_control_gated_pairs ?? 0

  if (exactRemaining > 0) {
    steps.push(`Run the remaining /create-qras work: ${formatNum(exactRemaining)} exact calls (${formatNum(implemented)} implemented + ${formatNum(comparison)} comparison).`)
  }
  if (failedChecks.length > 0) {
    steps.push(`Fix or explicitly triage failing monitor-sparta checks: ${failedChecks.map((check) => check.dimension).join(', ')}.`)
  }
  const qid = data?.bestPractices?.find((check) => check.name === 'React data-qid coverage')
  if (qid && qid.ok === false) {
    steps.push(`Raise SPARTA UX data-qid/test-interactions coverage; current scanner reports ${qid.percent ?? '?'}%.`)
  }
  const python = data?.bestPractices?.find((check) => check.name === 'Python silent fallback scan')
  if (python && python.ok === false) {
    steps.push(`Remove or justify Python silent-fallback violations before treating coverage health as clean.`)
  }
  if (!data) {
    steps.push('Loading the first coverage snapshot. The audit can take about two minutes; no decision should be made from blank placeholders.')
  }
  return steps.length > 0 ? steps : ['No immediate blocking action is visible from the current coverage snapshot.']
}

function statusColor(status: unknown, ok?: unknown): string {
  if (status === 'pass' || ok === true) return EMBRY.green
  if (status === 'not_wired' || status === 'NOT WIRED' || status === 'OPEN' || status === 'BLOCKED') return EMBRY.amber
  return EMBRY.red
}

function gateLabel(ok: boolean | undefined): string {
  if (ok === true) return 'PASS'
  if (ok === false) return 'FAIL'
  return 'UNKNOWN'
}

function formatCountMap(counts: Record<string, number> | undefined, keys: string[]): string {
  return keys.map((key) => `${key}:${counts?.[key] ?? 0}`).join(' · ')
}

function StatCard({ label, value, tone = EMBRY.blue, note }: { label: string; value: unknown; tone?: string; note?: string }) {
  return (
    <div style={{ ...S.card, borderColor: `${tone}55` }}>
      <div style={S.kicker}>{label}</div>
      <div style={{ ...S.stat, color: tone }}>{typeof value === 'number' ? formatNum(value) : String(value ?? '—')}</div>
      {note ? <div style={S.note}>{note}</div> : null}
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section style={S.section}>
      <div style={S.sectionHeader}>
        <div>
          <h2 style={S.heading}>{title}</h2>
          {subtitle ? <p style={S.subtitle}>{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </section>
  )
}

export function CoverageView() {
  useRegisterAction('coverage:button:refresh', {
    app: 'sparta-explorer',
    action: 'REFRESH_COVERAGE',
    label: 'Refresh Coverage',
    description: 'Refresh SPARTA corpus, audit, backlog, and best-practice coverage data',
  })
  useRegisterAction('coverage:button:run-audit', {
    app: 'sparta-explorer',
    action: 'QUEUE_SUPERVISOR_AUDIT',
    label: 'Run Audit Now',
    description: 'Queue a read-only SPARTA supervisor audit command',
  })

  const [data, setData] = useState<CoveragePayload | null>(() => readLocalCache())
  const [supervisor, setSupervisor] = useState<SupervisorState | null>(() => readLocalCache()?.supervisor ?? null)
  const [liveState, setLiveState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
  const [commandMessage, setCommandMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/sparta/coverage-health`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`)
      setData(body)
      if (body?.supervisor) setSupervisor(body.supervisor)
      writeLocalCache(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSupervisor = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/sparta/supervisor-state`)
      const body = await res.json()
      if (!res.ok) return
      setSupervisor(body)
    } catch {
      // The live indicator handles disconnected/stale state; avoid noisy render errors.
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadSupervisor()
    const timer = window.setInterval(loadSupervisor, 30000)
    return () => window.clearInterval(timer)
  }, [loadSupervisor])

  useEffect(() => {
    const wsUrl = API.replace(/^http/, 'ws')
    let closed = false
    const ws = new WebSocket(wsUrl)
    setLiveState('connecting')
    ws.onopen = () => {
      if (!closed) setLiveState('connected')
    }
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data))
        if (message?.type === 'sparta-supervisor-state' && message.state) {
          setSupervisor(message.state)
        }
        if (message?.type === 'sparta-supervisor-command') {
          setCommandMessage('Supervisor command queued.')
          loadSupervisor()
        }
      } catch {
        // Ignore non-JSON frames from other ux-lab websocket producers.
      }
    }
    ws.onerror = () => {
      if (!closed) setLiveState('error')
    }
    ws.onclose = () => {
      if (!closed) setLiveState('disconnected')
    }
    return () => {
      closed = true
      ws.close()
    }
  }, [loadSupervisor])

  useEffect(() => {
    if (!data?.refreshing) return
    const timer = window.setTimeout(() => {
      load()
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [data?.refreshing, load])

  const runAuditNow = useCallback(async () => {
    setCommandMessage(null)
    try {
      const res = await fetch(`${API}/api/sparta/supervisor-command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'ui', intent: 'run_audit_now', risk: 'read_only', target_lane: 'monitor_health' }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`)
      setCommandMessage(`Queued ${body.command_id ?? 'supervisor command'}.`)
      loadSupervisor()
    } catch (err) {
      setCommandMessage(err instanceof Error ? err.message : String(err))
    }
  }, [loadSupervisor])

  const remaining: RemainingSummary = data?.monitor?.remaining ?? {}
  const checks = data?.monitor?.checks ?? []
  const bestPractices = data?.bestPractices ?? []
  const corpus = data?.corpus ?? {}
  const supervisorState = supervisor ?? data?.supervisor ?? null
  const supervisorHeartbeat = supervisorState?.heartbeat_at ? new Date(supervisorState.heartbeat_at) : null
  const heartbeatAgeSeconds = supervisorHeartbeat ? Math.max(0, Math.round((Date.now() - supervisorHeartbeat.getTime()) / 1000)) : null
  const heartbeatFresh = heartbeatAgeSeconds != null && heartbeatAgeSeconds <= 120
  const attentionCount = (supervisorState?.needs_attention?.length ?? supervisorState?.blocked?.length ?? 0)
  const commandSourceCounts = supervisorState?.command_source_counts ?? {}
  const commandStatusCounts = supervisorState?.command_status_counts ?? {}
  const notificationChannels = supervisorState?.notification_channels ?? {}
  const remediationPlans = supervisorState?.remediation_plans ?? []
  const slackState = notificationChannels.slack
  const sourceEmbeddingCoverage = supervisorState?.source_embedding_coverage
  const voiceCount = commandSourceCounts.voice ?? 0
  const slackCount = commandSourceCounts.slack ?? 0
  const reviewRequiredCount = commandStatusCounts.review_required ?? 0
  const liveLabel = liveState === 'connected' && heartbeatFresh
    ? 'Live'
    : liveState === 'connected'
      ? 'Stale'
      : liveState === 'error'
        ? 'Error'
        : liveState === 'connecting'
          ? 'Connecting'
          : 'Disconnected'
  const liveTone = liveLabel === 'Live' ? EMBRY.green : liveLabel === 'Stale' ? EMBRY.amber : EMBRY.red
  const nextScheduled = supervisorState?.next_scheduled_actions?.[0]
  const nativeByFramework = remaining.native_by_framework ?? []
  const promptKinds = remaining.sparta_v2_remaining_prompt_kinds ?? {}
  const promptAuditRows = data?.promptAudit?.rows ?? []
  const allPromptRows = data?.promptAudit?.allRows ?? promptAuditRows
  const promptAuditByKind = Object.fromEntries(promptAuditRows.map((row) => [row.prompt_kind, row]))
  const hasData = Boolean(data?.corpus || data?.monitor || data?.bestPractices)
  const immediateSteps = getImmediateSteps(data)
  const spartaNativeMissing =
    (promptKinds.sparta_tactic_canonical ?? 0) +
    (promptKinds.sparta_technique_canonical ?? 0) +
    (promptKinds.sparta_countermeasure_canonical ?? 0)
  const spartaRelationshipMissing =
    (promptKinds.sparta_tactic_technique_relationship ?? 0) +
    (promptKinds.sparta_technique_countermeasure_relationship ?? 0) +
    (remaining.sparta_control_to_control_gated_pairs ?? 0)
  const corpusRows = [
    { lane: 'Controls', have: corpus.controls, missing: 0, next: 'Baseline inventory loaded.' },
    { lane: 'Canonical QRAs', have: corpus.qrasCanonical, missing: spartaNativeMissing, next: 'Run remaining SPARTA native QRA jobs.' },
    { lane: 'Relationship QRAs', have: corpus.qrasRelationship, missing: spartaRelationshipMissing, next: 'Run remaining SPARTA relationship + C2C jobs.' },
    { lane: 'Legacy QRAs', have: corpus.qrasLegacy, missing: null, next: 'Legacy count is reference-only; do not use as completion proof.' },
    { lane: 'Relationships', have: corpus.relationships, missing: null, next: 'Wire relationship target/coverage audit.' },
    { lane: 'URLs', have: corpus.urls, missing: null, next: 'Wire source URL target/missing-page audit.' },
    { lane: 'URL Knowledge', have: corpus.urlKnowledge, missing: null, next: 'Wire embedded-page/document coverage audit.' },
    { lane: 'Datalake Chunks', have: corpus.datalakeChunks, missing: null, next: 'Wire corpus-specific embedded chunk target audit.' },
  ]
  const qidCheck = bestPractices.find((check) => check.name === 'React data-qid coverage')
  const pythonCheck = bestPractices.find((check) => check.name === 'Python silent fallback scan')
  const sourceEmbeddingStatus = String(sourceEmbeddingCoverage?.status ?? 'blocked').toLowerCase()
  const sourceEmbeddingGaps = sourceEmbeddingCoverage?.gaps ?? {}
  const sourceEmbeddingMissing = Number(sourceEmbeddingGaps.missing_vectors ?? 0)
  const sourceEmbeddingStale = Number(sourceEmbeddingGaps.stale_vectors ?? 0)
  const sourceEmbeddingBlocked = Array.isArray(sourceEmbeddingGaps.blocked_reasons) ? sourceEmbeddingGaps.blocked_reasons.length : 0
  const sourceEmbeddingBackfill = sourceEmbeddingCoverage?.backfill as Record<string, unknown> | undefined
  const sourceEmbeddingManifest = sourceEmbeddingBackfill?.manifest as Record<string, unknown> | null | undefined
  const sourceEmbeddingValue = sourceEmbeddingStatus === 'pass'
    ? `${formatNum(sourceEmbeddingCoverage?.observed_counts?.arango_synced_docs)} synced`
    : sourceEmbeddingStatus === 'fail'
      ? `${formatNum(sourceEmbeddingMissing + sourceEmbeddingStale)} vector gap(s)`
      : sourceEmbeddingCoverage?.state ?? 'blocked'
  const sourceEmbeddingMeaning = sourceEmbeddingManifest?.path
    ? `${sourceEmbeddingCoverage?.resume_hint ?? 'Review generated backfill manifest.'} Manifest: ${sourceEmbeddingManifest.path}`
    : sourceEmbeddingCoverage?.resume_hint ?? 'ArangoDB document/BM25/graph and Qdrant vector coverage scanner.'
  const aggregateRows = [
    {
      lane: 'QRA Generation',
      status: (remaining.exact_remaining_calls_total ?? 0) === 0 ? 'PASS' : 'OPEN',
      value: `${formatNum(remaining.exact_remaining_calls_total)} calls remaining`,
      meaning: `${formatNum(remaining.implemented_backlog_total_if_v2_sparta_native_required)} implemented + ${formatNum(remaining.sparta_control_to_control_gated_pairs)} comparison.`,
      action: 'Auto Observe',
    },
    {
      lane: 'Prompt Health',
      status: data?.promptAudit?.passed === data?.promptAudit?.total ? 'PASS' : 'FAIL',
      value: `${formatNum(data?.promptAudit?.passed)} / ${formatNum(data?.promptAudit?.total)} pass`,
      meaning: 'Active SPARTA create-qras prompt gate. Full prompt inventory remains advisory below.',
      action: 'Review',
    },
    {
      lane: 'Monitor Health',
      status: data?.monitor?.passed === data?.monitor?.total ? 'PASS' : 'FAIL',
      value: `${formatNum(data?.monitor?.passed)} / ${formatNum(data?.monitor?.total)} pass`,
      meaning: 'monitor-sparta full audit dimensions.',
      action: 'Auto Observe',
    },
    {
      lane: 'UX Coverage',
      status: gateLabel(qidCheck?.ok),
      value: qidCheck?.percent != null ? `${qidCheck.percent}% data-qid` : 'not loaded',
      meaning: 'SPARTA Explorer test-interaction addressability.',
      action: 'Review',
    },
    {
      lane: 'Python Fallbacks',
      status: gateLabel(pythonCheck?.ok),
      value: pythonCheck?.message ?? 'not loaded',
      meaning: 'Silent failure scanner result.',
      action: 'Review',
    },
    {
      lane: 'Source/Embedding Coverage',
      status: sourceEmbeddingStatus === 'pass' ? 'PASS' : sourceEmbeddingStatus === 'fail' ? 'FAIL' : 'BLOCKED',
      value: sourceEmbeddingValue,
      meaning: sourceEmbeddingBlocked > 0 ? `${sourceEmbeddingMeaning} Backend block(s): ${sourceEmbeddingBlocked}.` : sourceEmbeddingMeaning,
      action: sourceEmbeddingStatus === 'pass' ? 'Observe' : sourceEmbeddingStatus === 'fail' ? 'Review Backfill' : 'Blocked',
    },
  ]

  return (
    <div style={S.page}>
      <header style={S.topbar}>
        <div>
          <div style={S.kicker}>Coverage</div>
          <h1 style={S.title}>SPARTA Coverage & Health</h1>
          <p style={S.subtitle}>
            Live corpus counts, monitor-sparta audit dimensions, generation backlog, and explicit best-practice coverage gaps.
          </p>
          <div style={S.metaLine}>
            {data?.stale ? 'Showing last snapshot while a refresh runs.' : 'Showing latest loaded snapshot.'}
            {data?.generated_at ? ` Snapshot: ${new Date(data.generated_at).toLocaleString()}.` : ' No snapshot loaded yet.'}
          </div>
        </div>
        <div style={S.liveControls}>
          <div data-qid="coverage:live-status" data-qs-action="LIVE_STATUS" title="SPARTA supervisor live connection status" style={{ ...S.liveBadge, borderColor: `${liveTone}66`, color: liveTone, boxShadow: liveLabel === 'Live' ? `0 0 18px ${EMBRY.green}44` : undefined }}>
            <span style={{ ...S.liveDot, background: liveTone }} />
            {liveLabel}
          </div>
          <button
            data-qid="coverage:button:run-audit"
            data-qs-action="QUEUE_SUPERVISOR_AUDIT"
            title="Queue a read-only SPARTA supervisor audit command"
            onClick={runAuditNow}
            style={S.refresh}
          >
            Run Audit Now
          </button>
          <button
            data-qid="coverage:button:refresh"
            data-qs-action="REFRESH_COVERAGE"
            title="Refresh SPARTA coverage and health data"
            onClick={load}
            style={S.refresh}
          >
            <RefreshCw size={14} />
            {loading ? 'Refreshing...' : 'Refresh Now'}
          </button>
        </div>
      </header>

      {error ? <div style={S.error}>Coverage API failed: {error}</div> : null}
      {commandMessage ? <div style={S.info}>{commandMessage}</div> : null}
      <Section title="Supervisor Live State" subtitle="Browser WebSocket status, durable monitor-sparta heartbeat, and queued action visibility.">
        <div style={S.supervisorGrid}>
          <StatCard label="Connection" value={liveLabel} tone={liveTone} note="WebSocket + heartbeat freshness" />
          <StatCard label="Heartbeat Age" value={heartbeatAgeSeconds == null ? 'not loaded' : `${heartbeatAgeSeconds}s`} tone={heartbeatFresh ? EMBRY.green : EMBRY.amber} note={supervisorState?.heartbeat_at ?? 'no heartbeat'} />
          <StatCard label="Active Jobs" value={supervisorState?.active_jobs?.length ?? 0} tone={EMBRY.blue} note="Queued/running/review-required commands" />
          <StatCard label="Attention" value={attentionCount} tone={attentionCount ? EMBRY.amber : EMBRY.green} note="needs_attention / review gates" />
          <StatCard label="Review Gates" value={reviewRequiredCount} tone={reviewRequiredCount ? EMBRY.amber : EMBRY.green} note="review_required commands" />
          <StatCard label="Slack/Voice" value={`${slackCount}/${voiceCount}`} tone={slackCount || voiceCount ? EMBRY.blue : EMBRY.dim} note="queued Slack / voice commands" />
          <StatCard label="Dry-Run Plans" value={remediationPlans.length} tone={remediationPlans.length ? EMBRY.amber : EMBRY.green} note="observe-only remediation plans" />
        </div>
        <div style={S.metaLine}>
          Next: {typeof nextScheduled?.action === 'string' ? nextScheduled.action : 'not scheduled'} ·
          Phase: {supervisorState?.phase ?? 'not loaded'} ·
          Remediation: {supervisorState?.remediation_enabled ? 'enabled' : 'disabled'} ·
          Approval: {supervisorState?.operator_approval_required ? 'required' : 'not required'}
        </div>
        <div data-qid="coverage:supervisor:command-sources" data-qs-action="INSPECT_SUPERVISOR_COMMAND_SOURCES" style={S.metaLine}>
          Sources: {formatCountMap(commandSourceCounts, ['ui', 'cli', 'discord', 'slack', 'voice'])}
        </div>
        <div data-qid="coverage:supervisor:command-gates" data-qs-action="INSPECT_SUPERVISOR_COMMAND_GATES" style={S.metaLine}>
          Gates: {formatCountMap(commandStatusCounts, ['queued', 'dry_run', 'review_required', 'blocked'])} ·
          Slack: {String(slackState?.blocked ? 'blocked' : slackState?.mode ?? 'dry_run')} ·
          Voice: {voiceCount} queued transcript(s) ·
          Checkpoint: {supervisorState?.checkpoint_required ? 'required' : 'not required'}
        </div>
      </Section>
      {!hasData ? (
        <div style={S.loadingPanel}>
          <strong>Loading coverage snapshot.</strong>
          <span>The full monitor-sparta audit is slow. This page will not render empty metric boxes as evidence.</span>
        </div>
      ) : null}

      {hasData ? <Section title="State At A Glance" subtitle="Aggregate status first; details follow below.">
        <div style={S.tableCard}>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Lane</th><th style={S.th}>Status</th><th style={S.th}>Value</th><th style={S.th}>Meaning</th><th style={S.th}>Action</th></tr></thead>
            <tbody>
              {aggregateRows.map((row) => (
                <tr key={row.lane}>
                  <td style={S.td}>{row.lane}</td>
                  <td style={S.td}><span style={{ ...S.pill, color: statusColor(row.status, row.status === 'PASS'), borderColor: `${statusColor(row.status, row.status === 'PASS')}66` }}>{row.status}</span></td>
                  <td style={S.tdStrong}>{row.value}</td>
                  <td style={S.td}>{row.meaning}</td>
                  <td style={S.td}><span style={{ ...S.pill, color: EMBRY.blue, borderColor: `${EMBRY.blue}66` }}>{row.action}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section> : null}

      <Section title="Immediate Next Steps" subtitle="Actionable blockers derived from the current live audit snapshot.">
        <ol style={S.steps}>
          {immediateSteps.map((step) => <li key={step} style={S.step}>{step}</li>)}
        </ol>
      </Section>

      {hasData ? (
        <Section title="SPARTA Corpora" subtitle="Compact have/missing inventory. `not wired` means this page does not yet have a defensible target count for that lane.">
          <div style={S.tableCard}>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Lane</th><th style={S.th}>Have</th><th style={S.th}>Missing</th><th style={S.th}>Next Action</th></tr></thead>
              <tbody>
                {corpusRows.map((row) => (
                  <tr key={row.lane}>
                    <td style={S.td}>{row.lane}</td>
                    <td style={S.tdStrong}>{formatNum(row.have)}</td>
                    <td style={S.tdStrong}>{formatMaybe(row.missing)}</td>
                    <td style={S.td}>{row.next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {hasData ? <Section title="Generation Backlog" subtitle="Runnable work is separated from diagnostic raw candidates.">
        <div style={S.grid}>
          <StatCard label="Implemented Remaining" value={remaining.implemented_backlog_total_if_v2_sparta_native_required} tone={EMBRY.amber} note="Native + SPARTA v2 residuals" />
          <StatCard label="Comparison Remaining" value={remaining.sparta_control_to_control_gated_pairs} tone={EMBRY.amber} note="Evidence-gated runnable C2C" />
          <StatCard label="Exact Remaining" value={remaining.exact_remaining_calls_total} tone={EMBRY.red} note="Runnable total" />
          <StatCard label="Raw C2C Candidates" value={remaining.sparta_control_to_control_raw_candidate_pairs} tone={EMBRY.dim} note="Diagnostic, not runnable" />
        </div>
        <div style={S.twoCol}>
          <div style={S.tableCard}>
            <h3 style={S.tableTitle}>Native Remaining by Framework</h3>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Framework</th><th style={S.th}>Expected</th><th style={S.th}>Done</th><th style={S.th}>Remaining</th></tr></thead>
              <tbody>
                {nativeByFramework.map((row) => (
                  <tr key={row.framework}>
                    <td style={S.td}>{row.framework}</td>
                    <td style={S.td}>{formatNum(row.expected_calls)}</td>
                    <td style={S.td}>{formatNum(row.completed_calls_any_collection)}</td>
                    <td style={S.td}>{formatNum(row.remaining_calls)}</td>
                  </tr>
                ))}
                {nativeByFramework.length === 0 ? <tr><td style={S.td} colSpan={4}>No framework rows loaded.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div style={S.tableCard}>
            <h3 style={S.tableTitle}>SPARTA V2 Remaining + Prompt Health</h3>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Prompt Kind</th><th style={S.th}>Remaining</th><th style={S.th}>Prompt Gate</th><th style={S.th}>Failures</th></tr></thead>
              <tbody>
                {Object.entries(promptKinds).map(([kind, value]) => {
                  const audit = promptAuditByKind[kind]
                  const status = audit?.status ?? 'missing'
                  return (
                    <tr key={kind}>
                      <td style={S.td}>{kind}</td>
                      <td style={S.td}>{formatNum(value)}</td>
                      <td style={S.td}><span style={{ ...S.pill, color: statusColor(status, status === 'pass'), borderColor: `${statusColor(status, status === 'pass')}66` }}>{status.toUpperCase()}</span></td>
                      <td style={S.td}>{audit?.failures?.length ? audit.failures.join(', ') : 'none'}</td>
                    </tr>
                  )
                })}
                {Object.keys(promptKinds).length === 0 ? <tr><td style={S.td} colSpan={4}>No SPARTA V2 remaining rows loaded.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      </Section> : null}

      {hasData ? <Section title="SPARTA Prompt Inventory" subtitle={`${data?.promptAudit?.all_passed ?? 0}/${data?.promptAudit?.all_total ?? 0} scanned prompt files pass the local best-practices-prompt gate; active generation prompts are tracked separately above.`}>
        <div style={S.tableCard}>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Status</th><th style={S.th}>Source</th><th style={S.th}>Prompt</th><th style={S.th}>Failures</th><th style={S.th}>Source Files</th></tr></thead>
            <tbody>
              {allPromptRows.map((row) => (
                <tr key={`${row.source}-${row.prompt_kind}-${row.path ?? ''}`}>
                  <td style={S.td}><span style={{ ...S.pill, color: statusColor(row.status, row.status === 'pass'), borderColor: `${statusColor(row.status, row.status === 'pass')}66` }}>{String(row.status ?? 'missing').toUpperCase()}</span></td>
                  <td style={S.td}>{row.source}</td>
                  <td style={S.td}>{row.prompt_kind}</td>
                  <td style={S.td}>{row.failures?.length ? row.failures.join(', ') : 'none'}</td>
                  <td style={S.td}>
                    {row.path ? <code style={S.inlineCode}>{row.path}</code> : (
                      <>
                        <code style={S.inlineCode}>{row.system_path}</code><br />
                        <code style={S.inlineCode}>{row.user_path}</code>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section> : null}

      {hasData ? <Section title="Audit Health" subtitle={`${data?.monitor?.passed ?? 0}/${data?.monitor?.total ?? 0} monitor-sparta dimensions passing.`}>
        <div style={S.tableCard}>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Status</th><th style={S.th}>Dimension</th><th style={S.th}>Message</th></tr></thead>
            <tbody>
              {checks.map((check) => (
                <tr key={check.dimension}>
                  <td style={S.td}><span style={{ ...S.pill, color: statusColor(undefined, check.ok), borderColor: `${statusColor(undefined, check.ok)}66` }}>{check.ok ? 'PASS' : 'FAIL'}</span></td>
                  <td style={S.td}>{check.dimension}</td>
                  <td style={S.td}>{check.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section> : null}

      {hasData ? <Section title="Best Practices & UX Coverage" subtitle="Reports wired checks and explicitly marks scanners that are not yet integrated.">
        <div style={S.tableCard}>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Status</th><th style={S.th}>Lane</th><th style={S.th}>Skill</th><th style={S.th}>Message</th></tr></thead>
            <tbody>
              {bestPractices.map((check) => (
                <tr key={`${check.skill}-${check.name}`}>
                  <td style={S.td}><span style={{ ...S.pill, color: statusColor(check.status, check.ok), borderColor: `${statusColor(check.status, check.ok)}66` }}>{String(check.status ?? (check.ok ? 'pass' : 'fail')).toUpperCase()}</span></td>
                  <td style={S.td}>{check.name}</td>
                  <td style={S.td}>{check.skill}</td>
                  <td style={S.td}>{check.percent != null ? `${check.message} (${check.percent}%)` : check.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section> : null}

      <div style={S.footer}>Last refreshed: {data?.generated_at ? new Date(data.generated_at).toLocaleString() : 'not loaded'}</div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  page: { flex: 1, minHeight: 0, overflow: 'auto', padding: 24, background: EMBRY.bg, color: EMBRY.white },
  topbar: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 20 },
  title: { margin: '4px 0', fontSize: 28, lineHeight: 1.1, color: EMBRY.white },
  kicker: { fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: EMBRY.dim, fontWeight: 800 },
  subtitle: { margin: 0, color: EMBRY.muted, fontSize: 13, lineHeight: 1.5 },
  metaLine: { marginTop: 8, color: EMBRY.dim, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
  liveControls: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' },
  liveBadge: { minHeight: 42, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 12px', border: '1px solid', background: EMBRY.bgPanel, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 11 },
  liveDot: { width: 9, height: 9, borderRadius: 99, display: 'inline-block' },
  refresh: { minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 14px', border: `1px solid ${EMBRY.border}`, background: EMBRY.bgPanel, color: EMBRY.white, cursor: 'pointer' },
  error: { border: `1px solid ${EMBRY.red}`, color: EMBRY.red, background: '#2a1111', padding: 12, marginBottom: 16 },
  info: { border: `1px solid ${EMBRY.blue}`, color: EMBRY.blue, background: '#081626', padding: 12, marginBottom: 16 },
  loadingPanel: { display: 'grid', gap: 6, border: `1px solid ${EMBRY.amber}`, color: EMBRY.amber, background: '#1f1705', padding: 12, marginBottom: 16 },
  section: { border: `1px solid ${EMBRY.border}`, background: EMBRY.bgPanel, padding: 16, marginBottom: 18 },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  heading: { margin: 0, fontSize: 17, color: EMBRY.white },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  supervisorGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 10 },
  card: { background: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`, padding: 14, minHeight: 92 },
  stat: { marginTop: 8, fontSize: 26, fontWeight: 900, letterSpacing: '-0.04em' },
  note: { marginTop: 6, fontSize: 11, color: EMBRY.muted },
  steps: { margin: 0, paddingLeft: 24, display: 'grid', gap: 8 },
  step: { color: EMBRY.white, fontSize: 14, lineHeight: 1.45 },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginTop: 12 },
  tableCard: { background: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`, overflow: 'auto' },
  tableTitle: { fontSize: 12, margin: 0, padding: 12, color: EMBRY.white, borderBottom: `1px solid ${EMBRY.border}` },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { padding: '10px 12px', color: EMBRY.dim, textAlign: 'left', borderBottom: `1px solid ${EMBRY.border}`, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' },
  td: { padding: '10px 12px', color: EMBRY.white, borderBottom: `1px solid ${EMBRY.border}`, verticalAlign: 'top' },
  tdStrong: { padding: '10px 12px', color: EMBRY.white, borderBottom: `1px solid ${EMBRY.border}`, verticalAlign: 'top', fontSize: 15, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace' },
  pill: { display: 'inline-flex', border: '1px solid', padding: '3px 7px', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em' },
  artifacts: { display: 'grid', gap: 8 },
  code: { display: 'block', padding: 10, background: '#0b0b0b', border: `1px solid ${EMBRY.border}`, color: EMBRY.dim, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  inlineCode: { color: EMBRY.dim, fontSize: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  footer: { fontSize: 11, color: EMBRY.dim, paddingBottom: 20 },
}
