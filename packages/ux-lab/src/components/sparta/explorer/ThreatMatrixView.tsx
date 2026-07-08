/**
 * ThreatMatrixView — Explorer-specific provider for the shared ThreatMatrix.
 *
 * This is a thin wrapper that handles data fetching from the memory daemon
 * and injects state/actions/meta into the shared compound component.
 * The UI rendering is 100% owned by ThreatMatrix.* — this file only owns data.
 *
 * Pattern: composition-patterns/state-decouple-implementation
 */
import { useState, useEffect, useCallback } from 'react'
import { ThreatMatrix } from '../shared/ThreatMatrix'
import type { ThreatTechnique, ThreatTactic, TechniqueDetail, ThreatMatrixState, ThreatMatrixActions, ThreatMatrixMeta, DatalakeOption, TraceabilityChunk, EvidenceCase, ThreatRelationship } from '../shared/ThreatMatrix'
import { API_ORIGIN, MEMORY_API_ROOT } from '../../../lib/apiBase'
import { PageDistanceRoot, usePageDistanceMode } from './pageDistance/PageDistanceMode'
import { deriveCoveragePagePurposeState, type CoverageHealthSnapshot } from './pagePurposeContracts'
import { ThreatMatrixDistanceShell } from './pageDistance/ThreatMatrixDistanceViews'
import { useMatrixCuration } from './matrixCurationContext'

const DAEMON = MEMORY_API_ROOT
const COVERAGE_HEALTH_CACHE_KEY = 'sparta.coverageHealth.lastPayload'

function readCoverageHealthCache(): CoverageHealthSnapshot | null {
  try {
    const raw = localStorage.getItem(COVERAGE_HEALTH_CACHE_KEY)
    return raw ? (JSON.parse(raw) as CoverageHealthSnapshot) : null
  } catch {
    return null
  }
}

function readInitialThreatMatrixViewMode(): ThreatMatrixState['viewMode'] {
  if (typeof window === 'undefined') return 'standard'
  const mode = new URLSearchParams(window.location.search).get('matrixView')
  return mode === 'graph' || mode === 'bloom' || mode === 'edges' || mode === 'standard' ? mode : 'standard'
}

const SPARTA_TACTICS: ThreatTactic[] = [
  { id: 'ST0001', name: 'Reconnaissance', prefix: 'REC' },
  { id: 'ST0002', name: 'Resource Development', prefix: 'RD' },
  { id: 'ST0003', name: 'Initial Access', prefix: 'IA' },
  { id: 'ST0004', name: 'Execution', prefix: 'EX' },
  { id: 'ST0005', name: 'Persistence', prefix: 'PER' },
  { id: 'ST0006', name: 'Defense Evasion', prefix: 'DE' },
  { id: 'ST0007', name: 'Lateral Movement', prefix: 'LM' },
  { id: 'ST0008', name: 'Exfiltration', prefix: 'EXF' },
  { id: 'ST0009', name: 'Impact', prefix: 'IMP' },
]

function tacticForTechnique(controlId: string): string | null {
  for (const t of SPARTA_TACTICS) {
    if (controlId.startsWith(t.prefix + '-')) return t.name
  }
  return null
}

const EXPRESS = API_ORIGIN

function post(path: string, body: Record<string, unknown>) {
  return fetch(`${DAEMON}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => ({ documents: [], items: [] }))
}

function postExpress(path: string, body: Record<string, unknown>) {
  return fetch(`${EXPRESS}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => ({}))
}

interface RawTechnique {
  control_id: string
  name: string
  description?: string
  mind?: string[]
  nrs_score?: number
  weaknesses?: string[]
}

const AVAILABLE_DATALAKES: DatalakeOption[] = [
  { id: 'f36', name: 'F-36 Lightning II', description: 'F-36 program compliance evidence', collections: ['sparta_qra', 'sparta_url_content'] },
  { id: 'cmmc', name: 'CMMC Assessment', description: 'CMMC Level 2 compliance data', collections: ['sparta_qra'] },
]

export function ThreatMatrixView() {
  const [rawTechniques, setRawTechniques] = useState<RawTechnique[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showSubtechniques, setShowSubtechniques] = useState(false)
  const [selectedDetail, setSelectedDetail] = useState<TechniqueDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [activeDatalake, setActiveDatalake] = useState<string>('')
  const [evidenceMap, setEvidenceMap] = useState<Map<string, { verdict: string; grade: string; count: number }>>(new Map())
  const [graphRelationships, setGraphRelationships] = useState<ThreatRelationship[]>([])
  const [graphHoveredTactic, setGraphHoveredTactic] = useState<string | null>(null)
  const [graphLockedTactic, setGraphLockedTactic] = useState<string | null>('Reconnaissance')
  const [viewMode, setViewMode] = useState<ThreatMatrixState['viewMode']>(() => readInitialThreatMatrixViewMode())
  const coverageHealth = readCoverageHealthCache()
  const coveragePurpose = deriveCoveragePagePurposeState(coverageHealth)
  const analysisPipelineDegraded = coveragePurpose.state !== 'pass' || coverageHealth?.stale === true
  const [condensedView, setCondensedView] = useState(false)
  const { curationMode, openCurationItems, setOpenCurationItems } = useMatrixCuration()
  const [curationNote, setCurationNote] = useState('')
  const [proposalId, setProposalId] = useState('')
  const [proposalName, setProposalName] = useState('')
  const [proposalTactic, setProposalTactic] = useState(SPARTA_TACTICS[0]?.name ?? 'Reconnaissance')
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  // Curation actions for Brandon
  const saveMatrixAmendment = useCallback(async () => {
    if (!selectedDetail || !curationNote.trim()) {
      setSaveStatus('Select a technique and enter an amendment note.')
      return
    }
    const tech = selectedDetail.technique
    const res = await fetch(`${DAEMON}/learn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'sparta_matrix_amendments',
        problem: `Amend matrix mapping for ${tech.id}: ${tech.name}`,
        solution: curationNote.trim(),
        metadata: {
          type: 'matrix_amendment',
          control_id: tech.id,
          technique_name: tech.name,
          tactic: tech.tactic,
          verdict: tech.evidenceVerdict,
          grade: tech.evidenceGrade ?? null,
          status: 'open',
          reviewed_by: 'brandon-bailey',
          created_at: new Date().toISOString(),
        },
      }),
    })
    if (!res.ok) {
      setSaveStatus(`Failed to save amendment (${res.status})`)
      return
    }
    setCurationNote('')
    setSaveStatus(`Saved amendment for ${tech.id}`)
  }, [selectedDetail, curationNote])

  const submitTechniqueProposal = useCallback(async () => {
    const id = proposalId.trim().toUpperCase()
    const name = proposalName.trim()
    if (!id || !name) {
      setSaveStatus('Enter technique ID and name to add a proposal.')
      return
    }
    const res = await fetch(`${DAEMON}/learn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'sparta_matrix_amendments',
        problem: `Propose new threat matrix technique ${id}`,
        solution: name,
        metadata: {
          type: 'new_technique_proposal',
          proposed_control_id: id,
          proposed_name: name,
          proposed_tactic: proposalTactic,
          status: 'open',
          reviewed_by: 'brandon-bailey',
          created_at: new Date().toISOString(),
        },
      }),
    })
    if (!res.ok) {
      setSaveStatus(`Failed to save proposal (${res.status})`)
      return
    }
    setProposalId('')
    setProposalName('')
    setSaveStatus(`Saved new technique proposal ${id}`)
  }, [proposalId, proposalName, proposalTactic])

  useEffect(() => {
    post('/list', { collection: 'sparta_matrix_amendments', limit: 500 })
      .then((res) => {
        const docs = (res.documents ?? []) as Array<Record<string, unknown>>
        const open = docs.filter((d) => (d.status as string | undefined) !== 'closed').length
        setOpenCurationItems(open)
      })
      .catch(() => setOpenCurationItems(0))
  }, [saveStatus])

  // Fetch all SPARTA techniques from daemon
  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`${DAEMON}/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'sparta_controls',
        limit: 500,
        filters: { source_framework: 'SPARTA', control_type: 'technique' },
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`)
        return r.json()
      })
      .then((res) => {
        if (res.error) {
          setError(res.error)
          setRawTechniques([])
        } else {
          setRawTechniques(res.documents ?? [])
        }
        setLoading(false)
      })
      .catch((err) => {
        console.error('ThreatMatrix fetch error:', err)
        setError(err.message || 'Failed to load techniques')
        setRawTechniques([])
        setLoading(false)
      })
  }, [])

  // Load a bounded relationship slice from memory. These are the authoritative
  // crosswalk/control edges created by the evidence-case and SPARTA pipelines.
  useEffect(() => {
    const relationshipFields = [
      'source_control_id',
      'target_control_id',
      'source_framework',
      'target_framework',
      'relationship_type',
      'edge_type',
      'combined_score',
    ]
    Promise.all([
      post('/list', {
        collection: 'sparta_relationships',
        limit: 500,
        filters: { target_framework: 'SPARTA' },
        return_fields: relationshipFields,
      }),
      post('/list', {
        collection: 'sparta_relationships',
        limit: 500,
        filters: { target_framework: 'sparta' },
        return_fields: relationshipFields,
      }),
      post('/list', {
        collection: 'sparta_relationships',
        limit: 500,
        filters: { source_framework: 'SPARTA' },
        return_fields: relationshipFields,
      }),
    ]).then((results) => {
      const seen = new Set<string>()
      const relationships: ThreatRelationship[] = []
      for (const res of results) {
        for (const rel of ((res.documents ?? []) as ThreatRelationship[])) {
          if (!rel.source_control_id || !rel.target_control_id) continue
          const key = `${rel.source_control_id}->${rel.target_control_id}`
          if (seen.has(key)) continue
          seen.add(key)
          relationships.push(rel)
        }
      }
      setGraphRelationships(relationships)
    }).catch(() => setGraphRelationships([]))
  }, [])

  // Load evidence verdicts from dedicated evidence_cases collection
  useEffect(() => {
    if (!activeDatalake) {
      setEvidenceMap(new Map())
      return
    }

    post('/list', { collection: 'evidence_cases', limit: 500 }).then((res) => {
      const docs = (res.documents ?? []) as Array<Record<string, unknown>>
      const verdictMap = new Map<string, { verdict: string; grade: string; count: number }>()

      for (const doc of docs) {
        const controlIds = (doc.control_ids as string[]) ?? []
        const verdict = (doc.verdict as string) ?? 'not_satisfied'
        const grade = (doc.grade as string) ?? 'F'

        for (const cid of controlIds) {
          if (!SPARTA_TACTICS.some((t) => cid.startsWith(t.prefix + '-'))) continue
          const existing = verdictMap.get(cid)
          if (!existing) {
            verdictMap.set(cid, { verdict, grade, count: 1 })
          } else {
            existing.count++
            if (verdict === 'satisfied' && existing.verdict !== 'satisfied') {
              existing.verdict = verdict; existing.grade = grade
            } else if (verdict === 'inconclusive' && existing.verdict === 'not_satisfied') {
              existing.verdict = verdict; existing.grade = grade
            }
          }
        }
      }

      setEvidenceMap(verdictMap)
    })
  }, [activeDatalake])

  // Transform raw docs → ThreatTechnique[]
  const techniques: ThreatTechnique[] = rawTechniques
    .filter((t) => {
      if (!tacticForTechnique(t.control_id)) return false
      if (!showSubtechniques && t.control_id.includes('.')) return false
      return true
    })
    .map((t) => {
      const ev = evidenceMap.get(t.control_id)
      const verdict = activeDatalake && ev ? ev.verdict : 'none'
      const coverage: 'full' | 'partial' | 'none' | 'unknown' = verdict === 'satisfied' ? 'full'
        : verdict === 'inconclusive' ? 'partial'
        : verdict === 'not_satisfied' ? 'none'
        : 'unknown'
      return {
        id: t.control_id,
        name: t.name,
        description: t.description,
        tactic: tacticForTechnique(t.control_id) ?? 'Unknown',
        coverage,
        evidenceVerdict: (verdict as 'satisfied' | 'inconclusive' | 'not_satisfied' | 'none'),
        evidenceCaseCount: ev?.count ?? 0,
        evidenceGrade: ev?.grade,
        issueCount: t.weaknesses?.length ?? 0,
        frameworks: ['SPARTA'],
        mind: t.mind,
        nrs_score: t.nrs_score,
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  // Select technique → fetch QRAs + relationships + traceability + evidence cases + discrepancies
  const selectTechnique = useCallback(async (tech: ThreatTechnique) => {
    setLoadingDetail(true)
    setSelectedDetail({ technique: tech, qras: [], countermeasures: [], relationships: [] })

    const [qraRes, relRes, traceRes, evidenceRes, discResult] = await Promise.all([
      post('/recall', { q: `${tech.id} ${tech.name}`, collections: ['sparta_qra'], k: 10, entities: [tech.id] }),
      post('/recall', { q: tech.id, collections: ['sparta_relationships'], k: 20, entities: [tech.id] }),
      postExpress('/api/memory/traceability', { control_id: tech.id }),
      postExpress('/api/evidence-case/trace', { control_id: tech.id }),
      post('/list', { collection: 'evidence_cases', limit: 50, filters: { type: 'discrepancy' } }),
    ])

    const rels = (relRes.items ?? []) as Array<Record<string, unknown>>
    const cmIds = [...new Set(rels
      .filter((r) => {
        const tid = (r.target_control_id as string) ?? ''
        return tid.startsWith('CM') || tid.startsWith('d3f:') || tid.startsWith('AC-') || tid.startsWith('SC-')
      })
      .map((r) => r.target_control_id as string)
    )]

    // Traceability groups: { asset_type: chunk[] } dict from endpoint
    const traceability: Record<string, TraceabilityChunk[]> = {}
    const groups = traceRes.groups ?? {}
    for (const [assetType, chunks] of Object.entries(groups)) {
      traceability[assetType] = (chunks as TraceabilityChunk[]) ?? []
    }

    // Evidence cases
    const allEvCases = (evidenceRes.cases ?? []) as EvidenceCase[]

    // Discrepancy findings for this control
    const discDocs = (discResult.documents ?? []) as Array<Record<string, unknown>>
    const discrepancies = discDocs
      .filter((d: any) => d.control_id === tech.id || (d.tags ?? []).includes(`control:${tech.id}`))
      .map((d: any) => ({
        severity: d.severity ?? 'low',
        summary: d.summary ?? '',
        requirement_claim: d.requirement_claim ?? '',
        table_reality: d.table_reality ?? '',
        recommendation: d.recommendation ?? '',
      }))

    setSelectedDetail({
      technique: tech,
      qras: qraRes.items ?? [],
      relationships: rels as TechniqueDetail['relationships'],
      countermeasures: cmIds.map((id) => ({ control_id: id, name: id })),
      traceability,
      evidenceCases: allEvCases,
      discrepancies,
    })
    setLoadingDetail(false)
  }, [])

  const clearSelection = useCallback(() => setSelectedDetail(null), [])
  const toggleSubtechniques = useCallback(() => setShowSubtechniques((s) => !s), [])

  // Build the state/actions/meta contract
  const state: ThreatMatrixState = {
    tactics: SPARTA_TACTICS,
    techniques,
    loading,
    showSubtechniques,
    selectedDetail,
    loadingDetail,
    viewMode,
    condensedView,
    graphRelationships,
    graphHoveredTactic,
    graphLockedTactic,
  }

  const selectDatalake = useCallback((dl: string) => setActiveDatalake(dl), [])

  const actions: ThreatMatrixActions = {
    selectTechnique,
    clearSelection,
    toggleSubtechniques,
    selectDatalake,
    setViewMode,
    toggleCondensedView: () => setCondensedView((v) => !v),
    setGraphHoveredTactic,
    setGraphLockedTactic,
  }

  const meta: ThreatMatrixMeta = {
    totalControls: rawTechniques.length,
    source: 'explorer',
    analysisPipelineDegraded,
    boundEvidenceCaseId: null,
    datalakes: AVAILABLE_DATALAKES,
    activeDatalake: activeDatalake || undefined,
  }

  const { mode: pageDistanceMode } = usePageDistanceMode()

  // Compose the shared compound component
  return (
    <PageDistanceRoot qid="threat-matrix-mode-root">
    <ThreatMatrixDistanceShell
      mode={pageDistanceMode}
      techniques={techniques}
      loading={loading}
      onSelectTechnique={(tech) => { void selectTechnique(tech) }}
    >
    <ThreatMatrix.Provider state={state} actions={actions} meta={meta}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
        {error && (
          <div style={{ padding: '12px 16px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', borderBottom: '1px solid rgba(239, 68, 68, 0.3)' }}>
            Error loading techniques: {error}
          </div>
        )}

        {curationMode ? <div
          data-qid="threat-matrix:layout:brandon-curation"
          style={{
            padding: '6px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: 'transparent',
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, color: '#9fb0bd' }}>
              Matrix curation {curationMode ? 'enabled' : 'disabled'} — toggle from Ask Embry header.
            </div>
            <div style={{ fontSize: 11, color: '#9fb0bd' }}>
              Open items: <strong style={{ color: '#ffffff' }}>{openCurationItems}</strong>
            </div>
            {saveStatus && <div style={{ fontSize: 11, color: '#00d1ff' }}>{saveStatus}</div>}
          </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 11, color: '#c9d5de' }}>
                Brandon workflow: select a technique, capture requirement conflict/cascade notes, and save amendments for adjudication.
              </div>

              <textarea
                data-qid="threat-matrix:input:amendment-note"
                value={curationNote}
                onChange={(e) => setCurationNote(e.target.value)}
                placeholder={selectedDetail ? `Amendment note for ${selectedDetail.technique.id}...` : 'Select a technique, then write amendment note...'}
                title="Matrix amendment note"
                style={{ minHeight: 88, resize: 'vertical', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: '#e6edf3', padding: 10, fontSize: 12 }}
              />
              <button
                data-qid="threat-matrix:button:save-amendment"
                data-qs-action="SAVE_MATRIX_AMENDMENT"
                title="Save matrix amendment"
                onClick={saveMatrixAmendment}
                style={{ minHeight: 44, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(0, 209, 255, 0.55)', background: 'rgba(0, 209, 255, 0.14)', color: '#00d1ff', fontSize: 11, fontWeight: 800, cursor: 'pointer', width: 'fit-content' }}
              >
                Save Amendment
              </button>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <input
                  data-qid="threat-matrix:input:new-technique-id"
                  value={proposalId}
                  onChange={(e) => setProposalId(e.target.value)}
                  placeholder="New ID (e.g., REC-0999)"
                  title="New technique ID"
                  style={{ minHeight: 44, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: '#e6edf3', fontSize: 12 }}
                />
                <input
                  data-qid="threat-matrix:input:new-technique-name"
                  value={proposalName}
                  onChange={(e) => setProposalName(e.target.value)}
                  placeholder="New technique name"
                  title="New technique name"
                  style={{ minHeight: 44, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: '#e6edf3', fontSize: 12, minWidth: 260 }}
                />
                <select
                  data-qid="threat-matrix:input:new-technique-tactic"
                  value={proposalTactic}
                  onChange={(e) => setProposalTactic(e.target.value)}
                  title="Proposed tactic"
                  style={{ minHeight: 44, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.35)', color: '#e6edf3', fontSize: 12 }}
                >
                  {SPARTA_TACTICS.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
                <button
                  data-qid="threat-matrix:button:add-technique-proposal"
                  data-qs-action="ADD_TECHNIQUE_PROPOSAL"
                  title="Save new technique proposal"
                  onClick={submitTechniqueProposal}
                  style={{ minHeight: 44, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(63, 185, 80, 0.55)', background: 'rgba(63, 185, 80, 0.14)', color: '#3fb950', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                >
                  Add Technique Proposal
                </button>
              </div>
            </div>
        </div> : null}

        <ThreatMatrix.Header />
        <div
          data-qid="threat-matrix:layout:squeeze"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            width: '100%',
            overflow: 'hidden',
            background: '#050505',
          }}
        >
          <div
            data-qid="threat-matrix:layout:squeeze-matrix"
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              transition: 'flex-basis 0.3s ease, width 0.3s ease',
            }}
          >
            <ThreatMatrix.TacticStrip />
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <ThreatMatrix.Grid />
            </div>
          </div>
          <ThreatMatrix.Detail />
        </div>
      </div>
    </ThreatMatrix.Provider>
    </ThreatMatrixDistanceShell>
    </PageDistanceRoot>
  )
}
