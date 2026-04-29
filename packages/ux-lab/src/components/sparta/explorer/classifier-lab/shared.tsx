import { AlertTriangle, Cpu, ShieldCheck } from 'lucide-react'
import { EMBRY, label, card, panel, heading } from '../../common/EmbryStyle'

import { API, MONO } from './types'
import type { Project, Tab, TrainingRow, BenchmarkRow, PreflightResult } from './types'

// ── Shared Components ───────────────────────────────────────────────

export function StatPanel({ title, value, mono, color }: { title: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div style={panel}>
      <div style={label}>{title}</div>
      <div style={{ ...heading, fontSize: mono ? 12 : 22, fontFamily: mono ? MONO : 'inherit', color: color ?? EMBRY.white, marginTop: 4 }}>{value}</div>
    </div>
  )
}

export function GateCard({ name, passed, metrics, checks, bars, halt }: {
  name: string
  passed: boolean
  metrics: Array<{ label: string; value: string | number; color?: string }>
  checks: Array<{ label: string; ok: boolean; detail?: string }>
  bars?: Array<{ label: string; value: number; total: number; color: string }>
  halt?: { reason: string; action: string } | null
}) {
  const halted = !!halt && !passed
  const borderColor = passed ? EMBRY.green : halted ? EMBRY.amber : EMBRY.red
  const statusLabel = passed ? 'PASSED' : halted ? 'HALTED' : 'FAILED'
  const statusIcon = passed
    ? <ShieldCheck size={18} color={EMBRY.green} />
    : halted
      ? <AlertTriangle size={18} color={EMBRY.amber} />
      : <AlertTriangle size={18} color={EMBRY.red} />
  return (
    <div style={{ ...card, border: `1px solid ${borderColor}33`, background: `${borderColor}04` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: halted ? 12 : 16 }}>
        {statusIcon}
        <span style={{ fontSize: 12, fontWeight: 900, color: borderColor }}>
          {name} {statusLabel}
        </span>
      </div>
      {halted && halt && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 6, background: `${EMBRY.amber}08`, border: `1px solid ${EMBRY.amber}22` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: EMBRY.amber, marginBottom: 6 }}>WHY THIS STEP HALTED</div>
          <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.6, marginBottom: 8 }}>{halt.reason}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: EMBRY.accent, marginBottom: 4 }}>WHAT WOULD UNBLOCK IT</div>
          <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.6 }}>{halt.action}</div>
        </div>
      )}
      {metrics.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(metrics.length, 3)}, 1fr)`, gap: 12, marginBottom: 16 }}>
          {metrics.map(m => (
            <div key={m.label}>
              <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 2 }}>{m.label}</div>
              <div style={{ fontSize: 18, fontWeight: 900, fontFamily: MONO, color: m.color || EMBRY.white }}>{m.value}</div>
            </div>
          ))}
        </div>
      )}
      {bars && bars.length > 0 && (
        <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12, marginBottom: 12 }}>
          {bars.map(b => {
            const pct = b.total > 0 ? (b.value / b.total) * 100 : 0
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontFamily: MONO, width: 50, color: EMBRY.dim }}>{b.label}</span>
                <div style={{ flex: 1, height: 4, background: EMBRY.bgDeep, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color, borderRadius: 2 }} />
                </div>
                <span style={{ fontSize: 10, fontFamily: MONO, color: EMBRY.dim, width: 80, textAlign: 'right' }}>{b.value} ({pct.toFixed(0)}%)</span>
              </div>
            )
          })}
        </div>
      )}
      {checks.length > 0 && (
        <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12 }}>
          <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 6 }}>QUALITY CHECKS</div>
          {checks.map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: 10 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: c.ok ? EMBRY.green : EMBRY.amber }} />
              <span style={{ color: EMBRY.dim, flex: 1 }}>{c.label}</span>
              {c.detail && <span style={{ fontFamily: MONO, color: c.ok ? EMBRY.green : EMBRY.amber }}>{c.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function GpuCard({ name, vram, price, avail, active, onClick }: {
  name: string; vram: string; price: string; avail: number; active: boolean; onClick: () => void
}) {
  const barColor = avail < 10 ? EMBRY.red : avail < 40 ? EMBRY.amber : EMBRY.green
  return (
    <div data-qid="explorer-classifier-lab-shared:auto:97" data-qs-action="EXPLORER_CLASSIFIER_LAB_SHARED_AUTO_97" onClick={onClick} style={{
      ...card, padding: 12, cursor: 'pointer',
      border: `1px solid ${active ? EMBRY.green + '66' : EMBRY.border}`,
      background: active ? 'rgba(0,255,136,0.04)' : EMBRY.bgCard,
      transition: 'all 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Cpu size={11} color={active ? EMBRY.green : EMBRY.dim} />
        <span style={{ fontSize: 10, fontWeight: 900 }}>{name}</span>
        <span style={{ fontSize: 8, color: EMBRY.dim, fontFamily: MONO }}>{vram}</span>
      </div>
      <div style={{ fontSize: 10, color: active ? EMBRY.green : EMBRY.dim, fontWeight: 700, fontFamily: MONO, marginBottom: 8 }}>{price}</div>
      <div style={{ height: 3, background: EMBRY.bgDeep, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${avail}%`, background: barColor, borderRadius: 2 }} />
      </div>
      <div style={{ fontSize: 7, color: EMBRY.dim, marginTop: 2, fontFamily: MONO }}>{avail} available</div>
    </div>
  )
}

// ── Pre-flight checks ───────────────────────────────────────────────

export function computePreflights(
  tab: Tab,
  project: Project,
  dataInfo: any,
  tuneConfig: any,
  trainRows: TrainingRow[],
  benchData: any,
  evalData: any,
): PreflightResult[] {
  const checks: PreflightResult[] = []

  if (tab === 'research') {
    checks.push({
      check: 'Task description defined',
      passed: !!project.name && project.name !== project.id,
      detail: project.name || 'No name',
      blocker: 'Define what this classifier is for',
    })
  }

  if (tab === 'data') return []

  if (tab === 'tune') {
    const suff = dataInfo?.sufficiency
    checks.push({
      check: 'Data gate passed',
      passed: !!dataInfo?.gatePassed,
      detail: suff ? `${suff.available} samples (need ${suff.required})` : dataInfo?.gatePassed ? 'Yes' : 'No data',
      blocker: suff && !suff.sufficient ? `Need ${suff.deficit} more samples` : 'Add training data in Data tab',
    })
  }

  if (tab === 'train') {
    checks.push({
      check: 'Data sufficient for training',
      passed: !!dataInfo?.gatePassed,
      detail: dataInfo?.gatePassed ? 'Yes' : 'Data gate not passed',
      blocker: 'Fix data issues in Data tab first',
    })
    checks.push({
      check: 'Tune config set by agent or human (not defaults)',
      passed: !!tuneConfig && tuneConfig._source && tuneConfig._source !== 'default' && !tuneConfig._source?.startsWith('default-'),
      detail: tuneConfig?._source ? `Source: ${tuneConfig._source}` : 'Not configured',
      blocker: 'Run /dogpile research first — it sets initial HP recommendations. Or configure manually in Tune tab.',
    })
  }

  if (tab === 'benchmark') {
    const hasResults = trainRows.length > 0 || (benchData?.results?.length > 0)
    checks.push({
      check: 'Trained models exist to compare',
      passed: hasResults,
      detail: hasResults ? `${trainRows.length || benchData?.results?.length || 0} backbones` : 'No models trained',
      blocker: 'Run training in Train tab first',
    })
  }

  if (tab === 'evaluate') {
    const hasModel = !!benchData?.selected_backbone || trainRows.some(r => r.status === 'pass')
    checks.push({
      check: 'Trained model available',
      passed: hasModel,
      detail: hasModel ? (benchData?.selected_backbone || 'Model available') : 'No model',
      blocker: 'Train a model first in Train tab',
    })
  }

  if (tab === 'promote') {
    checks.push({
      check: 'Evaluation completed',
      passed: !!evalData && !evalData.error,
      detail: evalData?.macro_f1 ? `F1 ${evalData.macro_f1.toFixed(3)}` : 'No eval results',
      blocker: 'Run evaluation in Evaluate tab first',
    })
    if (evalData?.macro_f1) {
      const gate = evalData.gate_threshold ?? evalData.holdout_gate_f1 ?? 0.90
      checks.push({
        check: 'Holdout gate passed',
        passed: evalData.holdout_passed ?? evalData.macro_f1 >= gate,
        detail: `F1 ${evalData.macro_f1.toFixed(3)} vs ${gate.toFixed(2)} target`,
        blocker: 'Improve model performance — go to Train tab',
      })
    }
  }

  return checks
}

export function PreflightBar({ checks }: { checks: PreflightResult[] }) {
  if (!checks.length) return null
  const blockers = checks.filter(c => !c.passed)
  if (checks.every(c => c.passed)) return null

  return (
    <div style={{
      ...card, marginBottom: 16, padding: '12px 16px',
      border: `1px solid ${EMBRY.amber}33`, background: `${EMBRY.amber}04`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: blockers.length > 0 ? 10 : 0 }}>
        <AlertTriangle size={14} color={EMBRY.amber} />
        <span style={{ fontSize: 11, fontWeight: 900, color: EMBRY.amber }}>
          PRE-FLIGHT: {blockers.length} blocker{blockers.length === 1 ? '' : 's'}
        </span>
      </div>
      {blockers.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: i < blockers.length - 1 ? 6 : 0 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: EMBRY.amber, marginTop: 5, flexShrink: 0 }} />
          <div>
            <span style={{ fontSize: 10, fontWeight: 700, color: EMBRY.white }}>{c.check}</span>
            <span style={{ fontSize: 10, color: EMBRY.dim }}> — {c.detail}</span>
            {c.blocker && <div style={{ fontSize: 9, color: EMBRY.amber, marginTop: 2 }}>→ {c.blocker}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Style constants ─────────────────────────────────────────────────

export const MD_CSS = `
.clf-markdown h1 { font-size: 20px; font-weight: 900; color: #e2e8f0; margin: 0 0 16px 0; letter-spacing: -0.02em; }
.clf-markdown h2 { font-size: 14px; font-weight: 700; color: #e2e8f0; margin: 24px 0 12px 0; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; }
.clf-markdown p { margin: 8px 0; color: #94a3b8; }
.clf-markdown strong { color: #e2e8f0; }
.clf-markdown ul { padding-left: 20px; margin: 8px 0; }
.clf-markdown li { margin: 6px 0; color: #94a3b8; }
.clf-markdown li::marker { color: #00ff88; }
.clf-markdown table { width: 100%; border-collapse: collapse; margin: 12px 0; font-family: "JetBrains Mono", monospace; font-size: 11px; }
.clf-markdown th { text-align: left; padding: 8px 12px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.13); }
.clf-markdown td { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); color: #e2e8f0; }
.clf-markdown tr:hover td { background: rgba(255,255,255,0.02); }
.clf-markdown code { font-family: "JetBrains Mono", monospace; background: #0b1220; padding: 2px 6px; border-radius: 3px; font-size: 11px; color: #00ff88; }
`

export const thStyle: React.CSSProperties = { padding: '12px 14px', ...label, fontSize: 8, textAlign: 'left' }
export const tdStyle: React.CSSProperties = { padding: '12px 14px', fontSize: 11, fontFamily: MONO }
export const statusBadge: React.CSSProperties = { padding: '2px 6px', borderRadius: 3, fontSize: 8, fontWeight: 900 }
export const gateBadge: React.CSSProperties = { padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700, border: '1px solid', fontFamily: MONO }
export const btnOutline: React.CSSProperties = {
  background: 'none', border: `1px solid ${EMBRY.border}`, color: EMBRY.dim,
  padding: '8px 16px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer',
}
export const roundPillStyle: React.CSSProperties = {
  background: 'transparent', border: `1px solid ${EMBRY.border}`, borderRadius: 12,
  padding: '2px 8px', fontSize: 9, fontFamily: MONO, fontWeight: 700, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center',
}
export const rerunInputStyle: React.CSSProperties = {
  width: '100%',
  background: EMBRY.bgDeep,
  border: `1px solid ${EMBRY.border}`,
  color: EMBRY.white,
  padding: '8px 10px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: MONO,
  outline: 'none',
  boxSizing: 'border-box',
}
export const filterSelect: React.CSSProperties = {
  background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, color: EMBRY.white,
  padding: '4px 8px', borderRadius: 4, fontSize: 10, fontFamily: MONO, cursor: 'pointer', outline: 'none',
}
export const paginationBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)', border: `1px solid ${EMBRY.border}`, color: EMBRY.dim,
  padding: '4px 12px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer',
}
