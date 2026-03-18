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
import type { ThreatTechnique, ThreatTactic, TechniqueDetail, ThreatMatrixState, ThreatMatrixActions, ThreatMatrixMeta, DatalakeOption } from '../shared/ThreatMatrix'

const DAEMON = 'http://localhost:3001/api/memory'

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

function post(path: string, body: Record<string, unknown>) {
  return fetch(`${DAEMON}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => ({ documents: [], items: [] }))
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
  const [showSubtechniques, setShowSubtechniques] = useState(false)
  const [selectedDetail, setSelectedDetail] = useState<TechniqueDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [activeDatalake, setActiveDatalake] = useState<string>('')
  const [evidenceMap, setEvidenceMap] = useState<Map<string, number>>(new Map())

  // Fetch all SPARTA techniques from daemon
  useEffect(() => {
    setLoading(true)
    post('/list', {
      collection: 'sparta_controls',
      limit: 500,
      filters: { source_framework: 'SPARTA', control_type: 'technique' },
    }).then((res) => {
      setRawTechniques(res.documents ?? [])
      setLoading(false)
    })
  }, [])

  // When datalake is selected, fetch evidence counts per technique
  useEffect(() => {
    if (!activeDatalake) {
      setEvidenceMap(new Map())
      return
    }
    // Fetch QRA counts grouped by control_id for SPARTA techniques
    post('/recall', {
      q: 'SPARTA technique QRA evidence coverage',
      collections: ['sparta_qra'],
      k: 500,
    }).then((res) => {
      const counts = new Map<string, number>()
      for (const item of (res.items ?? []) as Array<Record<string, unknown>>) {
        const cid = (item.control_id as string) ?? ''
        if (cid) counts.set(cid, (counts.get(cid) ?? 0) + 1)
      }
      setEvidenceMap(counts)
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
      const hasQras = (t.nrs_score ?? 0) > 0
      const hasMind = (t.mind?.length ?? 0) > 0
      const evCount = evidenceMap.get(t.control_id) ?? 0
      const hasEvidence = activeDatalake ? evCount > 0 : hasQras
      const catalogHas = hasQras || hasMind
      return {
        id: t.control_id,
        name: t.name,
        description: t.description,
        tactic: tacticForTechnique(t.control_id) ?? 'Unknown',
        coverage: hasEvidence ? 'full' : catalogHas ? 'partial' : 'none' as const,
        catalogCoverage: catalogHas,
        evidenceCoverage: hasEvidence,
        evidenceCount: activeDatalake ? evCount : 0,
        issueCount: t.weaknesses?.length ?? 0,
        frameworks: ['SPARTA'],
        mind: t.mind,
        nrs_score: t.nrs_score,
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  // Select technique → fetch QRAs + relationships from daemon
  const selectTechnique = useCallback((tech: ThreatTechnique) => {
    setLoadingDetail(true)
    setSelectedDetail({ technique: tech, qras: [], countermeasures: [], relationships: [] })

    Promise.all([
      post('/recall', { q: `${tech.id} ${tech.name}`, collections: ['sparta_qra'], k: 10, entities: [tech.id] }),
      post('/recall', { q: tech.id, collections: ['sparta_relationships'], k: 20, entities: [tech.id] }),
    ]).then(([qraRes, relRes]) => {
      const rels = (relRes.items ?? []) as Array<Record<string, unknown>>
      const cmIds = [...new Set(rels
        .filter((r) => {
          const tid = (r.target_control_id as string) ?? ''
          return tid.startsWith('CM') || tid.startsWith('d3f:') || tid.startsWith('AC-') || tid.startsWith('SC-')
        })
        .map((r) => r.target_control_id as string)
      )]

      setSelectedDetail({
        technique: tech,
        qras: qraRes.items ?? [],
        relationships: rels as TechniqueDetail['relationships'],
        countermeasures: cmIds.map((id) => ({ control_id: id, name: id })),
      })
      setLoadingDetail(false)
    })
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
  }

  const selectDatalake = useCallback((dl: string) => setActiveDatalake(dl), [])

  const actions: ThreatMatrixActions = {
    selectTechnique,
    clearSelection,
    toggleSubtechniques,
    selectDatalake,
  }

  const meta: ThreatMatrixMeta = {
    totalControls: rawTechniques.length,
    source: 'explorer',
    datalakes: AVAILABLE_DATALAKES,
    activeDatalake: activeDatalake || undefined,
  }

  // Compose the shared compound component
  return (
    <ThreatMatrix.Provider state={state} actions={actions} meta={meta}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <ThreatMatrix.Header />
        <ThreatMatrix.TacticStrip />
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <ThreatMatrix.Grid />
          <ThreatMatrix.Detail />
        </div>
      </div>
    </ThreatMatrix.Provider>
  )
}
