import { useEffect, useMemo, useState } from 'react'
import { inlineHighlight, spanHighlight } from './explorerUtils'
import type { HighlightEmphasis } from './explorerUtils'
import type { EvidenceCase, EvidenceSpan } from '../../../hooks/useSpartaCollections'
import { EvidenceCaseTrace } from '../shared/EvidenceCaseTrace'
import { apiUrl } from '../../../lib/apiBase'

const EXTRACT_API = apiUrl('/extract-entities')
const CONTROL_ID_FALLBACK_RE = /\b(?:[A-Z]{1,8}-\d{1,4}(?:\([0-9A-Za-z]+\))?(?:\.\d+)?|(?:[A-Z]{2,8}-)?T\d{4}(?:\.\d{3})?|CWE-\d+|CAPEC-\d+|D3F:[A-Za-z0-9_.:-]+)\b/g

function extractControlIdsFromText(text: string): string[] {
  const hits = text.match(CONTROL_ID_FALLBACK_RE) ?? []
  const unique = new Set<string>()
  for (const raw of hits) {
    const v = raw.trim().replace(/[),.;:!?]+$/g, '')
    if (!v || v.startsWith('/')) continue
    unique.add(v.toUpperCase())
  }
  return Array.from(unique)
}

type EntityGlossaryEntry = {
  id: string
  name: string
  framework: string
  type?: string
  description?: string
  source?: string
}

type RawEntityRecord = {
  id?: unknown
  name?: unknown
  framework?: unknown
  description?: unknown
}

type RawSpanRecord = RawEntityRecord & {
  text?: unknown
  kind?: unknown
  span?: unknown
  start?: unknown
  end?: unknown
}

function normalizeSeededGlossary(storedEvidenceCase?: EvidenceCase | null): EntityGlossaryEntry[] {
  const storedSpans = Array.isArray(storedEvidenceCase?.spans)
    ? storedEvidenceCase.spans as RawSpanRecord[]
    : []
  const storedResolvedEntities = Array.isArray(storedEvidenceCase?.resolved_entities)
    ? storedEvidenceCase.resolved_entities as RawEntityRecord[]
    : []

  const seeded = new Map<string, EntityGlossaryEntry>()

  storedResolvedEntities.forEach((entity) => {
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
      description: typeof entity?.description === 'string' ? entity.description : undefined,
      source: '/create-evidence-case resolved_entities',
    })
  })

  storedSpans.forEach((span) => {
    const spanText = typeof span?.text === 'string' ? span.text.trim() : ''
    if (!spanText) return
    const key = spanText.toLowerCase()
    if (seeded.has(key)) return
    seeded.set(key, {
      id: spanText,
      name: spanText,
      framework: typeof span?.framework === 'string' && span.framework.trim() ? span.framework : 'SPARTA',
      type: span?.kind === 'control_id' ? 'control' : 'phrase',
      description: typeof span?.description === 'string' ? span.description : undefined,
      source: '/create-evidence-case spans',
    })
  })

  return Array.from(seeded.values()).slice(0, 30)
}

async function extractGlossaryEntries(text: string): Promise<EntityGlossaryEntry[]> {
  const trimmed = text.trim()
  if (!trimmed) return []

  const res = await fetch(EXTRACT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: trimmed, collection: 'sparta_controls' }),
  })
  if (!res.ok) throw new Error(String(res.status))
  const data = await res.json()

  const ids = Array.isArray(data?.control_ids) ? data.control_ids : []
  const metadata = Array.isArray(data?.control_metadata) ? data.control_metadata : []
  const entities = Array.isArray(data?.entities) ? data.entities : []

  const map = new Map<string, EntityGlossaryEntry>()

  ids.forEach((cid: string, idx: number) => {
    const meta = metadata[idx] ?? {}
    if (!cid) return
    map.set(cid.toUpperCase(), {
      id: cid.toUpperCase(),
      name: meta.name || cid,
      framework: meta.framework || 'SPARTA',
      type: 'control',
      description: meta.description,
      source: '/extract-entities',
    })
  })

  entities.forEach((entity: RawEntityRecord) => {
    const cid = typeof entity?.id === 'string' ? entity.id.trim() : ''
    if (!cid) return
    const key = cid.toUpperCase()
    if (map.has(key)) return
    map.set(key, {
      id: key,
      name: typeof entity?.name === 'string' && entity.name.trim() ? entity.name : cid,
      framework: typeof entity?.framework === 'string' && entity.framework.trim() ? entity.framework : 'SPARTA',
      type: 'control',
      description: typeof entity?.description === 'string' ? entity.description : undefined,
      source: '/extract-entities',
    })
  })

  if (map.size > 0) return Array.from(map.values()).slice(0, 20)

  const parsedIds = extractControlIdsFromText(trimmed)
  if (parsedIds.length === 0) return []

  const delimited = await fetch(EXTRACT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: parsedIds.join(', '),
      collection: 'sparta_controls',
      delimiter: 'auto',
    }),
  })
  if (!delimited.ok) return []

  const delimiterData = await delimited.json()
  const delimEntities = Array.isArray(delimiterData?.entities) ? delimiterData.entities : []
  const fallbackMap = new Map<string, EntityGlossaryEntry>()
  delimEntities.forEach((entity: RawEntityRecord) => {
    const cid = typeof entity?.id === 'string' ? entity.id.trim() : ''
    if (!cid) return
    fallbackMap.set(cid.toUpperCase(), {
      id: cid.toUpperCase(),
      name: typeof entity?.name === 'string' && entity.name.trim() ? entity.name : cid,
      framework: typeof entity?.framework === 'string' && entity.framework.trim() ? entity.framework : 'SPARTA',
      type: 'control',
      description: typeof entity?.description === 'string' ? entity.description : undefined,
      source: '/extract-entities delimiter',
    })
  })
  return Array.from(fallbackMap.values()).slice(0, 20)
}

function renderAnswerWithUnsupported(
  text: string,
  unsupportedIds: string[],
  glossary: EntityGlossaryEntry[],
  minHighlightEmphasis: HighlightEmphasis,
): React.ReactNode {
  if (!text) return null
  if (unsupportedIds.length === 0) {
    return inlineHighlight(text, glossary, { minEmphasis: minHighlightEmphasis })
  }

  const escaped = unsupportedIds
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  const out: React.ReactNode[] = []
  let cursor = 0
  let idx = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    const token = match[0]
    const start = match.index
    const end = start + token.length
    if (start > cursor) {
      out.push(
        <span key={`segment-${idx}`}>
          {inlineHighlight(text.slice(cursor, start), glossary, { minEmphasis: minHighlightEmphasis })}
        </span>,
      )
    }
    out.push(
      <span
        key={`unsupported-${idx}`}
        title={`Unsupported claim: ${token}`}
        style={{
          color: '#ef4444',
          fontWeight: 800,
          borderBottom: '1.5px solid #ef4444',
          textUnderlineOffset: '3px',
        }}
      >
        {token}
      </span>,
    )
    cursor = end
    idx += 1
  }

  if (cursor < text.length) {
    out.push(
      <span key="segment-tail">
        {inlineHighlight(text.slice(cursor), glossary, { minEmphasis: minHighlightEmphasis })}
      </span>,
    )
  }

  return out
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
  gap_review?: Record<string, unknown>
  gap_review_status?: string
  human_review_state?: string
  proposed_correction?: Record<string, unknown>
  correction_lineage?: Record<string, unknown>
  evidence_case_version?: Record<string, unknown>
}

interface QraQualityIssue {
  status?: string
  issue_code?: string
  issue_label?: string
  ambiguous_referents?: string[]
  disposition?: string
  safe_action?: string
}

interface EvidenceViewProps {
  question: string
  qraKey?: string
  reasoning?: string
  answer?: string
  groundingScore?: number
  storedEvidenceCase?: EvidenceCase | null
  qraFormalProof?: EvidenceCase['formal_proof']
  qraSacmRef?: EvidenceCase['sacm_ref']
  qraQuality?: QraQualityIssue
  minHighlightEmphasis?: HighlightEmphasis
  onClose?: () => void
  reviewActions?: React.ReactNode
  upstreamQRAKeys?: string[]
  priorQRAEvidence?: NonNullable<EvidenceCase['prior_qra_evidence']>
  relatedQRAs?: Array<{
    key: string
    qraId: string
    controlId: string
    source: string
    question: string
    verdict: 'grounded' | 'review' | 'passed' | 'adversarial' | 'missing' | 'failed'
  }>
  onSelectRelatedQRA?: (qraKey: string) => void
}

export function EvidenceView({
  question,
  reasoning,
  answer,
  groundingScore,
  storedEvidenceCase,
  qraFormalProof,
  qraSacmRef,
  qraQuality,
  minHighlightEmphasis = 'medium',
  reviewActions,
  upstreamQRAKeys = [],
  priorQRAEvidence = [],
  relatedQRAs = [],
  onSelectRelatedQRA,
}: EvidenceViewProps) {
  const [liveData, setLiveData] = useState<LiveEvidenceCase | null>(null)
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [questionGlossary, setQuestionGlossary] = useState<EntityGlossaryEntry[]>([])
  const [answerGlossary, setAnswerGlossary] = useState<EntityGlossaryEntry[]>([])
  const initialAnswer = (storedEvidenceCase?.answer || answer || '').trim()
  const [committedAnswer, setCommittedAnswer] = useState(initialAnswer)
  const [draftAnswer, setDraftAnswer] = useState(initialAnswer)
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    const nextAnswer = (storedEvidenceCase?.answer || liveData?.answer || answer || '').trim()
    if (!isEditing) {
      setCommittedAnswer(nextAnswer)
      setDraftAnswer(nextAnswer)
      return
    }
    if (!committedAnswer && nextAnswer) {
      setCommittedAnswer(nextAnswer)
      setDraftAnswer((current) => current || nextAnswer)
    }
  }, [storedEvidenceCase?.answer, liveData?.answer, answer, isEditing, committedAnswer])

  const navigateToControl = (controlId: string) => {
    window.dispatchEvent(new CustomEvent('sparta:navigate-control', { detail: { controlId } }))
    const base = window.location.hash.split('/')[0] || '#sparta-explorer'
    window.location.hash = `${base}/controls`
  }

  const navigateToLean4 = () => {
    window.location.hash = '#lean4-lemma'
  }

  const runValidation = async () => {
    setValidating(true)
    setError(null)
    try {
      const res = await fetch(apiUrl('/evidence/generate'), {
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

  const handleStartEdit = () => {
    setDraftAnswer(committedAnswer)
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setDraftAnswer(committedAnswer)
    setIsEditing(false)
  }

  const handleSaveAndRerun = async () => {
    setCommittedAnswer(draftAnswer.trim())
    setIsEditing(true)
    await runValidation()
  }

  useEffect(() => {
    let cancelled = false
    const seededQuestionGlossary = normalizeSeededGlossary(storedEvidenceCase)
    const hasStoredGlossary = (storedEvidenceCase?.glossary?.length ?? 0) > 0

    if (hasStoredGlossary) {
      setQuestionGlossary([])
      setAnswerGlossary([])
      return () => { cancelled = true }
    }

    if (seededQuestionGlossary.length > 0) setQuestionGlossary(seededQuestionGlossary)

    ;(async () => {
      try {
        const [nextQuestionGlossary, nextAnswerGlossary] = await Promise.all([
          question?.trim() ? extractGlossaryEntries(question) : Promise.resolve([]),
          committedAnswer?.trim() ? extractGlossaryEntries(committedAnswer) : Promise.resolve([]),
        ])
        if (cancelled) return
        setQuestionGlossary((seededQuestionGlossary.length > 0 ? seededQuestionGlossary : nextQuestionGlossary).slice(0, 30))
        setAnswerGlossary(nextAnswerGlossary.slice(0, 30))
      } catch {
        if (cancelled) return
        setQuestionGlossary(seededQuestionGlossary)
        setAnswerGlossary([])
      }
    })()

    return () => { cancelled = true }
  }, [question, committedAnswer, storedEvidenceCase])

  const ec = storedEvidenceCase
  const chains = ec?.crosswalk_chains || ec?.chains || []
  const glossary = ec?.glossary || []
  const effectiveQuestionGlossary = glossary.length > 0 ? glossary : questionGlossary
  const effectiveAnswerGlossary = answerGlossary
  const currentAnswer = committedAnswer
  const ambiguousReferents = qraQuality?.ambiguous_referents ?? []
  const hasAmbiguousReferent = qraQuality?.issue_code === 'ambiguous_referent'
  const clarifyQuestion = hasAmbiguousReferent
    ? `What do you mean by '${ambiguousReferents[0] || 'this reference'}'?`
    : ''
  const questionEntityRefs = effectiveQuestionGlossary.slice(0, 8)
  const answerEntityRefs = effectiveAnswerGlossary.slice(0, 8)
  const glossaryHasDescriptions = effectiveQuestionGlossary.some((entry) => typeof entry.description === 'string' && entry.description.trim().length > 0)
  const glossaryLabel = glossaryHasDescriptions ? 'Entity Grounding' : 'Resolved Entities'
  const controlIds = ec?.control_ids || []
  const questionControlIds = Array.from(new Set(
    (effectiveQuestionGlossary.map((entry) => entry.id).filter(Boolean) as string[]).concat(extractControlIdsFromText(question)),
  ))
  const answerControlIds = Array.from(new Set(
    (effectiveAnswerGlossary.map((entry) => entry.id).filter(Boolean) as string[]).concat(extractControlIdsFromText(currentAnswer || '')),
  ))
  const inferredAnchorIds = controlIds.length > 0 ? Array.from(new Set(controlIds.map((id) => id.toUpperCase()))) : questionControlIds
  const authorizedEvidenceIds = new Set<string>([
    ...questionControlIds,
    ...inferredAnchorIds,
  ])
  const unsupportedAnswerIds = answerControlIds.filter((id) => !authorizedEvidenceIds.has(id))
  const supportingControlIds = inferredAnchorIds.filter((id) => questionControlIds.includes(id) || answerControlIds.includes(id))
  const displayedControlIds = supportingControlIds.length > 0 ? supportingControlIds : inferredAnchorIds.slice(0, 8)
  const groundedControls = displayedControlIds.map((id) => {
    const fromQuestion = effectiveQuestionGlossary.find((entry) => entry.id.toUpperCase() === id)
    const fromAnswer = effectiveAnswerGlossary.find((entry) => entry.id.toUpperCase() === id)
    const matched = fromQuestion || fromAnswer
    return {
      id,
      name: matched?.name || id,
      framework: matched?.framework || 'Grounded',
      description: matched?.description,
    }
  })
  const draftUnknownIds = isEditing
    ? extractControlIdsFromText(draftAnswer).filter((id) => !authorizedEvidenceIds.has(id))
    : []
  const methods = ec?.methods || []
  const reviewStatus = ec?.review_status || 'pending'
  const confidence = ec?.confidence !== undefined
    ? Math.round(ec.confidence * 100)
    : (groundingScore ? Math.round(groundingScore * 100) : null)
  const formalProof = ec?.formal_proof || qraFormalProof
  const liveVerdict = typeof liveData?.verdict === 'string'
    ? liveData.verdict
    : (liveData?.verdict?.state || liveData?.verdict_state)
  const gapReview = ec?.gap_review || liveData?.gap_review
  const proposedCorrection = ec?.proposed_correction || liveData?.proposed_correction || (gapReview?.proposed_correction as Record<string, unknown> | undefined)
  const correctionLineage = ec?.correction_lineage || liveData?.correction_lineage || (gapReview?.correction_lineage as Record<string, unknown> | undefined)
  const normalizedSpans = useMemo<EvidenceSpan[]>(() => Array.isArray(ec?.spans)
    ? (ec.spans as RawSpanRecord[])
      .map((span) => {
        if (Array.isArray(span?.span) && span.span.length === 2) return span
        if (typeof span?.start === 'number' && typeof span?.end === 'number') {
          return { ...span, span: [span.start, span.end] }
        }
        return null
      })
      .filter((span): span is EvidenceSpan => Boolean(span))
    : [], [ec?.spans])

  const questionNode = useMemo(() => {
    const spanNode = normalizedSpans.length > 0
      ? spanHighlight(question, normalizedSpans, effectiveQuestionGlossary, { minEmphasis: minHighlightEmphasis })
      : null
    return (spanNode && spanNode !== question)
      ? spanNode
      : inlineHighlight(question, effectiveQuestionGlossary, { minEmphasis: minHighlightEmphasis })
  }, [question, normalizedSpans, effectiveQuestionGlossary, minHighlightEmphasis])

  const answerNode = useMemo(() => (
    hasAmbiguousReferent
      ? <span style={{ color: '#fca5a5' }}>{clarifyQuestion}</span>
      : currentAnswer?.trim()
      ? renderAnswerWithUnsupported(
          currentAnswer,
          unsupportedAnswerIds,
          effectiveAnswerGlossary.length > 0 ? effectiveAnswerGlossary : effectiveQuestionGlossary,
          minHighlightEmphasis,
        )
      : null
  ), [hasAmbiguousReferent, clarifyQuestion, currentAnswer, unsupportedAnswerIds, effectiveAnswerGlossary, effectiveQuestionGlossary, minHighlightEmphasis])

  const questionHasGrounding = questionEntityRefs.length > 0 || questionControlIds.length > 0
  const topQuestionRefs = [...new Set([
    ...questionEntityRefs.slice(0, 2).map((entry) => entry.name || entry.id),
    ...inferredAnchorIds.slice(0, 2),
  ])]
  const questionGroundingSummary = questionHasGrounding
    ? `Grounded to: ${topQuestionRefs.join(', ')}${(questionEntityRefs.length + inferredAnchorIds.length) > topQuestionRefs.length ? '…' : ''}`
    : 'Question grounding failed; no reliable entities or anchors were resolved.'
  const answerGroundingSummary = hasAmbiguousReferent
    ? `Blocked until the ambiguous referent is clarified: ${ambiguousReferents.join(', ') || 'unknown referent'}.`
    : !questionHasGrounding
    ? 'Blocked until question grounding succeeds.'
    : unsupportedAnswerIds.length > 0
      ? `Unsupported answer claims: ${unsupportedAnswerIds.join(', ')}.`
      : answerControlIds.length > 0
        ? `Answer stayed within grounded scope across ${answerControlIds.length} referenced control claim${answerControlIds.length === 1 ? '' : 's'}.`
        : 'Answer grounding passed without additional explicit control IDs.'
  const answerHelperText = unsupportedAnswerIds.length > 0
    ? `Unsupported: ${unsupportedAnswerIds.slice(0, 2).join(', ')}${unsupportedAnswerIds.length > 2 ? ` +${unsupportedAnswerIds.length - 2} more` : ''}`
    : undefined
  const verdictWhy = hasAmbiguousReferent
    ? `FAIL — QRA question is not standalone; unresolved referent(s): ${ambiguousReferents.join(', ') || qraQuality?.issue_label || 'ambiguous referent'}.`
    : !questionHasGrounding
    ? 'FAIL — Question grounding could not anchor the claim to the current evidence set.'
    : unsupportedAnswerIds.length > 0
      ? `FAIL — Answer introduces ${unsupportedAnswerIds.join(', ')}, which is not supported by the grounded scope.`
      : !chains.length
        ? 'INCONCLUSIVE — Answer grounding passed, but no qualifying verification path was found.'
        : reviewStatus === 'auto'
          ? 'INCONCLUSIVE — Grounding is present, but the case still needs human review.'
          : 'PASS — Answer stayed within grounded scope and verification data is available.'

  return (
    <EvidenceCaseTrace
      variant="explorer"
      questionNode={questionNode}
      answerNode={answerNode}
      reviewStatus={reviewStatus}
      confidence={confidence}
      formalProofSuccess={formalProof?.success}
      hasFormalProof={Boolean(formalProof)}
      methods={methods}
      chains={chains}
      controlIds={displayedControlIds}
      glossary={effectiveQuestionGlossary.map((entry) => ({
        id: entry.id,
        name: entry.name,
        framework: entry.framework,
        description: entry.description,
      }))}
      glossaryLabel={glossaryLabel}
      reasoning={reasoning}
      agentResponse={hasAmbiguousReferent ? clarifyQuestion : ec?.answer || liveData?.answer || currentAnswer}
      responseAction={hasAmbiguousReferent ? 'clarify' : ec?.response_action || liveData?.response_action || (currentAnswer ? 'answer' : undefined)}
      evidenceVerdict={ec?.verdict || liveVerdict}
      evidenceGrade={ec?.grade || (typeof liveData?.verdict === 'object' ? liveData.verdict?.grade : undefined)}
      gatesPassed={ec?.gates_passed}
      gatesTotal={ec?.gates_total}
      liveGates={liveData?.gates ?? []}
      questionEntityRefs={questionEntityRefs.map((entry) => ({
        id: entry.id,
        name: entry.name,
        framework: entry.framework,
        description: entry.description,
      }))}
      answerEntityRefs={answerEntityRefs.map((entry) => ({
        id: entry.id,
        name: entry.name,
        framework: entry.framework,
        description: entry.description,
      }))}
      questionAnchorIds={inferredAnchorIds}
      groundedControls={groundedControls}
      questionGroundingSummary={questionGroundingSummary}
      answerGroundingSummary={answerGroundingSummary}
      answerHelperText={answerHelperText}
      unsupportedAnswerIds={unsupportedAnswerIds}
      verdictWhy={verdictWhy}
      qraQuality={qraQuality}
      gapReview={gapReview}
      gapReviewStatus={ec?.gap_review_status || liveData?.gap_review_status || (gapReview?.gap_review_status as string | undefined)}
      humanReviewState={ec?.human_review_state || liveData?.human_review_state || (gapReview?.human_review_state as string | undefined)}
      proposedCorrection={proposedCorrection}
      correctionLineage={correctionLineage}
      error={error}
      onNavigateToControl={navigateToControl}
      onRunValidation={runValidation}
      validating={validating}
      isEditing={isEditing}
      editedAnswer={draftAnswer}
      onStartEdit={handleStartEdit}
      onEditedAnswerChange={setDraftAnswer}
      onCancelEdit={handleCancelEdit}
      onSaveAndRerun={handleSaveAndRerun}
      draftUnknownIds={draftUnknownIds}
      reviewActions={reviewActions}
      formalProof={formalProof}
      sacmRef={ec?.sacm_ref || qraSacmRef}
      upstreamQRAKeys={upstreamQRAKeys.length > 0 ? upstreamQRAKeys : (storedEvidenceCase?.prior_qra_evidence ?? []).map((entry) => entry._key).filter(Boolean) as string[]}
      priorQRAEvidence={priorQRAEvidence.length > 0 ? priorQRAEvidence : (storedEvidenceCase?.prior_qra_evidence ?? [])}
      relatedQRAs={relatedQRAs}
      onSelectRelatedQRA={onSelectRelatedQRA}
      onOpenFormalMethods={navigateToLean4}
      onEscalateToChat={() => {
        window.dispatchEvent(new CustomEvent('sparta:open-qra-chat', {
          detail: {
            question,
            answer: isEditing ? draftAnswer : (ec?.answer || liveData?.answer || currentAnswer || ''),
            reasoning: reasoning || '',
            verdict: ec?.verdict || liveVerdict || 'pending',
            why: verdictWhy,
            unsupportedAnswerIds,
          },
        }))
      }}
    />
  )
}
