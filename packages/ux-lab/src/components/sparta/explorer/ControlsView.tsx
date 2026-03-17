import { useState } from 'react'
import { EMBRY, label, glowDot } from '../common/EmbryStyle'
import { ControlTable } from '../tables/ControlTable'
import { ControlDetail } from '../detail/ControlDetail'
import type { ControlRow } from '../tables/ControlTable'
import type { ControlDetailData } from '../detail/ControlDetail'
import { useControls, normalizeFramework } from '../../../hooks/useSpartaCollections'
import type { SpartaControl } from '../../../hooks/useSpartaCollections'

const MIND_TAGS = ['Detect', 'Evade', 'Exploit', 'Harden', 'Isolate', 'Model', 'Persist', 'Restore'] as const

function controlToRow(c: SpartaControl): ControlRow {
  return {
    id: c.control_id,
    framework: normalizeFramework(c.source_framework),
    name: c.name,
    tactic: c.control_type ?? 'Controls',
    urlCount: 0,
    relCount: 0,
    knowledgeChunks: 0,
    issueCount: c.weaknesses?.length ?? 0,
  }
}

function controlToDetail(c: SpartaControl): ControlDetailData {
  return {
    id: c.control_id,
    framework: normalizeFramework(c.source_framework),
    name: c.name,
    description: c.description,
    controlType: c.control_type,
    domain: c.domain,
    parentId: c.parent_id,
    scope: c.scope,
    weaknesses: c.weaknesses,
  }
}

function nrsColor(score: number | undefined): string {
  if (score == null) return EMBRY.dim
  if (score >= 0.80) return EMBRY.green
  if (score >= 0.60) return EMBRY.amber
  return EMBRY.red
}

export function ControlsView() {
  const { data: controls, loading, error } = useControls()
  const [selected, setSelected] = useState<SpartaControl | null>(null)

  if (error) {
    return <div style={{ padding: 20, color: EMBRY.red, border: `1px solid ${EMBRY.red}33`, borderRadius: 8, margin: 16 }}>Error: {error}</div>
  }

  const rows = controls.map(controlToRow)

  function handleSelect(row: ControlRow) {
    const ctrl = controls.find((c) => c.control_id === row.id)
    setSelected(ctrl ?? null)
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Master — table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: 20, color: EMBRY.dim }}>Loading controls...</div>
        ) : (
          <ControlTable controls={rows} onSelect={handleSelect} />
        )}
      </div>

      {/* Detail slide-over */}
      {selected && (
        <div style={styles.slideOver}>
          <ControlDetail
            control={controlToDetail(selected)}
            onClose={() => setSelected(null)}
          />
          {/* NRS score */}
          {selected.nrs_score != null && (
            <div style={{ padding: '12px 20px', borderTop: `1px solid ${EMBRY.border}` }}>
              <div style={{ ...label, marginBottom: 6 }}>NRS Score</div>
              <span style={{
                fontSize: 20, fontWeight: 900,
                color: nrsColor(selected.nrs_score),
              }}>
                {(selected.nrs_score * 100).toFixed(0)}%
              </span>
            </div>
          )}
          {/* Mind tags */}
          {selected.mind && selected.mind.length > 0 && (
            <div style={{ padding: '12px 20px', borderTop: `1px solid ${EMBRY.border}` }}>
              <div style={{ ...label, marginBottom: 6 }}>Mind Tags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {selected.mind.map((tag) => (
                  <span key={tag} style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                    backgroundColor: `${EMBRY.accent}18`, color: EMBRY.accent,
                    border: `1px solid ${EMBRY.accent}33`,
                  }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const styles = {
  slideOver: {
    width: 420,
    backgroundColor: EMBRY.bgPanel,
    borderLeft: `1px solid ${EMBRY.border}`,
    overflow: 'auto',
    flexShrink: 0,
  },
}
