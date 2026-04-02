import { useState, useCallback } from 'react'
import { NVIS } from './theme'
import type { PipelineStep, ReextractResult } from './types'
import { useRegisterAction } from '../../../hooks/useRegisterAction'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PIPELINE_STEPS: string[] = [
  'Extract Spans',
  'Classify Blocks',
  'Rebuild Sections',
  'Extract Tables',
  'Upsert to Memory',
]

function stepStatusIcon(status: PipelineStep['status']): string {
  switch (status) {
    case 'pending':
      return '\u25CB'  // ○
    case 'running':
      return '\u27F3'  // ⟳
    case 'done':
      return '\u2713'  // ✓
    case 'error':
      return '\u2717'  // ✗
    default:
      return '\u25CB'
  }
}

function stepStatusColor(status: PipelineStep['status']): string {
  switch (status) {
    case 'pending':
      return NVIS.dim
    case 'running':
      return NVIS.accent
    case 'done':
      return '#15803d'
    case 'error':
      return '#dc2626'
    default:
      return NVIS.dim
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SpotReextractProps {
  entryId: string
  pdfPath: string
  section?: unknown
  sectionId?: string
  blockCount: number
  tableCount: number
  onAccept: (result: ReextractResult) => void
  onCancel: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SpotReextract({
  entryId,
  pdfPath,
  section: _section,
  sectionId,
  blockCount,
  tableCount,
  onAccept,
  onCancel,
}: SpotReextractProps) {
  const [scope, setScope] = useState<'section' | 'page'>('section')
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<PipelineStep[]>(
    PIPELINE_STEPS.map((name) => ({ name, status: 'pending' }))
  )
  const [result, setResult] = useState<ReextractResult | null>(null)

  // Estimated impact
  const estimatedTime = (blockCount * 0.15 + tableCount * 0.8).toFixed(1)

  // Run real re-extraction via quarantine API
  const runPipeline = useCallback(async () => {
    setRunning(true)
    setResult(null)
    const newSteps: PipelineStep[] = PIPELINE_STEPS.map((name) => ({
      name, status: 'running' as const,
    }))
    setSteps([...newSteps])

    try {
      const res = await fetch(`/api/quarantine/${encodeURIComponent(entryId)}/reextract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_path: pdfPath, overrides: {} }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      const doneSteps = newSteps.map((s) => ({ ...s, status: 'done' as const, durationMs: data.duration_ms }))
      setSteps(doneSteps)
      setResult({
        scope,
        targetId: sectionId ?? 'unknown',
        blocksAdded: data.blocks_added ?? 0,
        blocksRemoved: data.blocks_removed ?? 0,
        blocksModified: data.blocks_modified ?? 0,
        confidenceDelta: data.confidence_delta ?? 0,
        pipelineSteps: doneSteps,
      })
    } catch {
      const errSteps = newSteps.map((s, i) => ({

  // QuerySpec action registrations (data-qid → voice/NL/agent control)
  useRegisterAction('reextract:item-1', { app: 'datalake-explorer', action: 'ITEM_1', label: 'Item 1', description: 'Item 1 in stepStatusIcon' })
  useRegisterAction('reextract:dyn-2', { app: 'datalake-explorer', action: 'DYN_2', label: 'Dyn 2', description: 'Dyn 2 in stepStatusIcon' })
  useRegisterAction('reextract:item-3', { app: 'datalake-explorer', action: 'ITEM_3', label: 'Item 3', description: 'Item 3 in stepStatusIcon' })
  useRegisterAction('reextract:accept', { app: 'datalake-explorer', action: 'ACCEPT', label: 'Accept', description: 'Accept in stepStatusIcon' })
  useRegisterAction('reextract:cancel', { app: 'datalake-explorer', action: 'CANCEL', label: 'Cancel', description: 'Cancel in stepStatusIcon' })

        ...s, status: (i === newSteps.length - 1 ? 'error' : 'done') as PipelineStep['status'],
      }))
      setSteps(errSteps)
    } finally {
      setRunning(false)
    }
  }, [scope, sectionId, entryId, pdfPath])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
      }}
                data-qid="reextract:item-1" data-qs-action="REEXTRACT_ITEM_1"
                title="Item 1"
      onClick={(e) => {
        if (e.target === e.currentTarget && !running) onCancel()
      }}
    >
      <div
        style={{
          width: '480px',
          maxHeight: '80vh',
          backgroundColor: NVIS.surface,
          border: `1px solid ${NVIS.borderSolid}`,
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 16px',
            borderBottom: `1px solid ${NVIS.borderSolid}`,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <span
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: NVIS.white,
            }}
          >
            Spot Re-extract
          </span>
          {sectionId && (
            <span
              style={{
                fontSize: '10px',
                color: NVIS.accent,
                padding: '2px 6px',
                borderRadius: '3px',
                backgroundColor: `${NVIS.accent}14`,
                border: `1px solid ${NVIS.accent}30`,
              }}
            >
              \u00A7 {sectionId}
            </span>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
          {/* Scope selector */}
          <div style={{ marginBottom: '14px' }}>
            <div
              style={{
                fontSize: '9px',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: NVIS.dim,
                marginBottom: '6px',
              }}
            >
              Scope
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['section', 'page'] as const).map((s) => (
                <button
                  key={s}
                data-qid="reextract:dyn-2" data-qs-action="REEXTRACT_DYN_2"
                title="Dyn 2"
                  onClick={() => setScope(s)}
                  disabled={running}
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    padding: '4px 12px',
                    borderRadius: '3px',
                    border:
                      scope === s
                        ? `1px solid ${NVIS.accent}`
                        : `1px solid ${NVIS.borderSolid}`,
                    backgroundColor:
                      scope === s ? `${NVIS.accent}14` : NVIS.surface2,
                    color: scope === s ? NVIS.accent : NVIS.dim,
                    cursor: running ? 'not-allowed' : 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Impact preview */}
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: NVIS.surface2,
              border: `1px solid ${NVIS.borderSolid}`,
              borderRadius: '4px',
              marginBottom: '14px',
              fontSize: '11px',
              color: NVIS.dim,
            }}
          >
            <span style={{ color: NVIS.white, fontWeight: 600 }}>
              {blockCount} blocks
            </span>
            {', '}
            <span style={{ color: NVIS.white, fontWeight: 600 }}>
              {tableCount} table{tableCount !== 1 ? 's' : ''}
            </span>
            {', '}
            ~{estimatedTime}s estimated
          </div>

          {/* Pipeline progress */}
          <div
            style={{
              fontSize: '9px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: NVIS.dim,
              marginBottom: '6px',
            }}
          >
            Pipeline
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' }}>
            {steps.map((step, i) => (
              <div
                key={i}
                data-qid={`reextract:step:${i}`}
                title={`Pipeline step: ${step.name}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px 8px',
                  borderRadius: '3px',
                  backgroundColor:
                    step.status === 'running'
                      ? `${NVIS.accent}08`
                      : 'transparent',
                  border:
                    step.status === 'running'
                      ? `1px solid ${NVIS.accent}20`
                      : '1px solid transparent',
                }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    color: stepStatusColor(step.status),
                    width: '16px',
                    textAlign: 'center',
                  }}
                >
                  {stepStatusIcon(step.status)}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: '11px',
                    color:
                      step.status === 'done'
                        ? NVIS.white
                        : step.status === 'running'
                        ? NVIS.accent
                        : NVIS.dim,
                  }}
                >
                  {step.name}
                </span>
                {step.durationMs != null && (
                  <span
                    style={{
                      fontSize: '9px',
                      fontVariantNumeric: 'tabular-nums',
                      color: NVIS.dim,
                    }}
                  >
                    {step.durationMs}ms
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Diff preview */}
          {result && (
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: NVIS.surface2,
                border: `1px solid ${NVIS.borderSolid}`,
                borderRadius: '4px',
              }}
            >
              <div
                style={{
                  fontSize: '9px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: NVIS.dim,
                  marginBottom: '6px',
                }}
              >
                Diff Preview
              </div>
              <div style={{ display: 'flex', gap: '12px', fontSize: '11px' }}>
                {result.blocksAdded > 0 && (
                  <span style={{ color: '#15803d' }}>
                    +{result.blocksAdded} added
                  </span>
                )}
                {result.blocksRemoved > 0 && (
                  <span style={{ color: '#dc2626' }}>
                    -{result.blocksRemoved} removed
                  </span>
                )}
                {result.blocksModified > 0 && (
                  <span style={{ color: NVIS.accent }}>
                    ~{result.blocksModified} modified
                  </span>
                )}
              </div>
              <div style={{ fontSize: '10px', color: NVIS.dim, marginTop: '4px' }}>
                Confidence delta:{' '}
                <span
                  style={{
                    color: result.confidenceDelta >= 0 ? '#15803d' : '#dc2626',
                    fontWeight: 600,
                  }}
                >
                  {result.confidenceDelta >= 0 ? '+' : ''}
                  {result.confidenceDelta.toFixed(3)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: `1px solid ${NVIS.borderSolid}`,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            justifyContent: 'flex-end',
          }}
        >
          {!running && !result && (
            <button
                data-qid="reextract:item-3" data-qs-action="REEXTRACT_ITEM_3"
                title="Item 3"
              onClick={runPipeline}
              style={{
                fontFamily: 'monospace',
                fontSize: '11px',
                padding: '6px 16px',
                borderRadius: '4px',
                border: `1px solid ${NVIS.accent}`,
                backgroundColor: `${NVIS.accent}14`,
                color: NVIS.accent,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Run Re-extract
            </button>
          )}
          {result && (
            <button
              data-qid="reextract:accept" data-qs-action="REEXTRACT_ACCEPT"
              title="Accept re-extraction result"
              onClick={() => onAccept(result)}
              style={{
                fontFamily: 'monospace',
                fontSize: '11px',
                padding: '6px 16px',
                borderRadius: '4px',
                border: '1px solid rgba(21, 128, 61, 0.4)',
                backgroundColor: 'rgba(21, 128, 61, 0.12)',
                color: '#15803d',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Accept
            </button>
          )}
          <button
            data-qid="reextract:cancel" data-qs-action="REEXTRACT_CANCEL"
            title="Cancel re-extraction"
            onClick={onCancel}
            disabled={running}
            style={{
              fontFamily: 'monospace',
              fontSize: '11px',
              padding: '6px 16px',
              borderRadius: '4px',
              border: `1px solid ${NVIS.borderSolid}`,
              backgroundColor: NVIS.surface2,
              color: NVIS.dim,
              cursor: running ? 'not-allowed' : 'pointer',
              opacity: running ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
