/**
 * SupplyChainView — Day 3 Compliance Cascade Visualization
 *
 * Features:
 * - ProvenanceGraph with swimlane layout (Suppliers → Evidence → Controls → Frameworks)
 * - Scenario selection for F-36 golden fixtures
 * - Supplier Kill Switch for what-if analysis
 * - Decay horizon projection
 */
import { useState, useCallback, useMemo } from 'react'
import { ProvenanceGraph } from '../provenance-graph/ProvenanceGraph'
import type { ProvenanceNode, ProvenanceEdge } from '../provenance-graph/types'
import { EMBRY } from '../common/EmbryStyle'
import { useRegisterAction } from '../../../hooks/useRegisterAction'

// ── F-36 Golden Fixture: Minimal Scenario ────────────────────────────────
// DO-178C DAL-A avionics supply chain with temporal evidence
const F36_SCENARIO_1: { nodes: ProvenanceNode[]; edges: ProvenanceEdge[] } = {
  nodes: [
    // Tier-1 Suppliers
    {
      id: 'sup-northrop',
      label: 'Northrop Grumman',
      nodeClass: 'supplier',
      supplier_id: 'sup-northrop',
      supplier_tier: 1,
      dal_level: 'A',
      temporal: {
        observed_at: Date.now() - 365 * 24 * 60 * 60 * 1000,
        valid_from: Date.now() - 365 * 24 * 60 * 60 * 1000,
        valid_to: Date.now() + 90 * 24 * 60 * 60 * 1000, // Expires in 90 days
        assessed_at: Date.now() - 30 * 24 * 60 * 60 * 1000,
        source_event_id: 'ing-001',
        is_active: true,
      },
    },
    {
      id: 'sup-raytheon',
      label: 'Raytheon',
      nodeClass: 'supplier',
      supplier_id: 'sup-raytheon',
      supplier_tier: 1,
      dal_level: 'B',
      temporal: {
        observed_at: Date.now() - 300 * 24 * 60 * 60 * 1000,
        valid_from: Date.now() - 300 * 24 * 60 * 60 * 1000,
        valid_to: Date.now() + 180 * 24 * 60 * 60 * 1000,
        assessed_at: Date.now() - 60 * 24 * 60 * 60 * 1000,
        source_event_id: 'ing-002',
        is_active: true,
      },
    },
    // Tier-2 Suppliers
    {
      id: 'sup-bae',
      label: 'BAE Systems',
      nodeClass: 'supplier',
      supplier_id: 'sup-bae',
      supplier_tier: 2,
      dal_level: 'C',
      temporal: {
        observed_at: Date.now() - 200 * 24 * 60 * 60 * 1000,
        valid_from: Date.now() - 200 * 24 * 60 * 60 * 1000,
        valid_to: Date.now() + 30 * 24 * 60 * 60 * 1000, // Expires soon!
        assessed_at: Date.now() - 45 * 24 * 60 * 60 * 1000,
        source_event_id: 'ing-003',
        is_active: true,
      },
    },
    // Evidence Artifacts
    {
      id: 'ev-cmmc-cert-ng',
      label: 'CMMC L2 Cert (NG)',
      nodeClass: 'evidence_artifact',
      framework: 'CMMC',
      temporal: {
        observed_at: Date.now() - 100 * 24 * 60 * 60 * 1000,
        valid_from: Date.now() - 100 * 24 * 60 * 60 * 1000,
        valid_to: Date.now() + 265 * 24 * 60 * 60 * 1000,
        assessed_at: Date.now() - 10 * 24 * 60 * 60 * 1000,
        source_event_id: 'ing-004',
        is_active: true,
      },
    },
    {
      id: 'ev-do178c-a',
      label: 'DO-178C DAL-A Report',
      nodeClass: 'evidence_artifact',
      framework: 'DO-178C',
      dal_level: 'A',
      temporal: {
        observed_at: Date.now() - 150 * 24 * 60 * 60 * 1000,
        valid_from: Date.now() - 150 * 24 * 60 * 60 * 1000,
        valid_to: Date.now() + 215 * 24 * 60 * 60 * 1000,
        assessed_at: Date.now() - 5 * 24 * 60 * 60 * 1000,
        source_event_id: 'ing-005',
        is_active: true,
      },
    },
    {
      id: 'ev-pentest-ray',
      label: 'Pentest Report (Raytheon)',
      nodeClass: 'evidence_artifact',
      framework: 'NIST',
      temporal: {
        observed_at: Date.now() - 50 * 24 * 60 * 60 * 1000,
        valid_from: Date.now() - 50 * 24 * 60 * 60 * 1000,
        valid_to: Date.now() + 315 * 24 * 60 * 60 * 1000,
        assessed_at: Date.now() - 2 * 24 * 60 * 60 * 1000,
        source_event_id: 'ing-006',
        is_active: true,
      },
    },
    // Controls
    {
      id: 'ctrl-ac-1',
      label: 'AC.1.001 Access Control',
      nodeClass: 'control',
      framework: 'CMMC',
      family: 'AC',
      temporal: {
        observed_at: Date.now() - 365 * 24 * 60 * 60 * 1000,
        valid_from: Date.now() - 365 * 24 * 60 * 60 * 1000,
        valid_to: Date.now() + 365 * 24 * 60 * 60 * 1000,
        assessed_at: Date.now() - 7 * 24 * 60 * 60 * 1000,
        source_event_id: 'ing-007',
        is_active: true,
      },
    },
    {
      id: 'ctrl-si-2',
      label: 'SI.2.214 Security Integrity',
      nodeClass: 'control',
      framework: 'CMMC',
      family: 'SI',
      temporal: {
        observed_at: Date.now() - 365 * 24 * 60 * 60 * 1000,
        valid_from: Date.now() - 365 * 24 * 60 * 60 * 1000,
        valid_to: Date.now() + 365 * 24 * 60 * 60 * 1000,
        assessed_at: Date.now() - 14 * 24 * 60 * 60 * 1000,
        source_event_id: 'ing-008',
        is_active: true,
      },
    },
    // Framework Artifacts
    {
      id: 'fw-do178c',
      label: 'DO-178C Standard',
      nodeClass: 'framework_artifact',
      framework: 'DO-178C',
      temporal: {
        observed_at: Date.now() - 1000 * 24 * 60 * 60 * 1000,
        valid_from: Date.now() - 1000 * 24 * 60 * 60 * 1000,
        valid_to: Date.now() + 1000 * 24 * 60 * 60 * 1000,
        assessed_at: Date.now() - 365 * 24 * 60 * 60 * 1000,
        source_event_id: 'ing-009',
        is_active: true,
      },
    },
    {
      id: 'fw-cmmc',
      label: 'CMMC Level 2',
      nodeClass: 'framework_artifact',
      framework: 'CMMC',
      temporal: {
        observed_at: Date.now() - 500 * 24 * 60 * 60 * 1000,
        valid_from: Date.now() - 500 * 24 * 60 * 60 * 1000,
        valid_to: Date.now() + 500 * 24 * 60 * 60 * 1000,
        assessed_at: Date.now() - 30 * 24 * 60 * 60 * 1000,
        source_event_id: 'ing-010',
        is_active: true,
      },
    },
  ],
  edges: [
    // Supplier → Evidence (inherits_from)
    { id: 'e1', source: 'sup-northrop', target: 'ev-cmmc-cert-ng', type: 'inherits_from', weight: 1.0, exclusivity: 1.0, dal_level: 'A' },
    { id: 'e2', source: 'sup-northrop', target: 'ev-do178c-a', type: 'inherits_from', weight: 0.95, exclusivity: 0.8, dal_level: 'A' },
    { id: 'e3', source: 'sup-raytheon', target: 'ev-pentest-ray', type: 'inherits_from', weight: 0.9, exclusivity: 1.0, dal_level: 'B' },
    { id: 'e4', source: 'sup-bae', target: 'ev-cmmc-cert-ng', type: 'partially_supports', weight: 0.6, exclusivity: 0.4, dal_level: 'C' },

    // Evidence → Controls (satisfies)
    { id: 'e5', source: 'ev-cmmc-cert-ng', target: 'ctrl-ac-1', type: 'satisfies', weight: 0.85, exclusivity: 0.7, methods: ['Examine', 'Test'] },
    { id: 'e6', source: 'ev-do178c-a', target: 'ctrl-si-2', type: 'satisfies', weight: 0.9, exclusivity: 0.9, methods: ['Test'] },
    { id: 'e7', source: 'ev-pentest-ray', target: 'ctrl-ac-1', type: 'partially_supports', weight: 0.5, exclusivity: 0.3, methods: ['Test'] },

    // Controls → Frameworks (maps_to)
    { id: 'e8', source: 'ctrl-ac-1', target: 'fw-cmmc', type: 'maps_to', weight: 1.0, exclusivity: 1.0 },
    { id: 'e9', source: 'ctrl-si-2', target: 'fw-cmmc', type: 'maps_to', weight: 1.0, exclusivity: 1.0 },
    { id: 'e10', source: 'ev-do178c-a', target: 'fw-do178c', type: 'maps_to', weight: 1.0, exclusivity: 1.0, dal_level: 'A' },

    // Tier-2 dependency
    { id: 'e11', source: 'sup-bae', target: 'sup-northrop', type: 'depends_on', weight: 0.7, exclusivity: 0.5, supplier_tier: 2 },
  ],
}

// ── Scenarios ────────────────────────────────────────────────────────────
const SCENARIOS = {
  'f36-minimal': {
    label: 'F-36 Avionics (Minimal)',
    description: '3 suppliers, 3 evidence artifacts, 2 controls, 2 frameworks',
    data: F36_SCENARIO_1,
  },
} as const

type ScenarioKey = keyof typeof SCENARIOS

export function SupplyChainView() {
  const [scenario, setScenario] = useState<ScenarioKey>('f36-minimal')
  const [killedSuppliers, setKilledSuppliers] = useState<Set<string>>(new Set())
  const [selectedNode, setSelectedNode] = useState<ProvenanceNode | null>(null)
  const [showWorkflowGuide, setShowWorkflowGuide] = useState(true)

  // Register actions for QID compliance
  useRegisterAction('supply-chain:scenario-select', { app: 'sparta-explorer', action: 'SUPPLY_CHAIN_SELECT_SCENARIO', label: 'Select Scenario', description: 'Select a supply chain simulation scenario' })
  useRegisterAction('supply-chain:reset-kills', { app: 'sparta-explorer', action: 'SUPPLY_CHAIN_RESET_KILLS', label: 'Reset Killed Suppliers', description: 'Clear all killed supplier simulations' })
  useRegisterAction('supply-chain:guide-toggle', { app: 'sparta-explorer', action: 'SUPPLY_CHAIN_TOGGLE_WORKFLOW_GUIDE', label: 'Toggle Brandon Workflow Guide', description: 'Show or hide the Brandon compliance workflow instructions' })

  const currentScenario = SCENARIOS[scenario]
  const virtualTaints = useMemo(() => killedSuppliers, [killedSuppliers])

  const handleSupplierKillSwitch = useCallback((supplierId: string) => {
    setKilledSuppliers(prev => {
      const next = new Set(prev)
      if (next.has(supplierId)) {
        next.delete(supplierId)
      } else {
        next.add(supplierId)
      }
      return next
    })
  }, [])

  const handleExport = useCallback((affected: ProvenanceNode[], rationale: string) => {
    console.log('Export affected nodes:', affected.length, 'Rationale:', rationale)
  }, [])

  return (
    <div
      data-qid="supply-chain-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: EMBRY.bg,
        color: EMBRY.white,
      }}
    >
      {/* Control Bar */}
      <div
        data-qid="supply-chain-controls"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '8px 16px',
          borderBottom: `1px solid ${EMBRY.border}`,
          background: EMBRY.bgPanel,
          minHeight: 44,
        }}
      >
        {/* Scenario Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: EMBRY.dim, textTransform: 'uppercase' }}>
            Scenario
          </label>
          <select
            data-qid="supply-chain-scenario-select"
            data-qs-action="SUPPLY_CHAIN_SELECT_SCENARIO"
            title="Select a supply chain simulation scenario"
            value={scenario}
            onChange={(e) => setScenario(e.target.value as ScenarioKey)}
            style={{
              background: EMBRY.bg,
              border: `1px solid ${EMBRY.border}`,
              borderRadius: 4,
              color: EMBRY.white,
              padding: '10px 12px',
              fontSize: 12,
              minHeight: 44,
              minWidth: 44,
            }}
          >
            {Object.entries(SCENARIOS).map(([key, s]) => (
              <option key={key} value={key}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Scenario Description */}
        <span style={{ fontSize: 11, color: EMBRY.dim, flex: 1 }}>
          {currentScenario.description}
        </span>

        <button
          data-qid="supply-chain-workflow-toggle"
          data-qs-action="SUPPLY_CHAIN_TOGGLE_WORKFLOW_GUIDE"
          title="Show or hide the Brandon compliance workflow guide"
          onClick={() => setShowWorkflowGuide(v => !v)}
          style={{
            background: showWorkflowGuide ? 'rgba(0, 209, 255, 0.12)' : 'rgba(255,255,255,0.04)',
            border: showWorkflowGuide ? '1px solid rgba(0, 209, 255, 0.45)' : `1px solid ${EMBRY.border}`,
            color: showWorkflowGuide ? '#00d1ff' : EMBRY.dim,
            borderRadius: 6,
            padding: '8px 10px',
            minHeight: 44,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.03em',
            cursor: 'pointer',
          }}
        >
          {showWorkflowGuide ? 'Hide Brandon Workflow' : 'Show Brandon Workflow'}
        </button>

        {/* Kill Switch Status */}
        <div
  data-qid="supply-chain-kill-status"
  style={{
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    background: killedSuppliers.size > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.04)',
    border: killedSuppliers.size > 0 ? '1px solid rgba(239, 68, 68, 0.4)' : `1px solid ${EMBRY.border}`,
    borderRadius: 4,
  }}
>
  <span style={{ fontSize: 11, color: killedSuppliers.size > 0 ? '#ef4444' : EMBRY.dim, fontWeight: 700 }}>
    {killedSuppliers.size > 0
      ? `${killedSuppliers.size} SUPPLIER${killedSuppliers.size > 1 ? 'S' : ''} KILLED`
      : 'NO SUPPLIERS KILLED'}
  </span>
  <button
    data-qid="supply-chain-reset-kills"
    data-qs-action="SUPPLY_CHAIN_RESET_KILLS"
    title="Reset all killed supplier simulations"
    onClick={() => setKilledSuppliers(new Set())}
    disabled={killedSuppliers.size === 0}
    style={{
      background: 'none',
      border: 'none',
      color: killedSuppliers.size > 0 ? '#ef4444' : EMBRY.dim,
      cursor: killedSuppliers.size > 0 ? 'pointer' : 'not-allowed',
      fontSize: 12,
      padding: '2px 4px',
      minWidth: 44,
      minHeight: 44,
      opacity: killedSuppliers.size > 0 ? 1 : 0.5,
    }}
  >
    ✕
  </button>
</div>
      </div>


      {showWorkflowGuide && (
        <div
          data-qid="supply-chain-workflow-guide"
          style={{
            padding: '10px 16px',
            borderBottom: `1px solid ${EMBRY.border}`,
            background: 'linear-gradient(180deg, rgba(0, 209, 255, 0.05), rgba(0, 0, 0, 0))',
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 800, color: '#00d1ff', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Brandon Compliance Workflow
          </div>
          <div style={{ fontSize: 11, color: EMBRY.dim }}>
            Objective: verify traceability from supplier evidence to control and framework impact.
          </div>
          <div style={{ fontSize: 11, color: EMBRY.white }}>1. Select a scenario with <strong>Scenario</strong> to load the supplier graph.</div>
          <div style={{ fontSize: 11, color: EMBRY.white }}>2. Click supplier nodes to inspect DAL, tier, and framework metadata.</div>
          <div style={{ fontSize: 11, color: EMBRY.white }}>3. Trigger supplier kill-switches in the graph, then compare affected evidence/control paths.</div>
          <div style={{ fontSize: 11, color: EMBRY.white }}>4. Use <strong>Reset kill chain simulation</strong> to rerun the audit baseline.</div>
          <div style={{ fontSize: 11, color: EMBRY.white }}>5. Capture export rationale for assessor evidence packages.</div>
        </div>
      )}

      {/* Graph */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <ProvenanceGraph
          nodes={currentScenario.data.nodes}
          edges={currentScenario.data.edges}
          virtualTaints={virtualTaints}
          onSupplierKillSwitch={handleSupplierKillSwitch}
          onNodeSelect={setSelectedNode}
          onExport={handleExport}
          width={1100}
          height={700}
        />
      </div>

      {/* Selected Node Info */}
      {selectedNode && (
        <div
          data-qid="supply-chain-node-info"
          style={{
            padding: '8px 16px',
            borderTop: `1px solid ${EMBRY.border}`,
            background: EMBRY.bgPanel,
            fontSize: 11,
            display: 'flex',
            gap: 16,
          }}
        >
          <span><strong>Selected:</strong> {selectedNode.label}</span>
          <span><strong>Class:</strong> {selectedNode.nodeClass}</span>
          {selectedNode.framework && <span><strong>Framework:</strong> {selectedNode.framework}</span>}
          {selectedNode.dal_level && <span><strong>DAL:</strong> {selectedNode.dal_level}</span>}
          {selectedNode.supplier_tier && <span><strong>Tier:</strong> {selectedNode.supplier_tier}</span>}
        </div>
      )}
    </div>
  )
}

export default SupplyChainView
