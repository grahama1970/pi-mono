import { EMBRY, card, label, heading, glowDot } from '../common/EmbryStyle'
import { useCollectionCounts } from '../../../hooks/useSpartaCollections'

interface PipelineStep {
  id: string
  name: string
  status: 'done' | 'running' | 'error' | 'pending' | 'not_implemented'
}

interface PipelinePhase {
  name: string
  steps: PipelineStep[]
}

const PHASES: PipelinePhase[] = [
  {
    name: 'Ingestion',
    steps: [
      { id: '00', name: 'Source Acquisition', status: 'done' },
      { id: '01', name: 'Worksheet Parse', status: 'done' },
      { id: '01b', name: 'External Sources', status: 'done' },
    ],
  },
  {
    name: 'Controls & URLs',
    steps: [
      { id: '02', name: 'Control Normalization', status: 'done' },
      { id: '03', name: 'URL Discovery', status: 'done' },
      { id: '04', name: 'Framework Alignment', status: 'done' },
      { id: '04b', name: 'Control Enrichment', status: 'done' },
    ],
  },
  {
    name: 'Knowledge Extraction',
    steps: [
      { id: '05', name: 'URL Fetch', status: 'done' },
      { id: '05b', name: 'Content Extract', status: 'done' },
      { id: '05d', name: 'Chunk Knowledge', status: 'done' },
      { id: '06', name: 'Quality Classify', status: 'done' },
    ],
  },
  {
    name: 'QRA Generation',
    steps: [
      { id: '12', name: 'QRA Generation', status: 'done' },
      { id: '12b', name: 'QRA Validation', status: 'done' },
    ],
  },
  {
    name: 'Relationships',
    steps: [
      { id: '07', name: 'KNN Relationships', status: 'done' },
      { id: '08', name: 'BM25 Relationships', status: 'done' },
      { id: '08c', name: 'NRS Scoring', status: 'done' },
      { id: '28', name: 'LLM Verification', status: 'done' },
    ],
  },
]

const STATUS_COLORS: Record<string, string> = {
  done: EMBRY.green,
  running: EMBRY.blue,
  error: EMBRY.red,
  pending: EMBRY.dim,
  not_implemented: '#333',
}

export function PipelineView() {
  const counts = useCollectionCounts()

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      {/* Stats row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatCard label="Controls" value={counts.controls} loading={counts.loading} />
        <StatCard label="URLs" value={counts.urls} loading={counts.loading} />
        <StatCard label="Knowledge" value={counts.knowledge} loading={counts.loading} />
        <StatCard label="QRAs" value={counts.qras} loading={counts.loading} />
        <StatCard label="Relationships" value={counts.relationships} loading={counts.loading} />
      </div>

      {/* Pipeline phases */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {PHASES.map((phase) => {
          const doneCount = phase.steps.filter((s) => s.status === 'done').length
          const progress = (doneCount / phase.steps.length) * 100
          return (
            <div key={phase.name} style={{ ...card }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={heading}>{phase.name}</div>
                <div style={{ ...label }}>{doneCount}/{phase.steps.length} steps</div>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: progress === 100 ? EMBRY.green : EMBRY.amber }}>
                  {progress.toFixed(0)}%
                </span>
              </div>

              {/* Progress bar */}
              <div style={{ height: 4, backgroundColor: EMBRY.bgDeep, borderRadius: 2, marginBottom: 12, overflow: 'hidden' }}>
                <div style={{
                  width: `${progress}%`,
                  height: '100%',
                  backgroundColor: progress === 100 ? EMBRY.green : EMBRY.blue,
                  borderRadius: 2,
                  transition: 'width 0.3s',
                }} />
              </div>

              {/* Step cells */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {phase.steps.map((step) => (
                  <div key={step.id} style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    backgroundColor: EMBRY.bgDeep,
                    border: `1px solid ${STATUS_COLORS[step.status]}33`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    <div style={glowDot(STATUS_COLORS[step.status], 6)} />
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: EMBRY.dim }}>{step.id}</span>
                    <span style={{ fontSize: 11, color: EMBRY.white }}>{step.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Cost tracker placeholder */}
      <div style={{ ...card, marginTop: 16, opacity: 0.5 }}>
        <div style={heading}>LLM Cost Tracker</div>
        <div style={{ ...label, marginTop: 8 }}>Requires /analytics integration — coming soon</div>
      </div>
    </div>
  )
}

function StatCard({ label: text, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <div style={{ ...card, padding: '12px 20px', minWidth: 120 }}>
      <div style={label}>{text}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: EMBRY.white, marginTop: 4 }}>
        {loading ? '...' : value.toLocaleString()}
      </div>
    </div>
  )
}
