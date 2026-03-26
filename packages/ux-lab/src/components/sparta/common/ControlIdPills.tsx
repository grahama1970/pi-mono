/**
 * ControlIdPills — Renders control IDs as clickable, color-coded pill badges
 * with rich hover tooltips showing name + description.
 *
 * Two modes:
 *   ids=[...] — render known IDs directly (structured data, no extraction needed)
 *   text="..." — send to /api/extract-entities for server-side extraction
 */
import { useState, useEffect, useRef } from 'react'
import { EMBRY } from '../../common/EmbryStyle'

const API = 'http://localhost:3001'

interface ControlInfo {
  name: string
  description: string
  framework: string
}

// Module-level cache — persists across renders, shared by all pill instances
const infoCache = new Map<string, ControlInfo | null>()
const pendingLookups = new Set<string>()

async function resolveControlInfo(controlId: string): Promise<ControlInfo | null> {
  if (infoCache.has(controlId)) return infoCache.get(controlId) ?? null
  if (pendingLookups.has(controlId)) return null
  pendingLookups.add(controlId)
  try {
    const res = await fetch(`${API}/api/memory/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'sparta_controls', limit: 1,
        filters: { control_id: controlId },
        return_fields: ['control_id', 'name', 'description', 'source_framework'],
      }),
    })
    const data = await res.json()
    const doc = data.documents?.[0] as { name?: string; description?: string; source_framework?: string } | undefined
    if (doc?.name) {
      // Clean description for tooltip — strip INFERRED prefix + cross-refs
      let desc = doc.description ?? ''
      desc = desc.replace(/^\[INFERRED[^\]]*\]\s*/i, '')
      const xrefIdx = desc.indexOf('[Cross-references]')
      if (xrefIdx >= 0) desc = desc.slice(0, xrefIdx).trim()
      if (desc.length > 200) desc = desc.slice(0, 200) + '...'

      const info: ControlInfo = { name: doc.name, description: desc, framework: doc.source_framework ?? '' }
      infoCache.set(controlId, info)
      return info
    }
    infoCache.set(controlId, null)
    return null
  } catch {
    return null
  } finally {
    pendingLookups.delete(controlId)
  }
}

// Framework color mapping
const FW_COLORS: Record<string, string> = {
  SPARTA: EMBRY.accent,
  sparta: EMBRY.accent,
  NIST: EMBRY.blue,
  nist: EMBRY.blue,
  CWE: EMBRY.amber,
  cwe: EMBRY.amber,
  'ATT&CK': EMBRY.red,
  D3FEND: EMBRY.green,
  d3fend: EMBRY.green,
  ISO: '#e0e0e0',
  iso: '#e0e0e0',
}

function colorForId(id: string, framework?: string): string {
  if (framework && FW_COLORS[framework]) return FW_COLORS[framework]
  // Infer from ID prefix
  const upper = id.toUpperCase()
  if (upper.startsWith('CWE-')) return EMBRY.amber
  if (upper.startsWith('D3F:')) return EMBRY.green
  if (upper.startsWith('T') && /^T\d{4}/.test(id)) return EMBRY.red
  if (/^(PM|RA|AC|SC|SI|AU|CA|CP|IA|IR|MA|MP|PE|PL|PS|SA|AT|SR)-/.test(upper)) return EMBRY.blue
  return EMBRY.accent // SPARTA default
}

interface ControlIdPillsProps {
  ids?: string[]
  text?: string
  collection?: string
  onControlClick?: (controlId: string) => void
}

export function ControlIdPills({ ids, text, collection, onControlClick }: ControlIdPillsProps) {
  const [entities, setEntities] = useState<Array<{ id: string; framework?: string }>>([])
  const [loading, setLoading] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [tooltipInfo, setTooltipInfo] = useState<Record<string, ControlInfo>>({})
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const tooltipRef = useRef<HTMLDivElement>(null)

  const idsKey = ids?.join(',') ?? ''

  useEffect(() => {
    if (idsKey) {
      setEntities(idsKey.split(',').filter(Boolean).map(id => ({ id })))
      return
    }
    if (!text) return
    let cancelled = false
    setLoading(true)
    fetch(`${API}/api/extract-entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, collection: collection || 'sparta_controls', delimiter: 'auto' }),
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        setEntities((data.entities ?? []).map((e: any) => ({ id: e.id ?? e.name, framework: e.framework })))
      })
      .catch(() => { if (!cancelled) setEntities([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [idsKey, text, collection])

  const handleMouseEnter = (id: string, e: React.MouseEvent) => {
    setHoveredId(id)
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setTooltipPos({ x: rect.left, y: rect.bottom + 4 })

    if (!tooltipInfo[id]) {
      resolveControlInfo(id).then(info => {
        if (info) setTooltipInfo(prev => ({ ...prev, [id]: info }))
      })
    }
  }

  if (loading) return <span style={{ fontSize: 10, color: EMBRY.dim }}>resolving...</span>
  if (entities.length === 0 && !text) return null
  if (entities.length === 0 && text) return <span style={{ fontSize: 12, color: EMBRY.dim }}>{text}</span>

  const hoveredInfo = hoveredId ? tooltipInfo[hoveredId] : null

  return (
    <>
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 3 }}>
        {entities.map((ent, i) => {
          const color = colorForId(ent.id, ent.framework)
          const isHovered = hoveredId === ent.id
          return (
            <span
              key={`${ent.id}-${i}`}
              onClick={(e) => { e.stopPropagation(); onControlClick?.(ent.id) }}
              onMouseEnter={(e) => handleMouseEnter(ent.id, e)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'inline-block',
                fontSize: 10,
                fontWeight: 700,
                fontFamily: '"JetBrains Mono", "SF Mono", monospace',
                padding: '2px 8px',
                borderRadius: 4,
                color: isHovered ? '#fff' : color,
                backgroundColor: isHovered ? `${color}33` : `${color}12`,
                border: `1px solid ${isHovered ? color : `${color}33`}`,
                cursor: onControlClick ? 'pointer' : 'default',
                transition: 'all 0.15s',
                lineHeight: '18px',
              }}
            >
              {ent.id}
            </span>
          )
        })}
      </span>

      {/* Rich tooltip */}
      {hoveredId && (
        <div
          ref={tooltipRef}
          style={{
            position: 'fixed',
            left: Math.min(tooltipPos.x, window.innerWidth - 320),
            top: tooltipPos.y,
            width: 300,
            zIndex: 9999,
            backgroundColor: '#0a0b0d',
            border: `1px solid ${EMBRY.border}`,
            borderRadius: 8,
            padding: '10px 14px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.8)',
            pointerEvents: 'none',
          }}
        >
          {/* ID + framework */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{
              fontSize: 11, fontWeight: 900,
              fontFamily: '"JetBrains Mono", monospace',
              color: colorForId(hoveredId, hoveredInfo?.framework),
            }}>
              {hoveredId}
            </span>
            {hoveredInfo?.framework && (
              <span style={{
                fontSize: 8, fontWeight: 700, textTransform: 'uppercase',
                padding: '1px 5px', borderRadius: 3,
                color: colorForId(hoveredId, hoveredInfo.framework),
                backgroundColor: `${colorForId(hoveredId, hoveredInfo.framework)}18`,
                letterSpacing: '0.05em',
              }}>
                {hoveredInfo.framework}
              </span>
            )}
          </div>

          {/* Name */}
          {hoveredInfo ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: EMBRY.white, lineHeight: 1.4, marginBottom: hoveredInfo.description ? 6 : 0 }}>
                {hoveredInfo.name}
              </div>
              {hoveredInfo.description && (
                <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.5, borderTop: `1px solid ${EMBRY.border}`, paddingTop: 6 }}>
                  {hoveredInfo.description}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 10, color: EMBRY.muted, fontStyle: 'italic' }}>Loading...</div>
          )}
        </div>
      )}
    </>
  )
}
