import { useState, useEffect } from 'react'
import { EMBRY, label as labelStyle } from '../sparta/common/EmbryStyle'
import { PianoRollView } from '../music-lab/PianoRollView'
import { WaveformView } from '../music-lab/WaveformView'
import { ConvergenceChart } from '../music-lab/ConvergenceChart'
import { LyricsEditor } from '../music-lab/LyricsEditor'
import { MusicLabDashboard } from '../music-lab/MusicLabDashboard'
import {
  samplePianoNotes, sampleSections, samplePhrases, sampleRounds,
  samplePeaks, sampleDriftMarkers, sampleLyricMarkers,
} from '../music-lab/sampleMusicData'
import { ThreatMap } from '../sparta/threat-map/ThreatMap'
import { ChatWell } from '../sparta/query/ChatWell'
import { ControlTable } from '../sparta/tables/ControlTable'
import { LemmaGraph } from '../sparta/lemma-graph/LemmaGraph'
import { IntegrityCard } from '../sparta/integrity/IntegrityCard'
import { ControlDetail } from '../sparta/detail/ControlDetail'
import type { ControlDetailData } from '../sparta/detail/ControlDetail'
import { InspectorPanel } from '../sparta/inspector/InspectorPanel'
import type { GraphNode } from '../sparta/lemma-graph/LemmaGraph'
import { StatusPill } from '../unified-lab/components/StatusPill'
import { useSpartaData } from '../../hooks/useSpartaData'
import { BinaryGraph } from '../binary-explorer/BinaryGraph'
import { useBinaryData } from '../../hooks/useBinaryData'
import EntitySpanViewer from '../shared-chat/EntitySpanViewer'
import { ScillmDashboard, RealtimeLogTable } from '../scillm'
import { sampleLogs } from '../scillm/sampleData'
import type { BinaryGraphNode } from '../../hooks/useBinaryData'
import {
  sampleTactics, sampleTechniques, sampleMessages, emptyMessages,
  sampleControls, sampleGraphNodes, sampleGraphEdges, sampleControlDetail,
  sampleInspectorEdges, sampleWhatIfResponse,
} from './sampleData'

/* ───── Live data wrappers (hooks must live in components) ───── */

function LiveExplorer({ variation }: { variation: string }) {
  const sparta = useSpartaData()
  const [selectedControl, setSelectedControl] = useState<ControlDetailData | null>(null)
  const [inspectedNode, setInspectedNode] = useState<GraphNode | null>(null)
  const tactics = variation === 'threat-map-focus' ? sparta.tactics : sparta.tactics.slice(0, 5)
  const techniques = variation === 'threat-map-focus'
    ? sparta.techniques
    : sparta.techniques.filter((t) => tactics.includes(t.tactic))

  if (sparta.loading) {
    return <div style={{ color: EMBRY.dim, padding: 40, textAlign: 'center' }}>Loading SPARTA data...</div>
  }
  if (sparta.error) {
    return <div style={{ color: EMBRY.amber, padding: 40, textAlign: 'center' }}>API unavailable — use mock variations. ({sparta.error})</div>
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 12, border: `1px solid ${EMBRY.border}` }}>
      {/* ThoughtTrace */}
      <div style={{
        padding: '10px 24px', borderBottom: `1px solid rgba(255,255,255,0.08)`,
        backgroundColor: '#0b1326', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
      }}>
        {['Ingest', 'Resolve', 'Map', 'Verify', 'Score'].map((stage, i) => {
          const status = i < 3 ? 'success' : i === 3 ? 'warning' : 'pending'
          const dotColor = status === 'success' ? EMBRY.green : status === 'warning' ? EMBRY.amber : EMBRY.dim
          return (
            <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <div style={{ width: 24, height: 1, backgroundColor: EMBRY.muted }} />}
              <div style={{
                width: 8, height: 8, borderRadius: '50%', backgroundColor: dotColor,
                boxShadow: status !== 'pending' ? `0 0 10px ${dotColor}99` : 'none',
              }} />
              <span style={{
                fontSize: 10, fontWeight: 900, textTransform: 'uppercase' as const,
                letterSpacing: '0.18em', color: '#cbd5e1',
              }}>{stage}</span>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', height: variation === 'threat-map-focus' ? 600 : 520, overflow: 'hidden', backgroundColor: EMBRY.bg }}>
        <div style={{ width: '30%', borderRight: `1px solid ${EMBRY.border}`, padding: 24, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 5, height: 16, backgroundColor: EMBRY.blue, borderRadius: 4 }} />
            <span style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase' as const, letterSpacing: '0.2em', color: '#94a3b8' }}>Threat Overview</span>
          </div>
          <ThreatMap tactics={tactics} techniques={techniques} />
        </div>
        <div style={{ width: '35%', borderRight: `1px solid ${EMBRY.border}`, padding: 24, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 24, backgroundColor: '#111111' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 5, height: 16, backgroundColor: EMBRY.green, borderRadius: 4 }} />
            <span style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase' as const, letterSpacing: '0.2em', color: '#94a3b8' }}>Evidence Hub</span>
          </div>
          {selectedControl ? (
            <ControlDetail control={selectedControl} onClose={() => setSelectedControl(null)} />
          ) : (
            <ControlTable controls={sparta.controls} onSelect={(ctrl) => setSelectedControl({
              id: ctrl.id,
              framework: ctrl.framework,
              name: ctrl.name,
              controlType: ctrl.tactic,
              weaknesses: ctrl.issueCount > 0 ? [`${ctrl.issueCount} issue(s)`] : undefined,
            })} />
          )}
          <LemmaGraph nodes={sparta.graphNodes} edges={sparta.graphEdges} onNodeClick={(n) => setInspectedNode(n)} />
          {inspectedNode && (
            <InspectorPanel
              node={inspectedNode}
              edges={sparta.graphEdges}
              onClose={() => setInspectedNode(null)}
            />
          )}
        </div>
        <div style={{ width: '35%', padding: 24, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 16, backgroundColor: '#0c0c0c' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 5, height: 16, backgroundColor: EMBRY.amber, borderRadius: 4 }} />
            <span style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase' as const, letterSpacing: '0.2em', color: '#94a3b8' }}>Query & Synthesis</span>
          </div>
          <IntegrityCard
            status={sparta.integrity.status}
            coveragePercent={sparta.integrity.coveragePercent}
            coverageLabel="of edges healthy"
            issueCount={sparta.integrity.issueCount}
          />
          <ChatWell messages={sampleMessages} />
        </div>
      </div>
    </div>
  )
}

/* ───── BinaryGraph composed view ───── */

function BinaryExplorerView() {
  const data = useBinaryData('droid')
  const [selectedNode, setSelectedNode] = useState<BinaryGraphNode | null>(null)

  if (data.loading) return <div style={{ padding: 20, color: EMBRY.dim }}>Loading droid features from ArangoDB...</div>
  if (data.error) return <div style={{ padding: 20, color: EMBRY.red }}>{data.error}</div>

  return (
    <div style={{
      width: '100%',
      display: 'flex',
      gap: 0,
      height: 600,
      borderRadius: 12,
      overflow: 'hidden',
      border: `1px solid ${EMBRY.border}`,
      backgroundColor: EMBRY.bg,
    }}>
      {/* Graph pane */}
      <div style={{
        flex: selectedNode ? '0 0 65%' : '1 1 100%',
        transition: 'flex 0.3s ease',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <BinaryGraph
          nodes={data.graphNodes}
          edges={data.graphEdges}
          onNodeClick={(node) => setSelectedNode(
            selectedNode?.id === node.id ? null : node
          )}
        />
      </div>

      {/* Detail pane */}
      {selectedNode && (
        <div style={{
          flex: '0 0 35%',
          borderLeft: `1px solid ${EMBRY.border}`,
          overflowY: 'auto',
          padding: 16,
          backgroundColor: EMBRY.bgPanel,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: EMBRY.white }}>{selectedNode.label}</div>
              <div style={{ fontSize: 10, color: EMBRY.dim, marginTop: 2 }}>
                {selectedNode.nodeType} · {selectedNode.cluster} · {selectedNode.tier}
              </div>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              style={{
                background: 'none', border: `1px solid ${EMBRY.border}`,
                color: EMBRY.dim, borderRadius: 4, padding: '2px 6px', cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>

          {selectedNode.description && (
            <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.7, color: EMBRY.white }}>
              {selectedNode.description}
            </div>
          )}

          {selectedNode.fields && selectedNode.fields.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ ...labelStyle, marginBottom: 6 }}>Fields ({selectedNode.fields.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {selectedNode.fields.slice(0, 12).map((f) => (
                  <span key={f} style={{
                    fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                    padding: '2px 6px', borderRadius: 3,
                    backgroundColor: `${EMBRY.accent}12`, border: `1px solid ${EMBRY.border}`,
                    color: EMBRY.dim,
                  }}>{f}</span>
                ))}
                {selectedNode.fields.length > 12 && (
                  <span style={{ fontSize: 9, color: EMBRY.muted }}>+{selectedNode.fields.length - 12} more</span>
                )}
              </div>
            </div>
          )}

          {selectedNode.states && selectedNode.states.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ ...labelStyle, marginBottom: 6 }}>States ({selectedNode.states.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {selectedNode.states.map((s) => (
                  <span key={s} style={{
                    fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                    padding: '2px 6px', borderRadius: 3,
                    backgroundColor: `${EMBRY.amber}12`, border: `1px solid ${EMBRY.border}`,
                    color: EMBRY.amber,
                  }}>{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Connected edges */}
          <div style={{ marginTop: 12 }}>
            <div style={{ ...labelStyle, marginBottom: 6 }}>Connections</div>
            {data.graphEdges
              .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
              .slice(0, 10)
              .map((e, i) => {
                const otherId = e.source === selectedNode.id ? e.target : e.source
                const other = data.graphNodes.find((n) => n.id === otherId)
                return (
                  <div key={i} style={{
                    fontSize: 10, padding: '3px 0', color: EMBRY.dim,
                    fontFamily: 'JetBrains Mono, monospace',
                  }}>
                    <span style={{ color: EMBRY.muted }}>{e.edgeType}</span>
                    {' → '}
                    <span
                      style={{ color: EMBRY.white, cursor: 'pointer' }}
                      onClick={() => other && setSelectedNode(other)}
                    >
                      {other?.label ?? otherId}
                    </span>
                    {e.sharedField && <span style={{ color: EMBRY.accent, marginLeft: 4 }}>({e.sharedField})</span>}
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ───── LemmaGraph + InspectorPanel composed view ───── */

function LemmaGraphWithInspector() {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const mockWhatIf = async () => sampleWhatIfResponse

  return (
    <div style={{
      width: '100%',
      display: 'flex',
      gap: 0,
      height: 560,
      borderRadius: 12,
      overflow: 'hidden',
      border: `1px solid ${EMBRY.border}`,
      backgroundColor: EMBRY.bg,
    }}>
      {/* Graph pane — expands when inspector is closed */}
      <div style={{
        flex: selectedNode ? '0 0 60%' : '1 1 100%',
        transition: 'flex 0.3s ease',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <LemmaGraph
          nodes={sampleGraphNodes}
          edges={sampleGraphEdges}
          onNodeClick={(node) => setSelectedNode(
            selectedNode?.id === node.id ? null : node
          )}
        />
      </div>

      {/* Inspector pane — slides in from right */}
      {selectedNode && (
        <div style={{
          flex: '0 0 40%',
          borderLeft: `1px solid ${EMBRY.border}`,
          overflowY: 'auto',
          animation: 'slideInRight 0.25s ease-out',
        }}>
          <InspectorPanel
            node={selectedNode}
            edges={sampleGraphEdges}
            onClose={() => setSelectedNode(null)}
            onWhatIf={mockWhatIf}
          />
        </div>
      )}

      {/* Hint overlay when no node selected */}
      {!selectedNode && (
        <div style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '6px 14px',
          borderRadius: 20,
          backgroundColor: `${EMBRY.bgDeep}CC`,
          border: `1px solid ${EMBRY.border}`,
          fontSize: 11,
          color: EMBRY.dim,
          pointerEvents: 'none',
        }}>
          Click a node to inspect edges and run What-If analysis
        </div>
      )}
    </div>
  )
}

/* ───── Composed Explorer with interactive inspector ───── */

function ComposedExplorerMock({ variation }: { variation: string }) {
  const [inspectedNode, setInspectedNode] = useState<GraphNode | null>(null)
  const mockWhatIf = async () => sampleWhatIfResponse

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 12, border: `1px solid ${EMBRY.border}` }}>
      {/* ThoughtTrace — horizontal pipeline bar */}
      <div style={{
        padding: '10px 24px',
        borderBottom: `1px solid rgba(255,255,255,0.08)`,
        backgroundColor: '#0b1326',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}>
        {['Ingest', 'Resolve', 'Map', 'Verify', 'Score'].map((stage, i) => {
          const status = i < 3 ? 'success' : i === 3 ? 'warning' : 'pending'
          const dotColor = status === 'success' ? EMBRY.green : status === 'warning' ? EMBRY.amber : EMBRY.dim
          return (
            <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <div style={{ width: 24, height: 1, backgroundColor: EMBRY.muted }} />}
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                backgroundColor: dotColor,
                boxShadow: status !== 'pending' ? `0 0 10px ${dotColor}99` : 'none',
              }} />
              <span style={{
                fontSize: 10, fontWeight: 900, textTransform: 'uppercase' as const,
                letterSpacing: '0.18em', color: '#cbd5e1',
              }}>{stage}</span>
            </div>
          )
        })}
      </div>

      {/* 3-column waterfall */}
      <div style={{ display: 'flex', height: variation === 'threat-map-focus' ? 600 : 520, overflow: 'hidden', backgroundColor: EMBRY.bg }}>
        {/* PANE 1: Threat Overview (30%) */}
        <div style={{
          width: '30%', borderRight: `1px solid ${EMBRY.border}`,
          padding: 24, overflowY: 'auto' as const,
          display: 'flex', flexDirection: 'column' as const, gap: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 5, height: 16, backgroundColor: EMBRY.blue, borderRadius: 4 }} />
            <span style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase' as const, letterSpacing: '0.2em', color: '#94a3b8' }}>
              Threat Overview
            </span>
          </div>
          <ThreatMap
            tactics={variation === 'threat-map-focus' ? sampleTactics : sampleTactics.slice(0, 5)}
            techniques={variation === 'threat-map-focus' ? sampleTechniques : sampleTechniques.filter((t) => sampleTactics.slice(0, 5).includes(t.tactic))}
          />
        </div>

        {/* PANE 2: Evidence Hub (35%) — graph + inspector */}
        <div style={{
          width: '35%', borderRight: `1px solid ${EMBRY.border}`,
          padding: 24, overflowY: 'auto' as const,
          display: 'flex', flexDirection: 'column' as const, gap: 24,
          backgroundColor: '#111111',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 5, height: 16, backgroundColor: EMBRY.green, borderRadius: 4 }} />
            <span style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase' as const, letterSpacing: '0.2em', color: '#94a3b8' }}>
              Evidence Hub
            </span>
          </div>
          <ControlTable controls={sampleControls} />
          <LemmaGraph
            nodes={sampleGraphNodes}
            edges={sampleGraphEdges}
            onNodeClick={(n) => setInspectedNode(inspectedNode?.id === n.id ? null : n)}
          />
          {inspectedNode && (
            <InspectorPanel
              node={inspectedNode}
              edges={sampleGraphEdges}
              onClose={() => setInspectedNode(null)}
              onWhatIf={mockWhatIf}
            />
          )}
        </div>

        {/* PANE 3: Query & Synthesis (35%) — darkest */}
        <div style={{
          width: '35%',
          padding: 24, overflowY: 'auto' as const,
          display: 'flex', flexDirection: 'column' as const, gap: 16,
          backgroundColor: '#0c0c0c',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 5, height: 16, backgroundColor: EMBRY.amber, borderRadius: 4 }} />
            <span style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase' as const, letterSpacing: '0.2em', color: '#94a3b8' }}>
              Query & Synthesis
            </span>
          </div>
          <IntegrityCard
            status="NOMINAL"
            coveragePercent={92}
            coverageLabel="of controls mapped"
            issueCount={3}
          />
          <ChatWell messages={sampleMessages} />
        </div>
      </div>
    </div>
  )
}

/* ───── Registry ───── */

interface GalleryEntry {
  id: string
  name: string
  folder: string[]  // e.g. ['SPARTA Explorer', 'Threat Map']
  render: (variation: string) => React.ReactNode
  variations: string[]
}

const registry: GalleryEntry[] = [
  {
    id: 'threat-map',
    name: 'ThreatMap',
    folder: ['SPARTA Explorer', 'Threat Map'],
    variations: ['full', 'recon-only'],
    render: (v) => {
      const tactics = v === 'recon-only' ? ['Reconnaissance'] : sampleTactics
      const techs = v === 'recon-only'
        ? sampleTechniques.filter((t) => t.tactic === 'Reconnaissance')
        : sampleTechniques
      return <ThreatMap tactics={tactics} techniques={techs} />
    },
  },
  {
    id: 'lemma-graph',
    name: 'LemmaGraph',
    folder: ['SPARTA Explorer', 'Lemma Graph'],
    variations: ['full', 'validated-only', 'with-inspector'],
    render: (v) => {
      if (v === 'with-inspector') {
        return <LemmaGraphWithInspector />
      }
      const edges = v === 'validated-only'
        ? sampleGraphEdges.filter((e) => e.validated)
        : sampleGraphEdges
      return (
        <div style={{ width: '100%' }}>
          <LemmaGraph nodes={sampleGraphNodes} edges={edges} />
        </div>
      )
    },
  },
  {
    id: 'binary-graph',
    name: 'BinaryGraph',
    folder: ['Binary Explorer', 'Graph'],
    variations: ['live-droid'],
    render: () => <BinaryExplorerView />,
  },
  {
    id: 'control-table',
    name: 'ControlTable',
    folder: ['SPARTA Explorer', 'Tables'],
    variations: ['all', 'issues-only'],
    render: (v) => {
      const controls = v === 'issues-only'
        ? sampleControls.filter((c) => c.issueCount > 0)
        : sampleControls
      return <div style={{ width: '100%', maxWidth: 900 }}><ControlTable controls={controls} /></div>
    },
  },
  {
    id: 'chat-well',
    name: 'ChatWell',
    folder: ['SPARTA Explorer', 'Query'],
    variations: ['with-history', 'empty'],
    render: (v) => (
      <div style={{ width: '100%', maxWidth: 600 }}>
        <ChatWell messages={v === 'empty' ? emptyMessages : sampleMessages} />
      </div>
    ),
  },
  {
    id: 'control-detail',
    name: 'ControlDetail',
    folder: ['SPARTA Explorer', 'Detail'],
    variations: ['with-relations', 'minimal'],
    render: (v) => {
      const data = v === 'minimal'
        ? { id: sampleControlDetail.id, framework: sampleControlDetail.framework, name: sampleControlDetail.name }
        : sampleControlDetail
      return (
        <div style={{ width: '100%', maxWidth: 600 }}>
          <ControlDetail control={data} onClose={() => {}} />
        </div>
      )
    },
  },
  {
    id: 'integrity-card',
    name: 'IntegrityCard',
    folder: ['SPARTA Explorer', 'Integrity'],
    variations: ['nominal', 'degraded', 'critical'],
    render: (v) => {
      const presets = {
        nominal: { status: 'NOMINAL' as const, coveragePercent: 98, issueCount: 0 },
        degraded: { status: 'DEGRADED' as const, coveragePercent: 87, issueCount: 42 },
        critical: { status: 'CRITICAL' as const, coveragePercent: 61, issueCount: 318 },
      }
      const p = presets[v as keyof typeof presets] ?? presets.nominal
      return (
        <div style={{ width: '100%', maxWidth: 400 }}>
          <IntegrityCard status={p.status} coveragePercent={p.coveragePercent} coverageLabel="of edges healthy" issueCount={p.issueCount} />
        </div>
      )
    },
  },
  {
    id: 'inspector-panel',
    name: 'InspectorPanel',
    folder: ['SPARTA Explorer', 'Inspector'],
    variations: ['with-edges', 'with-results', 'no-params'],
    render: (v) => {
      const node = sampleGraphNodes[0] // REC-0001
      const mockWhatIf = async () => sampleWhatIfResponse
      if (v === 'no-params') {
        // AC-2 has only subsumes/maps_to edges — no parameterized predicates
        const noParamNode = sampleGraphNodes[2]
        return (
          <div style={{ width: '100%', maxWidth: 500 }}>
            <InspectorPanel node={noParamNode} edges={sampleInspectorEdges} onClose={() => {}} />
          </div>
        )
      }
      if (v === 'with-results') {
        return (
          <div style={{ width: '100%', maxWidth: 500 }}>
            <InspectorPanel node={node} edges={sampleInspectorEdges} onClose={() => {}} onWhatIf={mockWhatIf} initialResults={sampleWhatIfResponse} />
          </div>
        )
      }
      return (
        <div style={{ width: '100%', maxWidth: 500 }}>
          <InspectorPanel node={node} edges={sampleInspectorEdges} onClose={() => {}} onWhatIf={mockWhatIf} />
        </div>
      )
    },
  },
  {
    id: 'composed-explorer',
    name: 'SPARTA Explorer',
    folder: ['SPARTA Explorer', 'Composed'],
    variations: ['3-column', 'threat-map-focus', 'live'],
    render: (v) => {
      if (v === 'live') return <LiveExplorer variation={v} />
      return <ComposedExplorerMock variation={v} />
    },
  },
  {
    id: 'piano-roll',
    name: 'PianoRollView',
    folder: ['Music Lab', 'Piano Roll'],
    variations: ['default'],
    render: (_v) => (
      <div style={{ width: '100%', maxWidth: 900 }}>
        <PianoRollView
          notes={samplePianoNotes}
          sections={sampleSections}
          bpm={85}
          totalBars={8}
        />
      </div>
    ),
  },
  {
    id: 'waveform',
    name: 'WaveformView',
    folder: ['Music Lab', 'Waveform'],
    variations: ['default', 'no-lyrics'],
    render: (v) => (
      <div style={{ width: '100%', maxWidth: 900 }}>
        <WaveformView
          peaks={samplePeaks}
          bpm={85}
          totalBars={8}
          driftMarkers={sampleDriftMarkers}
          lyrics={v === 'no-lyrics' ? [] : sampleLyricMarkers}
        />
      </div>
    ),
  },
  {
    id: 'convergence-chart',
    name: 'ConvergenceChart',
    folder: ['Music Lab', 'Convergence'],
    variations: ['default'],
    render: (_v) => (
      <div style={{ width: '100%', maxWidth: 620 }}>
        <ConvergenceChart rounds={sampleRounds} />
      </div>
    ),
  },
  {
    id: 'lyrics-editor',
    name: 'LyricsEditor',
    folder: ['Music Lab', 'Lyrics'],
    variations: ['default', 'verse-only'],
    render: (v) => {
      const phrases = v === 'verse-only'
        ? samplePhrases.filter((p) => p.section === 'verse')
        : samplePhrases
      return (
        <div style={{ width: '100%', maxWidth: 700 }}>
          <LyricsEditor phrases={phrases} />
        </div>
      )
    },
  },
  {
    id: 'status-pill',
    name: 'StatusPill',
    folder: ['Unified Lab', 'Status Pill'],
    variations: ['all-variants', 'flash'],
    render: (v) => {
      const variants = ['green', 'amber', 'red', 'blue', 'purple', 'neutral'] as const
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {variants.map((variant) => (
              <StatusPill key={variant} variant={variant} flash={v === 'flash'}>
                {variant}
              </StatusPill>
            ))}
          </div>
          {v === 'all-variants' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <StatusPill variant="green">Promoted</StatusPill>
              <StatusPill variant="amber">Training</StatusPill>
              <StatusPill variant="red">Failed Gate</StatusPill>
              <StatusPill variant="blue">Queued</StatusPill>
              <StatusPill variant="purple">Memorizing</StatusPill>
              <StatusPill variant="neutral">Stale</StatusPill>
            </div>
          )}
        </div>
      )
    },
  },
  {
    id: 'music-lab-dashboard',
    name: 'MusicLabDashboard',
    folder: ['Music Lab', 'Composed'],
    variations: ['default'],
    render: (_v) => (
      <MusicLabDashboard
        spec={{ notes: samplePianoNotes, sections: sampleSections, bpm: 85, totalBars: 8 }}
        lyrics={{ phrases: samplePhrases }}
        convergence={{ rounds: sampleRounds }}
        peaks={samplePeaks}
        driftMarkers={sampleDriftMarkers}
        lyricMarkers={sampleLyricMarkers}
      />
    ),
  },
  {
    id: 'entity-span-viewer',
    name: 'EntitySpanViewer',
    folder: ['Shared Chat', 'Entity Extraction'],
    variations: ['nonsensical', 'compliance', 'aerospace'],
    render: (v) => {
      const queries: Record<string, string> = {
        nonsensical: 'How do ham sandwiches relate to CWE-79?',
        compliance: 'How does the flight management display system affect NIST 800-53 AC-6 compliance?',
        aerospace: 'What challenges does buffer overflow pose for Mission-Operated Ground Systems?',
      }
      return <EntitySpanViewer query={queries[v] || queries.nonsensical} />
    },
  },
  /* ─── scillm Dashboard ─── */
  {
    id: 'scillm-dashboard',
    name: 'ScillmDashboard',
    folder: ['scillm', 'Composed'],
    variations: ['live'],
    render: () => <ScillmDashboard />,
  },
  {
    id: 'scillm-log-table',
    name: 'RealtimeLogTable',
    folder: ['scillm', 'Components'],
    variations: ['default', 'with-errors'],
    render: (v) => {
      const logs = v === 'with-errors'
        ? sampleLogs.filter((l) => l.status === 'error').concat(sampleLogs)
        : sampleLogs
      return <RealtimeLogTable logs={logs} />
    },
  },
]

/* ───── Folder tree helpers ───── */

interface FolderNode {
  name: string
  path: string[]
  children: FolderNode[]
  entries: GalleryEntry[]
}

function buildTree(entries: GalleryEntry[]): FolderNode {
  const root: FolderNode = { name: 'root', path: [], children: [], entries: [] }
  for (const entry of entries) {
    let node = root
    for (const segment of entry.folder) {
      let child = node.children.find((c) => c.name === segment)
      if (!child) {
        child = { name: segment, path: [...node.path, segment], children: [], entries: [] }
        node.children.push(child)
      }
      node = child
    }
    node.entries.push(entry)
  }
  return root
}

/* ───── Styles ───── */

const styles = {
  container: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    backgroundColor: EMBRY.bg,
  },
  sidebar: {
    width: 240,
    backgroundColor: EMBRY.bgPanel,
    borderRight: `1px solid ${EMBRY.border}`,
    overflow: 'auto',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column' as const,
  },
  searchBox: {
    padding: 12,
    borderBottom: `1px solid ${EMBRY.border}`,
  },
  searchInput: {
    width: '100%',
    backgroundColor: EMBRY.bgDeep,
    border: `1px solid ${EMBRY.border}`,
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 12,
    color: EMBRY.white,
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  folderName: {
    ...labelStyle,
    padding: '10px 16px 4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  entryButton: {
    display: 'block',
    width: '100%',
    textAlign: 'left' as const,
    padding: '6px 16px 6px 28px',
    fontSize: 12,
    cursor: 'pointer',
    border: 'none',
    backgroundColor: 'transparent',
    color: EMBRY.white,
    transition: 'all 0.1s',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderBottom: `1px solid ${EMBRY.border}`,
    backgroundColor: EMBRY.bgPanel,
  },
  componentName: {
    fontSize: 15,
    fontWeight: 900,
    color: EMBRY.white,
    flex: 1,
    letterSpacing: '-0.02em',
  },
  variationTab: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    padding: '4px 12px',
    borderRadius: 4,
    cursor: 'pointer',
    border: 'none',
  },
  canvas: {
    flex: 1,
    overflow: 'auto',
    padding: 24,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
}

/* ───── Gallery ───── */

export function ComponentGallery() {
  // Parse initial state from URL hash: #component-id or #component-id/variation
  const parseHash = () => {
    const hash = window.location.hash.slice(1)
    if (!hash) return { id: registry[0].id, variation: '' }
    const [id, v] = hash.split('/')
    return { id, variation: v ?? '' }
  }

  const initial = parseHash()
  const [selectedId, setSelectedId] = useState(
    registry.find((r) => r.id === initial.id) ? initial.id : registry[0].id
  )
  const [search, setSearch] = useState('')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(registry.map((r) => r.folder[0]))
  )

  const entry = registry.find((r) => r.id === selectedId) ?? registry[0]
  const [variation, setVariation] = useState(
    initial.variation && entry.variations.includes(initial.variation) ? initial.variation : entry.variations[0]
  )

  // Sync hash → state on popstate
  useEffect(() => {
    const onHash = () => {
      const { id, variation: v } = parseHash()
      const e = registry.find((r) => r.id === id)
      if (e) {
        setSelectedId(id)
        setVariation(v && e.variations.includes(v) ? v : e.variations[0])
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const handleSelect = (id: string) => {
    setSelectedId(id)
    const e = registry.find((r) => r.id === id)
    if (e) {
      setVariation(e.variations[0])
      window.location.hash = id
    }
  }

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // Filter by search
  const filtered = search
    ? registry.filter((r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.folder.some((f) => f.toLowerCase().includes(search.toLowerCase()))
    )
    : registry

  const tree = buildTree(filtered)

  function renderFolder(node: FolderNode, depth = 0) {
    const key = node.path.join('/')
    const expanded = expandedFolders.has(key) || !!search
    return (
      <div key={key}>
        {node.name !== 'root' && (
          <div
            style={{ ...styles.folderName, paddingLeft: 16 + depth * 12 }}
            onClick={() => toggleFolder(key)}
          >
            <span style={{ fontSize: 8, color: EMBRY.dim }}>{expanded ? '▼' : '▶'}</span>
            {node.name}
          </div>
        )}
        {expanded && (
          <>
            {node.entries.map((e) => (
              <button
                key={e.id}
                style={{
                  ...styles.entryButton,
                  paddingLeft: 28 + depth * 12,
                  backgroundColor: e.id === selectedId ? `${EMBRY.blue}18` : 'transparent',
                  borderLeft: e.id === selectedId ? `2px solid ${EMBRY.blue}` : '2px solid transparent',
                }}
                onClick={() => handleSelect(e.id)}
              >
                {e.name}
              </button>
            ))}
            {node.children.map((child) => renderFolder(child, depth + 1))}
          </>
        )}
      </div>
    )
  }

  return (
    <div style={styles.container} data-qid="gallery:root">
      {/* Sidebar — folder tree + search */}
      <div style={styles.sidebar}>
        <div style={styles.searchBox}>
          <input
            style={styles.searchInput as React.CSSProperties}
            placeholder="Search components..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {tree.children.map((child) => renderFolder(child))}
        </div>
      </div>

      {/* Main — component preview */}
      <div style={styles.main}>
        <div style={styles.toolbar}>
          <span style={styles.componentName}>{entry.name}</span>
          <span style={{ fontSize: 10, color: EMBRY.dim }}>{entry.folder.join(' / ')}</span>
          <div style={{ width: 1, height: 16, backgroundColor: EMBRY.border, margin: '0 8px' }} />
          {entry.variations.map((v) => (
            <button
              key={v}
              style={{
                ...styles.variationTab,
                backgroundColor: v === variation ? EMBRY.blue : EMBRY.bgDeep,
                color: v === variation ? '#fff' : EMBRY.dim,
              }}
              onClick={() => { setVariation(v); window.location.hash = `${selectedId}/${v}` }}
            >
              {v}
            </button>
          ))}
        </div>
        <div style={styles.canvas}>
          {entry.render(variation)}
        </div>
      </div>
    </div>
  )
}
