import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { AlertTriangle, Cpu, ChevronDown, ChevronRight } from 'lucide-react'
import { marked } from 'marked'
import { EMBRY, label, heading, card, panel, glowDot } from '../../common/EmbryStyle'
import { RunButton } from '../../common/RunButton'
import { useRegisterAction } from '../../../../hooks/useRegisterAction'

import { API, MONO } from './types'
import type { Project, TrainingRow, BenchmarkTrainConfigResponse, FailureAnalysis } from './types'
import type { SortingState } from '@tanstack/react-table'
import { GateCard, GpuCard, MD_CSS, thStyle, tdStyle, statusBadge, gateBadge, btnOutline, rerunInputStyle } from './shared'

export function TrainTab({ project, rows }: { project: Project; rows: TrainingRow[] }) {
  const [selectedGpu, setSelectedGpu] = useState('local')
  const [gpuInfo, setGpuInfo] = useState<any>(null)
  const [backbonesInput, setBackbonesInput] = useState('')
  const [gateF1Input, setGateF1Input] = useState('0.90')
  const [maxRoundsInput, setMaxRoundsInput] = useState('5')
  const [maxTrainSamplesInput, setMaxTrainSamplesInput] = useState('10000')
  const [trainSorting, setTrainSorting] = useState<SortingState>([{ id: 'f1', desc: true }])
  const [retrying, setRetrying] = useState<string | null>(null)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [pipelineStatus, setPipelineStatus] = useState('')
  const best = rows.find(r => r.status === 'pass')
  const passCount = rows.filter(r => r.status === 'pass').length
  const totalCount = rows.length

  const parseBackbones = useCallback((data: BenchmarkTrainConfigResponse): string[] => {
    if (Array.isArray(data.backbones) && data.backbones.length) {
      return data.backbones
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    }
    if (Array.isArray(data.results) && data.results.length) {
      return data.results
        .map((result) => result.backbone)
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    }
    return []
  }, [])

  const fallbackBackbones = useMemo(
    () => Array.from(new Set(rows.map((row) => row.backbone.trim()).filter((item) => item.length > 0))),
    [rows],
  )

  useEffect(() => {
    fetch(`${API}/projects/classifier-lab/gpu-info`)
      .then(r => r.json()).then(setGpuInfo)
      .catch(() => setGpuInfo(null))
  }, [])

  useEffect(() => {
    setGateF1Input('0.90')
    setMaxRoundsInput('5')
    setMaxTrainSamplesInput('10000')
    setBackbonesInput(fallbackBackbones.join(', '))
    fetch(`${API}/projects/classifier-lab/benchmark-results/${project.id}`)
      .then(r => r.json())
      .then((data: BenchmarkTrainConfigResponse) => {
        const parsedBackbones = parseBackbones(data)
        if (parsedBackbones.length > 0) {
          setBackbonesInput(parsedBackbones.join(', '))
        }
        if (typeof data.gate_f1 === 'number' && Number.isFinite(data.gate_f1)) {
          setGateF1Input(data.gate_f1.toFixed(2))
        }
        if (typeof data.max_rounds === 'number' && Number.isFinite(data.max_rounds)) {
          setMaxRoundsInput(String(Math.max(1, Math.round(data.max_rounds))))
        }
        if (typeof data.max_train_samples === 'number' && Number.isFinite(data.max_train_samples)) {
          setMaxTrainSamplesInput(String(Math.max(1, Math.round(data.max_train_samples))))
        }
      })
      .catch(() => {})
  }, [fallbackBackbones, parseBackbones, project.id])

  const rerunBackbones = useMemo(
    () => backbonesInput.split(',').map((item) => item.trim()).filter((item) => item.length > 0),
    [backbonesInput],
  )
  const gateF1 = Number(gateF1Input)
  const maxRounds = Number(maxRoundsInput)
  const maxTrainSamples = Number(maxTrainSamplesInput)
  const rerunGateF1 = Number.isFinite(gateF1) && gateF1 > 0 ? gateF1 : 0.9
  const rerunMaxRounds = Number.isFinite(maxRounds) && maxRounds > 0 ? Math.round(maxRounds) : 5
  const rerunMaxTrainSamples = Number.isFinite(maxTrainSamples) && maxTrainSamples > 0 ? Math.round(maxTrainSamples) : 10000

  const localGpu = gpuInfo?.gpus?.[0]

  const APP = 'classifier-lab'
  useRegisterAction('clf-train:btn', { app: APP, action: 'CLF_TRAIN_RUN_PIPELINE', label: 'Run Full Pipeline', description: 'Run data check, enrichment, and multi-backbone training to gate' })
  useRegisterAction('clf-train:backbones-input', { app: APP, action: 'CLF_TRAIN_SET_BACKBONES', label: 'Set Backbones', description: 'Set comma-separated backbone model architectures to race', params: { backbones: { type: 'string' } } })
  useRegisterAction('clf-train:gate-f1-input', { app: APP, action: 'CLF_TRAIN_SET_GATE_F1', label: 'Set Gate F1', description: 'Set minimum macro F1 threshold for quality gate', params: { gate_f1: { type: 'number', default: 0.90 } } })
  useRegisterAction('clf-train:max-rounds-input', { app: APP, action: 'CLF_TRAIN_SET_MAX_ROUNDS', label: 'Set Max Rounds', description: 'Set maximum self-improvement iterations per backbone', params: { max_rounds: { type: 'number', default: 5 } } })
  useRegisterAction('clf-train:max-samples-input', { app: APP, action: 'CLF_TRAIN_SET_MAX_SAMPLES', label: 'Set Max Samples', description: 'Cap training samples per class for faster experimentation', params: { max_samples: { type: 'number', default: 10000 } } })
  useRegisterAction('clf-train:promote', { app: APP, action: 'CLF_TRAIN_PROMOTE', label: 'Promote Best', description: 'Promote the best backbone to production' })

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ ...heading, fontSize: 22 }}>{project.name.toUpperCase()}</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
            <span style={{ ...gateBadge, background: 'rgba(124,58,237,0.1)', color: EMBRY.accent, borderColor: EMBRY.accent + '44' }}>
              TARGET: F1 ≥ {rerunGateF1.toFixed(2)}
            </span>
            {totalCount > 0 && (
              <span style={{ ...gateBadge, background: 'rgba(255,170,0,0.1)', color: EMBRY.amber, borderColor: EMBRY.amber + '44' }}>
                {passCount > 0 ? `${passCount} PASSED` : `${totalCount} CANDIDATES`}
              </span>
            )}
            {best && (
              <span style={{ ...gateBadge, background: 'rgba(0,255,136,0.1)', color: EMBRY.green, borderColor: EMBRY.green + '44' }}>
                BEST: {best.backbone} F1 {best.f1.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button data-qid="clf-train:btn" data-qs-action="CLF_TRAIN_CONTINUE" title="Continue backbone search with new strategies" style={{ ...btnOutline, borderColor: EMBRY.amber + '66', color: EMBRY.amber }}>CONTINUE SEARCH</button>
          <RunButton data-qid="clf-train:promote" data-qs-action="CLF_TRAIN_PROMOTE" title="Promote best backbone to production" onClick={() => {}} disabled={!best}>PROMOTE</RunButton>
        </div>
      </div>

      {/* Train gate card */}
      <div style={{ marginBottom: 20 }}>
        <GateCard
          name="TRAIN GATE"
          passed={passCount > 0}
          metrics={[
            { label: 'BEST F1', value: best ? best.f1.toFixed(3) : rows.length > 0 ? Math.max(...rows.map(r => r.f1)).toFixed(3) : '—', color: best ? EMBRY.green : rows.length > 0 ? EMBRY.red : EMBRY.dim },
            { label: 'BACKBONES', value: String(totalCount) },
            { label: 'PASSED', value: `${passCount} / ${totalCount}`, color: passCount > 0 ? EMBRY.green : EMBRY.red },
          ]}
          checks={[
            { label: 'Gate met by ≥1 backbone', ok: passCount > 0, detail: passCount > 0 ? `${passCount} passed` : 'No' },
            { label: 'No crashed runs', ok: !rows.some(r => r.status === 'fail' && r.f1 === 0), detail: rows.filter(r => r.f1 === 0).length > 0 ? `${rows.filter(r => r.f1 === 0).length} crashed` : 'Clean' },
            { label: 'All runs complete', ok: !rows.some(r => r.status === 'training' || r.status === 'queued'), detail: rows.filter(r => r.status === 'training' || r.status === 'queued').length > 0 ? 'In progress' : 'Yes' },
          ]}
          halt={passCount === 0 && totalCount > 0 && !rows.some(r => r.status === 'training' || r.status === 'queued') ? (() => {
            const bestF1 = rows.length > 0 ? Math.max(...rows.map(r => r.f1)) : 0
            const gap = rerunGateF1 - bestF1
            if (gap > 0.3) return { reason: `Best F1 (${bestF1.toFixed(3)}) is ${gap.toFixed(3)} below gate — this is likely a data problem, not a model problem.`, action: 'Add more training data, especially for underperforming classes. Check the Data tab for class balance. Consider lowering the gate threshold if the task is inherently difficult.' }
            if (gap > 0.1) return { reason: `Best F1 (${bestF1.toFixed(3)}) is ${gap.toFixed(3)} below gate — significant gap remaining after all backbones tried.`, action: 'Try a larger backbone model, increase epochs, or tune hyperparameters on the Tune tab. Check Failure Analysis below for specific /dogpile suggestions.' }
            return { reason: `Best F1 (${bestF1.toFixed(3)}) is close but ${gap.toFixed(3)} below gate.`, action: 'Small gap — try label smoothing, learning rate warmup, or ensemble of top backbones on the Tune tab.' }
          })() : null}
        />
      </div>

      {/* Rerun config */}
      <div style={{ ...card, marginBottom: 14, padding: 16 }}>
        <div style={{ ...label, marginBottom: 12 }}>TRAINING CONFIGURATION</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <div style={{ ...label, fontSize: 8, marginBottom: 6, cursor: 'help', borderBottom: '1px dotted rgba(100,116,139,0.4)', display: 'inline-block' }} title="Comma-separated list of pre-trained model architectures to race against each other">BACKBONES</div>
            <input data-qid="clf-train:backbones-input" data-qs-action="CLF_TRAIN_SET_BACKBONES" title="Comma-separated backbone architectures to race"
              value={backbonesInput}
              onChange={(e) => setBackbonesInput(e.target.value)}
              placeholder="resnet50, efficientnet_b0, convnext_tiny"
              style={rerunInputStyle}
            />
          </div>
          <div>
            <div style={{ ...label, fontSize: 8, marginBottom: 6, cursor: 'help', borderBottom: '1px dotted rgba(100,116,139,0.4)', display: 'inline-block' }} title="Minimum macro F1 score on held-out test set to pass the quality gate">TARGET F1</div>
            <input data-qid="clf-train:gate-f1-input" data-qs-action="CLF_TRAIN_SET_GATE_F1" title="Minimum macro F1 on test set to pass gate"
              type="number"
              min={0}
              step="0.01"
              value={gateF1Input}
              onChange={(e) => setGateF1Input(e.target.value)}
              style={rerunInputStyle}
            />
          </div>
          <div>
            <div style={{ ...label, fontSize: 8, marginBottom: 6, cursor: 'help', borderBottom: '1px dotted rgba(100,116,139,0.4)', display: 'inline-block' }} title="Maximum self-improvement iterations per backbone before escalating to next strategy">MAX ROUNDS</div>
            <input data-qid="clf-train:max-rounds-input" data-qs-action="CLF_TRAIN_SET_MAX_ROUNDS" title="Max self-improvement iterations per backbone"
              type="number"
              min={1}
              step={1}
              value={maxRoundsInput}
              onChange={(e) => setMaxRoundsInput(e.target.value)}
              style={rerunInputStyle}
            />
          </div>
          <div>
            <div style={{ ...label, fontSize: 8, marginBottom: 6, cursor: 'help', borderBottom: '1px dotted rgba(100,116,139,0.4)', display: 'inline-block' }} title="Cap training samples per class to speed up experimentation">MAX SAMPLES</div>
            <input data-qid="clf-train:max-samples-input" data-qs-action="CLF_TRAIN_SET_MAX_SAMPLES" title="Cap training samples per class"
              type="number"
              min={1}
              step={1}
              value={maxTrainSamplesInput}
              onChange={(e) => setMaxTrainSamplesInput(e.target.value)}
              style={rerunInputStyle}
            />
          </div>
          <button data-qid="clf-train:btn" data-qs-action="CLF_TRAIN_RUN_PIPELINE" title="Run full training pipeline with data check and multi-backbone racing"
            onClick={() => {
              if (rerunBackbones.length === 0 || pipelineRunning) return
              setPipelineRunning(true)
              setPipelineStatus('Starting pipeline...')
              fetch(`${API}/projects/classifier-lab/pipeline/${project.id}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  gate_f1: rerunGateF1,
                  max_rounds: rerunMaxRounds,
                  min_per_class: 50,
                  max_length: 128,
                }),
              })
                .then(r => r.json())
                .then(result => {
                  if (result.status === 'started') {
                    setPipelineStatus('Pipeline running — checking data sufficiency...')
                    const pollId = setInterval(() => {
                      fetch(`${API}/projects/classifier-lab/pipeline-status/${project.id}`)
                        .then(r => r.json())
                        .then(s => {
                          if (s.status === 'pipeline-running') {
                            setPipelineStatus(`Pipeline running... ${s.f1 ? `best F1 so far: ${s.f1.toFixed(3)}` : 'training in progress'}`)
                          } else if (s.status === 'passed') {
                            setPipelineRunning(false)
                            setPipelineStatus(`PASSED — ${s.backbone || '?'} F1=${(s.f1 || 0).toFixed(3)}`)
                            clearInterval(pollId)
                          } else if (s.status?.startsWith('halted') || s.status === 'abandoned' || s.status === 'pipeline-failed') {
                            setPipelineRunning(false)
                            setPipelineStatus(`${s.status.toUpperCase()} — ${s.f1 ? `best F1=${s.f1.toFixed(3)}` : 'see details below'}`)
                            clearInterval(pollId)
                          } else if (s.status === 'evaluated' || s.status === 'data-enriched' || s.status === 'researched') {
                            setPipelineRunning(false)
                            setPipelineStatus(`COMPLETE — ${s.backbone || '?'} F1=${(s.f1 || 0).toFixed(3)}`)
                            clearInterval(pollId)
                          }
                        })
                        .catch(() => {})
                    }, 10_000)
                    setTimeout(() => { clearInterval(pollId); setPipelineRunning(false) }, 1800_000)
                  } else if (result.passed) {
                    setPipelineRunning(false)
                    setPipelineStatus(`PASSED — ${result.best_backbone} F1=${(result.best_f1 || 0).toFixed(3)}`)
                  } else if (result.status === 'abandoned') {
                    setPipelineRunning(false)
                    setPipelineStatus(`HALTED — data insufficient after enrichment`)
                  } else {
                    setPipelineRunning(false)
                    setPipelineStatus(`HALTED — best F1=${(result.best_f1 || 0).toFixed(3)} after ${result.total_rounds || 0} rounds`)
                  }
                })
                .catch(() => { setPipelineRunning(false); setPipelineStatus('Pipeline failed — check server logs') })
            }}
            disabled={rerunBackbones.length === 0 || pipelineRunning}
            style={{
              background: rerunBackbones.length > 0 && !pipelineRunning ? EMBRY.accent : 'transparent',
              border: `1px solid ${rerunBackbones.length > 0 && !pipelineRunning ? EMBRY.accent : EMBRY.border}`,
              color: rerunBackbones.length > 0 && !pipelineRunning ? '#000' : EMBRY.dim,
              padding: '10px 24px', borderRadius: 6, fontSize: 11, fontWeight: 900,
              cursor: rerunBackbones.length > 0 && !pipelineRunning ? 'pointer' : 'default',
              whiteSpace: 'nowrap',
            }}
          >
            {pipelineRunning ? 'RUNNING PIPELINE...' : 'RUN FULL PIPELINE'}
          </button>
        </div>
      </div>

      {/* Pipeline status */}
      {pipelineStatus && (
        <div style={{
          ...panel, marginBottom: 12, padding: '8px 14px', fontSize: 10, fontFamily: MONO,
          color: pipelineStatus.includes('PASSED') ? EMBRY.green : pipelineStatus.includes('HALTED') || pipelineStatus.includes('failed') ? EMBRY.amber : EMBRY.dim,
          border: `1px solid ${pipelineStatus.includes('PASSED') ? EMBRY.green : EMBRY.amber}22`,
        }}>
          {pipelineRunning && <span style={{ marginRight: 8 }}>⏳</span>}
          {pipelineStatus}
        </div>
      )}

      {/* Sortable leaderboard */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={label}>LIVE TRAINING LEADERBOARD</div>
        {rows.some(r => r.status === 'fail') && (
          <button data-qid="clf-train:btn" data-qs-action="CLF_TRAIN_RETRY_FAILED" title="Retry all failed backbone training runs"
            onClick={() => {
              const failed = rows.filter(r => r.status === 'fail').map(r => r.backbone)
              if (!failed.length) return
              setRetrying(failed.join(','))
              fetch(`${API}/projects/classifier-lab/rerun/${project.id}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  backbones: failed, gate_f1: rerunGateF1,
                  max_rounds: rerunMaxRounds, max_train_samples: rerunMaxTrainSamples,
                  modality: project.modality, task: project.name, retry: true,
                }),
              }).finally(() => setRetrying(null))
            }}
            disabled={!!retrying}
            style={{ ...btnOutline, borderColor: EMBRY.amber + '66', color: EMBRY.amber, fontSize: 9, padding: '4px 12px' }}
          >
            {retrying ? 'RETRYING...' : `RETRY ${rows.filter(r => r.status === 'fail').length} FAILED BACKBONE${rows.filter(r => r.status === 'fail').length === 1 ? '' : 'S'}`}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div style={{ ...card, padding: 32, textAlign: 'center', marginBottom: 28 }}>
          <Cpu size={24} color={EMBRY.dim} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: EMBRY.dim, marginBottom: 4 }}>NO TRAINING RUNS</div>
          <div style={{ fontSize: 10, color: EMBRY.muted }}>
            Configure backbones above and click START TRAINING to begin.
          </div>
        </div>
      ) : (
      <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 28 }}>
        {(() => {
          const trainColumns = [
            { id: 'rank', header: '#', tip: 'Rank by F1 score (best first)', accessor: (r: TrainingRow) => r.rank, sortable: true },
            { id: 'backbone', header: 'BACKBONE', tip: 'Pre-trained model architecture being evaluated', accessor: (r: TrainingRow) => r.backbone, sortable: true },
            { id: 'lr', header: 'LR', tip: 'Learning rate used for this training run', accessor: (r: TrainingRow) => parseFloat(r.lr) || 0, sortable: true },
            { id: 'bs', header: 'BATCH', tip: 'Number of samples per gradient update step', accessor: (r: TrainingRow) => r.bs, sortable: true },
            { id: 'f1', header: 'F1', tip: 'Macro F1 on held-out test set — primary quality metric', accessor: (r: TrainingRow) => r.f1, sortable: true },
            { id: 'acc', header: 'ACC', tip: 'Overall accuracy — can be misleading with imbalanced classes', accessor: (r: TrainingRow) => r.acc, sortable: true },
            { id: 'latency', header: 'LATENCY', tip: 'Inference latency per sample (p50)', accessor: (r: TrainingRow) => r.latency, sortable: false },
            { id: 'cost', header: 'COST', tip: 'Training cost for this backbone (FREE = local GPU)', accessor: (r: TrainingRow) => r.cost, sortable: false },
            { id: 'gate', header: 'GATE', tip: `Whether F1 ≥ ${rerunGateF1.toFixed(2)} on held-out test set`, accessor: (r: TrainingRow) => r.status, sortable: true },
          ]
          const sorted = [...rows].sort((a, b) => {
            if (!trainSorting.length) return 0
            const { id, desc } = trainSorting[0]
            const col = trainColumns.find(c => c.id === id)
            if (!col) return 0
            const av = col.accessor(a), bv = col.accessor(b)
            const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
            return desc ? -cmp : cmp
          })
          const sortIcon = (colId: string) => {
            const s = trainSorting.find(x => x.id === colId)
            if (!s) return ' ↕'
            return s.desc ? ' ↓' : ' ↑'
          }
          const toggleSort = (colId: string) => {
            setTrainSorting(prev => {
              const existing = prev.find(x => x.id === colId)
              if (!existing) return [{ id: colId, desc: true }]
              if (existing.desc) return [{ id: colId, desc: false }]
              return []
            })
          }
          return (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
                  {trainColumns.map(col => (
                    <th data-qid="explorer-classifier-lab-traintab:auto:358" data-qs-action="EXPLORER_CLASSIFIER_LAB_TRAINTAB_AUTO_358"
                      key={col.id}
                      style={{ ...thStyle, cursor: col.sortable ? 'pointer' : 'help', userSelect: 'none' }}
                      title={col.tip}
                      onClick={() => col.sortable && toggleSort(col.id)}
                    >
                      {col.header}{col.sortable ? sortIcon(col.id) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.backbone} style={{
                    borderBottom: `1px solid ${EMBRY.border}`,
                    borderLeft: r.status === 'pass' && r.f1 === Math.max(...rows.filter(x => x.status === 'pass').map(x => x.f1)) ? `3px solid ${EMBRY.green}` : '3px solid transparent',
                    background: r.status === 'training' ? 'rgba(124,58,237,0.03)' : 'transparent',
                  }}>
                    <td style={tdStyle}>{r.rank}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: r.status === 'pass' ? EMBRY.green : EMBRY.white }}>{r.backbone}</td>
                    <td style={tdStyle}>{r.lr}</td>
                    <td style={tdStyle}>{r.bs || '—'}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: r.f1 >= rerunGateF1 ? EMBRY.green : r.f1 > 0 ? EMBRY.red : EMBRY.muted }}>
                      {r.f1 ? r.f1.toFixed(3) : '—'}
                    </td>
                    <td style={tdStyle}>{r.acc ? r.acc.toFixed(3) : '—'}</td>
                    <td style={tdStyle}>{r.latency}</td>
                    <td style={{ ...tdStyle, color: r.cost === 'FREE' ? EMBRY.green : EMBRY.white }}>{r.cost}</td>
                    <td style={tdStyle}>
                      {r.status === 'training' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 60, height: 4, background: EMBRY.bgDeep, borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${r.progress ?? 0}%`, background: EMBRY.amber }} />
                          </div>
                          <span style={{ fontSize: 8, color: EMBRY.amber, fontWeight: 700 }}>{r.progress}%</span>
                        </div>
                      ) : r.status === 'queued' ? (
                        <span style={{ ...statusBadge, background: 'rgba(100,116,139,0.15)', color: EMBRY.dim }}>QUEUED</span>
                      ) : (
                        <span style={{ ...statusBadge, background: r.status === 'pass' ? 'rgba(0,255,136,0.1)' : 'rgba(255,68,68,0.1)', color: r.status === 'pass' ? EMBRY.green : EMBRY.red }}>
                          {r.status.toUpperCase()}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        })()}
      </div>
      )}

      {/* All-failed inline guidance */}
      {!best && rows.length > 0 && (
        <div style={{ ...card, border: `1px solid ${EMBRY.amber}33`, background: 'rgba(255,170,0,0.03)', marginBottom: 16, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <AlertTriangle size={14} color={EMBRY.amber} />
            <span style={{ fontSize: 11, fontWeight: 900, color: EMBRY.amber }}>
              ALL {rows.length} BACKBONES FAILED GATE (F1 {'<'} {rerunGateF1.toFixed(2)})
            </span>
          </div>
          <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.6 }}>
            {(() => {
              const bestRow = [...rows].sort((a, b) => b.f1 - a.f1)[0]
              const gap = bestRow ? rerunGateF1 - bestRow.f1 : 0
              const suggestions: string[] = []
              if (gap < 0.02) suggestions.push('Gap is small — try label smoothing (0.1) or a larger model (bert-base-uncased)')
              if (gap >= 0.02 && gap < 0.1) suggestions.push('Try a larger backbone (bert-base, roberta-base) or increase epochs')
              if (gap >= 0.1) suggestions.push('Model is far from gate — check data quality, consider more training data')
              if (bestRow && !bestRow.lr) suggestions.push('LR and batch size not recorded — check Tune tab HP configuration')
              suggestions.push('See Failure Analysis below for /dogpile research and per-round diagnosis')
              return suggestions.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
                  <span style={{ color: EMBRY.amber }}>→</span> {s}
                </div>
              ))
            })()}
          </div>
        </div>
      )}

      {/* Best recommendation */}
      {best && (
        <div style={{ ...panel, border: `1px solid ${EMBRY.green}33`, background: 'rgba(0,255,136,0.03)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={glowDot(EMBRY.green, 8)} />
          <span style={{ ...label, color: EMBRY.green }}>RECOMMENDED</span>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13 }}>
            {best.backbone}
          </span>
          <span style={{ fontSize: 11, color: EMBRY.dim, fontFamily: MONO }}>
            F1 {best.f1.toFixed(3)} · {best.latency || '—'} · {best.cost || 'FREE'}
          </span>
        </div>
      )}

      {/* Failure analysis */}
      <FailureAnalysisPanel project={project} autoExpand={!best && rows.length > 0} />

      {/* GPU picker */}
      <div style={{ ...label, marginBottom: 8 }}>RESOURCE ALLOCATION</div>
      <div data-qid="explorer-classifier-lab-traintab:auto:465" data-qs-action="EXPLORER_CLASSIFIER_LAB_TRAINTAB_AUTO_465" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <GpuCard
          name={localGpu ? `LOCAL ${localGpu.name}` : 'LOCAL GPU'}
          vram={localGpu ? `${Math.round(localGpu.memoryTotal / 1024)}GB` : '—'}
          price="FREE"
          avail={localGpu ? Math.max(0, 100 - localGpu.utilization) : 0}
          active={selectedGpu === 'local'} onClick={() => setSelectedGpu('local')}
        />
        <GpuCard name="H100" vram="80GB" price="$2.49/hr" avail={0} active={selectedGpu === 'h100'} onClick={() => setSelectedGpu('h100')} />
        <GpuCard name="A100" vram="80GB" price="$1.64/hr" avail={0} active={selectedGpu === 'a100'} onClick={() => setSelectedGpu('a100')} />
        <GpuCard name="B200" vram="192GB" price="$5.49/hr" avail={0} active={selectedGpu === 'b200'} onClick={() => setSelectedGpu('b200')} />
      </div>
      <div style={{ fontSize: 9, color: EMBRY.muted, marginTop: 8 }}>
        Remote GPUs via /ops-runpod — availability checked on demand
      </div>
    </div>
  )
}

function FailureAnalysisPanel({ project, autoExpand = false }: { project: Project; autoExpand?: boolean }) {
  const [analysis, setAnalysis] = useState<FailureAnalysis | null>(null)
  const [expanded, setExpanded] = useState(autoExpand)

  useEffect(() => { if (autoExpand) setExpanded(true) }, [autoExpand])

  useEffect(() => {
    fetch(`${API}/projects/classifier-lab/failure-analysis/${project.id}`)
      .then(r => r.json()).then((d: FailureAnalysis) => {
        if (d.totalRounds > 0) setAnalysis(d)
        else setAnalysis(null)
      })
      .catch(() => setAnalysis(null))
  }, [project.id])

  if (!analysis || analysis.totalRounds === 0) return null

  const hasFailed = analysis.bestF1 < 0.90
  if (!hasFailed) return null

  return (
    <div style={{ marginBottom: 28 }}>
      <style>{MD_CSS}</style>
      <button data-qid="clf-train:btn" data-qs-action="CLF_TRAIN_TOGGLE_FAILURE" title="Toggle failure analysis details"
        onClick={() => setExpanded(!expanded)}
        style={{
          ...card, width: '100%', cursor: 'pointer', textAlign: 'left',
          border: `1px solid ${EMBRY.red}33`, background: 'rgba(255,68,68,0.04)',
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
        }}
      >
        <AlertTriangle size={16} color={EMBRY.red} />
        <span style={{ ...label, color: EMBRY.red, flex: 1 }}>
          FAILURE ANALYSIS — {analysis.totalRounds} ROUNDS, BEST F1 {analysis.bestF1.toFixed(3)} {'<'} 0.90
        </span>
        {expanded ? <ChevronDown size={14} color={EMBRY.dim} /> : <ChevronRight size={14} color={EMBRY.dim} />}
      </button>

      {expanded && (
        <div style={{ ...card, borderTop: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0, padding: 0 }}>
          <div style={{ padding: '16px 16px 0' }}>
            <div style={{ ...label, marginBottom: 10 }}>STRATEGIES TRIED</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
                {['RND', 'STRATEGY', 'BACKBONE', 'F1', 'ACC', 'DIAGNOSIS'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analysis.rounds.map(r => (
                <tr key={`${r.round}-${r.backbone}`} style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
                  <td style={tdStyle}>{r.round}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{r.strategy || '—'}</td>
                  <td style={tdStyle}>{r.backbone || '—'}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: r.f1 >= 0.90 ? EMBRY.green : r.f1 > 0 ? EMBRY.red : EMBRY.muted }}>
                    {r.f1 > 0 ? r.f1.toFixed(3) : '—'}
                  </td>
                  <td style={tdStyle}>{r.accuracy > 0 ? r.accuracy.toFixed(3) : '—'}</td>
                  <td style={{ ...tdStyle, fontSize: 9, color: EMBRY.dim, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.diagnosis || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {analysis.dogpileInsights.length > 0 && (
            <div style={{ padding: 16, borderTop: `1px solid ${EMBRY.border}` }}>
              <div style={{ ...label, marginBottom: 8 }}>DOGPILE RESEARCH ({analysis.dogpileInsights.length} queries)</div>
              {analysis.dogpileInsights.map((d, i) => (
                <div key={i} style={{ fontSize: 10, color: EMBRY.dim, marginBottom: 4, fontFamily: MONO }}>
                  <span style={{ color: EMBRY.amber }}>R{d.round}</span> [{d.phase}] {d.query}
                </div>
              ))}
            </div>
          )}

          {analysis.lastDiagnosis && (
            <div style={{ padding: 16, borderTop: `1px solid ${EMBRY.border}`, background: 'rgba(255,170,0,0.03)' }}>
              <div style={{ ...label, color: EMBRY.amber, marginBottom: 6 }}>LAST DIAGNOSIS</div>
              <div style={{ fontSize: 11, color: EMBRY.white, fontFamily: MONO, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {analysis.lastDiagnosis}
              </div>
            </div>
          )}

          {analysis.nextSteps && (
            <div style={{ padding: 16, borderTop: `1px solid ${EMBRY.border}`, background: 'rgba(124,58,237,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Cpu size={14} color={EMBRY.accent} />
                <span style={{ ...label, color: EMBRY.accent }}>NEXT-STEP HYPOTHESES</span>
                <span style={{ fontSize: 8, color: EMBRY.dim, marginLeft: 'auto' }}>
                  via /dogpile | gap: {analysis.nextSteps.gap.toFixed(3)}
                  {analysis.nextSteps.plateau_detected && ' | PLATEAU DETECTED'}
                </span>
              </div>
              <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 10, fontFamily: MONO }}>
                {analysis.nextSteps.strategies_exhausted.length} strategies exhausted: {analysis.nextSteps.strategies_exhausted.join(' → ')}
              </div>
              {analysis.nextSteps.dogpile_hypotheses ? (
                <div
                  className="next-steps-full clf-markdown"
                  style={{ fontSize: 12, color: EMBRY.white, lineHeight: 1.7 }}
                  dangerouslySetInnerHTML={{ __html: marked.parse(analysis.nextSteps.dogpile_hypotheses) as string }}
                />
              ) : (
                <div style={{ fontSize: 11, color: EMBRY.dim, fontStyle: 'italic' }}>
                  /dogpile research pending — hypotheses will appear after pipeline completes
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
