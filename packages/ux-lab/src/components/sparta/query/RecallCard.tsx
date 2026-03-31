/**
 * RecallCard — Collapsible memory recall results with score bars.
 */
import { useState, memo } from 'react'
import { EMBRY } from '../common/EmbryStyle'

export interface RecallItem {
  _key?: string
  _source?: string
  control_id?: string
  name?: string
  question?: string
  problem?: string
  solution?: string
  scores?: { bm25?: number; graph?: number; dense?: number; freshness?: number }
}

export interface RecallCardProps {
  items: RecallItem[]
  resultCount: number
  confidence?: number
}

const ScoreBar = memo(function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
      <span style={{ color: EMBRY.dim, width: 42, textAlign: 'right', fontFamily: 'monospace', fontSize: 9 }}>{label}</span>
      <div style={{ flex: 1, height: 3, background: EMBRY.bgDeep, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, value * 100)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontFamily: 'monospace', color: EMBRY.dim, width: 28, fontSize: 9 }}>{value.toFixed(2)}</span>
    </div>
  )
})

function itemLabel(item: RecallItem): string {
  const cid = item.control_id ?? ''
  const text = item.question ?? item.name ?? item.problem ?? item.solution ?? ''
  if (cid && text) return `[${cid}] ${text.slice(0, 100)}`
  if (cid) return cid
  return text.slice(0, 120) || item._key || '?'
}

function sourceColor(src?: string): string {
  if (!src) return EMBRY.dim
  if (src === 'sparta_controls') return EMBRY.accent
  if (src === 'sparta_qra') return EMBRY.blue
  if (src === 'sparta_relationships') return EMBRY.amber
  return EMBRY.green
}

export const RecallCard = memo(function RecallCard({ items, resultCount, confidence }: RecallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState(-1)
  const confValue = confidence ?? (items.length > 0 ? 0.5 : 0)
  const confColor = confValue > 0.7 ? EMBRY.green : confValue > 0.4 ? EMBRY.amber : EMBRY.red

  return (
    <div style={{ margin: '6px 0' }}>
      <button onClick={() => setExpanded(v => !v)} style={{
        display: 'flex', alignItems: 'center', gap: 6, width: '100%',
        fontSize: 11, color: EMBRY.dim, background: 'none', border: 'none',
        cursor: 'pointer', padding: '4px 0', textAlign: 'left',
      }}>
        <span style={{ color: confColor, fontWeight: 700, fontFamily: 'monospace', fontSize: 10 }}>
          {(confValue * 100).toFixed(0)}%
        </span>
        <span>Memory recall</span>
        <span style={{ color: EMBRY.muted }}>{'\u00B7'}</span>
        <span>{resultCount} results</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: EMBRY.muted, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>{'\u25BE'}</span>
      </button>
      {expanded && (
        <div style={{ borderLeft: `2px solid ${confColor}40`, marginLeft: 4, paddingLeft: 10, marginTop: 4 }}>
          {items.slice(0, 8).map((item, i) => (
            <button key={item._key ?? i} onClick={() => setExpandedIdx(expandedIdx === i ? -1 : i)} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '6px 0', cursor: 'pointer', border: 'none', background: 'transparent',
              borderBottom: i < Math.min(items.length, 8) - 1 ? `1px solid ${EMBRY.border}` : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {item._source && <span style={{ fontSize: 8, fontWeight: 700, fontFamily: 'monospace', color: sourceColor(item._source), textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item._source.replace('sparta_', '')}</span>}
                <span style={{ fontSize: 11, color: EMBRY.white, fontWeight: 500 }}>{itemLabel(item).slice(0, 80)}</span>
              </div>
              {expandedIdx === i && item.scores && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <ScoreBar label="BM25" value={item.scores.bm25 ?? 0} color={EMBRY.accent} />
                  <ScoreBar label="Graph" value={item.scores.graph ?? 0} color={EMBRY.blue} />
                  <ScoreBar label="Dense" value={item.scores.dense ?? 0} color={EMBRY.green} />
                  <ScoreBar label="Fresh" value={item.scores.freshness ?? 0} color={EMBRY.amber} />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
