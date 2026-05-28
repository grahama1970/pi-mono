import type { TabName } from './SpartaExplorer'

export type PagePurposeState = 'pass' | 'fail' | 'degraded'

export type PagePurposeContract = {
  id: string
  label: string
  group: 'compliance' | 'maintenance' | 'analysis' | 'operations' | 'operator'
  owner: string
  primaryObject: string
  purpose: string
  sourceOfTruth: string
  monitorPredicates: string[]
  interactionProof: string[]
  dashboardTheaterControls: string[]
  state: PagePurposeState
  stateReason: string
  stateEvidenceArtifacts: string[]
  nextStateAction: string
  tab?: TabName
}

export const PAGE_PURPOSE_CONTRACTS: PagePurposeContract[] = [
  {
    id: 'sparta-chat',
    label: 'Sparta Chat',
    group: 'operator',
    owner: 'Active operator/persona',
    primaryObject: 'Evidence-gated conversation turn',
    purpose: 'Answer, clarify, or deflect under the selected profile with an inspectable evidence case.',
    sourceOfTruth: 'Profile registry, memory recall, evidence cases, controls, QRAs, source artifacts, monitor health.',
    monitorPredicates: ['CHAT_EVIDENCE_BINDING', 'CHAT_NO_BARE_ASSERTION', 'ASK_REVIEW_RECEIPT_ADMISSIBLE'],
    interactionProof: ['Ask compliance question', 'Inspect cited evidence case', 'Navigate citation to source'],
    dashboardTheaterControls: ['No unsupported compliance answers', 'No signoff answer without evidence case'],
    state: 'fail',
    stateReason:
      'Phase58 proved fail-closed Evidence Workspace gates on the demo route, but production chat turns still lack instrumented evidence-case binding, citation persistence, and deflection predicates across refresh/navigation.',
    stateEvidenceArtifacts: [
      'phase-58-evidence-workspace-production-gates/evidence-artifacts/evidence-workspace-production-gates/summary.json',
      'phase-51-sparta-page-purpose-persona-review-after-workflow-proof/reviews/20260527T185917Z-ask-phase51-post-phase49-persona-review-response.md',
    ],
    nextStateAction: 'Instrument chat turns against evidence-case, citation, and deflection predicates before any pass state.',
  },
  {
    id: 'evidence-workspace',
    label: 'Evidence Workspace',
    group: 'compliance',
    owner: 'Assessor/reviewer/operator',
    primaryObject: 'Evidence case',
    purpose: 'Inspect proof chains, gates, source support, diagnostics, and reviewer actions.',
    sourceOfTruth: 'Evidence-case store, source artifacts, provenance, freshness, reviewer state.',
    monitorPredicates: ['PROOF_CHAIN_CONTIGUITY', 'ARTIFACT_IMMUTABILITY'],
    interactionProof: ['Open evidence case', 'Inspect gate results', 'Quarantine/request re-extraction'],
    dashboardTheaterControls: ['No proof status without source lineage', 'No mutable source display'],
    state: 'degraded',
    stateReason:
      'Phase58 proved source-level and rendered fail-closed gates (draft-only, disabled approve/reject, preview-only export, raw diagnostics), but human approval persistence and immutable backend write-once storage are not proven.',
    stateEvidenceArtifacts: [
      'phase-58-evidence-workspace-production-gates/evidence-artifacts/evidence-workspace-production-gates/summary.json',
      'phase-58-evidence-workspace-production-gates/evidence-artifacts/ui-verification-latest.json',
    ],
    nextStateAction: 'Add production gate predicates for proof chain, immutable artifacts, and reviewer disposition actions.',
  },
  {
    id: 'posture',
    label: 'Posture',
    tab: 'Posture',
    group: 'compliance',
    owner: 'Brandon',
    primaryObject: 'F-36 finding/evidence/risk/POA&M/signoff item',
    purpose: 'Adjudicate machine-identified compliance candidates into defensible dispositions.',
    sourceOfTruth: 'F-36 obligations, evidence cases, findings, POA&M records, risk acceptance, authority records.',
    monitorPredicates: [
      'POSTURE_PRIMARY_OBJECT_IS_FINDING',
      'POSTURE_F36_CONTROL_BOUNDARY',
      'POSTURE_FINDING_HAS_EVIDENCE_CASE',
      'POSTURE_POAM_HAS_OWNER_DUE_DATE',
    ],
    interactionProof: ['Select finding', 'Inspect mapped evidence case', 'Confirm/reject/request evidence/assign remediation'],
    dashboardTheaterControls: [
      'Bare CWE/control IDs are metadata only',
      'F-36 is a demo profile, not a replacement for native cybersecurity frameworks',
      'Scores cannot override unresolved evidence cases',
    ],
    state: 'degraded',
    stateReason:
      'Phase55 proved the Posture surface frames F-36 finding/evidence/risk/POA&M items with CWE/control IDs as metadata only; the selected scope remains correctly fail-closed as not signoff-ready.',
    stateEvidenceArtifacts: [
      'phase-55-posture-f36-authority-boundary-proof/evidence-artifacts/posture-authority-boundary/summary.json',
      'phase-41-sparta-posture-f36-finding-semantics/evidence-artifacts/posture-f36-semantics/summary.json',
    ],
    nextStateAction: 'Prove Brandon can adjudicate F-36 obligation/finding/evidence/risk items without treating CWE/control IDs as signoff objects.',
  },
  {
    id: 'coverage',
    label: 'Coverage',
    tab: 'Coverage',
    group: 'maintenance',
    owner: 'Nico',
    primaryObject: 'Corpus readiness gap or framework inventory item',
    purpose: 'Maintain readiness truth for corpus, QRA, source, prompt, monitor, and UX lanes.',
    sourceOfTruth: '$monitor-sparta, memory/Arango/Qdrant, source/QRA/control coverage artifacts.',
    monitorPredicates: ['CORPUS_READINESS_TRUTH', 'NO_GAP_CONCEALMENT', 'PHASE43_BACKLOG_PRESERVED'],
    interactionProof: ['Select corpus gap', 'Show downstream impact', 'Write repair manifest'],
    dashboardTheaterControls: ['No aggregate-only readiness claims', 'Every percentage must drill down to missing items'],
    state: 'fail',
    stateReason: 'Coverage dogpile is explicitly degraded and corpus readiness predicates are not yet instrumented into page state.',
    stateEvidenceArtifacts: ['phase-48-sparta-page-purpose-completion-audit/evidence-artifacts/coverage-dogpile-rerun-partial-results.json', 'phase-51-sparta-page-purpose-persona-review-after-workflow-proof/reviews/20260527T184922Z/review.md'],
    nextStateAction: 'Bind Coverage state to monitor-sparta corpus inventory, gap rows, and downstream consumer impact.',
  },
  {
    id: 'threat-matrix',
    label: 'Threat Matrix',
    tab: 'Threat Matrix',
    group: 'analysis',
    owner: 'Cyber analyst/operator',
    primaryObject: 'Threat-technique-control-countermeasure relationship/path',
    purpose: 'Explore mission-relevant threat and countermeasure relationships with evidence.',
    sourceOfTruth: 'ATT&CK, CAPEC, CWE, D3FEND, SPARTA mappings, evidence cases, mission context.',
    monitorPredicates: ['TECHNIQUE_CONTROL_EVIDENCE_BINDING', 'NO_LOOSE_ASSOCIATION'],
    interactionProof: ['Select threat', 'Inspect technique evidence', 'Trace mapped controls/countermeasures'],
    dashboardTheaterControls: ['No static heatmap without evidence', 'No relationship without provenance'],
    state: 'degraded',
    stateReason:
      'Phase56 recorded MITRE ATT&CK/Navigator comparison criteria and Phase49 workflow anchors exist, but relationship paths are not yet gated by integrated external acceptance predicates in the live UI.',
    stateEvidenceArtifacts: [
      'phase-56-external-product-comparison-integration/evidence-artifacts/external-product-comparison/summary.json',
      'phase-49-sparta-page-workflow-proof-expansion/captures/page-purpose-deep-pass/results.json',
    ],
    nextStateAction: 'Integrate external comparison criteria and require evidence-bound relationship paths before pass.',
  },
  {
    id: 'controls',
    label: 'Controls',
    tab: 'Controls',
    group: 'maintenance',
    owner: 'Nico',
    primaryObject: 'Framework-native control',
    purpose: 'Maintain canonical controls, native source text, relationships, mappings, and quality state.',
    sourceOfTruth: 'Official/imported framework source text, canonical control DB, source provenance, relationship graph.',
    monitorPredicates: ['NATIVE_CONTROL_PROVENANCE', 'NO_ABSTRACT_IMPLEMENTATION'],
    interactionProof: ['Select control', 'Show native text', 'Inspect mapping evidence'],
    dashboardTheaterControls: ['No bare control IDs without source text', 'No mapping count without relationship evidence'],
    state: 'degraded',
    stateReason: 'Controls has page-purpose anchors, but native provenance and mapping evidence predicates are not yet page-state gates.',
    stateEvidenceArtifacts: ['phase-49-sparta-page-workflow-proof-expansion/captures/page-purpose-deep-pass/results.json'],
    nextStateAction: 'Gate control page state on native text availability, source provenance, and relationship evidence drills.',
  },
  {
    id: 'qras',
    label: 'QRAs',
    tab: 'QRAs',
    group: 'maintenance',
    owner: 'Nico + QRA reviewer',
    primaryObject: 'QRA artifact',
    purpose: 'Manage candidate/review/blessing/quarantine/regression trust states.',
    sourceOfTruth: 'QRA store, evidence-case results, trust-state ledger, reviewer decisions.',
    monitorPredicates: ['QRA_TRUST_STATE_CONSISTENCY', 'QRA_EVIDENCE_CASE_BINDING', 'PHASE43_QID_BACKLOG_VISIBLE'],
    interactionProof: ['Open QRA', 'Inspect evidence case', 'Accept/reject/retain adversarial with reason'],
    dashboardTheaterControls: ['No generated-count readiness', 'Trust state must be explicit'],
    state: 'degraded',
    stateReason:
      'Phase54 triaged QRA vs COTS/QID backlogs (8,107 raw comparison candidates, 315 gated, 925 course-corrected surfaces), but Explorer QRAs UI still does not expose all trust-state distinctions as deterministic page-state gates.',
    stateEvidenceArtifacts: [
      'phase-54-cots-qid-backlog-triage/evidence-artifacts/cots-qid-backlog-triage.json',
      'phase-51-sparta-page-purpose-persona-review-after-workflow-proof/reviews/20260527T185917Z-ask-phase51-post-phase49-persona-review-response.md',
    ],
    nextStateAction: 'Expose QRA trust-state rows, evidence-case bindings, and COTS/QID backlog triage predicates.',
  },
  {
    id: 'sources',
    label: 'Sources',
    tab: 'Sources',
    group: 'maintenance',
    owner: 'Nico',
    primaryObject: 'Source corpus artifact',
    purpose: 'Maintain source inventory, extraction quality, lineage, and downstream evidence impact.',
    sourceOfTruth: 'Source registry, extraction artifacts, source availability state, chunk lineage.',
    monitorPredicates: ['SOURCE_EXTRACTION_LINEAGE', 'SOURCE_DOWNSTREAM_IMPACT'],
    interactionProof: ['Open source', 'Inspect extraction state', 'Trace chunks/QRAs/controls'],
    dashboardTheaterControls: ['No source health without lineage', 'No availability status without fetch evidence'],
    state: 'degraded',
    stateReason: 'Sources has rendered anchors, but source lineage and downstream impact are not yet deterministic state predicates.',
    stateEvidenceArtifacts: ['phase-49-sparta-page-workflow-proof-expansion/captures/page-purpose-deep-pass/results.json'],
    nextStateAction: 'Gate source state on extraction lineage, availability evidence, and downstream chunk/QRA/control impact.',
  },
  {
    id: 'urls',
    label: 'URLs',
    tab: 'URLs',
    group: 'maintenance',
    owner: 'Nico',
    primaryObject: 'Provenance URL record',
    purpose: 'Maintain URL availability, extraction quality, complete clean text, lineage, and downstream evidence impact.',
    sourceOfTruth: 'URL registry, fetch/extraction artifacts, clean text, chunk lineage, source availability state.',
    monitorPredicates: ['URL_CLEAN_TEXT_IDENTITY', 'URL_COMPLETE_CLEAN_TEXT', 'URL_WRONG_CONTENT_FAIL_CLOSED', 'URL_DOWNSTREAM_LINEAGE'],
    interactionProof: ['Select URL', 'Inspect complete clean content', 'Verify identity warning/quarantine'],
    dashboardTheaterControls: ['No clean text from mismatched URL', 'No truncated clean content in detail pane'],
    state: 'degraded',
    stateReason:
      'Phase52 recovered SecurityWeek url_id 1007 clean content and knowledge chunks; Phase59 re-embedded all six chunks into Qdrant with matching hashes. This closes the demonstrated identity case but is not a full URL-corpus audit.',
    stateEvidenceArtifacts: [
      'phase-52-url-clean-content-authoritative-recovery/validation-logs/securityweek-post-recovery-db-proof.json',
      'phase-59-semantic-reembedding-securityweek-url-knowledge/evidence-artifacts/securityweek-semantic-sync-apply.json',
    ],
    nextStateAction: 'Add corpus-wide URL identity predicates and re-embed recovered SecurityWeek chunks before pass.',
  },
  {
    id: 'supply-chain',
    label: 'Supply Chain',
    tab: 'Supply Chain',
    group: 'analysis',
    owner: 'Mission-assurance risk analyst',
    primaryObject: 'Vendor/component/dependency/control/threat/evidence relationship',
    purpose: 'Trace dependency and mitigation evidence into mission risk decisions.',
    sourceOfTruth: 'SBOM/VEX, vendor/procurement records, dependency graph, threat/control/evidence sources.',
    monitorPredicates: ['SUPPLY_CHAIN_LINEAGE', 'SBOM_VEX_EVIDENCE_BINDING'],
    interactionProof: ['Select component/vendor', 'Trace dependency evidence', 'Inspect mitigation/control binding'],
    dashboardTheaterControls: ['No vendor score without lineage', 'No dependency risk without evidence path'],
    state: 'degraded',
    stateReason:
      'Phase56 recorded Dependency-Track/GUAC/SLSA comparison criteria and Phase49 workflow anchors exist, but vendor/component/dependency lineage predicates are not yet integrated as live page-state gates.',
    stateEvidenceArtifacts: [
      'phase-56-external-product-comparison-integration/evidence-artifacts/external-product-comparison/summary.json',
      'phase-49-sparta-page-workflow-proof-expansion/captures/page-purpose-deep-pass/results.json',
    ],
    nextStateAction: 'Define external comparison and lineage predicates for vendor/component/dependency/control/threat/evidence paths.',
  },
  {
    id: 'monitor-status',
    label: 'Monitor / Status',
    group: 'operations',
    owner: 'SPARTA operator/SRE',
    primaryObject: '$monitor-sparta health contract/status envelope',
    purpose: 'Expose current, stale, blocked, regressed, or unknown monitor state with safe next actions.',
    sourceOfTruth: '$monitor-sparta health/status outputs, regression reports, manifests, freshness markers.',
    monitorPredicates: ['MONITOR_SNAPSHOT_FRESHNESS', 'MONITOR_FAIL_CLOSED_STATE'],
    interactionProof: ['Inspect snapshot age', 'Open failing lane', 'Run/queue safe refresh action'],
    dashboardTheaterControls: ['No live status from stale snapshot', 'No healthy state without last durable monitor output'],
    state: 'degraded',
    stateReason:
      'Phase57 proved Coverage-embedded Monitor/Status binds visible live status to /api/sparta/coverage-health and /api/sparta/supervisor-state with fail-closed fragments; not every monitor-sparta lane is proven healthy.',
    stateEvidenceArtifacts: [
      'phase-57-monitor-status-rendering-contract/evidence-artifacts/monitor-status-contract/summary.json',
      'phase-57-monitor-status-rendering-contract/evidence-artifacts/ui-verification-latest.json',
    ],
    nextStateAction: 'Bind Monitor/Status rendering to durable monitor-sparta snapshot freshness and fail-closed backend contract.',
  },
]

export const TAB_PURPOSE_CONTRACTS = Object.fromEntries(
  PAGE_PURPOSE_CONTRACTS.filter((contract): contract is PagePurposeContract & { tab: TabName } => Boolean(contract.tab))
    .map((contract) => [contract.tab, contract]),
) as Record<TabName, PagePurposeContract>
