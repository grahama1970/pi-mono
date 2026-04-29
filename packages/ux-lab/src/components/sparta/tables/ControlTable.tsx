import { useState } from 'react'
import { EMBRY, card, label, heading, glowDot, fwBadge } from '../common/EmbryStyle'

export interface ControlRow {
  id: string
  framework: string
  name: string
  tactic?: string
  urlCount: number
  relCount: number
  knowledgeChunks: number
  issueCount: number
}

export interface ControlTableProps {
  controls: ControlRow[]
  onSelect?: (control: ControlRow) => void
}

type SortKey = 'id' | 'framework' | 'name' | 'issueCount' | 'relCount'

export function ControlTable({ controls, onSelect }: ControlTableProps) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('id')
  const [sortAsc, setSortAsc] = useState(true)
  const [fwFilter, setFwFilter] = useState<string | null>(null)

  const frameworks = [...new Set(controls.map((c) => c.framework))]

  const filtered = controls
    .filter((c) => {
      const matchSearch = !search ||
        c.id.toLowerCase().includes(search.toLowerCase()) ||
        c.name.toLowerCase().includes(search.toLowerCase())
      const matchFw = !fwFilter || c.framework === fwFilter
      return matchSearch && matchFw
    })
    .sort((a, b) => {
      const va = a[sortKey] ?? ''
      const vb = b[sortKey] ?? ''
      const cmp = typeof va === 'number' ? va - (vb as number) : String(va).localeCompare(String(vb))
      return sortAsc ? cmp : -cmp
    })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(true) }
  }

  const sortIcon = (key: SortKey) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''

  const thStyle: React.CSSProperties = {
    ...label,
    padding: '8px 10px',
    textAlign: 'left',
    cursor: 'pointer',
    borderBottom: `1px solid ${EMBRY.border}`,
    backgroundColor: EMBRY.bgDeep,
    whiteSpace: 'nowrap',
    userSelect: 'none',
  }

  const tdStyle: React.CSSProperties = {
    padding: '6px 10px',
    fontSize: 12,
    borderBottom: `1px solid ${EMBRY.border}`,
    color: EMBRY.white,
  }

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${EMBRY.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <div style={{ flex: 1 }}>
          <div style={heading}>Controls</div>
          <div style={{ ...label, marginTop: 2 }}>{filtered.length} of {controls.length}</div>
        </div>
        <input data-qid="tables-controltable:auto:86" data-qs-action="TABLES_CONTROLTABLE_AUTO_86"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search controls..."
          style={{
            backgroundColor: EMBRY.bgDeep,
            border: `1px solid ${EMBRY.border}`,
            borderRadius: 6,
            padding: '5px 10px',
            fontSize: 12,
            color: EMBRY.white,
            outline: 'none',
            width: 180,
          }}
        />
      </div>

      {/* Framework filters */}
      <div style={{
        display: 'flex',
        gap: 4,
        padding: '8px 16px',
        borderBottom: `1px solid ${EMBRY.border}`,
      }}>
        <button
          data-qid="controls:filter:framework-all"
          data-qs-action="FILTER_CONTROLS_FRAMEWORK_ALL"
          onClick={() => setFwFilter(null)}
          style={{
            ...fwBadge('all'),
            cursor: 'pointer',
            color: !fwFilter ? EMBRY.white : EMBRY.dim,
            backgroundColor: !fwFilter ? EMBRY.muted : 'transparent',
            border: `1px solid ${!fwFilter ? EMBRY.dim : EMBRY.border}`,
          }}
        >
          ALL
        </button>
        {frameworks.map((fw) => (
          <button data-qid="tables-controltable:auto:123" data-qs-action="TABLES_CONTROLTABLE_AUTO_123"
            key={fw}
            onClick={() => setFwFilter(fwFilter === fw ? null : fw)}
            style={{
              ...fwBadge(fw),
              cursor: 'pointer',
              backgroundColor: fwFilter === fw ? `${EMBRY.fw[fw]}22` : 'transparent',
            }}
          >
            {fw}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ overflow: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th data-qid="controls:sort:framework" data-qs-action="SORT_CONTROLS_FRAMEWORK" style={thStyle} onClick={() => handleSort('framework')}>FW{sortIcon('framework')}</th>
              <th data-qid="controls:sort:id" data-qs-action="SORT_CONTROLS_ID" style={thStyle} onClick={() => handleSort('id')}>ID{sortIcon('id')}</th>
              <th data-qid="controls:sort:name" data-qs-action="SORT_CONTROLS_NAME" style={{ ...thStyle, width: '40%' }} onClick={() => handleSort('name')}>Name{sortIcon('name')}</th>
              <th style={thStyle}>URLs</th>
              <th data-qid="controls:sort:relationships" data-qs-action="SORT_CONTROLS_RELATIONSHIPS" style={thStyle} onClick={() => handleSort('relCount')}>Rels{sortIcon('relCount')}</th>
              <th style={thStyle}>Chunks</th>
              <th data-qid="controls:sort:issues" data-qs-action="SORT_CONTROLS_ISSUES" style={thStyle} onClick={() => handleSort('issueCount')}>Issues{sortIcon('issueCount')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ctrl) => (
              <tr data-qid="tables-controltable:auto:153" data-qs-action="TABLES_CONTROLTABLE_AUTO_153"
                key={ctrl.id}
                onClick={() => onSelect?.(ctrl)}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = `${EMBRY.blue}08` }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
              >
                <td style={tdStyle}><span style={fwBadge(ctrl.framework)}>{ctrl.framework}</span></td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{ctrl.id}</td>
                <td style={{ ...tdStyle, color: EMBRY.dim }}>{ctrl.name}</td>
                <td style={{ ...tdStyle, textAlign: 'center', color: EMBRY.dim }}>{ctrl.urlCount}</td>
                <td style={{ ...tdStyle, textAlign: 'center', color: EMBRY.dim }}>{ctrl.relCount}</td>
                <td style={{ ...tdStyle, textAlign: 'center', color: EMBRY.dim }}>{ctrl.knowledgeChunks}</td>
                <td style={tdStyle}>
                  {ctrl.issueCount > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={glowDot(EMBRY.red, 6)} />
                      <span style={{ color: EMBRY.red, fontSize: 11, fontWeight: 700 }}>{ctrl.issueCount}</span>
                    </div>
                  ) : (
                    <div style={glowDot(EMBRY.green, 6)} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
