import { describe, expect, it } from 'vitest'
import {
  aggregateTechniqueEvidence,
  calculateTacticStats,
  isOperationalRelationshipEdge,
  normalizeRelationshipType,
  temporalFromSource,
} from './threatMatrixSemantics'

describe('aggregateTechniqueEvidence', () => {
  it('keeps not satisfied stronger than satisfied and exposes conflict', () => {
    expect(aggregateTechniqueEvidence([
      { verdict: 'not_satisfied', grade: 'F' },
      { verdict: 'satisfied', grade: 'A' },
    ])).toMatchObject({
      aggregateVerdict: 'not_satisfied',
      satisfiedCount: 1,
      inconclusiveCount: 0,
      notSatisfiedCount: 1,
      caseCount: 2,
      conflicting: true,
      grades: ['F', 'A'],
    })
  })

  it('keeps inconclusive stronger than satisfied and exposes conflict', () => {
    expect(aggregateTechniqueEvidence([
      { verdict: 'inconclusive' },
      { verdict: 'satisfied' },
    ])).toMatchObject({ aggregateVerdict: 'inconclusive', conflicting: true })
  })

  it('aggregates identical satisfied cases without a conflict', () => {
    expect(aggregateTechniqueEvidence([
      { verdict: 'satisfied' },
      { verdict: 'satisfied' },
    ])).toMatchObject({
      aggregateVerdict: 'satisfied',
      satisfiedCount: 2,
      conflicting: false,
    })
  })

  it('returns none for no cases', () => {
    expect(aggregateTechniqueEvidence([])).toEqual({
      aggregateVerdict: 'none',
      satisfiedCount: 0,
      inconclusiveCount: 0,
      notSatisfiedCount: 0,
      caseCount: 0,
      conflicting: false,
      grades: [],
    })
  })
})

describe('calculateTacticStats', () => {
  it('keeps no case separate from not satisfied', () => {
    const stats = calculateTacticStats(
      [{ name: 'Reconnaissance' }],
      Array.from({ length: 9 }, (_, index) => ({
        id: `REC-${String(index + 1).padStart(4, '0')}`,
        tactic: 'Reconnaissance',
        evidenceVerdict: 'none' as const,
      })),
    )

    expect(stats.Reconnaissance).toEqual({
      total: 9,
      satisfied: 0,
      inconclusive: 0,
      notSatisfied: 0,
      noCase: 9,
    })
  })
})

describe('persisted edge semantics', () => {
  it('accepts only reviewed edges with authoritative ids and source artifacts', () => {
    expect(isOperationalRelationshipEdge({
      _id: 'sparta_relationships/123',
      _key: '123',
      source_control_id: 'REC-0001',
      target_control_id: 'CM-0001',
      relationship_type: 'mitigates',
      review_state: 'verified',
      source_artifact_ids: ['artifact-1'],
    })).toBe(true)

    expect(isOperationalRelationshipEdge({
      source_control_id: 'REC-0001',
      target_control_id: 'CM-0001',
      relationship_type: 'mitigates',
    })).toBe(false)
  })

  it('preserves supported relationship types and fails unknown values closed', () => {
    expect(normalizeRelationshipType('mitigates')).toBe('mitigates')
    expect(normalizeRelationshipType('made_up')).toBe('unknown')
    expect(normalizeRelationshipType()).toBe('unknown')
  })
})

describe('temporalFromSource', () => {
  it('does not invent temporal evidence when timestamp identity is missing', () => {
    expect(temporalFromSource()).toBeUndefined()
    expect(temporalFromSource({ observedAt: '2026-07-10T12:00:00Z', freshness: 'current' })).toBeUndefined()
    expect(temporalFromSource({
      observedAt: 'not-a-timestamp',
      sourceEventId: 'event-1',
      freshness: 'current',
    })).toBeUndefined()
  })

  it('converts authoritative source timestamps without inventing validity', () => {
    expect(temporalFromSource({
      observedAt: '2026-07-10T12:00:00Z',
      assessedAt: '2026-07-10T13:00:00Z',
      sourceEventId: 'event-1',
      freshness: 'current',
    })).toEqual({
      observed_at: Date.parse('2026-07-10T12:00:00Z'),
      valid_from: Date.parse('2026-07-10T12:00:00Z'),
      valid_to: undefined,
      assessed_at: Date.parse('2026-07-10T13:00:00Z'),
      source_event_id: 'event-1',
      is_active: true,
    })
  })
})
