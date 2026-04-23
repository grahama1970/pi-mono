import React from 'react'
import { createPortal } from 'react-dom'

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
  controlId?: string
}

export type HighlightEmphasis = 'high' | 'medium' | 'low'

export interface HighlightRenderOptions {
  minEmphasis?: HighlightEmphasis
}

interface HighlightCandidate {
  start: number
  end: number
  token: string
  color: string
  bg: string
  tooltip: TooltipData
  emphasis: HighlightEmphasis
  priority: number
}

const HIGHLIGHT_EMPHASIS_RANK: Record<HighlightEmphasis, number> = {
  low: 1,
  medium: 2,
  high: 3,
}

export const ENTITY_RE = /(\bSPARTA\b|\b[A-Z]{2}-\d+(?:\.\d+)?\b|\bCWE-\d+\b|\b[TS]A?\d{4}(?:\.\d{3})?\b|\bCM-\d{4}\b|\bST-\d{4}\b|\/[a-z][\w-]*)/g
const NAV_CONTROL_EVENT = 'sparta:navigate-control'

const CHIP_COLORS: Record<string, { color: string; bg: string }> = {
  control:   { color: '#00ff88', bg: 'rgba(0,255,136,0.10)' },
  cwe:       { color: '#ff6b6b', bg: 'rgba(255,107,107,0.10)' },
  attack:    { color: '#ffaa00', bg: 'rgba(255,170,0,0.10)' },
  sparta:    { color: '#22d3ee', bg: 'rgba(34,211,238,0.10)' },
  skill:     { color: '#4a9eff', bg: 'rgba(74,158,255,0.10)' },
  framework: { color: '#c084fc', bg: 'rgba(192,132,252,0.10)' },
}

const UI_HIGHLIGHT_DENYLIST = new Set([
  'answer',
  'compliance',
  'compliant',
  'domain',
  'domains',
  'ensure',
  'ensures',
  'question',
  'regarding',
  'related',
])

const LOW_SIGNAL_SUFFIX_RE = /\b(control|controls|domain|domains|framework|frameworks|requirement|requirements|service|services|system|systems)\b$/i

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

function normalizeHighlightText(value: string): string {
  return norm(value.replace(/^[\s,.;:!?()[\]{}"'`]+|[\s,.;:!?()[\]{}"'`]+$/g, ''))
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
  if (t.toUpperCase() === 'SPARTA') return 'sparta'
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

function hasStructuredGlossaryMetadata(g?: GlossaryEntryLike): boolean {
  return Boolean(g?.id || g?.description || g?.framework || g?.type)
}

function shouldSuppressHighlight(spanText: string, span: Span, glossary?: GlossaryEntryLike): boolean {
  const normalized = normalizeHighlightText(spanText)
  if (!normalized) return true
  if (span.kind === 'control_id') return false
  if (toControlNavigationId(glossary?.id) || toControlNavigationId(span.control_id) || toControlNavigationId(span.entity) || toControlNavigationId(spanText)) {
    return false
  }
  if (UI_HIGHLIGHT_DENYLIST.has(normalized)) return true

  const wordCount = normalized.split(/\s+/).filter(Boolean).length
  const hasMetadata = hasStructuredGlossaryMetadata(glossary)

  if (!hasMetadata && span.kind === 'phrase' && wordCount <= 1) return true
  if (!hasMetadata && span.kind === 'aerospace_term' && wordCount <= 1 && normalized.length <= 5) return true

  return false
}

function highlightEmphasis(
  spanText: string,
  span: Span,
  glossary: GlossaryEntryLike | undefined,
  type: keyof typeof CHIP_COLORS,
): HighlightEmphasis {
  const normalized = normalizeHighlightText(spanText)
  const wordCount = normalized.split(/\s+/).filter(Boolean).length
  const hasMetadata = hasStructuredGlossaryMetadata(glossary)
  const hasNamedPhraseSignal =
    /\b[A-Z]{2,}\b/.test(spanText) ||
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/.test(spanText)
  if (span.kind === 'control_id') return 'high'
  if (toControlNavigationId(glossary?.id) || toControlNavigationId(span.control_id) || toControlNavigationId(span.entity)) return 'high'
  if (normalized === 'sparta') return 'medium'
  if (type === 'control' || type === 'sparta' || type === 'attack' || type === 'cwe' || type === 'skill') return 'high'
  if (hasMetadata && wordCount > 1) return 'medium'
  if (span.kind === 'phrase' && wordCount > 1 && hasNamedPhraseSignal) return 'medium'
  if (LOW_SIGNAL_SUFFIX_RE.test(normalized) || span.kind === 'phrase') return 'low'
  if (span.kind === 'aerospace_term' || hasMetadata) return 'medium'
  return 'low'
}

function highlightPriority(emphasis: HighlightEmphasis, start: number, end: number): number {
  const weight = emphasis === 'high' ? 3000 : emphasis === 'medium' ? 2000 : 1000
  return weight + (end - start)
}

function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end
}

function selectHighlightCandidates(candidates: HighlightCandidate[]): HighlightCandidate[] {
  const accepted: HighlightCandidate[] = []
  const ordered = [...candidates].sort((a, b) =>
    b.priority - a.priority || (b.end - b.start) - (a.end - a.start) || a.start - b.start,
  )

  for (const candidate of ordered) {
    if (accepted.some((current) => rangesOverlap(current, candidate))) continue
    accepted.push(candidate)
  }

  return accepted.sort((a, b) => a.start - b.start || a.end - b.end)
}

function meetsMinEmphasis(emphasis: HighlightEmphasis, options?: HighlightRenderOptions): boolean {
  const min = options?.minEmphasis ?? 'low'
  return HIGHLIGHT_EMPHASIS_RANK[emphasis] >= HIGHLIGHT_EMPHASIS_RANK[min]
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

function toControlNavigationId(value?: string): string | undefined {
  const token = (value ?? '').trim()
  if (!token || token.startsWith('/')) return undefined
  const tokenUpper = token.toUpperCase()
  const kind = classifyToken(tokenUpper)
  return kind === 'control' || kind === 'cwe' || kind === 'attack' || kind === 'sparta'
    ? tokenUpper
    : undefined
}

function buildSpanTooltipData(span: Span, spanText: string, glossary?: GlossaryEntryLike): TooltipData {
  const title = glossary?.name || span.name || spanText
  const framework = glossary?.framework || span.framework
  const id = glossary?.id || span.control_id || span.entity
  const controlId = toControlNavigationId(id) || toControlNavigationId(spanText)
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
    controlId,
  }
}

function navigateToControl(controlId?: string) {
  const base = window.location.hash.split('/')[0] || '#sparta-explorer'
  window.dispatchEvent(new CustomEvent(NAV_CONTROL_EVENT, { detail: { controlId } }))
  window.location.hash = `${base}/controls`
}

function tooltipPositionForTarget(target: HTMLElement, width: number) {
  const rect = target.getBoundingClientRect()
  const center = rect.left + rect.width / 2
  const halfWidth = width / 2
  const margin = 12
  const minLeft = margin + halfWidth
  const maxLeft = window.innerWidth - margin - halfWidth
  const left = Math.min(Math.max(center, minLeft), Math.max(minLeft, maxLeft))
  const topPlacement = rect.top > 180
  const top = topPlacement ? rect.top - 10 : rect.bottom + 10
  const arrowOffset = Math.min(Math.max(center - left, -halfWidth + 16), halfWidth - 16)
  return { left, top, placement: topPlacement ? 'top' as const : 'bottom' as const, arrowOffset }
}

function EntityToken({
  token,
  color,
  bg,
  tooltip,
  emphasis,
}: {
  token: string
  color: string
  bg: string
  tooltip: TooltipData
  emphasis: HighlightEmphasis
}) {
  const [open, setOpen] = React.useState(false)
  const [coords, setCoords] = React.useState<{ left: number; top: number; placement: 'top' | 'bottom'; arrowOffset: number } | null>(null)
  const clickable = Boolean(tooltip.controlId)
  const tooltipWidth = 320

  const updateCoords = React.useCallback((target: HTMLElement) => {
    setCoords(tooltipPositionForTarget(target, tooltipWidth))
  }, [])

  const handleEnter = React.useCallback((target: HTMLElement) => {
    updateCoords(target)
    setOpen(true)
  }, [updateCoords])

  const handleLeave = React.useCallback(() => {
    setOpen(false)
  }, [])

  const handleClick = React.useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    if (!clickable) return
    e.preventDefault()
    e.stopPropagation()
    navigateToControl(tooltip.controlId)
  }, [clickable, tooltip.controlId])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (!clickable) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      navigateToControl(tooltip.controlId)
    }
  }, [clickable, tooltip.controlId])

  const tokenStyle: React.CSSProperties = React.useMemo(() => {
    if (emphasis === 'high') {
      return {
        color,
        fontWeight: 700,
        backgroundColor: bg,
        borderBottom: `1.5px solid ${color}44`,
        textUnderlineOffset: '2px',
        textDecoration: clickable ? 'underline' : 'none',
        textDecorationColor: `${color}99`,
        padding: '0 1px',
        display: 'inline',
      }
    }

    if (emphasis === 'medium') {
      return {
        color,
        fontWeight: 650,
        backgroundColor: 'transparent',
        boxShadow: `inset 0 -0.32em 0 ${bg}`,
        borderBottom: `1px solid ${color}33`,
        textUnderlineOffset: '2px',
        textDecoration: clickable ? 'underline' : 'none',
        textDecorationColor: `${color}66`,
        padding: 0,
        display: 'inline',
      }
    }

    return {
      color: `${color}cc`,
      fontWeight: 600,
      backgroundColor: 'transparent',
      borderBottom: `1px dotted ${color}55`,
      textUnderlineOffset: '2px',
      textDecoration: clickable ? 'underline' : 'none',
      textDecorationColor: `${color}55`,
      padding: 0,
      display: 'inline',
    }
  }, [bg, clickable, color, emphasis])

  return (
    <span
      style={{ position: 'relative', display: 'inline-block', cursor: clickable ? 'pointer' : 'help' }}
      role={clickable ? 'link' : undefined}
      tabIndex={clickable ? 0 : -1}
      onMouseEnter={(e) => handleEnter(e.currentTarget)}
      onMouseMove={(e) => updateCoords(e.currentTarget)}
      onMouseLeave={handleLeave}
      onFocus={(e) => handleEnter(e.currentTarget)}
      onBlur={handleLeave}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      data-qid={clickable && tooltip.controlId ? `entity:nav:${tooltip.controlId}` : undefined}
      data-qs-action={clickable ? 'NAVIGATE_TO_CONTROL' : undefined}
      data-qs-params={clickable && tooltip.controlId ? JSON.stringify({ controlId: tooltip.controlId }) : undefined}
    >
      <span
        style={tokenStyle}
      >
        {token}
      </span>

      {open && coords && typeof document !== 'undefined' && createPortal(
        <span
          data-role="entity-tooltip"
          style={{
            position: 'fixed',
            left: coords.left,
            top: coords.top,
            transform: coords.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            transition: 'opacity 120ms ease, transform 120ms ease',
            pointerEvents: 'none',
            zIndex: 2147483647,
            width: tooltipWidth,
            maxWidth: 'min(78vw, 360px)',
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
              <div key={`tip-${idx}`} style={{ color: '#d1d5db', fontSize: 10, lineHeight: 1.3 }}>
                {line}
              </div>
            ))}
          </div>
          <span
            style={{
              position: 'absolute',
              left: `calc(50% + ${coords.arrowOffset}px)`,
              top: coords.placement === 'top' ? '100%' : -5,
              width: 10,
              height: 10,
              backgroundColor: '#0f1115',
              borderRight: `1px solid ${color}66`,
              borderBottom: `1px solid ${color}66`,
              transform: coords.placement === 'top' ? 'translateX(-50%) rotate(45deg)' : 'translateX(-50%) rotate(225deg)',
            }}
          />
        </span>,
        document.body,
      )}
    </span>
  )
}

function renderToken(
  key: string,
  token: string,
  color: string,
  bg: string,
  tooltip: TooltipData,
  emphasis: HighlightEmphasis,
): React.ReactNode {
  return <EntityToken key={key} token={token} color={color} bg={bg} tooltip={tooltip} emphasis={emphasis} />
}

/**
 * Precise highlighting using ground-truth character spans from Evidence Case.
 * Use this whenever spans are available.
 */
export function spanHighlight(text: string, spans: Span[], glossary: GlossaryEntryLike[] = [], options: HighlightRenderOptions = {}) {
  if (!text || !spans || spans.length === 0) return text

  const lookup = buildGlossaryLookup(glossary)
  const candidates: HighlightCandidate[] = []

  spans.forEach((s) => {
    const [start, end] = s.span
    if (start < 0 || end > text.length || start >= end) return

    const spanText = text.slice(start, end)
    const glossaryEntry = findGlossaryEntry(spanText, s, lookup)
    if (shouldSuppressHighlight(spanText, s, glossaryEntry)) return

    const type = s.kind === 'control_id' ? 'control' : s.framework ? 'framework' : typeFromGlossary(glossaryEntry, spanText)
    const emphasis = highlightEmphasis(spanText, s, glossaryEntry, type)
    if (!meetsMinEmphasis(emphasis, options)) return
    const { color, bg } = CHIP_COLORS[type] ?? CHIP_COLORS.framework
    const tooltip = buildSpanTooltipData(s, spanText, glossaryEntry)

    candidates.push({
      start,
      end,
      token: spanText,
      color,
      bg,
      tooltip,
      emphasis,
      priority: highlightPriority(emphasis, start, end),
    })
  })

  const sorted = selectHighlightCandidates(candidates)
  if (sorted.length === 0) return text

  const result: React.ReactNode[] = []
  let lastIndex = 0

  sorted.forEach((candidate, i) => {
    const { start, end } = candidate
    if (start > lastIndex) {
      result.push(<span key={`text-${i}`}>{text.slice(lastIndex, start)}</span>)
    }

    result.push(renderToken(`span-${i}`, candidate.token, candidate.color, candidate.bg, candidate.tooltip, candidate.emphasis))
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
export function inlineHighlight(text: string, glossary: GlossaryEntryLike[] = [], options: HighlightRenderOptions = {}) {
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

    if (shouldSuppressHighlight(token, syntheticSpan, glossaryEntry)) {
      out.push(token)
      cursor = end
      idx += 1
      if (combined.lastIndex === match.index) combined.lastIndex += 1
      continue
    }

    const emphasis = highlightEmphasis(token, syntheticSpan, glossaryEntry, type)
    if (!meetsMinEmphasis(emphasis, options)) {
      out.push(token)
      cursor = end
      idx += 1
      if (combined.lastIndex === match.index) combined.lastIndex += 1
      continue
    }
    const { color, bg } = CHIP_COLORS[type] ?? CHIP_COLORS.framework
    const tooltip = buildSpanTooltipData(syntheticSpan, token, glossaryEntry)
    out.push(renderToken(`tok-${idx}`, token, color, bg, tooltip, emphasis))

    cursor = end
    idx += 1
    if (combined.lastIndex === match.index) combined.lastIndex += 1
  }

  if (cursor < text.length) out.push(text.slice(cursor))
  if (out.length === 0) return text
  return out
}
