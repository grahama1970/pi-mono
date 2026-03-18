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
  const [evidenceMap, setEvidenceMap] = useState<Map<string, { verdict: string; grade: string; count: number }>>(new Map())

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

  // When datalake is selected, fetch /create-evidence-case verdicts from /recall.
  // Evidence cases are stored as lessons with evidence_case tag.
  // Each case has control_ids and a verdict (satisfied/inconclusive/not_satisfied).
  // The Threat Matrix ONLY shows what /create-evidence-case has determined.
  useEffect(() => {
    if (!activeDatalake) {
      setEvidenceMap(new Map())
      return
    }

    post('/recall', {
      q: 'evidence case SPARTA requirement compliance verdict',
      collections: ['lessons'],
      k: 300,
    }).then((res) => {
      const items = (res.items ?? []) as Array<Record<string, unknown>>
      const verdictMap = new Map<string, { verdict: string; grade: string; count: number }>()

      for (const item of items) {
        const tags = (item.tags as string[]) ?? []
        if (!tags.includes('evidence_case')) continue

        const controlIds = (item.control_ids as string[]) ?? []
        const verdict = (item.verdict as string) ?? 'not_satisfied'
        const grade = (item.grade as string) ?? 'F'

        for (const cid of controlIds) {
          // Only map to SPARTA techniques
          if (!SPARTA_TACTICS.some((t) => cid.startsWith(t.prefix + '-'))) continue

          const existing = verdictMap.get(cid)
          if (!existing) {
            verdictMap.set(cid, { verdict, grade, count: 1 })
          } else {
            existing.count++
            // Best verdict wins: satisfied > inconclusive > not_satisfied
            if (verdict === 'satisfied' && existing.verdict !== 'satisfied') {
              existing.verdict = verdict
              existing.grade = grade
            } else if (verdict === 'inconclusive' && existing.verdict === 'not_satisfied') {
              existing.verdict = verdict
              existing.grade = grade
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
      const coverage = verdict === 'satisfied' ? 'full'
        : verdict === 'inconclusive' ? 'partial'
        : verdict === 'not_satisfied' ? 'none'
        : 'unknown' as const
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
