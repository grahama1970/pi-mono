import { describe, expect, it } from 'vitest'
import { actorDisplayForMessage, workerPersonaName } from './transportActorDisplay'
import { cardContractFor } from './messageCardContract'
import type { DisplayMessage } from './messageParse'

describe('transportActorDisplay', () => {
  it('names code-reviewer with search-code persona slug', () => {
    const message: DisplayMessage = {
      id: '1',
      kind: 'task_card',
      collaborator: 'worker',
      speaker: 'Code reviewer',
      chipLabel: 'Code reviewer',
      title: 'Code reviewer · code-reviewer',
      prose: 'dispatch',
      artifacts: [],
      collapsed: false,
      metadata: {
        sessions: [],
        urls: [],
        agentId: 'code-reviewer',
        subagentPersona: 'Code reviewer',
        subagentRoleSlug: 'reviewer',
      },
      raw: '',
    }
    const contract = cardContractFor(message)
    const actor = actorDisplayForMessage(message, contract)
    expect(actor.actorName).toBe('Code reviewer')
    expect(actor.agentId).toBe('code-reviewer')
    expect(actor.phaseLabel).toBe('Task')
    expect(actor.actionLine).toContain('Code reviewer')
    expect(actor.personaSlug).toBe('code_reviewer')
  })

  it('project agent spawn uses Route planner visual', () => {
    const message: DisplayMessage = {
      id: '2',
      kind: 'agent_card',
      collaborator: 'project_agent',
      speaker: 'Project agent',
      chipLabel: 'Code reviewer',
      title: 'Spawned subagent: Code reviewer',
      prose: '',
      artifacts: [],
      collapsed: false,
      metadata: {
        sessions: [],
        urls: [],
        subagentPersona: 'Code reviewer',
        agentId: 'code-reviewer',
      },
      raw: '',
    }
    const actor = actorDisplayForMessage(message, cardContractFor(message))
    expect(actor.actorName).toBe('Project agent')
    expect(actor.visual.key).toBe('planner')
    expect(actor.actionLine).toContain('spawned')
  })
})
