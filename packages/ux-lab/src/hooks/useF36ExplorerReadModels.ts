import { useEffect, useState } from 'react'
import type { F36ExplorerProjection } from './usePostureData'

export type F36CorpusCounts = {
  requirements_total: number
  requirements_candidate: number
  requirements_reviewed: number
  requirements_candidate_mapped: number
  requirements_reviewed_mapped: number
  requirements_mapped_any: number
  requirements_unmapped: number
  candidate_paths: number
  reviewed_paths: number
  component_families_total: number
  component_families_with_requirements: number
  component_families_candidate_mapped: number
  component_families_reviewed_mapped: number
  supply_chain_provenance_requirements: number
  compliance_credit: number
}

type Common = {
  projection_fingerprint: string
  counts_fingerprint: string
  counts: F36CorpusCounts
  synthetic: true
  synthetic_disclosure: string
  operational_authority: false
  live: true
  mocked: false
}

export type F36PostureReadModel = Common & {
  schema: 'f36.explorer_posture_read_model.v1'
  readiness: 'NOT_READY'
  reason_codes: string[]
  grounded_requirements: 0
  accepted_evidence_cases: 0
  candidate_canary: { requirement_revision_id: string; mapped_controls: string[]; review_state: string }
}

export type F36ThreatMatrixReadModel = Common & {
  schema: 'f36.explorer_threat_matrix_read_model.v1'
  candidate_overlays: Array<{ sparta_control_id: string; requirement_revision_id: string; path_signature: string; compliance_credit: 0 }>
  reviewed_overlays: []
  canary_projection: F36ExplorerProjection
}

export type F36SupplyChainReadModel = Common & {
  schema: 'f36.explorer_supply_chain_read_model.v1'
  requirement_rows: Array<{ requirement_id: string; requirement_revision_id: string; requirement_content_hash: string; component_family_id: string; title: string; statement: string; review_state: string }>
  requirement_component_edges: Array<{ source_id: string; target_id: string; relationship_type: string }>
  instance_lineage: { state: 'ABSENT'; missing_node_types: string[]; fabricated_nodes: 0 }
  reviewed_sparta_overlay: []
}

function useReadModel<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch(path, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${path} failed: ${response.status}`)
        return response.json() as Promise<T>
      })
      .then((value) => { if (!cancelled) setData(value) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [path])

  return { data, loading, error }
}

export const useF36PostureReadModel = () => useReadModel<F36PostureReadModel>('/api/f36/explorer/v1/posture')
export const useF36ThreatMatrixReadModel = () => useReadModel<F36ThreatMatrixReadModel>('/api/f36/explorer/v1/threat-matrix')
export const useF36SupplyChainReadModel = () => useReadModel<F36SupplyChainReadModel>('/api/f36/explorer/v1/supply-chain')
