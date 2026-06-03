import type { CSSProperties, ReactNode } from 'react'
import type { DisplayMessage } from './messageParse'

export function CallInspectFooter({
  onSelectCall,
  selected,
}: {
  onSelectCall?: () => void
  selected?: boolean
}) {
  if (!onSelectCall) return null
  return (
    <button
      type="button"
      className={`tr-btn tr-btn--ghost tr-btn--compact${selected ? ' tr-btn--selected' : ''}`}
      data-qid="transport:thread:inspect"
      data-qs-action="TRANSPORT_THREAD_INSPECT_CALL"
      title="Inspect this worker call in the call inspector"
      onClick={(event) => {
        event.stopPropagation()
        onSelectCall()
      }}
    >
      {selected ? 'Selected in inspector' : 'Inspect call'}
    </button>
  )
}

export function SelectableThreadCard({
  selected,
  className,
  style,
  dataQid,
  onSelectCall,
  children,
}: {
  selected?: boolean
  className?: string
  style?: CSSProperties
  dataQid?: string
  onSelectCall?: () => void
  children: ReactNode
}) {
  const selectable = Boolean(onSelectCall)
  return (
    <div
      className={`${className ?? ''}${selected ? ' tr-thread-card--selected' : ''}${selectable ? ' tr-thread-card--selectable' : ''}`}
      style={style}
      data-qid={dataQid}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      onClick={selectable ? onSelectCall : undefined}
      onKeyDown={
        selectable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelectCall?.()
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}

export function isThreadMessageSelected(
  message: DisplayMessage,
  selectedCallId: string | null | undefined,
  selectedMessageId: string | null | undefined,
): boolean {
  if (!selectedCallId || message.metadata.subagentRunId !== selectedCallId) return false
  if (!selectedMessageId) return true
  return selectedMessageId === message.id
}
