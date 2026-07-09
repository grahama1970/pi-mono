// Unified SPARTA Threat Matrix payload contract.
// This flattened model powers both the grid and graph views.

export interface TacticalNode {
  id: string
  tactic: string
  name: string
  coverage: number
  category?: string
}

export interface TacticalEdge {
  source: string
  target: string
}

export interface ThreatMatrixPayload {
  nodes: TacticalNode[]
  links: TacticalEdge[]
}
