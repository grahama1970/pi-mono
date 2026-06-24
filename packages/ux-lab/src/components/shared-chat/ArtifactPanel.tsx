/**
 * ArtifactPanel — generic preview/code pane for Sparta Chat (PR4 r6b).
 */
import { useMemo, useState } from 'react'
import { Code, Eye, X } from 'lucide-react'
import DOMPurify from 'dompurify'
import { useRegisterAction } from '../../hooks/useRegisterAction'
import type { Artifact } from './types'
import { SPARTA_CHAT_NVIS } from './spartaChatNvis'
import { ArtifactGraphView, isGraphData } from './ArtifactGraphView'

function unescapeArtifactContent(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.includes('&lt;svg') || trimmed.includes('&lt;SVG')) {
    const el = document.createElement('textarea')
    el.innerHTML = trimmed
    return el.value
  }
  return raw
}

export interface ArtifactPanelProps {
  artifact: Artifact | null
  onClose: () => void
  collapsedRail?: boolean
  paneWidth?: number
}

function exportBlockedReason(artifact: Artifact): string | null {
  const state = artifact.provenanceState ?? ''
  if (state === 'mock-demo' || state === 'sample-derived' || artifact.sampleDerived) {
    return 'EXPORT BLOCKED — sample-derived or mock-demo artifact is not bound proof'
  }
  if (state === 'unbound' || state === 'pending') {
    return 'EXPORT BLOCKED — provenance not audit-valid'
  }
  return null
}

export function ArtifactPanel({ artifact, onClose, collapsedRail, paneWidth }: ArtifactPanelProps) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const [filter, setFilter] = useState('')

  useRegisterAction('artifact:close', { app: 'sparta-explorer', action: 'CLOSE_ARTIFACT', label: 'Close artifact', description: 'Close artifact pane' })
  useRegisterAction('artifact:export', { app: 'sparta-explorer', action: 'EXPORT_ARTIFACT', label: 'Export artifact', description: 'Export artifact bundle' })

  const blocked = artifact ? exportBlockedReason(artifact) : null

  const previewHtml = useMemo(() => {
    if (!artifact?.content) return ''
    const normalized = unescapeArtifactContent(artifact.content)
    const isSvg = artifact.type === 'figure' || artifact.type === 'svg' || artifact.type === 'gsn-diagram'
      || normalized.trim().startsWith('<svg')
    if (isSvg) return DOMPurify.sanitize(normalized, { USE_PROFILES: { svg: true, svgFilters: true } })
    if (artifact.preview?.kind === 'html' && typeof artifact.preview.content === 'string') {
      return DOMPurify.sanitize(artifact.preview.content)
    }
    return DOMPurify.sanitize(`<pre style="font-family:monospace;font-size:12px;white-space:pre-wrap">${artifact.content}</pre>`)
  }, [artifact])

  if (collapsedRail && !artifact) {
    return (
      <aside data-qid="artifact:rail" title="No artifact selected" style={{
        width: 52, minWidth: 52, borderLeft: `1px solid ${SPARTA_CHAT_NVIS.border}`,
        background: SPARTA_CHAT_NVIS.bgPanel, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: SPARTA_CHAT_NVIS.textDim, fontFamily: 'var(--font-mono)', fontSize: 9,
        letterSpacing: '0.08em', textTransform: 'uppercase', writingMode: 'vertical-rl', transform: 'rotate(180deg)',
      }}>
        No artifact
      </aside>
    )
  }

  if (!artifact) {
    return (
      <aside data-qid="artifact:panel" title="Artifact pane" style={{
        flex: 1, minWidth: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8,
        color: SPARTA_CHAT_NVIS.textDim, borderLeft: `1px solid ${SPARTA_CHAT_NVIS.border}`, background: SPARTA_CHAT_NVIS.bgPanel,
      }}>
        <Code size={28} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 1 }}>No artifact selected</span>
      </aside>
    )
  }

  return (
    <aside data-qid="artifact:panel" aria-label="Sparta artifact pane" style={{
      display: 'flex', flexDirection: 'column', minWidth: 320, width: paneWidth ?? 420, maxWidth: paneWidth ?? '42vw',
      borderLeft: `1px solid ${SPARTA_CHAT_NVIS.border}`, background: SPARTA_CHAT_NVIS.bgPanel, minHeight: 0,
    }}>
      <header style={{ padding: '10px 12px', borderBottom: `1px solid ${SPARTA_CHAT_NVIS.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div data-qid="artifact:panel:title" style={{ fontSize: 12, fontWeight: 800, color: SPARTA_CHAT_NVIS.textWhite, fontFamily: 'var(--font-mono)' }}>{artifact.title}</div>
          <div data-qid="artifact:gate-breadcrumb" style={{ fontSize: 10, color: SPARTA_CHAT_NVIS.textDim, marginTop: 2, fontFamily: 'var(--font-mono)' }}>{artifact.caseId ?? 'case'} → Gate: source-page provenance → {artifact.id}</div>
          {artifact.caseId ? (
            <div data-qid="artifact:case-binding" style={{ fontSize: 10, color: SPARTA_CHAT_NVIS.embryCyan, marginTop: 4, fontFamily: 'var(--font-mono)' }}>
              Bound to evidence case {artifact.caseId}
            </div>
          ) : null}
        </div>
        <button type="button" data-qid="artifact:close" data-qs-action="CLOSE_ARTIFACT" title="Close artifact pane" onClick={onClose}
          style={{ minWidth: 44, minHeight: 44, border: `1px solid ${SPARTA_CHAT_NVIS.border}`, borderRadius: 6, background: 'transparent', color: SPARTA_CHAT_NVIS.warningAmber, cursor: 'pointer' }}>
          <X size={16} />
        </button>
      </header>

      <nav style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: `1px solid ${SPARTA_CHAT_NVIS.border}` }} aria-label="Artifact tabs">
        {(['preview', 'code'] as const).map(t => (
          <button key={t} type="button" data-qid={`artifact:tab:${t}`} data-qs-action="SWITCH_ARTIFACT_TAB" title={t === 'code' ? 'Code / raw' : 'Preview'}
            onClick={() => setTab(t)} style={{
              minHeight: 44, padding: '0 12px', borderRadius: 6,
              border: `1px solid ${tab === t ? SPARTA_CHAT_NVIS.embryCyan : SPARTA_CHAT_NVIS.border}`,
              background: tab === t ? `${SPARTA_CHAT_NVIS.embryCyan}18` : 'transparent',
              color: tab === t ? SPARTA_CHAT_NVIS.textWhite : SPARTA_CHAT_NVIS.textDim,
              fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
            {t === 'code' ? <Code size={14} /> : <Eye size={14} />}
            {t === 'code' ? 'Code' : 'Preview'}
          </button>
        ))}
      </nav>

      <div data-qid="artifact:panel:metadata" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: 12 }}>
        <Meta label="Artifact id" value={artifact.id} />
        <Meta label="Type" value={artifact.type} />
        <Meta label="Source skill" value={artifact.sourceSkill ?? '—'} />
        <Meta label="Case" value={artifact.caseId ?? '—'} />
        <Meta label="Provenance" value={artifact.provenanceState ?? '—'} tone={artifact.provenanceState === 'mock-demo' || artifact.sampleDerived ? SPARTA_CHAT_NVIS.warningAmber : SPARTA_CHAT_NVIS.textWhite} />
        <Meta label="SHA256" value={artifact.sha256 ?? '—'} missingHash={!artifact.sha256 || artifact.sha256 === '—'} />
      </div>

      {(artifact.type === 'react-table' || artifact.data) ? (
        <input data-qid="artifact:table:filter" data-qs-action="ARTIFACT_TABLE_FILTER" title="Filter artifact table" value={filter} onChange={e => setFilter(e.target.value)}
          style={{ margin: '0 12px 8px', minHeight: 44, borderRadius: 4, border: `1px solid ${SPARTA_CHAT_NVIS.border}`, background: SPARTA_CHAT_NVIS.bgDeep, color: SPARTA_CHAT_NVIS.textWhite, fontFamily: 'var(--font-mono)', fontSize: 12, padding: '0 10px' }} />
      ) : null}

      {blocked ? (
        <div data-qid="artifact:provenance-banner" style={{ position: 'sticky', top: 0, zIndex: 2, margin: '0 12px', padding: '8px 10px', borderRadius: 6, border: `1px solid ${SPARTA_CHAT_NVIS.blockedRed}`, background: `${SPARTA_CHAT_NVIS.blockedRed}14`, color: SPARTA_CHAT_NVIS.blockedRed, fontSize: 11, fontFamily: 'var(--font-mono)', lineHeight: 1.4 }}>
          NOT BOUND PROOF: {artifact.provenanceState ?? 'unknown'} / SHA256 {artifact.sha256 ?? 'missing'} / export blocked
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12 }}>
        {tab === 'code' ? (
          <pre data-qid="artifact:code" style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5, color: SPARTA_CHAT_NVIS.textDim, whiteSpace: 'pre-wrap' }}>
            {artifact.code ?? artifact.content}
          </pre>
        ) : isGraphData(artifact.data) ? (
          <section data-qid="artifact:preview" style={{ minHeight: 160 }}>
            <ArtifactGraphView data={artifact.data} />
          </section>
        ) : (
          <section data-qid="artifact:preview" style={{ minHeight: 160 }}>
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </section>
        )}
      </div>

      <footer style={{ padding: 12, borderTop: `1px solid ${SPARTA_CHAT_NVIS.border}` }}>
        {blocked && (artifact.provenanceState === 'sample-derived' || artifact.sampleDerived || artifact.provenanceState === 'mock-demo') ? (
          <button type="button" data-qid="artifact:bind-source" data-qs-action="BIND_SOURCE_DOCUMENT" title="Bind source document to replace sample-derived provenance"
            style={{ width: '100%', minHeight: 44, borderRadius: 6, border: `1px solid ${SPARTA_CHAT_NVIS.embryCyan}`, background: `${SPARTA_CHAT_NVIS.embryCyan}18`, color: SPARTA_CHAT_NVIS.embryCyan, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 800, cursor: 'pointer', marginBottom: 8 }}>
            Bind Source Document
          </button>
        ) : null}
        <button type="button" data-qid="artifact:export" data-qs-action="EXPORT_ARTIFACT" title={blocked ?? 'Export artifact'} disabled={Boolean(blocked)}
          style={{ width: '100%', minHeight: 44, borderRadius: 6, border: `1px solid ${blocked ? SPARTA_CHAT_NVIS.blockedRed : SPARTA_CHAT_NVIS.embryCyan}`,
            background: blocked ? `${SPARTA_CHAT_NVIS.blockedRed}12` : `${SPARTA_CHAT_NVIS.embryCyan}12`,
            color: blocked ? SPARTA_CHAT_NVIS.blockedRed : SPARTA_CHAT_NVIS.embryCyan, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 800,
            cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.85 : 1 }}>
          Export
        </button>
        {blocked ? (
          <div data-qid="artifact:export-blocked-reason" style={{ color: SPARTA_CHAT_NVIS.warningAmber, fontSize: 11, marginTop: 8, lineHeight: 1.45, fontFamily: 'var(--font-mono)' }}>{blocked}</div>
        ) : null}
      </footer>
    </aside>
  )
}

function Meta({ label, value, tone, missingHash }: { label: string; value: string; tone?: string; missingHash?: boolean }) {
  const display = missingHash ? 'MISSING HASH' : value
  return (
    <div style={{ border: `1px solid ${missingHash ? SPARTA_CHAT_NVIS.blockedRed : SPARTA_CHAT_NVIS.border}`, borderRadius: 4, padding: 8, minHeight: 52, background: missingHash ? `${SPARTA_CHAT_NVIS.blockedRed}18` : 'transparent' }}>
      <div style={{ fontSize: 9, color: SPARTA_CHAT_NVIS.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>{label}</div>
      <div style={{ fontSize: 11, color: missingHash ? '#fecaca' : (tone ?? SPARTA_CHAT_NVIS.textWhite), fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 4, overflowWrap: 'anywhere' }}>{display}</div>
    </div>
  )
}
