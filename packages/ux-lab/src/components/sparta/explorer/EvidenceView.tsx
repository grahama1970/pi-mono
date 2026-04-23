import { useEffect, useState } from 'react'
import { EMBRY } from '../common/EmbryStyle'
import { inlineHighlight, spanHighlight } from './explorerUtils'
import type { HighlightEmphasis } from './explorerUtils'
import type { EvidenceCase, CrosswalkChain, EvidenceSpan } from '../../../hooks/useSpartaCollections'
import { EvidenceCaseTrace } from '../shared'

// Framework colors per NVIS standard
const FW_COLORS: Record<string, string> = {
  SPARTA: '#3B82F6',
  CWE: '#F97316',
  NIST: '#22C55E',
  CAPEC: '#EF4444',
  'ATT&CK': '#A855F7',
  D3FEND: '#00ff88',
}

const EXTRACT_API = 'http://localhost:3001/api/extract-entities'
const CONTROL_ID_FALLBACK_RE = /\b(?:[A-Z]{1,8}-\d{1,4}(?:\([0-9A-Za-z]+\))?(?:\.\d+)?|(?:[A-Z]{2,8}-)?T\d{4}(?:\.\d{3})?|CWE-\d+|CAPEC-\d+|D3F:[A-Za-z0-9_.:-]+)\b/g

function extractControlIdsFromText(text: string): string[] {
  const hits = text.match(CONTROL_ID_FALLBACK_RE) ?? []
  const unique = new Set<string>()
  for (const raw of hits) {
    const v = raw.trim().replace(/[),.;:!?]+$/g, '')
    if (!v || v.startsWith('/')) continue
    unique.add(v)
  }
  return Array.from(unique)
}

interface LiveEvidenceCase {
  question: string
  markdown_report?: string
  gates: Array<{ gate: string; passed: boolean; score?: number; detail: string }>
  confidence: number
  entities: string[]
  total_time_ms: number
  verdict?: string | { state?: string; grade?: string }
  verdict_state?: string
  answer?: string
  response_action?: string
}

interface EvidenceViewProps {
  question: string
  qraKey?: string
  reasoning?: string
  answer?: string
  groundingScore?: number
  storedEvidenceCase?: EvidenceCase | null
  minHighlightEmphasis?: HighlightEmphasis
  onClose?: () => void
}

export function EvidenceView({ question, reasoning, answer, groundingScore, storedEvidenceCase, minHighlightEmphasis = 'medium' }: EvidenceViewProps) {
  const [liveData, setLiveData] = useState<LiveEvidenceCase | null>(null)
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extractedGlossary, setExtractedGlossary] = useState<Array<{ id: string; name: string; framework: string; type?: string; description?: string; source?: string }>>([])

  const navigateToControl = (controlId: string) => {
    window.dispatchEvent(new CustomEvent('sparta:navigate-control', { detail: { controlId } }))
    const base = window.location.hash.split('/')[0] || '#sparta-explorer'
    window.location.hash = `${base}/controls`
  }

  const runValidation = async () => {
    setValidating(true)
    setError(null)
    try {
      const res = await fetch('http://localhost:3001/api/evidence/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      if (!res.ok) throw new Error(`Pipeline failed: ${res.status}`)
      setLiveData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setValidating(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const hasStoredGlossary = (storedEvidenceCase?.glossary?.length ?? 0) > 0
    if (!question?.trim()) {
      setExtractedGlossary([])
      return () => { cancelled = true }
    }

    if (hasStoredGlossary) {
      setExtractedGlossary([])
      return () => { cancelled = true }
    }

    const storedSpans = Array.isArray((storedEvidenceCase as any)?.spans)
      ? ((storedEvidenceCase as any).spans as Array<any>)
      : []
    const storedResolvedEntities = Array.isArray((storedEvidenceCase as any)?.resolved_entities)
      ? ((storedEvidenceCase as any).resolved_entities as Array<any>)
      : []

    if (storedSpans.length > 0 || storedResolvedEntities.length > 0) {
      const seeded = new Map<string, { id: string; name: string; framework: string; type?: string; description?: string; source?: string }>()

      storedResolvedEntities.forEach((entity: any) => {
        const id = typeof entity?.id === 'string' ? entity.id.trim() : ''
        const name = typeof entity?.name === 'string' ? entity.name.trim() : ''
        if (!id) return
        const key = id.toLowerCase()
        if (seeded.has(key)) return
        seeded.set(key, {
          id,
          name: name || id,
          framework: typeof entity?.framework === 'string' && entity.framework.trim() ? entity.framework : 'SPARTA',
          type: 'phrase',
          source: '/create-evidence-case resolved_entities',
        })
      })

      storedSpans.forEach((span: any) => {
        const spanText = typeof span?.text === 'string' ? span.text.trim() : ''
        if (!spanText) return
        const key = spanText.toLowerCase()
        const existing = seeded.get(key)
        if (existing) return
        seeded.set(key, {
          id: spanText,
          name: spanText,
          framework: typeof span?.framework === 'string' && span.framework.trim() ? span.framework : 'SPARTA',
          type: span?.kind === 'control_id' ? 'control' : 'phrase',
          source: '/create-evidence-case spans',
        })
      })

      if (seeded.size > 0) {
        setExtractedGlossary(Array.from(seeded.values()).slice(0, 30))
      }
    }

    const extractionText = [question, answer, reasoning]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .join('\n\n')

    if (!extractionText) {
      setExtractedGlossary([])
      return () => { cancelled = true }
    }

    fetch(EXTRACT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: extractionText, collection: 'sparta_controls' }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(async (data) => {
        if (cancelled) return

        const ids = Array.isArray(data?.control_ids) ? data.control_ids : []
        const metadata = Array.isArray(data?.control_metadata) ? data.control_metadata : []
        const entities = Array.isArray(data?.entities) ? data.entities : []

        const map = new Map<string, { id: string; name: string; framework: string; type?: string; description?: string; source?: string }>()

        ids.forEach((cid: string, idx: number) => {
          const meta = metadata[idx] ?? {}
          if (!cid) return
          map.set(cid, {
            id: cid,
            name: meta.name || cid,
            framework: meta.framework || 'SPARTA',
            type: 'control',
            source: '/extract-entities',
          })
        })

        entities.forEach((e: any) => {
          const cid = typeof e?.id === 'string' ? e.id : ''
          if (!cid || map.has(cid)) return
          map.set(cid, {
            id: cid,
            name: typeof e?.name === 'string' && e.name.trim() ? e.name : cid,
            framework: typeof e?.framework === 'string' && e.framework.trim() ? e.framework : 'SPARTA',
            type: 'control',
            source: '/extract-entities',
          })
        })

        if (map.size > 0) {
          setExtractedGlossary(Array.from(map.values()).slice(0, 20))
          return
        }

        // Fallback: if flashtext extraction returns no IDs, parse explicit control IDs from text
        // and re-query /extract-entities in delimiter mode for authoritative metadata.
        const parsedIds = extractControlIdsFromText(extractionText)
        if (parsedIds.length === 0) {
          setExtractedGlossary([])
          return
        }

        const delimited = await fetch(EXTRACT_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: parsedIds.join(', '),
            collection: 'sparta_controls',
            delimiter: 'auto',
          }),
        })
        if (!delimited.ok) {
          if (!cancelled) setExtractedGlossary([])
          return
        }
        const delimiterData = await delimited.json()
        if (cancelled) return

        const delimEntities = Array.isArray(delimiterData?.entities) ? delimiterData.entities : []
        const fallbackMap = new Map<string, { id: string; name: string; framework: string; type?: string; description?: string; source?: string }>()
        delimEntities.forEach((e: any) => {
          const cid = typeof e?.id === 'string' ? e.id : ''
          if (!cid) return
          fallbackMap.set(cid, {
            id: cid,
            name: typeof e?.name === 'string' && e.name.trim() ? e.name : cid,
            framework: typeof e?.framework === 'string' && e.framework.trim() ? e.framework : 'SPARTA',
            type: 'control',
            source: '/extract-entities delimiter',
          })
        })
        setExtractedGlossary(Array.from(fallbackMap.values()).slice(0, 20))
      })
      .catch(() => {
        if (!cancelled) setExtractedGlossary([])
      })

    return () => { cancelled = true }
  }, [question, answer, reasoning, storedEvidenceCase?.glossary?.length])

  const ec = storedEvidenceCase
  const chains = ec?.crosswalk_chains || ec?.chains || []
  const glossary = ec?.glossary || []
  const effectiveGlossary = glossary.length > 0 ? glossary : extractedGlossary
  const glossaryLabel = glossary.length > 0 ? 'Symbol Definitions' : 'Symbol Definitions (Extracted)'
  const controlIds = ec?.control_ids || []
  const effectiveControlIds = controlIds.length > 0 ? controlIds : extractedGlossary.map((g) => g.id)
  const methods = ec?.methods || []
  const reviewStatus = ec?.review_status || 'pending'
  const confidence = ec?.confidence !== undefined
    ? Math.round(ec.confidence * 100)
    : (groundingScore ? Math.round(groundingScore * 100) : null)
  const formalProof = ec?.formal_proof
  const liveVerdict = typeof liveData?.verdict === 'string'
    ? liveData.verdict
    : (liveData?.verdict?.state || liveData?.verdict_state)
  const normalizedSpans: EvidenceSpan[] = Array.isArray(ec?.spans)
    ? (ec!.spans as any[])
      .map((span) => {
        if (Array.isArray(span?.span) && span.span.length === 2) return span
        if (typeof span?.start === 'number' && typeof span?.end === 'number') {
          return { ...span, span: [span.start, span.end] }
        }
        return null
      })
      .filter((span): span is EvidenceSpan => Boolean(span))
    : []

  const spanNode = normalizedSpans.length > 0
    ? spanHighlight(question, normalizedSpans, effectiveGlossary, { minEmphasis: minHighlightEmphasis })
    : null

  const questionNode = (spanNode && spanNode !== question)
    ? spanNode
    : inlineHighlight(question, effectiveGlossary, { minEmphasis: minHighlightEmphasis })

  return (
    <EvidenceCaseTrace
      questionNode={questionNode}
      reviewStatus={reviewStatus}
      confidence={confidence}
      formalProofSuccess={formalProof?.success}
      hasFormalProof={Boolean(formalProof)}
      methods={methods}
      chains={chains}
      controlIds={effectiveControlIds}
      glossary={effectiveGlossary.map((entry) => ({
        id: entry.id,
        name: entry.name,
        framework: entry.framework,
        description: entry.description,
      }))}
      glossaryLabel={glossaryLabel}
      reasoning={reasoning}
      agentResponse={ec?.answer || liveData?.answer || answer}
      responseAction={ec?.response_action || liveData?.response_action || (answer ? 'answer' : undefined)}
      evidenceVerdict={ec?.verdict || liveVerdict}
      evidenceGrade={ec?.grade || (typeof liveData?.verdict === 'object' ? liveData.verdict?.grade : undefined)}
      gatesPassed={ec?.gates_passed}
      gatesTotal={ec?.gates_total}
      liveGates={liveData?.gates ?? []}
      error={error}
      onNavigateToControl={navigateToControl}
      onRunValidation={runValidation}
      validating={validating}
    />
  )
}
