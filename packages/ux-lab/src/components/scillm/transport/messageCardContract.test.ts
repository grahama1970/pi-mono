import { describe, expect, it } from 'vitest'
import type { DisplayMessage } from './messageParse'
import { cardContractFor, shouldCollapseByDefault, summarizeMessage } from './messageCardContract'

function msg(partial: Partial<DisplayMessage> & Pick<DisplayMessage, 'kind' | 'id'>): DisplayMessage {
  return {
    collaborator: 'project_agent',
    speaker: 'Agent',
    chipLabel: 'Reviewer',
    title: 'Title',
    prose: '',
    artifacts: [],
    collapsed: false,
    metadata: {},
    raw: '',
    ...partial,
  }
}

describe('messageCardContract', () => {
  it('labels human input', () => {
    const c = cardContractFor(msg({ id: '1', kind: 'human', collaborator: 'human' }))
    expect(c.headerTitle).toBe('Human')
    expect(c.phaseLabel).toBe('Input')
  })

  it('collapses task cards by default', () => {
    expect(shouldCollapseByDefault(msg({ id: '2', kind: 'task_card', prose: 'x'.repeat(50) }))).toBe(true)
  })

  it('summarizes verdict lines', () => {
    const s = summarizeMessage(msg({ id: '3', kind: 'worker', prose: 'long', metadata: { verdict: 'PASS' } }))
    expect(s).toBe('VERDICT: PASS')
  })
})
