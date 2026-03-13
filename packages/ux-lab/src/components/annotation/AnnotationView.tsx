import { useShallow } from 'zustand/react/shallow'
import { NVIS } from '../../theme'
import { useAnnotationStore } from '../../store/annotationStore'
import { TokenAnnotation } from './TokenAnnotation'
import { LabelBar } from './LabelBar'
import { DecisionButtons } from './DecisionButtons'
import type { SpartaContext as SpartaContextType, CitationSource } from '../../types'

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    overflow: 'hidden',
    backgroundColor: NVIS.BG_PRIMARY,
  },
  progressContainer: {
    padding: '8px 16px',
    backgroundColor: NVIS.BG_SECONDARY,
    borderBottom: `1px solid ${NVIS.DIM}`,
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: NVIS.BG_TERTIARY,
    overflow: 'hidden' as const,
    display: 'flex',
  },
  progressText: {
    fontSize: 11,
    color: NVIS.DIM,
    marginBottom: 4,
    display: 'flex',
    justifyContent: 'space-between',
  },
  mainArea: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  contentArea: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    overflow: 'auto',
  },
  sidebar: {
    width: 260,
    backgroundColor: NVIS.BG_SECONDARY,
    borderLeft: `1px solid ${NVIS.DIM}`,
    overflow: 'auto',
    flexShrink: 0,
  },
  panelHeader: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: NVIS.DIM,
    padding: '12px 16px 8px',
    textTransform: 'uppercase' as const,
  },
  panelField: {
    padding: '4px 16px',
    fontSize: 12,
    color: NVIS.WHITE,
    display: 'flex',
    justifyContent: 'space-between',
  },
  badge: {
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 3,
    fontWeight: 600,
  },
  controlChip: {
    display: 'inline-block',
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 3,
    border: `1px solid ${NVIS.GREEN}`,
    color: NVIS.GREEN,
    marginRight: 4,
    marginBottom: 4,
  },
  confidenceBar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: NVIS.BG_TERTIARY,
    marginTop: 4,
    overflow: 'hidden' as const,
  },
  emptyState: {
    color: NVIS.DIM,
    fontSize: 12,
    textAlign: 'center' as const,
    padding: 32,
  },
  divider: {
    borderTop: `1px solid ${NVIS.DIM}`,
    margin: '8px 0',
  },
}

function ProgressBar() {
  const items = useAnnotationStore(useShallow((s) => s.items))
  const currentIndex = useAnnotationStore((s) => s.currentIndex)
  const total = items.length
  const accepted = items.filter((i) => i.status === 'accepted').length
  const rejected = items.filter((i) => i.status === 'rejected').length
  const skipped = items.filter((i) => i.status === 'skipped').length
  const completed = accepted + rejected + skipped

  if (total === 0) return null

  return (
    <div data-testid="progress-bar" style={styles.progressContainer}>
      <div style={styles.progressText}>
        <span>{completed} / {total} completed</span>
        <span>Item {currentIndex + 1} of {total}</span>
      </div>
      <div style={styles.progressBarTrack}>
        {accepted > 0 && (
          <div style={{ width: `${(accepted / total) * 100}%`, backgroundColor: NVIS.GREEN, height: '100%' }} />
        )}
        {rejected > 0 && (
          <div style={{ width: `${(rejected / total) * 100}%`, backgroundColor: NVIS.RED, height: '100%' }} />
        )}
        {skipped > 0 && (
          <div style={{ width: `${(skipped / total) * 100}%`, backgroundColor: NVIS.AMBER, height: '100%' }} />
        )}
      </div>
    </div>
  )
}

function SpartaContextPanel({ context }: { context: SpartaContextType }) {
  return (
    <div data-testid="sparta-context">
      <div style={styles.panelHeader}>SPARTA Context</div>
      <div style={styles.panelField}>
        <span style={{ color: NVIS.DIM }}>Tactic</span>
        <span style={{ ...styles.badge, backgroundColor: `${NVIS.AMBER}33`, color: NVIS.AMBER }}>
          {context.tactic}
        </span>
      </div>
      <div style={styles.panelField}>
        <span style={{ color: NVIS.DIM }}>Technique</span>
        <span style={{ ...styles.badge, backgroundColor: `${NVIS.BLUE}33`, color: NVIS.BLUE }}>
          {context.technique}
        </span>
      </div>
      <div style={styles.panelField}>
        <span style={{ color: NVIS.DIM }}>Controls</span>
        <span style={{ ...styles.badge, backgroundColor: `${NVIS.GREEN}33`, color: NVIS.GREEN }}>
          {context.controlsCategory}
        </span>
      </div>
      <div style={{ padding: '8px 16px' }}>
        <div style={{ color: NVIS.DIM, fontSize: 10, marginBottom: 4 }}>Related Controls</div>
        {context.relatedControls.map((ctrl) => (
          <span key={ctrl} style={styles.controlChip}>{ctrl}</span>
        ))}
      </div>
    </div>
  )
}

function CitationPanel({ citation }: { citation: CitationSource }) {
  const confidenceColor =
    citation.confidence > 0.8 ? NVIS.GREEN :
    citation.confidence > 0.5 ? NVIS.AMBER : NVIS.RED

  return (
    <div data-testid="citation-panel">
      <div style={styles.panelHeader}>Source</div>
      <div style={styles.panelField}>
        <span style={{ color: NVIS.DIM }}>Collection</span>
        <span>{citation.collection}</span>
      </div>
      <div style={styles.panelField}>
        <span style={{ color: NVIS.DIM }}>Doc ID</span>
        <span>{citation.documentId}</span>
      </div>
      <div style={styles.panelField}>
        <span style={{ color: NVIS.DIM }}>Page</span>
        <span>{citation.pageNumber}</span>
      </div>
      <div style={styles.panelField}>
        <span style={{ color: NVIS.DIM }}>Confidence</span>
        <span style={{ color: confidenceColor }}>{Math.round(citation.confidence * 100)}%</span>
      </div>
      <div style={{ padding: '0 16px 12px' }}>
        <div style={styles.confidenceBar}>
          <div style={{
            width: `${citation.confidence * 100}%`,
            height: '100%',
            backgroundColor: confidenceColor,
            borderRadius: 2,
          }} />
        </div>
      </div>
    </div>
  )
}

export function AnnotationView() {
  const items = useAnnotationStore(useShallow((s) => s.items))
  const currentIndex = useAnnotationStore((s) => s.currentIndex)
  const currentItem = items[currentIndex] ?? null

  if (items.length === 0) {
    return (
      <div data-testid="annotation-view" style={styles.container}>
        <div style={styles.emptyState}>
          No annotation items loaded.<br />
          Use <code>/extract-entities</code> to generate items, then load via the API.
        </div>
      </div>
    )
  }

  return (
    <div data-testid="annotation-view" style={styles.container}>
      <ProgressBar />
      <LabelBar />
      <div style={styles.mainArea}>
        <div style={styles.contentArea}>
          {currentItem && <TokenAnnotation item={currentItem} />}
        </div>
        <div style={styles.sidebar}>
          {currentItem ? (
            <>
              <SpartaContextPanel context={currentItem.spartaContext} />
              <div style={styles.divider} />
              <CitationPanel citation={currentItem.citation} />
            </>
          ) : (
            <div style={styles.emptyState}>No SPARTA context</div>
          )}
        </div>
      </div>
      <DecisionButtons />
    </div>
  )
}
