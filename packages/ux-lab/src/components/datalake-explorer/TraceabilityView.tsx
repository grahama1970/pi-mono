import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { EMBRY, label } from '../common/EmbryStyle'

const API = 'http://localhost:3001'
const MONO = '"JetBrains Mono", "SF Mono", monospace'

interface TraceItem {
  id?: string
  title?: string
  text?: string
  page?: number
}

interface TraceData {
  document?: string
  requirements?: TraceItem[]
  sections?: TraceItem[]
  tables?: TraceItem[]
  figures?: TraceItem[]
}

const GROUPS: { key: keyof Pick<TraceData, 'requirements' | 'sections' | 'tables' | 'figures'>; label: string; color: string }[] = [
  { key: 'requirements', label: 'Requirements', color: '#FF9800' },
  { key: 'sections', label: 'Sections', color: '#4CAF50' },
  { key: 'tables', label: 'Tables', color: '#2196F3' },
  { key: 'figures', label: 'Figures', color: '#9C27B0' },
]

function truncate(s: string, max = 80): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

function GroupSection({ groupLabel, color, items }: { groupLabel: string; color: string; items: TraceItem[] }) {
  const [open, setOpen] = useState(true)
  const toggle = useCallback(() => setOpen(v => !v), [])
  const Icon = open ? ChevronDown : ChevronRight

  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={toggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          width: '100%', textAlign: 'left',
          padding: '8px 12px', cursor: 'pointer',
          background: `${color}0a`, border: 'none', borderLeft: `3px solid ${color}`,
          borderRadius: 0, color, fontFamily: MONO, fontSize: 11, fontWeight: 700,
          letterSpacing: '0.04em',
        }}
      >
        <Icon size={14} />
        {groupLabel} ({items.length})
      </button>
      {open && (
        <div style={{ paddingLeft: 20 }}>
          {items.length === 0 && (
            <div style={{ padding: '6px 12px', fontSize: 10, color: EMBRY.dim, fontFamily: MONO }}>
              None detected
            </div>
          )}
          {items.map((item, i) => {
            const display = item.title || item.text || item.id || `Item ${i + 1}`
            return (
              <div
                key={item.id ?? i}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 12px', borderBottom: `1px solid ${EMBRY.border}`,
                  fontSize: 11, fontFamily: MONO, color: EMBRY.white,
                }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {truncate(display)}
                </span>
                {item.page != null && (
                  <span style={{ fontSize: 9, color: EMBRY.dim, flexShrink: 0 }}>
                    p.{item.page}
                  </span>
                )}
                <button
                  style={{
                    fontSize: 8, fontWeight: 700, fontFamily: MONO,
                    padding: '2px 6px', borderRadius: 3, cursor: 'pointer',
                    color: EMBRY.accent, background: `${EMBRY.accent}12`,
                    border: `1px solid ${EMBRY.accent}33`, flexShrink: 0,
                  }}
                >
                  Evidence
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function TraceabilityView({ docKey }: { docKey: string | null }) {
  const [data, setData] = useState<TraceData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!docKey) { setData(null); return }
    setLoading(true)
    setError(false)
    fetch(`${API}/api/datalake/traceability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_key: docKey }),
    })
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json()
      })
      .then((d: any) => {
        if (d && typeof d === 'object') {
          setData(d as TraceData)
        } else {
          setData(null)
          setError(true)
        }
      })
      .catch(() => {
        setData(null)
        setError(true)
      })
      .finally(() => setLoading(false))
  }, [docKey])

  if (!docKey) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: EMBRY.dim, fontFamily: MONO, fontSize: 12 }}>
        Select a document to view traceability
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: EMBRY.amber, fontFamily: MONO, fontSize: 11 }}>
        Loading traceability...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: EMBRY.dim, fontFamily: MONO, fontSize: 12 }}>
        No traceability data
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ ...label, marginBottom: 12 }}>Traceability</div>
      {data.document && (
        <div style={{
          fontFamily: MONO, fontSize: 12, fontWeight: 700, color: EMBRY.white,
          padding: '8px 12px', marginBottom: 12,
          background: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`, borderRadius: 6,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {data.document}
        </div>
      )}
      {GROUPS.map(g => {
        const items = Array.isArray(data[g.key]) ? data[g.key]! : []
        return <GroupSection key={g.key} groupLabel={g.label} color={g.color} items={items} />
      })}
    </div>
  )
}
