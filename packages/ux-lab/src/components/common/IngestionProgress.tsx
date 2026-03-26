/**
 * IngestionProgress — SSE-driven binary ingestion pipeline tracker.
 *
 * Renders 6 vertical pipeline stages with EMBRY NVIS tokens.
 * Running stage pulses amber; top progress bar advances per completed stage.
 * Fires onComplete(stats) when all stages finish.
 */
import { useEffect, useRef, useState } from 'react'
import { EMBRY, card, label, heading } from './EmbryStyle'

// ─── Types ────────────────────────────────────────────────────────────────────

interface IngestEvent {
  stage: number
  status: 'running' | 'done' | 'failed'
  message: string
  detail?: { count: number }
}

interface StageState {
  status: 'pending' | 'running' | 'done' | 'failed'
  message: string
  detail?: { count: number }
  startedAt?: number
  completedAt?: number
}

export interface IngestStats {
  nodes: number
  edges: number
}

export interface IngestionProgressProps {
  /** SSE endpoint URL — e.g. /api/binary/ingest */
  endpoint: string
  /** Display name of the binary being ingested */
  binaryName: string
  /** Called once when all stages complete successfully */
  onComplete: (stats: IngestStats) => void
}

// ─── Stage definitions (matches analyze-elf pipeline) ─────────────────────────

const STAGE_NAMES: Record<number, string> = {
  1: 'Initialize',
  2: 'Deterministic Extraction',
  3: 'JS Beautify',
  4: 'TreeSitter Parse',
  5: 'Graph Store',
  6: 'Complete',
}

const TOTAL_STAGES = 6

// ─── Keyframe CSS (injected once) ─────────────────────────────────────────────

const PROGRESS_CSS = `
@keyframes embry-amber-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(255,170,0,0.45); }
  50%       { opacity: 0.75; box-shadow: 0 0 20px rgba(255,170,0,0.85); }
}
.embry-stage-running {
  animation: embry-amber-pulse 1.4s ease-in-out infinite;
}
`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StageIcon({ status }: { status: StageState['status'] }) {
  if (status === 'done') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-label="done">
        <circle cx="8" cy="8" r="7" fill={`${EMBRY.green}22`} stroke={EMBRY.green} strokeWidth="1.5" />
        <path d="M5 8l2 2 4-4" stroke={EMBRY.green} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (status === 'failed') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-label="failed">
        <circle cx="8" cy="8" r="7" fill={`${EMBRY.red}22`} stroke={EMBRY.red} strokeWidth="1.5" />
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke={EMBRY.red} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (status === 'running') {
    return (
      <span
        className="embry-stage-running"
        aria-label="running"
        style={{
          display: 'inline-block',
          width: 14,
          height: 14,
          borderRadius: '50%',
          backgroundColor: EMBRY.amber,
          flexShrink: 0,
        }}
      />
    )
  }
  // pending
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-label="pending">
      <circle cx="8" cy="8" r="6.25" stroke={EMBRY.muted} strokeWidth="1.5" strokeDasharray="3.5 2.5" />
    </svg>
  )
}

function StatusBadge({ status }: { status: 'connecting' | 'running' | 'done' | 'failed' }) {
  const cfg: Record<string, { label: string; color: string }> = {
    connecting: { label: 'Connecting', color: EMBRY.blue },
    running:    { label: 'Running',    color: EMBRY.amber },
    done:       { label: 'Done',       color: EMBRY.green },
    failed:     { label: 'Failed',     color: EMBRY.red },
  }
  const { label: text, color } = cfg[status]
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 700,
      padding: '3px 8px',
      borderRadius: 4,
      color,
      backgroundColor: `${color}18`,
      border: `1px solid ${color}33`,
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
      whiteSpace: 'nowrap' as const,
    }}>
      {text}
    </span>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function IngestionProgress({ endpoint, binaryName, onComplete }: IngestionProgressProps) {
  const [stages, setStages] = useState<StageState[]>(
    Array.from({ length: TOTAL_STAGES }, () => ({
      status: 'pending' as const,
      message: '',
    }))
  )
  const [overallStatus, setOverallStatus] = useState<'connecting' | 'running' | 'done' | 'failed'>('connecting')
  const [stats, setStats] = useState<IngestStats>({ nodes: 0, edges: 0 })

  // Stable refs so closures inside useEffect always see current values
  const statsRef    = useRef<IngestStats>({ nodes: 0, edges: 0 })
  const doneRef     = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    doneRef.current = false
    statsRef.current = { nodes: 0, edges: 0 }

    const es = new EventSource(endpoint)

    es.onopen = () => setOverallStatus('running')

    es.onmessage = (e: MessageEvent<string>) => {
      const event: IngestEvent = JSON.parse(e.data)
      const idx = event.stage - 1 // 0-based index

      const now = Date.now()

      setStages(prev => {
        const next = [...prev]
        const existing = next[idx] ?? { status: 'pending' as const, message: '' }

        next[idx] = {
          ...existing,
          status: event.status,
          message: event.message,
          detail: event.detail ?? existing.detail,
          startedAt: existing.startedAt ?? now,
          completedAt:
            event.status === 'done' || event.status === 'failed' ? now : existing.completedAt,
        }

        // Accumulate node count from detail
        if (event.detail?.count) {
          statsRef.current = {
            nodes: statsRef.current.nodes + event.detail.count,
            edges: statsRef.current.edges,
          }
          setStats({ ...statsRef.current })
        }

        // Stage 5 done → synthesise Stage 6 "Complete" and finish
        if (event.stage === 5 && event.status === 'done' && !doneRef.current) {
          doneRef.current = true
          next[5] = {
            status: 'done',
            message: 'Ingestion complete',
            startedAt: now,
            completedAt: now,
          }
          setOverallStatus('done')
          // Fire callback after this render
          setTimeout(() => onCompleteRef.current(statsRef.current), 0)
          es.close()
        }

        return next
      })

      if (event.status === 'failed') {
        setOverallStatus('failed')
        es.close()
      }
    }

    es.onerror = () => {
      setOverallStatus(prev => (prev === 'done' ? 'done' : 'failed'))
      es.close()
    }

    return () => {
      es.close()
    }
  }, [endpoint])

  const completedCount = stages.filter(s => s.status === 'done').length
  const progressPct    = (completedCount / TOTAL_STAGES) * 100
  const barColor       = overallStatus === 'failed' ? EMBRY.red : EMBRY.green

  return (
    <>
      <style>{PROGRESS_CSS}</style>

      <div
        role="region"
        aria-label="Binary ingestion progress"
        style={{
          ...card,
          width: '100%',
          maxWidth: 520,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={heading}>Ingesting Binary</div>
            <div style={{ fontSize: 11, color: EMBRY.dim, marginTop: 3, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {binaryName}
            </div>
          </div>
          <StatusBadge status={overallStatus} />
        </div>

        {/* ── Thin progress bar ── */}
        <div
          role="progressbar"
          aria-valuenow={completedCount}
          aria-valuemax={TOTAL_STAGES}
          style={{
            height: 3,
            backgroundColor: EMBRY.muted,
            borderRadius: 2,
            overflow: 'hidden',
            marginBottom: 18,
          }}
        >
          <div style={{
            height: '100%',
            width: `${progressPct}%`,
            backgroundColor: barColor,
            borderRadius: 2,
            transition: 'width 0.4s ease',
            boxShadow: `0 0 6px ${barColor}88`,
          }} />
        </div>

        {/* ── Stage list ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {stages.map((stage, i) => {
            const stageNum  = i + 1
            const name      = STAGE_NAMES[stageNum] ?? `Stage ${stageNum}`
            const isRunning = stage.status === 'running'
            const duration  =
              stage.startedAt != null && stage.completedAt != null
                ? formatDuration(stage.completedAt - stage.startedAt)
                : null

            const nameColor =
              stage.status === 'pending' ? EMBRY.muted
              : stage.status === 'done'    ? EMBRY.white
              : stage.status === 'running' ? EMBRY.amber
              : EMBRY.red

            return (
              <div
                key={stageNum}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  backgroundColor: isRunning ? `${EMBRY.amber}0d` : 'transparent',
                  border: `1px solid ${isRunning ? EMBRY.amber + '33' : 'transparent'}`,
                  transition: 'background-color 0.25s, border-color 0.25s',
                }}
              >
                {/* Icon */}
                <div style={{ marginTop: 1, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                  <StageIcon status={stage.status} />
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* Stage number chip */}
                    <span style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: EMBRY.dim,
                      fontFamily: 'monospace',
                      flexShrink: 0,
                    }}>
                      {String(stageNum).padStart(2, '0')}
                    </span>

                    {/* Stage name */}
                    <span style={{ fontSize: 12, fontWeight: 700, color: nameColor }}>
                      {name}
                    </span>

                    {/* Duration */}
                    {duration && (
                      <span style={{
                        fontSize: 10,
                        color: EMBRY.dim,
                        fontFamily: 'monospace',
                        marginLeft: 'auto',
                      }}>
                        {duration}
                      </span>
                    )}

                    {/* Node count badge */}
                    {stage.detail?.count != null && (
                      <span style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: 4,
                        color: EMBRY.green,
                        backgroundColor: `${EMBRY.green}18`,
                        border: `1px solid ${EMBRY.green}33`,
                        fontFamily: 'monospace',
                      }}>
                        {stage.detail.count.toLocaleString()} nodes
                      </span>
                    )}
                  </div>

                  {/* Detail message */}
                  {stage.message && stage.status !== 'pending' && (
                    <div style={{
                      fontSize: 10,
                      color: EMBRY.dim,
                      marginTop: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontFamily: 'monospace',
                    }}>
                      {stage.message}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Summary stats (complete) ── */}
        {overallStatus === 'done' && (
          <div style={{
            marginTop: 16,
            padding: '12px 16px',
            backgroundColor: `${EMBRY.green}0d`,
            border: `1px solid ${EMBRY.green}33`,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 28,
          }}>
            <div>
              <div style={{ ...label }}>Nodes</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: EMBRY.green, fontFamily: 'monospace', lineHeight: 1.2 }}>
                {stats.nodes.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ ...label }}>Edges</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: EMBRY.blue, fontFamily: 'monospace', lineHeight: 1.2 }}>
                {stats.edges.toLocaleString()}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="6" fill={`${EMBRY.green}22`} stroke={EMBRY.green} strokeWidth="1.5" />
                <path d="M4.5 7l1.8 1.8 3.2-3.6" stroke={EMBRY.green} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontSize: 11, fontWeight: 700, color: EMBRY.green }}>
                Ingestion complete
              </span>
            </div>
          </div>
        )}

        {/* ── Error state ── */}
        {overallStatus === 'failed' && (
          <div style={{
            marginTop: 16,
            padding: '10px 16px',
            backgroundColor: `${EMBRY.red}0d`,
            border: `1px solid ${EMBRY.red}33`,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: EMBRY.red,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" fill={`${EMBRY.red}22`} stroke={EMBRY.red} strokeWidth="1.5" />
              <path d="M7 4v3.5M7 9.5v.5" stroke={EMBRY.red} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Ingestion failed — check server logs for details
          </div>
        )}
      </div>
    </>
  )
}
