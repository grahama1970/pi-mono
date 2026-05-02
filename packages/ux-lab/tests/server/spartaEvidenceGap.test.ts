import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('SPARTA evidence gap review server contract', () => {
  const serverSource = readFileSync(resolve(process.cwd(), 'server/index.ts'), 'utf8')

  it('keeps ambiguous evidence-case responses structurally complete', () => {
    expect(serverSource).toContain('function evidenceCaseAmbiguousPayload')
    expect(serverSource).toContain("mode: 'clarification_required'")
    expect(serverSource).toContain('qra_quality')
    expect(serverSource).toContain('ambiguous_referents: ambiguousReferents')
    expect(serverSource).toContain('cae_tree: null')
  })

  it('keeps advisory gap reviews non-authoritative and queued for humans', () => {
    expect(serverSource).toContain('function buildAdvisoryGapReview')
    expect(serverSource).toContain("advisory_only: true")
    expect(serverSource).toContain("route: 'human_review'")
    expect(serverSource).toContain("status: 'queued'")
    expect(serverSource).toContain('evidence_case_version: createEvidenceCaseVersion')
  })
})
