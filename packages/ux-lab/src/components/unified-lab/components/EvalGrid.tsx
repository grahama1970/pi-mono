import { useMemo, useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  createColumnHelper,
  flexRender,
} from '@tanstack/react-table'
import { EMBRY } from '../../sparta/common/EmbryStyle'
import { mockEvalData, ALL_MODELS, DEFAULT_MODELS, type EvalRow, type EvalCell } from '../data/mockEvalData'

const API = 'http://localhost:3001'
const columnHelper = createColumnHelper<EvalRow>()

function CellContent({ cell }: { cell: EvalCell }) {
  const bg = cell.pass ? `${EMBRY.green}0a` : `${EMBRY.red}0a`
  const borderColor = cell.pass ? `${EMBRY.green}33` : `${EMBRY.red}33`

  return (
    <div
      style={{
        backgroundColor: bg,
        borderLeft: `3px solid ${borderColor}`,
        padding: '8px 10px',
        minHeight: 80,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: EMBRY.white,
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          marginBottom: 6,
        }}
      >
        {cell.output}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 3,
            color: cell.pass ? EMBRY.green : EMBRY.red,
            backgroundColor: cell.pass ? `${EMBRY.green}18` : `${EMBRY.red}18`,
          }}
        >
          {cell.pass ? 'PASS' : 'FAIL'}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 3,
            color: cell.grounded ? EMBRY.blue : EMBRY.amber,
            backgroundColor: cell.grounded ? `${EMBRY.blue}18` : `${EMBRY.amber}18`,
          }}
        >
          {cell.grounded ? 'GROUNDED' : 'UNGROUNDED'}
        </span>
        <span style={{ fontSize: 9, color: EMBRY.dim }}>{cell.latencyMs}ms</span>
      </div>
    </div>
  )
}

function ModelAggregate({ model, data }: { model: string; data: EvalRow[] }) {
  const cells = data.map((r) => r.cells[model]).filter(Boolean)
  if (cells.length === 0) return null

  const passRate = Math.round((cells.filter((c) => c.pass).length / cells.length) * 100)
  const groundedRate = Math.round((cells.filter((c) => c.grounded).length / cells.length) * 100)
  const avgLatency = Math.round(cells.reduce((sum, c) => sum + c.latencyMs, 0) / cells.length)

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
      <span style={{ fontSize: 9, color: passRate >= 80 ? EMBRY.green : passRate >= 50 ? EMBRY.amber : EMBRY.red }}>
        {passRate}% pass
      </span>
      <span style={{ fontSize: 9, color: groundedRate >= 80 ? EMBRY.blue : EMBRY.amber }}>
        {groundedRate}% grnd
      </span>
      <span style={{ fontSize: 9, color: EMBRY.dim }}>
        ~{avgLatency}ms
      </span>
    </div>
  )
}

export interface EvalGridProps {
  systemPrompt?: string
  judgeModel?: string
}

type SourceMode = 'mock' | 'sample' | 'search'

export function EvalGrid({ systemPrompt, judgeModel }: EvalGridProps) {
  const [labelFilter, setLabelFilter] = useState('')
  const [selectedModels, setSelectedModels] = useState<string[]>([...DEFAULT_MODELS])
  const [customModel, setCustomModel] = useState('')
  const [evalData, setEvalData] = useState<EvalRow[]>(mockEvalData)
  const [runningRows, setRunningRows] = useState<Set<string>>(new Set())
  const [buildingEvidence, setBuildingEvidence] = useState<Set<string>>(new Set())
  const [sourceMode, setSourceMode] = useState<SourceMode>('mock')
  const [searchQuery, setSearchQuery] = useState('')
  const [sampleSize, setSampleSize] = useState(10)
  const [loading, setLoading] = useState(false)
  const [sourceInfo, setSourceInfo] = useState('5 mock test cases')

  async function loadFromMemory(mode: 'sample' | 'search') {
    setLoading(true)
    try {
      const url = mode === 'sample' ? `${API}/api/test-cases/sample` : `${API}/api/test-cases/search`
      const body = mode === 'sample'
        ? { limit: sampleSize }
        : { query: searchQuery, limit: sampleSize }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.rows?.length) {
        setEvalData(data.rows)
        setSourceMode(mode)
        setSourceInfo(`${data.rows.length} QRAs from /memory${mode === 'search' ? ` (query: "${searchQuery}")` : ' (random sample)'}`)
      } else {
        setSourceInfo(`No results returned`)
      }
    } catch (err) {
      setSourceInfo(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  function resetToMock() {
    setEvalData(mockEvalData)
    setSourceMode('mock')
    setSourceInfo('5 mock test cases')
  }

  function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = reader.result as string
        let rows: EvalRow[]

        if (file.name.endsWith('.jsonl')) {
          // JSONL: one JSON object per line
          rows = text.trim().split('\n').map((line, i) => {
            const obj = JSON.parse(line)
            return {
              id: obj.control_id || obj.id || obj.qra_id || `import-${i}`,
              label: obj.label || obj.control_id || `Row ${i + 1}`,
              question: obj.question || obj.q || '',
              answer: obj.answer || obj.a || undefined,
              cells: obj.cells || {},
            }
          })
        } else {
          // JSON: array or {rows: [...]} or {questions: [...]}
          const parsed = JSON.parse(text)
          const arr = Array.isArray(parsed) ? parsed : (parsed.rows || parsed.questions || parsed.test_cases || [])
          rows = arr.map((obj: any, i: number) => ({
            id: obj.control_id || obj.id || obj.qra_id || `import-${i}`,
            label: obj.label || obj.control_id || `Row ${i + 1}`,
            question: obj.question || obj.q || '',
            answer: obj.answer || obj.a || undefined,
            cells: obj.cells || {},
          }))
        }

        if (rows.length > 0) {
          setEvalData(rows)
          setSourceMode('mock') // treat imported as custom
          setSourceInfo(`${rows.length} questions from ${file.name}`)
        } else {
          setSourceInfo(`No questions found in ${file.name}`)
        }
      } catch (err) {
        setSourceInfo(`Import error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    reader.readAsText(file)
    // Reset input so same file can be re-imported
    e.target.value = ''
  }

  function handleExport() {
    const exportData = evalData.map((r) => ({
      id: r.id,
      label: r.label,
      question: r.question,
      cells: r.cells,
    }))
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `eval-batch-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function toggleModel(model: string) {
    setSelectedModels((prev) =>
      prev.includes(model) ? prev.filter((m) => m !== model) : [...prev, model]
    )
  }

  function addCustomModel() {
    const trimmed = customModel.trim()
    if (!trimmed || selectedModels.includes(trimmed)) return
    setSelectedModels((prev) => [...prev, trimmed])
    setCustomModel('')
  }

  async function runRow(row: EvalRow) {
    if (!row.question || runningRows.has(row.id)) return
    setRunningRows((prev) => new Set(prev).add(row.id))

    try {
      const res = await fetch(`${API}/api/eval/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: systemPrompt || 'You are a SPARTA security analyst.',
          question: row.question,
          models: selectedModels,
          judgeModel,
        }),
      })
      const data = await res.json()

      if (data.results) {
        setEvalData((prev) =>
          prev.map((r) => {
            if (r.id !== row.id) return r
            const newCells = { ...r.cells }
            for (const [model, result] of Object.entries(data.results) as [string, any][]) {
              newCells[model] = {
                output: result.output || '',
                pass: result.status === 'ok',
                grounded: result.status === 'ok', // placeholder until judge runs
                latencyMs: result.latencyMs || 0,
              }
            }
            return { ...r, cells: newCells }
          })
        )
      }
    } catch (err) {
      console.error('Run failed:', err)
    } finally {
      setRunningRows((prev) => {
        const next = new Set(prev)
        next.delete(row.id)
        return next
      })
    }
  }

  async function buildEvidenceCase(row: EvalRow) {
    if (buildingEvidence.has(row.id)) return
    setBuildingEvidence((prev) => new Set(prev).add(row.id))

    try {
      const res = await fetch(`${API}/api/evidence-case`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: row.question || row.label,
          controlId: row.id,
        }),
      })
      const data = await res.json()
      alert(`Evidence case built:\n${JSON.stringify(data, null, 2).slice(0, 500)}`)
    } catch (err) {
      alert(`Evidence case error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBuildingEvidence((prev) => {
        const next = new Set(prev)
        next.delete(row.id)
        return next
      })
    }
  }

  async function recallFromMemory(row: EvalRow) {
    try {
      const res = await fetch(`${API}/api/memory/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: row.question || row.label, limit: 3 }),
      })
      const data = await res.json()
      const results = data.results || []
      const summary = results.length > 0
        ? results.map((r: any) => `- ${r.question || r.problem || '(no title)'}`).join('\n')
        : 'No results found in memory.'
      alert(`Memory recall for "${row.label}":\n\n${summary}`)
    } catch (err) {
      alert(`Memory recall error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const columns = useMemo(() => {
    const cols = [
      columnHelper.accessor('label', {
        header: 'Test Case',
        cell: (info) => {
          const row = info.row.original
          const isRunning = runningRows.has(row.id)
          const isBuilding = buildingEvidence.has(row.id)
          return (
            <div>
              <div style={{ fontSize: 10, color: EMBRY.dim, fontFamily: 'monospace' }}>
                {row.id}
              </div>
              <div style={{ fontSize: 12, color: EMBRY.white, fontWeight: 600, marginTop: 2 }}>
                {info.getValue()}
              </div>
              {row.question && (
                <div
                  style={{
                    fontSize: 11,
                    color: EMBRY.dim,
                    marginTop: 4,
                    lineHeight: 1.4,
                    fontStyle: 'italic',
                  }}
                >
                  {row.question}
                </div>
              )}
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <button
                  onClick={() => runRow(row)}
                  disabled={isRunning}
                  title="Re-run this test case against selected models via /scillm"
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 3,
                    border: `1px solid ${EMBRY.green}44`,
                    backgroundColor: `${EMBRY.green}15`,
                    color: EMBRY.green,
                    cursor: isRunning ? 'wait' : 'pointer',
                    opacity: isRunning ? 0.5 : 1,
                  }}
                >
                  {isRunning ? 'Running...' : 'Run'}
                </button>
                <button
                  onClick={() => buildEvidenceCase(row)}
                  disabled={isBuilding}
                  title="Build evidence case via /create-evidence-case"
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 3,
                    border: `1px solid ${EMBRY.accent}44`,
                    backgroundColor: `${EMBRY.accent}15`,
                    color: EMBRY.accent,
                    cursor: isBuilding ? 'wait' : 'pointer',
                    opacity: isBuilding ? 0.5 : 1,
                  }}
                >
                  {isBuilding ? 'Building...' : 'Evidence'}
                </button>
                <button
                  onClick={() => recallFromMemory(row)}
                  title="Recall related lessons from /memory"
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 3,
                    border: `1px solid ${EMBRY.blue}44`,
                    backgroundColor: `${EMBRY.blue}15`,
                    color: EMBRY.blue,
                    cursor: 'pointer',
                  }}
                >
                  Recall
                </button>
              </div>
            </div>
          )
        },
      }),
      ...selectedModels.map((model) =>
        columnHelper.display({
          id: model,
          header: () => (
            <div>
              <span style={{ fontSize: 11, color: EMBRY.accent }}>{model}</span>
              <ModelAggregate model={model} data={evalData} />
            </div>
          ),
          cell: (info) => {
            const cell = info.row.original.cells[model]
            return cell ? <CellContent cell={cell} /> : (
              <div style={{ padding: 10, color: EMBRY.dim, fontSize: 10, fontStyle: 'italic' }}>
                No data
              </div>
            )
          },
        })
      ),
    ]
    return cols
  }, [selectedModels, evalData, runningRows, buildingEvidence])

  const filteredData = useMemo(() => {
    if (!labelFilter) return evalData
    return evalData.filter((r) =>
      r.label.toLowerCase().includes(labelFilter.toLowerCase())
    )
  }, [labelFilter, evalData])

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Source bar: load test cases from /memory */}
      <div style={{
        display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap',
        padding: '6px 10px', borderRadius: 6, backgroundColor: `${EMBRY.accent}08`, border: `1px solid ${EMBRY.accent}22`,
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: EMBRY.dim, marginRight: 4 }}>
          Source:
        </span>
        <button
          onClick={resetToMock}
          style={{
            fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
            border: `1px solid ${sourceMode === 'mock' ? EMBRY.dim : EMBRY.border}`,
            backgroundColor: sourceMode === 'mock' ? `${EMBRY.dim}20` : 'transparent',
            color: sourceMode === 'mock' ? EMBRY.white : EMBRY.dim, cursor: 'pointer',
          }}
        >
          Mock
        </button>
        <button
          onClick={() => loadFromMemory('sample')}
          disabled={loading}
          style={{
            fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
            border: `1px solid ${sourceMode === 'sample' ? EMBRY.green : EMBRY.border}`,
            backgroundColor: sourceMode === 'sample' ? `${EMBRY.green}20` : 'transparent',
            color: sourceMode === 'sample' ? EMBRY.green : EMBRY.dim, cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading && sourceMode !== 'search' ? 'Sampling...' : 'Random Sample'}
        </button>
        <input
          type="number"
          min={1}
          max={50}
          value={sampleSize}
          onChange={(e) => setSampleSize(Math.max(1, Math.min(50, Number(e.target.value))))}
          style={{
            width: 40, backgroundColor: EMBRY.bgPanel, border: `1px solid ${EMBRY.border}`,
            borderRadius: 4, padding: '3px 6px', fontSize: 10, color: EMBRY.white, outline: 'none', textAlign: 'center',
          }}
        />
        <form
          onSubmit={(e) => { e.preventDefault(); loadFromMemory('search') }}
          style={{ display: 'flex', gap: 4 }}
        >
          <input
            type="text"
            placeholder="Search QRAs by topic..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              backgroundColor: EMBRY.bgPanel, border: `1px solid ${EMBRY.border}`,
              borderRadius: 4, padding: '3px 8px', fontSize: 10, color: EMBRY.white, outline: 'none', width: 180,
            }}
          />
          <button
            type="submit"
            disabled={loading || !searchQuery.trim()}
            style={{
              fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
              border: `1px solid ${sourceMode === 'search' ? EMBRY.blue : EMBRY.border}`,
              backgroundColor: sourceMode === 'search' ? `${EMBRY.blue}20` : 'transparent',
              color: sourceMode === 'search' ? EMBRY.blue : EMBRY.dim,
              cursor: loading || !searchQuery.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            Search
          </button>
        </form>
        <label
          style={{
            fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
            border: `1px solid ${EMBRY.amber}44`, backgroundColor: `${EMBRY.amber}10`,
            color: EMBRY.amber, cursor: 'pointer',
          }}
        >
          Import
          <input
            type="file"
            accept=".json,.jsonl"
            onChange={handleFileImport}
            style={{ display: 'none' }}
          />
        </label>
        <button
          onClick={handleExport}
          disabled={evalData.length === 0}
          style={{
            fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
            border: `1px solid ${EMBRY.dim}44`, backgroundColor: 'transparent',
            color: EMBRY.dim, cursor: 'pointer',
          }}
        >
          Export
        </button>
        <span style={{ fontSize: 9, color: EMBRY.dim, marginLeft: 'auto' }}>{sourceInfo}</span>
      </div>

      {/* Model selector chips + free-text input */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: EMBRY.dim, marginRight: 4 }}>
          Models:
        </span>
        {[...new Set([...ALL_MODELS, ...selectedModels])].map((model) => {
          const active = selectedModels.includes(model)
          return (
            <button
              key={model}
              onClick={() => toggleModel(model)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: 12,
                border: `1px solid ${active ? EMBRY.accent : EMBRY.border}`,
                backgroundColor: active ? `${EMBRY.accent}20` : 'transparent',
                color: active ? EMBRY.accent : EMBRY.dim,
                cursor: 'pointer',
              }}
            >
              {model}
            </button>
          )
        })}
        <form
          onSubmit={(e) => { e.preventDefault(); addCustomModel() }}
          style={{ display: 'flex', gap: 4 }}
        >
          <input
            type="text"
            placeholder="any litellm model..."
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            style={{
              backgroundColor: EMBRY.bgPanel,
              border: `1px solid ${EMBRY.border}`,
              borderRadius: 12,
              padding: '3px 10px',
              fontSize: 11,
              color: EMBRY.white,
              outline: 'none',
              width: 160,
            }}
          />
          <button
            type="submit"
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 12,
              border: `1px solid ${EMBRY.green}44`,
              backgroundColor: `${EMBRY.green}15`,
              color: EMBRY.green,
              cursor: 'pointer',
            }}
          >
            +
          </button>
        </form>
      </div>
      <div style={{ marginBottom: 10 }}>
        <input
          type="text"
          placeholder="Filter by label..."
          value={labelFilter}
          onChange={(e) => setLabelFilter(e.target.value)}
          style={{
            backgroundColor: EMBRY.bgPanel,
            border: `1px solid ${EMBRY.border}`,
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            color: EMBRY.white,
            outline: 'none',
            width: 240,
          }}
        />
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
          }}
        >
          <thead
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 1,
              backgroundColor: EMBRY.bgCard,
            }}
          >
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      color: EMBRY.dim,
                      borderBottom: `1px solid ${EMBRY.border}`,
                      width: h.index === 0 ? 220 : undefined,
                    }}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                style={{ borderBottom: `1px solid ${EMBRY.border}` }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    style={{
                      padding: cell.column.getIndex() === 0 ? '8px 10px' : 0,
                      verticalAlign: 'top',
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
