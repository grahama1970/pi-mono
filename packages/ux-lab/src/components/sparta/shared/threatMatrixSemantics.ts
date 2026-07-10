export type EvidenceVerdict = 'satisfied' | 'inconclusive' | 'not_satisfied' | 'none'

export type TechniqueEvidenceAggregate = {
  aggregateVerdict: EvidenceVerdict
  satisfiedCount: number
  inconclusiveCount: number
  notSatisfiedCount: number
  caseCount: number
  conflicting: boolean
  grades: string[]
}

export type TacticStats = {
  total: number
  satisfied: number
  inconclusive: number
  notSatisfied: number
  noCase: number
}

export type SourceTemporalState = {
  observedAt?: string
  validFrom?: string
  validTo?: string
  assessedAt?: string
  sourceEventId?: string
  freshness: 'current' | 'stale' | 'expired' | 'unknown'
}

export type TemporalEvidenceState = {
  observed_at: number
  valid_from: number
  valid_to?: number
  assessed_at?: number
  source_event_id: string
  is_active: boolean
}

export type PersistedRelationshipEdge = {
  _id?: string
  _key?: string
  source_control_id?: string
  target_control_id?: string
  relationship_type?: string
  edge_type?: string
  review_state?: string
  source_artifact_ids?: string[]
  superseded?: boolean
  rejected?: boolean
}

const VERDICT_PRIORITY: Record<EvidenceVerdict, number> = {
  none: 0,
  satisfied: 1,
  inconclusive: 2,
  not_satisfied: 3,
}

const SUPPORTED_RELATIONSHIP_TYPES = new Set([
  'mitigates',
  'detects',
  'maps_to',
  'related_to',
  'exploits',
  'addresses',
  'depends_on',
  'supports',
  'contradicts',
])

const VERIFIED_REVIEW_STATES = new Set(['approved', 'verified'])

export function normalizeEvidenceVerdict(value?: string | null): EvidenceVerdict {
  if (value === 'satisfied' || value === 'inconclusive' || value === 'not_satisfied') return value
  return 'none'
}

export function aggregateTechniqueEvidence(
  cases: Array<{ verdict?: string | null; grade?: string | null }>,
): TechniqueEvidenceAggregate {
  const normalized = cases.map((item) => ({
    verdict: normalizeEvidenceVerdict(item.verdict),
    grade: item.grade,
  }))
  const aggregateVerdict = normalized.reduce<EvidenceVerdict>((current, item) => (
    VERDICT_PRIORITY[item.verdict] > VERDICT_PRIORITY[current] ? item.verdict : current
  ), 'none')
  const verdictSet = new Set(normalized.map((item) => item.verdict).filter((verdict) => verdict !== 'none'))

  return {
    aggregateVerdict,
    satisfiedCount: normalized.filter((item) => item.verdict === 'satisfied').length,
    inconclusiveCount: normalized.filter((item) => item.verdict === 'inconclusive').length,
    notSatisfiedCount: normalized.filter((item) => item.verdict === 'not_satisfied').length,
    caseCount: normalized.length,
    conflicting: verdictSet.size > 1,
    grades: normalized.flatMap((item) => item.grade ? [item.grade] : []),
  }
}

export function calculateTacticStats(
  tactics: Array<{ name: string }>,
  techniques: Array<{ tactic: string; evidenceVerdict: EvidenceVerdict }>,
): Record<string, TacticStats> {
  const stats: Record<string, TacticStats> = {}
  for (const tactic of tactics) {
    stats[tactic.name] = { total: 0, satisfied: 0, inconclusive: 0, notSatisfied: 0, noCase: 0 }
  }
  for (const technique of techniques) {
    const bucket = stats[technique.tactic]
    if (!bucket) continue
    bucket.total += 1
    if (technique.evidenceVerdict === 'satisfied') bucket.satisfied += 1
    else if (technique.evidenceVerdict === 'inconclusive') bucket.inconclusive += 1
    else if (technique.evidenceVerdict === 'not_satisfied') bucket.notSatisfied += 1
    else bucket.noCase += 1
  }
  return stats
}

export function normalizeRelationshipType(value?: string | null): string {
  if (!value) return 'unknown'
  return SUPPORTED_RELATIONSHIP_TYPES.has(value) ? value : 'unknown'
}

export function isOperationalRelationshipEdge(edge: PersistedRelationshipEdge): boolean {
  if (!edge._id || !edge._key || !edge.source_control_id || !edge.target_control_id) return false
  if (!VERIFIED_REVIEW_STATES.has(String(edge.review_state ?? '').toLowerCase())) return false
  if (!edge.source_artifact_ids?.length || edge.superseded === true || edge.rejected === true) return false
  return true
}

export function temporalFromSource(source?: SourceTemporalState): TemporalEvidenceState | undefined {
  if (!source?.observedAt || !source.sourceEventId) return undefined
  const observedAt = Date.parse(source.observedAt)
  const validFrom = source.validFrom ? Date.parse(source.validFrom) : observedAt
  const validTo = source.validTo ? Date.parse(source.validTo) : undefined
  const assessedAt = source.assessedAt ? Date.parse(source.assessedAt) : undefined
  if (![observedAt, validFrom, validTo, assessedAt].every((value) => value === undefined || Number.isFinite(value))) {
    return undefined
  }
  return {
    observed_at: observedAt,
    valid_from: validFrom,
    valid_to: validTo,
    assessed_at: assessedAt,
    source_event_id: source.sourceEventId,
    is_active: source.freshness === 'current',
  }
}
