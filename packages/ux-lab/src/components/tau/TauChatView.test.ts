import { describe, expect, it } from 'vitest'
import { collectMemoryTurn } from '../shared-chat/memory-turn'
import { TauReceiptAdapter, stageTraceFromStreamingSteps } from './TauChatView'

type MemoryCall = {
  path: string
  body: Record<string, unknown>
}

function makeAdapter(intent: Record<string, unknown>, products: Record<string, unknown> = {}) {
  const calls: MemoryCall[] = []
  const adapter = new TauReceiptAdapter(async (path, body) => {
    calls.push({ path, body })
    if (path === '/intent') return intent
    if (path in products) return products[path]
    throw new Error(`unexpected memory path ${path}`)
  })
  return { adapter, calls }
}

describe('TauReceiptAdapter Memory routing', () => {
  it('routes CLARIFY through /clarify and preserves a clarification trace', async () => {
    const { adapter, calls } = makeAdapter(
      { action: 'CLARIFY', confidence: 0.61, entities: [], frameworks: [] },
      { '/clarify': { schema: 'memory.clarify.v1', needs_clarification: true, questions: ['Which system?'] } },
    )

    const { message, steps } = await collectMemoryTurn(adapter.sendTurn({ text: 'secure it' }))

    expect(calls.map((call) => call.path)).toEqual(['/intent', '/clarify'])
    expect(steps.some((step) => step.id === 'clarifying' && step.status === 'completed')).toBe(true)
    expect(message.content).toContain('Tau routed this turn to Memory clarify.')
    expect(message.content).toContain('| Current receipt stage | Clarifying... (PASS) |')
    expect(message.content).toContain('| next agent | human |')
    expect(message.metadata?.memoryBacked).toBe(true)
    expect(message.metadata?.tauCurrentStage).toMatchObject({
      schema: 'tau.loop2_pipeline_stage.v1',
      stage: 'clarify',
      label: 'Clarifying...',
      status: 'PASS',
      source: 'clarifying',
    })
    expect(message.metadata?.tauStageTrace).toMatchObject([
      { stage: 'intent', status: 'RUNNING' },
      { stage: 'intent', status: 'PASS' },
      { stage: 'extract_entities', status: 'PASS' },
      { stage: 'clarify', status: 'RUNNING' },
      { stage: 'clarify', status: 'PASS' },
    ])
    expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({ ok: true, nextAgent: 'human' })
  })

  it('routes DEFLECT and NO_MATCH through /deflect instead of recall', async () => {
    const { adapter, calls } = makeAdapter(
      { action: 'NO_MATCH', confidence: 0.72, entities: [], frameworks: [] },
      { '/deflect': { schema: 'memory.deflect.v1', should_deflect: true, deflection_type: 'no_match' } },
    )

    const { message, steps } = await collectMemoryTurn(adapter.sendTurn({ text: 'what is the weather?' }))

    expect(calls.map((call) => call.path)).toEqual(['/intent', '/deflect'])
    expect(calls.some((call) => call.path === '/recall')).toBe(false)
    expect(steps.some((step) => step.id === 'checking-gates' && step.status === 'completed')).toBe(true)
    expect(message.content).toContain('Tau routed this turn to Memory deflect.')
    expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({ ok: true, nextAgent: 'human' })
  })

  it('routes ANSWER through /answer and records answer product metadata', async () => {
    const { adapter, calls } = makeAdapter(
      { action: 'ANSWER', confidence: 0.84, entities: ['Tau'], frameworks: [], recall_profile: 'procedural_memory' },
      { '/answer': { schema: 'memory.answer.v1', can_answer: true, confidence: 0.84, final_response: 'Tau uses Memory first.' } },
    )

    const { message, steps } = await collectMemoryTurn(adapter.sendTurn({ text: 'What did we decide about Tau memory?' }))

    expect(calls.map((call) => call.path)).toEqual(['/intent', '/answer'])
    expect(steps.some((step) => step.id === 'answering' && step.status === 'completed')).toBe(true)
    expect(message.content).toContain('Tau routed this turn to Memory answer.')
    expect(message.content).toContain('| can answer | true |')
    expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({ ok: true, nextAgent: 'reviewer' })
  })

  it('routes RESEARCH fail-closed without claiming Brave Search ran', async () => {
    const { adapter, calls } = makeAdapter({
      action: 'RESEARCH',
      confidence: 0.77,
      entities: ['latest Chutes pricing'],
      frameworks: [],
    })

    const { message, steps } = await collectMemoryTurn(adapter.sendTurn({ text: 'search the web for latest Chutes pricing' }))

    expect(calls.map((call) => call.path)).toEqual(['/intent'])
    expect(calls.some((call) => call.path === '/recall')).toBe(false)
    expect(calls.some((call) => call.path === '/answer')).toBe(false)
    expect(steps.some((step) => step.id === 'getting-results' && step.status === 'skipped')).toBe(true)
    expect(message.content).toContain('Tau identified a research route and stopped before unsupported web claims.')
    expect(message.content).toContain('Memory product: not called in this slice.')
    expect(message.content).toContain('| next agent | research-auditor |')
    expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({ ok: true, nextAgent: 'research-auditor' })
  })

  it('routes COMPLIANCE through /recall and marks evidence synthesis as not executed in this slice', async () => {
    const { adapter, calls } = makeAdapter(
      {
        action: 'COMPLIANCE',
        confidence: 0.95,
        response_mode: 'evidence_case',
        entities: ['CWE-287'],
        frameworks: ['CWE'],
        recall_profile: 'exact_control_lookup',
        k: 12,
      },
      { '/recall': { found: true, confidence: 12.4, items: [{ _key: 'ctrl__CWE-287' }] } },
    )

    const { message, steps } = await collectMemoryTurn(adapter.sendTurn({ text: 'How does Tau handle a CWE-287 SPARTA evidence case?' }))

    expect(calls.map((call) => call.path)).toEqual(['/intent', '/recall'])
    expect(calls[1].body).toMatchObject({
      k: 12,
      collections: ['sparta_controls', 'sparta_relationships', 'technique_knowledge'],
    })
    expect(steps.some((step) => step.id === 'checking-gates' && step.status === 'skipped')).toBe(true)
    expect(message.metadata?.branch).toBe('evidence-case')
    expect(message.content).toContain('| found | true |')
    expect(message.content).toContain('| schema | tau.agent_handoff.v1 |')
    expect(message.content).toContain('| labels add | agent-work, next:reviewer, executor:either |')
    expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({ ok: true, nextAgent: 'reviewer' })
    expect(message.metadata?.tauAgentHandoffGithubProjection).toMatchObject({
      ok: true,
      nextAgent: 'reviewer',
      labels: { add: ['agent-work', 'next:reviewer', 'executor:either'] },
    })
  })

  it('converts streaming steps into Tau pipeline stage receipt metadata', () => {
    const trace = stageTraceFromStreamingSteps([
      {
        id: 'extracting-entities',
        branch: 'compliance',
        status: 'completed',
        label: 'Extracting Entities',
        liveStatusLabel: 'Extracting Entities...',
      },
      {
        id: 'getting-results',
        branch: 'compliance',
        status: 'skipped',
        label: 'Searching Web',
        liveStatusLabel: 'Searching Web...',
      },
    ])

    expect(trace).toEqual([
      {
        schema: 'tau.loop2_pipeline_stage.v1',
        stage: 'extract_entities',
        label: 'Extracting Entities...',
        status: 'PASS',
        source: 'extracting-entities',
      },
      {
        schema: 'tau.loop2_pipeline_stage.v1',
        stage: 'brave_search',
        label: 'Searching Web...',
        status: 'SKIPPED',
        source: 'getting-results',
      },
    ])
  })
})
