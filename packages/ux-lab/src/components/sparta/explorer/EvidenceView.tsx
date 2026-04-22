import { useState } from 'react'
import { CheckCircle2, XCircle, AlertCircle, ShieldCheck, RefreshCw, ArrowRight, Link2, FileText, ChevronDown, ChevronRight } from 'lucide-react'
import { EMBRY, body } from '../common/EmbryStyle'
import { inlineHighlight, spanHighlight } from './explorerUtils'
import type { EvidenceCase, CrosswalkChain, EvidenceSpan } from '../../../hooks/useSpartaCollections'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { MarkdownRenderer } from '../../shared-chat/MarkdownRenderer'

// Framework colors per NVIS standard
const FW_COLORS: Record<string, string> = {
  SPARTA: '#3B82F6',
  CWE: '#F97316',
  NIST: '#22C55E',
  CAPEC: '#EF4444',
  'ATT&CK': '#A855F7',
  D3FEND: '#00ff88',
}

interface LiveEvidenceCase {
  question: string
  markdown_report?: string
  gates: Array<{ gate: string; passed: boolean; score?: number; detail: string }>
  confidence: number
  entities: string[]
  total_time_ms: number
}

interface EvidenceViewProps {
  question: string
  qraKey?: string
  reasoning?: string
  groundingScore?: number
  storedEvidenceCase?: EvidenceCase | null
  onClose?: () => void
}

/** Render a single crosswalk chain as a visual path */
function CrosswalkChainView({ chain }: { chain: CrosswalkChain }) {
  const hops = chain.hops || []
  // Handle both field name conventions: source/target OR from/from_framework/to_framework
  const sourceId = chain.source || (chain as any).from || ''
  const sourceFw = (chain as any).from_framework || 'source'
  const targetFw = (chain as any).to_framework || 'target'
  // Target is last hop's control_id, or explicit target field
  const lastHop = hops[hops.length - 1]
  const targetId = chain.target || lastHop?.control_id || lastHop?.id || ''

  const allNodes = [
    { control_id: sourceId, framework: sourceFw, name: undefined as string | undefined },
    ...hops.map(h => ({ control_id: h.control_id || h.id, framework: h.framework, name: h.name })),
    // Only add target node if it's different from last hop
    ...(targetId && targetId !== (lastHop?.control_id || lastHop?.id) ? [{ control_id: targetId, framework: targetFw, name: undefined as string | undefined }] : []),
  ]

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '8px 10px',
      backgroundColor: 'rgba(0,0,0,0.3)',
      borderRadius: 6,
      border: `1px solid ${EMBRY.border}`,
      flexWrap: 'wrap',
    }}>
      {allNodes.map((node, idx) => {
        const fw = node.framework?.toUpperCase() || 'UNKNOWN'
        const color = FW_COLORS[fw] || EMBRY.dim
        const isLast = idx === allNodes.length - 1

        return (
          <div key={`${node.control_id}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              title={node.name || node.framework}
              style={{
                fontSize: 10,
                fontWeight: 700,
                fontFamily: 'monospace',
                padding: '3px 6px',
                borderRadius: 4,
                backgroundColor: `${color}20`,
                color,
                border: `1px solid ${color}40`,
              }}
            >
              {node.control_id}
            </span>
            {!isLast && <ArrowRight size={12} color={EMBRY.dim} />}
          </div>
        )
      })}
      {chain.method && (
        <span style={{
          fontSize: 9,
          color: EMBRY.dim,
          marginLeft: 'auto',
          fontStyle: 'italic',
        }}>
          via {chain.method}
        </span>
      )}
      {chain.confidence !== undefined && (
        <span style={{
          fontSize: 9,
          color: chain.confidence >= 0.8 ? EMBRY.green : EMBRY.amber,
          fontWeight: 700,
        }}>
          {Math.round(chain.confidence * 100)}%
        </span>
      )}
    </div>
  )
}

/** Section header component */
function SectionHeader({ icon: Icon, label: text, color }: { icon: typeof Link2; label: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      <Icon size={12} color={color || EMBRY.accent} />
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: color || EMBRY.accent, textTransform: 'uppercase' }}>
        {text}
      </span>
    </div>
  )
}

export function EvidenceView({ question, reasoning, groundingScore, storedEvidenceCase }: EvidenceViewProps) {
  useRegisterAction('qras:action:validate_evidence', { app: 'sparta-explorer', action: 'VALIDATE_EVIDENCE', label: 'Validate Evidence', description: 'Run /create-evidence-case validation pipeline' })

  const [liveData, setLiveData] = useState<LiveEvidenceCase | null>(null)
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasoningExpanded, setReasoningExpanded] = useState(false)

  const runValidation = async () => {
    setValidating(true)
    setError(null)
    try {
      const res = await fetch('http://localhost:3001/api/evidence/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      if (!res.ok) throw new Error(`Pipeline failed: ${res.status}`)
      setLiveData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setValidating(false)
    }
  }

  const ec = storedEvidenceCase
  const chains = ec?.crosswalk_chains || ec?.chains || []
  const glossary = ec?.glossary || []
  const controlIds = ec?.control_ids || []
  const methods = ec?.methods || []
  const reviewStatus = ec?.review_status || 'pending'
  const confidence = ec?.confidence !== undefined
    ? Math.round(ec.confidence * 100)
    : (groundingScore ? Math.round(groundingScore * 100) : null)
  const formalProof = ec?.formal_proof
  const spans = ec?.spans as EvidenceSpan[] | undefined

  const itemStyle = { marginBottom: 16 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: EMBRY.bg }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'monospace' }}>

        {/* Claim Section */}
        <div style={itemStyle}>
          <SectionHeader icon={FileText} label="Claim" />
          <div style={{ fontSize: 12, color: EMBRY.white, lineHeight: 1.5 }}>
            {spans ? spanHighlight(question, spans, glossary) : inlineHighlight(question, glossary)}
          </div>
        </div>

        {/* Verdict & Confidence Row */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Verdict</div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              color: reviewStatus === 'approved' ? EMBRY.green : reviewStatus === 'auto' ? EMBRY.amber : EMBRY.dim,
              fontSize: 11, fontWeight: 700,
            }}>
              {reviewStatus === 'approved' && <CheckCircle2 size={12} />}
              {reviewStatus === 'auto' && <RefreshCw size={12} />}
              {reviewStatus === 'pending' && <AlertCircle size={12} />}
              {reviewStatus.toUpperCase()}
            </div>
          </div>
          {confidence !== null && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Confidence</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: confidence >= 80 ? EMBRY.green : EMBRY.amber }}>
                {confidence}%
              </div>
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Formal Proof</div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11, fontWeight: 700,
              color: formalProof ? (formalProof.success ? EMBRY.green : EMBRY.red) : EMBRY.dim,
            }}>
              {formalProof ? (formalProof.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />) : <AlertCircle size={12} />}
              {formalProof ? (formalProof.success ? 'VERIFIED' : 'FAILED') : 'UNVERIFIED'}
            </div>
          </div>
        </div>

        {/* Methods Used */}
        {methods.length > 0 && (
          <div style={itemStyle}>
            <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Methods</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {methods.map(m => (
                <span key={m} style={{
                  fontSize: 9, padding: '2px 6px', borderRadius: 3,
                  backgroundColor: `${EMBRY.blue}20`, color: EMBRY.blue,
                  border: `1px solid ${EMBRY.blue}40`,
                }}>{m}</span>
              ))}
            </div>
          </div>
        )}

        {/* Crosswalk Chains — THE KEY SECTION */}
        {chains.filter(c => c.source || c.target || (c.hops && c.hops.length > 0)).length > 0 && (
          <div style={itemStyle}>
            <SectionHeader icon={Link2} label="Crosswalk Chains" color={EMBRY.green} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {chains.filter(c => c.source || c.target || (c.hops && c.hops.length > 0)).map((chain, idx) => (
                <CrosswalkChainView key={`chain-${idx}`} chain={chain} />
              ))}
            </div>
          </div>
        )}

        {/* No chains message */}
        {chains.filter(c => c.source || c.target || (c.hops && c.hops.length > 0)).length === 0 && (
          <div style={{
            ...itemStyle,
            padding: '12px',
            backgroundColor: 'rgba(255,170,0,0.1)',
            border: `1px solid ${EMBRY.amber}40`,
            borderRadius: 6,
          }}>
            <div style={{ fontSize: 10, color: EMBRY.amber, fontWeight: 600 }}>
              No crosswalk chains found
            </div>
            <div style={{ fontSize: 9, color: EMBRY.dim, marginTop: 4 }}>
              This QRA is informational only — no framework-to-framework edges exist in sparta_relationships.
            </div>
          </div>
        )}

        {/* Source Control IDs */}
        {controlIds.length > 0 && (
          <div style={itemStyle}>
            <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Source Controls</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {controlIds.map(id => (
                <span key={id} style={{
                  fontSize: 10, padding: '3px 7px',
                  backgroundColor: `${EMBRY.accent}15`, color: EMBRY.accent,
                  border: `1px solid ${EMBRY.accent}30`, borderRadius: 4,
                  fontFamily: 'monospace',
                }}>{id}</span>
              ))}
            </div>
          </div>
        )}

        {/* Glossary / Symbol Definitions */}
        {glossary.length > 0 && (
          <div style={itemStyle}>
            <SectionHeader icon={FileText} label="Symbol Definitions" color={EMBRY.dim} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {glossary.slice(0, 8).map(g => {
                const color = FW_COLORS[g.framework?.toUpperCase()] || EMBRY.dim
                return (
                  <div key={g.id} style={{
                    padding: '6px 8px', borderRadius: 4,
                    background: 'rgba(0,0,0,0.2)', border: `1px solid ${EMBRY.border}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color, fontFamily: 'monospace' }}>{g.id}</span>
                      <span style={{ fontSize: 8, color: EMBRY.dim, opacity: 0.7 }}>{g.framework}</span>
                    </div>
                    <div style={{ fontSize: 10, color: EMBRY.white, marginTop: 2 }}>{g.name}</div>
                    {g.description && (
                      <div style={{ fontSize: 9, color: EMBRY.dim, marginTop: 3, lineHeight: 1.4 }}>
                        {g.description.length > 100 ? g.description.slice(0, 100) + '...' : g.description}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Reasoning */}
        {reasoning && (
          <div style={itemStyle}>
            <button
              data-qid="qras:evidence:toggle-reasoning"
              data-qs-action="TOGGLE_REASONING"
              title="Toggle Evidence Context reasoning"
              onClick={() => setReasoningExpanded((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'none',
                border: 'none',
                padding: 0,
                marginBottom: reasoningExpanded ? 6 : 0,
                cursor: 'pointer',
              }}
            >
              {reasoningExpanded ? <ChevronDown size={12} color={EMBRY.dim} /> : <ChevronRight size={12} color={EMBRY.dim} />}
              <span style={{ fontSize: 9, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1 }}>Reasoning</span>
              {!reasoningExpanded && (
                <span style={{ fontSize: 10, color: EMBRY.muted, fontStyle: 'italic' }}>
                  ({reasoning.split('\n').length} lines)
                </span>
              )}
            </button>
            {reasoningExpanded && (
              <div
                style={{
                  fontSize: 11,
                  color: EMBRY.dim,
                  lineHeight: 1.6,
                  backgroundColor: 'rgba(0,0,0,0.2)',
                  padding: 8,
                  borderRadius: 5,
                  border: `1px solid ${EMBRY.border}`,
                }}
              >
                <MarkdownRenderer content={reasoning} />
              </div>
            )}
          </div>
        )}

        {/* Pipeline Gates (from live validation) */}
        {liveData && (
          <div style={{ marginTop: 4, borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12 }}>
            <SectionHeader icon={ShieldCheck} label="Pipeline Gates" />
            {liveData.gates.map(gate => {
              const color = gate.passed ? EMBRY.green : EMBRY.red
              const Icon = gate.passed ? CheckCircle2 : XCircle
              return (
                <div key={gate.gate} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <Icon size={12} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 10, color: EMBRY.white, fontWeight: 700 }}>{gate.gate.toUpperCase()}</div>
                    <div style={{ fontSize: 9, color: EMBRY.dim }}>{gate.detail}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {error && (
          <div style={{ ...body, fontSize: 10, color: EMBRY.red, marginTop: 8 }}>
            <AlertCircle size={11} style={{ display: 'inline', marginRight: 4 }} />
            {error}
          </div>
        )}
      </div>

      {/* Footer: Validate button */}
      <div style={{ padding: '10px 16px', borderTop: `1px solid ${EMBRY.border}`, flexShrink: 0, backgroundColor: 'rgba(0,0,0,0.2)' }}>
        <button
          data-qid="qras:action:validate_evidence"
          data-qs-action="VALIDATE_EVIDENCE"
          title="Run /create-evidence-case validation pipeline"
          onClick={runValidation}
          disabled={validating}
          style={{
            width: '100%', padding: '8px 0', borderRadius: 5, cursor: validating ? 'wait' : 'pointer',
            backgroundColor: validating ? EMBRY.bgDeep : `${EMBRY.accent}15`,
            border: `1px solid ${EMBRY.accent}33`,
            color: EMBRY.accent, fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            textTransform: 'uppercase', letterSpacing: 1,
          }}
        >
          {validating
            ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Validating...</>
            : <><ShieldCheck size={12} /> Run /create-evidence-case</>
          }
        </button>
      </div>
    </div>
  )
}
