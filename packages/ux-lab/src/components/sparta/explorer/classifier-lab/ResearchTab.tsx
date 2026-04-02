import { useState, useEffect } from 'react'
import { FileText, ShieldCheck, AlertTriangle } from 'lucide-react'
import { marked } from 'marked'
import { EMBRY, heading, body, card, panel, label } from '../../common/EmbryStyle'
import { useRegisterAction } from '../../../../hooks/useRegisterAction'

import { API, MONO } from './types'
import type { ResearchTimelineEntry } from './types'
import { MD_CSS } from './shared'

export function ResearchTab({ projectId, gateInfo }: { projectId: string; gateInfo?: any }) {
  const [md, setMd] = useState('')
  const [timeline, setTimeline] = useState<ResearchTimelineEntry[]>([])
  const [nextStepsQuery, setNextStepsQuery] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const [loading, setLoading] = useState(true)

  const APP = 'classifier-lab'
  useRegisterAction('clf-research:btn', { app: APP, action: 'CLF_RESEARCH_SELECT_ENTRY', label: 'Select Timeline Entry', description: 'Select a research timeline entry to view its details' })

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/projects/classifier-lab/research/${projectId}`)
      .then(r => r.json())
      .then(d => {
        setMd(d.markdown || '')
        setTimeline(Array.isArray(d.timeline) ? d.timeline : [])
        setNextStepsQuery(d.nextStepsQuery || null)
        setSelectedIdx(-1)
        setLoading(false)
      })
      .catch(() => { setMd(''); setTimeline([]); setLoading(false) })
  }, [projectId])

  if (loading) return <div style={{ color: EMBRY.dim, padding: 40 }}>Loading research...</div>

  if (!md && timeline.length === 0) return (
    <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
      <div style={card}>
        <div style={{ padding: 40 }}>
          <FileText size={32} color={EMBRY.dim} style={{ marginBottom: 12 }} />
          <div style={{ ...heading, color: EMBRY.dim, marginBottom: 8 }}>NO RESEARCH OUTPUT</div>
          <div style={{ ...body, fontSize: 12, color: EMBRY.muted }}>
            Run <code style={{ color: EMBRY.accent, fontFamily: MONO }}>/dogpile</code> to research optimal backbones for this task.
          </div>
        </div>
      </div>
    </div>
  )

  const items: Array<{ label: string; sublabel: string; color: string; idx: number }> = []
  if (md) items.push({ label: 'INITIAL RESEARCH', sublabel: 'Pre-training /dogpile', color: EMBRY.accent, idx: -1 })
  timeline.forEach((t, i) => {
    const phaseLabel = t.phase === 'research' ? 'Pre-training' :
      t.phase.startsWith('round-') ? `Round ${t.round} failure` :
      t.phase === 'targeted-research' ? 'Targeted' : t.phase
    items.push({
      label: `R${t.round}`,
      sublabel: phaseLabel,
      color: t.round === 0 ? EMBRY.accent : EMBRY.amber,
      idx: i,
    })
  })
  if (nextStepsQuery) items.push({ label: 'NEXT STEPS', sublabel: 'Post-exhaustion hypothesis', color: EMBRY.green, idx: -2 })

  let detailTitle = ''
  let detailContent = ''
  let detailMeta = ''
  let detailIsMarkdown = false

  if (selectedIdx === -1 && md) {
    detailTitle = 'Initial Research'
    detailContent = md
    detailIsMarkdown = true
  } else if (selectedIdx === -2 && nextStepsQuery) {
    detailTitle = 'Next-Step Hypotheses'
    detailContent = nextStepsQuery
    detailIsMarkdown = true
    detailMeta = 'Generated after all training rounds exhausted'
  } else if (selectedIdx >= 0 && selectedIdx < timeline.length) {
    const entry = timeline[selectedIdx]
    detailTitle = `Round ${entry.round} — ${entry.phase}`
    detailContent = entry.query
    detailMeta = `${entry.resultLength.toLocaleString()} chars returned · ${new Date(entry.timestamp * 1000).toLocaleString()}`
  }

  const hasTimeline = items.length > 1

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <style>{MD_CSS}</style>
      {gateInfo && (
        <div style={{
          ...panel, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12,
          border: `1px solid ${gateInfo.passed ? EMBRY.green : EMBRY.red}33`,
          background: `${gateInfo.passed ? EMBRY.green : EMBRY.red}08`,
        }}>
          {gateInfo.passed
            ? <ShieldCheck size={14} color={EMBRY.green} />
            : <AlertTriangle size={14} color={EMBRY.red} />}
          <span style={{ fontSize: 10, fontWeight: 700, color: gateInfo.passed ? EMBRY.green : EMBRY.red }}>
            RESEARCH GATE {gateInfo.passed ? 'PASSED' : 'FAILED'}
          </span>
          {gateInfo.hash && (
            <span style={{ fontSize: 9, color: EMBRY.muted, fontFamily: MONO, marginLeft: 'auto' }}>
              SHA: {gateInfo.hash} · {gateInfo.lineCount} lines
              {gateInfo.memoryVerified && ' · ✓ /memory verified'}
            </span>
          )}
          {!gateInfo.passed && (
            <span style={{ fontSize: 9, color: EMBRY.red, marginLeft: 'auto' }}>
              {gateInfo.message || 'Run /dogpile to unlock Tune/Train tabs'}
            </span>
          )}
        </div>
      )}

      {hasTimeline ? (
        <div style={{ display: 'flex', border: `1px solid ${EMBRY.border}`, borderRadius: 8, overflow: 'hidden', minHeight: 500 }}>
          <div style={{ width: 220, flexShrink: 0, borderRight: `1px solid ${EMBRY.border}`, background: EMBRY.bgCard, overflowY: 'auto' }}>
            <div style={{ ...label, padding: '12px 14px 8px', fontSize: 8 }}>RESEARCH TIMELINE</div>
            {items.map(item => {
              const isActive = item.idx === selectedIdx
              return (
                <button data-qid="clf-research:btn"
                  data-qs-action="CLF_RESEARCH_SELECT_ENTRY"
                  title="Select research timeline entry"
                  key={item.idx}
                  onClick={() => setSelectedIdx(item.idx)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: isActive ? 'rgba(124,58,237,0.08)' : 'transparent',
                    border: 'none', borderLeft: isActive ? `3px solid ${item.color}` : '3px solid transparent',
                    padding: '10px 14px', cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, fontFamily: MONO, color: isActive ? item.color : EMBRY.dim }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 9, color: isActive ? EMBRY.white : EMBRY.muted, marginTop: 2 }}>
                    {item.sublabel}
                  </div>
                </button>
              )
            })}
          </div>

          <div style={{ flex: 1, padding: 28, overflowY: 'auto', background: EMBRY.bg }}>
            {detailTitle && (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
                  <span style={{ ...heading, fontSize: 16, color: EMBRY.white }}>{detailTitle}</span>
                  {detailMeta && <span style={{ fontSize: 9, color: EMBRY.muted, fontFamily: MONO }}>{detailMeta}</span>}
                </div>
                {detailIsMarkdown ? (
                  <div className="clf-markdown" style={{ ...body, lineHeight: 1.8 }}
                    dangerouslySetInnerHTML={{ __html: marked(detailContent) as string }} />
                ) : (
                  <div style={{
                    background: EMBRY.bgCard, borderLeft: `3px solid ${EMBRY.accent}`,
                    padding: 16, borderRadius: 4, fontFamily: MONO, fontSize: 11,
                    color: EMBRY.white, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                  }}>
                    {detailContent}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div style={{ ...card, padding: 32 }}>
          <div className="clf-markdown" style={{ ...body, lineHeight: 1.8 }}
            dangerouslySetInnerHTML={{ __html: marked(md) as string }} />
        </div>
      )}
    </div>
  )
}
