import { createHash } from 'crypto'
import { readFile, stat } from 'fs/promises'
import { loadF36ExplorerProjection, type F36ExplorerProjection } from './f36ExplorerProjection.js'

const REQUIREMENTS_PATH = process.env.F36_REQUIREMENTS_PATH
  ?? '/home/graham/workspace/experiments/sparta/f36-living-datalake/F36-SYN-MISSION-COMPUTER-UPDATE-CHAIN/requirements/r3/requirements.r3.candidate.json'
const COMPONENTS_PATH = process.env.F36_COMPONENTS_PATH
  ?? '/home/graham/workspace/experiments/sparta/f36-living-datalake/F36-SYN-MISSION-COMPUTER-UPDATE-CHAIN/architecture/component-requirements-baseline-r2.candidate.json'

// Source records are validated at their authority boundaries before projection.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRecord = Record<string, any>

export class F36ExplorerReadModelError extends Error {
  readonly statusCode = 503

  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'F36ExplorerReadModelError'
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonRecord)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function requirementContentHash(requirement: JsonRecord): string {
  const material = Object.fromEntries([
    'requirement_id', 'title', 'statement', 'rationale', 'major_system_id',
    'subsystem_id', 'component_family_id', 'requirement_type',
    'verification_method', 'verification_artifact_types', 'lifecycle_phase_ids',
  ].map((key) => [key, requirement[key] ?? null]))
  return sha256(canonical(material))
}

function parseObject(raw: string, label: string): JsonRecord {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root is not an object')
    return parsed
  } catch (error) {
    throw new F36ExplorerReadModelError('F36_READ_MODEL_SOURCE_INVALID', `${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function readStable(path: string, label: string) {
  try {
    const before = await stat(path)
    const raw = await readFile(path, 'utf8')
    const after = await stat(path)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new F36ExplorerReadModelError('F36_READ_MODEL_SOURCE_CHANGED', `${label} changed while it was being read`)
    }
    return { path, raw, parsed: parseObject(raw, label), sha256: sha256(raw), modified_at: after.mtime.toISOString() }
  } catch (error) {
    if (error instanceof F36ExplorerReadModelError) throw error
    throw new F36ExplorerReadModelError('F36_READ_MODEL_SOURCE_MISSING', `${label} is unavailable at ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function requireArray(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value)) throw new F36ExplorerReadModelError('F36_READ_MODEL_SOURCE_INVALID', `${label} must be an array`)
  return value as JsonRecord[]
}

function deriveComponents(source: JsonRecord) {
  return requireArray(source.major_systems, 'major_systems').flatMap((major) =>
    requireArray(major.subsystems, `${major.id}.subsystems`).flatMap((subsystem) =>
      requireArray(subsystem.leaf_component_families, `${subsystem.id}.leaf_component_families`).map((component) => ({
        component_family_id: String(component.id),
        name: String(component.name),
        major_system_id: String(major.id),
        subsystem_id: String(subsystem.id),
        requirement_total: Number(component.total ?? 0),
        state: component.state ? String(component.state) : 'active',
        superseded_by_component_family_ids: Array.isArray(component.superseded_by_component_family_ids)
          ? component.superseded_by_component_family_ids.map(String)
          : [],
      })),
    ),
  )
}

function deriveCandidateOverlays(canary: F36ExplorerProjection) {
  return canary.path_resolution.path_proofs.map((proof) => {
    const edge = proof.edges[0]
    const target = (proof.nodes as JsonRecord[]).find((node) => node.control_id === edge.target_id || node.id === edge.target_id)
    return {
      requirement_id: canary.requirement.requirement_id,
      requirement_revision_id: canary.requirement.requirement_revision_id,
      requirement_content_hash: canary.requirement.requirement_content_hash,
      component_family_id: canary.requirement.primary_component_family_id,
      sparta_control_id: edge.target_id,
      sparta_control_name: target?.name ?? target?.label ?? edge.target_id,
      source_control_id: edge.source_id,
      persisted_edge_id: proof.persisted_edge_ids[0],
      path_signature: proof.path_signature,
      review_state: canary.review_state,
      accepted: canary.accepted,
      authority_state: proof.authority_state,
      coverage_state: 'partial',
      gap_state: 'candidate_pending_review',
      exists_in_sparta_corpus: Boolean(target),
      closure_action: 'review_candidate_path',
      compliance_credit: 0,
    }
  }).sort((a, b) => a.sparta_control_id.localeCompare(b.sparta_control_id))
}

const actorTemplates = [
  {
    actor_template_id: 'opportunistic_low_capability',
    label: 'Opportunistic / script-kiddie',
    capability: 'low',
    intent: 'opportunistic disruption or exploration',
    targeting: 'broad_non_specific',
    authority: 'analytic_template_only',
  },
  {
    actor_template_id: 'cybercriminal_or_contractor',
    label: 'Cybercriminal / contractor',
    capability: 'moderate',
    intent: 'financial gain, access resale, or supply-chain leverage',
    targeting: 'sector_or_program_opportunistic',
    authority: 'analytic_template_only',
  },
  {
    actor_template_id: 'insider_or_maintainer_misuse',
    label: 'Insider / maintainer misuse',
    capability: 'privileged_local_context',
    intent: 'misuse, sabotage, unauthorized change, or coercion',
    targeting: 'component_or_system_specific',
    authority: 'analytic_template_only',
  },
  {
    actor_template_id: 'advanced_persistent_or_state_aligned',
    label: 'Advanced persistent / state-aligned',
    capability: 'high',
    intent: 'espionage, pre-positioning, mission degradation, or strategic effect',
    targeting: 'specific_mission_program_or_supply_chain',
    authority: 'analytic_template_only',
  },
]

function actorApplicabilityForOverlay(overlay: ReturnType<typeof deriveCandidateOverlays>[number]) {
  const shared = {
    target_kind: 'candidate_control',
    target_id: overlay.sparta_control_id,
    target_name: overlay.sparta_control_name,
    gap_state: overlay.gap_state,
    classification_authority: 'analytic_template_only',
    coverage_credit: 0,
    source_refs: [
      `sparta_control:${overlay.sparta_control_id}`,
      `path_signature:${overlay.path_signature}`,
      'nist:threat_source_capability_intent_targeting',
    ],
  }

  const relevant = (actor_template_id: string, priority_band: string, basis_codes: string[]) => ({
    ...shared,
    actor_template_id,
    applicability: 'RELEVANT',
    priority_band,
    basis_codes,
  })
  const unknown = (actor_template_id: string, basis_codes: string[] = ['no_actor_specific_evidence']) => ({
    ...shared,
    actor_template_id,
    applicability: 'UNKNOWN',
    priority_band: 'unranked',
    basis_codes,
  })

  if (overlay.sparta_control_id === 'DE-0012') {
    return [
      unknown('opportunistic_low_capability', ['component_collusion_requires_coordination_beyond_basic_template']),
      relevant('cybercriminal_or_contractor', 'P2', ['supply_chain_leverage', 'multi_component_coordination']),
      relevant('insider_or_maintainer_misuse', 'P1', ['component_access', 'concealment_coordination']),
      relevant('advanced_persistent_or_state_aligned', 'P1', ['stealthy_multi_component_coordination', 'mission_specific_targeting']),
    ]
  }
  if (overlay.sparta_control_id === 'EX-0001.02') {
    return [
      unknown('opportunistic_low_capability', ['internal_bus_context_not_established_for_low_capability_actor']),
      unknown('cybercriminal_or_contractor', ['no_financial_or_access_resale_basis_in_candidate_path']),
      relevant('insider_or_maintainer_misuse', 'P1', ['internal_commanding_context', 'replay_or_sequence_abuse']),
      relevant('advanced_persistent_or_state_aligned', 'P1', ['mission_degradation_potential', 'internal_bus_replay']),
    ]
  }
  if (overlay.sparta_control_id === 'PER-0005') {
    return [
      unknown('opportunistic_low_capability', ['valid_credential_access_not_established_for_low_capability_actor']),
      relevant('cybercriminal_or_contractor', 'P1', ['credentialed_access', 'access_resale_or_persistence']),
      relevant('insider_or_maintainer_misuse', 'P1', ['privileged_account_context', 'credential_lifecycle_gap']),
      relevant('advanced_persistent_or_state_aligned', 'P1', ['persistent_access', 'stealthy_follow_on_operations']),
    ]
  }
  return actorTemplates.map((template) => unknown(template.actor_template_id, ['no_template_rule_for_candidate_control']))
}

function unknownRequirementBucket(count: number) {
  return actorTemplates.map((template) => ({
    target_kind: 'unclassified_requirement_bucket',
    target_id: 'UNKNOWN_NO_SPARTA_TARGET',
    target_name: 'F36 requirements without extracted SPARTA target',
    actor_template_id: template.actor_template_id,
    applicability: 'UNKNOWN',
    priority_band: 'unranked',
    basis_codes: ['no_extracted_sparta_target', 'do_not_infer_actor_priority_without_technique_mapping'],
    source_refs: ['f36_requirements:r3_candidate'],
    classification_authority: 'analytic_template_only',
    coverage_credit: 0,
    requirement_count: count,
  }))
}

export async function loadF36ExplorerReadModels() {
  const [requirementsSource, componentsSource, canary] = await Promise.all([
    readStable(REQUIREMENTS_PATH, 'F36 R3 requirements'),
    readStable(COMPONENTS_PATH, 'F36 R2 component hierarchy'),
    loadF36ExplorerProjection(),
  ])

  const requirements = requireArray(requirementsSource.parsed.requirements, 'requirements')
  const components = deriveComponents(componentsSource.parsed)
  const ids = new Set<string>()
  const revisions = new Set<string>()
  for (const requirement of requirements) {
    const id = String(requirement.requirement_id ?? '')
    const revision = String(requirement.traceability?.supersession?.revision_id ?? '')
    if (!id || !revision || ids.has(id) || revisions.has(revision)) {
      throw new F36ExplorerReadModelError('F36_READ_MODEL_CORPUS_INVARIANT_FAILED', `Duplicate or missing requirement identity at ${id || '<missing>'}`)
    }
    ids.add(id)
    revisions.add(revision)
  }

  const canaryRequirement = requirements.find((item) => item.requirement_id === canary.requirement.requirement_id)
  if (!canaryRequirement || requirementContentHash(canaryRequirement) !== canary.requirement.requirement_content_hash) {
    throw new F36ExplorerReadModelError('F36_READ_MODEL_CANARY_MISMATCH', 'The replay canary does not match the active R3 requirement corpus')
  }

  const candidateOverlays = deriveCandidateOverlays(canary)
  const reviewedRequirements = requirements.filter((item) => item.review_state === 'reviewed' || item.approved_sparta_edge_ids?.length || item.accepted_evidence_case_ids?.length)
  const supplyRequirements = requirements.filter((item) => item.requirement_type === 'supply_chain_provenance')
  const mappedRequirementIds = new Set(candidateOverlays.map((item) => item.requirement_id))
  const mappedComponentIds = new Set(candidateOverlays.map((item) => item.component_family_id))
  const activeComponents = new Set(requirements.map((item) => String(item.component_family_id)))
  const counts = {
    requirements_total: requirements.length,
    requirements_candidate: requirements.filter((item) => item.review_state === 'candidate').length,
    requirements_reviewed: reviewedRequirements.length,
    requirements_candidate_mapped: mappedRequirementIds.size,
    requirements_reviewed_mapped: 0,
    requirements_mapped_any: mappedRequirementIds.size,
    requirements_unmapped: requirements.length - mappedRequirementIds.size,
    candidate_paths: candidateOverlays.length,
    reviewed_paths: 0,
    component_families_total: components.length,
    component_families_with_requirements: activeComponents.size,
    component_families_candidate_mapped: mappedComponentIds.size,
    component_families_reviewed_mapped: 0,
    supply_chain_provenance_requirements: supplyRequirements.length,
    compliance_credit: 0,
  }
  if (counts.requirements_total !== 3680 || counts.component_families_total !== 74 || counts.supply_chain_provenance_requirements !== 272) {
    throw new F36ExplorerReadModelError('F36_READ_MODEL_CORPUS_INVARIANT_FAILED', `Unexpected corpus counts: ${canonical(counts)}`)
  }

  const countsFingerprint = sha256(canonical(counts))
  const projectionFingerprint = sha256(canonical({
    requirements_source_sha256: requirementsSource.sha256,
    components_source_sha256: componentsSource.sha256,
    canary_projection_fingerprint: canary.projection_fingerprint,
    requirement_revisions: [...revisions].sort(),
    component_ids: components.map((item) => item.component_family_id).sort(),
    candidate_overlays: candidateOverlays,
    counts,
  }))
  const threatMatrixReconciliation = {
    schema: 'f36.threat_matrix_reconciliation.v1',
    basis: 'F36 candidate target controls reconciled against the loaded SPARTA corpus release',
    sparta_release_id: canary.path_resolution.sparta_release_id,
    sparta_release_hash: canary.path_resolution.sparta_release_hash,
    status_counts: {
      covered: 0,
      partial: candidateOverlays.length,
      missing_coverage: 0,
      specified_absent_from_sparta_corpus: 0,
      unspecified_requirements: counts.requirements_unmapped,
    },
    actor_templates: actorTemplates,
    candidate_target_controls: candidateOverlays.map((overlay) => ({
      requirement_id: overlay.requirement_id,
      requirement_revision_id: overlay.requirement_revision_id,
      component_family_id: overlay.component_family_id,
      sparta_control_id: overlay.sparta_control_id,
      sparta_control_name: overlay.sparta_control_name,
      coverage_state: overlay.coverage_state,
      gap_state: overlay.gap_state,
      exists_in_sparta_corpus: overlay.exists_in_sparta_corpus,
      review_state: overlay.review_state,
      accepted: overlay.accepted,
      authority_state: overlay.authority_state,
      compliance_credit: overlay.compliance_credit,
      closure_action: overlay.closure_action,
      closure_target: overlay.path_signature,
    })),
    absent_from_sparta_corpus: [],
    actor_applicability: [
      ...candidateOverlays.flatMap(actorApplicabilityForOverlay),
      ...unknownRequirementBucket(counts.requirements_unmapped),
    ],
    closure_backlog: [
      {
        gap_state: 'candidate_pending_review',
        count: candidateOverlays.length,
        next_action: 'Review each persisted candidate path; promote accepted paths to reviewed evidence or reject them with a reason.',
      },
      {
        gap_state: 'f36_requirement_without_sparta_target',
        count: counts.requirements_unmapped,
        next_action: 'Extract and adjudicate SPARTA target controls for unmapped F36 requirements before treating them as matrix coverage gaps.',
      },
    ],
  }
  const common = {
    projection_fingerprint: projectionFingerprint,
    counts_fingerprint: countsFingerprint,
    counts,
    synthetic: true,
    synthetic_disclosure: requirementsSource.parsed.synthetic_disclosure,
    operational_authority: false,
    live: true,
    mocked: false,
    sources: {
      requirements: { path: requirementsSource.path, sha256: requirementsSource.sha256, modified_at: requirementsSource.modified_at, schema: requirementsSource.parsed.schema, revision_id: requirementsSource.parsed.revision_id },
      components: { path: componentsSource.path, sha256: componentsSource.sha256, modified_at: componentsSource.modified_at, schema: componentsSource.parsed.schema, version: componentsSource.parsed.version },
      canary: canary.source,
    },
  }

  const projection = {
    schema: 'f36.explorer_shared_projection.v2',
    ...common,
    component_families: components,
    candidate_overlays: candidateOverlays,
    canary_projection: canary,
  }
  const posture = {
    schema: 'f36.explorer_posture_read_model.v1',
    ...common,
    readiness: 'NOT_READY',
    reason_codes: ['NO_REVIEWED_F36_SPARTA_BINDINGS', 'NO_ACCEPTED_F36_EVIDENCE_CASES', 'CANDIDATE_CANARY_PENDING_REVIEW'],
    grounded_requirements: 0,
    accepted_evidence_cases: 0,
    candidate_canary: { requirement_revision_id: canary.requirement.requirement_revision_id, mapped_controls: candidateOverlays.map((item) => item.sparta_control_id), review_state: canary.review_state },
  }
  const threatMatrix = {
    schema: 'f36.explorer_threat_matrix_read_model.v1',
    ...common,
    reconciliation: threatMatrixReconciliation,
    candidate_overlays: candidateOverlays,
    reviewed_overlays: [],
    canary_projection: canary,
  }
  const supplyChain = {
    schema: 'f36.explorer_supply_chain_read_model.v1',
    ...common,
    requirement_rows: supplyRequirements.map((item) => ({
      requirement_id: item.requirement_id,
      requirement_revision_id: item.traceability?.supersession?.revision_id,
      requirement_content_hash: requirementContentHash(item),
      component_family_id: item.component_family_id,
      title: item.title,
      statement: item.statement,
      review_state: item.review_state,
    })),
    requirement_component_edges: supplyRequirements.map((item) => ({ source_id: item.requirement_id, target_id: item.component_family_id, relationship_type: 'allocated_to_component_family' })),
    instance_lineage: {
      state: 'ABSENT',
      missing_node_types: ['supplier', 'facility', 'lot', 'sbom', 'binary', 'distribution', 'installation'],
      fabricated_nodes: 0,
    },
    reviewed_sparta_overlay: [],
  }
  return { projection, posture, threatMatrix, supplyChain }
}
