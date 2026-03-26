import { useState, useEffect, useRef } from 'react'
import { EMBRY, card, heading, label } from '../sparta/common/EmbryStyle'
import { useAgentBus } from '../sparta/common/useAgentBus'

interface StageEvent {
  stage: string
  status: 'running' | 'passed' | 'failed' | 'done'
  detail: string
  data: Record<string, unknown>
  ts: number
}

interface PipelineState {
  project: string
  active: boolean
  stages: StageEvent[]
}

const STAGE_LABELS: Record<string, string> = {
  S00_lore_recall: 'Lore Recall',
  S01_references: 'Reference Songs',
  S02_lyrics_create: 'Lyrics Creation',
  S03_lyrics_converge: 'Lyrics Convergence',
  S04_annotate: 'Annotation',
  S05_spec: 'Piano Roll Spec',
  S06_audio_converge: 'Audio Convergence',
  S07_voice: 'Voice Identity',
}

const STAGE_ORDER = Object.keys(STAGE_LABELS)

const STATUS_COLOR: Record<string, string> = {
  running: EMBRY.blue,
  passed: EMBRY.green,
  failed: EMBRY.red,
  done: EMBRY.dim,
}

export function MusicPipelineView() {
  const [pipeline, setPipeline] = useState<PipelineState>({ project: '', active: false, stages: [] })
  const endRef = useRef<HTMLDivElement>(null)

  const { connected } = useAgentBus((msg) => {
    if (msg.type === 'pipeline-start') {
      setPipeline({ project: msg.payload.project as string, active: true, stages: [] })
    } else if (msg.type === 'pipeline-stage') {
      const ev = msg.payload as unknown as StageEvent
      setPipeline(prev => ({ ...prev, stages: [...prev.stages, ev] }))
    } else if (msg.type === 'pipeline-done') {
      setPipeline(prev => ({ ...prev, active: false }))
    }
  })

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [pipeline.stages.length])

  // Build stage status map from events
  const stageStatus = new Map<string, StageEvent>()
  for (const ev of pipeline.stages) {
    stageStatus.set(ev.stage, ev)
  }

  // Progress
  const completed = STAGE_ORDER.filter(s => {
    const ev = stageStatus.get(s)
    return ev && (ev.status === 'passed' || ev.status === 'failed')
  }).length
  const pct = STAGE_ORDER.length > 0 ? (completed / STAGE_ORDER.length) * 100 : 0

  return (
    <div style={{ ...card, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...heading, fontSize: 14 }}>Pipeline</span>
          {pipeline.project && (
            <span style={{ ...label, fontSize: 10, color: EMBRY.accent }}>{pipeline.project}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%',
            backgroundColor: !connected ? EMBRY.red : pipeline.active ? EMBRY.blue : EMBRY.dim,
            boxShadow: pipeline.active ? `0 0 8px ${EMBRY.blue}` : 'none' }} />
          <span style={{ ...label, fontSize: 9 }}>
            {!connected ? 'disconnected' : pipeline.active ? 'running' : 'idle'}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, borderRadius: 2, backgroundColor: EMBRY.muted, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 2, backgroundColor: EMBRY.green,
          width: `${pct}%`, transition: 'width 0.3s ease' }} />
      </div>

      {/* Stage list */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {STAGE_ORDER.map((stageId, i) => {
          const ev = stageStatus.get(stageId)
          const stageLabel = STAGE_LABELS[stageId] ?? stageId
          const color = ev ? STATUS_COLOR[ev.status] ?? EMBRY.dim : EMBRY.muted
          const isActive = ev?.status === 'running'

          return (
            <div key={stageId} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              borderRadius: 6, backgroundColor: isActive ? `${EMBRY.blue}10` : 'transparent',
              borderLeft: `3px solid ${color}`,
            }}>
              {/* Stage number */}
              <span style={{ fontSize: 10, fontWeight: 700, color, fontFamily: 'monospace', width: 24 }}>
                {String(i).padStart(2, '0')}
              </span>

              {/* Icon */}
              <div style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {!ev ? <span style={{ color: EMBRY.muted, fontSize: 12 }}>○</span> :
                 ev.status === 'running' ? <span style={{ color: EMBRY.blue, fontSize: 12, animation: 'spin 1s linear infinite' }}>◌</span> :
                 ev.status === 'passed' ? <span style={{ color: EMBRY.green, fontSize: 14 }}>✓</span> :
                 ev.status === 'failed' ? <span style={{ color: EMBRY.red, fontSize: 14 }}>✗</span> :
                 <span style={{ color: EMBRY.dim, fontSize: 12 }}>●</span>}
              </div>

              {/* Label + detail */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: ev ? EMBRY.white : EMBRY.dim }}>
                  {stageLabel}
                </div>
                {ev?.detail && (
                  <div style={{ fontSize: 10, color: EMBRY.dim, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ev.detail}
                  </div>
                )}
              </div>

              {/* Timing */}
              {ev?.status !== 'running' && ev?.ts && (
                <span style={{ fontSize: 9, color: EMBRY.dim, fontFamily: 'monospace', flexShrink: 0 }}>
                  {((ev.data?.ms as number) ?? 0) > 0 ? `${((ev.data?.ms as number) / 1000).toFixed(1)}s` : ''}
                </span>
              )}
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      {/* Event log (collapsed) */}
      {pipeline.stages.length > 0 && (
        <div style={{ borderTop: `1px solid ${EMBRY.border}`, marginTop: 8, paddingTop: 8, maxHeight: 100, overflowY: 'auto' }}>
          <div style={{ ...label, fontSize: 8, marginBottom: 4 }}>EVENT LOG</div>
          {pipeline.stages.slice(-8).map((ev, i) => (
            <div key={i} style={{ fontSize: 9, color: EMBRY.dim, fontFamily: 'monospace', lineHeight: 1.6 }}>
              <span style={{ color: STATUS_COLOR[ev.status] ?? EMBRY.dim }}>{ev.status.padEnd(7)}</span>
              {' '}{ev.stage} — {ev.detail}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
