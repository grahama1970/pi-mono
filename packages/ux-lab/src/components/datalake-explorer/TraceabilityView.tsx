import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronDown, Image } from 'lucide-react'
import { EMBRY, label } from '../common/EmbryStyle'

const API = 'http://localhost:3001'
const MONO = '"JetBrains Mono", "SF Mono", monospace'

interface TraceItem {
  id?: string
  _key?: string
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

function GroupSection({ groupLabel, color, items, hasAssets }: { groupLabel: string; color: string; items: TraceItem[]; hasAssets?: boolean }) {
  const [open, setOpen] = useState(true)
  const [imgMap, setImgMap] = useState<Record<string, string | null>>({})
  const toggle = useCallback(() => setOpen(v => !v), [])
  const Icon = open ? ChevronDown : ChevronRight

  const toggleImg = useCallback((key: string) => {
    if (key in imgMap) { setImgMap(m => { const n = { ...m }; delete n[key]; return n }); return }
    setImgMap(m => ({ ...m, [key]: '' }))
    fetch(`${API}/api/datalake/asset/${key}`)
      .then(r => { if (!r.ok) throw new Error(); return r.blob() })
      .then(b => setImgMap(m => ({ ...m, [key]: URL.createObjectURL(b) })))
      .catch(() => setImgMap(m => ({ ...m, [key]: null })))
  }, [imgMap])

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
            const key = item._key || item.id
            return (
              <div key={item.id ?? i}>
                <div
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
                  {hasAssets && key && (
                    <button onClick={() => toggleImg(key)} title="Toggle image preview" style={{
                      display: 'flex', alignItems: 'center', padding: '2px 4px', borderRadius: 3, cursor: 'pointer',
                      color: key in imgMap ? color : EMBRY.dim, background: 'transparent',
                      border: `1px solid ${key in imgMap ? color : EMBRY.border}`, flexShrink: 0,
                    }}><Image size={10} /></button>
                  )}
                  <button
                    onClick={() => console.log('[Evidence]', groupLabel, item)}
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
                {key && key in imgMap && (
                  <div style={{ padding: '6px 12px 8px 12px', borderBottom: `1px solid ${EMBRY.border}` }}>
                    {imgMap[key] === '' && <span style={{ fontSize: 10, color: EMBRY.dim, fontFamily: MONO }}>Loading...</span>}
                    {imgMap[key] === null && <span style={{ fontSize: 10, color: EMBRY.dim, fontFamily: MONO }}>No image available</span>}
                    {imgMap[key] && imgMap[key] !== '' && (
                      <img src={imgMap[key]!} style={{ maxWidth: '100%', maxHeight: 300, border: `1px solid ${EMBRY.border}`, borderRadius: 4 }} />
                    )}
                  </div>
                )}
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
        return <GroupSection key={g.key} groupLabel={g.label} color={g.color} items={items} hasAssets={g.key === 'tables' || g.key === 'figures'} />
      })}
    </div>
  )
}
