import { useMemo, useState } from 'react'
import { FileText, GitBranch, ListChecks, PackageCheck, ShieldCheck, X } from 'lucide-react'
import { EMBRY, fwBadge } from '../common/EmbryStyle'
import type { ChatMessage } from '../../shared-chat'
import type { StreamingStep } from '../../shared-chat/ChatWell'

type EvidenceWorkspaceTab = 'Trace' | 'Sources' | 'Entities' | 'Proof' | 'Export'

const TABS: Array<{ id: EvidenceWorkspaceTab; icon: typeof GitBranch }> = [
  { id: 'Trace', icon: GitBranch },
  { id: 'Sources', icon: FileText },
  { id: 'Entities', icon: ListChecks },
  { id: 'Proof', icon: ShieldCheck },
  { id: 'Export', icon: PackageCheck },
]

interface EvidenceWorkspaceProps {
  message?: ChatMessage
  isStreaming?: boolean
  streamingSteps?: StreamingStep[]
  onClose?: () => void
}

function verdictColor(state?: string) {
  const normalized = state?.toLowerCase()
  if (normalized === 'satisfied') return EMBRY.green
  if (normalized === 'not_satisfied') return EMBRY.red
  return EMBRY.amber
}

function statusText(message?: ChatMessage, isStreaming?: boolean) {
  if (isStreaming) return 'RUNNING'
  return message?.evidenceCase?.verdict?.toUpperCase() || message?.verdict?.state || 'NEEDS_VERIFICATION'
}

export function EvidenceWorkspace({ message, isStreaming = false, streamingSteps = [], onClose }: EvidenceWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<EvidenceWorkspaceTab>('Trace')
  const evidence = message?.evidenceCase
  const gates = evidence?.gate_trace ?? message?.verdict?.gates ?? []
  const glossary = evidence?.glossary ?? []
  const controlIds = evidence?.control_ids ?? []
  const verdict = evidence?.verdict ?? message?.verdict?.state
  const runLabel = message?.id ? `case ${message.id}` : 'live case'

  const exportPreview = useMemo(() => ({
    review_state: 'NEEDS_VERIFICATION',
    verdict: verdict ?? 'pending',
    gates_passed: evidence?.gates_passed ?? gates.filter(g => g.passed).length,
    gates_total: evidence?.gates_total ?? gates.length,
    controls: controlIds,
    export_ready: false,
    note: 'OSCAL/SACM preview only. Reviewer approval is required before persistence or signoff.',
  }), [controlIds, evidence?.gates_passed, evidence?.gates_total, gates, verdict])

  const renderTab = () => {
    if (activeTab === 'Trace') {
      return (
        <div style={S.stack}>
          <div style={S.sectionTitle}>CAE gate trace</div>
          {streamingSteps.length > 0 && (
            <div style={S.timeline}>
              {streamingSteps.map(step => (
                <div key={step.id} style={S.timelineRow}>
                  <span style={{ ...S.dot, backgroundColor: step.status === 'failed' ? EMBRY.red : step.status === 'done' ? EMBRY.green : EMBRY.amber }} />
                  <div>
                    <div style={S.rowTitle}>{step.summary}</div>
                    {step.detail && <div style={S.muted}>{step.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {gates.length > 0 ? gates.map(gate => (
            <div key={`${gate.gate}-${gate.detail}`} style={S.item}>
              <div style={S.itemHead}>
                <span style={S.rowTitle}>{gate.gate.replace(/_/g, ' ')}</span>
                <span style={{ ...S.status, color: gate.passed ? EMBRY.green : EMBRY.red }}>{gate.passed ? 'PASS' : 'BLOCK'}</span>
              </div>
              <div style={S.muted}>{gate.detail}</div>
            </div>
          )) : <EmptyState text="Trace will populate as deterministic gates complete." />}
        </div>
      )
    }

    if (activeTab === 'Sources') {
      return (
        <div style={S.stack}>
          <div style={S.sectionTitle}>QRA and relationship hits</div>
          {controlIds.length > 0 && (
            <div style={S.wrap}>
              {controlIds.map(id => <span key={id} style={fwBadge('SPARTA')}>{id}</span>)}
            </div>
          )}
          <div style={S.item}>
            <div style={S.rowTitle}>Evidence answer</div>
            <div style={S.body}>{evidence?.answer || message?.content || 'Waiting for source synthesis.'}</div>
          </div>
          <div style={S.muted}>Raw QRA/source hit payloads are retained in diagnostics for the run; this workspace shows reviewer-facing grounding state.</div>
        </div>
      )
    }

    if (activeTab === 'Entities') {
      return (
        <div style={S.stack}>
          <div style={S.sectionTitle}>Spans, glossary, unresolved terms</div>
          {glossary.length > 0 ? glossary.slice(0, 24).map(entry => (
            <div key={`${entry.term}-${entry.type}`} style={S.item}>
              <div style={S.itemHead}>
                <span style={S.rowTitle}>{entry.term}</span>
                <span style={S.status}>{entry.type.replace(/_/g, ' ')}</span>
              </div>
              <div style={S.muted}>Source: structured evidence-case glossary</div>
            </div>
          )) : <EmptyState text="No authoritative glossary terms are available yet." />}
        </div>
      )
    }

    if (activeTab === 'Proof') {
      return (
        <div style={S.stack}>
          <div style={S.sectionTitle}>Lean/proof attempt</div>
          <div style={S.item}>
            <div style={S.itemHead}>
              <span style={S.rowTitle}>/lean4-prove</span>
              <span style={{ ...S.status, color: EMBRY.amber }}>SKIPPED</span>
            </div>
            <div style={S.muted}>No formalizable claim was emitted by this evidence case stream. The skip is explicit and does not count as proof.</div>
          </div>
        </div>
      )
    }

    return (
      <div style={S.stack}>
        <div style={S.sectionTitle}>OSCAL/SACM preview</div>
        <pre style={S.pre}>{JSON.stringify(exportPreview, null, 2)}</pre>
      </div>
    )
  }

  return (
    <aside style={S.container} aria-label="Evidence Workspace">
      <div style={S.header}>
        <div>
          <div style={S.kicker}>Evidence Workspace</div>
          <div style={S.title}>{runLabel}</div>
        </div>
        <button type="button" title="Close evidence workspace" onClick={onClose} style={S.iconBtn}>
          <X size={16} />
        </button>
      </div>
      <div style={S.verdictBar}>
        <span style={{ ...S.verdict, color: verdictColor(verdict) }}>{statusText(message, isStreaming)}</span>
        <span style={S.muted}>Review state: NEEDS_VERIFICATION</span>
      </div>
      <div style={S.tabs} role="tablist" aria-label="Evidence workspace tabs">
        {TABS.map(tab => {
          const Icon = tab.icon
          const selected = tab.id === activeTab
          return (
            <button key={tab.id} type="button" role="tab" aria-selected={selected} title={tab.id} onClick={() => setActiveTab(tab.id)} style={{ ...S.tab, ...(selected ? S.tabActive : {}) }}>
              <Icon size={14} />
              <span>{tab.id}</span>
            </button>
          )
        })}
      </div>
      <div style={S.content}>{renderTab()}</div>
    </aside>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ ...S.item, ...S.muted }}>{text}</div>
}

const S: Record<string, React.CSSProperties> = {
  container: {
    width: 420,
    minWidth: 380,
    maxWidth: 460,
    height: '100%',
    borderLeft: `1px solid ${EMBRY.border}`,
    backgroundColor: EMBRY.bgPanel,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '14px 16px',
    borderBottom: `1px solid ${EMBRY.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  kicker: { fontSize: 10, color: EMBRY.dim, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' },
  title: { fontSize: 13, color: EMBRY.white, fontWeight: 800, marginTop: 3 },
  iconBtn: {
    minWidth: 44,
    minHeight: 44,
    border: `1px solid ${EMBRY.border}`,
    backgroundColor: EMBRY.bgCard,
    color: EMBRY.dim,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  verdictBar: {
    padding: '10px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottom: `1px solid ${EMBRY.border}`,
  },
  verdict: { fontSize: 12, fontWeight: 900 },
  tabs: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderBottom: `1px solid ${EMBRY.border}` },
  tab: {
    minHeight: 44,
    border: 0,
    borderRight: `1px solid ${EMBRY.border}`,
    backgroundColor: 'transparent',
    color: EMBRY.dim,
    fontSize: 10,
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    cursor: 'pointer',
  },
  tabActive: { color: EMBRY.white, backgroundColor: EMBRY.bgCard },
  content: { flex: 1, overflow: 'auto', padding: 14 },
  stack: { display: 'flex', flexDirection: 'column', gap: 10 },
  sectionTitle: { fontSize: 10, color: EMBRY.dim, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' },
  timeline: { display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0 8px' },
  timelineRow: { display: 'grid', gridTemplateColumns: '12px 1fr', gap: 8, alignItems: 'start' },
  dot: { width: 8, height: 8, borderRadius: 8, marginTop: 4 },
  item: { border: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bgCard, borderRadius: 6, padding: 10 },
  itemHead: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 4 },
  rowTitle: { color: EMBRY.white, fontSize: 12, fontWeight: 800 },
  status: { color: EMBRY.dim, fontSize: 10, fontWeight: 900, textTransform: 'uppercase' },
  muted: { color: EMBRY.dim, fontSize: 11, lineHeight: 1.45 },
  body: { color: EMBRY.white, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  wrap: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  pre: {
    margin: 0,
    padding: 12,
    border: `1px solid ${EMBRY.border}`,
    borderRadius: 6,
    backgroundColor: EMBRY.bgCard,
    color: EMBRY.white,
    fontSize: 11,
    lineHeight: 1.45,
    overflow: 'auto',
  },
}

export default EvidenceWorkspace
