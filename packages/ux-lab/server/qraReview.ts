export type JsonRecord = Record<string, unknown>

export type QraReviewDecision = 'accept' | 'reject' | 'retain_adversarial'

export interface QraReviewedDraft {
  question: string
  answer: string
  reasoning?: string
}

export interface QraEvidenceRunMetadata {
  id?: unknown
  checked_at?: unknown
  fresh_for_draft?: unknown
}

export interface QraReviewPatchInput {
  decision: QraReviewDecision
  reviewer: string
  reviewedDraft: QraReviewedDraft
  draftHash?: string
  evidenceRun?: QraEvidenceRunMetadata
  reviewedAt?: string
}

export function buildQraReviewPatch(input: QraReviewPatchInput) {
  const reviewedAt = input.reviewedAt ?? new Date().toISOString()
  const reviewStatus = input.decision === 'accept'
    ? 'approved'
    : input.decision === 'reject'
      ? 'rejected'
      : 'adversarial_fixture'
  const humanReviewState = input.decision === 'accept'
    ? 'approved'
    : input.decision === 'reject'
      ? 'rejected'
      : 'not_applicable'
  const reviewEvent = {
    decision: input.decision,
    review_status: reviewStatus,
    reviewer: input.reviewer,
    reviewed_at: reviewedAt,
    draft_hash: input.draftHash || null,
    evidence_run_id: typeof input.evidenceRun?.id === 'string' ? input.evidenceRun.id : null,
    evidence_run_checked_at: typeof input.evidenceRun?.checked_at === 'string' ? input.evidenceRun.checked_at : null,
    evidence_fresh_for_draft: input.evidenceRun?.fresh_for_draft === true,
  }
  return {
    reviewStatus,
    humanReviewState,
    reviewEvent,
    patch: {
      question: input.reviewedDraft.question,
      answer: input.reviewedDraft.answer,
      reasoning: input.reviewedDraft.reasoning ?? '',
      review_status: reviewStatus,
      reviewed_by: input.reviewer,
      reviewed_at: reviewedAt,
      qra_review: reviewEvent,
    },
    evidenceCasePatch: {
      review_status: reviewStatus,
      human_review_state: humanReviewState,
      reviewed_by: input.reviewer,
      reviewed_at: reviewedAt,
      reviewed_draft_hash: input.draftHash || null,
      evidence_run_id: typeof input.evidenceRun?.id === 'string' ? input.evidenceRun.id : null,
      evidence_run_checked_at: typeof input.evidenceRun?.checked_at === 'string' ? input.evidenceRun.checked_at : null,
      evidence_fresh_for_draft: input.evidenceRun?.fresh_for_draft === true,
    },
  }
}

export function sanitizeQraReviewDocument<T extends JsonRecord>(document: T): T {
  const sanitized = { ...document }
  delete sanitized._id
  delete sanitized._rev
  return sanitized as T
}

export function mergeQraReviewDocument(
  existing: JsonRecord,
  patch: JsonRecord,
  evidenceCasePatch: JsonRecord,
  reviewEvent: JsonRecord,
): JsonRecord {
  const existingEvidenceCase = existing.evidence_case && typeof existing.evidence_case === 'object' && !Array.isArray(existing.evidence_case)
    ? existing.evidence_case as JsonRecord
    : {}
  const reviewHistory = Array.isArray(existing.qra_review_history) ? existing.qra_review_history : []
  return sanitizeQraReviewDocument({
    ...existing,
    ...patch,
    evidence_case: {
      ...existingEvidenceCase,
      ...evidenceCasePatch,
    },
    qra_review_history: [
      ...reviewHistory,
      reviewEvent,
    ],
  })
}

export interface PersistQraReviewInput {
  key: string
  collections: string[]
  patch: JsonRecord
  evidenceCasePatch: JsonRecord
  reviewEvent: JsonRecord
  fetchQraDocsByKeys: (collection: string, keys: string[]) => Promise<JsonRecord[]>
  upsertDocuments: (collection: string, documents: JsonRecord[]) => Promise<unknown>
}

export interface PersistQraReviewResult {
  collection: string
  document: JsonRecord
}

export async function persistQraReview(input: PersistQraReviewInput): Promise<PersistQraReviewResult | null> {
  for (const collection of input.collections) {
    const existing = (await input.fetchQraDocsByKeys(collection, [input.key]))[0]
    if (!existing) continue

    const document = mergeQraReviewDocument(existing, input.patch, input.evidenceCasePatch, input.reviewEvent)
    await input.upsertDocuments(collection, [document])
    const refreshed = (await input.fetchQraDocsByKeys(collection, [input.key]))[0] ?? document
    return { collection, document: refreshed }
  }
  return null
}
