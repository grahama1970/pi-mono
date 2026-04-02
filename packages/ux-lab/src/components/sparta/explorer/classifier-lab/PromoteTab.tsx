import { useState, useEffect } from 'react'
import { ShieldCheck, AlertTriangle, Rocket, ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { marked } from 'marked'
import { EMBRY, label, heading, body, card, panel } from '../../common/EmbryStyle'
import { RunButton } from '../../common/RunButton'
import { useRegisterAction } from '../../../../hooks/useRegisterAction'

import { API, MONO } from './types'
import type { Project } from './types'
import { StatPanel, GateCard, MD_CSS, statusBadge, gateBadge, btnOutline, filterSelect } from './shared'

export function PromoteTab({ project }: { project: Project }) {
  const [evalData, setEvalData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [promoting, setPromoting] = useState(false)
  const [promoteStatus, setPromoteStatus] = useState<{ kind: 'idle' | 'success' | 'warn' | 'error'; text: string }>({ kind: 'idle', text: '' })
  const [modelCardMd, setModelCardMd] = useState('')
  const [exportFormat, setExportFormat] = useState('safetensors')
  const [pushToHf, setPushToHf] = useState(false)
  const [showModelCard, setShowModelCard] = useState(false)
  const [editingCard, setEditingCard] = useState(false)
  const [cardDraft, setCardDraft] = useState('')

  const APP = 'classifier-lab'
  useRegisterAction('clf-promote:export-format', { app: APP, action: 'CLF_PROMOTE_SET_FORMAT', label: 'Set Export Format', description: 'Set model export format: SafeTensors, ONNX, GGUF, or TorchScript', params: { format: { type: 'string' } } })
  useRegisterAction('clf-promote:hf-push-checkbox', { app: APP, action: 'CLF_PROMOTE_TOGGLE_HF', label: 'Toggle HuggingFace Push', description: 'Toggle pushing model to HuggingFace Hub' })
  useRegisterAction('clf-promote:btn', { app: APP, action: 'CLF_PROMOTE_ACTION', label: 'Promote Action', description: 'Perform a promotion workflow step' })
  useRegisterAction('clf-promote:promote', { app: APP, action: 'CLF_PROMOTE_TO_PRODUCTION', label: 'Promote to Production', description: 'Deploy the winning model to production' })
  useRegisterAction('clf-promote:model-card-editor', { app: APP, action: 'CLF_PROMOTE_EDIT_CARD', label: 'Edit Model Card', description: 'Edit the auto-generated model card markdown' })

  useEffect(() => {
    setLoading(true)
    setPromoteStatus({ kind: 'idle', text: '' })
    Promise.all([
      fetch(`${API}/projects/classifier-lab/eval-results/${project.id}`).then(r => r.json()),
      fetch(`${API}/projects/classifier-lab/model-card/${project.id}`).then(r => r.json()).catch(() => ({ markdown: '' })),
    ]).then(([evalD, cardD]) => {
      setEvalData(evalD)
      setModelCardMd(cardD.markdown || '')
      setLoading(false)
    }).catch(() => { setEvalData(null); setLoading(false) })
  }, [project.id])

  if (loading) return <div style={{ color: EMBRY.dim, padding: 40 }}>Loading promotion data...</div>

  if (!evalData || evalData.error) return (
    <div style={{ ...card, maxWidth: 600, margin: '60px auto', textAlign: 'center', padding: 40 }}>
      <Rocket size={32} color={EMBRY.dim} style={{ marginBottom: 12 }} />
      <div style={{ ...heading, color: EMBRY.dim, marginBottom: 8 }}>NO CANDIDATE READY</div>
      <div style={{ ...body, fontSize: 12, color: EMBRY.dim }}>
        Run evaluation first to identify a winner for promotion.<br />
        The Evaluate tab must complete with holdout results before promoting.
      </div>
    </div>
  )

  const toFiniteNumber = (value: unknown): number => (
    typeof value === 'number' && Number.isFinite(value) ? value : 0
  )
  const formatStatus = (value: unknown, emptyLabel: string): string => {
    if (typeof value === 'boolean') return value ? 'Complete' : 'Pending'
    if (typeof value === 'string' && value.trim().length > 0) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      if (typeof record.status === 'string' && record.status.trim().length > 0) return record.status
      if (typeof record.state === 'string' && record.state.trim().length > 0) return record.state
      if (record.completed === true || record.ok === true || record.success === true) return 'Complete'
      if (record.completed === false || record.ok === false || record.success === false) return 'Pending'
    }
    return emptyLabel
  }
  const modelName = typeof evalData.model === 'string' && evalData.model.trim().length > 0
    ? evalData.model
    : (typeof evalData.winner === 'string' && evalData.winner.trim().length > 0 ? evalData.winner : 'unknown')
  const gateThreshold = toFiniteNumber(evalData.gate_threshold ?? evalData.holdout_gate_f1) || 0.90
  const macroF1 = toFiniteNumber(evalData.macro_f1 ?? evalData.f1)
  const accuracy = toFiniteNumber(evalData.accuracy)
  const holdoutPassed = typeof evalData.holdout_passed === 'boolean'
    ? evalData.holdout_passed
    : (evalData.gate_passed === true || macroF1 >= gateThreshold)
  const testSamples = toFiniteNumber(evalData.test_samples)
  const winningRound: number | undefined = evalData.winning_round
  const classes: string[] = evalData.classes || []
  const exportStatus = formatStatus(
    evalData.export_status ?? evalData.export ?? evalData.exported,
    'Not exported',
  )
  const deploymentStatus = formatStatus(
    evalData.deployment_status ?? evalData.deployment ?? evalData.deployed,
    'Not deployed',
  )
  const exportArtifacts: string[] = Array.isArray(evalData.export_artifacts)
    ? evalData.export_artifacts.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

  const promoteModel = async () => {
    if (!holdoutPassed || promoting) return
    setPromoting(true)
    setPromoteStatus({ kind: 'idle', text: '' })
    try {
      const response = await fetch(`${API}/projects/classifier-lab/promote/${project.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, macro_f1: macroF1, accuracy, format: exportFormat, pushToHf }),
      })
      let payload: Record<string, unknown> = {}
      try {
        payload = await response.json() as Record<string, unknown>
      } catch {
        payload = {}
      }

      if (response.ok) {
        setPromoteStatus({ kind: 'success', text: 'Promotion submitted.' })
      } else if (response.status === 404) {
        setPromoteStatus({
          kind: 'warn',
          text: 'Promote API not available. Manual step: export winner artifacts and deploy via your registry pipeline.',
        })
      } else {
        const detail = typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`
        setPromoteStatus({ kind: 'error', text: detail })
      }
    } catch {
      setPromoteStatus({
        kind: 'warn',
        text: 'Unable to reach promote API. Manual step: export winner artifacts and deploy via your registry pipeline.',
      })
    } finally {
      setPromoting(false)
    }
  }

  const gateColor = holdoutPassed ? EMBRY.green : EMBRY.red
  const gateIcon = holdoutPassed
    ? <ShieldCheck size={56} color={EMBRY.green} style={{ marginBottom: 20 }} />
    : <AlertTriangle size={56} color={EMBRY.red} style={{ marginBottom: 20 }} />

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <GateCard
          name="PROMOTE GATE"
          passed={holdoutPassed}
          metrics={[
            { label: 'HOLDOUT F1', value: macroF1.toFixed(3), color: holdoutPassed ? EMBRY.green : EMBRY.red },
            { label: 'MODEL', value: modelName.split('/').pop() || modelName },
            { label: 'EXPORT', value: exportStatus },
          ]}
          checks={[
            { label: 'Eval gate passed', ok: holdoutPassed, detail: holdoutPassed ? `F1 ${macroF1.toFixed(3)}` : 'Run Evaluate first' },
          ]}
          halt={!holdoutPassed ? {
            reason: `Model F1 (${macroF1.toFixed(3)}) did not pass the holdout gate (≥ ${gateThreshold.toFixed(2)}). Cannot promote.`,
            action: 'Go back to the Train tab to improve the model, or lower the gate threshold if this performance is acceptable for your use case.',
          } : null}
        />
      </div>

      <div style={{ ...card, padding: 48, textAlign: 'center' }}>
        {gateIcon}
        <div style={{ ...heading, fontSize: 28, marginBottom: 8 }}>
          {holdoutPassed ? 'Promote to Production' : 'Promotion Blocked'}
        </div>
        <div style={{ ...body, color: EMBRY.dim, marginBottom: 12 }}>
          {holdoutPassed
            ? <>Candidate <b style={{ color: EMBRY.white, fontFamily: MONO }}>{modelName}</b> passed holdout gate.</>
            : <>Candidate <b style={{ color: EMBRY.white, fontFamily: MONO }}>{modelName}</b> failed holdout gate.</>
          }
        </div>

        <div style={{ marginBottom: 36 }}>
          <span style={{
            ...gateBadge,
            color: gateColor,
            borderColor: gateColor + '66',
            background: gateColor + '0A',
          }}>
            HOLDOUT {holdoutPassed ? 'PASSED' : 'FAILED'} {'\u2014'} F1 {macroF1.toFixed(3)} {holdoutPassed ? '\u2265' : '<'} {gateThreshold.toFixed(2)}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: winningRound !== undefined ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
          <StatPanel title="F1 SCORE" value={macroF1.toFixed(3)} color={holdoutPassed ? EMBRY.green : EMBRY.red} />
          <StatPanel title="ACCURACY" value={accuracy.toFixed(3)} color={holdoutPassed ? EMBRY.green : EMBRY.white} />
          <StatPanel title="TEST SAMPLES" value={String(testSamples)} />
          {winningRound !== undefined && (
            <StatPanel title="WINNING ROUND" value={String(winningRound)} />
          )}
        </div>

        {classes.length > 0 && (
          <div style={{ ...panel, textAlign: 'left', marginBottom: 36 }}>
            <div style={label}>CLASSES ({classes.length})</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {classes.map(cls => (
                <span key={cls} style={{
                  ...statusBadge, fontFamily: MONO,
                  background: 'rgba(255,255,255,0.05)', color: EMBRY.white,
                  border: `1px solid ${EMBRY.border}`,
                }}>{cls}</span>
              ))}
            </div>
          </div>
        )}

        {holdoutPassed && (
          <div style={{ ...panel, textAlign: 'left', marginBottom: 24 }}>
            <div style={{ ...label, marginBottom: 12 }}>EXPORT SETTINGS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 4 }}>FORMAT</div>
                <select data-qid="clf-promote:export-format" data-qs-action="CLF_PROMOTE_SET_FORMAT" title="Select model export format"
                  value={exportFormat}
                  onChange={e => setExportFormat(e.target.value)}
                  style={filterSelect}
                >
                  <option value="safetensors">SafeTensors (.safetensors)</option>
                  <option value="onnx">ONNX (.onnx)</option>
                  <option value="gguf">GGUF (.gguf)</option>
                  <option value="torchscript">TorchScript (.pt)</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 4 }}>HUGGING FACE</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input data-qid="clf-promote:hf-push-checkbox" data-qs-action="CLF_PROMOTE_TOGGLE_HF" title="Toggle pushing model to HuggingFace Hub"
                    type="checkbox"
                    checked={pushToHf}
                    onChange={e => setPushToHf(e.target.checked)}
                    style={{ accentColor: EMBRY.accent }}
                  />
                  <span style={{ fontSize: 10, color: EMBRY.white }}>
                    Push to HuggingFace Hub
                  </span>
                </label>
                {pushToHf && (
                  <div style={{ fontSize: 8, color: EMBRY.muted, marginTop: 4, fontFamily: MONO }}>
                    Requires HF_TOKEN in environment
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {holdoutPassed && modelCardMd && (() => {
          const stripFrontmatter = (md: string) => {
            const match = md.match(/^---\n[\s\S]*?\n---\n/)
            return match ? md.slice(match[0].length) : md
          }
          const currentMd = editingCard ? cardDraft : modelCardMd
          return (
            <div style={{ ...panel, textAlign: 'left', marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showModelCard ? 12 : 0 }}>
                <button data-qid="clf-promote:btn" data-qs-action="CLF_PROMOTE_TOGGLE_CARD" title="Toggle model card preview"
                  onClick={() => setShowModelCard(!showModelCard)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}
                >
                  {showModelCard ? <ChevronDown size={12} color={EMBRY.dim} /> : <ChevronRight size={12} color={EMBRY.dim} />}
                  <span style={label}>MODEL CARD</span>
                  <span style={{ fontSize: 9, color: EMBRY.muted }}>— auto-generated, editable before push</span>
                </button>
                {showModelCard && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button data-qid="clf-promote:btn" data-qs-action="CLF_PROMOTE_EDIT_CARD" title="Toggle model card edit mode"
                      onClick={() => {
                        if (editingCard) {
                          setEditingCard(false)
                          setModelCardMd(cardDraft)
                        } else {
                          setCardDraft(modelCardMd)
                          setEditingCard(true)
                        }
                      }}
                      style={{ ...btnOutline, fontSize: 8, padding: '2px 8px', borderColor: editingCard ? EMBRY.accent + '66' : EMBRY.border, color: editingCard ? EMBRY.accent : EMBRY.dim }}
                    >{editingCard ? 'PREVIEW' : 'EDIT'}</button>
                    <button data-qid="clf-promote:btn" data-qs-action="CLF_PROMOTE_COPY_CARD" title="Copy model card to clipboard"
                      onClick={() => navigator.clipboard?.writeText(currentMd)}
                      style={{ ...btnOutline, fontSize: 8, padding: '2px 8px' }}
                    >COPY</button>
                  </div>
                )}
              </div>
              {showModelCard && (
                editingCard ? (
                  <textarea data-qid="clf-promote:model-card-editor" data-qs-action="CLF_PROMOTE_EDIT_CARD" title="Edit model card markdown"
                    value={cardDraft}
                    onChange={e => setCardDraft(e.target.value)}
                    style={{
                      width: '100%', minHeight: 400, maxHeight: 600, resize: 'vertical',
                      background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 4,
                      color: EMBRY.white, fontFamily: MONO, fontSize: 11, lineHeight: 1.6,
                      padding: 12, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                ) : (
                  <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12 }}>
                    <style>{MD_CSS}</style>
                    <div
                      className="clf-markdown"
                      style={{ fontSize: 11, lineHeight: 1.6, maxHeight: 500, overflow: 'auto' }}
                      dangerouslySetInnerHTML={{ __html: marked(stripFrontmatter(currentMd)) as string }}
                    />
                  </div>
                )
              )}
            </div>
          )
        })()}

        {holdoutPassed && (() => {
          const exportReady = exportStatus !== 'Not exported'
          const artifactsReady = exportArtifacts.length > 0
          const registryReady = deploymentStatus !== 'Not deployed' && deploymentStatus !== 'Pending'
          const deployed = deploymentStatus.toLowerCase().includes('complete') || deploymentStatus.toLowerCase().includes('deployed')
          const steps = [
            { id: 'eval', label: 'Holdout evaluation passed', detail: `F1 ${macroF1.toFixed(3)} ≥ ${gateThreshold.toFixed(2)}`, done: true },
            { id: 'export', label: 'Export model', detail: exportReady ? exportStatus : 'Not exported', done: exportReady },
            { id: 'artifacts', label: 'Generate artifacts', detail: artifactsReady ? `${exportArtifacts.length} files` : 'None yet', done: artifactsReady },
            { id: 'registry', label: 'Register in model registry', detail: registryReady ? deploymentStatus : 'Not registered', done: registryReady },
            { id: 'deploy', label: 'Deploy to production', detail: deployed ? deploymentStatus : 'Not deployed', done: deployed },
          ]
          const completedSteps = steps.filter(s => s.done).length
          const allDone = completedSteps === steps.length
          const nextStep = steps.find(s => !s.done)
          return (
            <>
              <div style={{ ...panel, textAlign: 'left', marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={label}>PROMOTION WORKFLOW</div>
                  <span style={{ fontSize: 9, fontFamily: MONO, color: allDone ? EMBRY.green : EMBRY.amber }}>
                    {completedSteps}/{steps.length} COMPLETE
                  </span>
                </div>
                <div style={{ height: 4, background: EMBRY.bgDeep, borderRadius: 2, overflow: 'hidden', marginBottom: 16 }}>
                  <div style={{ height: '100%', width: `${(completedSteps / steps.length) * 100}%`, background: allDone ? EMBRY.green : EMBRY.accent, borderRadius: 2, transition: 'width 0.3s' }} />
                </div>
                {steps.map((step, i) => {
                  const isNext = step.id === nextStep?.id
                  return (
                    <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: i < steps.length - 1 ? 12 : 0 }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: step.done ? EMBRY.green : isNext ? EMBRY.accent + '22' : 'transparent',
                        border: step.done ? 'none' : `2px solid ${isNext ? EMBRY.accent : EMBRY.border}`,
                        fontSize: 10, fontWeight: 900,
                        color: step.done ? '#000' : isNext ? EMBRY.accent : EMBRY.dim,
                      }}>
                        {step.done ? '✓' : i + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: step.done ? EMBRY.white : isNext ? EMBRY.white : EMBRY.dim }}>{step.label}</div>
                        <div style={{ fontSize: 9, fontFamily: MONO, color: step.done ? EMBRY.green : EMBRY.muted, marginTop: 2 }}>{step.detail}</div>
                      </div>
                      {isNext && step.id === 'export' && (
                        <button data-qid="clf-promote:btn" data-qs-action="CLF_PROMOTE_EXPORT" title="Export model in selected format"
                          onClick={() => {
                            fetch(`${API}/projects/classifier-lab/promote/${project.id}`, {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ model: modelName, macro_f1: macroF1, accuracy, action: 'export' }),
                            }).catch(() => {})
                          }}
                          style={{ ...btnOutline, borderColor: EMBRY.accent + '66', color: EMBRY.accent, fontSize: 9, padding: '4px 12px', whiteSpace: 'nowrap' }}
                        >EXPORT MODEL</button>
                      )}
                      {isNext && step.id === 'registry' && (
                        <button data-qid="clf-promote:btn" data-qs-action="CLF_PROMOTE_REGISTER" title="Register model in model registry"
                          onClick={() => {
                            fetch(`${API}/projects/classifier-lab/promote/${project.id}`, {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ model: modelName, macro_f1: macroF1, accuracy, action: 'register' }),
                            }).catch(() => {})
                          }}
                          style={{ ...btnOutline, borderColor: EMBRY.accent + '66', color: EMBRY.accent, fontSize: 9, padding: '4px 12px', whiteSpace: 'nowrap' }}
                        >REGISTER</button>
                      )}
                    </div>
                  )
                })}
              </div>

              {exportArtifacts.length > 0 && (
                <div style={{ ...panel, textAlign: 'left', marginBottom: 24 }}>
                  <div style={{ ...label, marginBottom: 8 }}>EXPORT ARTIFACTS</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {exportArtifacts.map(artifact => (
                      <span key={artifact} style={{ ...statusBadge, fontFamily: MONO, color: EMBRY.white, background: 'rgba(255,255,255,0.05)', border: `1px solid ${EMBRY.border}`, padding: '3px 8px' }}>
                        <FileText size={8} style={{ marginRight: 4, verticalAlign: 'middle' }} />{artifact}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <RunButton data-qid="clf-promote:promote" data-qs-action="CLF_PROMOTE_TO_PRODUCTION" title="Promote winning model to production deployment" onClick={promoteModel} disabled={promoting || !allDone}>
                {promoting ? 'PROMOTING...' : allDone ? 'PROMOTE TO PRODUCTION' : 'COMPLETE STEPS ABOVE FIRST'}
              </RunButton>
              {promoteStatus.kind !== 'idle' && (
                <div style={{
                  marginTop: 10, fontSize: 10, fontFamily: MONO,
                  color: promoteStatus.kind === 'success' ? EMBRY.green : promoteStatus.kind === 'error' ? EMBRY.red : EMBRY.amber,
                }}>
                  {promoteStatus.text}
                </div>
              )}
            </>
          )
        })()}

        {!holdoutPassed && (
          <div style={{ ...panel, marginTop: 12, border: `1px solid ${EMBRY.red}33`, background: `${EMBRY.red}08` }}>
            <div style={{ fontSize: 11, color: EMBRY.red, fontWeight: 700 }}>
              Promotion blocked until holdout gate passes (F1 ≥ {gateThreshold.toFixed(2)}).
            </div>
            <div style={{ fontSize: 10, color: EMBRY.dim, marginTop: 4 }}>
              Return to Train or Tune tabs to improve model performance, then re-evaluate.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
