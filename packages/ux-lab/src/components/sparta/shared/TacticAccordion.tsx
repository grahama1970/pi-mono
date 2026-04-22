/**
 * TacticAccordion — Mobile/tablet view for SPARTA matrix (<1024px).
 *
 * Architecture:
 * - 9 collapsible sections (one per tactic)
 * - Header: Tactic name + Posture Sparkline (mini bar chart)
 * - Expanded: Technique list in 1-2 column feed
 * - Header height: 44px minimum (COTS C02)
 *
 * Complies with:
 * - COTS C02: 44px minimum touch targets
 * - NVIS Class A: White Phosphor palette
 * - 4-Attribute Rule: data-qid, data-qs-action, title, useRegisterAction
 */
import { useState, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import { EMBRY, glowDot, fwBadge, FLUID } from '../common/EmbryStyle'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import type { ThreatTactic, ThreatTechnique } from './ThreatMatrix'

export interface TacticAccordionProps {
  tactics: ThreatTactic[]
  techniques: ThreatTechnique[]
  onSelectTechnique: (tech: ThreatTechnique) => void
  selectedTechniqueId?: string
}

interface TacticStats {
  total: number
  satisfied: number
  inconclusive: number
  notSatisfied: number
  noCase: number
}

const TRANSITION = 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)'

function PostureSparkline({ stats }: { stats: TacticStats }) {
  const { total, satisfied, inconclusive, notSatisfied } = stats
  if (total === 0) return null

  const satPct = (satisfied / total) * 100
  const incPct = (inconclusive / total) * 100
  const notPct = (notSatisfied / total) * 100

  return (
    <div
      style={{
        display: 'flex',
        height: 4,
        width: 60,
        borderRadius: 2,
        overflow: 'hidden',
        backgroundColor: `${EMBRY.dim}30`,
      }}
      title={`${satisfied} satisfied, ${inconclusive} inconclusive, ${notSatisfied} not satisfied`}
    >
      {satPct > 0 && <div style={{ width: `${satPct}%`, backgroundColor: EMBRY.green }} />}
      {incPct > 0 && <div style={{ width: `${incPct}%`, backgroundColor: EMBRY.amber }} />}
      {notPct > 0 && <div style={{ width: `${notPct}%`, backgroundColor: EMBRY.red }} />}
    </div>
  )
}

export function TacticAccordion({
  tactics,
  techniques,
  onSelectTechnique,
  selectedTechniqueId,
}: TacticAccordionProps) {
  // 4-attribute rule: register actions to ArangoDB app_actions
  useRegisterAction('tactic-accordion:header', {
    app: 'sparta-explorer',
    action: 'TOGGLE_TACTIC',
    label: 'Toggle Tactic',
    description: 'Expand or collapse tactic accordion section',
    tags: ['sparta', 'accordion', 'navigation'],
  })
  useRegisterAction('tactic-accordion:technique', {
    app: 'sparta-explorer',
    action: 'SELECT_TECHNIQUE',
    label: 'Select Technique',
    description: 'Select a technique to view details',
    tags: ['sparta', 'technique', 'selection'],
  })

  const [expandedTactics, setExpandedTactics] = useState<Set<string>>(new Set())

  const toggleTactic = useCallback((tacticName: string) => {
    setExpandedTactics((prev) => {
      const next = new Set(prev)
      if (next.has(tacticName)) {
        next.delete(tacticName)
      } else {
        next.add(tacticName)
      }
      return next
    })
  }, [])

  const byTactic: Record<string, ThreatTechnique[]> = {}
  const statsByTactic: Record<string, TacticStats> = {}

  for (const tactic of tactics) {
    byTactic[tactic.name] = []
    statsByTactic[tactic.name] = { total: 0, satisfied: 0, inconclusive: 0, notSatisfied: 0, noCase: 0 }
  }

  for (const tech of techniques) {
    if (byTactic[tech.tactic]) {
      byTactic[tech.tactic].push(tech)
      const stats = statsByTactic[tech.tactic]
      stats.total++
      if (tech.evidenceVerdict === 'satisfied') stats.satisfied++
      else if (tech.evidenceVerdict === 'inconclusive') stats.inconclusive++
      else if (tech.evidenceVerdict === 'not_satisfied') stats.notSatisfied++
      else stats.noCase++
    }
  }

  return (
    <div
      data-qid="tactic-accordion:container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        backgroundColor: EMBRY.bgDeep,
      }}
    >
      {tactics.map((tactic) => {
        const isExpanded = expandedTactics.has(tactic.name)
        const tacticTechniques = byTactic[tactic.name] ?? []
        const stats = statsByTactic[tactic.name]

        return (
          <div key={tactic.id} style={{ backgroundColor: EMBRY.bgCard }}>
            {/* Accordion Header */}
            <button
              data-qid={`tactic-accordion:header:${tactic.id}`}
              data-qs-action="TOGGLE_TACTIC"
              title={`${tactic.name}: ${stats.total} techniques. Click to ${isExpanded ? 'collapse' : 'expand'}`}
              onClick={() => toggleTactic(tactic.name)}
              style={{
                width: '100%',
                minHeight: 44,
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                border: 'none',
                borderBottom: `1px solid ${EMBRY.border}`,
                backgroundColor: isExpanded ? `${EMBRY.accent}08` : 'transparent',
                cursor: 'pointer',
                transition: TRANSITION,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: EMBRY.white,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {tactic.name}
                  </span>
                  <span style={{ fontSize: 10, color: EMBRY.dim, fontFamily: 'monospace' }}>
                    {tactic.prefix} · {stats.total} techniques
                  </span>
                </div>
                <PostureSparkline stats={stats} />
              </div>

              <ChevronDown
                size={16}
                strokeWidth={1.5}
                style={{
                  color: EMBRY.dim,
                  transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: TRANSITION,
                  flexShrink: 0,
                }}
              />
            </button>

            {/* Expanded Content */}
            {isExpanded && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: FLUID.gridGap,
                  padding: FLUID.cardPadding,
                  backgroundColor: EMBRY.bgPanel,
                }}
              >
                {tacticTechniques.map((tech) => {
                  const isSelected = tech.id === selectedTechniqueId
                  const verdictColor =
                    tech.evidenceVerdict === 'satisfied'
                      ? EMBRY.green
                      : tech.evidenceVerdict === 'inconclusive'
                        ? EMBRY.amber
                        : tech.evidenceVerdict === 'not_satisfied'
                          ? EMBRY.red
                          : EMBRY.dim

                  return (
                    <button
                      key={tech.id}
                      data-qid={`tactic-accordion:technique:${tech.id}`}
                      data-qs-action="SELECT_TECHNIQUE"
                      title={`${tech.id}: ${tech.name}. Verdict: ${tech.evidenceVerdict}`}
                      onClick={() => onSelectTechnique(tech)}
                      style={{
                        minHeight: 44,
                        padding: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 4,
                        border: `1px solid ${isSelected ? EMBRY.accent : EMBRY.border}`,
                        borderLeft: `3px solid ${verdictColor}`,
                        borderRadius: 6,
                        backgroundColor: isSelected ? `${EMBRY.accent}12` : EMBRY.bgCard,
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: TRANSITION,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            fontFamily: 'monospace',
                            color: EMBRY.white,
                          }}
                        >
                          {tech.id}
                        </span>
                        <div style={glowDot(verdictColor, 5)} />
                        {tech.evidenceGrade && (
                          <span
                            style={{
                              fontSize: 8,
                              fontWeight: 700,
                              padding: '1px 4px',
                              borderRadius: 3,
                              marginLeft: 'auto',
                              color: tech.evidenceGrade.startsWith('A') ? EMBRY.green : tech.evidenceGrade === 'B' ? EMBRY.amber : EMBRY.red,
                              backgroundColor: `${tech.evidenceGrade.startsWith('A') ? EMBRY.green : tech.evidenceGrade === 'B' ? EMBRY.amber : EMBRY.red}15`,
                            }}
                          >
                            {tech.evidenceGrade}
                          </span>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          color: EMBRY.dim,
                          lineHeight: 1.3,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {tech.name}
                      </span>
                      {tech.frameworks.length > 0 && (
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
                          {tech.frameworks.slice(0, 3).map((fw) => (
                            <span key={fw} style={{ ...fwBadge(fw), fontSize: 8, padding: '1px 4px' }}>
                              {fw}
                            </span>
                          ))}
                          {tech.frameworks.length > 3 && (
                            <span style={{ fontSize: 8, color: EMBRY.dim }}>+{tech.frameworks.length - 3}</span>
                          )}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default TacticAccordion
