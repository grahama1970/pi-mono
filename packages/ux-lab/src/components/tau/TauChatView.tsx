import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  AudioLines,
  Bot,
  CheckCircle2,
  FileText,
  GitBranch,
  Maximize2,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Shield,
  SquareDashedMousePointer,
  Terminal,
  Trash2,
  UserRound,
  Video,
  X,
} from 'lucide-react'
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
  deriveTauHandoffGithubTransportReceipt,
  renderTauHandoffGithubProjectionJsonBlock,
  renderTauHandoffGithubTransportReceiptJsonBlock,
  summarizeTauAgentHandoff,
  summarizeTauHandoffGithubProjection,
  type TauHandoffGithubTransportReceipt,
  validateTauAgentHandoff,
} from './tauAgentHandoff'
import {
  loadTauCommandLoopGithubProjection,
  type TauCommandLoopGithubProjectionReceipt,
  type TauCommandLoopGithubProjectionState,
} from './tauCommandLoopProjection'
import { apiUrl } from '../../lib/apiBase'
import { useHorizontalPaneResize } from '../../hooks/useHorizontalPaneResize'
import { useRegisterAction } from '../../hooks/useRegisterAction'

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
type TauHandoffTransportValidator = (
  receipt: TauHandoffGithubTransportReceipt,
  signal?: AbortSignal,
) => Promise<TauHandoffGithubTransportValidation>
type TauHandoffOrchestratorIntakePoster = (
  validation: TauHandoffGithubTransportValidation,
  signal?: AbortSignal,
) => Promise<TauHandoffOrchestratorIntake>
type TauSubagentReceiptExpectationPoster = (
  intake: TauHandoffOrchestratorIntake,
  signal?: AbortSignal,
) => Promise<TauSubagentReceiptExpectation>
type TauSubagentHandoffValidator = (
  payload: {
    expectation: TauSubagentReceiptExpectation
    handoff: TauAgentCandidateHandoff
  },
  signal?: AbortSignal,
) => Promise<TauSubagentHandoffValidation>
type TauExternalSubagentReceiptIntakePoster = (
  payload: {
    expectation: TauSubagentReceiptExpectation
    receipt: TauAgentCandidateHandoff
    externalReceiptId?: string
  },
  signal?: AbortSignal,
) => Promise<TauExternalSubagentReceiptIntake>
type TauExternalSubagentGithubProjectionPoster = (
  payload: {
    intake: TauExternalSubagentReceiptIntake
    receipt: TauAgentCandidateHandoff
  },
  signal?: AbortSignal,
) => Promise<TauExternalSubagentGithubProjection>

type TauHandoffGithubTransportValidation = {
  schema: 'tau.handoff_github_transport_validation.v1'
  ok: boolean
  dryRun: true
  applied: false
  target?: {
    repo: string
    target: string
  }
  goal?: TauGoalRef
  labels?: {
    add: string[]
    remove: string[]
  }
  commandCount: number
  commands: string[]
  checks: string[]
}

type TauHandoffOrchestratorIntake = {
  schema: 'tau.handoff_orchestrator_intake.v1'
  ok: boolean
  dryRun: true
  applied: false
  accepted: boolean
  target: {
    repo: string
    target: string
  }
  goal: TauGoalRef
  nextAgent: string
  executor: string
  labels: {
    add: string[]
    remove: string[]
  }
  commandCount: number
  commands: string[]
  routing: {
    queue: string
    next_agent: string
    executor: string
    stop_condition: string
  }
  claims: {
    proves: string[]
    does_not_prove: string[]
  }
}

type TauSubagentReceiptExpectation = {
  schema: 'tau.subagent_receipt_expectation.v1'
  ok: boolean
  dryRun: true
  applied: false
  persisted?: boolean
  artifactPath?: string
  proofRoot?: string
  target: {
    repo: string
    target: string
  }
  goal: TauGoalRef
  nextAgent: string
  executor: string
  requiredReceipt: {
    schema: 'tau.agent_handoff.v1'
    previous_subagent: string
    fields: string[]
    next_agent_required: boolean
    evidence_required: boolean
    goal_preservation_required?: boolean
    stop_condition: string
  }
  claims: {
    proves: string[]
    does_not_prove: string[]
  }
}

type TauGoalRef = {
  goal_id: string
  goal_version: number
  goal_hash: string
}

type TauAgentCandidateHandoff = {
  schema: 'tau.agent_handoff.v1'
  github: {
    repo: string
    target: string
  }
  goal: TauGoalRef
  previous_subagent: string
  context: {
    summary: string
    artifacts: string[]
  }
  result: {
    status: string
    summary: string
    evidence: string[]
  }
  rationale: string
  next_agent: {
    name: string
    executor: string
    reason: string
  }
  required_evidence: string[]
  stop_condition: string
}

type TauSubagentHandoffValidation = {
  schema: 'tau.subagent_handoff_validation.v1'
  ok: boolean
  dryRun: true
  applied: false
  executed: false
  candidateOnly: true
  target: {
    repo: string
    target: string
  }
  previousSubagent: string
  nextAgent: string
  resultStatus: string
  goal?: TauGoalRef
  resultEvidenceCount: number
  requiredEvidenceCount: number
  expectationArtifactPath?: string
  checks: string[]
  claims: {
    proves: string[]
    does_not_prove: string[]
  }
}

type TauExternalSubagentReceiptIntake = {
  schema: 'tau.external_subagent_receipt_intake.v1'
  ok: boolean
  dryRun: true
  applied: false
  accepted: boolean
  externalReceipt: true
  executed: false
  target: {
    repo: string
    target: string
  }
  goal: TauGoalRef
  previousSubagent: string
  nextAgent: string
  resultStatus: string
  resultEvidenceCount: number
  requiredEvidenceCount: number
  externalReceiptId?: string | null
  nextRoute: {
    subagent?: string
    executor: string
    reason?: string
  }
  sourceValidation: TauSubagentHandoffValidation
  checks: string[]
  claims: {
    proves: string[]
    does_not_prove: string[]
  }
}

type TauExternalSubagentGithubProjection = {
  schema: 'tau.external_subagent_github_projection.v1'
  ok: boolean
  dryRun: true
  applied: false
  mutation: 'not_applied'
  target: {
    repo: string
    target: string
  }
  goal: TauGoalRef
  previousSubagent: string
  nextAgent: string
  executor: string
  resultStatus: string
  labels: {
    add: string[]
    remove: string[]
  }
  comment: {
    body: string
    body_format: string
    body_marker: string
    body_embeds_handoff_json: boolean
  }
  commandCount: number
  commands: string[]
  sourceIntake: {
    schema: string
    accepted: boolean
    externalReceipt: boolean
    executed: boolean
    externalReceiptId?: string | null
  }
  checks: string[]
  claims: {
    proves: string[]
    does_not_prove: string[]
  }
}

type TauChatUxContractView = {
  schema: 'tau.chat_ux_contract_view.v1'
  ok: boolean
  sourcePath: string
  sourceOfTruth: {
    repository: string
    path: string
  }
  integrationSurface: {
    host: string
    role: string
    route: string
  }
  supportedRoutes: string[]
  handoffContracts: string[]
  orchestrationMode: {
    name: string
    activation: string
    runner: string
    scheduler: string
    loopRule: string
    agentSource?: string | null
    githubTransport?: string | null
    nonClaims: string[]
  }
  claims?: {
    proves: string[]
    does_not_prove: string[]
  }
}

type TauChatUxContractState =
  | { ok: true; receipt: TauChatUxContractView }
  | { ok: false; error: string; detail?: string; contractPath?: string }

type TauMemoryRouteProofRoute = {
  route: string
  query: string
  selectedSkill?: string | null
  intentAction?: string | null
  branchSchema?: string | null
  branchStatus: string
  failClosed: boolean
  live: true
  mocked: false
  memoryProductSchema?: string | null
  currentStage?: {
    stage?: string | null
    label?: string | null
    status?: string | null
    source?: string | null
  } | null
  receipt: string
  receiptPath: string
  selectionReasons: string[]
  validationErrors: string[]
}

type TauMemoryRouteProofView = {
  schema: 'tau.memory_route_failclosed_view.v1'
  ok: boolean
  manifestPath: string
  proofRoot: string
  sourceSchema: string
  createdUtc?: string | null
  mocked: false
  live: true
  routeCount: number
  proofScope?: string | null
  routes: TauMemoryRouteProofRoute[]
  claims: {
    proves: string[]
    does_not_prove: string[]
  }
}

type TauMemoryRouteProofState =
  | { ok: true; receipt: TauMemoryRouteProofView }
  | { ok: false; error: string; detail?: string; manifestPath?: string; proofRoot?: string }

type TauAnswerRouteBrowserProofView = {
  schema: 'tau.answer_route_browser_proof_view.v1'
  ok: boolean
  manifestPath: string
  proofRoot: string
  sourceSchema: string
  createdAt?: string | null
  mocked: false
  live: true
  scope?: string | null
  prompt: string
  url: string
  proofJson: string
  screenshot: string
  memoryRequestCount: number
  hasIntent200: boolean
  hasAnswer200: boolean
  visibleAssertions: Record<string, unknown>
  priorFailClosed: {
    present: boolean
    answer502: boolean
  }
  claims: {
    proves: string[]
    does_not_prove: string[]
  }
}

type TauAnswerRouteBrowserProofState =
  | { ok: true; receipt: TauAnswerRouteBrowserProofView }
  | { ok: false; error: string; detail?: string; manifestPath?: string; proofRoot?: string }

type TauWatchdogReceiptChainView = {
  schema: 'tau.watchdog_receipt_chain_view.v1'
  ok: true
  manifestPath: string
  proofRoot: string
  sourceSchema: string
  mocked: false
  live: true
  runId: string
  scope?: string | null
  issue: {
    number: number
    url: string
    title: string
    finalState: string
    finalLabels: string[]
    commentCount: number
  }
  inputs: {
    action?: string | null
    start?: string | null
    maxSteps?: number | null
    activeGoalHash?: string | null
    applyTransport?: boolean | null
    issue?: string | null
  }
  watchdog: {
    receipt?: string | null
    status?: string | null
    handledCount?: number | null
    leaseCommentSeen?: boolean | null
    evidenceCommentSeen?: boolean | null
  }
  commandLoop: {
    receipt?: string | null
    stepReceipt?: string | null
    status?: string | null
    stepCount?: number | null
    selectedAgent?: string | null
    selectedAgentCommandExitCode?: number | null
    stopReason?: string | null
    terminalAgent?: string | null
  }
  githubTransport: {
    receipt?: string | null
    dryRun?: boolean | null
    applied?: boolean | null
  }
  claims: {
    proves: string[]
    does_not_prove: string[]
  }
}

type TauWatchdogReceiptChainState =
  | { ok: true; receipt: TauWatchdogReceiptChainView }
  | { ok: false; error: string; detail?: string; manifestPath?: string; proofRoot?: string }

export class TauReceiptAdapter implements MemoryTurnAdapter {
  readonly name = 'TauReceiptAdapter'
  readonly branch: TurnBranch = 'compliance'

  constructor(
    private readonly memoryTransport: TauMemoryTransport = postMemoryProduct,
    private readonly commandLoopGithubProjection?: TauCommandLoopGithubProjectionReceipt,
    private readonly handoffTransportValidator: TauHandoffTransportValidator = postTauHandoffTransportValidation,
    private readonly handoffOrchestratorIntakePoster: TauHandoffOrchestratorIntakePoster = postTauHandoffOrchestratorIntake,
    private readonly subagentReceiptExpectationPoster: TauSubagentReceiptExpectationPoster = postTauSubagentReceiptExpectation,
    private readonly subagentHandoffValidator: TauSubagentHandoffValidator = postTauSubagentHandoffValidation,
    private readonly externalSubagentReceiptIntakePoster: TauExternalSubagentReceiptIntakePoster = postTauExternalSubagentReceiptIntake,
    private readonly externalSubagentGithubProjectionPoster: TauExternalSubagentGithubProjectionPoster = postTauExternalSubagentGithubProjection,
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
    const handoffAction = effectiveHandoffActionForRoute(intent, route)
    const handoff = buildTauRouteHandoff({
      action: handoffAction,
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
    const handoffGithubTransportReceipt = deriveTauHandoffGithubTransportReceipt(handoffGithubProjection)
    let handoffGithubTransportValidation: TauHandoffGithubTransportValidation | null = null
    let handoffOrchestratorIntake: TauHandoffOrchestratorIntake | null = null
    let subagentReceiptExpectation: TauSubagentReceiptExpectation | null = null
    let candidateSubagentHandoff: TauAgentCandidateHandoff | null = null
    let subagentHandoffValidation: TauSubagentHandoffValidation | null = null
    let externalSubagentReceipt: TauAgentCandidateHandoff | null = null
    let externalSubagentReceiptIntake: TauExternalSubagentReceiptIntake | null = null
    let externalSubagentGithubProjection: TauExternalSubagentGithubProjection | null = null
    try {
      handoffGithubTransportValidation = await this.handoffTransportValidator(
        handoffGithubTransportReceipt,
        input.abortSignal,
      )
      if (!handoffGithubTransportValidation.ok) {
        throw new Error('Tau handoff transport validator returned ok=false')
      }
      handoffOrchestratorIntake = await this.handoffOrchestratorIntakePoster(
        handoffGithubTransportValidation,
        input.abortSignal,
      )
      if (!handoffOrchestratorIntake.ok || !handoffOrchestratorIntake.accepted) {
        throw new Error('Tau handoff orchestrator intake returned ok=false')
      }
      subagentReceiptExpectation = await this.subagentReceiptExpectationPoster(
        handoffOrchestratorIntake,
        input.abortSignal,
      )
      if (!subagentReceiptExpectation.ok) {
        throw new Error('Tau subagent receipt expectation returned ok=false')
      }
      candidateSubagentHandoff = buildCandidateSubagentHandoff(subagentReceiptExpectation)
      subagentHandoffValidation = await this.subagentHandoffValidator(
        {
          expectation: subagentReceiptExpectation,
          handoff: candidateSubagentHandoff,
        },
        input.abortSignal,
      )
      if (!subagentHandoffValidation.ok) {
        throw new Error('Tau subagent handoff validator returned ok=false')
      }
      externalSubagentReceipt = buildExternalSubagentReceiptFixture(subagentReceiptExpectation)
      externalSubagentReceiptIntake = await this.externalSubagentReceiptIntakePoster(
        {
          expectation: subagentReceiptExpectation,
          receipt: externalSubagentReceipt,
          externalReceiptId: `${subagentReceiptExpectation.nextAgent}-fixture-receipt`,
        },
        input.abortSignal,
      )
      if (!externalSubagentReceiptIntake.ok || !externalSubagentReceiptIntake.accepted) {
        throw new Error('Tau external subagent receipt intake returned ok=false')
      }
      externalSubagentGithubProjection = await this.externalSubagentGithubProjectionPoster(
        {
          intake: externalSubagentReceiptIntake,
          receipt: externalSubagentReceipt,
        },
        input.abortSignal,
      )
      if (!externalSubagentGithubProjection.ok) {
        throw new Error('Tau external subagent GitHub projection returned ok=false')
      }
    } catch (error) {
      const validationError = error instanceof Error ? error.message : String(error)
      const message = makeFinalMessage({
        branch: route.branch,
        content: [
          'Tau stopped fail-closed while validating the GitHub transport or orchestrator intake receipt.',
          '',
          `Error: ${validationError}`,
          '',
          '| Contract field | Current experiment state |',
          '| --- | --- |',
          '| Memory-first routing | completed before transport validation |',
          '| GitHub/subagent handoff | not emitted because the transport/intake receipt was not server-accepted |',
          '| Mutation applied | false |',
          '| Production Sparta Chat | not claimed from this preview |',
          '',
          'This is fail-closed: Tau is not publishing a handoff that the server transport boundary refused.',
        ].join('\n'),
        reasoningSteps: streamingStepsToThinkingTrace(steps),
        metadata: {
          source: 'tau-receipt-adapter',
          memoryBacked: false,
          memoryIntent: summarizeMemoryIntent(intent),
          memoryProduct: memoryProductSummary,
          tauStageTrace,
          tauCurrentStage: currentStage,
          tauAgentHandoffValidation: {
            ok: false,
            errors: ['transport_receipt_validation_failed'],
            nextAgent: handoffValidation.nextAgent ?? null,
          },
          tauAgentHandoffGithubProjection: handoffGithubProjection,
          tauAgentHandoffGithubTransportReceipt: handoffGithubTransportReceipt,
          tauAgentHandoffGithubTransportValidation: {
            ok: false,
            error: validationError,
          },
          tauAgentHandoffOrchestratorIntake: handoffOrchestratorIntake
            ? handoffOrchestratorIntake
            : { ok: false, error: validationError },
          tauSubagentReceiptExpectation: subagentReceiptExpectation
            ? subagentReceiptExpectation
            : { ok: false, error: validationError },
          tauCandidateSubagentHandoff: candidateSubagentHandoff,
          tauSubagentHandoffValidation: subagentHandoffValidation
            ? subagentHandoffValidation
            : { ok: false, error: validationError },
          tauExternalSubagentReceipt: externalSubagentReceipt,
          tauExternalSubagentReceiptIntake: externalSubagentReceiptIntake
            ? externalSubagentReceiptIntake
            : { ok: false, error: validationError },
          tauExternalSubagentGithubProjection: externalSubagentGithubProjection
            ? externalSubagentGithubProjection
            : { ok: false, error: validationError },
          tauCommandLoopGithubProjection: this.commandLoopGithubProjection ?? null,
          tauReceiptPaths,
        },
      })
      yield makeFinalStep(message, route.branch)
      return message
    }

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
      renderTauHandoffGithubProjectionJsonBlock(handoffGithubProjection),
      '',
      renderTauHandoffGithubTransportReceiptJsonBlock(handoffGithubTransportReceipt),
      '',
      renderTauHandoffGithubTransportValidationJsonBlock(handoffGithubTransportValidation),
      '',
      renderTauHandoffOrchestratorIntakeJsonBlock(handoffOrchestratorIntake),
      '',
      renderTauSubagentReceiptExpectationJsonBlock(subagentReceiptExpectation),
      '',
      renderTauCandidateSubagentHandoffJsonBlock(candidateSubagentHandoff),
      '',
      renderTauSubagentHandoffValidationJsonBlock(subagentHandoffValidation),
      '',
      renderTauExternalSubagentReceiptJsonBlock(externalSubagentReceipt),
      '',
      renderTauExternalSubagentReceiptIntakeJsonBlock(externalSubagentReceiptIntake),
      '',
      renderTauExternalSubagentGithubProjectionJsonBlock(externalSubagentGithubProjection),
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
        tauAgentHandoffGithubTransportReceipt: handoffGithubTransportReceipt,
        tauAgentHandoffGithubTransportValidation: handoffGithubTransportValidation,
        tauAgentHandoffOrchestratorIntake: handoffOrchestratorIntake,
        tauSubagentReceiptExpectation: subagentReceiptExpectation,
        tauCandidateSubagentHandoff: candidateSubagentHandoff,
        tauSubagentHandoffValidation: subagentHandoffValidation,
        tauExternalSubagentReceipt: externalSubagentReceipt,
        tauExternalSubagentReceiptIntake: externalSubagentReceiptIntake,
        tauExternalSubagentGithubProjection: externalSubagentGithubProjection,
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
  top_intents?: unknown
  candidate_intents?: unknown
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

async function postTauHandoffTransportValidation(
  receipt: TauHandoffGithubTransportReceipt,
  signal?: AbortSignal,
): Promise<TauHandoffGithubTransportValidation> {
  const response = await fetch(apiUrl('/tau/handoff/transport/validate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(receipt),
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
    throw new Error(`Tau transport validator failed with ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  }
  const receiptPayload =
    typeof parsed === 'object' && parsed && 'receipt' in parsed
      ? (parsed as { receipt?: unknown }).receipt
      : null
  if (!receiptPayload || typeof receiptPayload !== 'object') {
    throw new Error('Tau transport validator returned no receipt')
  }
  return receiptPayload as TauHandoffGithubTransportValidation
}

async function postTauHandoffOrchestratorIntake(
  validation: TauHandoffGithubTransportValidation,
  signal?: AbortSignal,
): Promise<TauHandoffOrchestratorIntake> {
  const response = await fetch(apiUrl('/tau/handoff/orchestrator/intake'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validation),
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
    throw new Error(`Tau orchestrator intake failed with ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  }
  const receiptPayload =
    typeof parsed === 'object' && parsed && 'receipt' in parsed
      ? (parsed as { receipt?: unknown }).receipt
      : null
  if (!receiptPayload || typeof receiptPayload !== 'object') {
    throw new Error('Tau orchestrator intake returned no receipt')
  }
  return receiptPayload as TauHandoffOrchestratorIntake
}

async function postTauSubagentReceiptExpectation(
  intake: TauHandoffOrchestratorIntake,
  signal?: AbortSignal,
): Promise<TauSubagentReceiptExpectation> {
  const response = await fetch(apiUrl('/tau/handoff/subagent-receipt/expectation'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(intake),
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
    throw new Error(`Tau subagent receipt expectation failed with ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  }
  const receiptPayload =
    typeof parsed === 'object' && parsed && 'receipt' in parsed
      ? (parsed as { receipt?: unknown }).receipt
      : null
  if (!receiptPayload || typeof receiptPayload !== 'object') {
    throw new Error('Tau subagent receipt expectation returned no receipt')
  }
  return receiptPayload as TauSubagentReceiptExpectation
}

async function postTauSubagentHandoffValidation(
  payload: {
    expectation: TauSubagentReceiptExpectation
    handoff: TauAgentCandidateHandoff
  },
  signal?: AbortSignal,
): Promise<TauSubagentHandoffValidation> {
  const response = await fetch(apiUrl('/tau/handoff/subagent-receipt/validate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
    throw new Error(`Tau subagent handoff validation failed with ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  }
  const receiptPayload =
    typeof parsed === 'object' && parsed && 'receipt' in parsed
      ? (parsed as { receipt?: unknown }).receipt
      : null
  if (!receiptPayload || typeof receiptPayload !== 'object') {
    throw new Error('Tau subagent handoff validation returned no receipt')
  }
  return receiptPayload as TauSubagentHandoffValidation
}

async function postTauExternalSubagentReceiptIntake(
  payload: {
    expectation: TauSubagentReceiptExpectation
    receipt: TauAgentCandidateHandoff
    externalReceiptId?: string
  },
  signal?: AbortSignal,
): Promise<TauExternalSubagentReceiptIntake> {
  const response = await fetch(apiUrl('/tau/handoff/subagent-receipt/intake'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
    throw new Error(`Tau external subagent receipt intake failed with ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  }
  const receiptPayload =
    typeof parsed === 'object' && parsed && 'receipt' in parsed
      ? (parsed as { receipt?: unknown }).receipt
      : null
  if (!receiptPayload || typeof receiptPayload !== 'object') {
    throw new Error('Tau external subagent receipt intake returned no receipt')
  }
  return receiptPayload as TauExternalSubagentReceiptIntake
}

async function postTauExternalSubagentGithubProjection(
  payload: {
    intake: TauExternalSubagentReceiptIntake
    receipt: TauAgentCandidateHandoff
  },
  signal?: AbortSignal,
): Promise<TauExternalSubagentGithubProjection> {
  const response = await fetch(apiUrl('/tau/handoff/subagent-receipt/github-projection'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
    throw new Error(`Tau external subagent GitHub projection failed with ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  }
  const receiptPayload =
    typeof parsed === 'object' && parsed && 'receipt' in parsed
      ? (parsed as { receipt?: unknown }).receipt
      : null
  if (!receiptPayload || typeof receiptPayload !== 'object') {
    throw new Error('Tau external subagent GitHub projection returned no receipt')
  }
  return receiptPayload as TauExternalSubagentGithubProjection
}

export async function loadTauChatUxContract(signal?: AbortSignal): Promise<TauChatUxContractState> {
  const response = await fetch(apiUrl('/tau/chat/ux-contract'), { signal })
  const payload = await response.json().catch(() => ({})) as {
    ok?: boolean
    receipt?: TauChatUxContractView
    error?: string
    detail?: string
    contractPath?: string
  }
  if (!response.ok || !payload.ok || !payload.receipt) {
    return {
      ok: false,
      error: payload.error ?? `tau_chat_ux_contract_http_${response.status}`,
      detail: payload.detail,
      contractPath: payload.contractPath,
    }
  }
  return { ok: true, receipt: payload.receipt }
}

export async function loadTauMemoryRouteProof(signal?: AbortSignal): Promise<TauMemoryRouteProofState> {
  const response = await fetch(apiUrl('/tau/memory/routes/failclosed-proof'), { signal })
  const payload = await response.json().catch(() => ({})) as {
    ok?: boolean
    receipt?: TauMemoryRouteProofView
    error?: string
    detail?: string
    manifestPath?: string
    proofRoot?: string
  }
  if (!response.ok || !payload.ok || !payload.receipt) {
    return {
      ok: false,
      error: payload.error ?? `tau_memory_route_proof_http_${response.status}`,
      detail: payload.detail,
      manifestPath: payload.manifestPath,
      proofRoot: payload.proofRoot,
    }
  }
  return { ok: true, receipt: payload.receipt }
}

export async function loadTauAnswerRouteBrowserProof(signal?: AbortSignal): Promise<TauAnswerRouteBrowserProofState> {
  const response = await fetch(apiUrl('/tau/memory/routes/answer-browser-proof'), { signal })
  const payload = await response.json().catch(() => ({})) as {
    ok?: boolean
    receipt?: TauAnswerRouteBrowserProofView
    error?: string
    detail?: string
    manifestPath?: string
    proofRoot?: string
  }
  if (!response.ok || !payload.ok || !payload.receipt) {
    return {
      ok: false,
      error: payload.error ?? `tau_answer_route_proof_http_${response.status}`,
      detail: payload.detail,
      manifestPath: payload.manifestPath,
      proofRoot: payload.proofRoot,
    }
  }
  return { ok: true, receipt: payload.receipt }
}

export async function loadTauWatchdogReceiptChain(signal?: AbortSignal): Promise<TauWatchdogReceiptChainState> {
  const response = await fetch(apiUrl('/tau/watchdog/receipt-chain'), { signal })
  const payload = await response.json().catch(() => ({})) as {
    ok?: boolean
    receipt?: TauWatchdogReceiptChainView
    error?: string
    detail?: string
    manifestPath?: string
    proofRoot?: string
  }
  if (!response.ok || !payload.ok || !payload.receipt) {
    return {
      ok: false,
      error: payload.error ?? `tau_watchdog_receipt_chain_http_${response.status}`,
      detail: payload.detail,
      manifestPath: payload.manifestPath,
      proofRoot: payload.proofRoot,
    }
  }
  return { ok: true, receipt: payload.receipt }
}

function renderTauHandoffGithubTransportValidationJsonBlock(
  validation: TauHandoffGithubTransportValidation,
): string {
  return [
    '### Tau handoff GitHub transport server validation JSON contract',
    '',
    '```json',
    JSON.stringify(validation, null, 2),
    '```',
  ].join('\n')
}

function renderTauHandoffOrchestratorIntakeJsonBlock(
  intake: TauHandoffOrchestratorIntake,
): string {
  return [
    '### Tau handoff orchestrator intake JSON contract',
    '',
    '```json',
    JSON.stringify(intake, null, 2),
    '```',
  ].join('\n')
}

function renderTauSubagentReceiptExpectationJsonBlock(
  expectation: TauSubagentReceiptExpectation,
): string {
  return [
    '### Tau subagent receipt expectation JSON contract',
    '',
    '```json',
    JSON.stringify(expectation, null, 2),
    '```',
  ].join('\n')
}

function renderTauCandidateSubagentHandoffJsonBlock(
  handoff: TauAgentCandidateHandoff,
): string {
  return [
    '### Tau candidate subagent handoff JSON contract',
    '',
    '```json',
    JSON.stringify(handoff, null, 2),
    '```',
  ].join('\n')
}

function renderTauSubagentHandoffValidationJsonBlock(
  validation: TauSubagentHandoffValidation,
): string {
  return [
    '### Tau subagent handoff validation JSON contract',
    '',
    '```json',
    JSON.stringify(validation, null, 2),
    '```',
  ].join('\n')
}

function renderTauExternalSubagentReceiptJsonBlock(
  receipt: TauAgentCandidateHandoff,
): string {
  return [
    '### Tau external subagent receipt fixture JSON contract',
    '',
    '```json',
    JSON.stringify(receipt, null, 2),
    '```',
  ].join('\n')
}

function renderTauExternalSubagentReceiptIntakeJsonBlock(
  intake: TauExternalSubagentReceiptIntake,
): string {
  return [
    '### Tau external subagent receipt intake JSON contract',
    '',
    '```json',
    JSON.stringify(intake, null, 2),
    '```',
  ].join('\n')
}

function renderTauExternalSubagentGithubProjectionJsonBlock(
  projection: TauExternalSubagentGithubProjection,
): string {
  const renderedProjection = {
    ...projection,
    comment: {
      body_format: projection.comment.body_format,
      body_marker: projection.comment.body_marker,
      body_embeds_handoff_json: projection.comment.body_embeds_handoff_json,
      body_length: projection.comment.body.length,
      body_preview: projection.comment.body.slice(0, 160),
    },
  }
  return [
    '### Tau external subagent GitHub projection JSON contract',
    '',
    '```json',
    JSON.stringify(renderedProjection, null, 2),
    '```',
  ].join('\n')
}

function buildCandidateSubagentHandoff(expectation: TauSubagentReceiptExpectation): TauAgentCandidateHandoff {
  return {
    schema: 'tau.agent_handoff.v1',
    github: {
      repo: expectation.target.repo,
      target: expectation.target.target,
    },
    goal: {
      goal_id: expectation.goal.goal_id,
      goal_version: expectation.goal.goal_version,
      goal_hash: expectation.goal.goal_hash,
    },
    previous_subagent: expectation.requiredReceipt.previous_subagent,
    context: {
      summary: `Dry-run candidate receipt for ${expectation.nextAgent}; no subagent executed.`,
      artifacts: expectation.artifactPath ? [expectation.artifactPath] : [],
    },
    result: {
      status: 'NOOP',
      summary: 'Candidate receipt shape was generated only to validate the next-subagent handoff contract.',
      evidence: expectation.artifactPath ? [expectation.artifactPath] : ['tau.subagent_receipt_expectation.v1 rendered in chat'],
    },
    rationale: 'Tau must prove the receipt contract before dispatching a real subagent.',
    next_agent: {
      name: 'human',
      executor: 'human',
      reason: 'Stop after dry-run candidate validation; real subagent execution is a later rung.',
    },
    required_evidence: ['Human-approved live subagent execution receipt.'],
    stop_condition: 'Human approves a real subagent execution step or routes to another dry-run harness rung.',
  }
}

function buildExternalSubagentReceiptFixture(expectation: TauSubagentReceiptExpectation): TauAgentCandidateHandoff {
  return {
    schema: 'tau.agent_handoff.v1',
    github: {
      repo: expectation.target.repo,
      target: expectation.target.target,
    },
    goal: {
      goal_id: expectation.goal.goal_id,
      goal_version: expectation.goal.goal_version,
      goal_hash: expectation.goal.goal_hash,
    },
    previous_subagent: expectation.requiredReceipt.previous_subagent,
    context: {
      summary: `External ${expectation.nextAgent} receipt fixture for Tau intake validation; no subagent executed in this browser proof.`,
      artifacts: expectation.artifactPath ? [expectation.artifactPath] : [],
    },
    result: {
      status: 'COMPLETED',
      summary: 'Fixture receipt was supplied to prove Tau can ingest an external subagent handoff contract.',
      evidence: expectation.artifactPath ? [expectation.artifactPath] : ['tau.subagent_receipt_expectation.v1 rendered in chat'],
    },
    rationale: 'Tau should derive the next route from the accepted external receipt, not from hidden model state.',
    next_agent: {
      name: 'human',
      executor: 'human',
      reason: 'Stop after dry-run external receipt intake; human decides whether to authorize real subagent execution.',
    },
    required_evidence: ['Human-approved live subagent execution receipt.'],
    stop_condition: 'Human approves the next live execution step or routes to another dry-run harness rung.',
  }
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
  if (shouldClarifyLowConfidenceIntent(intent)) {
    return {
      branch: 'compliance',
      endpoint: '/clarify',
      stepId: 'clarifying',
      label: 'Clarifying',
      liveStatusLabel: 'Clarifying...',
      detail: 'Memory intent confidence is below Tau\'s routing threshold, so Tau asks for clarification instead of forcing the selected route.',
      finalLead: 'Tau routed this low-confidence Memory intent to Memory clarify.',
      body: (query) => ({
        q: query,
        scope: 'tau',
        context: 'Tau routed this turn to clarify because Memory /intent confidence was below the routing threshold.',
        k: 5,
      }),
      completedDetail: (product) => summarizeProductStatus(product, 'Clarify product returned.'),
    }
  }
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

function shouldClarifyLowConfidenceIntent(intent: TauMemoryIntentResponse): boolean {
  const action = (intent.action || '').toUpperCase()
  if (action === 'CLARIFY' || action === 'DEFLECT' || action === 'NO_MATCH' || action === 'OFF_TOPIC') return false
  if (typeof intent.confidence !== 'number' || !Number.isFinite(intent.confidence)) return false
  return intent.confidence < 0.6 || intentTopTwoAreTooClose(intent)
}

function intentTopTwoAreTooClose(intent: TauMemoryIntentResponse): boolean {
  const candidates = Array.isArray(intent.top_intents)
    ? intent.top_intents
    : Array.isArray(intent.candidate_intents)
      ? intent.candidate_intents
      : []
  const confidences = candidates
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
      const confidence = (candidate as { confidence?: unknown }).confidence
      return typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : null
    })
    .filter((confidence): confidence is number => confidence !== null)
    .sort((left, right) => right - left)
  if (confidences.length < 2) return false
  return Math.abs(confidences[0] - confidences[1]) < 0.08
}

function effectiveHandoffActionForRoute(intent: TauMemoryIntentResponse, route: TauRoute): string | undefined {
  if (route.endpoint === '/clarify') return 'CLARIFY'
  if (route.endpoint === '/deflect') return 'DEFLECT'
  return intent.action
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
    .filter((step) => step.kind !== 'final' && step.liveStatusLabel)
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

export type TauTuiMirrorState = {
  runId: string
  active: boolean
  currentStage: TauPipelineStageReceipt
  trace: TauPipelineStageReceipt[]
  route: string
  nextAgent: string
  personaVoice: string
}

export type TauTuiReceiptStreamView = {
  schema: 'tau.tui_receipt_stream_view.v1'
  ok: true
  mocked: false
  live: true
  runId: string
  runDir: string
  eventsPath: string
  finalReceiptPath: string
  eventCount: number
  status: string
  proofScope: string | null
  transportRunId: string | null
  streamEventCount: number | null
  latestEventType: string | null
  terminalLines: string[]
  claims: {
    proves: string[]
    does_not_prove: string[]
  }
}

type TauTuiReceiptStreamState =
  | { ok: true; receipt: TauTuiReceiptStreamView }
  | { ok: false; detail: string; runDir?: string }

export type TauTextualTuiProofView = {
  schema: 'tau.textual_tui_proof_view.v1'
  ok: true
  mocked: true
  live: false
  manifestPath: string
  proofRoot: string
  sourceSchema: string
  runId: string
  prompt: string
  status: string | null
  entrypoint: string | null
  sourceType: string | null
  receiptPath: string
  screenshotSvg: string
  screenshotPng: string
  visibleAssertions: string[]
  textAssertions: string[]
  doesNotProve: string[]
  claims: {
    proves: string[]
    does_not_prove: string[]
  }
}

type TauTextualTuiProofState =
  | { ok: true; receipt: TauTextualTuiProofView }
  | { ok: false; detail: string; manifestPath?: string; proofRoot?: string }

export type TauPersonaplexEmbryReceiptGate = {
  schema: 'tau.personaplex_embry_receipt_gate.v1'
  ok: true
  available: boolean
  failClosed: boolean
  persona: 'embry'
  voiceEngine: 'personaplex'
  requiredSchema: 'personaplex.publish_receipt.v1'
  requiredStatus: 'CACHE_REPLAY_PASS'
  receiptPath: string
  metadataReceiptPath: string
  metadataVoiceStatus?: string
  reason?: string
  status?: string
  publicationStatus?: string
  humanReviewStatus?: string
  promptCount?: number
  reviewHtml?: string | null
  claims: {
    proves: string[]
    does_not_prove: string[]
  }
}

type TauPersonaplexEmbryReceiptState =
  | { ok: true; receipt: TauPersonaplexEmbryReceiptGate }
  | { ok: false; detail: string; receiptPath?: string; receipt?: TauPersonaplexEmbryReceiptGate }

function isTauTuiReceiptStreamView(value: unknown): value is TauTuiReceiptStreamView {
  if (!isRecord(value)) return false
  return (
    value.schema === 'tau.tui_receipt_stream_view.v1' &&
    value.ok === true &&
    value.mocked === false &&
    value.live === true &&
    typeof value.runId === 'string' &&
    typeof value.runDir === 'string' &&
    typeof value.eventsPath === 'string' &&
    typeof value.finalReceiptPath === 'string' &&
    typeof value.eventCount === 'number' &&
    typeof value.status === 'string' &&
    Array.isArray(value.terminalLines) &&
    value.terminalLines.every((line) => typeof line === 'string') &&
    isRecord(value.claims) &&
    Array.isArray(value.claims.proves) &&
    Array.isArray(value.claims.does_not_prove)
  )
}

async function loadTauTuiReceiptStream(): Promise<TauTuiReceiptStreamState> {
  const response = await fetch(apiUrl('/api/tau/tui/receipt-stream'))
  const payload = (await response.json()) as unknown
  if (!response.ok || !isRecord(payload) || payload.ok !== true || !isTauTuiReceiptStreamView(payload.receipt)) {
    const detail = isRecord(payload) && typeof payload.detail === 'string'
      ? payload.detail
      : `Tau TUI receipt stream unavailable: HTTP ${response.status}`
    return {
      ok: false,
      detail,
      runDir: isRecord(payload) && typeof payload.runDir === 'string' ? payload.runDir : undefined,
    }
  }
  return { ok: true, receipt: payload.receipt }
}

function isTauTextualTuiProofView(value: unknown): value is TauTextualTuiProofView {
  if (!isRecord(value)) return false
  return (
    value.schema === 'tau.textual_tui_proof_view.v1' &&
    value.ok === true &&
    value.mocked === true &&
    value.live === false &&
    typeof value.manifestPath === 'string' &&
    typeof value.proofRoot === 'string' &&
    typeof value.sourceSchema === 'string' &&
    typeof value.runId === 'string' &&
    typeof value.prompt === 'string' &&
    typeof value.receiptPath === 'string' &&
    typeof value.screenshotSvg === 'string' &&
    typeof value.screenshotPng === 'string' &&
    Array.isArray(value.visibleAssertions) &&
    value.visibleAssertions.every((item) => typeof item === 'string') &&
    Array.isArray(value.textAssertions) &&
    value.textAssertions.every((item) => typeof item === 'string') &&
    Array.isArray(value.doesNotProve) &&
    value.doesNotProve.every((item) => typeof item === 'string') &&
    isRecord(value.claims) &&
    Array.isArray(value.claims.proves) &&
    Array.isArray(value.claims.does_not_prove)
  )
}

async function loadTauTextualTuiProof(): Promise<TauTextualTuiProofState> {
  const response = await fetch(apiUrl('/api/tau/tui/textual-proof'))
  const payload = (await response.json()) as unknown
  if (!response.ok || !isRecord(payload) || payload.ok !== true || !isTauTextualTuiProofView(payload.receipt)) {
    const detail = isRecord(payload) && typeof payload.detail === 'string'
      ? payload.detail
      : `Tau Textual TUI proof unavailable: HTTP ${response.status}`
    return {
      ok: false,
      detail,
      manifestPath: isRecord(payload) && typeof payload.manifestPath === 'string' ? payload.manifestPath : undefined,
      proofRoot: isRecord(payload) && typeof payload.proofRoot === 'string' ? payload.proofRoot : undefined,
    }
  }
  return { ok: true, receipt: payload.receipt }
}

export function textualTuiProofCardSummary(state: TauTextualTuiProofState | null): {
  label: string
  detail: string
  artifact: string
  mocked: string
  live: string
} {
  if (!state) {
    return {
      label: 'LOADING',
      detail: 'Checking for a repeatable Tau Textual TUI renderer proof.',
      artifact: 'manifest path pending',
      mocked: 'unknown',
      live: 'unknown',
    }
  }
  if (!state.ok) {
    return {
      label: 'UNAVAILABLE',
      detail: `Fail-closed: ${state.detail}`,
      artifact: state.manifestPath ?? state.proofRoot ?? 'manifest path unavailable',
      mocked: 'unknown',
      live: 'unknown',
    }
  }
  return {
    label: 'FIXTURE PROOF',
    detail: 'Real Tau Textual renderer proof is attached, but it uses a fixture session and does not claim a live TUI process.',
    artifact: state.receipt.screenshotPng,
    mocked: String(state.receipt.mocked),
    live: String(state.receipt.live),
  }
}

function isTauPersonaplexEmbryReceiptGate(value: unknown): value is TauPersonaplexEmbryReceiptGate {
  if (!isRecord(value)) return false
  return (
    value.schema === 'tau.personaplex_embry_receipt_gate.v1' &&
    value.ok === true &&
    typeof value.available === 'boolean' &&
    typeof value.failClosed === 'boolean' &&
    value.persona === 'embry' &&
    value.voiceEngine === 'personaplex' &&
    value.requiredSchema === 'personaplex.publish_receipt.v1' &&
    value.requiredStatus === 'CACHE_REPLAY_PASS' &&
    typeof value.receiptPath === 'string' &&
    typeof value.metadataReceiptPath === 'string' &&
    isRecord(value.claims) &&
    Array.isArray(value.claims.proves) &&
    Array.isArray(value.claims.does_not_prove)
  )
}

async function loadTauPersonaplexEmbryReceipt(): Promise<TauPersonaplexEmbryReceiptState> {
  const response = await fetch(apiUrl('/api/tau/personaplex/embry-receipt'))
  const payload = (await response.json()) as unknown
  const receipt = isRecord(payload) && isTauPersonaplexEmbryReceiptGate(payload.receipt) ? payload.receipt : null
  if (receipt?.available) return { ok: true, receipt }
  if (receipt) {
    return {
      ok: false,
      receipt,
      detail: receipt.reason ?? 'PersonaPlex Embry receipt gate unavailable.',
      receiptPath: receipt.receiptPath,
    }
  }
  return {
    ok: false,
    detail: isRecord(payload) && typeof payload.detail === 'string'
      ? payload.detail
      : `PersonaPlex Embry receipt gate unavailable: HTTP ${response.status}`,
    receiptPath: isRecord(payload) && typeof payload.receiptPath === 'string' ? payload.receiptPath : undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isTauStageReceipt(value: unknown): value is TauPipelineStageReceipt {
  return (
    isRecord(value) &&
    value.schema === 'tau.loop2_pipeline_stage.v1' &&
    typeof value.stage === 'string' &&
    typeof value.label === 'string' &&
    typeof value.status === 'string' &&
    typeof value.source === 'string'
  )
}

function readStringFromRecord(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null
  const found = value[key]
  return typeof found === 'string' && found.trim() ? found : null
}

function readStoredPaneWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export type TauAnnotationBbox = [number, number, number, number]

export type TauAnnotationBox = {
  id: string
  bbox: TauAnnotationBbox
  characterName: string
  actorName: string
  status: 'draft' | 'local_receipt_ready' | 'receipt_written'
  receiptPath?: string
}

type TauAnnotationSegment = {
  id: string
  label: string
  startSeconds: number
  endSeconds: number
}

export type TauAnnotationDraft = {
  segmentId: string
  characterName: string
  actorName: string
  playheadSeconds: number
  draftBbox: TauAnnotationBbox | null
  boxes: TauAnnotationBox[]
  status: string
  receiptPath?: string
  receiptRunId?: string
}

const TAU_ANNOTATION_DRAFT_PREFIX = 'ux-lab:tau:annotation-draft'

const TAU_ANNOTATION_SEGMENTS: TauAnnotationSegment[] = [
  { id: 'seg-001', label: '01:36-02:00 · identity reference', startSeconds: 96, endSeconds: 120 },
  { id: 'seg-002', label: '02:00-02:24 · dialogue turn', startSeconds: 120, endSeconds: 144 },
  { id: 'seg-003', label: '02:24-02:48 · reaction shot', startSeconds: 144, endSeconds: 168 },
]

const TAU_CHARACTER_OPTIONS: Array<{ character: string; actor: string }> = [
  { character: 'Willie', actor: 'Billy Bob Thornton' },
  { character: 'Marcus', actor: 'Tony Cox' },
  { character: 'The Kid', actor: 'Brett Kelly' },
  { character: 'Sue', actor: 'Lauren Graham' },
]

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function normalizeTauDragBbox(
  start: { x: number; y: number },
  current: { x: number; y: number },
  rect: DOMRect,
): TauAnnotationBbox {
  const x1 = clamp01(Math.min(start.x, current.x) / rect.width)
  const y1 = clamp01(Math.min(start.y, current.y) / rect.height)
  const x2 = clamp01(Math.max(start.x, current.x) / rect.width)
  const y2 = clamp01(Math.max(start.y, current.y) / rect.height)
  return [x1, y1, x2, y2]
}

function tauBboxStyle(bbox: TauAnnotationBbox): CSSProperties {
  const [x1, y1, x2, y2] = bbox
  return {
    left: `${x1 * 100}%`,
    top: `${y1 * 100}%`,
    width: `${(x2 - x1) * 100}%`,
    height: `${(y2 - y1) * 100}%`,
  }
}

export function tauAnnotationLabelStyle(bbox: TauAnnotationBbox): CSSProperties {
  const [x1, y1] = bbox
  const remainingWidthPercent = Math.max(12, (1 - x1) * 100)
  return {
    position: 'absolute',
    left: `${x1 * 100}%`,
    top: `${y1 * 100}%`,
    transform: y1 < 0.12 ? 'translate(0, 2px)' : 'translate(0, -100%)',
    maxWidth: `min(280px, calc(${remainingWidthPercent}% - 8px))`,
    boxSizing: 'border-box',
    zIndex: 90,
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }
}

export function tauAnnotationDraftStorageKey(segmentId: string): string {
  return `${TAU_ANNOTATION_DRAFT_PREFIX}:${segmentId.replace(/[^a-zA-Z0-9:._-]+/g, '_')}`
}

function initialTauAnnotationDraft(segment: TauAnnotationSegment): TauAnnotationDraft {
  const firstCharacter = TAU_CHARACTER_OPTIONS[0]
  return {
    segmentId: segment.id,
    characterName: firstCharacter.character,
    actorName: firstCharacter.actor,
    playheadSeconds: segment.startSeconds,
    draftBbox: null,
    boxes: [],
    status: 'Move the playhead, select the character, then draw a face/body box.',
  }
}

function readTauAnnotationDraft(segment: TauAnnotationSegment): TauAnnotationDraft {
  if (typeof window === 'undefined') return initialTauAnnotationDraft(segment)
  try {
    const raw = window.localStorage.getItem(tauAnnotationDraftStorageKey(segment.id))
    if (!raw) return initialTauAnnotationDraft(segment)
    const parsed = JSON.parse(raw) as Partial<TauAnnotationDraft>
    if (!parsed || typeof parsed !== 'object') return initialTauAnnotationDraft(segment)
    return {
      ...initialTauAnnotationDraft(segment),
      ...parsed,
      segmentId: segment.id,
      boxes: Array.isArray(parsed.boxes) ? parsed.boxes : [],
      draftBbox: Array.isArray(parsed.draftBbox) && parsed.draftBbox.length === 4 ? parsed.draftBbox as TauAnnotationBbox : null,
      playheadSeconds: typeof parsed.playheadSeconds === 'number' ? parsed.playheadSeconds : segment.startSeconds,
    }
  } catch {
    return initialTauAnnotationDraft(segment)
  }
}

function writeTauAnnotationDraft(draft: TauAnnotationDraft): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(tauAnnotationDraftStorageKey(draft.segmentId), JSON.stringify(draft))
}

export function tauAnnotationReceiptPreview(draft: TauAnnotationDraft): Record<string, unknown> {
  const endpointAttached = Boolean(draft.receiptPath)
  return {
    schema: endpointAttached ? 'tau.watch_annotation_receipt_preview.v1' : 'tau.watch_annotation_local_draft.v1',
    persisted: endpointAttached ? 'tau_endpoint_receipt' : 'localStorage',
    receiptEndpointAttached: endpointAttached,
    receiptPath: draft.receiptPath ?? null,
    receiptRunId: draft.receiptRunId ?? null,
    segmentId: draft.segmentId,
    playheadSeconds: draft.playheadSeconds,
    boxCount: draft.boxes.length + (draft.draftBbox ? 1 : 0),
    claims: {
      proves: endpointAttached
        ? ['Tau annotation UI submitted a segment draft to the Tau annotation receipt endpoint.']
        : ['Tau annotation UI can preserve a local draft per segment.'],
      does_not_prove: endpointAttached
        ? ['Watch production annotation persistence', 'movie-library persistence', 'model identity correctness']
        : ['Watch annotation endpoint write', 'movie-library persistence', 'model identity correctness'],
    },
  }
}

export function deriveTauTuiMirrorState(
  messages: ChatMessage[],
  streamingSteps: StreamingStep[],
  isStreaming: boolean,
  configuredRunId?: string | null,
): TauTuiMirrorState {
  const streamingTrace = stageTraceFromStreamingSteps(streamingSteps)
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant' && isRecord(message.metadata))
  const metadata = latestAssistant?.metadata
  const metadataTrace = Array.isArray(metadata?.tauStageTrace)
    ? metadata.tauStageTrace.filter(isTauStageReceipt)
    : []
  const metadataCurrentStage = isTauStageReceipt(metadata?.tauCurrentStage) ? metadata.tauCurrentStage : null
  const trace = streamingTrace.length > 0 ? streamingTrace : metadataTrace.length > 0 ? metadataTrace : TAU_MEMORY_STAGE_TRACE
  const currentStage = streamingTrace[streamingTrace.length - 1] ?? metadataCurrentStage ?? trace[trace.length - 1] ?? TAU_MEMORY_STAGE_TRACE[0]
  const memoryIntent = metadata?.memoryIntent
  const handoffValidation = metadata?.tauAgentHandoffValidation
  return {
    runId: configuredRunId || latestAssistant?.id || 'no-active-turn',
    active: isStreaming || streamingTrace.some((stage) => stage.status === 'RUNNING'),
    currentStage,
    trace,
    route: readStringFromRecord(memoryIntent, 'action') ?? readStringFromRecord(memoryIntent, 'response_mode') ?? 'waiting',
    nextAgent: readStringFromRecord(handoffValidation, 'nextAgent') ?? 'not routed',
    personaVoice: readStringFromRecord(metadata, 'personaVoiceStatus') ?? 'not requested',
  }
}

export function terminalLinesFromTauTuiMirrorState(state: TauTuiMirrorState): string[] {
  const routeText = state.route === 'waiting' ? 'awaiting-memory-intent' : state.route
  const nextAgentText = state.nextAgent === 'not routed' ? 'none' : state.nextAgent
  return [
    '\x1b[36mtau@ux-lab\x1b[0m:\x1b[35m~/loop\x1b[0m$ run --memory-first --same-turn',
    `run_id=${state.runId}`,
    `route=${routeText} next_agent=${nextAgentText}`,
    `personaplex=${state.personaVoice}`,
    '',
    'memory pipeline:',
    ...state.trace.map((stage, index) => {
      const glyph = stage.status === 'FAILED' ? 'x' : stage.status === 'RUNNING' ? '>' : stage.status === 'SKIPPED' ? '-' : '+'
      const color = stage.status === 'FAILED' ? '\x1b[31m' : stage.status === 'RUNNING' ? '\x1b[33m' : stage.status === 'SKIPPED' ? '\x1b[38;5;208m' : '\x1b[32m'
      const current = stage.stage === state.currentStage.stage ? '\x1b[46;30m current \x1b[0m ' : ''
      return `${color}${glyph}\x1b[0m ${String(index + 1).padStart(2, '0')}. ${stage.label} \x1b[90m${stage.source}\x1b[0m ${current}\x1b[90m${stage.status}\x1b[0m`
    }),
    '',
    '\x1b[90msame-turn telemetry; PersonaPlex audio fail-closed until receipt\x1b[0m',
  ]
}

export function terminalLinesFromTauTuiReceiptStream(receipt: TauTuiReceiptStreamView): string[] {
  return receipt.terminalLines.map((line) => {
    if (line.startsWith('mocked=false live=true')) return `\x1b[32m${line}\x1b[0m`
    if (line.startsWith('event stream tail:')) return `\x1b[36m${line}\x1b[0m`
    if (line.startsWith('claims.does_not_prove=')) return `\x1b[38;5;208m${line}\x1b[0m`
    return line
  })
}

export function TauChatView(): JSX.Element {
  const [commandLoopProjectionState, setCommandLoopProjectionState] =
    useState<TauCommandLoopGithubProjectionState | null>(null)
  const [chatUxContractState, setChatUxContractState] = useState<TauChatUxContractState | null>(null)
  const [memoryRouteProofState, setMemoryRouteProofState] = useState<TauMemoryRouteProofState | null>(null)
  const [answerRouteProofState, setAnswerRouteProofState] = useState<TauAnswerRouteBrowserProofState | null>(null)
  const [watchdogReceiptChainState, setWatchdogReceiptChainState] = useState<TauWatchdogReceiptChainState | null>(null)
  const [tuiReceiptStreamState, setTuiReceiptStreamState] = useState<TauTuiReceiptStreamState | null>(null)
  const [textualTuiProofState, setTextualTuiProofState] = useState<TauTextualTuiProofState | null>(null)
  const [personaplexEmbryReceiptState, setPersonaplexEmbryReceiptState] =
    useState<TauPersonaplexEmbryReceiptState | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(sampleMessages)
  const [chatStreamingSteps, setChatStreamingSteps] = useState<StreamingStep[]>([])
  const [chatStreaming, setChatStreaming] = useState(false)
  const [annotationModalOpen, setAnnotationModalOpen] = useState(false)
  const [evidenceRailCollapsed, setEvidenceRailCollapsed] = useState(() =>
    typeof window === 'undefined' ? false : window.localStorage.getItem('tau:evidenceRailCollapsed') === 'true',
  )
  const proofRailResize = useHorizontalPaneResize({
    initial: readStoredPaneWidth('tau:proofRailWidth', 720, 420, 980),
    min: 420,
    max: 980,
  })
  const tuiPaneResize = useHorizontalPaneResize({
    initial: readStoredPaneWidth('tau:tuiPaneWidth', 300, 240, 620),
    min: 240,
    max: 620,
  })
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

  useRegisterAction('tau:annotation:open-modal', {
    app: 'ux-lab',
    action: 'TAU_OPEN_ANNOTATION_MODAL',
    label: 'Open Tau annotation workspace',
    description: 'Open the focused movie annotation modal for playhead, character selection, and bbox drafting',
    tags: ['tau', 'watch', 'annotation'],
  })
  useRegisterAction('tau:annotation:close-modal', {
    app: 'ux-lab',
    action: 'TAU_CLOSE_ANNOTATION_MODAL',
    label: 'Close Tau annotation workspace',
    description: 'Close the focused Tau annotation modal',
    tags: ['tau', 'watch', 'annotation'],
  })
  useRegisterAction('tau:annotation:approve-draft', {
    app: 'ux-lab',
    action: 'TAU_WRITE_ANNOTATION_RECEIPT',
    label: 'Write Tau annotation receipt',
    description: 'Submit the Tau annotation draft to the Tau receipt endpoint',
    tags: ['tau', 'watch', 'annotation'],
  })

  useEffect(() => {
    const controller = new AbortController()
    void loadTauChatUxContract(controller.signal)
      .then((state) => setChatUxContractState(state))
      .catch((error) => {
        if (controller.signal.aborted) return
        setChatUxContractState({
          ok: false,
          error: 'tau_chat_ux_contract_unavailable',
          detail: error instanceof Error ? error.message : String(error),
        })
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    window.localStorage.setItem('tau:proofRailWidth', String(proofRailResize.width))
  }, [proofRailResize.width])

  useEffect(() => {
    window.localStorage.setItem('tau:tuiPaneWidth', String(tuiPaneResize.width))
  }, [tuiPaneResize.width])

  useEffect(() => {
    const controller = new AbortController()
    void loadTauMemoryRouteProof(controller.signal)
      .then((state) => setMemoryRouteProofState(state))
      .catch((error) => {
        if (controller.signal.aborted) return
        setMemoryRouteProofState({
          ok: false,
          error: 'tau_memory_route_failclosed_proof_unavailable',
          detail: error instanceof Error ? error.message : String(error),
        })
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadTauAnswerRouteBrowserProof(controller.signal)
      .then((state) => setAnswerRouteProofState(state))
      .catch((error) => {
        if (controller.signal.aborted) return
        setAnswerRouteProofState({
          ok: false,
          error: 'tau_answer_route_browser_proof_unavailable',
          detail: error instanceof Error ? error.message : String(error),
        })
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadTauWatchdogReceiptChain(controller.signal)
      .then((state) => setWatchdogReceiptChainState(state))
      .catch((error) => {
        if (controller.signal.aborted) return
        setWatchdogReceiptChainState({
          ok: false,
          error: 'tau_watchdog_receipt_chain_unavailable',
          detail: error instanceof Error ? error.message : String(error),
        })
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadTauTuiReceiptStream()
      .then((state) => {
        if (!cancelled) setTuiReceiptStreamState(state)
      })
      .catch((error) => {
        if (!cancelled) {
          setTuiReceiptStreamState({
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadTauTextualTuiProof()
      .then((state) => {
        if (!cancelled) setTextualTuiProofState(state)
      })
      .catch((error) => {
        if (!cancelled) {
          setTextualTuiProofState({
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadTauPersonaplexEmbryReceipt()
      .then((state) => {
        if (!cancelled) setPersonaplexEmbryReceiptState(state)
      })
      .catch((error) => {
        if (!cancelled) {
          setPersonaplexEmbryReceiptState({
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

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
  const memoryRouteProofStatusColor = memoryRouteProofState?.ok ? '#22c55e' : memoryRouteProofState ? '#f97316' : '#38bdf8'
  const memoryRouteProofStatusLabel = memoryRouteProofState?.ok ? 'LIVE RECEIPT' : memoryRouteProofState ? 'UNAVAILABLE' : 'LOADING'
  const answerRouteProofStatusColor = answerRouteProofState?.ok ? '#22c55e' : answerRouteProofState ? '#f97316' : '#38bdf8'
  const answerRouteProofStatusLabel = answerRouteProofState?.ok ? 'ANSWER PROOF' : answerRouteProofState ? 'UNAVAILABLE' : 'LOADING'
  const watchdogReceiptChainStatusColor = watchdogReceiptChainState?.ok ? '#22c55e' : watchdogReceiptChainState ? '#f97316' : '#38bdf8'
  const watchdogReceiptChainStatusLabel = watchdogReceiptChainState?.ok ? 'CRON RECEIPT' : watchdogReceiptChainState ? 'UNAVAILABLE' : 'LOADING'
  const textualTuiProofSummary = textualTuiProofCardSummary(textualTuiProofState)
  const textualTuiProofStatusColor = textualTuiProofState?.ok ? '#facc15' : textualTuiProofState ? '#f97316' : '#38bdf8'
  const personaplexStatusColor = personaplexEmbryReceiptState?.ok ? '#22c55e' : personaplexEmbryReceiptState ? '#f97316' : '#38bdf8'
  const personaplexStatusLabel = personaplexEmbryReceiptState?.ok ? 'CACHE REPLAY' : personaplexEmbryReceiptState ? 'FAIL-CLOSED' : 'CHECKING'
  const personaplexReceipt = personaplexEmbryReceiptState?.receipt
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
  const tuiMirror = useMemo(
    () =>
      deriveTauTuiMirrorState(
        chatMessages,
        chatStreamingSteps,
        chatStreaming,
        peerSummary.runId || peerConfig.runId || null,
      ),
    [chatMessages, chatStreamingSteps, chatStreaming, peerConfig.runId, peerSummary.runId],
  )

  function toggleEvidenceRail(): void {
    const nextCollapsed = !evidenceRailCollapsed
    setEvidenceRailCollapsed(nextCollapsed)
    window.localStorage.setItem('tau:evidenceRailCollapsed', String(nextCollapsed))
  }

  return (
    <section
      data-qid="tau:chat:surface"
      style={{
        height: '100%',
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: evidenceRailCollapsed ? '64px 6px minmax(720px, 1fr)' : `${proofRailResize.width}px 6px minmax(520px, 1fr)`,
        background: '#090a0f',
        color: '#e5e7eb',
        overflow: 'hidden',
      }}
    >
      <main
        data-qid="tau:chat:workspace"
        data-collapsed={evidenceRailCollapsed ? 'true' : 'false'}
        style={{
          minHeight: 0,
          overflow: evidenceRailCollapsed ? 'hidden' : 'auto',
          padding: evidenceRailCollapsed ? 10 : 24,
          borderRight: '1px solid rgba(255,255,255,0.05)',
          background: evidenceRailCollapsed ? '#08090d' : 'transparent',
        }}
      >
        <button
          type="button"
          data-qid="tau:chat:evidence-rail-toggle"
          data-qs-action={evidenceRailCollapsed ? 'TAU_EXPAND_EVIDENCE_RAIL' : 'TAU_COLLAPSE_EVIDENCE_RAIL'}
          title={evidenceRailCollapsed ? 'Expand T’au proof rail' : 'Collapse T’au proof rail'}
          onClick={toggleEvidenceRail}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            border: '1px solid rgba(148,163,184,0.22)',
            borderRadius: 8,
            color: '#cbd5e1',
            background: 'rgba(15,23,42,0.78)',
            cursor: 'pointer',
          }}
        >
          {evidenceRailCollapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}
        </button>
        {evidenceRailCollapsed ? (
          <div
            data-qid="tau:chat:evidence-rail-collapsed"
            title="T’au proof rail collapsed"
            style={{
              marginTop: 18,
              writingMode: 'vertical-rl',
              transform: 'rotate(180deg)',
              color: '#94a3b8',
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            T’au proofs
          </div>
        ) : (
        <div style={{ display: 'grid', gap: 20, maxWidth: 980 }}>
          <header style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              <Terminal size={14} /> T’au Experiment Chat
            </div>
            <h1 style={{ margin: 0, maxWidth: 760, fontSize: 34, lineHeight: 1.05, letterSpacing: '-0.03em', color: '#f8fafc' }}>
              Receipt-backed chat shell for T’au loop, Memory, evidence, Watch-style media, and Embry voice.
            </h1>
            <p style={{ margin: 0, maxWidth: 760, color: '#94a3b8', lineHeight: 1.55, fontSize: 14 }}>
              This is an integration surface inside UX Lab. It reads the T’au-owned UX contract and uses the shared Sparta/Watch chat renderer without claiming live production chat.
            </p>
          </header>

          <section
            data-qid="tau:chat:owned-contract"
            style={{
              border: '1px solid rgba(56,189,248,0.24)',
              background: 'rgba(8,47,73,0.26)',
              borderRadius: 8,
              padding: 14,
              display: 'grid',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
              <div>
                <h2 style={{ margin: 0, color: '#e0f2fe', fontSize: 14 }}>T’au-owned UX contract</h2>
                <p style={{ margin: '7px 0 0', color: '#94a3b8', fontSize: 12, lineHeight: 1.45 }}>
                  UX Lab is the integration viewer. The canonical chat contract is loaded from the T’au repository.
                </p>
              </div>
              <span
                data-qid="tau:chat:owned-contract-status"
                style={{
                  color: chatUxContractState?.ok ? '#22c55e' : chatUxContractState ? '#f97316' : '#38bdf8',
                  border: `1px solid ${chatUxContractState?.ok ? '#22c55e55' : chatUxContractState ? '#f9731655' : '#38bdf855'}`,
                  background: chatUxContractState?.ok ? '#22c55e14' : chatUxContractState ? '#f9731614' : '#38bdf814',
                  borderRadius: 999,
                  padding: '5px 9px',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                }}
              >
                {chatUxContractState?.ok ? 'LOADED' : chatUxContractState ? 'UNAVAILABLE' : 'LOADING'}
              </span>
            </div>
            {chatUxContractState?.ok ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                  <PeerFact label="schema" value={chatUxContractState.receipt.schema} />
                  <PeerFact label="source repo" value={chatUxContractState.receipt.sourceOfTruth.repository} />
                  <PeerFact label="source path" value={chatUxContractState.receipt.sourceOfTruth.path} />
                  <PeerFact label="ux-lab role" value={chatUxContractState.receipt.integrationSurface.role} />
                </div>
                <code
                  data-qid="tau:chat:owned-contract-path"
                  style={{ color: '#7dd3fc', fontSize: 10, lineHeight: 1.35, wordBreak: 'break-word' }}
                >
                  {chatUxContractState.receipt.sourcePath}
                </code>
              </>
            ) : (
              <p style={{ margin: 0, color: '#fed7aa', fontSize: 12, lineHeight: 1.45 }}>
                Fail-closed: {chatUxContractState?.detail ?? 'waiting for /api/tau/chat/ux-contract'}
              </p>
            )}
          </section>

          {chatUxContractState?.ok ? (
            <section
              data-qid="tau:chat:orchestrated-loop-mode"
              style={{
                border: '1px solid rgba(251,191,36,0.22)',
                background: 'rgba(69,26,3,0.28)',
                borderRadius: 8,
                padding: 14,
                display: 'grid',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
                <div>
                  <h2 style={{ margin: 0, color: '#fef3c7', fontSize: 14 }}>Special mode: orchestrated subagent loop</h2>
                  <p style={{ margin: '7px 0 0', color: '#d6d3d1', fontSize: 12, lineHeight: 1.45 }}>
                    This mode is activated by a start handoff parameter, not by an ordinary chat turn. Tau owns the runner; UX Lab only renders the contract and receipts.
                  </p>
                </div>
                <span
                  data-qid="tau:chat:orchestrated-loop-mode-name"
                  style={{
                    color: '#facc15',
                    border: '1px solid rgba(250,204,21,0.28)',
                    background: 'rgba(250,204,21,0.1)',
                    borderRadius: 999,
                    padding: '5px 9px',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {chatUxContractState.receipt.orchestrationMode.name}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                <PeerFact label="runner" value={chatUxContractState.receipt.orchestrationMode.runner} />
                <PeerFact label="scheduler" value={chatUxContractState.receipt.orchestrationMode.scheduler} />
                <PeerFact label="activation" value="TAU_ORCHESTRATOR_START" />
              </div>
              <p style={{ margin: 0, color: '#e7e5e4', fontSize: 12, lineHeight: 1.45 }}>
                {chatUxContractState.receipt.orchestrationMode.loopRule}
              </p>
              <code style={{ color: '#fbbf24', fontSize: 10, lineHeight: 1.35, wordBreak: 'break-word' }}>
                {chatUxContractState.receipt.orchestrationMode.activation}
              </code>
            </section>
          ) : null}

          <section
            data-qid="tau:annotation:workspace-card"
            style={{
              border: '1px solid rgba(45,212,191,0.24)',
              background: 'rgba(8,47,73,0.18)',
              borderRadius: 8,
              padding: 16,
              display: 'grid',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#67e8f9', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 850 }}>
                  <Video size={15} aria-hidden="true" /> Movie Annotation TUI
                </div>
                <h2 style={{ margin: '8px 0 0', color: '#ecfeff', fontSize: 18, lineHeight: 1.15 }}>
                  Scrub the frame, select the character, draw the bbox.
                </h2>
                <p style={{ margin: '8px 0 0', color: '#bae6fd', fontSize: 12, lineHeight: 1.5 }}>
                  This is the focused annotation workflow Tau needs from Watch: playhead first, character dropdown second, normalized box third. Local drafts persist per segment; endpoint-backed annotation receipts remain a separate integration rung.
                </p>
              </div>
              <button
                type="button"
                data-qid="tau:annotation:open-modal"
                data-qs-action="TAU_OPEN_ANNOTATION_MODAL"
                title="Open the focused T’au movie annotation workspace"
                onClick={() => setAnnotationModalOpen(true)}
                style={{
                  minHeight: 44,
                  minWidth: 44,
                  border: '1px solid rgba(45,212,191,0.34)',
                  borderRadius: 7,
                  background: 'rgba(45,212,191,0.12)',
                  color: '#67e8f9',
                  padding: '0 12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 850,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}
              >
                <Maximize2 size={15} aria-hidden="true" /> Open
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12, alignItems: 'stretch' }}>
              <div
                data-qid="tau:annotation:card-media-preview"
                title="Tau annotation media preview"
                style={{
                  position: 'relative',
                  minHeight: 168,
                  aspectRatio: '16 / 9',
                  border: '1px solid rgba(103,232,249,0.22)',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background:
                    'linear-gradient(135deg, rgba(2,6,23,0.2), rgba(8,47,73,0.55)), radial-gradient(circle at 72% 38%, rgba(148,163,184,0.42), transparent 17%), radial-gradient(circle at 38% 44%, rgba(45,212,191,0.26), transparent 22%), #030712',
                }}
              >
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(0,0,0,0.22), transparent 36%, rgba(0,0,0,0.34))' }} />
                <div style={{ position: 'absolute', left: '18%', top: '26%', width: '20%', height: '48%', border: '2px dashed #facc15', background: 'rgba(250,204,21,0.08)', zIndex: 5 }} />
                <div style={{ position: 'absolute', left: '18%', top: 'calc(26% - 24px)', maxWidth: '70%', height: 22, lineHeight: '22px', padding: '0 8px', background: '#facc15', color: '#111827', fontSize: 11, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', zIndex: 30, boxShadow: '0 3px 14px rgba(0,0,0,0.5)' }}>
                  Willie · Billy Bob Thornton
                </div>
                <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, height: 28, display: 'grid', gridTemplateColumns: '44px 1fr 48px', alignItems: 'center', gap: 10, zIndex: 10 }}>
                  <span style={{ color: '#bae6fd', fontSize: 10, fontFamily: 'monospace' }}>01:36</span>
                  <div style={{ height: 5, borderRadius: 999, background: 'rgba(148,163,184,0.26)', overflow: 'hidden' }}>
                    <div style={{ width: '34%', height: '100%', background: '#22d3ee' }} />
                  </div>
                  <span style={{ color: '#bae6fd', fontSize: 10, fontFamily: 'monospace', textAlign: 'right' }}>02:00</span>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 8, alignContent: 'center' }}>
                <PeerFact label="Primary action" value="Open modal, scrub playhead, draw bbox" />
                <PeerFact label="State" value="local draft per movie segment" />
                <PeerFact label="Receipt boundary" value="annotation endpoint not attached" />
              </div>
            </div>
          </section>

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

          <section
            data-qid="tau:chat:memory-route-proof"
            style={{
              border: '1px solid rgba(34,197,94,0.2)',
              background: 'rgba(5,46,22,0.24)',
              borderRadius: 8,
              padding: 16,
              display: 'grid',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 14, color: '#dcfce7' }}>Fresh Memory Route Proof</h2>
                <p style={{ margin: '8px 0 0', color: '#bbf7d0', fontSize: 12, lineHeight: 1.48 }}>
                  Route hardening is loaded from the latest T’au proof manifest. This panel reports what that manifest proves and what it explicitly does not prove.
                </p>
              </div>
              <span
                data-qid="tau:chat:memory-route-proof-status"
                style={{
                  color: memoryRouteProofStatusColor,
                  border: `1px solid ${memoryRouteProofStatusColor}55`,
                  background: `${memoryRouteProofStatusColor}14`,
                  borderRadius: 999,
                  padding: '5px 9px',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                }}
              >
                {memoryRouteProofStatusLabel}
              </span>
            </div>

            {memoryRouteProofState?.ok ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                  <PeerFact label="mocked" value={String(memoryRouteProofState.receipt.mocked)} />
                  <PeerFact label="live" value={String(memoryRouteProofState.receipt.live)} />
                  <PeerFact label="routes" value={String(memoryRouteProofState.receipt.routeCount)} />
                  <PeerFact label="created" value={memoryRouteProofState.receipt.createdUtc ?? 'not recorded'} />
                </div>
                <p data-qid="tau:chat:memory-route-proof-scope" style={{ margin: 0, color: '#d1fae5', fontSize: 12, lineHeight: 1.5 }}>
                  {memoryRouteProofState.receipt.proofScope}
                </p>
                <div data-qid="tau:chat:memory-route-proof-routes" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
                  {memoryRouteProofState.receipt.routes.map((route) => {
                    const color = route.failClosed ? '#f97316' : route.branchStatus === 'PASS' ? '#22c55e' : '#facc15'
                    return (
                      <article
                        key={route.route}
                        data-qid={`tau:chat:memory-route:${route.route}`}
                        style={{
                          border: `1px solid ${color}33`,
                          background: 'rgba(15,23,42,0.54)',
                          borderRadius: 7,
                          padding: 10,
                          display: 'grid',
                          gap: 7,
                          minWidth: 0,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: '#f8fafc', fontSize: 11, fontWeight: 800, overflowWrap: 'anywhere' }}>{route.route}</span>
                          <span style={{ color, fontSize: 10, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{route.branchStatus}</span>
                        </div>
                        <div style={{ color: '#bbf7d0', fontSize: 11, lineHeight: 1.35 }}>
                          {route.selectedSkill ?? route.memoryProductSchema ?? 'direct product'}
                        </div>
                        <div style={{ color: route.failClosed ? '#fed7aa' : '#94a3b8', fontSize: 10, lineHeight: 1.35 }}>
                          {route.failClosed ? 'fail-closed branch' : route.currentStage?.label ?? 'route product accepted'}
                        </div>
                        <code style={{ color: '#86efac', fontSize: 9, lineHeight: 1.3, wordBreak: 'break-word' }}>{route.receipt}</code>
                      </article>
                    )
                  })}
                </div>
                <div data-qid="tau:chat:memory-route-proof-boundaries" style={{ display: 'grid', gap: 5 }}>
                  <div style={{ color: '#86efac', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Does not prove</div>
                  {memoryRouteProofState.receipt.claims.does_not_prove.slice(0, 4).map((item) => (
                    <div key={item} style={{ color: '#bbf7d0', fontSize: 11, lineHeight: 1.4 }}>
                      {item}
                    </div>
                  ))}
                </div>
                <code style={{ color: '#86efac', fontSize: 10, lineHeight: 1.35, wordBreak: 'break-word' }}>
                  {memoryRouteProofState.receipt.manifestPath}
                </code>
              </>
            ) : (
              <p style={{ margin: 0, color: '#fed7aa', fontSize: 12, lineHeight: 1.45 }}>
                Fail-closed: {memoryRouteProofState?.detail ?? 'waiting for /api/tau/memory/routes/failclosed-proof'}
              </p>
            )}
          </section>

          <section
            data-qid="tau:chat:answer-route-proof"
            style={{
              border: '1px solid rgba(34,197,94,0.2)',
              background: 'rgba(5,46,22,0.18)',
              borderRadius: 8,
              padding: 16,
              display: 'grid',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 14, color: '#dcfce7' }}>Fresh ANSWER Browser Proof</h2>
                <p style={{ margin: '8px 0 0', color: '#bbf7d0', fontSize: 12, lineHeight: 1.48 }}>
                  This separate receipt covers the newer browser turn that called Memory `/answer`; it does not rewrite the older route-coverage limitation above.
                </p>
              </div>
              <span
                data-qid="tau:chat:answer-route-proof-status"
                style={{
                  color: answerRouteProofStatusColor,
                  border: `1px solid ${answerRouteProofStatusColor}55`,
                  background: `${answerRouteProofStatusColor}14`,
                  borderRadius: 999,
                  padding: '5px 9px',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                }}
              >
                {answerRouteProofStatusLabel}
              </span>
            </div>

            {answerRouteProofState?.ok ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                  <PeerFact label="mocked" value={String(answerRouteProofState.receipt.mocked)} />
                  <PeerFact label="live" value={String(answerRouteProofState.receipt.live)} />
                  <PeerFact label="memory calls" value={String(answerRouteProofState.receipt.memoryRequestCount)} />
                  <PeerFact label="/answer" value={answerRouteProofState.receipt.hasAnswer200 ? 'HTTP 200' : 'missing'} />
                </div>
                <p data-qid="tau:chat:answer-route-proof-scope" style={{ margin: 0, color: '#d1fae5', fontSize: 12, lineHeight: 1.5 }}>
                  {answerRouteProofState.receipt.scope}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                  <PeerFact label="prompt" value={answerRouteProofState.receipt.prompt} />
                  <PeerFact label="/intent" value={answerRouteProofState.receipt.hasIntent200 ? 'HTTP 200' : 'missing'} />
                  <PeerFact label="visible can_answer" value={String(Boolean(answerRouteProofState.receipt.visibleAssertions.can_answer_visible))} />
                  <PeerFact label="prior failure" value={answerRouteProofState.receipt.priorFailClosed.answer502 ? '/answer 502 fail-closed' : 'not recorded'} />
                </div>
                <div data-qid="tau:chat:answer-route-proof-boundaries" style={{ display: 'grid', gap: 5 }}>
                  <div style={{ color: '#86efac', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Does not prove</div>
                  {answerRouteProofState.receipt.claims.does_not_prove.slice(0, 4).map((item) => (
                    <div key={item} style={{ color: '#bbf7d0', fontSize: 11, lineHeight: 1.4 }}>
                      {item}
                    </div>
                  ))}
                </div>
                <code style={{ color: '#86efac', fontSize: 10, lineHeight: 1.35, wordBreak: 'break-word' }}>
                  {answerRouteProofState.receipt.manifestPath}
                </code>
              </>
            ) : (
              <p style={{ margin: 0, color: '#fed7aa', fontSize: 12, lineHeight: 1.45 }}>
                Fail-closed: {answerRouteProofState?.detail ?? 'waiting for /api/tau/memory/routes/answer-browser-proof'}
              </p>
            )}
          </section>

          <section
            data-qid="tau:chat:watchdog-receipt-chain"
            style={{
              border: '1px solid rgba(45,212,191,0.24)',
              background: 'rgba(19,78,74,0.24)',
              borderRadius: 8,
              padding: 16,
              display: 'grid',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 14, color: '#ccfbf1' }}>Watchdog Receipt Chain</h2>
                <p style={{ margin: '8px 0 0', color: '#99f6e4', fontSize: 12, lineHeight: 1.48 }}>
                  This panel reads a T’au proof manifest for a live GitHub issue handled by the installed project-watchdog cron.
                </p>
              </div>
              <span
                data-qid="tau:chat:watchdog-receipt-chain-status"
                style={{
                  color: watchdogReceiptChainStatusColor,
                  border: `1px solid ${watchdogReceiptChainStatusColor}55`,
                  background: `${watchdogReceiptChainStatusColor}14`,
                  borderRadius: 999,
                  padding: '5px 9px',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                }}
              >
                {watchdogReceiptChainStatusLabel}
              </span>
            </div>

            {watchdogReceiptChainState?.ok ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                  <PeerFact label="run id" value={watchdogReceiptChainState.receipt.runId} />
                  <PeerFact label="issue" value={`#${watchdogReceiptChainState.receipt.issue.number} ${watchdogReceiptChainState.receipt.issue.finalState}`} />
                  <PeerFact label="selected agent" value={watchdogReceiptChainState.receipt.commandLoop.selectedAgent ?? 'unknown'} />
                  <PeerFact label="terminal" value={watchdogReceiptChainState.receipt.commandLoop.terminalAgent ?? 'unknown'} />
                </div>
                <div
                  data-qid="tau:chat:watchdog-receipt-chain-flow"
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}
                >
                  {[
                    {
                      label: 'GitHub issue',
                      value: watchdogReceiptChainState.receipt.issue.title,
                      detail: `${watchdogReceiptChainState.receipt.issue.finalLabels.join(', ')} · ${watchdogReceiptChainState.receipt.issue.commentCount} comments`,
                    },
                    {
                      label: 'Watchdog cron',
                      value: watchdogReceiptChainState.receipt.watchdog.status ?? 'unknown',
                      detail: `handled=${watchdogReceiptChainState.receipt.watchdog.handledCount ?? 'n/a'} lease=${String(watchdogReceiptChainState.receipt.watchdog.leaseCommentSeen)}`,
                    },
                    {
                      label: 'Command loop',
                      value: `${watchdogReceiptChainState.receipt.commandLoop.stepCount ?? 0} step`,
                      detail: `${watchdogReceiptChainState.receipt.commandLoop.selectedAgent ?? 'unknown'} exit ${watchdogReceiptChainState.receipt.commandLoop.selectedAgentCommandExitCode ?? 'n/a'}`,
                    },
                    {
                      label: 'GitHub transport',
                      value: watchdogReceiptChainState.receipt.githubTransport.dryRun ? 'dry-run' : 'apply',
                      detail: `applied=${String(watchdogReceiptChainState.receipt.githubTransport.applied)}`,
                    },
                  ].map((item) => (
                    <article
                      key={item.label}
                      data-qid={`tau:chat:watchdog-receipt-chain:${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                      style={{
                        border: '1px solid rgba(45,212,191,0.22)',
                        background: 'rgba(15,23,42,0.56)',
                        borderRadius: 7,
                        padding: 10,
                        minWidth: 0,
                        display: 'grid',
                        gap: 7,
                      }}
                    >
                      <div style={{ color: '#ccfbf1', fontSize: 11, fontWeight: 800 }}>{item.label}</div>
                      <div style={{ color: '#f8fafc', fontSize: 12, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{item.value}</div>
                      <div style={{ color: '#5eead4', fontSize: 10, lineHeight: 1.35 }}>{item.detail}</div>
                    </article>
                  ))}
                </div>
                <div data-qid="tau:chat:watchdog-receipt-chain-artifacts" style={{ display: 'grid', gap: 6 }}>
                  {[
                    watchdogReceiptChainState.receipt.manifestPath,
                    watchdogReceiptChainState.receipt.watchdog.receipt,
                    watchdogReceiptChainState.receipt.commandLoop.receipt,
                    watchdogReceiptChainState.receipt.githubTransport.receipt,
                  ].filter(Boolean).map((path) => (
                    <code key={path} style={{ color: '#5eead4', fontSize: 10, lineHeight: 1.35, wordBreak: 'break-word' }}>
                      {path}
                    </code>
                  ))}
                </div>
                <div data-qid="tau:chat:watchdog-receipt-chain-boundaries" style={{ display: 'grid', gap: 5 }}>
                  <div style={{ color: '#2dd4bf', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Does not prove</div>
                  {watchdogReceiptChainState.receipt.claims.does_not_prove.slice(0, 4).map((item) => (
                    <div key={item} style={{ color: '#99f6e4', fontSize: 11, lineHeight: 1.4 }}>
                      {item}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p style={{ margin: 0, color: '#fed7aa', fontSize: 12, lineHeight: 1.45 }}>
                Fail-closed: {watchdogReceiptChainState?.detail ?? 'waiting for /api/tau/watchdog/receipt-chain'}
              </p>
            )}
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
            <article
              data-qid="tau:textual-tui:proof-card"
              style={{
                border: `1px solid ${textualTuiProofStatusColor}55`,
                background: `${textualTuiProofStatusColor}0f`,
                borderRadius: 8,
                padding: 14,
                minWidth: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e2e8f0', fontSize: 13, fontWeight: 700 }}>
                  <Terminal size={16} />
                  Textual TUI Proof
                </div>
                <span
                  data-qid="tau:textual-tui:proof-status"
                  style={{ color: textualTuiProofStatusColor, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap' }}
                >
                  {textualTuiProofSummary.label}
                </span>
              </div>
              <p style={{ margin: '10px 0 0', color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
                {textualTuiProofSummary.detail}
              </p>
              {textualTuiProofState?.ok ? (
                <figure
                  data-qid="tau:textual-tui:screenshot-preview"
                  style={{
                    margin: '10px 0 0',
                    border: '1px solid rgba(250,204,21,0.22)',
                    background: '#020617',
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  <img
                    src={apiUrl('/api/tau/tui/textual-proof/screenshot')}
                    alt="Fixture-backed Tau Textual TUI proof screenshot"
                    title="Fixture-backed Tau Textual TUI screenshot; mocked=true live=false"
                    style={{ display: 'block', width: '100%', aspectRatio: '1 / 1.12', objectFit: 'cover', objectPosition: 'top left' }}
                  />
                  <figcaption style={{ padding: '7px 9px', color: '#fde68a', fontSize: 10, lineHeight: 1.35 }}>
                    Screenshot artifact from `uv run tau tui-proof`; not a live embedded TUI.
                  </figcaption>
                </figure>
              ) : null}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 10 }}>
                <PeerFact label="mocked" value={textualTuiProofSummary.mocked} />
                <PeerFact label="live" value={textualTuiProofSummary.live} />
              </div>
              {textualTuiProofState?.ok ? (
                <div data-qid="tau:textual-tui:proof-boundaries" style={{ marginTop: 10, display: 'grid', gap: 5 }}>
                  {textualTuiProofState.receipt.doesNotProve.slice(0, 2).map((item) => (
                    <div key={item} style={{ color: '#fde68a', fontSize: 10, lineHeight: 1.35 }}>
                      does not prove: {item}
                    </div>
                  ))}
                </div>
              ) : null}
              <code
                data-qid="tau:textual-tui:proof-artifact"
                style={{ display: 'block', marginTop: 10, color: '#64748b', fontSize: 10, lineHeight: 1.35, wordBreak: 'break-word' }}
              >
                {textualTuiProofSummary.artifact}
              </code>
            </article>
            <article
              data-qid="tau:personaplex:embry-receipt-gate"
              style={{ border: `1px solid ${personaplexStatusColor}55`, background: `${personaplexStatusColor}0f`, borderRadius: 8, padding: 14 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e2e8f0', fontSize: 13, fontWeight: 700 }}>
                  <Mic size={16} />
                  Embry Voice
                </div>
                <span
                  data-qid="tau:personaplex:embry-receipt-status"
                  style={{ color: personaplexStatusColor, fontSize: 11, fontFamily: 'monospace' }}
                >
                  {personaplexStatusLabel}
                </span>
              </div>
              <p style={{ margin: '10px 0 0', color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
                {personaplexEmbryReceiptState?.ok
                  ? `PersonaPlex cache replay receipt is attached (${personaplexReceipt?.promptCount ?? 0} prompt cache).`
                  : personaplexEmbryReceiptState
                    ? 'Audio activation is disabled until a personaplex.publish_receipt.v1 with CACHE_REPLAY_PASS is attached.'
                    : 'Checking for PersonaPlex cache replay receipt...'}
              </p>
              <code
                data-qid="tau:personaplex:embry-receipt-path"
                style={{ display: 'block', marginTop: 10, color: '#64748b', fontSize: 10, lineHeight: 1.35, wordBreak: 'break-word' }}
              >
                {personaplexReceipt?.receiptPath ?? personaplexEmbryReceiptState?.receiptPath ?? 'receipt path pending'}
              </code>
            </article>
          </section>
        </div>
        )}
      </main>

      <div
        data-qid="tau:chat:proof-rail-resize"
        data-qs-action="TAU_RESIZE_PROOF_RAIL"
        title="Drag to resize T’au proof rail"
        role="separator"
        aria-orientation="vertical"
        onMouseDown={proofRailResize.onDragStart}
        style={{
          width: 6,
          minWidth: 6,
          height: '100%',
          cursor: 'col-resize',
          background: proofRailResize.dragging.current ? '#22d3ee' : 'rgba(148,163,184,0.18)',
          borderLeft: '1px solid rgba(255,255,255,0.04)',
          borderRight: '1px solid rgba(255,255,255,0.04)',
        }}
      />

      <aside
        data-qid="tau:chat:sidebar"
        style={{
          minWidth: 0,
          minHeight: 0,
          borderLeft: '1px solid rgba(255,255,255,0.05)',
          background: '#0d0d12',
          padding: 8,
          display: 'grid',
          gridTemplateColumns: `${tuiPaneResize.width}px 6px minmax(330px, 1fr)`,
          gap: 8,
          overflow: 'hidden',
        }}
      >
        <TauTuiMirrorPanel
          state={tuiMirror}
          receiptStreamState={tuiReceiptStreamState}
          textualTuiProofState={textualTuiProofState}
        />
        <div
          data-qid="tau:chat:tui-chat-resize"
          data-qs-action="TAU_RESIZE_TUI_CHAT_SPLIT"
          title="Drag to resize T’au receipt terminal and chat panes"
          role="separator"
          aria-orientation="vertical"
          onMouseDown={tuiPaneResize.onDragStart}
          style={{
            width: 6,
            minWidth: 6,
            height: '100%',
            cursor: 'col-resize',
            background: tuiPaneResize.dragging.current ? '#22d3ee' : 'rgba(148,163,184,0.18)',
            borderRadius: 999,
          }}
        />
        <div style={{ minWidth: 0, minHeight: 0 }}>
          <SharedChatShell
            projectLabel="Tau Chat"
            surface="shared-chat"
            shellQid="tau:chat:shell"
            defaultMode="compliance"
            modeLabels={{ compliance: 'Evidence', personaplex: 'Embry voice' }}
            modeTitles={{
              compliance: 'Use Tau Memory and SPARTA evidence receipts',
              personaplex: 'Activate Embry PersonaPlex voice metadata mode',
            }}
            showModeToggle
            adapter={adapter}
            messages={chatMessages}
            onMessagesChange={setChatMessages}
            onStreamingStepsChange={setChatStreamingSteps}
            onStreamingChange={setChatStreaming}
            emptyTitle="Tau Loop and Memory Harness"
            emptyDescription="Ask about the Tau loop stage contract, Sparta evidence cases, Watch embeds, or Embry voice readiness."
            placeholder="Ask Tau about loop evidence, SPARTA, Watch, or Embry..."
            chatTitle="Tau Loop Chat"
            agentStatus={chatStreaming ? tuiMirror.currentStage.label : 'ready'}
            starterChips={[
              { label: 'Show loop evidence', prompt: 'What loop evidence is available?', dataQid: 'tau:chat:chip:loop-evidence' },
              { label: 'Peer handoff', prompt: 'How does Tau communicate with pi-mono and peer harnesses?', dataQid: 'tau:chat:chip:peer-handoff' },
              { label: 'Explain Embry voice', prompt: 'How does Embry PersonaPlex voice work here?', dataQid: 'tau:chat:chip:embry-voice' },
              { label: 'SPARTA evidence case', prompt: 'How does Tau handle a CWE-287 SPARTA evidence case?', dataQid: 'tau:chat:chip:sparta-evidence' },
            ]}
          />
        </div>
      </aside>
      {annotationModalOpen ? (
        <TauAnnotationModal onClose={() => setAnnotationModalOpen(false)} />
      ) : null}
    </section>
  )
}

function TauAnnotationModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [segmentId, setSegmentId] = useState(TAU_ANNOTATION_SEGMENTS[0].id)
  const activeSegment = TAU_ANNOTATION_SEGMENTS.find((segment) => segment.id === segmentId) ?? TAU_ANNOTATION_SEGMENTS[0]
  const [draft, setDraft] = useState<TauAnnotationDraft>(() => readTauAnnotationDraft(activeSegment))
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [savingReceipt, setSavingReceipt] = useState(false)
  const receiptPreview = tauAnnotationReceiptPreview(draft)
  const currentCharacter = TAU_CHARACTER_OPTIONS.find((option) => option.character === draft.characterName)
  const segmentDuration = Math.max(1, activeSegment.endSeconds - activeSegment.startSeconds)
  const progressPercent = ((draft.playheadSeconds - activeSegment.startSeconds) / segmentDuration) * 100

  useRegisterAction('tau:annotation:add-box', {
    app: 'ux-lab',
    action: 'TAU_ADD_ANNOTATION_BOX',
    label: 'Add Tau annotation box',
    description: 'Add the current normalized bbox to the local Tau annotation draft',
    tags: ['tau', 'watch', 'annotation'],
  })
  useRegisterAction('tau:annotation:approve-draft', {
    app: 'ux-lab',
    action: 'TAU_WRITE_ANNOTATION_RECEIPT',
    label: 'Write Tau annotation receipt',
    description: 'Submit the selected playhead, character, and normalized bbox draft to the Tau annotation receipt endpoint',
    tags: ['tau', 'watch', 'annotation', 'receipt'],
  })

  useEffect(() => {
    const nextSegment = TAU_ANNOTATION_SEGMENTS.find((segment) => segment.id === segmentId) ?? TAU_ANNOTATION_SEGMENTS[0]
    setDraft(readTauAnnotationDraft(nextSegment))
    setDragStart(null)
  }, [segmentId])

  useEffect(() => {
    writeTauAnnotationDraft(draft)
  }, [draft])

  function patchDraft(patch: Partial<TauAnnotationDraft>): void {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function updateCharacter(characterName: string): void {
    const next = TAU_CHARACTER_OPTIONS.find((option) => option.character === characterName)
    patchDraft({
      characterName,
      actorName: next?.actor ?? draft.actorName,
      status: `Selected ${characterName}. Draw or adjust the box on the current frame.`,
    })
  }

  function pointerPosition(event: PointerEvent<HTMLDivElement>): { rect: DOMRect; point: { x: number; y: number } } {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      rect,
      point: {
        x: clamp01((event.clientX - rect.left) / rect.width) * rect.width,
        y: clamp01((event.clientY - rect.top) / rect.height) * rect.height,
      },
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    const { point } = pointerPosition(event)
    setDragStart(point)
    patchDraft({ draftBbox: null })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!dragStart) return
    const { rect, point } = pointerPosition(event)
    patchDraft({ draftBbox: normalizeTauDragBbox(dragStart, point, rect) })
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>): void {
    if (!dragStart) return
    const { rect, point } = pointerPosition(event)
    const bbox = normalizeTauDragBbox(dragStart, point, rect)
    setDragStart(null)
    if ((bbox[2] - bbox[0]) < 0.02 || (bbox[3] - bbox[1]) < 0.02) {
      patchDraft({ draftBbox: null, status: 'Draw a larger face/body box.' })
      return
    }
    patchDraft({ draftBbox: bbox, status: 'Draft box ready. Add it to the segment or approve the local draft.' })
  }

  function addDraftBox(): void {
    if (!draft.draftBbox) {
      patchDraft({ status: 'Draw a box on the current frame first.' })
      return
    }
    const box: TauAnnotationBox = {
      id: `${draft.segmentId}-${Date.now()}-${Math.round(draft.draftBbox[0] * 1000)}`,
      bbox: draft.draftBbox,
      characterName: draft.characterName,
      actorName: draft.actorName,
      status: 'draft',
    }
    patchDraft({
      boxes: [...draft.boxes, box],
      draftBbox: null,
      status: `Added ${box.characterName} box to ${activeSegment.label}.`,
    })
  }

  function deleteBox(id: string): void {
    patchDraft({
      boxes: draft.boxes.filter((box) => box.id !== id),
      status: 'Removed annotation box from this segment draft.',
    })
  }

  async function approveLocalDraft(): Promise<void> {
    const boxes = [
      ...draft.boxes,
      ...(draft.draftBbox
        ? [{
          id: `${draft.segmentId}-${Date.now()}-inline`,
          bbox: draft.draftBbox,
          characterName: draft.characterName,
          actorName: draft.actorName,
          status: 'local_receipt_ready' as const,
        }]
        : []),
    ].map((box) => ({ ...box, status: 'local_receipt_ready' as const }))
    if (boxes.length === 0) {
      patchDraft({ status: 'Draw or add at least one box before approving the local draft.' })
      return
    }
    setSavingReceipt(true)
    patchDraft({ status: 'Writing Tau annotation receipt...' })
    try {
      const response = await fetch(apiUrl('/api/tau/annotations'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          segmentId: draft.segmentId,
          segmentLabel: activeSegment.label,
          playheadSeconds: draft.playheadSeconds,
          boxes,
        }),
      })
      const payload = await response.json() as {
        ok?: boolean
        receipt?: { receiptPath?: string; runId?: string }
        detail?: string
      }
      if (!response.ok || !payload.ok || !payload.receipt?.receiptPath) {
        throw new Error(payload.detail ?? `Tau annotation endpoint returned HTTP ${response.status}`)
      }
      const receiptPath = payload.receipt.receiptPath
      patchDraft({
        boxes: boxes.map((box) => ({ ...box, status: 'receipt_written' as const, receiptPath })),
        draftBbox: null,
        receiptPath,
        receiptRunId: payload.receipt.runId,
        status: `Tau annotation receipt written: ${receiptPath}`,
      })
    } catch (error) {
      patchDraft({
        boxes,
        draftBbox: null,
        status: `Tau annotation receipt write failed: ${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      setSavingReceipt(false)
    }
  }

  return (
    <div
      data-qid="tau:annotation:modal"
      role="dialog"
      aria-modal="true"
      aria-label="T’au movie annotation workspace"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        isolation: 'isolate',
        background: 'rgba(1,4,8,0.96)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div
        data-qid="tau:annotation:modal-panel"
        style={{
          width: 'min(1280px, 96vw)',
          maxHeight: '94vh',
          minHeight: 'min(760px, 92vh)',
          overflow: 'auto',
          background: '#070b12',
          border: '1px solid rgba(45,212,191,0.3)',
          borderRadius: 10,
          boxShadow: '0 28px 90px rgba(0,0,0,0.66)',
          padding: 18,
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr) auto',
          gap: 14,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#67e8f9', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 900 }}>
              <SquareDashedMousePointer size={15} aria-hidden="true" /> T’au Movie Annotation
            </div>
            <h2 style={{ margin: '6px 0 0', color: '#f8fafc', fontSize: 24, lineHeight: 1.15 }}>
              Playhead, character, bbox.
            </h2>
            <p style={{ margin: '7px 0 0', color: '#94a3b8', fontSize: 13, lineHeight: 1.45 }}>
              This modal is intentionally opaque and wide so the annotation task has room. Chat and receipt logs remain behind it.
            </p>
          </div>
          <button
            type="button"
            data-qid="tau:annotation:close-modal"
            data-qs-action="TAU_CLOSE_ANNOTATION_MODAL"
            title="Close T’au annotation workspace"
            aria-label="Close T’au annotation workspace"
            onClick={onClose}
            style={{
              width: 44,
              height: 44,
              borderRadius: 7,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.05)',
              color: '#e5e7eb',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(560px, 1.5fr) minmax(300px, 0.8fr)', gap: 14, minHeight: 0 }}>
          <section style={{ minWidth: 0, display: 'grid', gap: 12, alignContent: 'start' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(160px, 0.28fr)', gap: 10 }}>
              <label style={{ display: 'grid', gap: 5, minWidth: 0, color: '#94a3b8', fontSize: 10, fontWeight: 850, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Segment
                <select
                  data-qid="tau:annotation:segment-select"
                  data-qs-action="TAU_SELECT_ANNOTATION_SEGMENT"
                  title="Select movie segment"
                  value={segmentId}
                  onChange={(event) => setSegmentId(event.target.value)}
                  style={tauInputStyle}
                >
                  {TAU_ANNOTATION_SEGMENTS.map((segment) => (
                    <option key={segment.id} value={segment.id}>{segment.label}</option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'grid', gap: 5, color: '#94a3b8', fontSize: 10, fontWeight: 850, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Playhead
                <div style={{ ...tauInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', color: '#67e8f9' }}>
                  {draft.playheadSeconds.toFixed(2)}s
                </div>
              </div>
            </div>

            <div
              data-qid="tau:annotation:movie-frame"
              title="Draw normalized character bbox on the selected movie frame"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '16 / 9',
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid rgba(103,232,249,0.24)',
                background:
                  'linear-gradient(135deg, rgba(2,6,23,0.1), rgba(8,47,73,0.64)), radial-gradient(circle at 72% 40%, rgba(226,232,240,0.42), transparent 15%), radial-gradient(circle at 40% 42%, rgba(45,212,191,0.25), transparent 20%), radial-gradient(circle at 28% 62%, rgba(15,23,42,0.72), transparent 26%), #020617',
                cursor: 'crosshair',
                isolation: 'isolate',
                userSelect: 'none',
                touchAction: 'none',
              }}
            >
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(0,0,0,0.36), transparent 42%, rgba(0,0,0,0.28))' }} />
              <div style={{ position: 'absolute', left: 18, top: 18, zIndex: 20, color: '#bae6fd', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', background: 'rgba(2,6,23,0.72)', border: '1px solid rgba(103,232,249,0.18)', borderRadius: 6, padding: '5px 7px' }}>
                {activeSegment.label}
              </div>
              <div style={{ position: 'absolute', left: `${progressPercent}%`, top: 0, bottom: 0, width: 2, background: '#22d3ee', zIndex: 8, boxShadow: '0 0 16px rgba(34,211,238,0.55)' }} />
              {[...draft.boxes, ...(draft.draftBbox ? [{
                id: 'active-draft',
                bbox: draft.draftBbox,
                characterName: draft.characterName,
                actorName: draft.actorName,
                status: 'draft' as const,
              }] : [])].map((box) => {
                const isDraft = box.id === 'active-draft'
                return (
                  <div key={box.id}>
                    <div
                      style={{
                        position: 'absolute',
                        ...tauBboxStyle(box.bbox),
                        border: isDraft ? '2px dashed #facc15' : '2px solid #2dd4bf',
                        background: isDraft ? 'rgba(250,204,21,0.08)' : 'rgba(45,212,191,0.1)',
                        boxShadow: isDraft ? '0 0 0 1px rgba(250,204,21,0.25)' : '0 0 0 1px rgba(45,212,191,0.18)',
                        pointerEvents: 'none',
                        zIndex: 14,
                      }}
                    />
                    <div
                      title={`${box.characterName}${box.actorName ? ` · ${box.actorName}` : ''}`}
                      style={{
                        ...tauAnnotationLabelStyle(box.bbox),
                        height: 23,
                        lineHeight: '23px',
                        padding: '0 8px',
                        background: isDraft ? '#facc15' : '#2dd4bf',
                        color: '#03110f',
                        fontSize: 11,
                        fontWeight: 900,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        boxShadow: '0 3px 14px rgba(0,0,0,0.58)',
                        pointerEvents: 'none',
                      }}
                    >
                      {box.characterName}{box.actorName ? ` · ${box.actorName}` : ''}
                    </div>
                  </div>
                )
              })}
            </div>

            <label style={{ display: 'grid', gap: 6, color: '#94a3b8', fontSize: 10, fontWeight: 850, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Move playhead
              <input
                data-qid="tau:annotation:playhead"
                data-qs-action="TAU_SET_ANNOTATION_PLAYHEAD"
                title="Move movie playhead"
                type="range"
                min={activeSegment.startSeconds}
                max={activeSegment.endSeconds}
                step={0.1}
                value={draft.playheadSeconds}
                onChange={(event) => patchDraft({ playheadSeconds: Number(event.target.value), status: 'Playhead moved. Draw or redraw the bbox on this frame.' })}
                style={{ width: '100%', accentColor: '#22d3ee' }}
              />
            </label>
          </section>

          <aside style={{ minWidth: 0, display: 'grid', gap: 12, alignContent: 'start' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
              <label style={tauFieldLabelStyle}>
                Character
                <select
                  data-qid="tau:annotation:character-select"
                  data-qs-action="TAU_SELECT_ANNOTATION_CHARACTER"
                  title="Select character identity for the annotation box"
                  value={draft.characterName}
                  onChange={(event) => updateCharacter(event.target.value)}
                  style={tauInputStyle}
                >
                  {TAU_CHARACTER_OPTIONS.map((option) => (
                    <option key={option.character} value={option.character}>{option.character}</option>
                  ))}
                </select>
              </label>
              <label style={tauFieldLabelStyle}>
                Actor
                <input
                  data-qid="tau:annotation:actor-input"
                  data-qs-action="TAU_SET_ANNOTATION_ACTOR"
                  title="Set actor identity for the annotation box"
                  value={draft.actorName}
                  onChange={(event) => patchDraft({ actorName: event.target.value, status: 'Actor label updated for the current draft.' })}
                  style={tauInputStyle}
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                data-qid="tau:annotation:add-box"
                data-qs-action="TAU_ADD_ANNOTATION_BOX"
                title="Add current bbox to the local segment draft"
                onClick={addDraftBox}
                disabled={!draft.draftBbox}
                style={tauActionButtonStyle(Boolean(draft.draftBbox), '#facc15')}
              >
                <Plus size={14} aria-hidden="true" /> Add box
              </button>
              <button
                type="button"
                data-qid="tau:annotation:approve-draft"
                data-qs-action="TAU_WRITE_ANNOTATION_RECEIPT"
                title="Write Tau annotation receipt"
                onClick={() => { void approveLocalDraft() }}
                disabled={savingReceipt || !Boolean(draft.draftBbox || draft.boxes.length)}
                style={tauActionButtonStyle(!savingReceipt && Boolean(draft.draftBbox || draft.boxes.length), '#2dd4bf')}
              >
                <CheckCircle2 size={14} aria-hidden="true" /> {savingReceipt ? 'Writing receipt' : 'Write receipt'}
              </button>
            </div>

            <section data-qid="tau:annotation:box-list" style={{ border: '1px solid rgba(148,163,184,0.14)', borderRadius: 8, background: 'rgba(15,23,42,0.64)', padding: 12, display: 'grid', gap: 9 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: '#e0f2fe', fontSize: 12, fontWeight: 850 }}>
                  <UserRound size={14} aria-hidden="true" /> Boxes
                </div>
                <span style={{ color: '#67e8f9', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                  {draft.boxes.length + (draft.draftBbox ? 1 : 0)}
                </span>
              </div>
              {draft.boxes.length === 0 ? (
                <p style={{ margin: 0, color: '#94a3b8', fontSize: 12, lineHeight: 1.45 }}>
                  Draw a box on the frame, then add it to this segment.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {draft.boxes.map((box, index) => (
                    <div key={box.id} data-qid="tau:annotation:box-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 8, border: '1px solid rgba(148,163,184,0.12)', borderRadius: 7, background: 'rgba(2,6,23,0.42)', padding: 9 }}>
                      <div style={{ minWidth: 0 }}>
                        <div title={`${box.characterName}${box.actorName ? ` · ${box.actorName}` : ''}`} style={{ color: '#f8fafc', fontSize: 12, fontWeight: 820, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {index + 1}. {box.characterName}{box.actorName ? ` · ${box.actorName}` : ''}
                        </div>
                        <div title={box.receiptPath ?? box.status} style={{ color: box.status === 'receipt_written' ? '#22c55e' : box.status === 'local_receipt_ready' ? '#2dd4bf' : '#facc15', fontSize: 10, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {box.status}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-qid="tau:annotation:delete-box"
                        data-qs-action="TAU_DELETE_ANNOTATION_BOX"
                        title="Delete annotation box from local draft"
                        onClick={() => deleteBox(box.id)}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 6,
                          border: '1px solid rgba(248,113,113,0.25)',
                          background: 'rgba(248,113,113,0.08)',
                          color: '#fca5a5',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section data-qid="tau:annotation:receipt-preview" style={{ border: '1px solid rgba(250,204,21,0.18)', borderRadius: 8, background: 'rgba(69,26,3,0.24)', padding: 12 }}>
              <div style={{ color: '#fde68a', fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Receipt Preview</div>
              <pre style={{ margin: '9px 0 0', color: '#fef3c7', fontSize: 10, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {JSON.stringify(receiptPreview, null, 2)}
              </pre>
            </section>
          </aside>
        </div>

        <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTop: '1px solid rgba(148,163,184,0.14)', paddingTop: 12 }}>
          <span data-qid="tau:annotation:status" style={{ color: draft.status.includes('endpoint') ? '#fde68a' : '#bae6fd', fontSize: 12, lineHeight: 1.45 }}>
            {draft.status}
          </span>
          <span style={{ color: currentCharacter ? '#2dd4bf' : '#f97316', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
            {currentCharacter ? 'character-selected' : 'custom-actor-label'}
          </span>
        </footer>
      </div>
    </div>
  )
}

const tauInputStyle: CSSProperties = {
  minWidth: 0,
  width: '100%',
  boxSizing: 'border-box',
  background: '#0b1120',
  border: '1px solid rgba(148,163,184,0.2)',
  borderRadius: 7,
  color: '#e5e7eb',
  padding: '9px 10px',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const tauFieldLabelStyle: CSSProperties = {
  display: 'grid',
  gap: 5,
  minWidth: 0,
  color: '#94a3b8',
  fontSize: 10,
  fontWeight: 850,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
}

function tauActionButtonStyle(active: boolean, color: string): CSSProperties {
  return {
    minHeight: 44,
    border: `1px solid ${active ? `${color}66` : 'rgba(148,163,184,0.16)'}`,
    borderRadius: 7,
    background: active ? `${color}18` : 'rgba(148,163,184,0.06)',
    color: active ? color : '#64748b',
    padding: '0 11px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    cursor: active ? 'pointer' : 'default',
    fontSize: 11,
    fontWeight: 850,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  }
}

function TauTuiMirrorPanel({
  state,
  receiptStreamState,
  textualTuiProofState,
}: {
  state: TauTuiMirrorState
  receiptStreamState: TauTuiReceiptStreamState | null
  textualTuiProofState: TauTextualTuiProofState | null
}): JSX.Element {
  const terminalHostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const receiptStream = receiptStreamState?.ok ? receiptStreamState.receipt : null
  const lines = useMemo(
    () => (receiptStream ? terminalLinesFromTauTuiReceiptStream(receiptStream) : terminalLinesFromTauTuiMirrorState(state)),
    [receiptStream, state],
  )
  const sourceLabel = receiptStream ? 'receipt-stream' : 'chat-mirror'
  const sourceStatus = receiptStream ? receiptStream.status : state.currentStage.status
  const sourceStage = receiptStream ? receiptStream.latestEventType ?? 'loop2-events' : state.currentStage.stage
  const hasTextualTuiProof = textualTuiProofState?.ok === true

  useEffect(() => {
    const host = terminalHostRef.current
    if (!host) return undefined
    const terminal = new XTerm({
      cursorBlink: state.active,
      cursorStyle: 'block',
      disableStdin: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 500,
      theme: {
        background: '#020617',
        foreground: '#dbeafe',
        cursor: '#22d3ee',
        black: '#020617',
        brightBlack: '#64748b',
        blue: '#38bdf8',
        brightBlue: '#67e8f9',
        cyan: '#22d3ee',
        brightCyan: '#67e8f9',
        green: '#22c55e',
        brightGreen: '#86efac',
        magenta: '#a78bfa',
        brightMagenta: '#c4b5fd',
        red: '#ef4444',
        brightRed: '#f87171',
        white: '#e5e7eb',
        brightWhite: '#f8fafc',
        yellow: '#facc15',
        brightYellow: '#fde68a',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    fitAddon.fit()
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(host)
    return () => {
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.cursorBlink = state.active
    terminal.write('\x1b[2J\x1b[H')
    for (const line of lines) terminal.writeln(line)
  }, [lines, state.active])

  return (
    <section
      data-qid="tau:tui-mirror:pane"
      title="T’au receipt terminal mirror; not the interactive Textual TUI"
      style={{
        minWidth: 0,
        minHeight: 0,
        overflow: 'auto',
        border: '1px solid rgba(34,211,238,0.26)',
        background: '#020617',
        borderRadius: 6,
        padding: 0,
        display: 'grid',
        alignContent: 'stretch',
        gridTemplateRows: hasTextualTuiProof ? 'auto 170px auto auto minmax(220px, 1fr) auto' : 'auto auto minmax(0, 1fr) auto',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '10px 12px',
          borderBottom: '1px solid rgba(34,211,238,0.18)',
          background: '#030712',
        }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: '#67e8f9', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          <Terminal size={13} aria-hidden="true" /> {hasTextualTuiProof ? 'tau tui proof + receipts' : 'tau receipt terminal'}
        </div>
        <span
          data-qid="tau:tui-mirror:current-stage"
          style={{
            color: state.active ? '#fde68a' : '#86efac',
            fontSize: 11,
            whiteSpace: 'nowrap',
          }}
        >
          [{sourceStatus.toLowerCase()}] {sourceStage}
        </span>
      </div>

      {hasTextualTuiProof ? (
        <>
          <div
            data-qid="tau:textual-tui:side-by-side-preview"
            style={{
              minHeight: 0,
              overflow: 'hidden',
              borderBottom: '1px solid rgba(34,211,238,0.16)',
              background: '#020617',
              display: 'grid',
              gridTemplateRows: 'minmax(0, 1fr)',
            }}
          >
            <img
              src={apiUrl('/api/tau/tui/textual-proof/screenshot')}
              alt="Fixture-backed Tau Textual TUI proof screenshot"
              title="Fixture-backed Tau Textual TUI screenshot; mocked=true live=false"
              style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'top left', background: '#020617' }}
            />
          </div>
          <div
            data-qid="tau:textual-tui:side-by-side-label"
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid rgba(34,211,238,0.16)',
              color: '#fde68a',
              fontSize: 10,
              lineHeight: 1.35,
              background: 'rgba(69,26,3,0.28)',
            }}
          >
            Textual TUI artifact from `uv run tau tui-proof`; fixture-backed, mocked=true, live=false. Receipt terminal below is the live event tail.
          </div>
        </>
      ) : null}

      <div
        data-qid="tau:tui-mirror:same-turn-summary"
        title="Same-turn Memory stage mirror from the active Tau chat turn"
        style={{
          borderBottom: '1px solid rgba(34,211,238,0.16)',
          background: 'rgba(8,47,73,0.3)',
          padding: '9px 12px',
          display: 'grid',
          gap: 8,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
          <PeerFact label="run id" value={state.runId} />
          <PeerFact label="route" value={state.route} />
          <PeerFact label="next agent" value={state.nextAgent} />
        </div>
        <div style={{ display: 'grid', gap: 5 }}>
          {state.trace.map((stage, index) => {
            const current = stage.stage === state.currentStage.stage
            return (
              <div
                key={`${stage.stage}-${index}`}
                data-qid={`tau:tui-mirror:visible-stage:${index}:${stage.stage}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                  alignItems: 'center',
                  gap: 7,
                  border: current ? '1px solid rgba(34,211,238,0.44)' : '1px solid rgba(148,163,184,0.12)',
                  background: current ? 'rgba(14,116,144,0.26)' : 'rgba(15,23,42,0.42)',
                  borderRadius: 6,
                  padding: '7px 8px',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: stage.status === 'FAILED' ? '#ef4444' : stage.status === 'SKIPPED' ? '#f97316' : stage.status === 'RUNNING' ? '#facc15' : '#22c55e',
                    boxShadow: current ? '0 0 12px rgba(34,211,238,0.5)' : 'none',
                  }}
                />
                <span style={{ minWidth: 0, color: current ? '#e0f2fe' : '#cbd5e1', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {stage.label}
                </span>
                <span style={{ color: stage.status === 'FAILED' ? '#fca5a5' : stage.status === 'SKIPPED' ? '#fdba74' : stage.status === 'RUNNING' ? '#fde68a' : '#86efac', fontSize: 10 }}>
                  {stage.status}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div
        data-qid="tau:tui-mirror:shared-run"
        ref={terminalHostRef}
        style={{
          minHeight: 0,
          padding: 10,
          overflow: 'hidden',
        }}
      />
      <div data-qid="tau:tui-mirror:stage-list" style={{ display: 'none' }}>
        {state.trace.map((stage, index) => (
          <span key={`${stage.stage}-${index}`} data-qid={`tau:tui-mirror:stage:${stage.stage}`}>
            {stage.label} {stage.source} {stage.status}
          </span>
        ))}
      </div>
      <div data-qid="tau:tui-mirror:receipt-stream" style={{ display: 'none' }}>
        {receiptStream
          ? `${receiptStream.schema} ${receiptStream.runId} events=${receiptStream.eventCount} ${receiptStream.status}`
          : `unavailable ${receiptStreamState?.ok === false ? receiptStreamState.detail : 'loading'}`}
      </div>

      <div
        data-qid="tau:tui-mirror:chat-parity"
        style={{
          borderTop: '1px solid rgba(148,163,184,0.12)',
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          color: '#94a3b8',
          fontSize: 11,
          lineHeight: 1.4,
        }}
      >
        <AudioLines size={14} color="#a78bfa" aria-hidden="true" />
        <span>
          {sourceLabel}; PersonaPlex audio fail-closed until receipt
          ; not an interactive Textual TUI
          {receiptStreamState?.ok === false ? `; fallback reason: ${receiptStreamState.detail}` : ''}
        </span>
      </div>
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
