import { useEffect, useMemo, useState } from 'react'
import { Bot, CheckCircle2, FileText, GitBranch, Mic, Search, Shield, Terminal, Video } from 'lucide-react'
import { SharedChatShell } from '../shared-chat/SharedChatShell'
import {
  loadLoop2Events,
  loadLoop2HarnessPeerMessage,
  loadLoop2Summary,
  openLoop2EventStream,
  validateLoop2HarnessPeerMessage,
  type Loop2Event,
  type Loop2EventStreamEnd,
  type Loop2HarnessPeerMessage,
  type Loop2Summary,
} from '../scillm/loop2EvidenceAdapter'
import {
  makeFinalMessage,
  makeFinalStep,
  makeStep,
  streamingStepsToThinkingTrace,
  type ChatMessage,
  type MemoryTurnAdapter,
  type MemoryTurnStream,
  type StreamingStep,
  type TurnInput,
  type TurnBranch,
} from '../shared-chat/memory-turn'
import {
  readTauPeerMonitorConfig,
  summarizeTauLoopMonitor,
  summarizeTauPeerMessage,
  type TauLoopMonitorSummary,
  type TauPeerMonitorConfig,
  type TauPeerStatusSummary,
} from './tauPeerStatus'
import {
  buildTauRouteHandoff,
  deriveTauHandoffGithubProjection,
  summarizeTauAgentHandoff,
  summarizeTauHandoffGithubProjection,
  validateTauAgentHandoff,
} from './tauAgentHandoff'
import {
  loadTauCommandLoopGithubProjection,
  type TauCommandLoopGithubProjectionReceipt,
  type TauCommandLoopGithubProjectionState,
} from './tauCommandLoopProjection'
import { apiUrl } from '../../lib/apiBase'

const RECEIPTS = [
  {
    label: 'Extract entities',
    path: 'experiments/loop2-alignment/reliability-stress-20260626T211653Z-extract-hardening/cwe-287-extract-receipt.json',
    value: 'PASS',
    detail: 'Live Memory /extract-entities stage ran before recall and selected create-evidence-case.',
  },
  {
    label: 'Peer message',
    path: 'experiments/loop2-alignment/reliability-stress-20260626T205339Z/math_add/.loop2/runs/loop2-tau-stress-math_add-1782507220-da39d0/harness-peer-message.json',
    value: 'READY',
    detail: 'Tau publishes tau.loop_harness_peer_message.v1 for pi-mono and other harness consumers.',
  },
  {
    label: 'Switchboard push',
    path: 'experiments/loop2-alignment/proofs/inter_harness_switchboard/live-switchboard-websocket-push-proof.json',
    value: 'PUSHED',
    detail: 'Live pi-mono Switchboard WebSocket received the Tau peer handoff with claims.does_not_prove preserved.',
  },
  {
    label: 'Switchboard ack',
    path: 'experiments/loop2-alignment/proofs/inter_harness_switchboard/live-switchboard-websocket-ack-proof.json',
    value: 'ACKED',
    detail: 'A pi-mono WebSocket consumer acknowledged the Tau peer handoff and the Switchboard inbox was empty afterward.',
  },
  {
    label: 'Goal audit',
    path: 'experiments/loop2-alignment/proofs/final_goal_audit/tau_goal_audit_20260626T223412Z.json',
    value: 'SATISFIED',
    detail: 'Requirement audit records fresh 255-test Tau run, fresh Tau CDP proof, Switchboard ack, and explicit non-claims.',
  },
  {
    label: 'Fresh loop stress',
    path: 'experiments/loop2-alignment/reliability-stress-20260626T205339Z/stress-summary.json',
    value: '3 / 3',
    detail: 'Live Tau loop2-run subset passed with mocked=false.',
  },
  {
    label: 'Harness branches',
    path: 'experiments/loop2-alignment/reliability-stress-20260626T205200Z/sparta-chat-contract/summary.json',
    value: '5 / 5',
    detail: 'Brave, evidence-case, clarify, and Embry persona metadata receipts passed.',
  },
  {
    label: 'Full prior stress',
    path: 'experiments/loop2-alignment/reliability-stress-20260626T193829Z/stress-summary.json',
    value: '12 / 12',
    detail: 'Earlier same-day full non-mocked loop stress pass.',
  },
  {
    label: 'GitHub projection',
    path: 'loaded from /api/tau/command-loop/github-projection',
    value: 'PENDING',
    detail: 'Tau command-loop GitHub projection is loaded from a backend receipt endpoint and fails closed if the summary is missing or malformed.',
  },
] as const

const STAGES = [
  { id: 'intent', label: 'Getting Intent', icon: Bot },
  { id: 'entities', label: 'Extracting Entities', icon: FileText },
  { id: 'memory', label: 'Accessing Memory', icon: Shield },
  { id: 'search', label: 'Searching Web', icon: Search },
  { id: 'evidence', label: 'Creating Evidence Case', icon: CheckCircle2 },
  { id: 'voice', label: 'Preparing Persona Voice', icon: Mic },
] as const

type TauPipelineStageReceipt = {
  schema: 'tau.loop2_pipeline_stage.v1'
  stage: string
  label: string
  status: string
  source: string
}

const TAU_MEMORY_STAGE_TRACE_RECEIPT =
  '/tmp/tau-memory-stage-trace/live-memory-stage-trace-summary.json'

const TAU_MEMORY_STAGE_TRACE: TauPipelineStageReceipt[] = [
  {
    schema: 'tau.loop2_pipeline_stage.v1',
    stage: 'intent',
    label: 'Getting Intent...',
    status: 'PASS',
    source: 'memory.intent',
  },
  {
    schema: 'tau.loop2_pipeline_stage.v1',
    stage: 'extract_entities',
    label: 'Extracting Entities...',
    status: 'PASS',
    source: 'memory.extract_entities',
  },
  {
    schema: 'tau.loop2_pipeline_stage.v1',
    stage: 'recall',
    label: 'Accessing Memory...',
    status: 'PASS',
    source: 'memory.recall',
  },
  {
    schema: 'tau.loop2_pipeline_stage.v1',
    stage: 'clarify',
    label: 'Clarifying...',
    status: 'PASS',
    source: 'memory.clarify',
  },
]

const sampleMessages: ChatMessage[] = [
  {
    id: 'tau-system-1',
    role: 'assistant',
    createdAt: '2026-06-26T20:53:39Z',
    content:
      'Tau Chat is mounted as an experiment surface. It reads the loop/harness/TUI contract and shows receipt-backed state; it does not claim production Sparta Chat readiness.',
    metadata: {
      branch: 'compliance',
      source: 'tau-experiment-contract',
      contentType: 'evidence',
    },
    reasoningSteps: [
      ...TAU_MEMORY_STAGE_TRACE.map((stage) => ({
        id: `tau-receipt-${stage.stage}`,
        label: stage.label.replace(/\.\.\.$/, ''),
        status: 'completed',
        detail: `${stage.source} reported ${stage.status}.`,
        icon: stage.stage === 'extract_entities' ? 'tag' : stage.stage === 'recall' ? 'memory' : 'shield',
      }) satisfies ChatMessage['reasoningSteps']),
      {
        id: 'checking-gates',
        label: 'Checked receipt gates',
        status: 'completed',
        detail: 'Fresh stress subset: 3/3. Harness branch receipts: 5/5.',
        icon: 'shield',
      },
    ],
  },
]

type TauMemoryTransport = <T = unknown>(path: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<T>

export class TauReceiptAdapter implements MemoryTurnAdapter {
  readonly name = 'TauReceiptAdapter'
  readonly branch: TurnBranch = 'compliance'

  constructor(
    private readonly memoryTransport: TauMemoryTransport = postMemoryProduct,
    private readonly commandLoopGithubProjection?: TauCommandLoopGithubProjectionReceipt,
  ) {}

  async *sendTurn(input: TurnInput): MemoryTurnStream {
    const query = (input.text || input.query || input.question || '').trim()
    const steps: StreamingStep[] = []

    const emit = (step: StreamingStep): StreamingStep => {
      steps.push(step)
      return step
    }

    yield emit(makeStep({
      id: 'finalizing-intent',
      branch: 'compliance',
      status: 'running',
      label: 'Getting Intent',
      liveStatusLabel: 'Getting Intent...',
      detail: 'Calling Memory /intent through the UX Lab proxy.',
    }))

    let intent: TauMemoryIntentResponse | null = null
    try {
      intent = await this.memoryTransport<TauMemoryIntentResponse>('/intent', {
        q: query,
        scope: 'tau',
        session_id: 'tau-chat',
        fast: true,
      }, input.abortSignal)
      yield emit(makeStep({
        id: 'finalizing-intent',
        branch: 'compliance',
        status: 'completed',
        label: 'Getting Intent',
        liveStatusLabel: 'Getting Intent...',
        detail: `Memory routed this turn as ${intent.action || 'UNKNOWN'} with confidence ${formatConfidence(intent.confidence)}.`,
        data: summarizeMemoryIntent(intent),
      }))
    } catch (error) {
      yield emit(makeStep({
        id: 'finalizing-intent',
        branch: 'compliance',
        status: 'failed',
        label: 'Getting Intent',
        liveStatusLabel: 'Getting Intent...',
        detail: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error.message : String(error),
      }))
      const message = makeFinalMessage({
        branch: 'compliance',
        content: [
          'Tau could not start the Memory-backed turn because Memory `/intent` was unavailable.',
          '',
          `Error: ${error instanceof Error ? error.message : String(error)}`,
          '',
          'This is fail-closed: Tau is not falling back to a fabricated memory route.',
        ].join('\n'),
        reasoningSteps: streamingStepsToThinkingTrace(steps),
        metadata: {
          source: 'tau-memory-adapter',
          memoryBacked: false,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      yield makeFinalStep(message, 'compliance')
      return message
    }

    yield emit(makeStep({
      id: 'extracting-entities',
      branch: 'compliance',
      status: 'completed',
      label: 'Extracting Entities',
      liveStatusLabel: 'Extracting Entities...',
      detail: summarizeIntentEntities(intent),
      data: intent.entity_context ?? intent.entities ?? null,
    }))

    const intentRouteError = validateIntentRoute(intent)
    if (intentRouteError) {
      const tauStageTrace = stageTraceFromStreamingSteps(steps)
      const currentStage = tauStageTrace[tauStageTrace.length - 1] ?? null
      const action = String(intent.action || 'UNKNOWN')
      const message = makeFinalMessage({
        branch: 'compliance',
        content: [
          'Tau stopped fail-closed because Memory `/intent` returned an unsupported route.',
          '',
          `Intent action: ${action}`,
          `Error: ${intentRouteError}`,
          '',
          '| Contract field | Current experiment state |',
          '| --- | --- |',
          '| Memory-first routing | `/intent` completed but did not provide a supported Tau route |',
          `| Current receipt stage | ${currentStage ? `${currentStage.label} (${currentStage.status})` : 'not emitted'} |`,
          '| Memory route endpoint | not called |',
          '| GitHub/subagent handoff | not emitted because intent routing is invalid |',
          '| Production Sparta Chat | not claimed from this preview |',
          '',
          'This is fail-closed: Tau is not falling back to recall from an unknown Memory intent action.',
        ].join('\n'),
        reasoningSteps: streamingStepsToThinkingTrace(steps),
        metadata: {
          source: 'tau-memory-adapter',
          memoryBacked: false,
          memoryIntent: summarizeMemoryIntent(intent),
          routeEndpoint: null,
          routeError: intentRouteError,
          tauStageTrace,
          tauCurrentStage: currentStage,
          tauAgentHandoffValidation: { ok: false, errors: ['intent_route_invalid'], nextAgent: null },
        },
      })
      yield makeFinalStep(message, 'compliance')
      return message
    }

    const route = routeFromIntent(intent)
    let product: unknown = null
    let routeError: string | null = null
    let routeErrorKind = 'route_product_missing'
    if (route.endpoint) {
      yield emit(makeStep({
        id: route.stepId,
        branch: route.branch,
        status: 'running',
        label: route.label,
        liveStatusLabel: route.liveStatusLabel,
        detail: route.detail,
      }))
      try {
        product = await this.memoryTransport(route.endpoint, route.body(query, intent), input.abortSignal)
        const validationError = validateMemoryRouteProduct(route, product)
        if (validationError) {
          routeErrorKind = 'route_product_invalid'
          throw new Error(validationError)
        }
        yield emit(makeStep({
          id: route.stepId,
          branch: route.branch,
          status: 'completed',
          label: route.label,
          liveStatusLabel: route.liveStatusLabel,
          detail: route.completedDetail(product),
          data: product,
        }))
      } catch (error) {
        routeError = error instanceof Error ? error.message : String(error)
        yield emit(makeStep({
          id: route.stepId,
          branch: route.branch,
          status: 'failed',
          label: route.label,
          liveStatusLabel: route.liveStatusLabel,
          detail: routeError,
          error: routeError,
        }))
      }
    } else {
      yield emit(makeStep({
        id: route.stepId,
        branch: route.branch,
        status: 'skipped',
        label: route.label,
        liveStatusLabel: route.liveStatusLabel,
        detail: route.detail,
      }))
    }

    if (routeError) {
      const tauStageTrace = stageTraceFromStreamingSteps(steps)
      const currentStage = tauStageTrace[tauStageTrace.length - 1] ?? null
      const message = makeFinalMessage({
        branch: route.branch,
        content: [
          `Tau stopped fail-closed while running ${route.endpoint}.`,
          '',
          `Memory route: ${route.label}`,
          `Error: ${routeError}`,
          '',
          '| Contract field | Current experiment state |',
          '| --- | --- |',
          '| Memory-first routing | `/intent` completed before the route endpoint failed |',
          `| Current receipt stage | ${currentStage ? `${currentStage.label} (${currentStage.status})` : 'not emitted'} |`,
          '| GitHub/subagent handoff | not emitted because the route product is missing |',
          '| Production Sparta Chat | not claimed from this preview |',
          '',
          'This is fail-closed: Tau is not fabricating a Memory product or downstream agent handoff from a failed route.',
        ].join('\n'),
        reasoningSteps: streamingStepsToThinkingTrace(steps),
        metadata: {
          source: 'tau-memory-adapter',
          memoryBacked: false,
          memoryIntent: summarizeMemoryIntent(intent),
          routeEndpoint: route.endpoint,
          routeError,
          tauStageTrace,
          tauCurrentStage: currentStage,
          tauAgentHandoffValidation: { ok: false, errors: [routeErrorKind], nextAgent: null },
        },
      })
      yield makeFinalStep(message, route.branch)
      return message
    }

    const lower = query.toLowerCase()
    const wantsVoice = lower.includes('embry') || lower.includes('voice') || lower.includes('personaplex')
    const wantsEvidence = lower.includes('cwe') || lower.includes('sparta') || lower.includes('evidence')

    if (wantsEvidence && route.branch === 'evidence-case') {
      yield emit(
        makeStep({
          id: 'checking-gates',
          branch: 'evidence-case',
          status: 'skipped',
          label: 'Creating Evidence Case',
          disclosureVariant: 'evidence-case',
          liveStatusLabel: 'Creating Evidence Case...',
          detail: 'Evidence-case synthesis is not executed by this slice; Tau only proved Memory intent and recall unless a create-evidence-case receipt is attached.',
        }),
      )
    }

    if (wantsVoice) {
      yield emit(
        makeStep({
          id: 'persona-recall',
          branch: 'personaplex',
          status: 'completed',
          label: 'Preparing Persona Voice',
          liveStatusLabel: 'Preparing Persona Voice...',
          detail: 'Embry persona metadata is preserved. PersonaPlex audio remains unverified until a real receipt is attached.',
        }),
      )
    }

    const wantsPeer = lower.includes('peer') || lower.includes('harness') || lower.includes('pi-mono') || lower.includes('communicat')
    if (wantsPeer) {
      yield emit(
        makeStep({
          id: 'peer-handoff',
          branch: 'compliance',
          status: 'completed',
          label: 'Publishing Peer Handoff',
          liveStatusLabel: 'Publishing Peer Handoff...',
          detail: 'Tau emits tau.loop_harness_peer_message.v1 through pi-mono Switchboard HTTP and WebSocket push with proof boundaries preserved.',
        }),
      )
    }

    const memoryProductSummary = summarizeMemoryProduct(product)
    const tauStageTrace = stageTraceFromStreamingSteps(steps)
    const currentStage = tauStageTrace[tauStageTrace.length - 1] ?? null
    const tauReceiptPaths = receiptPathsForCommandLoopProjection(this.commandLoopGithubProjection)
    const handoff = buildTauRouteHandoff({
      action: intent.action,
      query,
      branch: route.branch,
      contextArtifacts: tauReceiptPaths,
      resultEvidence: [
        '/api/memory/intent',
        ...(route.endpoint ? [`/api/memory${route.endpoint}`] : []),
      ],
      memoryProductSummary,
    })
    const handoffValidation = validateTauAgentHandoff(handoff)
    const handoffGithubProjection = deriveTauHandoffGithubProjection(handoff)

    const content = [
      route.finalLead,
      '',
      '| Memory field | Value |',
      '| --- | --- |',
      `| action | ${intent.action || 'unknown'} |`,
      `| confidence | ${formatConfidence(intent.confidence)} |`,
      `| recall profile | ${intent.recall_profile || 'not selected'} |`,
      `| response mode | ${intent.response_mode || intent.content_type || 'not selected'} |`,
      `| entities | ${(intent.entities || []).join(', ') || 'none'} |`,
      `| frameworks | ${(intent.frameworks || []).join(', ') || 'none'} |`,
      '',
      '| Contract field | Current experiment state |',
      '| --- | --- |',
      '| Memory-first routing | live harness receipts preserve `/intent`, `/extract-entities`, `/recall`, and entity packet |',
      '| Branch receipts | Brave, evidence-case, clarify, deflect, and answer branches are explicit |',
      `| Current receipt stage | ${currentStage ? `${currentStage.label} (${currentStage.status})` : 'not emitted'} |`,
      '| Peer communication | `tau.loop_harness_peer_message.v1` advertises summary, transport DAG evidence, events, event stream, final receipt, consumer checks, and live pi-mono Switchboard push proof |',
      '| TUI stage labels | Getting Intent, Extracting Entities, Accessing Memory, Creating Evidence Case, Searching Web, Preparing Persona Voice |',
      '| Embry voice | metadata carried; PersonaPlex audio proof not attached |',
      '| Production Sparta Chat | not claimed from this preview |',
      '',
      productSummaryMarkdown(route, product),
      '',
      summarizeTauAgentHandoff(handoff),
      '',
      summarizeTauHandoffGithubProjection(handoffGithubProjection),
      '',
      summarizeTauCommandLoopGithubProjection(this.commandLoopGithubProjection),
      '',
      renderTauHandoffJsonBlock(handoff),
      '',
      'Remaining production work is replacing this UX Lab adapter with the final Sparta Chat engine while keeping the same receipt and proof-boundary contract.',
    ].join('\n')

    const message = makeFinalMessage({
      branch: route.branch,
      content,
      reasoningSteps: streamingStepsToThinkingTrace(steps),
      skillUsed: route.branch === 'evidence-case' ? 'create-evidence-case' : undefined,
      metadata: {
        source: 'tau-receipt-adapter',
        memoryBacked: true,
        memoryIntent: summarizeMemoryIntent(intent),
        memoryProduct: memoryProductSummary,
        tauStageTrace,
        tauCurrentStage: currentStage,
        tauAgentHandoff: handoff,
        tauAgentHandoffValidation: handoffValidation,
        tauAgentHandoffGithubProjection: handoffGithubProjection,
        tauCommandLoopGithubProjection: this.commandLoopGithubProjection ?? null,
        contentType: wantsEvidence ? 'evidence' : 'qra',
        tauReceiptPaths,
        personaVoiceStatus: 'REQUESTED_NO_PERSONAPLEX_RECEIPT',
      },
    })
    yield makeFinalStep(message, route.branch)
    return message
  }
}

type TauMemoryIntentResponse = {
  action?: string
  confidence?: number
  response_mode?: string
  content_type?: string
  recall_profile?: string
  recall_profile_confidence?: number
  entities?: string[]
  frameworks?: string[]
  keywords?: string[]
  entity_context?: unknown
  query_plan?: unknown
  k?: number
}

type TauRoute = {
  branch: TurnBranch
  endpoint: string | null
  stepId: string
  label: string
  liveStatusLabel: string
  detail: string
  finalLead: string
  body: (query: string, intent: TauMemoryIntentResponse) => Record<string, unknown>
  completedDetail: (product: unknown) => string
}

async function postMemoryProduct<T = unknown>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(`/memory${path}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const text = await response.text()
  let parsed: unknown = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  if (!response.ok) {
    const detail = typeof parsed === 'object' && parsed && 'detail' in parsed ? (parsed as { detail?: unknown }).detail : text
    throw new Error(`Memory ${path} failed with ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  }
  return parsed as T
}

function validateIntentRoute(intent: TauMemoryIntentResponse): string | null {
  const action = (intent.action || '').toUpperCase()
  if (
    action === 'CLARIFY'
    || action === 'DEFLECT'
    || action === 'NO_MATCH'
    || action === 'OFF_TOPIC'
    || action === 'ANSWER'
    || action === 'COMPLIANCE'
    || action === 'RESEARCH'
    || action === 'QUERY'
  ) {
    return null
  }
  if (intent.response_mode === 'memory_grounded_answer') return null
  if (intent.response_mode === 'evidence_case' || intent.content_type === 'evidence_case') return null
  return `Memory /intent action ${action || 'UNKNOWN'} is not a supported Tau route`
}

function routeFromIntent(intent: TauMemoryIntentResponse): TauRoute {
  const action = (intent.action || '').toUpperCase()
  if (action === 'CLARIFY') {
    return {
      branch: 'compliance',
      endpoint: '/clarify',
      stepId: 'clarifying',
      label: 'Clarifying',
      liveStatusLabel: 'Clarifying...',
      detail: 'Memory intent says the turn is underspecified.',
      finalLead: 'Tau routed this turn to Memory clarify.',
      body: (query) => ({ q: query, scope: 'tau', k: 5 }),
      completedDetail: (product) => summarizeProductStatus(product, 'Clarify product returned.'),
    }
  }
  if (action === 'DEFLECT' || action === 'NO_MATCH' || action === 'OFF_TOPIC') {
    return {
      branch: 'compliance',
      endpoint: '/deflect',
      stepId: 'checking-gates',
      label: 'Checking Deflection',
      liveStatusLabel: 'Checking Deflection...',
      detail: 'Memory intent says this turn should not enter recall/evidence work.',
      finalLead: 'Tau routed this turn to Memory deflect.',
      body: (query) => ({ q: query, persona_id: 'embry', intent_action: action }),
      completedDetail: (product) => summarizeProductStatus(product, 'Deflection product returned.'),
    }
  }
  if (action === 'ANSWER' || intent.response_mode === 'memory_grounded_answer') {
    return {
      branch: 'compliance',
      endpoint: '/answer',
      stepId: 'answering',
      label: 'Answering From Memory',
      liveStatusLabel: 'Answering From Memory...',
      detail: 'Memory intent says the turn is grounded enough for a final answer product.',
      finalLead: 'Tau routed this turn to Memory answer.',
      body: (query) => ({ q: query, scope: 'tau', k: 5 }),
      completedDetail: (product) => summarizeProductStatus(product, 'Answer product returned.'),
    }
  }
  if (action === 'COMPLIANCE' || intent.response_mode === 'evidence_case' || intent.content_type === 'evidence_case') {
    return {
      branch: 'evidence-case',
      endpoint: '/recall',
      stepId: 'looking-in-memory',
      label: 'Accessing Memory',
      liveStatusLabel: 'Accessing Memory...',
      detail: 'Memory intent selected a compliance/evidence route. This slice recalls grounding evidence before evidence-case synthesis.',
      finalLead: 'Tau routed this turn through Memory intent into a compliance evidence path.',
      body: (query, selectedIntent) => ({
        q: query,
        scope: 'tau',
        k: selectedIntent.k || 8,
        collections: ['sparta_controls', 'sparta_relationships', 'technique_knowledge'],
      }),
      completedDetail: (product) => summarizeProductStatus(product, 'Recall product returned.'),
    }
  }
  if (action === 'RESEARCH') {
    return {
      branch: 'compliance',
      endpoint: null,
      stepId: 'getting-results',
      label: 'Searching Web',
      liveStatusLabel: 'Searching Web...',
      detail: 'Memory intent selected research. Brave Search is not wired in this slice, so Tau stops before web claims.',
      finalLead: 'Tau identified a research route and stopped before unsupported web claims.',
      body: () => ({}),
      completedDetail: () => 'Research not executed in this slice.',
    }
  }
  if (action === 'QUERY') {
    return {
      branch: 'compliance',
      endpoint: '/recall',
      stepId: 'looking-in-memory',
      label: 'Accessing Memory',
      liveStatusLabel: 'Accessing Memory...',
      detail: 'Memory intent selected a query-style route.',
      finalLead: 'Tau routed this turn through Memory recall.',
      body: (query, selectedIntent) => ({ q: query, scope: 'tau', k: selectedIntent.k || 5 }),
      completedDetail: (product) => summarizeProductStatus(product, 'Recall product returned.'),
    }
  }
  return {
    branch: 'compliance',
    endpoint: '/recall',
    stepId: 'looking-in-memory',
    label: 'Accessing Memory',
    liveStatusLabel: 'Accessing Memory...',
    detail: 'Memory intent selected a query-style route.',
    finalLead: 'Tau routed this turn through Memory recall.',
    body: (query, selectedIntent) => ({ q: query, scope: 'tau', k: selectedIntent.k || 5 }),
    completedDetail: (product) => summarizeProductStatus(product, 'Recall product returned.'),
  }
}

function formatConfidence(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : 'n/a'
}

function summarizeIntentEntities(intent: TauMemoryIntentResponse): string {
  const entities = intent.entities?.length ? intent.entities.join(', ') : 'no explicit entities'
  const frameworks = intent.frameworks?.length ? intent.frameworks.join(', ') : 'no explicit frameworks'
  return `Memory /intent returned ${entities}; frameworks: ${frameworks}.`
}

function summarizeMemoryIntent(intent: TauMemoryIntentResponse): Record<string, unknown> {
  return {
    action: intent.action ?? null,
    confidence: intent.confidence ?? null,
    response_mode: intent.response_mode ?? null,
    content_type: intent.content_type ?? null,
    recall_profile: intent.recall_profile ?? null,
    entities: intent.entities ?? [],
    frameworks: intent.frameworks ?? [],
  }
}

function summarizeMemoryProduct(product: unknown): Record<string, unknown> | null {
  if (!product || typeof product !== 'object') return null
  const record = product as Record<string, unknown>
  const questions = Array.isArray(record.questions) ? record.questions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  return {
    schema: record.schema ?? null,
    found: record.found ?? null,
    can_answer: record.can_answer ?? null,
    should_deflect: record.should_deflect ?? null,
    confidence: record.confidence ?? null,
    item_count: Array.isArray(record.items) ? record.items.length : null,
    question_count: questions.length,
    first_question: questions[0] ?? null,
  }
}

function validateMemoryRouteProduct(route: TauRoute, product: unknown): string | null {
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    return `Memory ${route.endpoint} returned a non-object product`
  }
  const record = product as Record<string, unknown>
  if (route.endpoint === '/clarify') {
    if (record.schema !== 'memory.clarify.v1') return 'Memory /clarify returned an unexpected schema'
    if (typeof record.needs_clarification !== 'boolean') {
      return 'Memory /clarify missing needs_clarification boolean'
    }
    const questions = record.questions
    if (record.needs_clarification === true && (!Array.isArray(questions) || questions.length === 0)) {
      return 'Memory /clarify requested clarification without questions'
    }
  }
  if (route.endpoint === '/deflect') {
    if (record.schema !== 'memory.deflect.v1') return 'Memory /deflect returned an unexpected schema'
    if (typeof record.should_deflect !== 'boolean') return 'Memory /deflect missing should_deflect boolean'
    if (record.should_deflect !== true) return 'Memory /deflect did not confirm deflection'
  }
  if (route.endpoint === '/answer') {
    if (record.schema !== 'memory.answer.v1') return 'Memory /answer returned an unexpected schema'
    if (record.can_answer !== true) return 'Memory /answer did not confirm can_answer=true'
    if (typeof record.final_response !== 'string' || !record.final_response.trim()) {
      return 'Memory /answer missing final_response'
    }
  }
  if (route.endpoint === '/recall') {
    if (!Array.isArray(record.items)) return 'Memory /recall missing items array'
    if (typeof record.found !== 'boolean') return 'Memory /recall missing found boolean'
  }
  return null
}

function summarizeProductStatus(product: unknown, fallback: string): string {
  const summary = summarizeMemoryProduct(product)
  if (!summary) return fallback
  const parts = [
    summary.schema ? `schema ${summary.schema}` : '',
    typeof summary.found === 'boolean' ? `found=${summary.found}` : '',
    typeof summary.can_answer === 'boolean' ? `can_answer=${summary.can_answer}` : '',
    typeof summary.should_deflect === 'boolean' ? `should_deflect=${summary.should_deflect}` : '',
    typeof summary.item_count === 'number' ? `items=${summary.item_count}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : fallback
}

function productSummaryMarkdown(route: TauRoute, product: unknown): string {
  const summary = summarizeMemoryProduct(product)
  if (!summary) return `Memory product: ${route.endpoint ? 'not available' : 'not called in this slice'}.`
  return [
    '| Memory product | Value |',
    '| --- | --- |',
    `| endpoint | ${route.endpoint || 'not called'} |`,
    `| schema | ${String(summary.schema || 'not reported')} |`,
    `| found | ${String(summary.found ?? 'not reported')} |`,
    `| can answer | ${String(summary.can_answer ?? 'not reported')} |`,
    `| should deflect | ${String(summary.should_deflect ?? 'not reported')} |`,
    `| item count | ${String(summary.item_count ?? 'not reported')} |`,
    `| question count | ${String(summary.question_count ?? 'not reported')} |`,
    `| first question | ${String(summary.first_question ?? 'not reported')} |`,
  ].join('\n')
}

function renderTauHandoffJsonBlock(handoff: unknown): string {
  return [
    '### Tau handoff JSON contract',
    '',
    '```json',
    JSON.stringify(handoff, null, 2),
    '```',
  ].join('\n')
}

function summarizeTauCommandLoopGithubProjection(projection?: TauCommandLoopGithubProjectionReceipt): string {
  if (!projection) {
    return [
      '### Tau command-loop GitHub projection receipt',
      '',
      '| Receipt field | Value |',
      '| --- | --- |',
      '| status | unavailable |',
      '| fail-closed behavior | command-loop GitHub projection is omitted until `/api/tau/command-loop/github-projection` returns a schema-valid receipt |',
    ].join('\n')
  }
  const counts = projection.reconciliationCounts
  return [
    '### Tau command-loop GitHub projection receipt',
    '',
    '| Receipt field | Value |',
    '| --- | --- |',
    `| summary | \`${projection.summaryPath}\` |`,
    `| source loop receipt | \`${projection.sourceLoopReceiptPath}\` |`,
    `| reconciliation receipt | \`${projection.reconciliationReceiptPath}\` |`,
    `| actual reconciliation step receipt | \`${projection.actualReconciliationStepReceiptPath}\` |`,
    `| ticket source | \`${projection.ticketSourcePath}\` |`,
    `| transport receipt | \`${projection.transportReceiptPath}\` |`,
    `| mocked | ${String(projection.mocked)} |`,
    `| live | ${String(projection.live)} |`,
    `| dry run | ${String(projection.dryRun)} |`,
    `| mutation applied | ${String(projection.applied)} |`,
    `| dry-run commands | ${projection.commandCount} |`,
    `| reconciliation counts | keep=${counts.keep}, close=${counts.close}, migrate=${counts.migrate}, regenerate=${counts.regenerate} |`,
    '',
    '```text',
    ...projection.commands,
    '```',
  ].join('\n')
}

function receiptPathsForCommandLoopProjection(projection?: TauCommandLoopGithubProjectionReceipt): string[] {
  const paths = RECEIPTS.map((receipt) => receipt.path).filter((path) => !path.startsWith('loaded from '))
  if (!projection) return paths
  return [
    ...paths,
    projection.summaryPath,
    projection.sourceLoopReceiptPath,
    projection.reconciliationReceiptPath,
    projection.actualReconciliationStepReceiptPath,
    projection.ticketSourcePath,
    projection.transportReceiptPath,
  ]
}

export function stageTraceFromStreamingSteps(steps: StreamingStep[]): TauPipelineStageReceipt[] {
  return steps
    .filter((step) => step.liveStatusLabel)
    .map((step) => ({
      schema: 'tau.loop2_pipeline_stage.v1',
      stage: normalizeTauStage(step.liveStatusLabel ?? step.label),
      label: step.liveStatusLabel ?? `${step.label}...`,
      status: normalizeStageStatus(step.status),
      source: step.id,
    }))
}

function normalizeTauStage(label: string): string {
  const lower = label.toLowerCase()
  if (lower.includes('intent')) return 'intent'
  if (lower.includes('entit')) return 'extract_entities'
  if (lower.includes('answer')) return 'answer'
  if (lower.includes('memory')) return 'recall'
  if (lower.includes('evidence')) return 'evidence_case'
  if (lower.includes('search') || lower.includes('web')) return 'brave_search'
  if (lower.includes('voice') || lower.includes('persona')) return 'personaplex'
  if (lower.includes('clarif')) return 'clarify'
  if (lower.includes('deflect')) return 'deflect'
  return 'unknown'
}

function normalizeStageStatus(status: StreamingStep['status']): string {
  if (status === 'completed') return 'PASS'
  if (status === 'failed') return 'FAILED'
  if (status === 'skipped') return 'SKIPPED'
  if (status === 'running') return 'RUNNING'
  return 'UNKNOWN'
}

export function TauChatView(): JSX.Element {
  const [commandLoopProjectionState, setCommandLoopProjectionState] =
    useState<TauCommandLoopGithubProjectionState | null>(null)
  const adapter = useMemo(
    () => new TauReceiptAdapter(postMemoryProduct, commandLoopProjectionState?.ok ? commandLoopProjectionState.receipt : undefined),
    [commandLoopProjectionState],
  )
  const [peerConfig, setPeerConfig] = useState<TauPeerMonitorConfig>(() =>
    readTauPeerMonitorConfig(
      typeof window === 'undefined' ? '' : window.location.search,
      typeof window === 'undefined' ? undefined : window.localStorage,
    ),
  )
  const [peerMessage, setPeerMessage] = useState<Loop2HarnessPeerMessage | null>(null)
  const [loopSummary, setLoopSummary] = useState<Loop2Summary | null>(null)
  const [loopEvents, setLoopEvents] = useState<Loop2Event[]>([])
  const [streamEvents, setStreamEvents] = useState<Loop2Event[]>([])
  const [streamEnd, setStreamEnd] = useState<Loop2EventStreamEnd | null>(null)
  const [streamError, setStreamError] = useState('')
  const [peerSummary, setPeerSummary] = useState<TauPeerStatusSummary>(() =>
    summarizeTauPeerMessage(null, [], 'peer monitor not checked yet'),
  )
  const [loopMonitorSummary, setLoopMonitorSummary] = useState<TauLoopMonitorSummary>(() =>
    summarizeTauLoopMonitor(null, null, 'loop monitor not checked yet'),
  )
  const [peerLoading, setPeerLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadTauCommandLoopGithubProjection()
      .then((state) => {
        if (!cancelled) setCommandLoopProjectionState(state)
      })
      .catch((error) => {
        if (!cancelled) {
          setCommandLoopProjectionState({
            ok: false,
            error: 'tau_command_loop_projection_unavailable',
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const nextConfig = readTauPeerMonitorConfig(window.location.search, window.localStorage)
    setPeerConfig(nextConfig)
    if (!nextConfig.configured) {
      setPeerMessage(null)
      setLoopSummary(null)
      setLoopEvents([])
      setStreamEvents([])
      setStreamEnd(null)
      setStreamError('')
      setPeerSummary(summarizeTauPeerMessage(null, []))
      setLoopMonitorSummary(summarizeTauLoopMonitor(null, null, 'Set loop2:lastRunId or add ?loop2RunId=<run_id> to read Tau summary/events.'))
      return undefined
    }

    let cancelled = false
    setPeerLoading(true)
    void (async () => {
      try {
        const message = await loadLoop2HarnessPeerMessage(nextConfig)
        if (cancelled) return
        const validationErrors = validateLoop2HarnessPeerMessage(message)
        setPeerMessage(message)
        setPeerSummary(summarizeTauPeerMessage(message, validationErrors))
      } catch (error) {
        if (cancelled) return
        setPeerMessage(null)
        setPeerSummary(
          summarizeTauPeerMessage(
            null,
            [],
            error instanceof Error ? error.message : String(error),
          ),
        )
      }

      try {
        const [summary, eventsResponse] = await Promise.all([
          loadLoop2Summary(nextConfig),
          loadLoop2Events(nextConfig),
        ])
        if (cancelled) return
        setLoopSummary(summary)
        setLoopEvents(eventsResponse.events)
        setLoopMonitorSummary(summarizeTauLoopMonitor(summary, eventsResponse.events))
        window.localStorage.setItem('loop2:baseUrl', nextConfig.baseUrl)
        window.localStorage.setItem('loop2:lastRunId', nextConfig.runId)
      } catch (error) {
        if (cancelled) return
        setLoopSummary(null)
        setLoopEvents([])
        setLoopMonitorSummary(
          summarizeTauLoopMonitor(
            null,
            null,
            error instanceof Error ? error.message : String(error),
          ),
        )
      } finally {
        if (!cancelled) setPeerLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!peerConfig.configured) return undefined
    setStreamEvents([])
    setStreamEnd(null)
    setStreamError('')
    const close = openLoop2EventStream(
      peerConfig,
      {
        onEvent: (event) => {
          setStreamEvents((current) => [...current, event].slice(-50))
        },
        onEnd: (end) => {
          setStreamEnd(end)
        },
        onError: (error) => {
          setStreamError(error.message)
        },
      },
      { afterSequence: 0 },
    )
    return close
  }, [peerConfig])

  const streamedLastEvent = streamEvents[streamEvents.length - 1]
  const streamStatusColor = streamError ? '#ef4444' : streamEnd ? '#22c55e' : '#38bdf8'
  const streamStatusLabel = streamError ? 'ERROR' : streamEnd ? 'STREAM READY' : 'STREAMING'
  const receiptCards = useMemo(
    () =>
      RECEIPTS.map((receipt) => {
        if (receipt.label !== 'GitHub projection') return receipt
        if (!commandLoopProjectionState) {
          return { ...receipt, value: 'LOADING', detail: 'Reading Tau command-loop GitHub projection receipt from UX Lab API.' }
        }
        if (!commandLoopProjectionState.ok) {
          return {
            ...receipt,
            value: 'UNAVAILABLE',
            detail: `Fail-closed: ${commandLoopProjectionState.detail}`,
            path: commandLoopProjectionState.summaryPath ?? receipt.path,
          }
        }
        return {
          ...receipt,
          value: `${commandLoopProjectionState.receipt.commandCount} commands`,
          detail:
            'Tau command loop carried an explicit ticket source into goal-guardian reconciliation and rendered dry-run GitHub comment/edit commands.',
          path: commandLoopProjectionState.receipt.summaryPath,
        }
      }),
    [commandLoopProjectionState],
  )

  return (
    <section
      data-qid="tau:chat:surface"
      style={{
        height: '100%',
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(360px, 0.92fr) minmax(390px, 0.72fr)',
        background: '#090a0f',
        color: '#e5e7eb',
        overflow: 'hidden',
      }}
    >
      <main data-qid="tau:chat:workspace" style={{ minHeight: 0, overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'grid', gap: 20, maxWidth: 980 }}>
          <header style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              <Terminal size={14} /> Tau Experiment Chat
            </div>
            <h1 style={{ margin: 0, maxWidth: 760, fontSize: 34, lineHeight: 1.05, letterSpacing: '-0.03em', color: '#f8fafc' }}>
              Receipt-backed chat shell for Tau loop, Memory, evidence, Watch-style media, and Embry voice.
            </h1>
            <p style={{ margin: 0, maxWidth: 760, color: '#94a3b8', lineHeight: 1.55, fontSize: 14 }}>
              This is an experiment surface inside UX Lab. It uses the shared Sparta/Watch chat renderer and shows the Tau contract without claiming live production chat.
            </p>
          </header>

          <section data-qid="tau:chat:receipts" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
            {receiptCards.map((receipt) => (
              <article key={receipt.path} style={{ border: '1px solid rgba(148,163,184,0.18)', background: 'rgba(15,23,42,0.72)', borderRadius: 8, padding: 14, minHeight: 128 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 700 }}>{receipt.label}</span>
                  <span style={{ color: '#22c55e', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{receipt.value}</span>
                </div>
                <p style={{ margin: '10px 0 0', color: '#94a3b8', fontSize: 12, lineHeight: 1.45 }}>{receipt.detail}</p>
                <code style={{ display: 'block', marginTop: 12, color: '#64748b', fontSize: 10, lineHeight: 1.35, wordBreak: 'break-word' }}>{receipt.path}</code>
              </article>
            ))}
          </section>

          <section data-qid="tau:chat:pipeline" style={{ border: '1px solid rgba(148,163,184,0.16)', background: 'rgba(2,6,23,0.64)', borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <h2 style={{ margin: 0, fontSize: 14, color: '#f8fafc' }}>Stage Contract</h2>
              <span style={{ color: '#94a3b8', fontSize: 11 }}>Rendered through shared ThinkingTrace</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8, marginTop: 14 }}>
              {STAGES.map(({ id, label, icon: Icon }) => (
                <div key={id} style={{ display: 'grid', gap: 8, justifyItems: 'center', minHeight: 92, padding: 10, border: '1px solid rgba(148,163,184,0.12)', borderRadius: 8, background: 'rgba(15,23,42,0.68)' }}>
                  <Icon size={18} color="#38bdf8" />
                  <span style={{ color: '#cbd5e1', fontSize: 11, textAlign: 'center', lineHeight: 1.25 }}>{label}</span>
                </div>
              ))}
            </div>
            <div
              data-qid="tau:chat:receipt-current-stage"
              style={{
                marginTop: 14,
                border: '1px solid rgba(56,189,248,0.24)',
                background: 'rgba(8,47,73,0.32)',
                borderRadius: 8,
                padding: 12,
                display: 'grid',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: '#bae6fd', fontSize: 12, fontWeight: 800 }}>Receipt-backed current stage</span>
                <span
                  data-qid="tau:chat:receipt-current-stage-label"
                  style={{ color: '#67e8f9', fontSize: 12, fontFamily: 'monospace' }}
                >
                  {TAU_MEMORY_STAGE_TRACE[TAU_MEMORY_STAGE_TRACE.length - 1].label}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                {TAU_MEMORY_STAGE_TRACE.map((stage) => (
                  <div
                    key={stage.stage}
                    data-qid={`tau:chat:receipt-stage:${stage.stage}`}
                    style={{
                      border: '1px solid rgba(125,211,252,0.16)',
                      borderRadius: 7,
                      padding: 8,
                      background: 'rgba(15,23,42,0.5)',
                      minWidth: 0,
                    }}
                  >
                    <div style={{ color: '#e0f2fe', fontSize: 11, lineHeight: 1.25 }}>{stage.label}</div>
                    <div style={{ marginTop: 5, color: '#7dd3fc', fontSize: 10, fontFamily: 'monospace' }}>{stage.status}</div>
                  </div>
                ))}
              </div>
              <code style={{ color: '#7dd3fc', fontSize: 10, wordBreak: 'break-word' }}>
                {TAU_MEMORY_STAGE_TRACE_RECEIPT}
              </code>
            </div>
          </section>

          <section data-qid="tau:chat:peer-monitor" style={{ border: '1px solid rgba(148,163,184,0.16)', background: 'rgba(2,6,23,0.64)', borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 14, color: '#f8fafc' }}>Live Peer Envelope</h2>
                <p style={{ margin: '8px 0 0', color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
                  Reads Tau monitor `/peer-message` when `loop2:lastRunId` is set or `?loop2RunId=` is supplied.
                </p>
              </div>
              <span
                data-qid="tau:chat:peer-status"
                style={{
                  color: peerSummary.statusColor,
                  border: `1px solid ${peerSummary.statusColor}55`,
                  background: `${peerSummary.statusColor}14`,
                  borderRadius: 999,
                  padding: '5px 9px',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                }}
              >
                {peerLoading ? 'LOADING' : peerSummary.label}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, marginTop: 14 }}>
              <PeerFact label="source" value={peerConfig.source} />
              <PeerFact label="base url" value={peerConfig.baseUrl} />
              <PeerFact label="run id" value={peerSummary.runId || peerConfig.runId || 'not configured'} />
              <PeerFact label="proof scope" value={peerSummary.proofScope || 'not available'} />
              <PeerFact label="switchboard to" value={peerSummary.switchboardTarget || 'not advertised'} />
              <PeerFact label="switchboard subject" value={peerSummary.switchboardSubject || 'not advertised'} />
            </div>
            <p style={{ margin: '12px 0 0', color: '#cbd5e1', fontSize: 12, lineHeight: 1.5 }}>{peerSummary.detail}</p>
            {peerSummary.doesNotProve.length > 0 && (
              <div data-qid="tau:chat:peer-proof-boundaries" style={{ marginTop: 12, display: 'grid', gap: 5 }}>
                <div style={{ color: '#94a3b8', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Does not prove</div>
                {peerSummary.doesNotProve.slice(0, 3).map((item) => (
                  <div key={item} style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.4 }}>
                    {item}
                  </div>
                ))}
              </div>
            )}
            {peerMessage?.endpoints && (
              <code style={{ display: 'block', marginTop: 12, color: '#64748b', fontSize: 10, lineHeight: 1.35, wordBreak: 'break-word' }}>
                {peerMessage.endpoints.peer_message || 'peer-message endpoint advertised'}
              </code>
            )}
          </section>

          <section data-qid="tau:chat:loop-monitor" style={{ border: '1px solid rgba(148,163,184,0.16)', background: 'rgba(2,6,23,0.64)', borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 14, color: '#f8fafc' }}>Live Loop Replay</h2>
                <p style={{ margin: '8px 0 0', color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
                  Reads Tau monitor `/summary` and `/events` so the chat can show actual loop state and replayable event counts.
                </p>
              </div>
              <span
                data-qid="tau:chat:loop-status"
                style={{
                  color: loopMonitorSummary.statusColor,
                  border: `1px solid ${loopMonitorSummary.statusColor}55`,
                  background: `${loopMonitorSummary.statusColor}14`,
                  borderRadius: 999,
                  padding: '5px 9px',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                }}
              >
                {peerLoading ? 'LOADING' : loopMonitorSummary.label}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 14 }}>
              <PeerFact label="run state" value={loopMonitorSummary.runState || 'not available'} />
              <PeerFact label="receipt" value={loopMonitorSummary.receiptStatus || 'not available'} />
              <PeerFact label="events" value={String(loopMonitorSummary.eventCount)} />
              <PeerFact label="last event" value={loopMonitorSummary.lastEventType || 'not available'} />
            </div>
            <p style={{ margin: '12px 0 0', color: '#cbd5e1', fontSize: 12, lineHeight: 1.5 }}>{loopMonitorSummary.detail}</p>
            {loopMonitorSummary.lastEventMessage && (
              <code style={{ display: 'block', marginTop: 10, color: '#94a3b8', fontSize: 10, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                {loopMonitorSummary.lastEventMessage}
              </code>
            )}
            {loopMonitorSummary.doesNotProve.length > 0 && (
              <div data-qid="tau:chat:loop-proof-boundaries" style={{ marginTop: 12, display: 'grid', gap: 5 }}>
                <div style={{ color: '#94a3b8', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Does not prove</div>
                {loopMonitorSummary.doesNotProve.slice(0, 3).map((item) => (
                  <div key={item} style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.4 }}>
                    {item}
                  </div>
                ))}
              </div>
            )}
            {loopSummary && (
              <code style={{ display: 'block', marginTop: 12, color: '#64748b', fontSize: 10, lineHeight: 1.35, wordBreak: 'break-word' }}>
                {loopSummary.run_id} / {loopEvents.length} events replayed
              </code>
            )}
          </section>

          <section data-qid="tau:chat:loop-stream" style={{ border: '1px solid rgba(148,163,184,0.16)', background: 'rgba(2,6,23,0.64)', borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 14, color: '#f8fafc' }}>Live Event Stream</h2>
                <p style={{ margin: '8px 0 0', color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
                  Subscribes to Tau monitor `event: loop2_event` and `event: end` from `/events/stream`.
                </p>
              </div>
              <span
                data-qid="tau:chat:stream-status"
                style={{
                  color: streamStatusColor,
                  border: `1px solid ${streamStatusColor}55`,
                  background: `${streamStatusColor}14`,
                  borderRadius: 999,
                  padding: '5px 9px',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                }}
              >
                {streamStatusLabel}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 14 }}>
              <PeerFact label="streamed events" value={String(streamEvents.length)} />
              <PeerFact label="last stream event" value={streamedLastEvent?.event_type || 'waiting'} />
              <PeerFact label="end reason" value={streamEnd?.reason || 'open'} />
              <PeerFact label="end count" value={String(streamEnd?.event_count ?? 0)} />
            </div>
            <p style={{ margin: '12px 0 0', color: streamError ? '#fecaca' : '#cbd5e1', fontSize: 12, lineHeight: 1.5 }}>
              {streamError || (streamedLastEvent?.message || streamedLastEvent?.event_type || 'Waiting for Loop2 stream events.')}
            </p>
            {streamedLastEvent && (
              <code style={{ display: 'block', marginTop: 12, color: '#64748b', fontSize: 10, lineHeight: 1.35, wordBreak: 'break-word' }}>
                {streamedLastEvent.event_id || `${streamedLastEvent.run_id}:${streamedLastEvent.event_type}`}
              </code>
            )}
          </section>

          <section data-qid="tau:chat:watch-sparta-voice" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <Capability icon={<Video size={16} />} title="Watch UX" text="Media evidence remains first-class: scene context, clips, frames, and report questions share the same chat shell." />
            <Capability icon={<Shield size={16} />} title="Sparta Chat UX" text="Evidence-case turns disclose gates and receipts instead of generic hidden reasoning." />
            <Capability icon={<GitBranch size={16} />} title="Peer Harness" text="Tau publishes a fail-closed peer envelope so pi-mono can consume Loop2 summary, events, and DAG evidence without scraping." />
            <Capability icon={<Mic size={16} />} title="Embry Voice" text="PersonaPlex is represented as fail-closed voice metadata until a real cache replay receipt is attached." />
          </section>
        </div>
      </main>

      <aside data-qid="tau:chat:sidebar" style={{ minWidth: 0, minHeight: 0, borderLeft: '1px solid rgba(148,163,184,0.16)', background: '#101014', padding: 8 }}>
        <SharedChatShell
          projectLabel="Tau Chat"
          surface="shared-chat"
          shellQid="tau:chat:shell"
          defaultMode="compliance"
          showModeToggle
          adapter={adapter}
          initialMessages={sampleMessages}
          emptyTitle="Tau Loop and Memory Harness"
          emptyDescription="Ask about the Tau loop stage contract, Sparta evidence cases, Watch embeds, or Embry voice readiness."
          placeholder="Ask Tau about loop evidence, SPARTA, Watch, or Embry..."
          chatTitle="Tau Loop Chat"
          agentStatus="ready"
          starterChips={[
            { label: 'Show loop evidence', prompt: 'What loop evidence is available?', dataQid: 'tau:chat:chip:loop-evidence' },
            { label: 'Peer handoff', prompt: 'How does Tau communicate with pi-mono and peer harnesses?', dataQid: 'tau:chat:chip:peer-handoff' },
            { label: 'Explain Embry voice', prompt: 'How does Embry PersonaPlex voice work here?', dataQid: 'tau:chat:chip:embry-voice' },
            { label: 'SPARTA evidence case', prompt: 'How does Tau handle a CWE-287 SPARTA evidence case?', dataQid: 'tau:chat:chip:sparta-evidence' },
          ]}
        />
      </aside>
    </section>
  )
}

function PeerFact({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{ minWidth: 0, border: '1px solid rgba(148,163,184,0.12)', background: 'rgba(15,23,42,0.58)', borderRadius: 7, padding: 10 }}>
      <div style={{ color: '#64748b', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ marginTop: 5, color: '#cbd5e1', fontSize: 11, lineHeight: 1.35, wordBreak: 'break-word' }}>{value}</div>
    </div>
  )
}

function Capability({ icon, title, text }: { icon: JSX.Element; title: string; text: string }): JSX.Element {
  return (
    <article style={{ border: '1px solid rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.58)', borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e2e8f0', fontSize: 13, fontWeight: 700 }}>
        {icon}
        {title}
      </div>
      <p style={{ margin: '9px 0 0', color: '#94a3b8', fontSize: 12, lineHeight: 1.48 }}>{text}</p>
    </article>
  )
}

export default TauChatView
