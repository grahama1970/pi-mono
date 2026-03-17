import { useState } from 'react'
import { EMBRY, card, label, heading, glowDot, fwBadge } from '../common/EmbryStyle'

/** ATT&CK Navigator-style grid: tactics as columns, techniques as rows */

export interface ThreatTechnique {
  id: string
  name: string
  tactic: string
  coverage: 'full' | 'partial' | 'none' | 'unknown'
  issueCount: number
  frameworks: string[] // which frameworks have mappings
}

export interface ThreatMapProps {
  tactics: string[]
  techniques: ThreatTechnique[]
  onSelect?: (technique: ThreatTechnique) => void
}

const COVERAGE_COLORS: Record<string, string> = {
  full: EMBRY.green,
  partial: EMBRY.amber,
  none: EMBRY.red,
  unknown: EMBRY.dim,
}

export function ThreatMap({ tactics, techniques, onSelect }: ThreatMapProps) {
  const [hovered, setHovered] = useState<string | null>(null)

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px 12px',
        borderBottom: `1px solid ${EMBRY.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={heading}>Threat Map</div>
          <div style={{ ...label, marginTop: 2 }}>SPARTA Techniques by Tactic</div>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {Object.entries(COVERAGE_COLORS).map(([key, color]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={glowDot(color, 6)} />
              <span style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'capitalize' }}>{key}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${tactics.length}, minmax(140px, 1fr))`,
          gap: 0,
        }}>
          {/* Tactic headers */}
          {tactics.map((tactic) => (
            <div key={tactic} style={{
              padding: '10px 12px',
              borderBottom: `1px solid ${EMBRY.border}`,
              borderRight: `1px solid ${EMBRY.border}`,
              backgroundColor: EMBRY.bgDeep,
            }}>
              <div style={{ ...label, color: EMBRY.white, fontSize: 9 }}>{tactic}</div>
              <div style={{ fontSize: 10, color: EMBRY.dim, marginTop: 2 }}>
                {techniques.filter((t) => t.tactic === tactic).length} techniques
              </div>
            </div>
          ))}

          {/* Technique cells — render column by column */}
          {(() => {
            const maxRows = Math.max(...tactics.map((t) => techniques.filter((tech) => tech.tactic === t).length))
            const rows: React.ReactNode[] = []
            for (let row = 0; row < maxRows; row++) {
              for (const tactic of tactics) {
                const col = techniques.filter((t) => t.tactic === tactic)
                const tech = col[row]
                if (tech) {
                  const color = COVERAGE_COLORS[tech.coverage]
                  const isHovered = hovered === tech.id
                  rows.push(
                    <div
                      key={tech.id}
                      style={{
                        padding: '8px 10px',
                        borderRight: `1px solid ${EMBRY.border}`,
                        borderBottom: `1px solid ${EMBRY.border}`,
                        backgroundColor: isHovered ? `${color}12` : 'transparent',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s',
                        borderLeft: `3px solid ${color}`,
                      }}
                      onMouseEnter={() => setHovered(tech.id)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => onSelect?.(tech)}
                    >
                      <div style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: EMBRY.white,
                        fontFamily: 'monospace',
                        marginBottom: 2,
                      }}>
                        {tech.id}
                      </div>
                      <div style={{ fontSize: 11, color: EMBRY.dim, lineHeight: 1.3, marginBottom: 4 }}>
                        {tech.name}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {tech.frameworks.map((fw) => (
                          <span key={fw} style={fwBadge(fw)}>{fw}</span>
                        ))}
                        {tech.issueCount > 0 && (
                          <span style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: EMBRY.red,
                            backgroundColor: `${EMBRY.red}18`,
                            padding: '1px 5px',
                            borderRadius: 3,
                          }}>
                            {tech.issueCount}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                } else {
                  rows.push(
                    <div key={`${tactic}-empty-${row}`} style={{
                      borderRight: `1px solid ${EMBRY.border}`,
                      borderBottom: `1px solid ${EMBRY.border}`,
                    }} />
                  )
                }
              }
            }
            return rows
          })()}
        </div>
      </div>
    </div>
  )
}
