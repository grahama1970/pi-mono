import { RunButton } from './RunButton'

/** RerunButton — wraps RunButton for re-execution actions in Classifier Lab. */
export function RerunButton({ projectId, disabled, onRerun, rerunOverrides }: {
  projectId?: string
  disabled?: boolean
  onRerun?: () => void
  rerunOverrides?: Record<string, unknown>
}) {
  return (
    <RunButton onClick={() => onRerun?.()} disabled={disabled || !projectId} ariaLabel="Re-run">
      RE-RUN
    </RunButton>
  )
}
