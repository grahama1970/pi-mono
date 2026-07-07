/**
 * Shared glance / triage layout primitives for page distance modes.
 */
import type { CSSProperties, ReactNode } from 'react'
import { useRegisterAction } from '../../../../hooks/useRegisterAction'
import { EMBRY } from '../../common/EmbryStyle'
import type { PageDistanceMode } from './PageDistanceMode'

const bandStyle: CSSProperties = {
  padding: '20px 24px',
  borderRadius: 12,
  border: `1px solid ${EMBRY.border}`,
  background: EMBRY.bgCard,
}

export function PageDistanceEyebrow({ mode, question }: { mode: PageDistanceMode; question: string }) {
  const label = mode === '10ft' ? 'Glance · 10ft' : mode === '5ft' ? 'Triage · 5ft' : 'Drilldown · lean-in'
  return (
    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: EMBRY.dim, marginBottom: 8 }}>
      {label} · {question}
    </div>
  )
}

export function PageGlanceBand({
  mode,
  question,
  headline,
  lead,
  tone = EMBRY.white,
  qid,
  children,
}: {
  mode: PageDistanceMode
  question: string
  headline: string
  lead?: string
  tone?: string
  qid: string
  children?: ReactNode
}) {
  return (
    <section data-qid={qid} style={{ ...bandStyle, borderColor: `${tone}44` }}>
      <PageDistanceEyebrow mode={mode} question={question} />
      <strong style={{ display: 'block', fontSize: 28, lineHeight: 1.1, color: tone, marginBottom: lead ? 10 : 0 }}>{headline}</strong>
      {lead ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: EMBRY.dim }}>{lead}</p> : null}
      {children}
    </section>
  )
}

export function PageMetricGrid({ children, qid }: { children: ReactNode; qid?: string }) {
  return (
    <div
      data-qid={qid}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 12,
        marginTop: 16,
      }}
    >
      {children}
    </div>
  )
}

export function PageMetricCard({ label, value, tone = EMBRY.white, qid }: { label: string; value: string | number; tone?: string; qid?: string }) {
  return (
    <div data-qid={qid} style={{ ...bandStyle, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: EMBRY.dim, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: tone }}>{value}</div>
    </div>
  )
}

export function PageTriageList({
  qid,
  title,
  items,
  emptyLabel = 'No items in queue',
}: {
  qid: string
  title: string
  items: Array<{ id: string; primary: string; secondary?: string; tone?: string; onSelect?: () => void }>
  emptyLabel?: string
}) {
  return (
    <section data-qid={qid} style={bandStyle}>
      <div style={{ fontSize: 13, fontWeight: 800, color: EMBRY.white, marginBottom: 12 }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: EMBRY.dim }}>{emptyLabel}</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((item) => (
            <PageTriageListItem
              key={item.id}
              qid={`${qid}:item:${item.id}`}
              item={item}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function PageTriageListItem({
  qid,
  item,
}: {
  qid: string
  item: { id: string; primary: string; secondary?: string; tone?: string; onSelect?: () => void }
}) {
  useRegisterAction(qid, {
    app: 'sparta-explorer',
    action: 'PAGE_TRIAGE_SELECT_ITEM',
    label: 'Select triage item',
    description: 'Select a visible 5ft page-distance triage queue item',
  })

  return (
    <button
      type="button"
      data-qid={qid}
      data-qs-action="PAGE_TRIAGE_SELECT_ITEM"
      title={`Open triage item: ${item.primary}`}
      onClick={item.onSelect}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 8,
        textAlign: 'left',
        padding: '12px 14px',
        minHeight: 44,
        borderRadius: 8,
        border: `1px solid ${EMBRY.border}`,
        background: EMBRY.bgDeep,
        color: EMBRY.white,
        cursor: item.onSelect ? 'pointer' : 'default',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, color: item.tone ?? EMBRY.white }}>{item.primary}</span>
      {item.secondary ? <span style={{ fontSize: 11, color: EMBRY.dim, gridColumn: '1 / -1' }}>{item.secondary}</span> : null}
    </button>
  )
}

export function PageDistanceScroll({ children, qid }: { children: ReactNode; qid: string }) {
  return (
    <div data-qid={qid} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16, display: 'grid', gap: 16, alignContent: 'start' }}>
      {children}
    </div>
  )
}
