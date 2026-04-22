import React from 'react'

export interface Span {
  text: string
  kind: 'control_id' | 'phrase' | 'aerospace_term'
  span: [number, number]
  framework?: string
  name?: string
  grounded_to_framework?: boolean
  source?: string
  origin?: string
  match_type?: string
  control_id?: string
  entity?: string
}

export interface GlossaryEntryLike {
  id?: string
  name?: string
  framework?: string
  type?: string
  description?: string
  source?: string
}

interface TooltipData {
  title: string
  subtitle?: string
  details: string[]
}

export const ENTITY_RE = /(\b[A-Z]{2}-\d+(?:\.\d+)?\b|\bCWE-\d+\b|\b[TS]A?\d{4}(?:\.\d{3})?\b|\bCM-\d{4}\b|\bST-\d{4}\b|\/[a-z][\w-]*)/g

const CHIP_COLORS: Record<string, { color: string; bg: string }> = {
  control:   { color: '#00ff88', bg: 'rgba(0,255,136,0.10)' },
  cwe:       { color: '#ff6b6b', bg: 'rgba(255,107,107,0.10)' },
  attack:    { color: '#ffaa00', bg: 'rgba(255,170,0,0.10)' },
  sparta:    { color: '#22d3ee', bg: 'rgba(34,211,238,0.10)' },
  skill:     { color: '#4a9eff', bg: 'rgba(74,158,255,0.10)' },
  framework: { color: '#c084fc', bg: 'rgba(192,132,252,0.10)' },
}

function norm(v?: string): string {
  return (v ?? '').trim().toLowerCase()
}

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildGlossaryLookup(glossary: GlossaryEntryLike[]): Map<string, GlossaryEntryLike> {
  const map = new Map<string, GlossaryEntryLike>()
  for (const g of glossary ?? []) {
    if (g.id) map.set(norm(g.id), g)
    if (g.name) map.set(norm(g.name), g)
  }
  return map
}

function buildGlossaryRegex(glossary: GlossaryEntryLike[]): RegExp | null {
  const terms = new Set<string>()
  for (const g of glossary ?? []) {
    if (g.id && g.id.trim().length >= 2) terms.add(g.id.trim())
    if (g.name && g.name.trim().length >= 2) terms.add(g.name.trim())
  }
  if (terms.size === 0) return null
  const ordered = [...terms].sort((a, b) => b.length - a.length).map(escapeRegExp)
  return new RegExp(`(${ordered.join('|')})`, 'gi')
}

export function classifyToken(t: string) {
  if (t.startsWith('/')) return 'skill'
  if (/^CWE-/.test(t)) return 'cwe'
  if (/^[TS]A?\d{4}/.test(t)) return 'attack'
  if (/^(CM|ST|RD|REC|DE|IA|EX|PER|LM|EXF|IMP)-\d+/.test(t)) return 'sparta'
  if (/^[A-Z]{2}-\d+/.test(t)) return 'control'
  return 'framework'
}

function typeFromGlossary(g?: GlossaryEntryLike, token?: string): keyof typeof CHIP_COLORS {
  if (!g) return classifyToken(token ?? '') as keyof typeof CHIP_COLORS
  const fw = (g.framework ?? '').toUpperCase()
  if (fw === 'CWE') return 'cwe'
  if (fw.includes('ATT')) return 'attack'
  if (fw === 'SPARTA') return 'sparta'
  if (fw === 'NIST') return 'control'
  if ((g.type ?? '').includes('countermeasure') || (g.type ?? '').includes('technique')) return 'sparta'
  if ((g.type ?? '').includes('control')) return 'control'
  return classifyToken(token ?? '') as keyof typeof CHIP_COLORS
}

function findGlossaryEntry(spanText: string, span: Span, lookup: Map<string, GlossaryEntryLike>): GlossaryEntryLike | undefined {
  const candidates = [spanText, span.text, span.entity, span.control_id, span.name]
  for (const c of candidates) {
    const hit = lookup.get(norm(c))
    if (hit) return hit
  }
  return undefined
}

function buildSpanOrigin(span: Span, glossary?: GlossaryEntryLike): string {
  const source = span.source || span.origin || glossary?.source
  if (source) return `Origin: ${source}`

  if (span.kind === 'control_id') {
    return `Origin: /extract-entities control ID match${glossary?.framework ? ` in ${glossary.framework}` : ''}`
  }
  if (span.kind === 'aerospace_term') {
    return 'Origin: /extract-entities aerospace/domain vocabulary match'
  }
  if (glossary?.framework) {
    return `Origin: /create-evidence-case glossary (${glossary.framework})`
  }
  return 'Origin: /extract-entities phrase match'
}

function buildSpanTooltipData(span: Span, spanText: string, glossary?: GlossaryEntryLike): TooltipData {
  const title = glossary?.name || span.name || spanText
  const framework = glossary?.framework || span.framework
  const id = glossary?.id || span.control_id || span.entity
  const desc = glossary?.description
  const matchType = span.match_type

  const details: string[] = []
  if (id && norm(id) !== norm(title)) details.push(`ID: ${id}`)
  if (framework) details.push(`Framework: ${framework}`)
  details.push(buildSpanOrigin(span, glossary))
  if (matchType) details.push(`Match: ${matchType}`)
  if (span.grounded_to_framework !== undefined) details.push(`Framework Grounded: ${span.grounded_to_framework ? 'yes' : 'no'}`)
  if (desc) details.push(`Definition: ${desc}`)

  return {
    title,
    subtitle: span.kind.replace('_', ' '),
    details,
  }
}

function tooltipTitleText(t: TooltipData): string {
  return [t.title, t.subtitle, ...t.details].filter(Boolean).join('\n')
}

function showTooltip(currentTarget: EventTarget & HTMLSpanElement) {
  const tooltip = currentTarget.querySelector<HTMLElement>('[data-role="entity-tooltip"]')
  if (!tooltip) return
  tooltip.style.opacity = '1'
  tooltip.style.visibility = 'visible'
  tooltip.style.transform = 'translateX(-50%) translateY(0)'
}

function hideTooltip(currentTarget: EventTarget & HTMLSpanElement) {
  const tooltip = currentTarget.querySelector<HTMLElement>('[data-role="entity-tooltip"]')
  if (!tooltip) return
  tooltip.style.opacity = '0'
  tooltip.style.visibility = 'hidden'
  tooltip.style.transform = 'translateX(-50%) translateY(6px)'
}

function renderToken(
  key: string,
  token: string,
  color: string,
  bg: string,
  tooltip: TooltipData,
): React.ReactNode {
  return (
    <span
      key={key}
      title={tooltipTitleText(tooltip)}
      style={{ position: 'relative', display: 'inline-block', cursor: 'help' }}
      onMouseEnter={(e) => showTooltip(e.currentTarget)}
      onMouseLeave={(e) => hideTooltip(e.currentTarget)}
    >
      <span
        style={{
          color,
          fontWeight: 700,
          backgroundColor: bg,
          borderBottom: `1.5px solid ${color}44`,
          textUnderlineOffset: '2px',
          padding: '0 1px',
          display: 'inline',
        }}
      >
        {token}
      </span>

      <span
        data-role="entity-tooltip"
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 'calc(100% + 8px)',
          transform: 'translateX(-50%) translateY(6px)',
          opacity: 0,
          visibility: 'hidden',
          transition: 'opacity 120ms ease, transform 120ms ease',
          pointerEvents: 'none',
          zIndex: 200,
          width: 320,
          maxWidth: '70vw',
          backgroundColor: '#0f1115',
          border: `1px solid ${color}66`,
          borderRadius: 8,
          boxShadow: '0 10px 24px rgba(0,0,0,0.45)',
          padding: '10px 12px',
          textAlign: 'left',
        }}
      >
        <div style={{ color, fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{tooltip.title}</div>
        {tooltip.subtitle && (
          <div style={{ color: '#9ca3af', fontSize: 10, marginBottom: 6, textTransform: 'uppercase' }}>
            {tooltip.subtitle}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {tooltip.details.map((line, idx) => (
            <div key={`${key}-detail-${idx}`} style={{ color: '#d1d5db', fontSize: 10, lineHeight: 1.3 }}>
              {line}
            </div>
          ))}
        </div>
        <span
          style={{
            position: 'absolute',
            left: '50%',
            bottom: -5,
            marginLeft: -5,
            width: 10,
            height: 10,
            backgroundColor: '#0f1115',
            borderRight: `1px solid ${color}66`,
            borderBottom: `1px solid ${color}66`,
            transform: 'rotate(45deg)',
          }}
        />
      </span>
    </span>
  )
}

/**
 * Precise highlighting using ground-truth character spans from Evidence Case.
 * Use this whenever spans are available.
 */
export function spanHighlight(text: string, spans: Span[], glossary: GlossaryEntryLike[] = []) {
  if (!text || !spans || spans.length === 0) return text

  const lookup = buildGlossaryLookup(glossary)
  const sorted = [...spans].sort((a, b) => a.span[0] - b.span[0])

  const result: React.ReactNode[] = []
  let lastIndex = 0

  sorted.forEach((s, i) => {
    const [start, end] = s.span
    if (start < 0 || end > text.length || start >= end) return

    if (start > lastIndex) {
      result.push(<span key={`text-${i}`}>{text.slice(lastIndex, start)}</span>)
    }

    const spanText = text.slice(start, end)
    const glossaryEntry = findGlossaryEntry(spanText, s, lookup)
    const type = s.kind === 'control_id' ? 'control' : s.framework ? 'framework' : typeFromGlossary(glossaryEntry, spanText)
    const { color, bg } = CHIP_COLORS[type] ?? CHIP_COLORS.framework
    const tooltip = buildSpanTooltipData(s, spanText, glossaryEntry)

    result.push(renderToken(`span-${i}`, spanText, color, bg, tooltip))
    lastIndex = end
  })

  if (lastIndex < text.length) {
    result.push(<span key="text-last">{text.slice(lastIndex)}</span>)
  }

  return result
}

/**
 * Fallback highlighting when explicit spans are not available.
 * Uses both static control-ID regex and glossary terms from /create-evidence-case.
 */
export function inlineHighlight(text: string, glossary: GlossaryEntryLike[] = []) {
  if (!text) return null

  const lookup = buildGlossaryLookup(glossary)
  const glossaryRegex = buildGlossaryRegex(glossary)
  const source = glossaryRegex ? `${glossaryRegex.source}|${ENTITY_RE.source}` : ENTITY_RE.source
  const combined = new RegExp(source, 'gi')

  const out: React.ReactNode[] = []
  let cursor = 0
  let idx = 0
  let match: RegExpExecArray | null

  while ((match = combined.exec(text)) !== null) {
    const token = match[0]
    const start = match.index
    const end = start + token.length

    if (start > cursor) out.push(text.slice(cursor, start))

    const glossaryEntry = lookup.get(norm(token))
    const type = typeFromGlossary(glossaryEntry, token)
    const { color, bg } = CHIP_COLORS[type] ?? CHIP_COLORS.framework

    const syntheticSpan: Span = {
      text: token,
      kind: type === 'control' ? 'control_id' : 'phrase',
      span: [start, end],
      framework: glossaryEntry?.framework,
      name: glossaryEntry?.name,
      source: glossaryEntry?.source,
      entity: glossaryEntry?.id,
      control_id: glossaryEntry?.id,
      match_type: glossaryEntry ? 'glossary_exact' : 'regex_match',
    }

    const tooltip = buildSpanTooltipData(syntheticSpan, token, glossaryEntry)
    out.push(renderToken(`tok-${idx}`, token, color, bg, tooltip))

    cursor = end
    idx += 1
    if (combined.lastIndex === match.index) combined.lastIndex += 1
  }

  if (cursor < text.length) out.push(text.slice(cursor))
  if (out.length === 0) return text
  return out
}
