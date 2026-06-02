import type { DisplayMessage, DisplayMessageKind } from './messageParse'

/** Dialogue = conversation only; Handoffs = + spawn cards; Full = all infrastructure */
export type StreamViewPreset = 'dialogue' | 'handoffs' | 'full'

const DIALOGUE_KINDS: DisplayMessageKind[] = ['human', 'reviewer', 'worker', 'task_card']

export function messageVisibleInPreset(kind: DisplayMessageKind, preset: StreamViewPreset): boolean {
  if (preset === 'full') return true
  if (preset === 'handoffs') return kind !== 'system' && kind !== 'transport_start'
  return DIALOGUE_KINDS.includes(kind)
}

export function filterDisplayMessages(
  messages: DisplayMessage[],
  preset: StreamViewPreset,
): DisplayMessage[] {
  return messages.filter((m) => messageVisibleInPreset(m.kind, preset))
}
