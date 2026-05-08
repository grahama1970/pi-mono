import { expect, test } from '@playwright/test'

const staleQra = {
  _key: 'qra_lifecycle_cm0029',
  _id: 'sparta_qra_canonical/qra_lifecycle_cm0029',
  qra_id: 'qra_lifecycle_cm0029',
  _collection: 'sparta_qra_canonical',
  control_id: 'CM0029',
  source_framework: 'SPARTA',
  qra_type: 'canonical',
  run_id: 'test-run',
  question: 'What is SPARTA countermeasure CM0029 (Comms Link)?',
  answer: 'SPARTA countermeasure CM0029 (Comms Link) is focused on TRANSEC (Transmission Security) measures.',
  reasoning: "The source provides only the control identifier (CM0029), name (Comms Link), and the term 'TRANSEC' in the description.",
  review_status: 'pending',
  evidence_case: {
    case_id: 'EC-QRA-CM0029',
    question_text: 'What is SPARTA countermeasure CM0029 (Comms Link)?',
    control_ids: ['CM0029'],
    glossary: [{ id: 'CM0029', name: 'TRANSEC', framework: 'SPARTA', type: 'countermeasure' }],
    answer: 'SPARTA countermeasure CM0029 (Comms Link) is focused on TRANSEC (Transmission Security) measures.',
    review_status: 'pending',
  },
}

const relatedQra = {
  ...staleQra,
  _key: 'qra_lifecycle_related',
  _id: 'sparta_qra_canonical/qra_lifecycle_related',
  qra_id: 'qra_lifecycle_related',
  question: 'What is CM0029: TRANSEC?',
  answer: 'CM0029 is the SPARTA countermeasure TRANSEC.',
  reasoning: 'The source resolves CM0029 to TRANSEC.',
  review_status: 'approved',
  evidence_case: {
    case_id: 'EC-QRA-CM0029-RELATED',
    control_ids: ['CM0029'],
    review_status: 'approved',
    nodes: {
      validated_context: [
        {
          mention: 'Comms Link',
          metadata: { matched_value: 'Comms Link' },
        },
      ],
    },
  },
}

const extractEntitiesPayload = {
  ok: true,
  grounding_ok: true,
  agent_decision: {
    safe_to_answer: true,
    needs_clarification: false,
    primary_entity_id: 'CM0029',
    grounding_source: 'proof_packet.assertions',
  },
  proof_packet: {
    generated_by: 'deterministic_extractor',
    llm_used: false,
    authoritative: true,
    assertions: [
      { rule_id: 'SPARTA_CONTROL_ID_EXACT_MATCH', subject: 'CM0029', predicate: 'resolves_to', object: 'sparta_controls/ctrl__CM0029', status: 'passed' },
      { rule_id: 'PARENTHETICAL_DESCRIPTOR_MATCHES_CONTROL_CATEGORY_OR_ALIAS', subject: 'descriptor:cm0029_comms_link', predicate: 'describes_control', object: 'CM0029', status: 'passed' },
    ],
  },
  nodes: {
    anchors: [
      {
        id: 'CM0029',
        node_kind: 'control',
        proof_role: 'entity_anchor',
        status: 'grounded',
        mention: 'CM0029',
        span: [30, 36],
        metadata: {
          control_id: 'CM0029',
          name: 'TRANSEC',
          framework: 'sparta',
          framework_label: 'SPARTA',
          type: 'countermeasure',
          category: 'Comms Link',
        },
      },
    ],
    validated_context: [
      {
        id: 'descriptor:cm0029_comms_link',
        node_kind: 'control_descriptor',
        proof_role: 'validated_context',
        status: 'grounded',
        mention: 'Comms Link',
        span: [38, 48],
        metadata: {
          control_id: 'CM0029',
          canonical_name: 'TRANSEC',
          descriptor_kind: 'control_category_or_alias',
          matched_value: 'Comms Link',
          category: 'Comms Link',
        },
        relationship: { type: 'describes_control', target_id: 'CM0029' },
      },
    ],
    suppressed: [
      { id: 'domain:link', mention: 'Link', reason: 'covered_by_grounded_control_descriptor', covered_by: 'descriptor:cm0029_comms_link' },
    ],
    unsupported: [],
  },
  counts: { anchors: 1, validated_context: 1, suppressed: 1, unsupported: 0 },
}

const evidenceRunPayload = {
  ok: true,
  extract_entities: {
    ok: true,
    grounding_ok: true,
  },
  evidence_case: {
    case_type: 'direct_lookup',
    answer_decision: { can_answer: true },
    clarification_decision: { blocking: false, required: false },
  },
}

test('QRA approval lifecycle requires fresh evidence for the repaired draft', async ({ page }) => {
  let reviewRequest: Record<string, unknown> | null = null

  await page.route('**/api/sparta/counts', async (route) => {
    await route.fulfill({ json: { controls: 12321, qras: 0, qrasCanonical: 2, qrasRelationship: 0, qrasTotal: 2, relationships: 0, urls: 0, knowledge: 0 } })
  })
  await page.route('**/api/qra/status-counts?*', async (route) => {
    await route.fulfill({ json: { total: 2, source_used: 'v2', counts: { grounded: 2, review: 0, passed: 0, adversarial: 0, missing: 0, failed: 0 }, generated_at: '2026-05-07T17:00:00.000Z' } })
  })
  await page.route('**/api/qra/feed', async (route) => {
    await route.fulfill({ json: { documents: [staleQra, relatedQra], total: 2, offset: 0, limit: 25, source_used: 'v2' } })
  })
  await page.route('**/api/qra/detail', async (route) => {
    const body = route.request().postDataJSON() as { key?: string }
    await route.fulfill({ json: { document: body.key === relatedQra._key ? relatedQra : staleQra } })
  })
  await page.route('**/api/extract-entities', async (route) => {
    const body = route.request().postDataJSON() as { view?: string }
    expect(body.view).toBe('agent')
    await route.fulfill({ json: extractEntitiesPayload })
  })
  await page.route('**/api/evidence-case/run', async (route) => {
    const body = route.request().postDataJSON() as { question?: string; answer?: string; reasoning?: string }
    expect(body.question).toBe(staleQra.question)
    expect(body.answer).toBe('CM0029 is the SPARTA countermeasure TRANSEC. It is categorized under Comms Link.')
    expect(body.reasoning).toContain('Comms Link is validated as the category/alias')
    await route.fulfill({ json: evidenceRunPayload })
  })
  await page.route('**/api/sparta/qras/*/review', async (route) => {
    reviewRequest = route.request().postDataJSON() as Record<string, unknown>
    const draft = reviewRequest.reviewed_draft as Record<string, unknown>
    await route.fulfill({
      json: {
        ok: true,
        collection: 'sparta_qra_canonical',
        document: {
          ...staleQra,
          question: draft.question,
          answer: draft.answer,
          reasoning: draft.reasoning,
          review_status: 'approved',
          evidence_case: {
            ...staleQra.evidence_case,
            review_status: 'approved',
            reviewed_draft_hash: reviewRequest.draft_hash,
            evidence_run_id: (reviewRequest.evidence_run as Record<string, unknown>).id,
            evidence_fresh_for_draft: true,
          },
          qra_review_history: [
            { decision: 'accept', draft_hash: reviewRequest.draft_hash, evidence_fresh_for_draft: true },
          ],
        },
      },
    })
  })

  await page.goto('http://localhost:3002/#sparta-explorer/qras?qra=qra_lifecycle_cm0029', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-qid="qras:review-pane"]')).toBeVisible()
  await expect(page.locator('[data-qid="qras:draft:answer"]')).toHaveValue('CM0029 is the SPARTA countermeasure TRANSEC. It is categorized under Comms Link.')
  await expect(page.locator('[data-qid="qras:draft:reasoning"]')).toHaveValue(/Comms Link is validated as the category\/alias/)

  await expect(page.locator('[data-qid="qras:artifact:evidence:approve"]')).toBeDisabled()
  await expect(page.locator('[data-qid="qras:artifact:evidence:approve"]')).toContainText('Approve blocked')

  await page.locator('[data-qid="qras:draft:rerun-evidence"]').click()
  await expect(page.locator('[data-qid="qras:evidence:freshness"]')).toContainText('Evidence fresh for draft')
  await expect(page.locator('[data-qid="qras:artifact:evidence:approve"]')).toBeEnabled()
  await expect(page.locator('[data-qid="qras:artifact:evidence:approve"]')).toContainText('Approve QRA')

  await page.locator('[data-qid="qras:artifact:evidence:approve"]').click()
  await expect.poll(() => reviewRequest).not.toBeNull()

  const reviewedDraft = reviewRequest?.reviewed_draft as Record<string, unknown>
  const evidenceRun = reviewRequest?.evidence_run as Record<string, unknown>
  expect(reviewRequest?.collection).toBe('sparta_qra_canonical')
  expect(reviewRequest?.decision).toBe('accept')
  expect(reviewedDraft.answer).toBe('CM0029 is the SPARTA countermeasure TRANSEC. It is categorized under Comms Link.')
  expect(reviewedDraft.reasoning).toContain('Comms Link is validated as the category/alias')
  expect(typeof reviewRequest?.draft_hash).toBe('string')
  expect(evidenceRun.fresh_for_draft).toBe(true)
  expect(typeof evidenceRun.id).toBe('string')
})
