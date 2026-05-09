import { describe, expect, it } from 'vitest'
import { buildQraReviewPatch, mergeQraReviewDocument, persistQraReview, sanitizeQraReviewDocument } from '../../server/qraReview.js'

describe('/api/sparta/qras/:key/review persistence helpers', () => {
  it('builds reviewed-draft metadata for the exact evidence run', () => {
    const built = buildQraReviewPatch({
      decision: 'accept',
      reviewer: 'brandon',
      reviewedAt: '2026-05-07T17:22:16.000Z',
      draftHash: 'fnv1a:abc12345',
      evidenceRun: {
        id: 'qra_evidence:qra_test:fnv1a_abc12345',
        checked_at: '2026-05-07T17:22:10.000Z',
        fresh_for_draft: true,
      },
      reviewedDraft: {
        question: 'What is SPARTA countermeasure CM0029 (Comms Link)?',
        answer: 'CM0029 is the SPARTA countermeasure TRANSEC. It is categorized under Comms Link.',
        reasoning: 'The extractor resolves CM0029 to the SPARTA countermeasure TRANSEC.',
      },
    })

    expect(built.patch).toMatchObject({
      question: 'What is SPARTA countermeasure CM0029 (Comms Link)?',
      answer: 'CM0029 is the SPARTA countermeasure TRANSEC. It is categorized under Comms Link.',
      reasoning: 'The extractor resolves CM0029 to the SPARTA countermeasure TRANSEC.',
      review_status: 'approved',
      reviewed_by: 'brandon',
      reviewed_at: '2026-05-07T17:22:16.000Z',
    })
    expect(built.evidenceCasePatch).toMatchObject({
      review_status: 'approved',
      human_review_state: 'approved',
      reviewed_draft_hash: 'fnv1a:abc12345',
      evidence_run_id: 'qra_evidence:qra_test:fnv1a_abc12345',
      evidence_run_checked_at: '2026-05-07T17:22:10.000Z',
      evidence_fresh_for_draft: true,
    })
    expect(built.reviewEvent).toMatchObject({
      decision: 'accept',
      review_status: 'approved',
      evidence_fresh_for_draft: true,
    })
  })

  it('strips Arango internals but preserves _key for /upsert', () => {
    const sanitized = sanitizeQraReviewDocument({
      _key: 'qra_test',
      _id: 'sparta_qra_canonical/qra_test',
      _rev: '_abc',
      answer: 'reviewed answer',
    })

    expect(sanitized).toEqual({
      _key: 'qra_test',
      answer: 'reviewed answer',
    })
  })

  it('merges reviewed draft, evidence metadata, and review history for canonical /upsert', () => {
    const built = buildQraReviewPatch({
      decision: 'accept',
      reviewer: 'brandon',
      reviewedAt: '2026-05-07T17:22:16.000Z',
      draftHash: 'fnv1a:abc12345',
      evidenceRun: {
        id: 'qra_evidence:qra_test:fnv1a_abc12345',
        checked_at: '2026-05-07T17:22:10.000Z',
        fresh_for_draft: true,
      },
      reviewedDraft: {
        question: 'What is SPARTA countermeasure CM0029 (Comms Link)?',
        answer: 'CM0029 is the SPARTA countermeasure TRANSEC. It is categorized under Comms Link.',
        reasoning: 'The extractor resolves CM0029 to the SPARTA countermeasure TRANSEC.',
      },
    })

    const merged = mergeQraReviewDocument(
      {
        _key: 'qra_test',
        _id: 'sparta_qra_canonical/qra_test',
        _rev: '_old',
        answer: 'old answer',
        evidence_case: { case_id: 'EC-QRA-CM0029', review_status: 'pending' },
        qra_review_history: [{ decision: 'reject', reviewed_at: '2026-05-06T00:00:00.000Z' }],
      },
      built.patch,
      built.evidenceCasePatch,
      built.reviewEvent,
    )

    expect(merged._key).toBe('qra_test')
    expect(merged._id).toBeUndefined()
    expect(merged._rev).toBeUndefined()
    expect(merged.answer).toBe('CM0029 is the SPARTA countermeasure TRANSEC. It is categorized under Comms Link.')
    expect(merged.evidence_case).toMatchObject({
      case_id: 'EC-QRA-CM0029',
      review_status: 'approved',
      reviewed_draft_hash: 'fnv1a:abc12345',
      evidence_run_id: 'qra_evidence:qra_test:fnv1a_abc12345',
      evidence_fresh_for_draft: true,
    })
    expect(merged.qra_review_history).toHaveLength(2)
    expect((merged.qra_review_history as Array<Record<string, unknown>>)[1]).toMatchObject({
      decision: 'accept',
      evidence_run_id: 'qra_evidence:qra_test:fnv1a_abc12345',
      evidence_fresh_for_draft: true,
    })
  })

  it('persists review by /upsert, strips Arango internals, preserves _key, and returns the refetched document', async () => {
    const built = buildQraReviewPatch({
      decision: 'accept',
      reviewer: 'brandon',
      reviewedAt: '2026-05-07T17:22:16.000Z',
      draftHash: 'fnv1a:abc12345',
      evidenceRun: {
        id: 'qra_evidence:qra_test:fnv1a_abc12345',
        checked_at: '2026-05-07T17:22:10.000Z',
        fresh_for_draft: true,
      },
      reviewedDraft: {
        question: 'What is SPARTA countermeasure CM0029 (Comms Link)?',
        answer: 'CM0029 is the SPARTA countermeasure TRANSEC. It is categorized under Comms Link.',
        reasoning: 'The extractor resolves CM0029 to the SPARTA countermeasure TRANSEC.',
      },
    })
    const fetchCalls: Array<{ collection: string; keys: string[] }> = []
    const upsertCalls: Array<{ collection: string; documents: Array<Record<string, unknown>> }> = []
    let fetchCount = 0

    const result = await persistQraReview({
      key: 'qra_test',
      collections: ['sparta_qra_canonical'],
      patch: built.patch,
      evidenceCasePatch: built.evidenceCasePatch,
      reviewEvent: built.reviewEvent,
      fetchQraDocsByKeys: async (collection, keys) => {
        fetchCalls.push({ collection, keys })
        fetchCount += 1
        if (fetchCount === 1) {
          return [{
            _key: 'qra_test',
            _id: 'sparta_qra_canonical/qra_test',
            _rev: '_old',
            question: 'old question',
            answer: 'old answer',
            reasoning: 'old reasoning',
            evidence_case: { review_status: 'pending' },
          }]
        }
        return [{
          _key: 'qra_test',
          answer: 'CM0029 is the SPARTA countermeasure TRANSEC. It is categorized under Comms Link.',
          reasoning: 'The extractor resolves CM0029 to the SPARTA countermeasure TRANSEC.',
          review_status: 'approved',
          evidence_case: {
            review_status: 'approved',
            evidence_fresh_for_draft: true,
          },
        }]
      },
      upsertDocuments: async (collection, documents) => {
        upsertCalls.push({ collection, documents })
      },
    })

    expect(fetchCalls).toEqual([
      { collection: 'sparta_qra_canonical', keys: ['qra_test'] },
      { collection: 'sparta_qra_canonical', keys: ['qra_test'] },
    ])
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0].collection).toBe('sparta_qra_canonical')
    expect(upsertCalls[0].documents[0]._key).toBe('qra_test')
    expect(upsertCalls[0].documents[0]._id).toBeUndefined()
    expect(upsertCalls[0].documents[0]._rev).toBeUndefined()
    expect(upsertCalls[0].documents[0].answer).toBe('CM0029 is the SPARTA countermeasure TRANSEC. It is categorized under Comms Link.')
    expect(result).toMatchObject({
      collection: 'sparta_qra_canonical',
      document: {
        _key: 'qra_test',
        review_status: 'approved',
        evidence_case: {
          evidence_fresh_for_draft: true,
        },
      },
    })
  })
})
