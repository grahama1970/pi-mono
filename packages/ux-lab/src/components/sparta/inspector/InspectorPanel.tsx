import { useState, useEffect } from 'react'
import { EMBRY, card, heading, label, body, fwBadge, glowDot } from '../common/EmbryStyle'
import type { GraphNode, GraphEdge } from '../lemma-graph/LemmaGraph'

export interface WhatIfResult {
  chain: string
  controls: string[]
  predicate: string
  status: 'BROKEN' | 'HOLDS' | 'DRY_RUN' | 'ERROR'
  lean_code?: string
}

export interface WhatIfResponse {
  control: string
  parameter: string
  new_value: unknown
  affected_chains: WhatIfResult[]
  summary: { total: number; broken: number; held: number; dry_run?: number }
}

export interface InspectorPanelProps {
  node: GraphNode
  edges: GraphEdge[]
  onClose?: () => void
  onWhatIf?: (controlId: string, param: string, value: unknown) => Promise<WhatIfResponse | null>
  /** Pre-populate cascade results (for gallery demos) */
  initialResults?: WhatIfResponse | null
}

const PREDICATE_PARAMS: Record<string, { type: 'bool' | 'float' | 'enum'; label: string }> = {
  countered_by: { type: 'bool', label: 'enabled' },
  mitigated_by: { type: 'float', label: 'coverage' },
  exploits: { type: 'bool', label: 'vulnerable' },
}

function normalizeMethod(method: string): string {
  return method.replace(/-/g, '_').toLowerCase()
}

export function InspectorPanel({ node, edges, onClose, onWhatIf, initialResults }: InspectorPanelProps) {
  const fwColor = EMBRY.fw[node.framework] ?? EMBRY.dim

  // Find edges connected to this node
  const connectedEdges = edges.filter((e) => e.source === node.id || e.target === node.id)

  // Derive available parameters from connected edge predicates
  const predicates = [...new Set(connectedEdges.map((e) => normalizeMethod(e.method)))]
  const availableParams = predicates
    .filter((p) => p in PREDICATE_PARAMS)
    .map((p) => ({ predicate: p, ...PREDICATE_PARAMS[p] }))

  // Parameter editor state
  const [selectedParam, setSelectedParam] = useState(availableParams[0]?.label ?? '')
  const [boolValue, setBoolValue] = useState(true)
  const [floatValue, setFloatValue] = useState(0.8)
  const [enumValue, setEnumValue] = useState('NOMINAL')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<WhatIfResponse | null>(initialResults ?? null)

  // Sync initialResults prop when it changes (e.g. gallery variation switch)
  useEffect(() => { setResults(initialResults ?? null) }, [initialResults])

  const currentParamDef = availableParams.find((p) => p.label === selectedParam)

  async function handleWhatIf() {
    if (!onWhatIf || !currentParamDef) return
    setLoading(true)
    setResults(null)
    try {
      const value = currentParamDef.type === 'bool' ? boolValue
        : currentParamDef.type === 'float' ? floatValue
        : enumValue
      const res = await onWhatIf(node.id, selectedParam, value)
      setResults(res)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: `1px solid ${EMBRY.border}`,
        backgroundColor: `${fwColor}0F`,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={fwBadge(node.framework)}>{node.framework}</span>
            <span style={{
              fontFamily: 'monospace',
              fontSize: 12,
              fontWeight: 700,
              color: fwColor,
            }}>
              {node.id}
            </span>
          </div>
          <div style={{ ...heading, fontSize: 16 }}>{node.label}</div>
        </div>
        {onClose && (
          <button data-qid="inspector-inspectorpanel:auto:107" data-qs-action="INSPECTOR_INSPECTORPANEL_AUTO_107"
            onClick={onClose}
            style={{
              backgroundColor: 'transparent',
              border: `1px solid ${EMBRY.border}`,
              borderRadius: 6,
              color: EMBRY.dim,
              fontSize: 11,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        )}
      </div>

      {/* Rob Armstrong: Proof Status */}
      {node.proofStatus && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 8 }}>Proof Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              padding: '6px 12px',
              borderRadius: 6,
              backgroundColor: EMBRY.bgDeep,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span style={{
                fontSize: 16,
                color: node.proofStatus === 'proved' ? EMBRY.green
                  : node.proofStatus === 'sorry' ? EMBRY.red
                  : node.proofStatus === 'axiom' ? EMBRY.blue
                  : EMBRY.amber,
              }}>
                {node.proofStatus === 'proved' ? '✓' : node.proofStatus === 'sorry' ? '⚠' : node.proofStatus === 'axiom' ? '∎' : '◐'}
              </span>
              <div>
                <div style={{
                  fontFamily: 'monospace', fontSize: 12, fontWeight: 900,
                  color: node.proofStatus === 'proved' ? EMBRY.green
                    : node.proofStatus === 'sorry' ? EMBRY.red
                    : node.proofStatus === 'axiom' ? EMBRY.blue
                    : EMBRY.amber,
                  textTransform: 'uppercase',
                }}>
                  {node.proofStatus === 'sorry' ? 'SORRY (unproved)' : node.proofStatus}
                </div>
                {node.proofStatus === 'sorry' && (
                  <div style={{ ...body, fontSize: 10, color: EMBRY.red, marginTop: 2 }}>
                    Lean4 subgoal requires proof — blocks downstream chain
                  </div>
                )}
              </div>
            </div>
            {node.confidence != null && node.confidence > 0 && (
              <div style={{
                padding: '6px 12px',
                borderRadius: 6,
                backgroundColor: EMBRY.bgDeep,
                textAlign: 'center' as const,
              }}>
                <div style={{
                  fontFamily: 'monospace', fontSize: 16, fontWeight: 900,
                  color: node.confidence > 0.7 ? EMBRY.green : node.confidence > 0.4 ? EMBRY.amber : EMBRY.red,
                }}>
                  {(node.confidence * 100).toFixed(0)}%
                </div>
                <div style={{ fontSize: 8, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  confidence
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Brandon Bailey: Source Traceability */}
      {node.sourceCount != null && node.sourceCount > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 8 }}>Source Traceability</div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 6,
            backgroundColor: EMBRY.bgDeep,
          }}>
            <span style={{
              fontFamily: 'monospace', fontSize: 18, fontWeight: 900,
              color: node.sourceCount >= 5 ? EMBRY.green : node.sourceCount >= 3 ? EMBRY.amber : EMBRY.red,
            }}>
              {node.sourceCount}
            </span>
            <div>
              <div style={{ ...body, fontSize: 11, color: EMBRY.white }}>
                source document{node.sourceCount !== 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: 9, color: EMBRY.dim }}>
                {node.sourceCount >= 5 ? 'Strong traceability' : node.sourceCount >= 3 ? 'Moderate traceability' : 'Weak — needs more sources'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Connected edges */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
        <div style={{ ...label, marginBottom: 8 }}>
          Edges ({connectedEdges.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {connectedEdges.map((edge, i) => {
            const isSource = edge.source === node.id
            const otherId = isSource ? edge.target : edge.source
            return (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 6,
                backgroundColor: EMBRY.bgDeep,
              }}>
                <div style={glowDot(edge.validated ? EMBRY.green : EMBRY.red, 6)} />
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  fontWeight: 700,
                  color: EMBRY.white,
                }}>
                  {isSource ? `→ ${otherId}` : `${otherId} →`}
                </span>
                <span style={{
                  fontSize: 9,
                  color: EMBRY.dim,
                  padding: '2px 6px',
                  borderRadius: 4,
                  backgroundColor: `${EMBRY.muted}44`,
                  marginLeft: 'auto',
                }}>
                  {edge.method}
                </span>
              </div>
            )
          })}
          {connectedEdges.length === 0 && (
            <div style={{ ...body, color: EMBRY.dim, fontSize: 11 }}>No edges connected</div>
          )}
        </div>
      </div>

      {/* Parameter editor */}
      {availableParams.length > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 10 }}>What-If Parameters</div>

          {/* Parameter selector */}
          {availableParams.length > 1 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {availableParams.map((p) => (
                <button data-qid="inspector-inspectorpanel:auto:272" data-qs-action="INSPECTOR_INSPECTORPANEL_AUTO_272"
                  key={p.label}
                  onClick={() => setSelectedParam(p.label)}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '4px 10px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    border: `1px solid ${selectedParam === p.label ? EMBRY.accent : EMBRY.border}`,
                    backgroundColor: selectedParam === p.label ? `${EMBRY.accent}22` : 'transparent',
                    color: selectedParam === p.label ? EMBRY.accent : EMBRY.dim,
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Typed control */}
          {currentParamDef && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ ...body, fontSize: 12, color: EMBRY.dim, minWidth: 70 }}>
                {currentParamDef.label}:
              </span>

              {currentParamDef.type === 'bool' && (
                <button data-qid="inspector-inspectorpanel:auto:299" data-qs-action="INSPECTOR_INSPECTORPANEL_AUTO_299"
                  onClick={() => setBoolValue(!boolValue)}
                  style={{
                    padding: '4px 14px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: `1px solid ${boolValue ? EMBRY.green : EMBRY.red}44`,
                    backgroundColor: boolValue ? `${EMBRY.green}18` : `${EMBRY.red}18`,
                    color: boolValue ? EMBRY.green : EMBRY.red,
                  }}
                >
                  {boolValue ? 'TRUE' : 'FALSE'}
                </button>
              )}

              {currentParamDef.type === 'float' && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input data-qid="inspector-inspectorpanel:auto:323" data-qs-action="INSPECTOR_INSPECTORPANEL_AUTO_323"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={floatValue}
                    onChange={(e) => setFloatValue(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: EMBRY.accent }}
                  />
                  <span style={{
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: EMBRY.white,
                    minWidth: 36,
                    textAlign: 'right',
                  }}>
                    {(floatValue * 100).toFixed(0)}%
                  </span>
                </div>
              )}

              {currentParamDef.type === 'enum' && (
                <div style={{ display: 'flex', gap: 4 }}>
                  {['NOMINAL', 'DEGRADED', 'CRITICAL'].map((v) => (
                    <button data-qid="inspector-inspectorpanel:auto:343" data-qs-action="INSPECTOR_INSPECTORPANEL_AUTO_343"
                      key={v}
                      onClick={() => setEnumValue(v)}
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        border: `1px solid ${enumValue === v ? EMBRY.accent : EMBRY.border}`,
                        backgroundColor: enumValue === v ? `${EMBRY.accent}22` : 'transparent',
                        color: enumValue === v ? EMBRY.accent : EMBRY.dim,
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* What-If trigger */}
          <button data-qid="inspector-inspectorpanel:auto:365" data-qs-action="INSPECTOR_INSPECTORPANEL_AUTO_365"
            onClick={handleWhatIf}
            disabled={loading || !onWhatIf}
            style={{
              width: '100%',
              padding: '8px 16px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 900,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              cursor: loading ? 'wait' : 'pointer',
              border: `1px solid ${EMBRY.accent}66`,
              backgroundColor: `${EMBRY.accent}22`,
              color: EMBRY.accent,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Analyzing…' : 'What If?'}
          </button>
        </div>
      )}

      {/* No parameters available */}
      {availableParams.length === 0 && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 6 }}>What-If Parameters</div>
          <div style={{ ...body, color: EMBRY.dim, fontSize: 11 }}>
            No parameterized predicates on this node (subsumes, maps_to are structural)
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <div style={{ padding: '12px 20px' }}>
          <div style={{ ...label, marginBottom: 8 }}>
            Cascade Results
          </div>

          {/* Summary bar */}
          <div style={{
            display: 'flex',
            gap: 12,
            marginBottom: 10,
            padding: '8px 12px',
            borderRadius: 6,
            backgroundColor: EMBRY.bgDeep,
          }}>
            <SummaryBadge count={results.summary.total} label="total" color={EMBRY.white} />
            <SummaryBadge count={results.summary.broken} label="broken" color={EMBRY.red} />
            <SummaryBadge count={results.summary.held} label="held" color={EMBRY.green} />
          </div>

          {/* Chain results */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {results.affected_chains.map((chain, i) => {
              const statusColor = chain.status === 'BROKEN' ? EMBRY.red
                : chain.status === 'HOLDS' ? EMBRY.green
                : chain.status === 'DRY_RUN' ? EMBRY.amber
                : EMBRY.dim
              return (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 6,
                  backgroundColor: EMBRY.bgDeep,
                }}>
                  <div style={glowDot(statusColor, 6)} />
                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    color: statusColor,
                    backgroundColor: `${statusColor}18`,
                    border: `1px solid ${statusColor}33`,
                  }}>
                    {chain.status}
                  </span>
                  <span style={{
                    fontFamily: 'monospace',
                    fontSize: 10,
                    color: EMBRY.white,
                    flex: 1,
                  }}>
                    {chain.chain}
                  </span>
                  <span style={{
                    fontSize: 9,
                    color: EMBRY.dim,
                    padding: '2px 6px',
                    borderRadius: 4,
                    backgroundColor: `${EMBRY.muted}44`,
                  }}>
                    {chain.predicate}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryBadge({ count, label: l, color }: { count: number; label: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 900, color }}>{count}</span>
      <span style={{ fontSize: 9, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{l}</span>
    </div>
  )
}
