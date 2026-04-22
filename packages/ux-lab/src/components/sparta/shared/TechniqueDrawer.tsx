/**
 * TechniqueDrawer — Mobile side drawer for technique details ("Z-Axis Shift").
 *
 * Architecture:
 * - Slides from right, backdrop blur
 * - COTS C02: 44px touch targets
 * - Escape key to close via useRegisterAction
 *
 * Complies with:
 * - COTS C02: 44px minimum touch targets
 * - NVIS Class A: White Phosphor palette
 * - 4-Attribute Rule: data-qid, data-qs-action, title, useRegisterAction
 */
import { useEffect, useCallback, useState } from 'react'
import { X, ChevronDown } from 'lucide-react'
import { EMBRY, glowDot, fwBadge, label } from '../common/EmbryStyle'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import type { TechniqueDetail, ThreatTechnique } from './ThreatMatrix'

export interface TechniqueDrawerProps {
  detail: TechniqueDetail | null
  loading: boolean
  onClose: () => void
}

const TRANSITION = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'

const COVERAGE_COLORS: Record<string, string> = {
  full: EMBRY.green,
  partial: EMBRY.amber,
  none: EMBRY.red,
  unknown: EMBRY.dim,
}

interface CollapsibleSectionProps {
  title: string
  qid: string
  defaultOpen?: boolean
  children: React.ReactNode
}

function CollapsibleSection({ title, qid, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
      <button
        data-qid={`technique-drawer:section:${qid}`}
        data-qs-action="TOGGLE_SECTION"
        title={`${isOpen ? 'Collapse' : 'Expand'} ${title}`}
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          minHeight: 44,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          border: 'none',
          backgroundColor: 'transparent',
          cursor: 'pointer',
        }}
      >
        <span style={{ ...label, color: isOpen ? EMBRY.white : EMBRY.dim }}>{title}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          style={{
            color: EMBRY.dim,
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: TRANSITION,
          }}
        />
      </button>
      {isOpen && <div style={{ padding: '0 16px 12px' }}>{children}</div>}
    </div>
  )
}

export function TechniqueDrawer({ detail, loading, onClose }: TechniqueDrawerProps) {
  // 4-attribute rule: register actions to ArangoDB app_actions
  useRegisterAction('technique-drawer:close', {
    app: 'sparta-explorer',
    action: 'CLOSE_DRAWER',
    label: 'Close Drawer',
    description: 'Close the technique detail drawer',
    tags: ['sparta', 'drawer', 'navigation'],
  })
  useRegisterAction('technique-drawer:section', {
    app: 'sparta-explorer',
    action: 'TOGGLE_SECTION',
    label: 'Toggle Section',
    description: 'Expand or collapse a section in the technique drawer',
    tags: ['sparta', 'drawer', 'accordion'],
  })

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!detail) return null

  const { technique: tech, qras, countermeasures, relationships, traceability, evidenceCases, discrepancies } = detail
  const traceTypes = traceability ? Object.keys(traceability).sort() : []
  const totalChunks = traceTypes.reduce((sum, t) => sum + (traceability?.[t]?.length ?? 0), 0)

  return (
    <>
      {/* Backdrop */}
      <div
        data-qid="technique-drawer:backdrop"
        data-qs-action="CLOSE_DRAWER"
        title="Close drawer"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 200,
        }}
      />

      {/* Drawer */}
      <div
        data-qid="technique-drawer:panel"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(380px, 90vw)',
          backgroundColor: EMBRY.bgPanel,
          borderLeft: `1px solid ${EMBRY.border}`,
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px',
            borderBottom: `1px solid ${EMBRY.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  fontFamily: 'monospace',
                  fontSize: 14,
                  fontWeight: 700,
                  color: EMBRY.accent,
                }}
              >
                {tech.id}
              </span>
              <div style={glowDot(COVERAGE_COLORS[tech.coverage] ?? EMBRY.dim, 8)} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: EMBRY.white, lineHeight: 1.3 }}>{tech.name}</div>
            <div style={{ fontSize: 11, color: EMBRY.dim, marginTop: 4 }}>{tech.tactic}</div>
          </div>

          <button
            data-qid="technique-drawer:close"
            data-qs-action="CLOSE_DRAWER"
            title="Close drawer (Escape)"
            onClick={onClose}
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: `1px solid ${EMBRY.border}`,
              borderRadius: 8,
              backgroundColor: 'transparent',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <X size={18} strokeWidth={1.5} style={{ color: EMBRY.dim }} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 120,
                color: EMBRY.dim,
              }}
            >
              Loading details...
            </div>
          ) : (
            <>
              {/* Evidence Cases */}
              {(evidenceCases?.length ?? 0) > 0 && (
                <CollapsibleSection title={`Evidence (${evidenceCases!.length})`} qid="evidence" defaultOpen>
                  {evidenceCases!.map((ec, i) => {
                    const vColor =
                      ec.verdict === 'satisfied' ? EMBRY.green : ec.verdict === 'inconclusive' ? EMBRY.amber : EMBRY.red
                    return (
                      <div
                        key={`ec-${i}`}
                        style={{
                          marginBottom: 8,
                          borderRadius: 6,
                          border: `1px solid ${vColor}33`,
                          overflow: 'hidden',
                        }}
                      >
                        <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={glowDot(vColor, 6)} />
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: vColor,
                              textTransform: 'uppercase',
                            }}
                          >
                            {ec.verdict.replace('_', ' ')}
                          </span>
                          <span style={{ fontSize: 9, color: EMBRY.dim, fontFamily: 'monospace' }}>{ec.grade}</span>
                          <span
                            style={{
                              fontSize: 9,
                              color: EMBRY.muted,
                              fontFamily: 'monospace',
                              marginLeft: 'auto',
                            }}
                          >
                            {ec.gates_passed}/{ec.gates_total} gates
                          </span>
                        </div>
                        <div
                          style={{
                            padding: '4px 10px 6px',
                            fontSize: 11,
                            color: EMBRY.dim,
                            lineHeight: 1.4,
                          }}
                        >
                          {ec.question.slice(0, 120)}
                          {ec.question.length > 120 ? '...' : ''}
                        </div>
                      </div>
                    )
                  })}
                </CollapsibleSection>
              )}

              {/* Description */}
              {tech.description && (
                <CollapsibleSection title="Description" qid="description">
                  <div style={{ fontSize: 12, color: EMBRY.dim, lineHeight: 1.5 }}>{tech.description}</div>
                </CollapsibleSection>
              )}

              {/* Mind Tags */}
              <CollapsibleSection title="Mind Tags" qid="mind-tags">
                {(tech.mind?.length ?? 0) > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {tech.mind!.map((tag) => (
                      <span
                        key={tag}
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 4,
                          backgroundColor: `${EMBRY.accent}18`,
                          color: EMBRY.accent,
                          border: `1px solid ${EMBRY.accent}33`,
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: 11,
                      color: EMBRY.red,
                      padding: '4px 8px',
                      borderRadius: 4,
                      backgroundColor: `${EMBRY.red}08`,
                    }}
                  >
                    No taxonomy tags
                  </div>
                )}
              </CollapsibleSection>

              {/* Frameworks */}
              {tech.frameworks.length > 0 && (
                <CollapsibleSection title="Frameworks" qid="frameworks">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {tech.frameworks.map((fw) => (
                      <span key={fw} style={fwBadge(fw)}>
                        {fw}
                      </span>
                    ))}
                  </div>
                </CollapsibleSection>
              )}

              {/* Countermeasures */}
              {countermeasures.length > 0 && (
                <CollapsibleSection title={`Countermeasures (${countermeasures.length})`} qid="countermeasures">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {countermeasures.map((cm) => (
                      <span
                        key={cm.control_id}
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 4,
                          backgroundColor: `${EMBRY.green}12`,
                          color: EMBRY.green,
                          border: `1px solid ${EMBRY.green}22`,
                        }}
                      >
                        {cm.control_id}
                      </span>
                    ))}
                  </div>
                </CollapsibleSection>
              )}

              {/* QRAs */}
              <CollapsibleSection title={`QRAs (${qras.length})`} qid="qras">
                {qras.length === 0 ? (
                  <div
                    style={{
                      fontSize: 11,
                      color: EMBRY.red,
                      padding: 8,
                      borderRadius: 4,
                      backgroundColor: `${EMBRY.red}08`,
                    }}
                  >
                    No QRAs — gap in coverage
                  </div>
                ) : (
                  qras.slice(0, 3).map((qra, i) => (
                    <div
                      key={`qra-${i}`}
                      style={{
                        borderRadius: 6,
                        border: `1px solid ${EMBRY.border}`,
                        overflow: 'hidden',
                        marginBottom: 6,
                      }}
                    >
                      <div style={{ padding: '6px 10px', fontSize: 12, lineHeight: 1.5 }}>
                        <span style={{ color: EMBRY.accent }}>Q: </span>
                        <span style={{ color: EMBRY.white }}>{qra.question}</span>
                      </div>
                      {qra.answer && (
                        <div
                          style={{
                            padding: '6px 10px',
                            borderTop: `1px solid ${EMBRY.border}`,
                            fontSize: 12,
                            lineHeight: 1.5,
                          }}
                        >
                          <span style={{ color: EMBRY.green }}>A: </span>
                          <span style={{ color: EMBRY.dim }}>
                            {(qra.answer ?? '').slice(0, 150)}
                            {(qra.answer ?? '').length > 150 ? '...' : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  ))
                )}
                {qras.length > 3 && (
                  <div style={{ fontSize: 10, color: EMBRY.dim }}>... and {qras.length - 3} more</div>
                )}
              </CollapsibleSection>

              {/* Relationships */}
              {relationships.length > 0 && (
                <CollapsibleSection title={`Relationships (${relationships.length})`} qid="relationships">
                  {relationships.slice(0, 8).map((rel, i) => (
                    <div key={`rel-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: EMBRY.blue }}>
                        {rel.source_control_id}
                      </span>
                      <span style={{ color: EMBRY.dim, fontSize: 10 }}>→</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: EMBRY.blue }}>
                        {rel.target_control_id}
                      </span>
                      {rel.combined_score != null && (
                        <span style={{ fontSize: 9, color: EMBRY.dim }}>
                          ({(rel.combined_score * 100).toFixed(0)}%)
                        </span>
                      )}
                    </div>
                  ))}
                  {relationships.length > 8 && (
                    <div style={{ fontSize: 10, color: EMBRY.dim }}>... and {relationships.length - 8} more</div>
                  )}
                </CollapsibleSection>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

export default TechniqueDrawer
