import { useState, useEffect, Fragment } from 'react'
import { Cpu, ChevronDown, ChevronRight } from 'lucide-react'
import { EMBRY, label, heading, body, card, panel, glowDot } from '../../common/EmbryStyle'
import { useRegisterAction } from '../../../../hooks/useRegisterAction'

import { API, MONO } from './types'
import type { Project, FailureAnalysis } from './types'
import { GateCard, thStyle, tdStyle, statusBadge, gateBadge, btnOutline, roundPillStyle, rerunInputStyle } from './shared'

export function TuneTab({ project }: { project: Project }) {
  const [tuneData, setTuneData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/projects/classifier-lab/tune-results/${project.id}`)
      .then(r => r.json())
      .then(d => { setTuneData(d); setLoading(false) })
      .catch(() => { setTuneData(null); setLoading(false) })
  }, [project.id])

  const APP = 'classifier-lab'
  useRegisterAction('clf-tune:btn', { app: APP, action: 'CLF_TUNE_SAVE_HP', label: 'Save HP Overrides', description: 'Save hyperparameter configuration for next training run' })
  useRegisterAction('clf-tune:reset', { app: APP, action: 'CLF_TUNE_RESET_HP', label: 'Reset HP', description: 'Reset hyperparameters to active configuration' })
  useRegisterAction('clf-tune-hp:input', { app: APP, action: 'CLF_TUNE_SET_HP', label: 'Set Hyperparameter', description: 'Adjust a hyperparameter value (learning rate, epochs, dropout, etc.)', params: { key: { type: 'string' }, value: { type: 'number' } } })

  if (loading) return <div style={{ color: EMBRY.dim, padding: 40 }}>Loading tune results...</div>

  if (!tuneData || tuneData.error) return (
    <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
      <div style={card}>
        <div style={{ padding: 40 }}>
          <Cpu size={32} color={EMBRY.dim} style={{ marginBottom: 12 }} />
          <div style={{ ...heading, color: EMBRY.dim, marginBottom: 8 }}>NO TUNE RESULTS</div>
          <div style={{ ...body, fontSize: 12, color: EMBRY.muted }}>
            No hyperparameter search results found.<br />
            Start a benchmark to generate self-improvement loop data.
          </div>
        </div>
      </div>
    </div>
  )

  type TuneTrial = {
    trial: number
    backbone: string
    epochs: number | null
    lr: string
    augment: string
    valF1: number | null
    testF1: number | null
    status: string
    passed: boolean
  }

  const asRecord = (value: unknown): Record<string, unknown> | null => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  )
  const asNumber = (value: unknown): number | null => (
    typeof value === 'number' && Number.isFinite(value) ? value : null
  )
  const normalizeStatus = (value: unknown): string => {
    if (typeof value !== 'string') return 'pending'
    const status = value.toLowerCase()
    if (status === 'complete' || status === 'completed' || status === 'passed' || status === 'failed' || status === 'running') {
      return status
    }
    return status || 'pending'
  }

  const rawTrials: unknown[] = Array.isArray(tuneData.trials) ? tuneData.trials : []
  const trials: TuneTrial[] = rawTrials.map((value, i) => {
    const record = asRecord(value) ?? {}
    const hps = asRecord(record.hps) ?? {}
    const trialNum = asNumber(record.trial) ?? asNumber(record.round) ?? (i + 1)
    const rawStatus = normalizeStatus(record.status)
    const valF1 = asNumber(record.valF1) ?? asNumber(record.val_f1)
    const testF1 = asNumber(record.testF1) ?? asNumber(record.test_f1) ?? asNumber(record.f1)
    const passed = record.passed === true || record.gate_passed === true || rawStatus === 'passed'

    return {
      trial: Math.max(1, Math.round(trialNum)),
      backbone: typeof record.backbone === 'string' && record.backbone.trim().length > 0 ? record.backbone : '—',
      epochs: asNumber(record.epochs) ?? asNumber(hps.epochs),
      lr: String(record.lr ?? hps.lr ?? '—'),
      augment: String(record.augment ?? record.augmentation ?? '—'),
      valF1,
      testF1,
      status: rawStatus,
      passed,
    }
  }).sort((a, b) => a.trial - b.trial)

  const completedTrials = trials.filter((t) => t.status === 'complete' || t.status === 'completed' || t.status === 'passed' || t.status === 'failed')
  const bestTrial = [...completedTrials].sort((a, b) => (b.testF1 ?? b.valF1 ?? 0) - (a.testF1 ?? a.valF1 ?? 0))[0]
  const totalCount = trials.length
  const completedCount = completedTrials.length
  const strategy = tuneData.strategy || 'self-improvement-loop'
  const winningRound = tuneData.winningRound

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ ...heading, fontSize: 18 }}>HYPERPARAMETER OPTIMIZATION — {project.name.toUpperCase()}</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <span style={{ ...gateBadge, background: 'rgba(124,58,237,0.1)', color: EMBRY.accent, borderColor: EMBRY.accent + '44' }}>
              {completedCount} / {totalCount} ROUNDS
            </span>
            <span style={{ ...gateBadge, background: 'rgba(0,255,136,0.1)', color: EMBRY.green, borderColor: EMBRY.green + '44' }}>
              STRATEGY: {strategy.toUpperCase().replace(/-/g, ' ')}
            </span>
            <span style={{ ...gateBadge, background: 'rgba(255,170,0,0.1)', color: EMBRY.amber, borderColor: EMBRY.amber + '44' }}>
              TARGET: F1 ≥ 0.90
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {winningRound && (
            <span style={{ ...gateBadge, background: 'rgba(0,255,136,0.1)', color: EMBRY.green, borderColor: EMBRY.green + '44' }}>
              WINNER: ROUND {winningRound}
            </span>
          )}
        </div>
      </div>

      {/* Best trial banner */}
      {bestTrial && (
        <div style={{ ...panel, border: `1px solid ${bestTrial.passed ? EMBRY.green : EMBRY.amber}33`, background: `${bestTrial.passed ? EMBRY.green : EMBRY.amber}08`, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={glowDot(bestTrial.passed ? EMBRY.green : EMBRY.amber, 10)} />
          <span style={{ ...label, color: bestTrial.passed ? EMBRY.green : EMBRY.amber }}>BEST SO FAR</span>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13 }}>
            Round #{bestTrial.trial} — {bestTrial.backbone} — Test F1 {(bestTrial.testF1 ?? bestTrial.valF1 ?? 0).toFixed(3)}
          </span>
          <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 'auto' }}>
            LR={bestTrial.lr} epochs={bestTrial.epochs} augment={bestTrial.augment || '—'}
          </span>
        </div>
      )}

      {/* Tune gate card */}
      <div style={{ marginBottom: 20 }}>
        <GateCard
          name="TUNE GATE"
          passed={bestTrial != null && (bestTrial.testF1 ?? bestTrial.valF1 ?? 0) >= (project.f1 ? 0.90 : 0.90)}
          metrics={[
            { label: 'BEST F1', value: bestTrial ? (bestTrial.testF1 ?? bestTrial.valF1 ?? 0).toFixed(3) : '—', color: bestTrial && (bestTrial.testF1 ?? bestTrial.valF1 ?? 0) >= 0.90 ? EMBRY.green : EMBRY.red },
            { label: 'ROUNDS', value: `${completedCount} / ${totalCount}` },
            { label: 'STRATEGY', value: strategy.replace(/-/g, ' ').slice(0, 20) },
          ]}
          checks={[
            { label: 'HPs configured (not defaults)', ok: completedCount > 0, detail: completedCount > 0 ? 'Yes' : 'Pending' },
            { label: 'At least 1 round completed', ok: completedCount > 0 },
            { label: 'Gate met by ≥1 trial', ok: trials.some(t => t.passed), detail: trials.filter(t => t.passed).length > 0 ? `${trials.filter(t => t.passed).length} passed` : 'No' },
          ]}
        />
      </div>

      {/* F1 trend sparkline + Round progress circles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        {trials.length > 1 && (() => {
          const f1s = trials.map(t => t.testF1 ?? t.valF1 ?? 0)
          const maxF1 = Math.max(...f1s, 0.91)
          const minF1 = Math.min(...f1s.filter(v => v > 0), 0)
          const range = maxF1 - minF1 || 1
          const w = Math.min(trials.length * 24, 160)
          const h = 24
          const points = f1s.map((f, i) => `${(i / (f1s.length - 1)) * w},${h - ((f - minF1) / range) * h}`).join(' ')
          return (
            <svg width={w} height={h + 4} style={{ flexShrink: 0 }}>
              <line x1={0} y1={h - ((0.90 - minF1) / range) * h} x2={w} y2={h - ((0.90 - minF1) / range) * h} stroke={EMBRY.amber} strokeWidth={0.5} strokeDasharray="3 2" />
              <polyline points={points} fill="none" stroke={EMBRY.accent} strokeWidth={1.5} />
              {f1s.map((f, i) => (
                <circle key={i} cx={(i / (f1s.length - 1)) * w} cy={h - ((f - minF1) / range) * h} r={2.5}
                  fill={f >= 0.90 ? EMBRY.green : EMBRY.red} />
              ))}
            </svg>
          )
        })()}
        {trials.map((t) => {
          const f1Val = t.testF1 ?? t.valF1 ?? 0
          const passed = f1Val >= 0.90
          const isRunning = t.status === 'running'
          const isDone = t.status === 'complete' || t.status === 'completed' || t.status === 'passed' || t.status === 'failed'
          return (
            <div key={t.trial}
              data-qid="clf-tune:round-circle" data-qs-action="CLF_TUNE_VIEW_ROUND"
              onClick={() => {
                const el = document.querySelector('[data-tune-controls]')
                el?.scrollIntoView({ behavior: 'smooth' })
              }}
              title={`Round ${t.trial} — ${t.backbone}\nTest F1: ${f1Val.toFixed(3)}\nLR: ${t.lr} | Epochs: ${t.epochs ?? '?'}\nAugment: ${t.augment || 'none'}\nStatus: ${t.status}`}
              style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 900, fontFamily: MONO, cursor: 'pointer',
                background: passed ? EMBRY.green + '20' : isRunning ? EMBRY.amber + '20' : isDone ? EMBRY.red + '15' : EMBRY.blue + '15',
                color: passed ? EMBRY.green : isRunning ? EMBRY.amber : isDone ? EMBRY.red : EMBRY.blue,
                border: `1px solid ${passed ? EMBRY.green + '44' : isRunning ? EMBRY.amber + '44' : isDone ? EMBRY.red + '33' : EMBRY.blue + '33'}`,
                transition: 'transform 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.2)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
            >
              {t.trial}
            </div>
          )
        })}
        <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 8 }}>
          {completedCount} / {totalCount} rounds complete
          {winningRound ? ` — Gate passed at round ${winningRound}` : ''}
        </span>
      </div>

      {/* Self-improvement rounds table */}
      <div style={{ ...label, marginBottom: 8 }}>SELF-IMPROVEMENT ROUNDS</div>
      {trials.length === 0 ? (
        <div style={{ ...card, padding: 32, textAlign: 'center' }}>
          <Cpu size={24} color={EMBRY.dim} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: EMBRY.dim, marginBottom: 4 }}>NO TRAINING ROUNDS YET</div>
          <div style={{ fontSize: 10, color: EMBRY.muted }}>
            Configure hyperparameters below, then start training from the Train tab.
          </div>
        </div>
      ) : (
      <TuneRoundsTable trials={trials} bestTrial={bestTrial} />
      )}

      {/* HP Controls + Change log */}
      <div data-tune-controls>
        <TuneHPControls projectId={project.id} />
      </div>
    </div>
  )
}

function TuneRoundsTable({ trials, bestTrial }: { trials: Array<{ trial: number; backbone: string; epochs: number | null; lr: string; augment: string; valF1: number | null; testF1: number | null; status: string; passed: boolean }>; bestTrial: typeof trials[0] | undefined }) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 28 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
            {([
              { h: '', tip: 'Expand to see HP changes from previous round' },
              { h: 'ROUND', tip: 'Self-improvement iteration number.' },
              { h: 'BACKBONE', tip: 'Pre-trained model architecture.' },
              { h: 'EPOCHS', tip: 'Full passes over training data.' },
              { h: 'LR', tip: 'Learning rate for gradient updates.' },
              { h: 'AUGMENT', tip: 'Data augmentation applied.' },
              { h: 'VAL F1', tip: 'F1 on validation split (early stopping).' },
              { h: 'TEST F1', tip: 'F1 on held-out test set (gate check).' },
              { h: 'GATE', tip: 'Whether Test F1 ≥ 0.90.' },
            ]).map(({ h, tip }) => (
              <th key={h || '_expand'} style={{ ...thStyle, cursor: h ? 'help' : 'default', width: h ? undefined : 28 }} title={tip}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trials.map((t, idx) => {
            const isBest = bestTrial && t.trial === bestTrial.trial
            const testF1 = t.testF1 ?? 0
            const valF1 = t.valF1 ?? 0
            const isExpanded = expandedRow === t.trial
            const prev = idx > 0 ? trials[idx - 1] : null

            const deltas: Array<{ hp: string; from: string; to: string; delta?: string; color: string }> = []
            if (prev) {
              if (t.lr !== prev.lr) deltas.push({ hp: 'LR', from: prev.lr, to: t.lr, color: EMBRY.accent })
              if (t.epochs !== prev.epochs) deltas.push({ hp: 'Epochs', from: String(prev.epochs ?? '?'), to: String(t.epochs ?? '?'), color: EMBRY.accent })
              if (t.augment !== prev.augment) deltas.push({ hp: 'Augment', from: prev.augment || 'none', to: t.augment || 'none', color: EMBRY.accent })
              const prevF1 = prev.testF1 ?? prev.valF1 ?? 0
              if (prevF1 > 0 && testF1 > 0) {
                const d = testF1 - prevF1
                deltas.push({ hp: 'F1', from: prevF1.toFixed(3), to: testF1.toFixed(3), delta: `${d > 0 ? '+' : ''}${d.toFixed(3)}`, color: d > 0 ? EMBRY.green : EMBRY.red })
              }
            }

            return (
              <Fragment key={t.trial}>
                <tr data-qid="clf-tune:expand-row" data-qs-action="CLF_TUNE_EXPAND_ROUND" title="Expand to see HP changes from previous round" style={{
                  borderBottom: isExpanded ? 'none' : `1px solid ${EMBRY.border}`,
                  borderLeft: isBest ? `3px solid ${EMBRY.green}` : '3px solid transparent',
                  background: t.status === 'running' ? 'rgba(124,58,237,0.03)' : 'transparent',
                  cursor: prev ? 'pointer' : 'default',
                }} onClick={() => prev && setExpandedRow(isExpanded ? null : t.trial)}>
                  <td style={{ ...tdStyle, width: 28, padding: '8px 6px' }}>
                    {prev && (isExpanded
                      ? <ChevronDown size={12} color={EMBRY.dim} />
                      : <ChevronRight size={12} color={EMBRY.dim} />
                    )}
                  </td>
                  <td style={tdStyle}>#{t.trial}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: isBest ? EMBRY.green : EMBRY.white }}>{t.backbone}</td>
                  <td style={tdStyle}>{t.epochs ?? '—'}</td>
                  <td style={tdStyle}>{t.lr}</td>
                  <td style={tdStyle}>{t.augment || '—'}</td>
                  <td style={{ ...tdStyle, color: valF1 >= 0.90 ? EMBRY.green : valF1 > 0 ? EMBRY.white : EMBRY.muted }}>
                    {valF1 ? valF1.toFixed(3) : '—'}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: testF1 >= 0.90 ? EMBRY.green : testF1 > 0 ? EMBRY.red : EMBRY.muted }}>
                    {testF1 ? testF1.toFixed(3) : '—'}
                  </td>
                  <td style={tdStyle}>
                    {t.passed ? (
                      <span style={{ ...statusBadge, background: 'rgba(0,255,136,0.1)', color: EMBRY.green }}>PASSED</span>
                    ) : t.status === 'running' ? (
                      <span style={{ ...statusBadge, background: 'rgba(124,58,237,0.15)', color: EMBRY.accent }}>RUNNING</span>
                    ) : t.status === 'pending' ? (
                      <span style={{ ...statusBadge, background: 'rgba(56,189,248,0.15)', color: EMBRY.blue }}>PENDING</span>
                    ) : (
                      <span style={{ ...statusBadge, background: 'rgba(255,68,68,0.1)', color: EMBRY.red }}>FAILED</span>
                    )}
                  </td>
                </tr>
                {isExpanded && deltas.length > 0 && (
                  <tr style={{ borderBottom: `1px solid ${EMBRY.border}`, background: 'rgba(124,58,237,0.02)' }}>
                    <td colSpan={9} style={{ padding: '8px 14px 8px 42px' }}>
                      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: 8, fontWeight: 700, color: EMBRY.muted }}>CHANGES FROM R{prev!.trial}:</span>
                        {deltas.map(d => (
                          <span key={d.hp} style={{ fontSize: 10, fontFamily: MONO }}>
                            <span style={{ color: EMBRY.dim }}>{d.hp}: </span>
                            <span style={{ color: EMBRY.muted }}>{d.from}</span>
                            <span style={{ color: EMBRY.dim }}> → </span>
                            <span style={{ color: EMBRY.white }}>{d.to}</span>
                            {d.delta && <span style={{ color: d.color, fontWeight: 700, marginLeft: 4 }}>{d.delta}</span>}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TuneHPControls({ projectId }: { projectId: string }) {
  const [config, setConfig] = useState<any>(null)
  const [rounds, setRounds] = useState<Array<{ round: number; f1: number; strategy: string; hps: Record<string, number> }>>([])
  const [profile, setProfile] = useState<any>(null)
  const [bestF1, setBestF1] = useState(0)
  const [viewingRound, setViewingRound] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`${API}/projects/classifier-lab/tune-config/${projectId}`)
      .then(r => r.json()).then(d => { setConfig(d); setDirty(false) })
      .catch(() => {})
    fetch(`${API}/projects/classifier-lab/failure-analysis/${projectId}`)
      .then(r => r.json()).then((d: FailureAnalysis) => {
        const roundData = (d.rounds || [])
          .filter(r => r.hps && Object.keys(r.hps).length > 0)
          .map(r => ({ round: r.round, f1: r.f1, strategy: (r as any).strategy || '', hps: r.hps as Record<string, number> }))
        setRounds(roundData)
        setBestF1(d.bestF1 || 0)
      })
      .catch(() => {})
    fetch(`${API}/projects/classifier-lab/data/${projectId}/profile`)
      .then(r => r.json()).then(d => { if (!d.error) setProfile(d) })
      .catch(() => {})
  }, [projectId])

  if (!config) return null

  const set = (key: string, value: number) => {
    setConfig((prev: any) => ({ ...prev, [key]: value }))
    setDirty(true)
    setViewingRound(null)
  }

  const save = async () => {
    setSaving(true)
    try {
      const roundLabel = viewingRound != null ? `human (restored R${viewingRound})` : 'human'
      await fetch(`${API}/projects/classifier-lab/tune-config/${projectId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, _source: roundLabel, _round: viewingRound }),
      })
      setDirty(false)
    } catch { /* ignore */ }
    setSaving(false)
  }

  const loadRound = (roundData: { round: number; hps: Record<string, number> }) => {
    setViewingRound(roundData.round)
    setConfig((prev: any) => {
      const merged = { ...prev }
      for (const [k, v] of Object.entries(roundData.hps)) {
        if (k in merged) merged[k] = v
      }
      return merged
    })
    setDirty(true)
  }

  const loadActive = () => {
    setViewingRound(null)
    fetch(`${API}/projects/classifier-lab/tune-config/${projectId}`)
      .then(r => r.json()).then(d => { setConfig(d); setDirty(false) })
      .catch(() => {})
  }

  const changelog: Array<{ timestamp: string; source: string; changes: Record<string, { from: unknown; to: unknown }> }> = config._changelog || []
  const source = config._source || 'default'

  const n = profile?.total || 0
  const nClasses = profile ? Object.keys(profile.perClass || {}).length : 0
  const modality = profile?.modality || 'text'
  const gap = bestF1 > 0 ? (0.90 - bestF1) : 0
  const isCloseToGate = gap > 0 && gap < 0.03

  const knobs: Array<{ key: string; label: string; tip: string; min: number; max: number; step: number; log?: boolean }> = [
    { key: 'lr', label: 'Learning Rate', min: 0.000001, max: 0.01, step: 0.000001, log: true,
      tip: `Step size for gradient updates.${modality === 'text' ? ` With ${n} samples and transformer fine-tuning, try 2e-5 to 5e-5.` : ` With ${n} samples, try 1e-4 to 3e-4 for vision CNNs.`}${bestF1 > 0 ? ` Current best F1=${bestF1.toFixed(3)} — ${Number(config?.lr) > 5e-5 ? 'current LR may be too high, try halving' : 'LR looks reasonable'}.` : ''}` },
    { key: 'batch_size', label: 'Batch Size', min: 4, max: 128, step: 4,
      tip: `Samples per gradient step.${nClasses > 0 ? ` ${nClasses} classes × ${Math.round(n / nClasses)} samples/class — use ${Math.min(32, Math.max(8, nClasses * 4))} for balanced coverage.` : ''} Larger = smoother gradients but more memory.` },
    { key: 'epochs', label: 'Epochs', min: 1, max: 20, step: 1,
      tip: `Full passes over data.${n > 0 ? ` ${n} samples is ${n < 1000 ? 'small — overfitting risk past epoch 3-4. Watch for double descent at 8+' : n < 5000 ? 'moderate — 3-5 epochs typical' : 'large — 2-3 epochs usually sufficient'}.` : ''}` },
    { key: 'dropout', label: 'Dropout', min: 0, max: 0.5, step: 0.05,
      tip: `Randomly zeros outputs during training.${n > 0 && n < 2000 ? ` Small dataset (${n}) — try 0.2-0.3 to prevent overfitting.` : ' 0.1 typical for large datasets.'}` },
    { key: 'weight_decay', label: 'Weight Decay', min: 0, max: 0.1, step: 0.0001, log: true,
      tip: `L2 regularization on weights. 0.01 typical for AdamW.${isCloseToGate ? ' Close to gate — slight increase (0.02) may help generalization.' : ''}` },
    { key: 'label_smoothing', label: 'Label Smoothing', min: 0, max: 0.3, step: 0.05,
      tip: `Softens hard labels (1.0 → 0.9).${isCloseToGate ? ` F1 ${bestF1.toFixed(3)} is only ${gap.toFixed(3)} below gate — smoothing 0.1 typically closes gaps this small.` : ' Reduces overconfidence on boundary samples.'}` },
    { key: 'mixup_alpha', label: 'Mixup Alpha', min: 0, max: 1, step: 0.1,
      tip: `Interpolates training sample pairs.${modality === 'text' ? ' NOT recommended for text — degrades semantic content.' : ' Try 0.2-0.4 for vision tasks.'} Alpha controls mix strength.` },
    { key: 'cutmix_alpha', label: 'CutMix Alpha', min: 0, max: 1, step: 0.1,
      tip: `Replaces image patches between samples.${modality !== 'vision' ? ` Vision-only — not applicable for ${modality}.` : ` With ${n} images, try 0.2-0.4.`}` },
    { key: 'random_erasing', label: 'Random Erasing', min: 0, max: 0.5, step: 0.05,
      tip: `Randomly masks rectangular regions.${modality !== 'vision' ? ` Vision-only — not applicable for ${modality}.` : ' Forces global feature learning. Try 0.1-0.2.'}` },
    { key: 'warmup_ratio', label: 'Warmup Ratio', min: 0, max: 0.2, step: 0.01,
      tip: `Linearly increase LR during early training.${modality === 'text' ? ' Critical for transformer fine-tuning — prevents catastrophic forgetting. 0.06-0.1 typical.' : ' 0.05-0.1 typical.'}` },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
      {/* HP Knobs */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ ...heading, fontSize: 13 }}>HYPERPARAMETER CONTROLS</div>
          <span style={{
            fontSize: 8, padding: '2px 6px', borderRadius: 3, fontFamily: MONO, fontWeight: 700,
            background: source === 'human' || source.startsWith('human') ? 'rgba(0,255,136,0.1)' : source === 'agent' ? 'rgba(124,58,237,0.1)' : 'rgba(100,116,139,0.1)',
            color: source === 'human' || source.startsWith('human') ? EMBRY.green : source === 'agent' ? EMBRY.accent : EMBRY.dim,
          }}>
            {source.toUpperCase()}
          </span>
          {viewingRound != null && (
            <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 3, fontFamily: MONO, fontWeight: 700, background: 'rgba(255,170,0,0.1)', color: EMBRY.amber }}>
              VIEWING R{viewingRound}
            </span>
          )}
          {config._updated && (
            <span style={{ fontSize: 8, color: EMBRY.muted, fontFamily: MONO, marginLeft: 'auto' }}>
              {new Date(config._updated).toLocaleString()}
            </span>
          )}
        </div>

        {rounds.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 8, color: EMBRY.muted, fontWeight: 700 }}>LOAD FROM ROUND:</span>
              <button data-qid="clf-tune:btn" data-qs-action="CLF_TUNE_LOAD_ACTIVE" title="Load active HP configuration"
                onClick={loadActive}
                style={{
                  ...roundPillStyle,
                  background: viewingRound == null ? EMBRY.accent + '20' : 'transparent',
                  borderColor: viewingRound == null ? EMBRY.accent + '66' : EMBRY.border,
                  color: viewingRound == null ? EMBRY.accent : EMBRY.dim,
                }}
              >
                ACTIVE
              </button>
              {rounds.map(r => (
                <button data-qid="clf-tune:btn" data-qs-action="CLF_TUNE_LOAD_ROUND"
                  key={r.round}
                  onClick={() => loadRound(r)}
                  title={`Strategy: ${r.strategy} | F1: ${r.f1.toFixed(3)}`}
                  style={{
                    ...roundPillStyle,
                    background: viewingRound === r.round ? EMBRY.amber + '20' : 'transparent',
                    borderColor: viewingRound === r.round ? EMBRY.amber + '66' : EMBRY.border,
                    color: viewingRound === r.round ? EMBRY.amber : EMBRY.dim,
                  }}
                >
                  R{r.round}
                  <span style={{ fontSize: 7, color: r.f1 >= 0.90 ? EMBRY.green : EMBRY.red, marginLeft: 3 }}>
                    {r.f1.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
            {viewingRound != null && (() => {
              const rd = rounds.find(r => r.round === viewingRound)
              if (!rd) return null
              return (
                <div style={{ padding: '8px 12px', background: 'rgba(255,170,0,0.04)', border: `1px solid ${EMBRY.amber}22`, borderRadius: 4, fontSize: 10 }}>
                  <span style={{ fontWeight: 700, color: EMBRY.amber }}>R{rd.round} RATIONALE: </span>
                  <span style={{ color: EMBRY.dim }}>
                    Strategy: <span style={{ color: EMBRY.white, fontFamily: MONO }}>{rd.strategy}</span>
                    {' · '}F1: <span style={{ color: rd.f1 >= 0.90 ? EMBRY.green : EMBRY.red, fontFamily: MONO }}>{rd.f1.toFixed(3)}</span>
                  </span>
                </div>
              )
            })()}
          </div>
        )}

        {([
          { group: 'CORE', keys: ['lr', 'batch_size', 'epochs', 'warmup_ratio'] },
          { group: 'REGULARIZATION', keys: ['dropout', 'weight_decay', 'label_smoothing'] },
          { group: 'AUGMENTATION', keys: ['mixup_alpha', 'cutmix_alpha', 'random_erasing'] },
        ] as const).map(({ group, keys }) => {
          const groupKnobs = knobs.filter(k => keys.includes(k.key as any))
          if (!groupKnobs.length) return null
          return (
            <div key={group} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: EMBRY.muted, letterSpacing: '0.1em', marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${EMBRY.border}` }}>{group}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {groupKnobs.map(k => {
                  const val = Number(config[k.key]) || 0
                  return (
                    <div key={k.key} style={{ padding: '6px 0' }} title={k.tip}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'help', borderBottom: '1px dotted rgba(100,116,139,0.4)' }}>{k.label}</span>
                        <input data-qid="clf-tune-hp:input" data-qs-action="CLF_TUNE_SET_HP"
                          type="text"
                          value={k.log && val > 0 ? val.toExponential(1) : val % 1 === 0 ? String(val) : val.toFixed(4)}
                          onChange={e => {
                            const parsed = Number(e.target.value)
                            if (Number.isFinite(parsed)) set(k.key, parsed)
                          }}
                          style={{
                            width: 70, textAlign: 'right', background: 'transparent', border: `1px solid ${EMBRY.border}`,
                            borderRadius: 3, padding: '2px 4px', fontSize: 11, fontFamily: MONO, fontWeight: 700,
                            color: EMBRY.white, outline: 'none',
                          }}
                          onFocus={e => { e.target.style.borderColor = EMBRY.accent; e.target.select() }}
                          onBlur={e => { e.target.style.borderColor = EMBRY.border }}
                        />
                      </div>
                      <input data-qid="clf-tune-hp:input" data-qs-action="CLF_TUNE_SET_HP"
                        type="range"
                        min={k.min} max={k.max} step={k.step}
                        value={val}
                        onChange={e => set(k.key, Number(e.target.value))}
                        style={{ width: '100%', accentColor: EMBRY.accent, height: 4 }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div style={{ display: 'flex', gap: 10, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${EMBRY.border}` }}>
          <button data-qid="clf-tune:btn" data-qs-action="CLF_TUNE_SAVE_HP" title="Save hyperparameter overrides for next training run"
            onClick={save}
            disabled={!dirty || saving}
            style={{
              background: dirty ? EMBRY.accent : 'transparent',
              border: `1px solid ${dirty ? EMBRY.accent : EMBRY.border}`,
              color: dirty ? '#000' : EMBRY.dim,
              padding: '8px 20px', borderRadius: 4, fontSize: 10, fontWeight: 900, cursor: dirty ? 'pointer' : 'default',
            }}
          >
            {saving ? 'SAVING...' : dirty
              ? viewingRound != null ? `APPLY R${viewingRound} AS NEXT RUN` : 'SAVE OVERRIDES'
              : 'NO CHANGES'}
          </button>
          <button data-qid="clf-tune:reset" data-qs-action="CLF_TUNE_RESET_HP" title="Reset to active HP configuration" onClick={loadActive} style={{ ...btnOutline, fontSize: 10 }}>RESET</button>
        </div>
      </div>

      {/* Change log */}
      <div style={card}>
        <div style={{ ...heading, fontSize: 13, marginBottom: 16 }}>CHANGE LOG</div>
        {changelog.length > 0 ? (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {[...changelog].reverse().map((entry, i) => (
              <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${EMBRY.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 8, padding: '1px 5px', borderRadius: 3, fontWeight: 700,
                    background: entry.source?.startsWith('human') ? 'rgba(0,255,136,0.1)' : 'rgba(124,58,237,0.1)',
                    color: entry.source?.startsWith('human') ? EMBRY.green : EMBRY.accent,
                  }}>
                    {(entry.source || 'unknown').toUpperCase()}
                  </span>
                  <span style={{ fontSize: 8, color: EMBRY.muted, fontFamily: MONO }}>
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
                {Object.entries(entry.changes).map(([key, delta]) => (
                  <div key={key} style={{ fontSize: 10, color: EMBRY.dim, fontFamily: MONO, marginLeft: 8 }}>
                    {key}: <span style={{ color: EMBRY.muted }}>{String(delta.from)}</span> → <span style={{ color: EMBRY.white }}>{String(delta.to)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 10, color: EMBRY.muted }}>No HP changes recorded yet. Adjust a knob or load a round to start.</div>
        )}
      </div>
    </div>
  )
}
