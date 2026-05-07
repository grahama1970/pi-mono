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
  qraTrust?: QraTrustStatus
  corpusInventory?: CorpusInventory
  controlFrameworks?: ControlFrameworkRow[]
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
  createQrasBackfill?: CreateQrasBackfillProgress
}

interface CreateQrasBackfillProgress {
  status?: string
  active_process_count?: number
  process_count?: number
  pid_summary?: string | null
  current_log?: string | null
  current_log_age_seconds?: number | null
  manifest_path?: string | null
  total_jobs?: number | null
  canonical_jobs?: number | null
  relationship_jobs?: number | null
  progress_percent?: number | null
  message?: string
  chunk?: {
    current?: number
    total?: number
    start?: number
    end?: number
    job_total?: number
  } | null
  heartbeat?: {
    chunk_current?: number
    chunk_total?: number
    pending?: number
    elapsed_s?: number
    items?: string
  } | null
  stored?: {
    last_batch?: number
    total?: number
  } | null
}

interface QraTrustStatus {
  status?: string
  label?: string
  expert_blessed?: boolean
  reviewer?: string | null
  blessed_at?: string | null
  scope?: string[]
  counts?: {
    legacy?: number
    canonical?: number
    relationship?: number
    total?: number
  }
  use_policy?: string
  next_action?: string
}

interface CorpusInventoryLane {
  missing?: number
  target?: number
  with_content?: number
  with_200_file?: number
  distinct_urls?: number
  qdrant_synced?: number
  next?: string
}

interface CorpusInventory {
  legacy_qras?: CorpusInventoryLane
  relationships?: CorpusInventoryLane
  urls?: CorpusInventoryLane
  url_knowledge?: CorpusInventoryLane
  datalake_chunks?: CorpusInventoryLane
}

interface ControlFrameworkRow {
  framework?: string
  controls?: number
  quality_gaps?: number
  missing_descriptions?: number
  missing_embeddings?: number
  raw_frameworks?: string[]
  defects?: ControlFrameworkDefect[]
  status?: string
  action_code?: string
  action_label?: string
  risk?: string
  safe_default?: string
  requires_checkpoint?: boolean
  command_payload?: Record<string, unknown>
}

interface ControlFrameworkDefect {
  control_id?: string
  title?: string
  gap_types?: string[]
  description_length?: number
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
  source_text_qra_coverage?: {
    status?: string
    state?: string
    resume_hint?: string
    summary?: Record<string, number>
    controls?: Record<string, number | boolean>
    urls?: Record<string, number | boolean>
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
  malformed?: number
  scanned?: number
  course_corrected_non_generation?: number
  course_corrected_by_collection?: Record<string, number>
  malformed_by_collection?: Record<string, number>
  rule_counts?: Record<string, number>
  output_path?: string
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
    qraTrust: payload.qraTrust,
    corpusInventory: payload.corpusInventory,
    controlFrameworks: payload.controlFrameworks,
    monitor: payload.monitor,
    bestPractices: payload.bestPractices,
    promptAudit: payload.promptAudit,
    supervisor: payload.supervisor,
    createQrasBackfill: payload.createQrasBackfill,
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

function frameworkSlug(value: unknown): string {
  return String(value ?? 'unknown')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown'
}

function frameworkRank(value: unknown): number {
  const framework = String(value ?? '').toLowerCase()
  if (framework.includes('sparta')) return 10
  if (framework.includes('nist')) return 20
  if (framework.includes('iso')) return 21
  if (framework.includes('att&ck') || framework.includes('attck') || framework.includes('attack')) return 30
  if (framework.includes('capec')) return 31
  if (framework.includes('cwe')) return 32
  if (framework.includes('d3fend')) return 40
  if (framework.includes('esa')) return 41
  if (framework.includes('nvd') || framework.includes('cve')) return 50
  if (framework.includes('nasa')) return 60
  return 99
}

interface ImmediateStepInput {
  data: CoveragePayload | null
  createQrasBackfill?: CreateQrasBackfillProgress
  heartbeatFresh: boolean
  heartbeatAgeSeconds: number | null
  reviewRequiredCount: number
  attentionCount: number
  dryRunPlanCount: number
  controlQualityGaps: number
  qualityGapFrameworks: string[]
}

function getImmediateSteps({
  data,
  createQrasBackfill,
  heartbeatFresh,
  heartbeatAgeSeconds,
  reviewRequiredCount,
  attentionCount,
  dryRunPlanCount,
  controlQualityGaps,
  qualityGapFrameworks,
}: ImmediateStepInput): string[] {
  const remaining = data?.monitor?.remaining ?? {}
  const failedChecks = data?.monitor?.checks?.filter((check) => !check.ok) ?? []
  const steps: string[] = []
  const implemented = remaining.implemented_backlog_total_if_v2_sparta_native_required ?? 0
  const comparison = remaining.sparta_control_to_control_gated_pairs ?? 0
  const qraBackfillRunning = createQrasBackfill?.status === 'running'

  if (data?.stale || !heartbeatFresh) {
    steps.push(`Refresh or rerun the read-only audit before signoff; snapshot is ${data?.stale ? 'stale' : 'not yet trusted'} and heartbeat age is ${heartbeatAgeSeconds == null ? 'not loaded' : `${heartbeatAgeSeconds}s`}.`)
  }
  if (reviewRequiredCount > 0) {
    steps.push(`Review ${formatNum(reviewRequiredCount)} supervisor-gated command(s) before mutation-capable remediation.`)
  }
  if (attentionCount > 0) {
    steps.push(`Triage ${formatNum(attentionCount)} attention item(s) before treating the project as clean.`)
  }
  if (dryRunPlanCount > 0) {
    steps.push(`Inspect ${formatNum(dryRunPlanCount)} dry-run remediation plan(s); do not execute repairs without an explicit checkpoint/review gate.`)
  }
  if (controlQualityGaps > 0) {
    steps.push(`Repair or explicitly waive ${formatNum(controlQualityGaps)} control-quality gap(s): ${qualityGapFrameworks.join(', ')}.`)
  }
  if (implemented > 0 && qraBackfillRunning) {
    steps.push(`Monitor active /create-qras backfill: ${createQrasBackfill?.message ?? 'worker is running'} ${formatNum(implemented)} runnable calls remain in the current audit snapshot.`)
  } else if (implemented > 0) {
    steps.push(`Run the remaining /create-qras work: ${formatNum(implemented)} implemented runnable calls.`)
  }
  if (comparison > 0) {
    steps.push(`Keep ${formatNum(comparison)} control-to-control comparison candidate(s) review-gated until accepted /create-evidence-case responses make them runnable.`)
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
  if (status === 'running' || status === 'RUNNING') return EMBRY.blue
  if (status === 'not_wired' || status === 'NOT WIRED' || status === 'OPEN' || status === 'BLOCKED') return EMBRY.amber
  return EMBRY.red
}

function gateLabel(ok: boolean | undefined): string {
  if (ok === true) return 'PASS'
  if (ok === false) return 'FAIL'
  return 'UNKNOWN'
}

function promptAuditKeys(row: PromptAuditRow): string[] {
  const kind = row.prompt_kind
  if (!kind) return []
  const keys = new Set([kind])
  const spartaMatch = kind.match(/^sparta\/(?:canonical|relationship|standalone)\/(.+)$/)
  if (spartaMatch) keys.add(`sparta_${spartaMatch[1]}`)
  return [...keys]
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
    label: 'Run Read-Only Audit',
    description: 'Queue a read-only SPARTA supervisor audit command',
  })
  useRegisterAction('coverage:action:inspect-row', {
    app: 'sparta-explorer',
    action: 'INSPECT_COVERAGE_ROW',
    label: 'Inspect Row',
    description: 'Inspect a SPARTA coverage row without mutating data',
  })
  useRegisterAction('coverage:action:verify-row', {
    app: 'sparta-explorer',
    action: 'VERIFY_COVERAGE_ROW',
    label: 'Verify Row',
    description: 'Queue a read-only verification for a SPARTA coverage row',
  })
  useRegisterAction('coverage:action:plan-repair', {
    app: 'sparta-explorer',
    action: 'PLAN_REPAIR',
    label: 'Plan Repair',
    description: 'Queue a review-gated repair plan without executing mutations',
  })
  useRegisterAction('coverage:action:plan-all-repairs', {
    app: 'sparta-explorer',
    action: 'PLAN_ALL_REPAIRS',
    label: 'Plan All Repairs',
    description: 'Queue review-gated repair planning for all current coverage gaps',
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
          setData((current) => {
            if (!current) return current
            const next = { ...current, supervisor: message.state }
            writeLocalCache(next)
            return next
          })
        }
        if (message?.type === 'sparta-coverage-health' && message.payload) {
          setData(message.payload)
          if (message.payload.supervisor) setSupervisor(message.payload.supervisor)
          writeLocalCache(message.payload)
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

  useEffect(() => {
    if (data?.createQrasBackfill?.status !== 'running') return
    const timer = window.setInterval(load, 15000)
    return () => window.clearInterval(timer)
  }, [data?.createQrasBackfill?.status, load])

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

  const queueSupervisorCommand = useCallback(async (command: Record<string, unknown>, successLabel: string) => {
    setCommandMessage(null)
    try {
      const res = await fetch(`${API}/api/sparta/supervisor-command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`)
      setCommandMessage(`${successLabel}: ${body.command_id ?? 'supervisor command'}.`)
      loadSupervisor()
    } catch (err) {
      setCommandMessage(err instanceof Error ? err.message : String(err))
    }
  }, [loadSupervisor])

  const remaining: RemainingSummary = data?.monitor?.remaining ?? {}
  const createQrasBackfill = data?.createQrasBackfill
  const createQrasRunning = createQrasBackfill?.status === 'running'
  const createQrasPercent = Number(createQrasBackfill?.progress_percent ?? 0)
  const createQrasChunk = createQrasBackfill?.chunk
  const createQrasHeartbeat = createQrasBackfill?.heartbeat
  const createQrasStored = createQrasBackfill?.stored
  const checks = data?.monitor?.checks ?? []
  const bestPractices = data?.bestPractices ?? []
  const corpus = data?.corpus ?? {}
  const qraTrust = data?.qraTrust
  const corpusInventory = data?.corpusInventory ?? {}
  const controlFrameworks = data?.controlFrameworks ?? []
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
  const sourceTextQraCoverage = supervisorState?.source_text_qra_coverage
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
  const promptAuditByKind = Object.fromEntries(promptAuditRows.flatMap((row) => promptAuditKeys(row).map((key) => [key, row])))
  const hasData = Boolean(data?.corpus || data?.monitor || data?.bestPractices)
  const spartaNativeMissing =
    (promptKinds.sparta_tactic_canonical ?? 0) +
    (promptKinds.sparta_technique_canonical ?? 0) +
    (promptKinds.sparta_countermeasure_canonical ?? 0)
  const spartaRelationshipMissing =
    (promptKinds.sparta_tactic_technique_relationship ?? 0) +
    (promptKinds.sparta_technique_countermeasure_relationship ?? 0) +
    (remaining.sparta_control_to_control_gated_pairs ?? 0)
  const sortedControlFrameworks = [...controlFrameworks].sort((left, right) => {
    const rankDelta = frameworkRank(left.framework) - frameworkRank(right.framework)
    if (rankDelta !== 0) return rankDelta
    return String(left.framework ?? '').localeCompare(String(right.framework ?? ''))
  })
  const controlFrameworkRows = sortedControlFrameworks.map((row) => {
      const qualityGaps = Number(row.quality_gaps ?? 0)
      const missingDescriptions = Number(row.missing_descriptions ?? 0)
      const missingEmbeddings = Number(row.missing_embeddings ?? 0)
      return {
        framework: row.framework ?? 'UNKNOWN',
        frameworkSlug: frameworkSlug(row.framework),
        controls: Number(row.controls ?? 0),
        missingDescriptions,
        missingEmbeddings,
        qualityGaps,
        rawFrameworks: row.raw_frameworks ?? [],
        defects: row.defects ?? [],
        actionCode: row.action_code ?? (qualityGaps === 0 ? 'inspect_control_framework' : 'repair_control_quality'),
        actionLabel: row.action_label ?? (qualityGaps === 0 ? 'Inspect' : 'Plan Repair'),
        risk: row.risk ?? (qualityGaps === 0 ? 'read_only' : 'review_required'),
        safeDefault: row.safe_default ?? 'observe_only',
        requiresCheckpoint: row.requires_checkpoint ?? qualityGaps > 0,
        commandPayload: row.command_payload ?? { framework: row.framework, gap_count: qualityGaps },
        next: qualityGaps === 0
          ? 'Observe — framework inventory loaded; no quality gaps detected.'
          : `Repair quality gaps — ${formatNum(missingDescriptions)} short description(s), ${formatNum(missingEmbeddings)} missing embedding(s).`,
      }
    })
  const controlFrameworkSummary = controlFrameworkRows.reduce(
    (summary, row) => ({
      controls: summary.controls + row.controls,
      missingDescriptions: summary.missingDescriptions + row.missingDescriptions,
      missingEmbeddings: summary.missingEmbeddings + row.missingEmbeddings,
      qualityGaps: summary.qualityGaps + row.qualityGaps,
    }),
    { controls: 0, missingDescriptions: 0, missingEmbeddings: 0, qualityGaps: 0 },
  )
  const qualityGapFrameworks = controlFrameworkRows.filter((row) => row.qualityGaps > 0).map((row) => row.framework)
  const immediateSteps = getImmediateSteps({
    data,
    createQrasBackfill,
    heartbeatFresh,
    heartbeatAgeSeconds,
    reviewRequiredCount,
    attentionCount,
    dryRunPlanCount: remediationPlans.length,
    controlQualityGaps: controlFrameworkSummary.qualityGaps,
    qualityGapFrameworks,
  })
  const readinessBlockers = immediateSteps.filter((step) => !step.startsWith('Loading the first coverage snapshot') && !step.startsWith('Run the remaining /create-qras work'))
  const chatReady = hasData && readinessBlockers.length === 0 && controlFrameworkSummary.qualityGaps === 0
  const readinessStatus = chatReady ? 'READY' : 'BLOCKED'
  const readinessReason = chatReady
    ? 'All visible coverage and supervisor readiness gates are clean.'
    : readinessBlockers.slice(0, 3).join(' ')
  const personaReadinessRows = [
    {
      persona: 'Brandon Bailey',
      evidence: 'SPARTA source fidelity, CWE relevance, C2C grounding',
      blocking: controlFrameworkSummary.qualityGaps > 0 ? `${formatNum(controlFrameworkSummary.qualityGaps)} control-quality gap(s)` : readinessStatus === 'BLOCKED' ? 'Supervisor/readiness gates open' : 'none',
      action: 'Verify Brandon sample',
      command: 'conversation-lab readiness --persona brandon-bailey --dry-run',
    },
    {
      persona: 'Margaret Chen',
      evidence: 'Extraction fidelity, traceability, formalizable requirements',
      blocking: readinessStatus === 'BLOCKED' ? 'Trace/source sample signoff pending' : 'none',
      action: 'Verify V&V sample',
      command: 'conversation-lab readiness --persona margaret-chen --dry-run',
    },
    {
      persona: 'Jennifer Cheung',
      evidence: 'NIST/CMMC/CUI framing, RMF mission assurance',
      blocking: readinessStatus === 'BLOCKED' ? 'Compliance readiness sample pending' : 'none',
      action: 'Verify compliance sample',
      command: 'conversation-lab readiness --persona jennifer-cheung --dry-run',
    },
  ]
  const handleFrameworkAction = (row: (typeof controlFrameworkRows)[number]) => {
    const isRepair = row.qualityGaps > 0
    void queueSupervisorCommand({
      source: 'ui',
      intent: isRepair ? 'plan_control_quality_repair' : 'inspect_control_framework_quality',
      risk: isRepair ? 'mutation' : 'read_only',
      target_lane: 'control_quality',
      payload: {
        ...row.commandPayload,
        framework: row.framework,
        action_code: row.actionCode,
        safe_default: row.safeDefault,
        requires_checkpoint: row.requiresCheckpoint,
      },
    }, isRepair ? 'Queued review-gated repair plan' : 'Queued read-only inspection')
  }
  const handlePlanAllRepairs = () => {
    const rows = controlFrameworkRows.filter((row) => row.qualityGaps > 0)
    void queueSupervisorCommand({
      source: 'ui',
      intent: 'plan_all_control_quality_repairs',
      risk: 'mutation',
      target_lane: 'control_quality',
      payload: {
        safe_default: 'observe_only',
        requires_checkpoint: true,
        affected_frameworks: rows.map((row) => ({
          framework: row.framework,
          quality_gaps: row.qualityGaps,
          defects: row.defects,
        })),
      },
    }, 'Queued review-gated plan for all repairs')
  }
  const handlePersonaVerify = (persona: string) => {
    void queueSupervisorCommand({
      source: 'ui',
      intent: 'verify_persona_conversation_readiness',
      risk: 'read_only',
      target_lane: 'conversation_lab_readiness',
      payload: {
        persona,
        blockers: readinessBlockers,
        safe_default: 'observe_only',
      },
    }, `Queued ${persona} readiness verification`)
  }
  const qraTrustLabel = qraTrust?.label ?? 'System-Test Ready'
  const qraTrustStatus = qraTrust?.status ?? 'plausible_for_system_test'
  const qraQuestionSurface = checks.find((check) => check.dimension === 'qra_question_surface_quality')
  const qraQuestionSurfaceMalformed = Number(qraQuestionSurface?.malformed ?? 0)
  const qraQuestionSurfaceScanned = Number(qraQuestionSurface?.scanned ?? 0)
  const qraQuestionSurfaceCorrected = Number(qraQuestionSurface?.course_corrected_non_generation ?? 0)
  const qraEvidenceRows = [
    {
      lane: 'Question Surface Guard',
      status: qraQuestionSurface?.ok ? 'PASS' : qraQuestionSurface ? 'FAIL' : 'NOT LOADED',
      value: qraQuestionSurface
        ? `${formatNum(qraQuestionSurfaceMalformed)} malformed / ${formatNum(qraQuestionSurfaceScanned)} scanned; ${formatNum(qraQuestionSurfaceCorrected)} corrected`
        : 'monitor dimension missing',
      meaning: qraQuestionSurface?.output_path
        ? `Deterministic scanner output: ${qraQuestionSurface.output_path}`
        : 'Detects blank, title-only, control-ID-only, and opaque-key question surfaces.',
      action: qraQuestionSurfaceMalformed > 0 ? 'Review quarantine dry-run' : 'Observe',
    },
    {
      lane: 'Current QRA Trust',
      status: qraTrustLabel,
      value: qraTrustStatus,
      meaning: qraTrust?.use_policy ?? 'Current QRAs are plausible corpus artifacts for system testing; they are not yet Aerospace Corp expert-blessed answers.',
      action: qraTrust?.next_action ?? 'Use for verification-only system tests until expert blessing metadata exists.',
    },
    {
      lane: 'Expert Blessing',
      status: qraTrust?.expert_blessed ? 'EXPERT BLESSED' : 'NOT YET BLESSED',
      value: qraTrust?.expert_blessed ? (qraTrust.reviewer ?? 'reviewed') : 'pending Aerospace Corp review',
      meaning: qraTrust?.expert_blessed
        ? `Blessed at ${qraTrust.blessed_at ?? 'unknown time'}.`
        : 'Aerospace Corp cybersecurity experts will evaluate and bless QRAs after SPARTA Corpora and Explorer surfaces are complete.',
      action: qraTrust?.expert_blessed ? 'Inspect blessing provenance.' : 'Do not present as final expert-approved evidence.',
    },
    {
      lane: 'QRA Evidence Inventory',
      status: 'OBSERVE',
      value: `${formatNum(qraTrust?.counts?.total ?? corpus.qrasTotal)} total`,
      meaning: `${formatNum(qraTrust?.counts?.canonical ?? corpus.qrasCanonical)} canonical · ${formatNum(qraTrust?.counts?.relationship ?? corpus.qrasRelationship)} relationship · ${formatNum(qraTrust?.counts?.legacy ?? corpus.qrasLegacy)} legacy.`,
      action: 'Verify retrieval, evidence-case samples, and answer/clarify/deflect behavior before broad Chat use.',
    },
  ]
  const otherCorpusRows = [
    {
      lane: 'Canonical QRAs',
      have: corpus.qrasCanonical,
      gapType: 'generation',
      gapCount: spartaNativeMissing,
      next: spartaNativeMissing > 0 ? 'Run remaining SPARTA native QRA jobs.' : 'Observe — SPARTA native QRA backlog is complete.',
    },
    {
      lane: 'Relationship QRAs',
      have: corpus.qrasRelationship,
      gapType: 'generation',
      gapCount: spartaRelationshipMissing,
      next: spartaRelationshipMissing > 0 ? 'Run remaining SPARTA relationship + C2C jobs.' : 'Observe — relationship and C2C QRA backlog is complete.',
    },
    { lane: 'Legacy QRAs', have: corpus.qrasLegacy, gapType: 'reference', gapCount: corpusInventory.legacy_qras?.missing ?? 0, next: corpusInventory.legacy_qras?.next ?? 'Reference-only legacy corpus; excluded from completion target.' },
    { lane: 'Relationships', have: corpus.relationships, gapType: 'graph', gapCount: corpusInventory.relationships?.missing ?? 0, next: corpusInventory.relationships?.next ?? 'Relationship graph present; monitor relationship and crosswalk-chain checks are authoritative.' },
    { lane: 'URLs', have: corpus.urls, gapType: 'content', gapCount: corpusInventory.urls?.missing ?? 0, next: corpusInventory.urls?.next ?? 'URL fetch/content audit wired from sparta_urls and sparta_url_content.' },
    { lane: 'URL Knowledge', have: corpus.urlKnowledge, gapType: 'source text', gapCount: corpusInventory.url_knowledge?.missing ?? 0, next: corpusInventory.url_knowledge?.next ?? 'URL knowledge inventory wired from sparta_url_knowledge.' },
    { lane: 'Datalake Chunks', have: corpus.datalakeChunks, gapType: 'reference', gapCount: corpusInventory.datalake_chunks?.missing ?? 0, next: corpusInventory.datalake_chunks?.next ?? 'Generic datalake is reference inventory; SPARTA source embedding coverage is audited separately.' },
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
  const sourceTextStatus = String(sourceTextQraCoverage?.status ?? 'blocked').toLowerCase()
  const sourceTextSummary = sourceTextQraCoverage?.summary ?? {}
  const sourceTextBackfill = sourceTextQraCoverage?.backfill as Record<string, unknown> | undefined
  const sourceTextManifest = sourceTextBackfill?.manifest as Record<string, unknown> | null | undefined
  const sourceTextMeaning = sourceTextManifest?.path
    ? `${sourceTextQraCoverage?.resume_hint ?? 'Review generated source text/QRA manifest.'} Manifest: ${sourceTextManifest.path}`
    : sourceTextQraCoverage?.resume_hint ?? 'Controls and valid URLs need non-stub text and valid QRAs.'
  const sourceTextRow = (
    lane: string,
    gapKey: string,
    passValue: string,
    failSuffix: string,
    meaning: string,
  ) => {
    const gaps = Number(sourceTextSummary[gapKey] ?? 0)
    return {
      lane,
      status: sourceTextStatus === 'blocked' ? 'BLOCKED' : gaps === 0 ? 'PASS' : 'FAIL',
      value: gaps === 0 ? passValue : `${formatNum(gaps)} ${failSuffix}`,
      meaning: gaps === 0 ? meaning : `${meaning} ${sourceTextMeaning}`,
      action: gaps === 0 ? 'Observe' : 'Review Backfill',
    }
  }
  const aggregateRows = [
    {
      lane: 'QRA Generation',
      status: createQrasRunning ? 'RUNNING' : (remaining.implemented_backlog_total_if_v2_sparta_native_required ?? 0) === 0 ? 'PASS' : 'OPEN',
      value: createQrasRunning ? (
        <div data-qid="coverage:qra-generation:progress" data-entity-type="create-qras-progress" data-status="running" style={S.progressCell}>
          <div style={S.progressTopline}>
            {createQrasChunk?.current && createQrasChunk?.total
              ? `chunk ${formatNum(createQrasChunk.current)} / ${formatNum(createQrasChunk.total)}`
              : 'worker active'}
            <span style={S.progressPercent}>{formatNum(createQrasPercent)}%</span>
          </div>
          <div style={S.progressTrack} aria-label="create-qras backfill progress">
            <span style={{ ...S.progressBar, width: `${Math.max(3, Math.min(100, createQrasPercent || 3))}%` }} />
          </div>
          <div style={S.progressMeta}>
            {formatNum(remaining.implemented_backlog_total_if_v2_sparta_native_required)} runnable calls remain · {formatNum(createQrasStored?.total)} stored in manifest
          </div>
        </div>
      ) : (remaining.implemented_backlog_total_if_v2_sparta_native_required ?? 0) === 0
        ? `${formatNum(remaining.sparta_control_to_control_gated_pairs)} review-gated`
        : `${formatNum(remaining.implemented_backlog_total_if_v2_sparta_native_required)} runnable calls remaining`,
      meaning: createQrasRunning
        ? `${createQrasBackfill?.message ?? 'create-qras worker active'} Pending ${formatNum(createQrasHeartbeat?.pending)} job(s); log age ${formatNum(createQrasBackfill?.current_log_age_seconds)}s.`
        : `${formatNum(remaining.implemented_backlog_total_if_v2_sparta_native_required)} implemented runnable + ${formatNum(remaining.sparta_control_to_control_gated_pairs)} review-gated comparison candidate(s).`,
      action: createQrasRunning ? 'Monitor' : 'Observe',
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
      action: 'Observe',
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
    sourceTextRow(
      'Control Text Coverage',
      'control_text_missing_or_stub',
      `${formatNum(sourceTextQraCoverage?.controls?.text_ok)} text ok`,
      'missing/stubbed',
      'Every control should have non-stub name/description text.',
    ),
    sourceTextRow(
      'Control QRA Coverage',
      'control_qra_missing',
      `${formatNum(sourceTextQraCoverage?.controls?.qra_ok)} QRA covered`,
      'missing QRA',
      'Every in-scope text-backed control should have at least one valid QRA.',
    ),
    sourceTextRow(
      'URL Text Coverage',
      'url_text_missing_or_stub',
      `${formatNum(sourceTextQraCoverage?.urls?.text_ok)} URL text ok`,
      'missing/stubbed',
      'Every SPARTA QRA-scope URL should have fetched non-stub page text; the full sparta_urls table is a broader normalized corpus inventory.',
    ),
    sourceTextRow(
      'URL QRA Coverage',
      'url_qra_missing',
      `${formatNum(sourceTextQraCoverage?.urls?.qra_ok)} URL QRA covered`,
      'missing QRA',
      'SPARTA URL-QRA scope follows the preflight inventory, not all sparta_urls rows; covered means direct standalone URL QRA or mediated control QRA through sparta_url_knowledge.control_ids.',
    ),
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
            Run Read-Only Audit
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
      <section data-qid="coverage:project-status-strip" data-entity-type="project-status" style={{ ...S.statusStrip, borderColor: `${liveTone}66` }}>
        <div>
          <div style={S.statusEyebrow}>Project Status</div>
          <strong style={{ ...S.statusTitle, color: liveTone }}>{liveLabel === 'Live' ? 'Live snapshot' : `${liveLabel} snapshot`}</strong>
          <span style={S.statusText}>
            heartbeat {heartbeatAgeSeconds == null ? 'not loaded' : `${heartbeatAgeSeconds}s`} · snapshot {data?.generated_at ? new Date(data.generated_at).toLocaleString() : 'not loaded'} · next {typeof nextScheduled?.action === 'string' ? nextScheduled.action : 'not scheduled'}
          </span>
        </div>
        <div style={S.statusMetrics}>
          <span data-qid="coverage:qra-generation:live-worker" data-entity-type="create-qras-worker" data-status={createQrasRunning ? 'running' : 'idle'} style={{ ...S.statusMetric, borderColor: createQrasRunning ? `${EMBRY.blue}66` : EMBRY.border, color: createQrasRunning ? EMBRY.blue : EMBRY.white }}>
            <b>{createQrasRunning ? 'RUNNING' : 'idle'}</b> create-qras
          </span>
          <span style={S.statusMetric}><b>{supervisorState?.active_jobs?.length ?? 0}</b> active jobs</span>
          <span style={S.statusMetric}><b>{reviewRequiredCount}</b> review gates</span>
          <span style={S.statusMetric}><b>{attentionCount}</b> attention</span>
          <span style={S.statusMetric}><b>{remediationPlans.length}</b> dry-run plans</span>
        </div>
      </section>
      {!hasData ? (
        <div style={S.loadingPanel}>
          <strong>Loading coverage snapshot.</strong>
          <span>The full monitor-sparta audit is slow. This page will not render empty metric boxes as evidence.</span>
        </div>
      ) : null}

      <Section title="Immediate Next Steps" subtitle="Actionable blockers derived from the current live audit snapshot.">
        <ol style={S.steps}>
          {immediateSteps.map((step) => <li key={step} style={S.step}>{step}</li>)}
        </ol>
      </Section>

      {hasData ? <Section title="State At A Glance" subtitle="Aggregate status first; details follow below.">
        <div style={S.tableCard}>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Lane</th><th style={S.th}>Status</th><th style={S.th}>Value</th><th style={S.th}>Meaning</th><th style={S.th}>Next</th></tr></thead>
            <tbody>
              {aggregateRows.map((row) => (
                <tr key={row.lane} data-qid={`coverage:aggregate:${frameworkSlug(row.lane)}`} data-entity-type="coverage-aggregate-lane" data-status={String(row.status)}>
                  <td style={S.td}>{row.lane}</td>
                  <td style={S.td}><span style={{ ...S.pill, color: statusColor(row.status, row.status === 'PASS'), borderColor: `${statusColor(row.status, row.status === 'PASS')}66` }}>{row.status}</span></td>
                  <td style={S.tdStrong}>{row.value}</td>
                  <td style={S.td}>{row.meaning}</td>
                  <td style={S.td}><span style={S.nextText}>{row.action}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section> : null}

      {hasData ? <Section title="Chat / Conversation-Lab Readiness" subtitle="Persona conversations remain blocked until visible data-quality and supervisor gates are clean.">
        <div style={S.tableCard}>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Persona</th><th style={S.th}>Required Evidence</th><th style={S.th}>Status</th><th style={S.th}>Blocking Gaps</th><th style={S.th}>Next Action</th></tr></thead>
            <tbody>
              {personaReadinessRows.map((row) => (
                <tr key={row.persona} data-qid={`coverage:readiness:${frameworkSlug(row.persona)}`} data-entity-type="persona-readiness" data-status={readinessStatus}>
                  <td style={S.td}>{row.persona}</td>
                  <td style={S.td}>{row.evidence}</td>
                  <td style={S.td}><span style={{ ...S.pill, color: chatReady ? EMBRY.green : EMBRY.amber, borderColor: `${chatReady ? EMBRY.green : EMBRY.amber}66` }}>{readinessStatus}</span></td>
                  <td style={S.td}>{row.blocking}</td>
                  <td style={S.td}>
                    <button data-qid={`coverage:readiness:verify:${frameworkSlug(row.persona)}`} data-qs-action="VERIFY_PERSONA_READINESS" title={`${row.action}: ${row.command}`} onClick={() => handlePersonaVerify(row.persona)} style={S.rowButton}>Verify</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ ...S.metaLine, color: chatReady ? EMBRY.green : EMBRY.amber }}>
          {chatReady ? 'Chat is ready for normal SPARTA use.' : `Pre-signoff mode: ${readinessReason}`}
        </div>
      </Section> : null}

      {hasData ? (
        <Section title="SPARTA Corpora" subtitle="Inventory composition and actionable gaps by corpus type. Control rows show quality gaps only; QRA rows show generation backlog.">
          <div style={S.tableCard}>
            <div style={S.tableTitleRow}>
              <h3 style={S.tableTitleInline}>Controls by Source Framework</h3>
              <button data-qid="coverage:corpora:controls:plan-all-repairs" data-qs-action="PLAN_ALL_REPAIRS" title="Plan all current control-quality repairs behind supervisor review" disabled={controlFrameworkSummary.qualityGaps === 0} onClick={handlePlanAllRepairs} style={{ ...S.rowButton, opacity: controlFrameworkSummary.qualityGaps === 0 ? 0.45 : 1, cursor: controlFrameworkSummary.qualityGaps === 0 ? 'not-allowed' : 'pointer' }}>
                Plan All Repairs
              </button>
            </div>
            <div style={S.tableNote}>Counts show source-framework inventory composition, not coverage quality or framework priority.</div>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Framework</th><th style={S.th}>Controls</th><th style={S.th}>Short Desc</th><th style={S.th}>Embedding</th><th style={S.th}>Quality Gaps</th><th style={S.th}>Next Action</th></tr></thead>
              <tbody>
                {controlFrameworkRows.length > 0 ? (
                  <>
                    <tr data-qid="coverage:corpora:controls:all-frameworks" data-entity-type="control-framework-summary" data-controls={controlFrameworkSummary.controls} data-quality-gaps={controlFrameworkSummary.qualityGaps} data-action-code={controlFrameworkSummary.qualityGaps === 0 ? 'observe' : 'repair_control_quality'} style={S.summaryRow}>
                      <td style={S.td}>Controls, all frameworks</td>
                      <td style={S.tdStrong}>{formatNum(controlFrameworkSummary.controls)}</td>
                      <td style={S.tdStrong}>{formatNum(controlFrameworkSummary.missingDescriptions)}</td>
                      <td style={S.tdStrong}>{formatNum(controlFrameworkSummary.missingEmbeddings)}</td>
                      <td style={{ ...S.tdStrong, color: controlFrameworkSummary.qualityGaps === 0 ? EMBRY.dim : EMBRY.amber }}>{formatNum(controlFrameworkSummary.qualityGaps)}</td>
                      <td style={S.td}>Inventory loaded; inspect framework composition below.</td>
                    </tr>
                    {controlFrameworkRows.map((row) => (
                      <tr
                        key={row.framework}
                        data-qid={`coverage:corpora:controls:${row.frameworkSlug}`}
                        data-entity-type="control-framework"
                        data-framework={row.framework}
                        data-controls={row.controls}
                        data-quality-gaps={row.qualityGaps}
                        data-missing-descriptions={row.missingDescriptions}
                        data-missing-embeddings={row.missingEmbeddings}
                        data-action-code={row.actionCode}
                        data-raw-frameworks={row.rawFrameworks.join('|')}
                      >
                        <td style={S.td} title={row.rawFrameworks.length ? `Raw aliases: ${row.rawFrameworks.join(', ')}` : undefined}>
                          <span style={S.frameworkLabel}>{row.framework}</span>
                        </td>
                        <td style={S.tdStrong}>{formatNum(row.controls)}</td>
                        <td style={S.tdStrong}>{formatNum(row.missingDescriptions)}</td>
                        <td style={S.tdStrong}>{formatNum(row.missingEmbeddings)}</td>
                        <td style={{ ...S.tdStrong, color: row.qualityGaps === 0 ? EMBRY.dim : EMBRY.amber }}>{formatNum(row.qualityGaps)}</td>
                        <td style={S.td}>
                          <div style={S.actionStack}>
                            <span>{row.next}</span>
                            <div style={S.actionButtons}>
                              <button data-qid={`coverage:corpora:controls:${row.frameworkSlug}:inspect`} data-qs-action="INSPECT_COVERAGE_ROW" title={`Inspect ${row.framework} evidence and inventory`} onClick={() => handleFrameworkAction({ ...row, qualityGaps: 0, actionCode: 'inspect_control_framework', actionLabel: 'Inspect' })} style={S.rowButton}>Inspect</button>
                              <button data-qid={`coverage:corpora:controls:${row.frameworkSlug}:verify`} data-qs-action="VERIFY_COVERAGE_ROW" title={`Run read-only verification for ${row.framework}`} onClick={() => handleFrameworkAction({ ...row, qualityGaps: 0, actionCode: 'verify_control_framework', actionLabel: 'Verify' })} style={S.rowButton}>Verify</button>
                              {row.qualityGaps > 0 ? <button data-qid={`coverage:corpora:controls:${row.frameworkSlug}:plan-repair`} data-qs-action="PLAN_REPAIR" title={`Plan review-gated repair for ${row.framework}`} onClick={() => handleFrameworkAction(row)} style={{ ...S.rowButton, color: EMBRY.amber, borderColor: `${EMBRY.amber}66` }}>Plan Repair</button> : null}
                            </div>
                            {row.defects.length ? (
                              <div style={S.defectList}>
                                {row.defects.map((defect) => (
                                  <div key={`${row.framework}-${defect.control_id}-${defect.gap_types?.join('-')}`} style={S.defectItem}>
                                    <code style={S.inlineCode}>{defect.control_id ?? 'unknown'}</code>
                                    {' '}· {defect.gap_types?.join(', ') ?? 'quality_gap'}
                                    {' '}· desc len {formatNum(defect.description_length)}
                                    {defect.title ? ` · ${defect.title}` : ''}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                ) : (
                  <tr data-qid="coverage:corpora:controls:framework-inventory-missing" data-entity-type="control-framework-diagnostic" data-action-code="inspect_api_mapping">
                    <td style={S.td}>Controls by Framework</td>
                    <td style={S.tdStrong}>not loaded</td>
                    <td style={S.tdStrong}>not loaded</td>
                    <td style={S.tdStrong}>not loaded</td>
                    <td style={{ ...S.tdStrong, color: EMBRY.amber }}>not loaded</td>
                    <td style={S.td}>Framework inventory missing from payload; inspect <code style={S.inlineCode}>/api/sparta/coverage-health.controlFrameworks</code>.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ ...S.tableCard, marginTop: 12 }}>
            <h3 style={S.tableTitle}>QRA Evidence Layer</h3>
            <div style={S.tableNote}>Current QRAs are system-test artifacts until Aerospace Corp cybersecurity experts complete blessing review.</div>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Lane</th><th style={S.th}>Status</th><th style={S.th}>Value</th><th style={S.th}>Meaning</th><th style={S.th}>Next Action</th></tr></thead>
              <tbody>
                {qraEvidenceRows.map((row) => (
                  <tr
                    key={row.lane}
                    data-qid={`coverage:qra-trust:${frameworkSlug(row.lane)}`}
                    data-entity-type="qra-trust"
                    data-trust-status={qraTrustStatus}
                    data-expert-blessed={qraTrust?.expert_blessed ? 'true' : 'false'}
                  >
                    <td style={S.td}>{row.lane}</td>
                    <td style={S.td}><span style={{ ...S.pill, color: row.status === 'System-Test Ready' ? EMBRY.amber : qraTrust?.expert_blessed ? EMBRY.green : EMBRY.dim, borderColor: `${row.status === 'System-Test Ready' ? EMBRY.amber : qraTrust?.expert_blessed ? EMBRY.green : EMBRY.dim}66` }}>{row.status}</span></td>
                    <td style={S.tdStrong}>{row.value}</td>
                    <td style={S.td}>{row.meaning}</td>
                    <td style={S.td}>{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ ...S.tableCard, marginTop: 12 }}>
            <h3 style={S.tableTitle}>Other Corpora and QRA Backlog</h3>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Framework / Corpus</th><th style={S.th}>Have</th><th style={S.th}>Gap Type</th><th style={S.th}>Gap Count</th><th style={S.th}>Next Action</th></tr></thead>
              <tbody>
                {otherCorpusRows.map((row) => (
                  <tr key={row.lane} data-qid={`coverage:corpora:other:${frameworkSlug(row.lane)}`} data-entity-type="corpus-inventory" data-gap-type={row.gapType} data-gap-count={row.gapCount}>
                    <td style={S.td}>{row.lane}</td>
                    <td style={S.tdStrong}>{formatNum(row.have)}</td>
                    <td style={S.td}>{row.gapType}</td>
                    <td style={S.tdStrong}>{formatMaybe(row.gapCount)}</td>
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
          <StatCard label="Runnable Remaining" value={remaining.implemented_backlog_total_if_v2_sparta_native_required} tone={(remaining.implemented_backlog_total_if_v2_sparta_native_required ?? 0) === 0 ? EMBRY.green : EMBRY.amber} note="Native + SPARTA v2 residuals" />
          <StatCard label="Review-Gated C2C" value={remaining.sparta_control_to_control_gated_pairs} tone={EMBRY.blue} note="Requires accepted CAE" />
          <StatCard label="Open Audit Total" value={remaining.exact_remaining_calls_total} tone={EMBRY.dim} note="Runnable + review-gated" />
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

      <Section title="Supervisor Details" subtitle="Browser WebSocket status, durable monitor-sparta heartbeat, and queued action visibility.">
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

      {hasData ? <Section title="Best Practices & UX Coverage" subtitle="Reports wired lane scanners only; blocked work must appear as FAIL/BLOCKED with a concrete owner, never as an unwired placeholder.">
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
  statusStrip: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap', border: '1px solid', background: EMBRY.bgPanel, padding: '12px 14px', marginBottom: 14 },
  statusEyebrow: { fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: EMBRY.dim, fontWeight: 800 },
  statusTitle: { display: 'block', fontSize: 18, lineHeight: 1.25 },
  statusText: { display: 'block', color: EMBRY.muted, fontSize: 12, marginTop: 3 },
  statusMetrics: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  statusMetric: { border: `1px solid ${EMBRY.border}`, padding: '3px 7px', fontSize: 11, background: '#172033', color: EMBRY.white },
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
  tableTitleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 12, borderBottom: `1px solid ${EMBRY.border}` },
  tableTitleInline: { fontSize: 12, margin: 0, color: EMBRY.white },
  tableNote: { padding: '10px 12px', color: EMBRY.muted, fontSize: 12, borderBottom: `1px solid ${EMBRY.border}` },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { padding: '10px 12px', color: EMBRY.dim, textAlign: 'left', borderBottom: `1px solid ${EMBRY.border}`, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' },
  td: { padding: '10px 12px', color: EMBRY.white, borderBottom: `1px solid ${EMBRY.border}`, verticalAlign: 'top' },
  tdStrong: { padding: '10px 12px', color: EMBRY.white, borderBottom: `1px solid ${EMBRY.border}`, verticalAlign: 'top', fontSize: 15, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace' },
  progressCell: { minWidth: 240, display: 'grid', gap: 6 },
  progressTopline: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', color: EMBRY.white, fontFamily: 'JetBrains Mono, monospace', fontWeight: 900 },
  progressPercent: { color: EMBRY.blue, fontSize: 12 },
  progressTrack: { height: 7, border: `1px solid ${EMBRY.border}`, background: '#0b1220', overflow: 'hidden' },
  progressBar: { display: 'block', height: '100%', background: EMBRY.blue, boxShadow: `0 0 12px ${EMBRY.blue}66` },
  progressMeta: { color: EMBRY.dim, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
  summaryRow: { background: 'rgba(148, 163, 184, 0.06)' },
  frameworkLabel: { display: 'inline-flex', paddingLeft: 10, borderLeft: `3px solid ${EMBRY.blue}`, minHeight: 18, alignItems: 'center' },
  pill: { display: 'inline-flex', border: '1px solid', padding: '3px 7px', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em' },
  nextText: { color: EMBRY.muted, fontSize: 12, lineHeight: 1.35 },
  actionStack: { display: 'grid', gap: 8 },
  actionButtons: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  rowButton: { border: `1px solid ${EMBRY.border}`, background: '#172033', color: EMBRY.white, padding: '5px 8px', minHeight: 30, fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer' },
  defectList: { display: 'grid', gap: 4, paddingTop: 4 },
  defectItem: { color: EMBRY.muted, fontSize: 11, lineHeight: 1.45 },
  artifacts: { display: 'grid', gap: 8 },
  code: { display: 'block', padding: 10, background: '#0b0b0b', border: `1px solid ${EMBRY.border}`, color: EMBRY.dim, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  inlineCode: { color: EMBRY.dim, fontSize: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  footer: { fontSize: 11, color: EMBRY.dim, paddingBottom: 20 },
}
