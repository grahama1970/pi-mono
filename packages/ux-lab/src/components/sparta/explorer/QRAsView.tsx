import { useState, useEffect, useCallback } from 'react'
import { EMBRY, card, label, heading, body, glowDot } from '../common/EmbryStyle'
import { useQRAs } from '../../../hooks/useSpartaCollections'
import type { SpartaQRA } from '../../../hooks/useSpartaCollections'
import { useSpartaNav } from './SpartaExplorer'

function groundingColor(score: number | undefined): string {
  if (score == null) return EMBRY.dim
  if (score >= 0.80) return EMBRY.green
  if (score >= 0.60) return EMBRY.amber
  return EMBRY.red
}

function tierBadge(pass: boolean | undefined, tier: string): React.ReactNode {
  const color = pass === true ? EMBRY.green : pass === false ? EMBRY.red : EMBRY.dim
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
      color, backgroundColor: `${color}15`, border: `1px solid ${color}30`,
    }}>
      {tier}: {pass === true ? 'PASS' : pass === false ? 'FAIL' : '—'}
    </span>
  )
}

export function QRAsView() {
  const nav = useSpartaNav()
  const controlFilter = nav.tabFilters.QRAs?.controlId
  const { data: qras, loading, error, refresh } = useQRAs("", controlFilter)
  const [currentIndex, setCurrentIndex] = useState(0)

  // Reset index when filter changes
  useEffect(() => { setCurrentIndex(0) }, [controlFilter])
  const [decisions, setDecisions] = useState<Map<string, 'accept' | 'reject'>>(new Map())
  const [undoTimer, setUndoTimer] = useState<{ key: string; timer: number } | null>(null)

  const current = qras[currentIndex] as SpartaQRA | undefined

  // A/R/E keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (!current) return
      if (e.key === 'a' || e.key === 'A') handleDecision('accept')
      if (e.key === 'r' || e.key === 'R') handleDecision('reject')
      if (e.key === 'e' || e.key === 'E') {/* edit mode — future */ }
      if (e.key === 'ArrowRight' || e.key === 'j') advance(1)
      if (e.key === 'ArrowLeft' || e.key === 'k') advance(-1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function handleDecision(decision: 'accept' | 'reject') {
    if (!current) return
    const key = current._key
    setDecisions((prev) => new Map(prev).set(key, decision))

    // Persist grade to ArangoDB via /learn
    const grade = decision === 'accept' ? 'PASS' : 'FAIL'
    fetch('http://localhost:3001/api/memory/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'sparta_qra',
        problem: current.question,
        solution: current.answer,
        metadata: {
          _key: key,
          control_id: current.control_id,
          grade,
          reviewed_by: 'brandon',
          reviewed_at: new Date().toISOString(),
        },
      }),
    }).catch(() => {/* silent — undo handles recovery */})

    // Undo-based: 10s reversal window
    if (undoTimer) clearTimeout(undoTimer.timer)
    const timer = window.setTimeout(() => setUndoTimer(null), 10_000)
    setUndoTimer({ key, timer })

    advance(1)
  }

  function undoLast() {
    if (!undoTimer) return
    clearTimeout(undoTimer.timer)
    setDecisions((prev) => {
      const next = new Map(prev)
      next.delete(undoTimer.key)
      return next
    })
    setUndoTimer(null)
    advance(-1)
  }

  function advance(dir: number) {
    setCurrentIndex((i) => Math.max(0, Math.min(qras.length - 1, i + dir)))
  }

  if (error) {
    return <div style={{ padding: 20, color: EMBRY.red, border: `1px solid ${EMBRY.red}33`, borderRadius: 8, margin: 16 }}>Error: {error}</div>
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Left: Card stack */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Nav bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
          <div style={heading}>QRA Review</div>
          <div style={{ ...label }}>{currentIndex + 1} / {qras.length}</div>
          {controlFilter && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', backgroundColor: `${EMBRY.accent}12`, borderRadius: 4, border: `1px solid ${EMBRY.accent}33` }}>
              <span style={{ fontSize: 10, color: EMBRY.accent }}>Filtered: {controlFilter}</span>
              <button onClick={() => nav.clearTabFilter('QRAs')} style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', fontSize: 12 }}>×</button>
            </div>
          )}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: EMBRY.dim }}>
            A=Accept R=Reject E=Edit | ←→ navigate
          </span>
          {undoTimer && (
            <button onClick={undoLast} style={{
              fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
              border: `1px solid ${EMBRY.amber}44`, backgroundColor: `${EMBRY.amber}12`, color: EMBRY.amber,
            }}>
              Undo (10s)
            </button>
          )}
        </div>

        {/* Card */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {loading ? (
            <div style={{ color: EMBRY.dim, padding: 20 }}>Loading QRAs...</div>
          ) : !current ? (
            <div style={{ color: EMBRY.dim, padding: 20 }}>No QRAs found</div>
          ) : (
            <div style={{ ...card, maxWidth: 700 }}>
              {/* Tier badges */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {tierBadge(current.tier0_pass, 'T0')}
                {tierBadge(current.tier15_pass, 'T1.5')}
                {tierBadge(current.tier2_pass, 'T2')}
                {current.control_id && (
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: EMBRY.blue, marginLeft: 'auto' }}>
                    {current.control_id}
                  </span>
                )}
              </div>

              {/* Question */}
              <div style={{ ...label, marginBottom: 4 }}>Question</div>
              <div style={{ ...body, fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
                {current.question}
              </div>

              {/* Answer */}
              <div style={{ ...label, marginBottom: 4 }}>Answer</div>
              <div style={{ ...body, marginBottom: 16, color: EMBRY.dim }}>
                {current.answer}
              </div>

              {/* Reasoning */}
              <div style={{ ...label, marginBottom: 4 }}>Reasoning</div>
              <div style={{
                ...body, color: EMBRY.dim, fontSize: 12,
                padding: 12, backgroundColor: EMBRY.bgDeep, borderRadius: 8,
                border: `1px solid ${EMBRY.border}`,
              }}>
                {current.reasoning}
              </div>

              {/* Grounding score bar */}
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ ...label }}>Grounding</div>
                <div style={{ flex: 1, height: 6, backgroundColor: EMBRY.bgDeep, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${(current.grounding_score ?? 0) * 100}%`,
                    height: '100%',
                    backgroundColor: groundingColor(current.grounding_score),
                    borderRadius: 3,
                    transition: 'width 0.3s',
                  }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: groundingColor(current.grounding_score) }}>
                  {current.grounding_score != null ? `${(current.grounding_score * 100).toFixed(0)}%` : '—'}
                </span>
              </div>

              {/* Mind tags */}
              <div style={{ marginTop: 12 }}>
                <div style={{ ...label, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  Mind Tags
                  <div style={glowDot(current.mind && current.mind.length > 0 ? EMBRY.green : EMBRY.red, 6)} />
                </div>
                {current.mind && current.mind.length > 0 ? (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {current.mind.map((tag) => (
                      <span key={tag} style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                        backgroundColor: `${EMBRY.accent}18`, color: EMBRY.accent,
                        border: `1px solid ${EMBRY.accent}33`,
                      }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: EMBRY.red, padding: '4px 8px', borderRadius: 4, backgroundColor: `${EMBRY.red}08` }}>
                    No taxonomy tags — /taxonomy not run
                  </div>
                )}
              </div>

              {/* Decision indicator */}
              {decisions.has(current._key) && (
                <div style={{
                  marginTop: 16, padding: '8px 12px', borderRadius: 6,
                  backgroundColor: decisions.get(current._key) === 'accept' ? `${EMBRY.green}12` : `${EMBRY.red}12`,
                  border: `1px solid ${decisions.get(current._key) === 'accept' ? EMBRY.green : EMBRY.red}33`,
                  color: decisions.get(current._key) === 'accept' ? EMBRY.green : EMBRY.red,
                  fontSize: 12, fontWeight: 700,
                }}>
                  {decisions.get(current._key) === 'accept' ? 'ACCEPTED' : 'REJECTED'}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button onClick={() => handleDecision('accept')} style={acceptBtn}>Accept (A)</button>
                <button onClick={() => handleDecision('reject')} style={rejectBtn}>Reject (R)</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Evidence panel */}
      <div style={{ width: 380, backgroundColor: EMBRY.bgPanel, borderLeft: `1px solid ${EMBRY.border}`, overflow: 'auto', flexShrink: 0, padding: 16 }}>
        <div style={{ ...heading, marginBottom: 12 }}>Evidence Panel</div>
        {!current ? (
          <div style={{ color: EMBRY.dim, fontSize: 12 }}>Select a QRA to view evidence</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Gate summary */}
            <div style={{ ...card, padding: 12 }}>
              <div style={{ ...label, marginBottom: 8 }}>Quality Gates</div>
              <GateRow label="T0 Heuristic" pass={current.tier0_pass} />
              <GateRow label="T1.5 GPT" pass={current.tier15_pass} />
              <GateRow label="T2 Brandon" pass={current.tier2_pass} />
            </div>

            {/* Entity grounding */}
            <div style={{ ...card, padding: 12 }}>
              <div style={{ ...label, marginBottom: 8 }}>Entity Grounding</div>
              <div style={{ fontSize: 12, color: EMBRY.dim }}>
                Control: <span style={{ fontFamily: 'monospace', color: EMBRY.blue }}>{current.control_id}</span>
              </div>
              {current.source_framework && (
                <div style={{ fontSize: 12, color: EMBRY.dim, marginTop: 4 }}>
                  Framework: {current.source_framework}
                </div>
              )}
            </div>

            {/* Score breakdown */}
            <div style={{ ...card, padding: 12 }}>
              <div style={{ ...label, marginBottom: 8 }}>Score</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 28, fontWeight: 900, color: groundingColor(current.grounding_score) }}>
                  {current.grounding_score != null ? (current.grounding_score * 100).toFixed(0) : '—'}
                </span>
                <span style={{ fontSize: 12, color: EMBRY.dim }}>/ 100</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function GateRow({ label: text, pass }: { label: string; pass: boolean | undefined }) {
  const color = pass === true ? EMBRY.green : pass === false ? EMBRY.red : EMBRY.dim
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <div style={glowDot(color, 6)} />
      <span style={{ fontSize: 12, color: EMBRY.white, flex: 1 }}>{text}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color }}>
        {pass === true ? 'PASS' : pass === false ? 'FAIL' : '—'}
      </span>
    </div>
  )
}

const acceptBtn: React.CSSProperties = {
  flex: 1, padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12,
  border: `1px solid ${EMBRY.green}44`, backgroundColor: `${EMBRY.green}12`, color: EMBRY.green,
}
const rejectBtn: React.CSSProperties = {
  flex: 1, padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12,
  border: `1px solid ${EMBRY.red}44`, backgroundColor: `${EMBRY.red}12`, color: EMBRY.red,
}
