import type { DisplayMessage } from './messageParse'

export type TimelineSegment =
  | { type: 'message'; message: DisplayMessage; index: number }
  | {
      type: 'nested'
      nestId: string
      anchorId: string
      messages: Array<{ message: DisplayMessage; index: number }>
    }

/**
 * After spawn (agent_card), nest task + worker messages until the next non-nest segment.
 * Spawn is not emitted standalone — merged in nested block UI.
 */
export function buildTimelineSegments(messages: DisplayMessage[]): TimelineSegment[] {
  const out: TimelineSegment[] = []
  let nestBuffer: Array<{ message: DisplayMessage; index: number }> = []
  let nestId = ''
  let inNest = false

  const flushNest = () => {
    if (!nestBuffer.length) {
      inNest = false
      return
    }
    out.push({
      type: 'nested',
      nestId,
      anchorId: 'phase-worker',
      messages: nestBuffer,
    })
    nestBuffer = []
    inNest = false
  }

  messages.forEach((message, index) => {
    if (message.kind === 'agent_card') {
      flushNest()
      inNest = true
      nestId = `nest-${message.id}`
      nestBuffer = [{ message, index }]
      return
    }
    if (inNest && (message.kind === 'worker' || message.kind === 'task_card')) {
      nestBuffer.push({ message, index })
      return
    }
    if (inNest) flushNest()
    out.push({ type: 'message', message, index })
  })
  flushNest()
  return out
}
