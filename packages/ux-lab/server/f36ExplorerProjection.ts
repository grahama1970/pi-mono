import { createHash } from 'crypto'
import { readFile, stat } from 'fs/promises'

const DEFAULT_SNAPSHOT_PATH = '/home/graham/workspace/experiments/sparta/f36-living-datalake/F36-SYN-MISSION-COMPUTER-UPDATE-CHAIN/qra/evidence-orchestration-gate1-v14-semantic/run-20260714/attempt-01/replay.snapshot.json'
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const EXPECTED = {
  schema: 'f36.family_evidence_case_snapshot.v1',
  requirementId: 'F36B-M00-S01-C01-CYB-004',
  requirementRevisionId: 'F36B-M00-S01-C01-CYB-004@R2',
  requirementContentHash: 'sha256:7d9202f58753fd51b6e44e6323b56805e73d0620c23cfd645021d00f7631e6de',
  componentFamilyId: 'F36B-M00-S01-C01',
  familyId: 'F36B-QRAF-f7f0d86e78348af83184',
  canonicalAnswerHash: 'sha256:48eb5ba8888e94da6ad918fb3f6a586277c874bedf85eaa49b5d2f4cd6a25414',
  snapshotId: 'F36B-ECF-67be0c13dc7fb38ebbf8',
  snapshotContentHash: 'sha256:9a630af4039c1d19365d62a17773e9181d6c05ade3b4705123a9577194ef4305',
  inputFingerprint: 'sha256:b6187e9afff6130fdda47a7d7b1b321e48d8d226801e77b680b2a438a1f56fc2',
  releaseId: 'sparta-excel-v3.1-9cbd7eef12547bd0',
  releaseHash: 'sha256:9cbd7eef12547bd0a9f8a9a911874dc426c20511e0dd57ee8ee0619a8f2b45f8',
  targetIds: ['DE-0012', 'PER-0005', 'EX-0001.02'],
} as const

type JsonRecord = Record<string, unknown>

export class F36ExplorerProjectionError extends Error {
  constructor(
    readonly code: 'F36_PROJECTION_SOURCE_MISSING' | 'F36_PROJECTION_SOURCE_STALE' | 'F36_PROJECTION_SOURCE_INVALID',
    readonly statusCode: 404 | 409 | 422,
    message: string,
  ) {
    super(message)
    this.name = 'F36ExplorerProjectionError'
  }
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new F36ExplorerProjectionError('F36_PROJECTION_SOURCE_INVALID', 422, `${label} must be an object`)
  }
  return value as JsonRecord
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new F36ExplorerProjectionError('F36_PROJECTION_SOURCE_INVALID', 422, `${label} must be an array`)
  }
  return value
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new F36ExplorerProjectionError('F36_PROJECTION_SOURCE_INVALID', 422, `${label} must be a non-empty string`)
  }
  return value
}

function exact(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) {
    throw new F36ExplorerProjectionError(
      'F36_PROJECTION_SOURCE_INVALID',
      422,
      `${label} expected ${JSON.stringify(expected)} but received ${JSON.stringify(value)}`,
    )
  }
}

function sha256Text(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function maxAgeMs(): number {
  const configured = Number(process.env.F36_EXPLORER_PROJECTION_MAX_AGE_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_AGE_MS
}

function canonicalAnswer(intent: JsonRecord): string {
  const protectedObject = string(intent.protected_object_or_interface, 'canonical_intent.protected_object_or_interface')
  const condition = string(intent.condition, 'canonical_intent.condition')
  const requiredBehavior = string(intent.required_behavior, 'canonical_intent.required_behavior')
  const expectedOutcome = string(intent.expected_outcome, 'canonical_intent.expected_outcome')
  return `For ${protectedObject}, the condition is ${condition}; the required behavior is ${requiredBehavior}; the outcome is ${expectedOutcome}.`
}

export interface F36ExplorerProjection {
  schema: 'f36.explorer_shared_projection.v1'
  projection_fingerprint: string
  source: {
    path: string
    source_file_sha256: string
    family_evidence_case_snapshot_id: string
    snapshot_content_hash: string
    input_fingerprint: string
    modified_at: string
    age_ms: number
    stale: false
    live: true
    mocked: false
  }
  requirement: {
    requirement_id: string
    requirement_revision_id: string
    requirement_content_hash: string
    primary_component_family_id: string
  }
  engineering_qra_family: {
    engineering_qra_family_id: string
    canonical_question: string
    canonical_answer: string
    canonical_answer_hash: string
    canonical_intent: JsonRecord
    variant_count: number
    variant_evidence_runs: 0
  }
  evidence_verdict: 'INCONCLUSIVE'
  family_disposition: 'unresolved_evidence'
  applicability: JsonRecord
  review_state: 'pending'
  accepted: false
  quarantine_state: 'quarantined_pending_human_review'
  binding_registry_state: 'not_promoted'
  crosswalk_resolution_state: 'exact_path'
  projection_eligibility: {
    candidate_review_mode: true
    reviewed_default_mode: false
    posture_grounding_numerator: false
    supply_chain_sparta_overlay: false
  }
  path_resolution: {
    sparta_release_id: string
    sparta_release_hash: string
    path_proofs: JsonRecord[]
  }
  posture: {
    assessed_requirements: 1
    applicable_requirements: 1
    pending_review_requirements: 1
    grounded_numerator: 0
    compliance_credit: 0
  }
  supply_chain: {
    engineering_lineage_available: false
    reviewed_sparta_overlay: false
    state: 'no_reviewed_supply_chain_overlay'
  }
  authority: {
    state: 'agent_candidate_pending_human_review'
    operational_authority: false
    implementation_credit: 0
    compliance_credit: 0
    path_proofs_are_traceability_only: true
  }
  consumer_fingerprints: {
    threat_matrix: string
    posture: string
    supply_chain: string
    chat: string
  }
}

export async function loadF36ExplorerProjection(
  sourcePath = process.env.F36_EXPLORER_REPLAY_SNAPSHOT ?? DEFAULT_SNAPSHOT_PATH,
): Promise<F36ExplorerProjection> {
  let sourceStat
  let raw: string
  try {
    ;[sourceStat, raw] = await Promise.all([stat(sourcePath), readFile(sourcePath, 'utf8')])
  } catch (error) {
    throw new F36ExplorerProjectionError(
      'F36_PROJECTION_SOURCE_MISSING',
      404,
      `Replay-family projection source is unavailable at ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const ageMs = Date.now() - sourceStat.mtimeMs
  if (ageMs < 0 || ageMs > maxAgeMs()) {
    throw new F36ExplorerProjectionError(
      'F36_PROJECTION_SOURCE_STALE',
      409,
      `Replay-family projection source is stale (${Math.max(0, Math.round(ageMs / 1000))} seconds old)`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new F36ExplorerProjectionError(
      'F36_PROJECTION_SOURCE_INVALID',
      422,
      `Replay-family projection source is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const snapshot = record(parsed, 'snapshot')
  const requirement = record(snapshot.requirement, 'requirement')
  const family = record(snapshot.engineering_qra_family, 'engineering_qra_family')
  const intent = record(family.canonical_intent, 'engineering_qra_family.canonical_intent')
  const applicability = record(snapshot.applicability, 'applicability')
  const eligibility = record(snapshot.projection_eligibility, 'projection_eligibility')
  const stageReceipts = snapshot.stage_receipts && typeof snapshot.stage_receipts === 'object'
    ? record(snapshot.stage_receipts, 'stage_receipts')
    : {}
  const pathResolution = record(snapshot.path_resolution ?? stageReceipts.path_resolution, 'path_resolution')
  const proofs = array(pathResolution.path_proofs, 'path_resolution.path_proofs').map((value, index) => record(value, `path_proofs[${index}]`))

  exact(snapshot.schema, EXPECTED.schema, 'schema')
  exact(requirement.requirement_id, EXPECTED.requirementId, 'requirement.requirement_id')
  exact(requirement.requirement_revision_id, EXPECTED.requirementRevisionId, 'requirement.requirement_revision_id')
  exact(requirement.requirement_content_hash, EXPECTED.requirementContentHash, 'requirement.requirement_content_hash')
  exact(requirement.primary_component_family_id, EXPECTED.componentFamilyId, 'requirement.primary_component_family_id')
  exact(family.engineering_qra_family_id, EXPECTED.familyId, 'engineering_qra_family.engineering_qra_family_id')
  exact(family.canonical_answer_hash, EXPECTED.canonicalAnswerHash, 'engineering_qra_family.canonical_answer_hash')
  exact(family.variant_count, 5, 'engineering_qra_family.variant_count')
  exact(family.variant_evidence_runs, 0, 'engineering_qra_family.variant_evidence_runs')
  exact(snapshot.evidence_verdict, 'INCONCLUSIVE', 'evidence_verdict')
  exact(snapshot.family_disposition, 'unresolved_evidence', 'family_disposition')
  exact(applicability.state, 'candidate_applicable', 'applicability.state')
  exact(applicability.route, 'direct_space', 'applicability.route')
  exact(applicability.review_state, 'pending', 'applicability.review_state')
  exact(snapshot.review_state, 'pending', 'review_state')
  exact(snapshot.accepted, false, 'accepted')
  exact(snapshot.quarantine_state, 'quarantined_pending_human_review', 'quarantine_state')
  exact(snapshot.binding_registry_state, 'not_promoted', 'binding_registry_state')
  exact(snapshot.crosswalk_resolution_state, 'exact_path', 'crosswalk_resolution_state')
  exact(eligibility.candidate_review_mode, true, 'projection_eligibility.candidate_review_mode')
  exact(eligibility.reviewed_default_mode, false, 'projection_eligibility.reviewed_default_mode')
  exact(eligibility.posture_grounding_numerator, false, 'projection_eligibility.posture_grounding_numerator')
  exact(eligibility.supply_chain_sparta_overlay, false, 'projection_eligibility.supply_chain_sparta_overlay')
  exact(snapshot.family_evidence_case_snapshot_id, EXPECTED.snapshotId, 'family_evidence_case_snapshot_id')
  exact(snapshot.snapshot_content_hash, EXPECTED.snapshotContentHash, 'snapshot_content_hash')
  exact(snapshot.input_fingerprint, EXPECTED.inputFingerprint, 'input_fingerprint')
  exact(snapshot.live, true, 'live')
  exact(snapshot.mocked, false, 'mocked')
  exact(snapshot.operational_authority, false, 'operational_authority')
  exact(pathResolution.sparta_release_id, EXPECTED.releaseId, 'path_resolution.sparta_release_id')
  exact(pathResolution.sparta_release_hash, EXPECTED.releaseHash, 'path_resolution.sparta_release_hash')

  const answer = canonicalAnswer(intent)
  exact(sha256Text(answer), EXPECTED.canonicalAnswerHash, 'reconstructed canonical answer hash')

  const targetIds = new Set<string>()
  for (const [proofIndex, proof] of proofs.entries()) {
    string(proof.path_signature, `path_proofs[${proofIndex}].path_signature`)
    exact(proof.authority_state, 'persisted_candidate_pending_review', `path_proofs[${proofIndex}].authority_state`)
    const nodes = array(proof.nodes, `path_proofs[${proofIndex}].nodes`).map((value, index) => record(value, `path_proofs[${proofIndex}].nodes[${index}]`))
    const edges = array(proof.edges, `path_proofs[${proofIndex}].edges`).map((value, index) => record(value, `path_proofs[${proofIndex}].edges[${index}]`))
    const persistedEdgeIds = array(proof.persisted_edge_ids, `path_proofs[${proofIndex}].persisted_edge_ids`).map((value, index) => string(value, `path_proofs[${proofIndex}].persisted_edge_ids[${index}]`))
    if (nodes.length < 2 || edges.length !== 1 || persistedEdgeIds.length !== 1) {
      throw new F36ExplorerProjectionError('F36_PROJECTION_SOURCE_INVALID', 422, `path_proofs[${proofIndex}] must contain at least two nodes and exactly one persisted directed edge`)
    }
    const edge = edges[0]
    exact(edge.source_id, 'RA-10', `path_proofs[${proofIndex}].edges[0].source_id`)
    exact(edge.source_framework, 'nist', `path_proofs[${proofIndex}].edges[0].source_framework`)
    exact(edge.target_framework, 'sparta', `path_proofs[${proofIndex}].edges[0].target_framework`)
    exact(edge.relationship_type, 'control_relationship', `path_proofs[${proofIndex}].edges[0].relationship_type`)
    exact(edge.persisted_edge_id, persistedEdgeIds[0], `path_proofs[${proofIndex}].edges[0].persisted_edge_id`)
    exact(edge.direction, `${edge.source_id}->${edge.target_id}`, `path_proofs[${proofIndex}].edges[0].direction`)
    targetIds.add(string(edge.target_id, `path_proofs[${proofIndex}].edges[0].target_id`))
  }

  if (proofs.length !== EXPECTED.targetIds.length || EXPECTED.targetIds.some((id) => !targetIds.has(id))) {
    throw new F36ExplorerProjectionError(
      'F36_PROJECTION_SOURCE_INVALID',
      422,
      `Expected exact SPARTA targets ${EXPECTED.targetIds.join(', ')}; received ${[...targetIds].sort().join(', ')}`,
    )
  }

  const sourceFileSha256 = sha256Text(raw)
  const projectionFingerprint = sha256Text(JSON.stringify({
    source_file_sha256: sourceFileSha256,
    family_evidence_case_snapshot_id: snapshot.family_evidence_case_snapshot_id,
    snapshot_content_hash: snapshot.snapshot_content_hash,
    input_fingerprint: snapshot.input_fingerprint,
    requirement_revision_id: requirement.requirement_revision_id,
    requirement_content_hash: requirement.requirement_content_hash,
    engineering_qra_family_id: family.engineering_qra_family_id,
    canonical_answer_hash: family.canonical_answer_hash,
    evidence_verdict: snapshot.evidence_verdict,
    review_state: snapshot.review_state,
    accepted: snapshot.accepted,
    quarantine_state: snapshot.quarantine_state,
    binding_registry_state: snapshot.binding_registry_state,
    sparta_release_id: pathResolution.sparta_release_id,
    sparta_release_hash: pathResolution.sparta_release_hash,
    path_signatures: proofs.map((proof) => proof.path_signature),
    variant_evidence_runs: family.variant_evidence_runs,
  }))

  return {
    schema: 'f36.explorer_shared_projection.v1',
    projection_fingerprint: projectionFingerprint,
    source: {
      path: sourcePath,
      source_file_sha256: sourceFileSha256,
      family_evidence_case_snapshot_id: EXPECTED.snapshotId,
      snapshot_content_hash: EXPECTED.snapshotContentHash,
      input_fingerprint: EXPECTED.inputFingerprint,
      modified_at: sourceStat.mtime.toISOString(),
      age_ms: Math.max(0, Math.round(ageMs)),
      stale: false,
      live: true,
      mocked: false,
    },
    requirement: {
      requirement_id: EXPECTED.requirementId,
      requirement_revision_id: EXPECTED.requirementRevisionId,
      requirement_content_hash: EXPECTED.requirementContentHash,
      primary_component_family_id: EXPECTED.componentFamilyId,
    },
    engineering_qra_family: {
      engineering_qra_family_id: EXPECTED.familyId,
      canonical_question: string(family.canonical_question, 'engineering_qra_family.canonical_question'),
      canonical_answer: answer,
      canonical_answer_hash: EXPECTED.canonicalAnswerHash,
      canonical_intent: intent,
      variant_count: 5,
      variant_evidence_runs: 0,
    },
    evidence_verdict: 'INCONCLUSIVE',
    family_disposition: 'unresolved_evidence',
    applicability,
    review_state: 'pending',
    accepted: false,
    quarantine_state: 'quarantined_pending_human_review',
    binding_registry_state: 'not_promoted',
    crosswalk_resolution_state: 'exact_path',
    projection_eligibility: {
      candidate_review_mode: true,
      reviewed_default_mode: false,
      posture_grounding_numerator: false,
      supply_chain_sparta_overlay: false,
    },
    path_resolution: {
      sparta_release_id: EXPECTED.releaseId,
      sparta_release_hash: EXPECTED.releaseHash,
      path_proofs: proofs,
    },
    posture: {
      assessed_requirements: 1,
      applicable_requirements: 1,
      pending_review_requirements: 1,
      grounded_numerator: 0,
      compliance_credit: 0,
    },
    supply_chain: {
      engineering_lineage_available: false,
      reviewed_sparta_overlay: false,
      state: 'no_reviewed_supply_chain_overlay',
    },
    authority: {
      state: 'agent_candidate_pending_human_review',
      operational_authority: false,
      implementation_credit: 0,
      compliance_credit: 0,
      path_proofs_are_traceability_only: true,
    },
    consumer_fingerprints: {
      threat_matrix: projectionFingerprint,
      posture: projectionFingerprint,
      supply_chain: projectionFingerprint,
      chat: projectionFingerprint,
    },
  }
}
