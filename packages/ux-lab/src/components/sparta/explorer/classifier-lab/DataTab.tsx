import { useState, useEffect, useMemo } from 'react'
import { AlertTriangle, ShieldCheck, FileText, Search, Cpu } from 'lucide-react'
import {
  useReactTable, getCoreRowModel,
  flexRender, createColumnHelper,
  type SortingState, type PaginationState,
} from '@tanstack/react-table'
import { marked } from 'marked'
import { EMBRY, label, heading, body, card, panel } from '../../common/EmbryStyle'
import { ImageThumb } from '../../common/ImageLightbox'

import { useRegisterAction } from '../../../../hooks/useRegisterAction'
import { API, MONO } from './types'
import type { Project, NextSteps, FailureAnalysis, DataFileRow } from './types'
import { StatPanel, GateCard, MD_CSS, thStyle, tdStyle, statusBadge, filterSelect, paginationBtn, btnOutline } from './shared'

export function DataTab({ project, onGateChange }: { project: Project; onGateChange: (passed: boolean) => void }) {
  const [dataInfo, setDataInfo] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [enriching, setEnriching] = useState(false)
  const [enrichResult, setEnrichResult] = useState<any>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/projects/classifier-lab/data/${project.id}`)
      .then(r => r.json()).then(d => { setDataInfo(d); setLoading(false); onGateChange(d.gatePassed ?? false) })
      .catch(() => { setLoading(false); onGateChange(false) })
    fetch(`${API}/projects/classifier-lab/data/${project.id}/profile`)
      .then(r => r.json()).then(d => { if (!d.error) setProfile(d) })
      .catch(() => {})
  }, [project.id, onGateChange])

  const APP = 'classifier-lab'
  useRegisterAction('clf-data:btn', { app: APP, action: 'CLF_DATA_ENRICH', label: 'Search For More Data', description: 'Run data enrichment pipeline to search HuggingFace, GitHub, and transcripts for more training data' })
  useRegisterAction('clf-data:search', { app: APP, action: 'CLF_DATA_SEARCH_FILES', label: 'Search Files', description: 'Search dataset files by text content', params: { query: { type: 'string' } } })
  useRegisterAction('clf-data:split-filter', { app: APP, action: 'CLF_DATA_FILTER_SPLIT', label: 'Filter by Split', description: 'Filter dataset files by train/val/test split', params: { split: { type: 'string' } } })
  useRegisterAction('clf-data:class-filter', { app: APP, action: 'CLF_DATA_FILTER_CLASS', label: 'Filter by Class', description: 'Filter dataset files by class label', params: { class: { type: 'string' } } })

  if (loading) return <div style={{ color: EMBRY.dim, padding: 40 }}>Loading dataset info...</div>
  if (!dataInfo || dataInfo.error) return (
    <div style={{ ...card, maxWidth: 600, margin: '60px auto', textAlign: 'center', padding: 40 }}>
      <AlertTriangle size={32} color={EMBRY.amber} style={{ marginBottom: 12 }} />
      <div style={{ ...heading, color: EMBRY.amber, marginBottom: 8 }}>NO DATASET</div>
      <div style={{ ...body, fontSize: 12, color: EMBRY.dim }}>No training data found for this project.</div>
    </div>
  )

  const classes: { name: string; train: number; val: number; test: number }[] = dataInfo.classes || []
  const maxCount = Math.max(...classes.map(c => c.train), 1)
  const failedClasses = classes.filter(c => c.train < dataInfo.gateThreshold)
  const passed = dataInfo.gatePassed
  const suff = dataInfo.sufficiency as { required: number; available: number; sufficient: boolean; deficit: number; minPerClass: number; minRequired: number; isMultiLabel: boolean; perClassDeficit?: Array<{ name: string; have: number; need: number }> } | null

  const CLASS_COLORS = [EMBRY.green, EMBRY.blue, EMBRY.accent, '#22d3ee', EMBRY.amber, EMBRY.red]

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Data sufficiency gate */}
      <div style={{ marginBottom: 20 }}>
        <GateCard
          name="DATA GATE"
          passed={passed}
          metrics={[
            { label: 'TRAIN SAMPLES', value: String(suff?.available ?? dataInfo.totalTrain ?? '—') },
            { label: 'CLASSES', value: String(dataInfo.classCount ?? classes.length ?? '—') },
            { label: 'MIN / CLASS', value: String(dataInfo.minPerClass ?? '—'), color: suff && suff.minPerClass < suff.minRequired ? EMBRY.red : EMBRY.green },
          ]}
          checks={[
            { label: `≥ ${suff?.minRequired ?? 100} samples per class`, ok: suff ? suff.minPerClass >= suff.minRequired : passed, detail: suff ? `min: ${suff.minPerClass}` : '—' },
            { label: `Total ≥ ${suff?.required ?? '?'} (${dataInfo.classCount ?? '?'} classes × ${suff?.minRequired ?? 100})`, ok: suff ? suff.sufficient : passed, detail: suff ? `${suff.available} / ${suff.required}` : '—' },
            { label: 'Has validation split', ok: classes.some(c => c.val > 0), detail: classes.some(c => c.val > 0) ? 'Yes' : 'No val split' },
            { label: 'Has test split', ok: classes.some(c => c.test > 0), detail: classes.some(c => c.test > 0) ? 'Yes' : 'No test split' },
          ]}
          halt={suff && !suff.sufficient ? {
            reason: `Need ${suff.required.toLocaleString()} training samples (${dataInfo.classCount} classes × ${suff.minRequired} per class). Have ${suff.available.toLocaleString()} — short by ${suff.deficit.toLocaleString()}.${suff.perClassDeficit && suff.perClassDeficit.length > 0 ? ` ${suff.perClassDeficit.length} classes below minimum.` : ''}`,
            action: `Search HuggingFace and GitHub for additional training data, or mine conversation transcripts.`,
          } : null}
        />
      </div>

      {/* Data enrichment */}
      {suff && !suff.sufficient && (
        <div style={{ ...card, marginBottom: 20, padding: 16, border: `1px solid ${EMBRY.accent}33` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: enrichResult ? 12 : 0 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: EMBRY.white }}>DATA ENRICHMENT</div>
              <div style={{ fontSize: 9, color: EMBRY.dim, marginTop: 2 }}>
                Searches HuggingFace → GitHub → conversation transcripts until sufficient or exhausted
              </div>
            </div>
            <button data-qid="clf-data:btn" data-qs-action="CLF_DATA_ENRICH" title="Search HuggingFace and transcripts for more training data"
              onClick={async () => {
                setEnriching(true)
                setEnrichResult(null)
                try {
                  const resp = await fetch(`${API}/projects/classifier-lab/data/${project.id}/enrich`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ min_per_class: suff.minRequired }),
                  })
                  const result = await resp.json()
                  setEnrichResult(result)
                  const d = await fetch(`${API}/projects/classifier-lab/data/${project.id}`).then(r => r.json())
                  setDataInfo(d)
                  onGateChange(d.gatePassed ?? false)
                } catch (e) {
                  setEnrichResult({ status: 'error', error: String(e) })
                }
                setEnriching(false)
              }}
              disabled={enriching}
              style={{
                background: EMBRY.accent, border: 'none', color: '#000',
                padding: '8px 16px', borderRadius: 6, fontSize: 10, fontWeight: 900,
                cursor: enriching ? 'default' : 'pointer', opacity: enriching ? 0.5 : 1,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Search size={12} />
              {enriching ? 'SEARCHING...' : 'SEARCH FOR MORE DATA'}
            </button>
          </div>
          {enrichResult && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 4, fontSize: 10, fontFamily: MONO,
              background: enrichResult.status === 'sufficient' ? 'rgba(0,255,136,0.06)' : enrichResult.status === 'abandoned' ? 'rgba(255,68,68,0.06)' : 'rgba(255,170,0,0.06)',
              color: enrichResult.status === 'sufficient' ? EMBRY.green : enrichResult.status === 'abandoned' ? EMBRY.red : EMBRY.amber,
              border: `1px solid ${enrichResult.status === 'sufficient' ? EMBRY.green : enrichResult.status === 'abandoned' ? EMBRY.red : EMBRY.amber}22`,
            }}>
              {enrichResult.status === 'sufficient' && `Data sufficient! ${enrichResult.total_train} samples now available (needed ${enrichResult.required}).`}
              {enrichResult.status === 'abandoned' && `Enrichment exhausted. Searched HuggingFace + transcripts — not enough matching data found. ${enrichResult.total_train || 0} samples available.`}
              {enrichResult.status === 'insufficient' && `Found some data but still insufficient. ${enrichResult.total_train || 0} / ${enrichResult.required || '?'} samples.`}
              {enrichResult.error && `Error: ${enrichResult.error}`}
              {enrichResult.attempts && (
                <div style={{ marginTop: 4, fontSize: 9, color: EMBRY.dim }}>
                  Strategies tried: {enrichResult.attempts.map((a: any) => `${a.strategy} (${a.new_samples || 0} found)`).join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 32 }}>
        <StatPanel title="SOURCE" value={dataInfo.path?.split('/').slice(-2).join('/') || project.id} mono />
        <StatPanel title="MODALITY" value={dataInfo.modality || project.modality || '—'} color={EMBRY.green} />
        <StatPanel title="TRAIN SAMPLES" value={String(dataInfo.totalTrain ?? dataInfo.totalSamples ?? '—')} />
        <StatPanel title="CLASSES" value={String(dataInfo.classCount ?? classes.length ?? '—')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        {/* Distribution bars */}
        <div style={card}>
          <div style={{ ...heading, marginBottom: 20 }}>Class Distribution (Train)</div>
          {classes.map((c, i) => {
            const color = c.train < dataInfo.gateThreshold ? EMBRY.red : CLASS_COLORS[i % CLASS_COLORS.length]
            return (
              <div key={c.name} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontFamily: MONO }}>{c.name}</span>
                  <span style={{ color: c.train < dataInfo.gateThreshold ? EMBRY.red : EMBRY.dim, fontFamily: MONO }}>
                    {c.train} train / {c.val} val / {c.test} test
                  </span>
                </div>
                <div style={{ height: 6, background: EMBRY.bgDeep, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${(c.train / (maxCount * 1.2)) * 100}%`, height: '100%', background: color, borderRadius: 3 }} />
                </div>
              </div>
            )
          })}
          <div style={{ fontSize: 9, color: EMBRY.dim, marginTop: 8, fontFamily: MONO }}>
            Min per class: {dataInfo.minPerClass} (threshold: {dataInfo.gateThreshold})
          </div>
        </div>

        {/* Validation gate */}
        {!passed ? (
          <div style={{ ...card, border: `1px solid ${EMBRY.red}`, textAlign: 'center', background: 'rgba(255,68,68,0.03)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={32} color={EMBRY.red} style={{ marginBottom: 12 }} />
            <div style={{ ...heading, color: EMBRY.red, marginBottom: 8 }}>VALIDATION FAILED</div>
            <div style={{ ...body, fontSize: 12, color: EMBRY.dim }}>
              {failedClasses.map(c => `"${c.name}" has only ${c.train} samples`).join('. ')}.<br />
              Minimum is <b>{dataInfo.gateThreshold} per class</b>.
            </div>
            <div style={{ marginTop: 16, fontSize: 10, color: EMBRY.red, fontWeight: 700 }}>
              Tune and Train tabs are BLOCKED until data gate passes.
            </div>
            <button data-qid="clf-data:btn" data-qs-action="CLF_DATA_AUGMENT" title="Augment training dataset to meet minimum threshold" style={{
              marginTop: 16, background: 'none', border: `1px solid ${EMBRY.red}`,
              color: EMBRY.red, padding: '8px 16px', borderRadius: 4, fontWeight: 900, cursor: 'pointer', fontSize: 10,
            }}>AUGMENT DATASET</button>
          </div>
        ) : (
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <ShieldCheck size={18} color={EMBRY.green} />
              <span style={{ fontSize: 12, fontWeight: 900, color: EMBRY.green }}>DATA GATE PASSED</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 2 }}>CLASSES</div>
                <div style={{ fontSize: 18, fontWeight: 900, fontFamily: MONO }}>{dataInfo.classCount}</div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 2 }}>MIN / CLASS</div>
                <div style={{ fontSize: 18, fontWeight: 900, fontFamily: MONO, color: EMBRY.green }}>{dataInfo.minPerClass}</div>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12 }}>
              <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 8 }}>SPLIT BREAKDOWN</div>
              {['train', 'val', 'test'].map(split => {
                const count = classes.reduce((sum, c) => sum + ((c as any)[split] || 0), 0)
                const total = dataInfo.totalTrain + classes.reduce((s, c) => s + c.val + c.test, 0)
                const pct = total > 0 ? ((count / total) * 100).toFixed(0) : '0'
                return (
                  <div key={split} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontFamily: MONO, width: 40, color: EMBRY.dim }}>{split}</span>
                    <div style={{ flex: 1, height: 4, background: EMBRY.bgDeep, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: split === 'train' ? EMBRY.accent : split === 'val' ? EMBRY.blue : EMBRY.amber, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 10, fontFamily: MONO, color: EMBRY.dim, width: 60, textAlign: 'right' }}>{count} ({pct}%)</span>
                  </div>
                )
              })}
            </div>
            <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12, marginTop: 12 }}>
              <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 6 }}>QUALITY CHECKS</div>
              {[
                { label: 'Min samples/class met', ok: true },
                { label: 'All classes have val+test splits', ok: classes.every(c => c.val > 0 && c.test > 0) },
                { label: 'Class balance ratio', ok: dataInfo.minPerClass / Math.max(...classes.map(c => c.train), 1) > 0.5, detail: `${(dataInfo.minPerClass / Math.max(...classes.map(c => c.train), 1) * 100).toFixed(0)}%` },
              ].map((check, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: check.ok ? EMBRY.green : EMBRY.amber }} />
                  <span style={{ color: EMBRY.dim }}>{check.label}</span>
                  {check.detail && <span style={{ fontFamily: MONO, color: check.ok ? EMBRY.green : EMBRY.amber, marginLeft: 'auto' }}>{check.detail}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {profile && <DataProfilePanel profile={profile} />}
      <DataFileTable projectId={project.id} classes={classes.map(c => c.name)} />
    </div>
  )
}

function DataTrainingSummary({ projectId, classCount, gateThreshold }: { projectId: string; classCount: number; gateThreshold: number }) {
  const [bench, setBench] = useState<any>(null)
  useEffect(() => {
    fetch(`${API}/projects/classifier-lab/benchmark-results/${projectId}`)
      .then(r => r.json()).then(setBench).catch(() => {})
  }, [projectId])

  const winner = bench?.selected_backbone
  const f1 = bench?.selected_metrics?.macro_f1
  const acc = bench?.selected_metrics?.accuracy
  const results = bench?.results || []
  const gatePassed = f1 != null && f1 >= (bench?.gate_f1 || 0.90)

  if (!bench || !results.length) return (
    <div style={{ ...card, border: `1px solid ${EMBRY.green}`, background: 'rgba(0,255,136,0.03)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <ShieldCheck size={24} color={EMBRY.green} style={{ marginBottom: 8 }} />
      <div style={{ fontSize: 11, fontWeight: 700, color: EMBRY.green, marginBottom: 4 }}>DATA GATE PASSED</div>
      <div style={{ fontSize: 10, color: EMBRY.dim }}>{classCount} classes, {gateThreshold}+ samples/class</div>
      <div style={{ fontSize: 9, color: EMBRY.muted, marginTop: 8 }}>Run training to see results here</div>
    </div>
  )

  const borderColor = gatePassed ? EMBRY.green : EMBRY.amber
  return (
    <div style={{ ...card, border: `1px solid ${borderColor}`, background: `${borderColor}05`, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        {gatePassed ? <ShieldCheck size={18} color={EMBRY.green} /> : <AlertTriangle size={18} color={EMBRY.amber} />}
        <span style={{ fontSize: 12, fontWeight: 900, color: borderColor }}>
          {gatePassed ? 'GATE PASSED' : 'GATE NOT MET'}
        </span>
        <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 'auto' }}>
          gate: F1 ≥ {bench?.gate_f1 || 0.90}
        </span>
      </div>

      {winner && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 2 }}>WINNER</div>
            <div style={{ fontSize: 12, fontWeight: 700, fontFamily: MONO, color: EMBRY.white }}>{winner}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 2 }}>F1 SCORE</div>
            <div style={{ fontSize: 20, fontWeight: 900, fontFamily: MONO, color: gatePassed ? EMBRY.green : EMBRY.amber }}>
              {f1?.toFixed(3)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 2 }}>ACCURACY</div>
            <div style={{ fontSize: 20, fontWeight: 900, fontFamily: MONO, color: EMBRY.white }}>
              {acc?.toFixed(3)}
            </div>
          </div>
        </div>
      )}

      {results.length > 1 && (
        <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12 }}>
          <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 8 }}>ALL BACKBONES</div>
          {results.map((r: any, i: number) => {
            const isWinner = r.backbone === winner
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                opacity: isWinner ? 1 : 0.6 }}>
                <span style={{ fontSize: 10, fontFamily: MONO, flex: 1, color: isWinner ? EMBRY.white : EMBRY.dim }}>
                  {r.backbone}
                </span>
                <span style={{ fontSize: 11, fontFamily: MONO, fontWeight: 700,
                  color: r.gate_passed ? EMBRY.green : EMBRY.red }}>
                  {(r.macro_f1 || 0).toFixed(3)}
                </span>
                <span style={{ fontSize: 9, color: EMBRY.muted, width: 30, textAlign: 'left' }}>
                  R{r.rounds || '?'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {!gatePassed && <NextStepsTeaser projectId={projectId} />}
    </div>
  )
}

function NextStepsTeaser({ projectId }: { projectId: string }) {
  const [ns, setNs] = useState<NextSteps | null>(null)
  const [showModal, setShowModal] = useState(false)
  useEffect(() => {
    fetch(`${API}/projects/classifier-lab/failure-analysis/${projectId}`)
      .then(r => r.json()).then((d: FailureAnalysis) => setNs(d.nextSteps ?? null))
      .catch(() => {})
  }, [projectId])

  if (!ns) return null

  const fullMd = ns.dogpile_hypotheses || ''
  const firstHypothesis = fullMd.split(/(?=###\s+Hypothesis\s+2)/i)[0]?.trim() || ''
  const hasMore = fullMd.includes('Hypothesis 2')

  return (
    <>
      <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12, marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Cpu size={10} color={EMBRY.accent} />
          <span style={{ fontSize: 9, fontWeight: 700, color: EMBRY.accent }}>NEXT STEPS (via /dogpile)</span>
          <span style={{ fontSize: 8, color: EMBRY.dim, marginLeft: 'auto' }}>
            gap: {ns.gap.toFixed(3)}{ns.plateau_detected ? ' | PLATEAU' : ''}
          </span>
        </div>
        {firstHypothesis ? (
          <>
            <div
              className="next-steps-teaser"
              style={{ fontSize: 10, color: EMBRY.white, lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: marked.parse(firstHypothesis) as string }}
            />
            {hasMore && (
              <button data-qid="clf-data:btn" data-qs-action="CLF_DATA_VIEW_HYPOTHESES" title="View all next-step hypotheses from /dogpile"
                onClick={() => setShowModal(true)}
                style={{
                  background: 'none', border: `1px solid ${EMBRY.accent}44`, borderRadius: 4,
                  color: EMBRY.accent, fontSize: 9, fontWeight: 700, padding: '4px 10px',
                  cursor: 'pointer', marginTop: 8,
                }}
              >
                VIEW ALL HYPOTHESES
              </button>
            )}
          </>
        ) : (
          <div style={{ fontSize: 9, color: EMBRY.dim, fontStyle: 'italic' }}>
            Hypotheses generating after pipeline completes...
          </div>
        )}
      </div>

      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.75)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: EMBRY.bgCard, border: `1px solid ${EMBRY.accent}44`,
              borderRadius: 10, maxWidth: 720, width: '90vw', maxHeight: '80vh',
              overflow: 'auto', padding: 28, position: 'relative',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Cpu size={16} color={EMBRY.accent} />
              <span style={{ ...heading, color: EMBRY.accent, fontSize: 14 }}>
                NEXT-STEP HYPOTHESES
              </span>
              <span style={{ fontSize: 9, color: EMBRY.dim, marginLeft: 'auto' }}>
                {ns.strategies_exhausted.length} strategies exhausted | gap: {ns.gap.toFixed(3)}
              </span>
              <button data-qid="clf-data:btn" data-qs-action="CLF_DATA_CLOSE_MODAL" title="Close hypotheses modal"
                onClick={() => setShowModal(false)}
                style={{
                  background: 'none', border: 'none', color: EMBRY.dim,
                  fontSize: 18, cursor: 'pointer', padding: '0 4px',
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 12, fontFamily: MONO }}>
              {ns.strategies_exhausted.join(' → ')}
            </div>
            <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 16 }}>
              <div
                className="next-steps-full"
                style={{ fontSize: 12, color: EMBRY.white, lineHeight: 1.7 }}
                dangerouslySetInnerHTML={{ __html: marked.parse(fullMd) as string }}
              />
            </div>
            {ns.diagnosis && (
              <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 6, background: 'rgba(255,170,0,0.06)', border: `1px solid ${EMBRY.amber}33` }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: EMBRY.amber, marginBottom: 4 }}>DIAGNOSIS</div>
                <div style={{ fontSize: 10, color: EMBRY.dim, fontFamily: MONO }}>{ns.diagnosis}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function DataProfilePanel({ profile }: { profile: any }) {
  const modality = profile.modality || 'text'
  const q = profile.quality || {}

  const qualityChecks: Array<{ label: string; ok: boolean; detail: string }> = []
  if (modality === 'text') {
    qualityChecks.push(
      { label: 'Empty texts', ok: (q.emptyTexts ?? 0) === 0, detail: String(q.emptyTexts ?? 0) },
      { label: 'Short texts (<5 words)', ok: (q.shortTexts ?? 0) === 0, detail: String(q.shortTexts ?? 0) },
      { label: 'Duplicate texts', ok: (q.duplicateTexts ?? 0) === 0, detail: String(q.duplicateTexts ?? 0) },
      { label: 'Conflicting labels', ok: (q.conflictingLabels ?? 0) === 0, detail: String(q.conflictingLabels ?? 0) },
    )
  } else if (modality === 'vision') {
    qualityChecks.push(
      { label: 'Corrupt images', ok: (q.corruptImages ?? 0) === 0, detail: String(q.corruptImages ?? 0) },
      { label: 'Uniform dimensions', ok: !q.needsResize, detail: q.needsResize ? `${q.uniqueDimensions} sizes` : 'Yes' },
      { label: 'Duplicate paths', ok: (q.duplicatePaths ?? 0) === 0, detail: String(q.duplicatePaths ?? 0) },
    )
  } else if (modality === 'tabular') {
    qualityChecks.push(
      { label: 'Columns with nulls', ok: (q.columnsWithNulls ?? 0) === 0, detail: String(q.columnsWithNulls ?? 0) },
      { label: 'Total null values', ok: (q.totalNulls ?? 0) === 0, detail: String(q.totalNulls ?? 0) },
      { label: 'Constant columns', ok: (q.constantColumns?.length ?? 0) === 0, detail: String(q.constantColumns?.length ?? 0) },
      { label: 'High cardinality', ok: (q.highCardinality?.length ?? 0) === 0, detail: String(q.highCardinality?.length ?? 0) },
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginTop: 24, marginBottom: 24 }}>
      <div style={card}>
        {modality === 'text' && profile.textStats && (
          <>
            <div style={{ ...label, marginBottom: 12 }}>TEXT STATISTICS</div>
            <ProfileStatsTable rows={[
              { label: 'Words', ...profile.textStats, min: profile.textStats.wordMin, max: profile.textStats.wordMax, mean: profile.textStats.wordMean, median: profile.textStats.wordMedian },
              { label: 'Chars', min: profile.textStats.charMin, max: profile.textStats.charMax, mean: profile.textStats.charMean, median: profile.textStats.charMedian },
            ]} />
            <div style={{ marginTop: 12, fontSize: 10, fontFamily: MONO, color: EMBRY.dim }}>
              Vocabulary: <span style={{ color: EMBRY.accent, fontWeight: 700 }}>{profile.vocabSize?.toLocaleString()}</span> unique tokens
            </div>
          </>
        )}
        {modality === 'vision' && profile.imageStats && (
          <>
            <div style={{ ...label, marginBottom: 12 }}>IMAGE STATISTICS</div>
            <ProfileStatsTable rows={[
              { label: 'Width (px)', ...profile.imageStats.width },
              { label: 'Height (px)', ...profile.imageStats.height },
              { label: 'File size (B)', ...profile.imageStats.fileSize },
            ]} />
            {profile.imageStats.channels && (
              <div style={{ marginTop: 12, fontSize: 10, fontFamily: MONO, color: EMBRY.dim }}>
                Channels: {Object.entries(profile.imageStats.channels).map(([ch, ct]) => `${ch}ch: ${ct}`).join(', ')}
              </div>
            )}
          </>
        )}
        {modality === 'tabular' && (
          <>
            <div style={{ ...label, marginBottom: 12 }}>FEATURE COLUMNS ({profile.featureCount})</div>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {(profile.columns || []).slice(0, 10).map((col: any) => (
                <div key={col.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 10 }}>
                  <span style={{ fontFamily: MONO, fontWeight: 700, flex: 1 }}>{col.name}</span>
                  <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: col.dtype === 'numeric' ? 'rgba(0,255,136,0.1)' : 'rgba(124,58,237,0.1)', color: col.dtype === 'numeric' ? EMBRY.green : EMBRY.accent }}>
                    {col.dtype}
                  </span>
                  {col.nulls > 0 && <span style={{ fontSize: 8, color: EMBRY.red }}>{col.nullPct}% null</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={card}>
        <div style={{ ...label, marginBottom: 12 }}>
          {modality === 'text' ? 'WORDS PER CLASS' : 'SAMPLES PER CLASS'}
        </div>
        {Object.entries(profile.perClass || {}).map(([cls, info]: [string, any]) => {
          const allCounts = Object.values(profile.perClass || {}).map((v: any) => v.mean_words || v.count || 0)
          const maxVal = Math.max(...allCounts) * 1.2 || 1
          const barVal = info.mean_words || info.count || 0
          return (
            <div key={cls} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontFamily: MONO }}>{cls}</span>
                <span style={{ color: EMBRY.dim, fontFamily: MONO }}>
                  {info.mean_words != null ? `${info.min_words}–${info.max_words} (μ ${info.mean_words})` : `${info.count} samples`}
                </span>
              </div>
              <div style={{ height: 4, background: EMBRY.bgDeep, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(barVal / maxVal) * 100}%`, height: '100%', background: EMBRY.blue, borderRadius: 2 }} />
              </div>
            </div>
          )
        })}
      </div>

      <div style={card}>
        <div style={{ ...label, marginBottom: 12 }}>DATA QUALITY</div>
        {qualityChecks.map((check, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '6px 0', borderBottom: i < qualityChecks.length - 1 ? `1px solid ${EMBRY.border}` : 'none' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: check.ok ? EMBRY.green : EMBRY.red, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: EMBRY.dim, flex: 1 }}>{check.label}</span>
            <span style={{ fontSize: 12, fontFamily: MONO, fontWeight: 700, color: check.ok ? EMBRY.green : EMBRY.red }}>
              {check.detail}
            </span>
          </div>
        ))}
        {profile.topWords && (
          <div style={{ marginTop: 12, borderTop: `1px solid ${EMBRY.border}`, paddingTop: 10 }}>
            <div style={{ fontSize: 8, color: EMBRY.muted, marginBottom: 6 }}>TOP TOKENS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {profile.topWords.slice(0, 12).map((tw: any) => (
                <span key={tw.word} style={{
                  fontSize: 9, fontFamily: MONO, padding: '2px 6px', borderRadius: 3,
                  background: 'rgba(124,58,237,0.1)', color: EMBRY.dim,
                }}>
                  {tw.word} <span style={{ color: EMBRY.muted }}>{tw.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ProfileStatsTable({ rows }: { rows: Array<{ label: string; min: number; max: number; mean: number; median: number }> }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
          {['', 'MIN', 'MAX', 'MEAN', 'MEDIAN'].map(h => (
            <th key={h} style={{ ...label, fontSize: 7, padding: '4px 6px', textAlign: h ? 'right' : 'left' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.label} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${EMBRY.border}` : 'none' }}>
            <td style={{ fontSize: 10, padding: '6px', color: EMBRY.dim }}>{row.label}</td>
            <td style={{ fontSize: 11, padding: '6px', fontFamily: MONO, textAlign: 'right' }}>{row.min}</td>
            <td style={{ fontSize: 11, padding: '6px', fontFamily: MONO, textAlign: 'right' }}>{row.max}</td>
            <td style={{ fontSize: 11, padding: '6px', fontFamily: MONO, textAlign: 'right' }}>{row.mean}</td>
            <td style={{ fontSize: 11, padding: '6px', fontFamily: MONO, textAlign: 'right', fontWeight: 700 }}>{row.median}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const fileColumnHelper = createColumnHelper<DataFileRow>()

function DataFileTable({ projectId, classes }: { projectId: string; classes: string[] }) {
  const [data, setData] = useState<DataFileRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [splitFilter, setSplitFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 })

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPagination(p => ({ ...p, pageIndex: 0 })) }, 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(pagination.pageIndex),
      pageSize: String(pagination.pageSize),
      ...(splitFilter ? { split: splitFilter } : {}),
      ...(classFilter ? { class: classFilter } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(sorting.length ? { sortBy: sorting[0].id, sortDir: sorting[0].desc ? 'desc' : 'asc' } : {}),
    })
    fetch(`${API}/projects/classifier-lab/data/${projectId}/files?${params}`)
      .then(r => r.json())
      .then(d => { setData(d.rows || []); setTotal(d.total || 0); setLoading(false) })
      .catch(() => { setData([]); setLoading(false) })
  }, [projectId, pagination.pageIndex, pagination.pageSize, splitFilter, classFilter, debouncedSearch, sorting])

  const isImageFile = (f: string) => /\.(jpg|jpeg|png|gif|webp)$/i.test(f)
  const imageUrl = (row: DataFileRow) => `${API}/projects/classifier-lab/images/${projectId}/${row.path}`

  const hasText = data.some(r => r.text)

  const columns = useMemo(() => [
    fileColumnHelper.display({
      id: 'thumb',
      header: '',
      size: 44,
      cell: ({ row }) => {
        const r = row.original
        if (!isImageFile(r.filename)) return <FileText size={11} color={EMBRY.dim} />
        return <ImageThumb src={imageUrl(r)} alt={`${r.className} — ${r.filename}`} size={32} />
      },
    }),
    fileColumnHelper.accessor('className', {
      header: 'CLASS',
      size: 100,
      cell: info => {
        const idx = classes.indexOf(info.getValue())
        const colors = [EMBRY.green, EMBRY.blue, EMBRY.accent, '#22d3ee', EMBRY.amber, EMBRY.red]
        return <span style={{ color: colors[idx % colors.length], fontWeight: 700 }}>{info.getValue()}</span>
      },
    }),
    ...(hasText ? [
      fileColumnHelper.accessor('text', {
        header: 'TEXT',
        size: 500,
        cell: (info: any) => (
          <span style={{ color: EMBRY.dim, fontSize: 11, lineHeight: 1.4, display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>
            {info.getValue() || '—'}
          </span>
        ),
      }),
    ] : [
      fileColumnHelper.accessor('filename', {
        header: 'FILENAME',
        cell: (info: any) => <span>{info.getValue()}</span>,
      }),
    ]),
    fileColumnHelper.accessor('split', {
      header: 'SPLIT',
      size: 80,
      cell: info => {
        const s = info.getValue()
        const color = s === 'train' ? EMBRY.green : s === 'val' ? EMBRY.amber : EMBRY.blue
        return <span style={{ ...statusBadge, background: `${color}15`, color }}>{s.toUpperCase()}</span>
      },
    }),
  ], [classes, hasText])

  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination },
    onSortingChange: (updater) => {
      setSorting(updater)
      setPagination(p => ({ ...p, pageIndex: 0 }))
    },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    pageCount: Math.ceil(total / pagination.pageSize),
  })

  const totalPages = Math.ceil(total / pagination.pageSize)

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={label}>DATASET FILES</div>
        <span style={{ fontSize: 10, color: EMBRY.dim, fontFamily: MONO }}>{total.toLocaleString()} files</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: EMBRY.bgDeep, borderRadius: 4, border: `1px solid ${EMBRY.border}` }}>
            <Search size={11} color={EMBRY.dim} />
            <input data-qid="clf-data:search" data-qs-action="CLF_DATA_SEARCH_FILES" title="Search dataset files" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search files..." aria-label="Search dataset files"
              style={{ background: 'none', border: 'none', outline: 'none', color: EMBRY.white, fontSize: 10, fontFamily: MONO, width: 120 }} />
          </div>
          <select data-qid="clf-data:split-filter" data-qs-action="CLF_DATA_FILTER_SPLIT" title="Filter files by train/val/test split" value={splitFilter} onChange={e => { setSplitFilter(e.target.value); setPagination(p => ({ ...p, pageIndex: 0 })) }}
            style={filterSelect}>
            <option value="">All splits</option>
            <option value="train">Train</option>
            <option value="val">Val</option>
            <option value="test">Test</option>
          </select>
          <select data-qid="clf-data:class-filter" data-qs-action="CLF_DATA_FILTER_CLASS" title="Filter files by class label" value={classFilter} onChange={e => { setClassFilter(e.target.value); setPagination(p => ({ ...p, pageIndex: 0 })) }}
            style={filterSelect}>
            <option value="">All classes</option>
            {classes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: EMBRY.dim }}>Loading files...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id} style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
                  {hg.headers.map(h => (
                    <th key={h.id} onClick={h.column.getToggleSortingHandler()}
                      style={{ ...thStyle, cursor: h.column.getCanSort() ? 'pointer' : 'default' }}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {{ asc: ' ▲', desc: ' ▼' }[h.column.getIsSorted() as string] ?? ''}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map(row => (
                <tr key={row.id} style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} style={tdStyle}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <span style={{ fontSize: 10, color: EMBRY.dim, fontFamily: MONO }}>
            Page {pagination.pageIndex + 1} of {totalPages}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button data-qid="clf-data:btn" data-qs-action="CLF_DATA_PREV_PAGE" title="Previous page of files" onClick={() => setPagination(p => ({ ...p, pageIndex: Math.max(0, p.pageIndex - 1) }))}
              disabled={pagination.pageIndex === 0} style={paginationBtn}>← Prev</button>
            <button data-qid="clf-data:btn" data-qs-action="CLF_DATA_NEXT_PAGE" title="Next page of files" onClick={() => setPagination(p => ({ ...p, pageIndex: Math.min(totalPages - 1, p.pageIndex + 1) }))}
              disabled={pagination.pageIndex >= totalPages - 1} style={paginationBtn}>Next →</button>
          </div>
        </div>
      )}
    </div>
  )
}
