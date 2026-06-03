import { describe, expect, it } from 'vitest'
import {
  extractEvidenceCaseFromText,
  extractFiguresFromText,
  extractSkillReceipt,
} from './parseStructuredArtifacts'

describe('parseStructuredArtifacts', () => {
  it('parses evidence case JSON', () => {
    const json = JSON.stringify({
      verdict: 'satisfied',
      grade: 'A',
      gates_passed: 5,
      gates_total: 5,
      gate_summary: 'All gates passed',
      control_ids: ['CWE-287'],
      tier: 'grounded',
    })
    const row = extractEvidenceCaseFromText([json])
    expect(row?.verdict).toBe('satisfied')
    expect(row?.control_ids).toEqual(['CWE-287'])
  })

  it('parses skill_call receipt prose', () => {
    const text = 'Executed `/create-evidence-case` via mediated **skill_call** (`completed`).\n\n**Result excerpt:**\nGate 3 failed.'
    const receipt = extractSkillReceipt(text)
    expect(receipt?.skill).toBe('create-evidence-case')
    expect(receipt?.status).toBe('completed')
    expect(receipt?.excerpt).toContain('Gate 3')
  })

  it('finds figure paths in text', () => {
    const figs = extractFiguresFromText(['Wrote /tmp/charts/metrics.png for review.'])
    expect(figs[0]?.path).toBe('/tmp/charts/metrics.png')
  })
})
