import { useState } from 'react'
import { useRegisterAction } from '../../../../hooks/useRegisterAction'
import { EMBRY, label, heading, card } from '../../common/EmbryStyle'

import { MONO, GLOSSARY } from './types'
import type { Project, BenchmarkRow } from './types'
import { GateCard, thStyle, tdStyle, btnOutline } from './shared'

export function BenchmarkTab({ project, data: propData }: { project: Project; data?: BenchmarkRow[] }) {
  const data = propData?.length ? propData : []
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggleSelect = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }
  const APP = 'classifier-lab'
  useRegisterAction('clf-benchmark:export', { app: APP, action: 'CLF_BENCHMARK_CLEAR', label: 'Clear Selection', description: 'Clear backbone comparison selection' })
  useRegisterAction('clf-benchmark:btn', { app: APP, action: 'CLF_BENCHMARK_EXPORT', label: 'Export', description: 'Export benchmark results' })
  useRegisterAction('clf-benchmark:checkbox', { app: APP, action: 'CLF_BENCHMARK_TOGGLE', label: 'Toggle Compare', description: 'Toggle backbone selection for side-by-side comparison', params: { backbone: { type: 'string' } } })

  const comparing = selected.size >= 2
  const bestF1 = data.length ? Math.max(...data.map(d => d.f1)) : 0
  const bestLat = data.length ? Math.min(...data.map(d => d.lat50)) : 0
  const fallbackWinner = data.reduce<BenchmarkRow | null>(
    (best, row) => (!best || row.f1 > best.f1 ? row : best),
    null,
  )
  const winnerName = data.find(d => d.winner)?.name || fallbackWinner?.name || ''
  const chartTop = 8
  const chartBottom = 192
  const axisX = [60, 360, 660, 960]

  const parallelAxes = [
    { key: 'f1', label: 'F1' },
    { key: 'acc', label: 'ACCURACY' },
    { key: 'wilson', label: 'WILSON LOWER' },
    { key: 'rounds', label: 'ROUNDS' },
  ] as const

  const axisBounds = parallelAxes.map((axis) => {
    const values = data.map(d => d[axis.key])
    if (!values.length) return { min: 0, max: 1 }
    return { min: Math.min(...values), max: Math.max(...values) }
  })

  const axisY = (axisIdx: number, value: number) => {
    const { min, max } = axisBounds[axisIdx]
    if (max === min) return chartTop + (chartBottom - chartTop) / 2
    const t = (value - min) / (max - min)
    return chartBottom - t * (chartBottom - chartTop)
  }

  const linePath = (row: BenchmarkRow) => parallelAxes
    .map((axis, axisIdx) => `${axisIdx === 0 ? 'M' : 'L'} ${axisX[axisIdx]} ${axisY(axisIdx, row[axis.key]).toFixed(2)}`)
    .join(' ')

  const benchPassed = bestF1 >= 0.90 && data.length >= 2
  const winnerWilson = fallbackWinner?.wilson ?? 0

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <GateCard
          name="BENCHMARK GATE"
          passed={benchPassed}
          metrics={[
            { label: benchPassed ? 'BEST F1' : 'BEST F1 (below target)', value: bestF1 > 0 ? bestF1.toFixed(3) : '—', color: benchPassed ? EMBRY.green : EMBRY.red },
            { label: 'WILSON CI', value: winnerWilson > 0 ? winnerWilson.toFixed(3) : '—' },
            { label: 'BACKBONES', value: String(data.length) },
          ]}
          checks={[
            { label: `Best F1 meets target`, ok: bestF1 >= 0.90, detail: bestF1 > 0 ? bestF1.toFixed(3) : 'No data' },
            { label: '≥2 backbones compared', ok: data.length >= 2, detail: `${data.length} tested` },
            { label: 'Latency within budget', ok: bestLat > 0 && bestLat < 100, detail: bestLat > 0 ? `${bestLat}ms` : '—' },
          ]}
          halt={!benchPassed && data.length > 0 ? (() => {
            if (data.length < 2) return { reason: 'Only 1 backbone tested — not enough to compare.', action: 'Go to Train tab and add more backbone candidates.' }
            const gap = 0.90 - bestF1
            if (gap > 0.3) return { reason: `Best backbone F1 (${bestF1.toFixed(3)}) is far below target. No backbone is competitive for this task with current data.`, action: 'This is likely a data problem. Go to the Data tab to add more training samples, then retrain.' }
            return { reason: `No backbone met the target. Best: ${winnerName} at F1 ${bestF1.toFixed(3)}.`, action: 'Try different backbones or tune hyperparameters. Check the Train tab failure analysis for specific suggestions.' }
          })() : null}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ ...heading, fontSize: 16 }}>BACKBONE COMPARISON — {project.name.toUpperCase()} ({data.length} backbones)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {comparing && (
            <span style={{ fontSize: 9, color: EMBRY.accent, fontWeight: 700 }}>
              COMPARING {selected.size} BACKBONES
            </span>
          )}
          {selected.size > 0 && (
            <button data-qid="clf-benchmark:export" data-qs-action="CLF_BENCHMARK_CLEAR" title="Clear backbone comparison selection" style={{ ...btnOutline, fontSize: 9, padding: '4px 10px' }} onClick={() => setSelected(new Set())}>CLEAR</button>
          )}
          <button data-qid="clf-benchmark:btn" data-qs-action="CLF_BENCHMARK_EXPORT" title="Export benchmark results" style={btnOutline}>EXPORT</button>
        </div>
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 28 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
              <th style={{ ...thStyle, width: 32 }}>
                <input data-qid="clf-benchmark:checkbox" data-qs-action="CLF_BENCHMARK_SELECT_ALL" title="Select or deselect all backbones for comparison" type="checkbox" checked={selected.size === data.length && data.length > 0}
                  onChange={() => setSelected(prev => prev.size === data.length ? new Set() : new Set(data.map(d => d.name)))}
                  style={{ accentColor: EMBRY.accent }} />
              </th>
              {[
                { h: 'BACKBONE', tip: GLOSSARY['Backbone'] },
                { h: 'MACRO F1', tip: GLOSSARY['Macro F1'] },
                { h: 'ACCURACY', tip: GLOSSARY['Accuracy'] },
                { h: 'WILSON CI', tip: GLOSSARY['Wilson CI'] },
                { h: 'LAT p50 (ms)', tip: 'Median inference latency — time to classify one sample' },
                { h: 'LAT p95 (ms)', tip: '95th percentile latency — worst case for most requests' },
                { h: 'PARAMS (M)', tip: 'Model size in millions of parameters — larger models are slower but may be more accurate' },
                { h: 'TRAIN TIME', tip: 'Wall-clock time to train this backbone' },
              ].map(({ h, tip }) => (
                <th key={h} style={{ ...thStyle, cursor: 'help' }} title={tip}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((b, i) => {
              const isSelected = selected.has(b.name)
              const dimmed = comparing && !isSelected
              return (
                <tr key={b.name} data-qid="clf-benchmark:row" data-qs-action="CLF_BENCHMARK_TOGGLE" title="Toggle backbone for comparison" onClick={() => toggleSelect(b.name)} style={{
                  borderBottom: `1px solid ${EMBRY.border}`,
                  borderLeft: isSelected ? `3px solid ${EMBRY.accent}` : i === 0 ? `3px solid ${EMBRY.green}` : '3px solid transparent',
                  background: isSelected ? 'rgba(124,58,237,0.06)' : i === 0 ? 'rgba(0,255,136,0.02)' : 'transparent',
                  opacity: dimmed ? 0.4 : 1,
                  cursor: 'pointer',
                  transition: 'opacity 0.15s',
                }}>
                  <td style={{ ...tdStyle, width: 32 }} onClick={e => e.stopPropagation()}>
                    <input data-qid="clf-benchmark:checkbox" data-qs-action="CLF_BENCHMARK_TOGGLE" title="Toggle backbone for comparison" type="checkbox" checked={isSelected} onChange={() => toggleSelect(b.name)} style={{ accentColor: EMBRY.accent }} />
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: i === 0 ? EMBRY.green : EMBRY.white }}>
                    {i === 0 && '★ '}{b.name}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: b.f1 === bestF1 ? EMBRY.green : EMBRY.white }}>{b.f1.toFixed(3)}</td>
                  <td style={tdStyle}>{b.acc.toFixed(3)}</td>
                  <td style={tdStyle}>{b.wilson.toFixed(3)}</td>
                  <td style={{ ...tdStyle, color: b.lat50 === bestLat ? EMBRY.green : EMBRY.white }}>{b.lat50}</td>
                  <td style={tdStyle}>{b.lat95}</td>
                  <td style={tdStyle}>{b.params}</td>
                  <td style={tdStyle}>{b.time}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Parallel coordinates */}
      <div style={{ ...card, position: 'relative', padding: '40px 40px 60px' }}>
        <div style={{ ...label, marginBottom: 16 }}>BENCHMARK METRICS (PARALLEL COORDINATES)</div>
        <svg width="100%" height="200" viewBox="0 0 1000 200" style={{ overflow: 'visible' }}>
          {parallelAxes.map((axis, i) => {
            const x = axisX[i]
            const bounds = axisBounds[i]
            return (
              <g key={axis.key}>
                <line x1={x} y1={0} x2={x} y2={200} stroke={EMBRY.muted} strokeWidth={1} strokeDasharray="4 2" />
                <text x={x} y={-8} fill={EMBRY.muted} fontSize={8} textAnchor="middle" fontFamily={MONO}>
                  {bounds.max.toFixed(axis.key === 'rounds' ? 0 : 3)}
                </text>
                <text x={x} y={208} fill={EMBRY.muted} fontSize={8} textAnchor="middle" fontFamily={MONO}>
                  {bounds.min.toFixed(axis.key === 'rounds' ? 0 : 3)}
                </text>
                <text x={x} y={220} fill={EMBRY.dim} fontSize={9} textAnchor="middle" fontWeight={700}>{axis.label}</text>
              </g>
            )
          })}

          {data.map(row => {
            const isWinner = row.name === winnerName
            const isSelected = selected.has(row.name)
            const dimmed = comparing && !isSelected
            return (
              <path
                key={row.name}
                d={linePath(row)}
                fill="none"
                stroke={isSelected ? EMBRY.accent : isWinner ? EMBRY.green : EMBRY.blue}
                strokeWidth={isSelected ? 3 : isWinner ? 2.5 : 1.4}
                opacity={dimmed ? 0.1 : isSelected ? 0.95 : isWinner ? 0.9 : 0.4}
              />
            )
          })}

          <g>
            <line x1={740} y1={-10} x2={770} y2={-10} stroke={EMBRY.accent} strokeWidth={2.5} />
            <text x={775} y={-7} fill={EMBRY.dim} fontSize={8}>
              WINNER {winnerName ? `(${winnerName})` : ''}
            </text>
            <line x1={900} y1={-10} x2={930} y2={-10} stroke={EMBRY.blue} strokeWidth={2} opacity={0.7} />
            <text x={935} y={-7} fill={EMBRY.dim} fontSize={8}>OTHER BACKBONES</text>
          </g>
        </svg>
      </div>

      {/* Comparison delta panel */}
      {comparing && (() => {
        const sel = data.filter(d => selected.has(d.name))
        const best = sel.reduce((a, b) => a.f1 > b.f1 ? a : b)
        const metrics = ['f1', 'acc', 'wilson', 'lat50', 'lat95', 'params'] as const
        const metricLabels: Record<string, string> = { f1: 'Macro F1', acc: 'Accuracy', wilson: 'Wilson CI', lat50: 'Lat p50', lat95: 'Lat p95', params: 'Params (M)' }
        const lowerIsBetter = new Set(['lat50', 'lat95', 'params'])
        return (
          <div style={{ ...card, marginTop: 16 }}>
            <div style={{ ...label, marginBottom: 12 }}>COMPARISON DELTA</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
                  <th style={thStyle}>BACKBONE</th>
                  {metrics.map(m => <th key={m} style={thStyle}>{metricLabels[m]}</th>)}
                </tr>
              </thead>
              <tbody>
                {sel.map(row => (
                  <tr key={row.name} style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: row.name === best.name ? EMBRY.green : EMBRY.white }}>
                      {row.name === best.name && '★ '}{row.name}
                    </td>
                    {metrics.map(m => {
                      const val = row[m]
                      const bestVal = lowerIsBetter.has(m) ? Math.min(...sel.map(s => s[m])) : Math.max(...sel.map(s => s[m]))
                      const isBest = val === bestVal
                      return (
                        <td key={m} style={{ ...tdStyle, fontWeight: isBest ? 700 : 400, color: isBest ? EMBRY.green : EMBRY.white }}>
                          {typeof val === 'number' ? (m === 'params' || m === 'lat50' || m === 'lat95' ? val : val.toFixed(3)) : val}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })()}
    </div>
  )
}
