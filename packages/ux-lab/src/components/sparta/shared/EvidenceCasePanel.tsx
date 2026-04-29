/**
 * EvidenceCasePanel — Shared slide-over for creating/viewing evidence cases.
 *
 * Extracted from learn-datalake viewer. Used by:
 * - SPARTA Explorer (:3002) — Threat Matrix drillthrough
 * - Datalake Viewer (:5181) — ThreatMatrixView
 * - Embry-OS — future
 *
 * Each host provides an onSubmit callback to persist via its own API path.
 */
import { useState, useEffect, useCallback } from 'react'
import { EMBRY } from '../common/EmbryStyle'

export type EvidenceVerdict = 'supported' | 'refuted' | 'insufficient'

export interface EvidenceCasePrefill {
  controlId?: string
  claim?: string
  sources?: string[]
}

export interface EvidenceCaseSubmission {
  claim: string
  verdict: EvidenceVerdict
  confidence: number
  sources: string[]
  notes: string
  controlId?: string
  createdAt: string
}

interface EvidenceCasePanelProps {
  open: boolean
  onClose: () => void
  onSubmit?: (submission: EvidenceCaseSubmission) => void
  prefillContext?: EvidenceCasePrefill
}

const VERDICT_OPTIONS: { value: EvidenceVerdict; label: string; color: string }[] = [
  { value: 'supported', label: 'Supported', color: EMBRY.green },
  { value: 'refuted', label: 'Refuted', color: EMBRY.red },
  { value: 'insufficient', label: 'Insufficient', color: EMBRY.amber },
]

export function EvidenceCasePanel({ open, onClose, onSubmit, prefillContext }: EvidenceCasePanelProps) {
  const [claim, setClaim] = useState('')
  const [verdict, setVerdict] = useState<EvidenceVerdict>('insufficient')
  const [confidence, setConfidence] = useState(50)
  const [sources, setSources] = useState<string[]>([])
  const [newSource, setNewSource] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (open && prefillContext) {
      setClaim(prefillContext.claim ?? '')
      setSources(prefillContext.sources ?? [])
      setVerdict('insufficient')
      setConfidence(50)
      setNotes('')
      setNewSource('')
    }
  }, [open, prefillContext])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) onClose()
  }, [open, onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const addSource = () => {
    const trimmed = newSource.trim()
    if (trimmed && !sources.includes(trimmed)) {
      setSources([...sources, trimmed])
      setNewSource('')
    }
  }

  const handleCreate = () => {
    onSubmit?.({
      claim, verdict, confidence, sources, notes,
      controlId: prefillContext?.controlId,
      createdAt: new Date().toISOString(),
    })
    onClose()
  }

  if (!open) return null

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', backgroundColor: EMBRY.bgDeep,
    border: `1px solid ${EMBRY.border}`, borderRadius: 4,
    color: EMBRY.white, fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
    color: EMBRY.muted, marginBottom: 4, display: 'block',
  }

  return (
    <>
      <div data-qid="shared-evidencecasepanel:auto:104" data-qs-action="SHARED_EVIDENCECASEPANEL_AUTO_104" onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000 }} />
      <div role="dialog" aria-label="Evidence Case" aria-modal="true" style={{
        position: 'fixed', top: 0, right: 0, width: 480, height: '100vh',
        backgroundColor: EMBRY.bgPanel, borderLeft: `1px solid ${EMBRY.border}`,
        zIndex: 1001, display: 'flex', flexDirection: 'column', fontFamily: 'monospace',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: EMBRY.white }}>Evidence Case</div>
            {prefillContext?.controlId && (
              <div style={{ fontSize: 10, color: EMBRY.dim, marginTop: 2 }}>
                Control: <span style={{ color: EMBRY.accent }}>{prefillContext.controlId}</span>
              </div>
            )}
          </div>
          <button data-qid="shared-evidencecasepanel:auto:120" data-qs-action="SHARED_EVIDENCECASEPANEL_AUTO_120" onClick={onClose} aria-label="Close panel" style={{ background: 'none', border: 'none', color: EMBRY.dim, fontSize: 18, cursor: 'pointer', padding: '4px 8px', fontFamily: 'monospace' }}>X</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label data-qid="evidence-case:label:claim" style={labelStyle}>Claim</label>
            <textarea data-qid="evidence-case:input:claim" data-qs-action="EDIT_EVIDENCE_CASE_CLAIM" value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="Enter the claim to evaluate..." rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          <div>
            <label data-qid="evidence-case:label:verdict" style={labelStyle}>Verdict</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {VERDICT_OPTIONS.map((opt) => {
                const sel = verdict === opt.value
                return (
                  <button data-qid="shared-evidencecasepanel:auto:136" data-qs-action="SHARED_EVIDENCECASEPANEL_AUTO_136" key={opt.value} onClick={() => setVerdict(opt.value)} style={{
                    flex: 1, padding: '6px 10px', fontSize: 11, fontWeight: sel ? 600 : 400, fontFamily: 'monospace', cursor: 'pointer',
                    border: `1px solid ${sel ? opt.color : EMBRY.border}`, borderRadius: 4,
                    backgroundColor: sel ? `${opt.color}1a` : 'transparent', color: sel ? opt.color : EMBRY.dim,
                  }}>{opt.label}</button>
                )
              })}
            </div>
          </div>

          <div>
            <label data-qid="evidence-case:label:confidence" style={labelStyle}>Confidence: <span style={{ color: EMBRY.white }}>{confidence}%</span></label>
            <input data-qid="evidence-case:input:confidence" data-qs-action="SET_EVIDENCE_CASE_CONFIDENCE" type="range" min={0} max={100} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} style={{ width: '100%', accentColor: EMBRY.accent }} />
          </div>

          <div>
            <label style={labelStyle}>Source References</label>
            {sources.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                {sources.map((src, idx) => (
                  <div key={`src-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', backgroundColor: EMBRY.bgDeep, borderRadius: 3, fontSize: 11, color: EMBRY.white }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src}</span>
                    <button data-qid="shared-evidencecasepanel:auto:158" data-qs-action="SHARED_EVIDENCECASEPANEL_AUTO_158" onClick={() => setSources(sources.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', fontSize: 11, padding: '0 4px', fontFamily: 'monospace' }}>x</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <input data-qid="evidence-case:input:source-reference" data-qs-action="EDIT_EVIDENCE_CASE_SOURCE_REFERENCE" type="text" value={newSource} onChange={(e) => setNewSource(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSource() }} placeholder="Add source reference..." style={{ ...inputStyle, flex: 1 }} />
              <button data-qid="evidence-case:button:add-source" data-qs-action="ADD_EVIDENCE_CASE_SOURCE" onClick={addSource} style={{ padding: '6px 12px', fontSize: 11, fontFamily: 'monospace', backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 4, color: EMBRY.dim, cursor: 'pointer', flexShrink: 0 }}>Add</button>
            </div>
          </div>

          <div>
            <label data-qid="evidence-case:label:notes" style={labelStyle}>Notes</label>
            <textarea data-qid="evidence-case:input:notes" data-qs-action="EDIT_EVIDENCE_CASE_NOTES" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes..." rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${EMBRY.border}`, display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', fontSize: 12, fontFamily: 'monospace', backgroundColor: 'transparent', border: `1px solid ${EMBRY.border}`, borderRadius: 4, color: EMBRY.dim, cursor: 'pointer' }}>Cancel</button>
          <button data-qid="shared-evidencecasepanel:auto:178" data-qs-action="SHARED_EVIDENCECASEPANEL_AUTO_178" onClick={handleCreate} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, fontFamily: 'monospace', backgroundColor: EMBRY.accent, border: 'none', borderRadius: 4, color: '#000', cursor: 'pointer' }}>Create Case</button>
        </div>
      </div>
    </>
  )
}
