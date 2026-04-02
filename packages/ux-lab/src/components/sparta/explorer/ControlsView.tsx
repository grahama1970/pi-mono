import { useState, useEffect, useCallback } from 'react'
import { EMBRY, label, glowDot, card, heading, body, fwBadge } from '../common/EmbryStyle'
import { useControlsPaginated, normalizeFramework } from '../../../hooks/useSpartaCollections'
import type { SpartaControl } from '../../../hooks/useSpartaCollections'
import { applyMagneticHover, removeMagneticHover, magneticRow, magneticRowSelected, nrsToStatus, statusBadgeStyle, statusBadgeLabel } from '../common/TableStyles'
import { UtilityBar } from '../common/UtilityBar'
import { useToast } from '../common/Toast'
import { ControlIdPills } from '../common/ControlIdPills'

const API = 'http://localhost:3001/api/memory'
const PAGE_SIZE = 100

const FRAMEWORKS = ['ALL', 'SPARTA', 'NIST', 'CWE', 'D3FEND', 'ATT&CK', 'ISO', 'ESA', 'NASA'] as const
const FW_TO_RAW: Record<string, string | undefined> = {
  SPARTA: 'SPARTA',
  NIST: 'NIST',
  CWE: 'cwe',
  D3FEND: 'D3FEND',
  'ATT&CK': 'ATT_CK_Enterprise',
  ISO: 'ISO',
  ESA: 'ESA',
  NASA: 'NASA',
}

/** Generate a reference URL for a control based on its framework. */
function controlUrl(controlId: string, framework?: string): string | null {
  const fw = (framework ?? '').toUpperCase()
  const id = controlId
  if (fw.startsWith('ATT') || fw === 'ATTACK') {
    if (id.startsWith('T')) return `https://attack.mitre.org/techniques/${id.replace('.', '/')}`
    if (id.startsWith('S')) return `https://attack.mitre.org/software/${id}`
    if (id.startsWith('G')) return `https://attack.mitre.org/groups/${id}`
  }
  if (fw === 'CWE' || id.startsWith('CWE-')) return `https://cwe.mitre.org/data/definitions/${id.replace('CWE-', '')}.html`
  if (fw === 'NIST') return `https://csf.tools/reference/sp800-53/rev5/${id.split('(')[0].split('-')[0]}/${id}`
  if (fw === 'D3FEND' || id.startsWith('d3f:')) return `https://d3fend.mitre.org/technique/d3f:${id.replace('d3f:', '')}`
  if (fw === 'SPARTA') return `https://sparta.aerospace.org`
  return null
}

const PLACEHOLDER_PATTERN = /This control requires QRA generation/i
function isPlaceholder(desc?: string): boolean {
  return !desc || PLACEHOLDER_PATTERN.test(desc)
}

/**
 * Parse a description that contains cross-reference sections like:
 * "NIST Controls: PM-9,PM-28; SPARTA Countermeasures: RD-0001,RD-0002; SPARTA Techniques: SV-IT-2"
 * Returns prose (actual description text) and structured sections of control IDs.
 */
/**
 * Split description into prose and cross-references.
 * Uses the [Cross-references] marker we control, NOT regex parsing of IDs.
 * Cross-reference IDs are rendered by ControlIdPills which calls /extract-entities.
 */
function splitDescription(desc: string): { prose: string; crossRefs: string } {
  const marker = '[Cross-references]'
  const idx = desc.indexOf(marker)
  if (idx >= 0) {
    const prose = desc.slice(0, idx).replace(/^\[INFERRED[^\]]*\]\s*/i, '').trim()
    const crossRefs = desc.slice(idx + marker.length).trim()
    return { prose, crossRefs }
  }
  // No marker — check if it starts with [INFERRED]
  const prose = desc.replace(/^\[INFERRED[^\]]*\]\s*/i, '').trim()
  return { prose, crossRefs: '' }
}

function nrsColor(score: number | undefined): string {
  if (score == null) return EMBRY.dim
  if (score >= 0.80) return EMBRY.green
  if (score >= 0.60) return EMBRY.amber
  return EMBRY.red
}

/* ── Detail pane for selected control ────────────────────────────────────── */

function ControlDetailPane({ control, onClose, onNavigate, onToast }: { control: SpartaControl; onClose: () => void; onNavigate?: (ctrl: SpartaControl) => void; onToast: (msg: string) => void }) {
  const [qras, setQras] = useState<Array<Record<string, unknown>>>([])
  const [rels, setRels] = useState<Array<{ source_control_id?: string; target_control_id?: string; relationship_type?: string }>>([])
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [modalQra, setModalQra] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadingDetail(true)
    const q = `${control.control_id} ${control.name}`
    Promise.all([
      fetch(`${API}/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, collections: ['sparta_qra'], k: 10, entities: [control.control_id] }),
      }).then((r) => r.json()).catch(() => ({ items: [] })),
      fetch(`${API}/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, collections: ['sparta_relationships'], k: 10, entities: [control.control_id] }),
      }).then((r) => r.json()).catch(() => ({ items: [] })),
    ]).then(([qraRes, relRes]) => {
      if (cancelled) return
      setQras(qraRes.items ?? [])
      setRels(relRes.items ?? [])
      setLoadingDetail(false)
    })
    return () => { cancelled = true }
  }, [control.control_id, control.name])

  const fw = normalizeFramework(control.source_framework)
  const fwColor = EMBRY.fw[fw] ?? EMBRY.dim
  const deprecated = control.status === 'deprecated' || (control.description ?? '').startsWith('[Deprecated]') || (control.description ?? '').startsWith('[Withdrawn')
  const placeholder = !deprecated && isPlaceholder(control.description)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: `${fwColor}0F` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={fwBadge(fw)}>{fw}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: fwColor }}>{control.control_id}</span>
              {control.control_type && (
                <span style={{ fontSize: 10, color: EMBRY.dim, padding: '2px 6px', borderRadius: 4, backgroundColor: `${EMBRY.muted}22` }}>
                  {control.control_type}
                </span>
              )}
              {deprecated && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, backgroundColor: `${EMBRY.muted}22`, color: EMBRY.muted }}>
                  DEPRECATED
                </span>
              )}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: EMBRY.white }}>{control.name}</div>
            {controlUrl(control.control_id, control.source_framework) && (
              <a
                href={controlUrl(control.control_id, control.source_framework)!}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 10, color: EMBRY.blue, textDecoration: 'none', marginTop: 4, display: 'block' }}
              >
                {controlUrl(control.control_id, control.source_framework)}
              </a>
            )}
          </div>
          <button onClick={onClose} data-qs-action="CLOSE_DETAIL" style={{ backgroundColor: 'transparent', border: `1px solid ${EMBRY.border}`, borderRadius: 6, color: EMBRY.dim, fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>
            Close
          </button>
        </div>
        <UtilityBar controlId={control.control_id} name={control.name} framework={fw} description={control.description ?? ''} onToast={onToast} />
      </div>

      {/* Description + Related Controls */}
      {(() => {
        const { prose, crossRefs } = splitDescription(control.description ?? '')
        const navigateToControl = (id: string) => {
          if (!onNavigate) return
          fetch(`http://localhost:3001/api/memory/list`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collection: 'sparta_controls', limit: 1, filters: { control_id: id }, return_fields: ['control_id', 'name', 'description', 'source_framework', 'control_type', 'parent_id', 'domain', 'scope', 'weaknesses', 'mind', 'nrs_score', 'status'] }),
          }).then(r => r.json()).then(data => {
            const doc = (data.documents ?? [])[0] as SpartaControl | undefined
            if (doc) onNavigate(doc)
          }).catch(() => {})
        }
        return (
          <>
            {/* Actual description (prose only) */}
            <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
              <div style={{ ...label, marginBottom: 4 }}>Description</div>
              {deprecated ? (
                <div style={{ fontSize: 12, color: EMBRY.muted, padding: '6px 10px', borderRadius: 6, backgroundColor: `${EMBRY.muted}08`, border: `1px solid ${EMBRY.muted}22`, fontStyle: 'italic' }}>
                  {control.description || 'This control has been deprecated or withdrawn.'}
                </div>
              ) : placeholder ? (
                <div style={{ fontSize: 12, color: EMBRY.amber, padding: '6px 10px', borderRadius: 6, backgroundColor: `${EMBRY.amber}12`, border: `1px solid ${EMBRY.amber}22` }}>
                  NEEDS DESCRIPTION — placeholder text detected
                </div>
              ) : prose ? (
                <div style={{ fontSize: 12, color: EMBRY.dim, lineHeight: 1.6 }}>{prose}</div>
              ) : (
                <div style={{ fontSize: 12, color: EMBRY.muted, fontStyle: 'italic' }}>No prose description — see related controls below</div>
              )}
            </div>

            {/* Related Controls — extracted via /extract-entities, color-coded with hover tooltips */}
            {crossRefs && (
              <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
                <div style={{ ...label, marginBottom: 8 }}>Related Controls</div>
                <ControlIdPills text={crossRefs} collection="sparta_controls" onControlClick={navigateToControl} />
              </div>
            )}
          </>
        )
      })()}

      {/* Metadata */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}`, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
        {control.domain && <MetaField label="Domain" value={control.domain} />}
        {control.parent_id && <MetaField label="Parent" value={control.parent_id} mono />}
        {control.scope && <MetaField label="Scope" value={control.scope} />}
        {control.nrs_score != null && (
          <div>
            <div style={{ ...label, marginBottom: 2 }}>NRS Score</div>
            <span style={{ fontSize: 14, fontWeight: 700, color: nrsColor(control.nrs_score) }}>
              {(control.nrs_score * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Mind/Taxonomy tags */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
        <div style={{ ...label, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          Mind Tags
          <div style={glowDot(control.mind && control.mind.length > 0 ? EMBRY.green : EMBRY.red, 6)} />
        </div>
        {control.mind && control.mind.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {control.mind.map((tag) => (
              <span key={tag} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, backgroundColor: `${EMBRY.accent}18`, color: EMBRY.accent, border: `1px solid ${EMBRY.accent}33` }}>
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: EMBRY.red, padding: '4px 8px', borderRadius: 4, backgroundColor: `${EMBRY.red}08` }}>
            No taxonomy tags — /taxonomy not run for this control
          </div>
        )}
      </div>

      {/* Weaknesses */}
      {control.weaknesses && control.weaknesses.length > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 6 }}>Weaknesses ({control.weaknesses.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {control.weaknesses.map((w) => (
              <span key={w} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, backgroundColor: `${EMBRY.red}12`, color: EMBRY.red, border: `1px solid ${EMBRY.red}22` }}>
                {w}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* QRAs */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
        <div style={{ ...label, marginBottom: 8 }}>QRAs ({qras.length})</div>
        {loadingDetail ? (
          <div style={{ fontSize: 12, color: EMBRY.dim }}>Loading...</div>
        ) : qras.length === 0 ? (
          <div style={{ fontSize: 12, color: EMBRY.dim }}>No QRAs found</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {qras.map((qra, i) => (
              <div key={`qra-${control.control_id}-${i}`} onClick={() => setModalQra(qra)} data-qs-action="OPEN_QRA_MODAL" style={{ borderRadius: 6, border: `1px solid ${EMBRY.border}`, overflow: 'hidden', cursor: 'pointer' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = EMBRY.accent }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = EMBRY.border }}>
                <div style={{ padding: '8px 10px', fontSize: 12, lineHeight: 1.5 }}>
                  <span style={{ color: EMBRY.accent }}>Q: </span>
                  <span style={{ color: EMBRY.white }}>{qra.question as string}</span>
                </div>
                {qra.reasoning && !PLACEHOLDER_PATTERN.test(qra.reasoning) && (
                  <div style={{ padding: '8px 10px', borderTop: `1px solid ${EMBRY.border}`, fontSize: 12, lineHeight: 1.5 }}>
                    <span style={{ color: EMBRY.amber }}>R: </span>
                    <span style={{ color: EMBRY.dim }}>{qra.reasoning}</span>
                  </div>
                )}
                {qra.answer && (
                  <div style={{ padding: '8px 10px', borderTop: `1px solid ${EMBRY.border}`, fontSize: 12, lineHeight: 1.5 }}>
                    <span style={{ color: EMBRY.green }}>A: </span>
                    <span style={{ color: EMBRY.dim }}>{qra.answer}</span>
                  </div>
                )}
                {qra.grade && (
                  <div style={{ padding: '4px 10px', borderTop: `1px solid ${EMBRY.border}`, fontSize: 10, color: qra.grade === 'PASS' ? EMBRY.green : EMBRY.red }}>
                    Grade: {qra.grade}
                  </div>
                )}
                {/* Source/prompt info — collapsible */}
                <QRASourceInfo qra={qra} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Relationships */}
      <div style={{ padding: '12px 20px' }}>
        <div style={{ ...label, marginBottom: 8 }}>Relationships ({rels.length})</div>
        {loadingDetail ? (
          <div style={{ fontSize: 12, color: EMBRY.dim }}>Loading...</div>
        ) : rels.length === 0 ? (
          <div style={{ fontSize: 12, color: EMBRY.dim }}>No relationships found</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {rels.map((rel, i) => {
              const other = rel.source_control_id === control.control_id ? rel.target_control_id : rel.source_control_id
              return (
                <div key={`rel-${i}`} onClick={() => {
                    if (!onNavigate || !other) return
                    fetch(`http://localhost:3001/api/memory/list`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ collection: 'sparta_controls', limit: 1, filters: { control_id: other } }),
                    }).then((r) => r.json()).then((d) => {
                      const ctrl = (d.documents ?? [])[0] as SpartaControl | undefined
                      if (ctrl) onNavigate(ctrl)
                    }).catch(() => {})
                  }} data-qs-action="NAVIGATE_RELATIONSHIP" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, backgroundColor: EMBRY.bgDeep, cursor: onNavigate ? 'pointer' : 'default' }}
                  onMouseEnter={(e) => { if (onNavigate) (e.currentTarget as HTMLElement).style.backgroundColor = `${EMBRY.blue}15` }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = EMBRY.bgDeep }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: EMBRY.blue }}>{other}</span>
                  {rel.relationship_type && (
                    <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 'auto', padding: '2px 6px', borderRadius: 4, backgroundColor: `${EMBRY.muted}22` }}>
                      {rel.relationship_type}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* QRA full-screen modal */}
      {modalQra && <QRAModal qra={modalQra} controlId={control.control_id} onClose={() => setModalQra(null)} />}
    </div>
  )
}

/** Full-screen QRA modal for reading + grading. */
function QRAModal({ qra, controlId, onClose }: { qra: Record<string, unknown>; controlId: string; onClose: () => void }) {
  const [grading, setGrading] = useState(false)

  function grade(decision: 'PASS' | 'FAIL') {
    setGrading(true)
    fetch('http://localhost:3001/api/memory/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'sparta_qra',
        problem: qra.question as string,
        solution: qra.answer as string,
        metadata: { _key: qra._key, control_id: controlId, grade: decision, reviewed_by: 'brandon', reviewed_at: new Date().toISOString() },
      }),
    }).then(() => { setGrading(false); onClose() }).catch(() => setGrading(false))
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'a' || e.key === 'A') grade('PASS')
      if (e.key === 'r' || e.key === 'R') grade('FAIL')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const source = (qra.source as string) ?? ''
  const parts = source.split(':')

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose} data-qs-action="CLOSE_QRA_MODAL">
      <div style={{ width: '80%', maxWidth: 900, maxHeight: '90vh', overflow: 'auto', backgroundColor: EMBRY.bgPanel, borderRadius: 12, border: `1px solid ${EMBRY.border}` }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: EMBRY.accent }}>{controlId}</span>
            <span style={{ fontSize: 11, color: EMBRY.dim, marginLeft: 12 }}>
              {parts[1] ?? 'unknown prompt'} · {parts[2] ?? 'unknown model'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => grade('PASS')} disabled={grading} data-qs-action="GRADE_QRA" data-qs-params='{"grade":"PASS"}' style={{ ...modalBtn, color: EMBRY.green, borderColor: `${EMBRY.green}44` }}>Accept (A)</button>
            <button onClick={() => grade('FAIL')} disabled={grading} data-qs-action="GRADE_QRA" data-qs-params='{"grade":"FAIL"}' style={{ ...modalBtn, color: EMBRY.red, borderColor: `${EMBRY.red}44` }}>Reject (R)</button>
            <button onClick={onClose} data-qs-action="CLOSE_QRA_MODAL" style={{ ...modalBtn, color: EMBRY.dim }}>Close (Esc)</button>
          </div>
        </div>

        {/* Question */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 8, color: EMBRY.accent }}>QUESTION</div>
          <div style={{ fontSize: 15, lineHeight: 1.7, color: EMBRY.white }}>{qra.question as string}</div>
        </div>

        {/* Reasoning */}
        {qra.reasoning && (
          <div style={{ padding: '20px 24px', borderBottom: `1px solid ${EMBRY.border}` }}>
            <div style={{ ...label, marginBottom: 8, color: EMBRY.amber }}>REASONING</div>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: EMBRY.dim }}>{qra.reasoning as string}</div>
          </div>
        )}

        {/* Answer */}
        {qra.answer && (
          <div style={{ padding: '20px 24px', borderBottom: `1px solid ${EMBRY.border}` }}>
            <div style={{ ...label, marginBottom: 8, color: EMBRY.green }}>ANSWER</div>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: EMBRY.dim }}>{qra.answer as string}</div>
          </div>
        )}

        {/* Metadata */}
        <div style={{ padding: '16px 24px', display: 'flex', gap: 16, fontSize: 11, color: EMBRY.muted }}>
          {qra.grade && <span>Grade: <span style={{ color: qra.grade === 'PASS' ? EMBRY.green : EMBRY.red, fontWeight: 700 }}>{qra.grade as string}</span></span>}
          {qra.confidence && <span>Confidence: {qra.confidence as string}</span>}
          {qra.question_type && <span>Type: {qra.question_type as string}</span>}
          <span>Prompt: {parts[1] ?? 'legacy'}</span>
          <span>Model: {parts[2] ?? 'unknown'}</span>
        </div>
      </div>
    </div>
  )
}

const modalBtn: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 6,
  border: `1px solid ${EMBRY.border}`, backgroundColor: 'transparent',
  cursor: 'pointer', color: EMBRY.white,
}

/** Collapsible source info showing which prompt/model generated this QRA. */
function QRASourceInfo({ qra }: { qra: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false)
  const source = (qra.source as string) ?? ''
  const method = (qra.generation_method as string) ?? ''
  const confidence = (qra.confidence as string) ?? ''

  if (!source && !method) return null

  // Parse source field: "prompt-lab:sparta_context_v1:DeepSeek-V3"
  const parts = source.split(':')
  const promptName = parts[1] ?? ''
  const modelName = parts[2] ?? ''

  return (
    <div style={{ borderTop: `1px solid ${EMBRY.border}` }}>
      <div
        onClick={() => setExpanded(!expanded)}
        data-qs-action="TOGGLE_SECTION"
        style={{ padding: '4px 10px', fontSize: 10, color: EMBRY.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
      >
        <span style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.1s' }}>▸</span>
        Source: {promptName || source || 'unknown'}
        {modelName && <span style={{ color: EMBRY.dim }}> · {modelName}</span>}
        {confidence && <span style={{ color: EMBRY.dim }}> · {confidence}</span>}
      </div>
      {expanded && (
        <div style={{ padding: '6px 10px', fontSize: 10, color: EMBRY.dim, backgroundColor: EMBRY.bgDeep }}>
          <div>Prompt: <span style={{ color: EMBRY.blue }}>{promptName || 'legacy (pre-prompt-lab)'}</span></div>
          <div>Model: <span style={{ color: EMBRY.white }}>{modelName || 'unknown'}</span></div>
          <div>Method: <span style={{ color: EMBRY.white }}>{method || 'relationship_grounded'}</span></div>
          {confidence && <div>Confidence: <span style={{ color: EMBRY.white }}>{confidence}</span></div>}
        </div>
      )}
    </div>
  )
}

function MetaField({ label: l, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ ...label, marginBottom: 2 }}>{l}</div>
      <div style={{ fontSize: 12, color: EMBRY.white, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</div>
    </div>
  )
}

/* ── Main Controls View ─────────────────────────────────────────────────── */

export function ControlsView() {
  const [page, setPage] = useState(0)
  const [fwFilter, setFwFilter] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<SpartaControl | null>(null)
  const [toast, showToast] = useToast()

  const rawFw = fwFilter ? FW_TO_RAW[fwFilter] : undefined
  const { data: controls, total, loading, error } = useControlsPaginated(page, PAGE_SIZE, rawFw)

  // Reset page when framework changes
  useEffect(() => { setPage(0) }, [fwFilter])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Client-side search filter (within current page)
  const filtered = search
    ? controls.filter((c) =>
        c.control_id.toLowerCase().includes(search.toLowerCase()) ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.description ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : controls

  if (error) {
    return <div style={{ padding: 20, color: EMBRY.red, border: `1px solid ${EMBRY.red}33`, borderRadius: 8, margin: 16 }}>Error: {error}</div>
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
      {/* Main table area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header bar */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: EMBRY.white }}>Controls</div>
            <div style={{ ...label, marginTop: 2 }}>
              {total.toLocaleString()} total
              {fwFilter ? ` · ${fwFilter}` : ''}
              {search ? ` · ${filtered.length} matching "${search}"` : ''}
            </div>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-qs-input="controls-search"
            placeholder="Search this page..."
            style={{
              backgroundColor: EMBRY.bgDeep,
              border: `1px solid ${EMBRY.border}`,
              borderRadius: 6,
              padding: '5px 10px',
              fontSize: 12,
              color: EMBRY.white,
              outline: 'none',
              width: 180,
            }}
          />
        </div>

        {/* Framework filter pills */}
        <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexWrap: 'wrap', flexShrink: 0 }}>
          {FRAMEWORKS.map((fw) => {
            const isActive = fw === 'ALL' ? !fwFilter : fwFilter === fw
            const color = fw === 'ALL' ? EMBRY.white : (EMBRY.fw[fw] ?? EMBRY.dim)
            return (
              <button
                key={fw}
                onClick={() => setFwFilter(fw === 'ALL' ? undefined : fw)}
                data-qs-action="SET_FRAMEWORK_FILTER"
                data-qs-params={JSON.stringify({ framework: fw })}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: 4,
                  border: `1px solid ${isActive ? color : EMBRY.border}`,
                  backgroundColor: isActive ? `${color}22` : 'transparent',
                  color: isActive ? color : EMBRY.dim,
                  cursor: 'pointer',
                }}
              >
                {fw}
              </button>
            )
          })}
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div style={{ padding: 20, color: EMBRY.dim }}>Loading page {page + 1}...</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 28 }}></th>
                  <th style={thStyle}>FW</th>
                  <th style={{ ...thStyle, width: 80 }}>Status</th>
                  <th style={thStyle}>ID</th>
                  <th style={{ ...thStyle, width: '35%' }}>Name</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Issues</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ctrl) => {
                  const fw = normalizeFramework(ctrl.source_framework)
                  const deprecated = ctrl.status === 'deprecated' || (ctrl.description ?? '').startsWith('[Deprecated]') || (ctrl.description ?? '').startsWith('[Withdrawn')
                  const placeholder = !deprecated && isPlaceholder(ctrl.description)
                  const hasIssues = (ctrl.weaknesses?.length ?? 0) > 0
                  const noDesc = !deprecated && (!ctrl.description || ctrl.description.length < 10)
                  const rowOk = !deprecated && !placeholder && !hasIssues && !noDesc
                  const rowColor = deprecated ? EMBRY.muted : rowOk ? EMBRY.green : placeholder || noDesc ? EMBRY.amber : EMBRY.red
                  const isSelected = selected?.control_id === ctrl.control_id
                  return (
                    <tr
                      key={ctrl.control_id}
                      onClick={() => setSelected(ctrl)}
                      data-qs-action="SELECT_CONTROL"
                      data-qs-params={JSON.stringify({ controlId: ctrl.control_id, framework: fw })}
                      style={{
                        ...magneticRow,
                        ...(isSelected ? magneticRowSelected : {}),
                        opacity: deprecated ? 0.5 : 1,
                        borderLeftColor: isSelected ? EMBRY.blue : 'transparent',
                      }}
                      onMouseEnter={(e) => applyMagneticHover(e.currentTarget, isSelected)}
                      onMouseLeave={(e) => removeMagneticHover(e.currentTarget, isSelected)}
                    >
                      <td style={{ ...tdStyle, textAlign: 'center' }}><div style={glowDot(rowColor, 6)} /></td>
                      <td style={tdStyle}><span style={fwBadge(fw)}>{fw}</span></td>
                      <td style={tdStyle}>
                        {(() => { const s = nrsToStatus(ctrl.nrs_score); return s !== 'none' ? <span style={statusBadgeStyle(s)}>{statusBadgeLabel(s)}</span> : null })()}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{ctrl.control_id}</td>
                      <td style={{ ...tdStyle, color: deprecated ? EMBRY.muted : EMBRY.dim }}>{ctrl.name}</td>
                      <td style={{ ...tdStyle, fontSize: 10, color: EMBRY.dim }}>{ctrl.control_type}</td>
                      <td style={tdStyle}>
                        {deprecated ? (
                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: `${EMBRY.muted}18`, color: EMBRY.muted }}>DEPRECATED</span>
                        ) : placeholder ? (
                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: `${EMBRY.amber}18`, color: EMBRY.amber }}>NO DESC</span>
                        ) : hasIssues ? (
                          <span style={{ fontSize: 10, color: EMBRY.red }}>{ctrl.weaknesses?.length} weaknesses</span>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div style={{ padding: '8px 16px', borderTop: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            data-qs-action="PAGE_PREV"
            style={paginationBtn(page > 0)}
          >
            Prev
          </button>
          <span style={{ fontSize: 12, color: EMBRY.dim }}>
            Page {page + 1} of {totalPages || 1}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            data-qs-action="PAGE_NEXT"
            style={paginationBtn(page < totalPages - 1)}
          >
            Next
          </button>
          <span style={{ fontSize: 11, color: EMBRY.muted, marginLeft: 'auto' }}>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Detail flyout (overlays from right) */}
      {selected && (
        <div style={flyoutStyle}>
          <ControlDetailPane control={selected} onClose={() => setSelected(null)} onNavigate={(ctrl) => setSelected(ctrl)} onToast={showToast} />
        </div>
      )}
      {toast}
    </div>
  )
}

/* ── Styles ──────────────────────────────────────────────────────────────── */

const thStyle: React.CSSProperties = {
  ...label,
  padding: '8px 10px',
  textAlign: 'left',
  borderBottom: `1px solid ${EMBRY.border}`,
  backgroundColor: EMBRY.bgDeep,
  whiteSpace: 'nowrap',
  userSelect: 'none',
  position: 'sticky',
  top: 0,
  zIndex: 1,
}

const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  borderBottom: `1px solid ${EMBRY.border}`,
  color: EMBRY.white,
}

const flyoutStyle: React.CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 0,
  width: 500,
  height: '100%',
  backgroundColor: EMBRY.bgPanel,
  borderLeft: `1px solid ${EMBRY.border}`,
  boxShadow: '-20px 0 50px rgba(0,0,0,0.8)',
  overflow: 'auto',
  zIndex: 100,
}

function paginationBtn(enabled: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 700,
    padding: '4px 12px',
    borderRadius: 4,
    border: `1px solid ${EMBRY.border}`,
    backgroundColor: enabled ? EMBRY.bgDeep : 'transparent',
    color: enabled ? EMBRY.white : EMBRY.muted,
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.5,
  }
}
