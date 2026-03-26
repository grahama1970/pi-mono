import { useState, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table'
import { EMBRY, card, label, heading } from '../../sparta/common/EmbryStyle'
import { StatusPill } from '../components/StatusPill'
import type { PillVariant } from '../components/StatusPill'

// ── Types ──────────────────────────────────────────────────────────────────────

type HealthStatus = 'Healthy' | 'Warning' | 'Degraded' | 'Stale' | 'Failed'
type LabType = 'classifier' | 'regressor' | 'gpt'

interface ModelHealth {
  id: string
  name: string
  version: string
  labType: LabType
  macroF1: number | null
  rmse: number | null
  staleDays: number
  status: HealthStatus
  statusVariant: PillVariant
  lastRun: string
}

// ── Mock data ──────────────────────────────────────────────────────────────────

const MODEL_DATA: ModelHealth[] = [
  { id: '1',  name: 'intent-clf',       version: 'v12', labType: 'classifier', macroF1: 0.91, rmse: null,  staleDays: 0,  status: 'Healthy',  statusVariant: 'green',  lastRun: '2026-03-17' },
  { id: '2',  name: 'entity-clf',       version: 'v8',  labType: 'classifier', macroF1: 0.78, rmse: null,  staleDays: 1,  status: 'Warning',  statusVariant: 'amber',  lastRun: '2026-03-16' },
  { id: '3',  name: 'score-regressor',  version: 'v7',  labType: 'regressor',  macroF1: null, rmse: 0.043, staleDays: 0,  status: 'Healthy',  statusVariant: 'green',  lastRun: '2026-03-17' },
  { id: '4',  name: 'latency-pred',     version: 'v3',  labType: 'regressor',  macroF1: null, rmse: 0.112, staleDays: 2,  status: 'Warning',  statusVariant: 'amber',  lastRun: '2026-03-15' },
  { id: '5',  name: 'confidence-est',   version: 'v5',  labType: 'regressor',  macroF1: null, rmse: 0.078, staleDays: 7,  status: 'Stale',    statusVariant: 'red',    lastRun: '2026-03-10' },
  { id: '6',  name: 'coref-clf',        version: 'v3',  labType: 'classifier', macroF1: 0.61, rmse: null,  staleDays: 3,  status: 'Degraded', statusVariant: 'purple', lastRun: '2026-03-14' },
  { id: '7',  name: 'drift-detector',   version: 'v2',  labType: 'regressor',  macroF1: null, rmse: 0.201, staleDays: 16, status: 'Stale',    statusVariant: 'red',    lastRun: '2026-03-01' },
  { id: '8',  name: 'negation-clf',     version: 'v5',  labType: 'classifier', macroF1: 0.69, rmse: null,  staleDays: 4,  status: 'Warning',  statusVariant: 'amber',  lastRun: '2026-03-13' },
  { id: '9',  name: 'gpt-quality',      version: 'v1',  labType: 'gpt',        macroF1: 0.83, rmse: null,  staleDays: 1,  status: 'Healthy',  statusVariant: 'green',  lastRun: '2026-03-16' },
  { id: '10', name: 'taxonomy-router',  version: 'v4',  labType: 'classifier', macroF1: 0.95, rmse: null,  staleDays: 0,  status: 'Healthy',  statusVariant: 'green',  lastRun: '2026-03-17' },
  { id: '11', name: 'calibration-net',  version: 'v4',  labType: 'regressor',  macroF1: null, rmse: 0.055, staleDays: 1,  status: 'Healthy',  statusVariant: 'green',  lastRun: '2026-03-16' },
  { id: '12', name: 'rel-extractor',    version: 'v6',  labType: 'classifier', macroF1: 0.44, rmse: null,  staleDays: 9,  status: 'Failed',   statusVariant: 'red',    lastRun: '2026-03-08' },
]

// ── Column helper ──────────────────────────────────────────────────────────────

const columnHelper = createColumnHelper<ModelHealth>()

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ value, label: statLabel, variant }: { value: string | number; label: string; variant: PillVariant }) {
  const colorMap: Record<PillVariant, string> = {
    green: EMBRY.green,
    amber: EMBRY.amber,
    red: EMBRY.red,
    blue: EMBRY.blue,
    purple: EMBRY.accent,
    neutral: EMBRY.dim,
  }
  return (
    <div style={{ ...card, padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 900, color: colorMap[variant], letterSpacing: '-0.03em' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: EMBRY.dim, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {statLabel}
      </div>
    </div>
  )
}

// ── Sort icon ─────────────────────────────────────────────────────────────────

function SortIcon({ direction }: { direction: 'asc' | 'desc' | false }) {
  if (!direction) return <span style={{ color: EMBRY.muted, fontSize: 9 }}>⇅</span>
  return <span style={{ color: EMBRY.blue, fontSize: 9 }}>{direction === 'asc' ? '↑' : '↓'}</span>
}

// ── ModelHealthTab ─────────────────────────────────────────────────────────────

export function ModelHealthTab() {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [labFilter, setLabFilter] = useState<LabType | 'all'>('all')
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)

  const filteredData = useMemo(
    () =>
      labFilter === 'all'
        ? MODEL_DATA
        : MODEL_DATA.filter((m) => m.labType === labFilter),
    [labFilter]
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Model',
        cell: (info) => (
          <div>
            <div style={{ fontWeight: 600, color: EMBRY.white }}>{info.getValue()}</div>
            <div style={{ fontSize: 10, color: EMBRY.dim }}>{info.row.original.version}</div>
          </div>
        ),
      }),
      columnHelper.accessor('labType', {
        header: 'Lab Type',
        cell: (info) => {
          const typeVariant: Record<LabType, PillVariant> = {
            classifier: 'blue',
            regressor: 'purple',
            gpt: 'amber',
          }
          return <StatusPill variant={typeVariant[info.getValue()]}>{info.getValue()}</StatusPill>
        },
      }),
      columnHelper.accessor('macroF1', {
        header: 'Macro F1',
        cell: (info) => {
          const v = info.getValue()
          if (v === null) return <span style={{ color: EMBRY.muted }}>—</span>
          return <span style={{ fontWeight: 700, color: v >= 0.75 ? EMBRY.green : EMBRY.red }}>{v.toFixed(3)}</span>
        },
      }),
      columnHelper.accessor('rmse', {
        header: 'RMSE',
        cell: (info) => {
          const v = info.getValue()
          if (v === null) return <span style={{ color: EMBRY.muted }}>—</span>
          return <span style={{ fontWeight: 700, color: v <= 0.10 ? EMBRY.green : EMBRY.red }}>{v.toFixed(3)}</span>
        },
      }),
      columnHelper.accessor('staleDays', {
        header: 'Staleness',
        cell: (info) => {
          const d = info.getValue()
          return (
            <StatusPill variant={d > 7 ? 'red' : d > 3 ? 'amber' : 'green'}>
              {d === 0 ? 'Today' : `${d}d ago`}
            </StatusPill>
          )
        },
      }),
      columnHelper.accessor('status', {
        header: 'Status',
        cell: (info) => (
          <StatusPill variant={info.row.original.statusVariant}>
            {info.getValue()}
          </StatusPill>
        ),
        sortingFn: (a, b) => {
          const order: Record<HealthStatus, number> = {
            Failed: 0, Stale: 1, Degraded: 2, Warning: 3, Healthy: 4,
          }
          return order[a.original.status] - order[b.original.status]
        },
      }),
      columnHelper.accessor('lastRun', {
        header: 'Last Run',
        cell: (info) => <span style={{ fontSize: 11, color: EMBRY.dim }}>{info.getValue()}</span>,
      }),
    ],
    []
  )

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  // Summary stats
  const total = MODEL_DATA.length
  const healthy = MODEL_DATA.filter((m) => m.status === 'Healthy').length
  const failing = MODEL_DATA.filter((m) => m.status === 'Failed' || m.status === 'Degraded').length
  const stale = MODEL_DATA.filter((m) => m.staleDays > 7).length

  return (
    <div style={{ padding: 20, overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={heading}>Model Health</div>
        <div style={{ fontSize: 11, color: EMBRY.dim, marginTop: 2 }}>
          Cross-lab model registry · staleness · gate status
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard value={total} label="Total Models" variant="neutral" />
        <StatCard value={healthy} label="Healthy" variant="green" />
        <StatCard value={failing} label="Failing / Degraded" variant="red" />
        <StatCard value={stale} label="Stale (>7d)" variant="amber" />
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <input
          data-testid="filter-input"
          placeholder="Filter models..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          style={{
            backgroundColor: EMBRY.bgPanel,
            border: `1px solid ${EMBRY.border}`,
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            color: EMBRY.white,
            outline: 'none',
            width: 200,
          }}
        />
        <select
          data-testid="filter-dropdown"
          value={labFilter}
          onChange={(e) => setLabFilter(e.target.value as LabType | 'all')}
          style={{
            backgroundColor: EMBRY.bgPanel,
            border: `1px solid ${EMBRY.border}`,
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            color: EMBRY.white,
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="all">All Lab Types</option>
          <option value="classifier">Classifier</option>
          <option value="regressor">Regressor</option>
          <option value="gpt">GPT</option>
        </select>
        <div style={{ fontSize: 11, color: EMBRY.dim, marginLeft: 'auto' }}>
          {table.getRowModel().rows.length} / {total} models
        </div>
      </div>

      {/* Table */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    data-testid={`sort-${header.id}`}
                    onClick={header.column.getToggleSortingHandler()}
                    style={{
                      textAlign: 'left',
                      padding: '10px 14px',
                      fontSize: 10,
                      fontWeight: 700,
                      color: EMBRY.dim,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      cursor: header.column.getCanSort() ? 'pointer' : 'default',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        <SortIcon direction={header.column.getIsSorted()} />
                      )}
                    </span>
                  </th>
                ))}
                <th style={{
                  textAlign: 'left',
                  padding: '10px 14px',
                  fontSize: 10,
                  fontWeight: 700,
                  color: EMBRY.dim,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  width: 80,
                }}></th>
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const isHovered = hoveredRow === row.id
              return (
                <tr
                  key={row.id}
                  data-testid="model-health-row"
                  onMouseEnter={() => setHoveredRow(row.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{
                    borderBottom: `1px solid ${EMBRY.border}`,
                    cursor: 'pointer',
                    backgroundColor: isHovered ? `${EMBRY.white}06` : 'transparent',
                    transition: 'background-color 0.12s',
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} style={{ padding: '10px 14px' }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                  {/* View in Lab column */}
                  <td style={{ padding: '10px 14px' }}>
                    {isHovered && (
                      <button
                        data-testid="view-in-lab-link"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: EMBRY.green,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          padding: '2px 0',
                          textDecoration: 'underline',
                          textDecorationStyle: 'dotted',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        View in Lab →
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  style={{ padding: 24, textAlign: 'center', color: EMBRY.dim, fontSize: 12 }}
                >
                  No models match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
