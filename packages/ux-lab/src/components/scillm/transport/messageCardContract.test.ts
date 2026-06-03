import { describe, expect, it } from 'vitest'
import type { DisplayMessage } from './messageParse'
import { cardContractFor, shouldCollapseByDefault, summarizeMessage } from './messageCardContract'

function msg(partial: Partial<DisplayMessage> & Pick<DisplayMessage, 'kind' | 'id'>): DisplayMessage {
  return {
    collaborator: 'project_agent',
    speaker: 'Project agent',
    chipLabel: 'Project agent',
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
    expect(c.roleClass).toBe('human')
  })

  it('spawn card uses planner icon and spawn header from title', () => {
    const c = cardContractFor(
      msg({
        id: '2',
        kind: 'agent_card',
        title: 'Spawned subagent: Reviewer → scillm-worker (attempt 1)',
      }),
    )
    expect(c.icon).toBe('plan')
    expect(c.roleClass).toBe('planner')
    expect(c.headerTitle).toContain('Spawned subagent')
  })

  it('collapses task cards by default', () => {
    expect(shouldCollapseByDefault(msg({ id: '3', kind: 'task_card', prose: 'x'.repeat(50) }))).toBe(true)
  })

  it('summarizes verdict lines', () => {
    const s = summarizeMessage(msg({ id: '4', kind: 'worker', prose: 'long', metadata: { verdict: 'PASS' } }))
    expect(s).toBe('VERDICT: PASS')
  })
})
