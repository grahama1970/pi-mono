/**
 * Parse transport dialog turns into Kimi mockup-aligned display models.
 */
import type { TransportCollaborator, TransportDialogTurn, TransportSubagentSummary } from './types'
import { deriveRunHealth } from './runHealth'
import {
  formatDispatchSubtitle,
  formatSpawnHeader,
  formatSubagentPersona,
  formatTaskHeader,
} from './transportRoleVisuals'


function structuredChipLabel(turn: TransportDialogTurn): string | null {
  if (turn.subagent_label?.trim()) {
    const head = turn.subagent_label.split('·')[0]?.trim()
    if (head) return head
  }
  if (turn.subagent_kind?.trim()) return formatSubagentPersona(turn.subagent_kind)
  if (turn.agent_id?.trim()) return formatSubagentPersona(turn.agent_id.replace(/-/g, ' '))
  return null
}

function structuredTitle(turn: TransportDialogTurn, fallback: string): string {
  if (turn.subagent_label?.trim()) return turn.subagent_label.trim()
  const persona = formatSubagentPersona(turn.subagent_kind)
  if (turn.agent) return `${persona} · ${turn.agent}`
  if (turn.subagent_kind?.trim()) return persona
  return fallback
}

const SPEAKER_PREFIX = /^\*\*(.+?)\*\*\s*\n+/s
const FORWARD_RE = /forwarding\s+\*\*human\*\*/i
const SPAWN_RE = /spawned\s+(?:worker|[\w*]+)/i
const DISPATCH_RE = /dispatching\s+\*\*[^*]+\*\*/i
const START_RE = /started transport run/i
const TASK_RE = /##\s*Worker task|you are the external reviewer/i
const VERDICT_RE = /VERDICT:\s*(\w+)/i
const SESSION_RE = /(?:Worker session|session):\s*`?(ses_[a-zA-Z0-9]+)`?/gi
const URL_RE = /https?:\/\/[^\s`)>]+/g
const PROOF_ROUND_RE = /proof round\s+(\d+)/i
const OPENCODE_TAB_RE = /opencode tab\s+(\d+)/i
const CODE_FENCE_RE = /```[\s\S]*?```/g
const MODE_RE = /Mode:\s*`?([^`\n]+)`?/i

export type DisplayMessageKind =
  | 'human'
  | 'reviewer'
  | 'worker'
  | 'system'
  | 'agent_card'
  | 'task_card'
  | 'transport_start'

export interface DisplayMetadata {
  sessions: string[]
  urls: string[]
  verdict?: string
  workerAgent?: string
  model?: string
  mode?: string
  subagentRunId?: string
  attemptId?: number
  subagentPersona?: string
  subagentRoleSlug?: string
  agentId?: string
}

export interface DisplayMessage {
  id: string
  kind: DisplayMessageKind
  collaborator: TransportCollaborator
  speaker: string
  chipLabel: string
  title: string
  subtitle?: string
  prose: string
  artifacts: string[]
  collapsed: boolean
  collapseLabel?: string
  metadata: DisplayMetadata
  raw: string
  skills?: string[]
  apiRouting?: RoutingHint
}

export function stripSpeakerMarkdown(text: string): string {
  return text.replace(SPEAKER_PREFIX, '').trim()
}

function extractMetadata(text: string): DisplayMetadata {
  const sessions = [...text.matchAll(SESSION_RE)].map((m) => m[1]).filter(Boolean)
  const urls = [...new Set((text.match(URL_RE) || []).filter((u) => !u.includes('localhost:3002')))]
  const verdict = text.match(VERDICT_RE)?.[1]
  const workerAgent = text.match(/Agent:\s*`([^`]+)`/i)?.[1]
    ?? (text.match(/scillm-worker/i) ? 'scillm-worker' : undefined)
  const model = text.match(/model\s+`([^`]+)`/i)?.[1] ?? text.match(/model\s+(\S+)/i)?.[1]
  const mode = text.match(MODE_RE)?.[1]?.trim()
  return { sessions: [...new Set(sessions)], urls, verdict, workerAgent, model, mode }
}

export function stripUrlsFromProse(prose: string, urls: string[]): string {
  const drop = new Set(urls)
  return prose
    .replace(URL_RE, (match) => (drop.has(match) ? '' : match))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitArtifacts(body: string): { prose: string; artifacts: string[] } {
  const artifacts: string[] = []
  const prose = body.replace(CODE_FENCE_RE, (block) => {
    artifacts.push(block.replace(/^```\w*\n?/, '').replace(/```$/, '').trim())
    return ''
  }).replace(/\n{3,}/g, '\n\n').trim()
  return { prose, artifacts }
}

function classifyKind(turn: TransportDialogTurn, body: string): DisplayMessageKind {
  if (turn.collaborator === 'human') return 'human'
  if (FORWARD_RE.test(body)) return 'system'
  if (TASK_RE.test(body)) return 'task_card'
  if (turn.collaborator === 'worker' || /worker\s*\(/i.test(turn.speaker)) return 'worker'
  if (
    turn.subagent_run_id && (SPAWN_RE.test(body) || DISPATCH_RE.test(body))
  ) return 'agent_card'
  if (SPAWN_RE.test(body) || (DISPATCH_RE.test(body) && /Agent:/i.test(body))) return 'agent_card'
  if (START_RE.test(body)) return 'transport_start'
  if (turn.collaborator === 'opencode_model' && !body.trim()) return 'system'
  if (turn.collaborator === 'project_agent') return 'reviewer'
  return 'reviewer'
}

const CHIP: Record<DisplayMessageKind, string> = {
  human: 'Human',
  reviewer: 'Project agent',
  worker: 'Worker',
  system: 'System',
  agent_card: 'Project agent',
  task_card: 'Worker',
  transport_start: 'System',
}

function attachApiRouting(message: DisplayMessage, turn: TransportDialogTurn): DisplayMessage {
  const apiRouting = routingHintFromTurn(turn)
  if (apiRouting) message.apiRouting = apiRouting
  return message
}

export function parseDisplayMessage(turn: TransportDialogTurn): DisplayMessage {
  return attachApiRouting(_parseDisplayMessageInner(turn), turn)
}

function _parseDisplayMessageInner(turn: TransportDialogTurn): DisplayMessage {
  const raw = turn.text || ''
  const body = stripSpeakerMarkdown(raw)

  if (!body && turn.collaborator === 'opencode_model') {
    return {
      id: turn.message_id,
      kind: 'system',
      collaborator: turn.collaborator,
      speaker: 'Transport',
      chipLabel: 'System',
      title: 'Transport',
      prose: '',
      artifacts: [],
      collapsed: true,
      collapseLabel: 'OpenCode model turn',
      metadata: {},
      raw,
    }
  }

  const kind = classifyKind(turn, body)
  const metadata = extractMetadata(body)
  const { prose: rawProse, artifacts } = splitArtifacts(body)
  const prose = stripUrlsFromProse(rawProse, metadata.urls)

  if (kind === 'system') {
    return {
      id: turn.message_id,
      kind: 'system',
      collaborator: turn.collaborator,
      speaker: 'Transport',
      chipLabel: 'System',
      title: 'Transport',
      prose: '',
      artifacts: [],
      collapsed: true,
      collapseLabel: 'Forwarded human input to dispatch',
      metadata,
      raw,
    }
  }

  if (kind === 'agent_card') {
    const attempt = turn.attempt_id || Number(body.match(/attempt\s+(\d+)/i)?.[1] || 0)
    const persona = structuredChipLabel(turn) || formatSubagentPersona(turn.subagent_kind)
    const agent = turn.agent || metadata.workerAgent
    return {
      id: turn.message_id,
      kind: 'agent_card',
      collaborator: turn.collaborator,
      speaker: 'Project agent',
      chipLabel: persona,
      title: formatSpawnHeader(persona, agent, attempt || undefined),
      subtitle: DISPATCH_RE.test(body)
        ? formatDispatchSubtitle(persona, agent)
        : 'Subagent handoff',
      prose,
      artifacts,
      collapsed: false,
      metadata: {
        ...metadata,
        subagentRunId: turn.subagent_run_id,
        attemptId: turn.attempt_id,
        workerAgent: turn.agent || metadata.workerAgent,
        agentId: turn.agent_id,
        subagentPersona: persona,
        subagentRoleSlug: turn.role,
      },
      raw,
      skills: turn.skills,
    }
  }

  if (kind === 'task_card') {
    const persona = structuredChipLabel(turn) || formatSubagentPersona(turn.subagent_kind)
    const title = turn.subagent_label?.trim() || formatTaskHeader(persona)
    const subtitle = DISPATCH_RE.test(body)
      ? formatDispatchSubtitle(persona, turn.agent || metadata.workerAgent)
      : undefined
    return {
      id: turn.message_id,
      kind: 'task_card',
      collaborator: 'worker',
      speaker: persona,
      chipLabel: persona,
      title,
      subtitle,
      prose,
      artifacts,
      collapsed: false,
      metadata: {
        ...metadata,
        subagentRunId: turn.subagent_run_id,
        attemptId: turn.attempt_id,
        workerAgent: turn.agent || metadata.workerAgent,
        agentId: turn.agent_id,
        subagentPersona: persona,
        subagentRoleSlug: turn.role,
      },
      raw,
      skills: turn.skills,
    }
  }

  if (kind === 'transport_start') {
    return {
      id: turn.message_id,
      kind: 'transport_start',
      collaborator: turn.collaborator,
      speaker: 'Transport',
      chipLabel: 'System',
      title: 'Transport',
      prose,
      artifacts,
      collapsed: false,
      metadata,
      raw,
    }
  }

  const chipFromApi = structuredChipLabel(turn)
  const speaker = turn.speaker || CHIP[kind]
  const chipLabel = chipFromApi || CHIP[kind]
  const title = structuredTitle(turn, speaker)
  const displayKind =
    chipFromApi && kind === 'reviewer' && turn.collaborator === 'worker' ? 'worker' : kind
  return {
    id: turn.message_id,
    kind: displayKind,
    collaborator: turn.collaborator,
    speaker,
    chipLabel,
    title,
    subtitle: turn.mode ? `Mode: ${turn.mode}` : turn.attempt_id ? `Attempt ${turn.attempt_id}` : undefined,
    prose,
    artifacts,
    collapsed: false,
    metadata: {
      ...metadata,
      workerAgent: turn.agent || metadata.workerAgent,
      mode: turn.mode || metadata.mode,
      subagentRunId: turn.subagent_run_id,
      attemptId: turn.attempt_id,
      subagentPersona: chipFromApi || (kind === 'worker' ? formatSubagentPersona(turn.subagent_kind) : undefined),
      subagentRoleSlug: turn.role,
      agentId: turn.agent_id,
    },
    raw,
    skills: turn.skills,
  }
}


export interface RoutingHint {
  label: string
  tone: 'to-human' | 'to-reviewer' | 'to-worker'
  inferred: boolean
}

export function routingHintFromTurn(turn: TransportDialogTurn): RoutingHint | null {
  const hint = turn.routing_hint
  if (!hint?.label || !hint.tone) return null
  return {
    label: hint.label,
    tone: hint.tone,
    inferred: hint.inferred ?? false,
  }
}

/** Prefer API routing_hint; fall back to heuristic when absent. */
export function inferRoutingHint(
  message: DisplayMessage,
  turn?: TransportDialogTurn,
): RoutingHint | null {
  if (turn) {
    const fromApi = routingHintFromTurn(turn)
    if (fromApi) return fromApi
  }
  if (message.kind === 'human') {
    return { label: 'Project agent room', tone: 'to-reviewer', inferred: true }
  }
  if (message.kind === 'worker') {
    return { label: 'Collaboration room', tone: 'to-human', inferred: true }
  }
  if (message.kind === 'reviewer' && /dispatch/i.test(message.prose)) {
    return { label: 'Subagent', tone: 'to-worker', inferred: true }
  }
  return null
}

export function parseDisplayMessages(turns: TransportDialogTurn[]): DisplayMessage[] {
  return turns.map((turn) => attachApiRouting(parseDisplayMessage(turn), turn))
}

export function extractProofRoundLabel(runId: string, dagNodeId?: string): string {
  const fromRun = runId.match(/r(\d{3,})$/i) || runId.match(/-(\d{3,})$/i)
  if (fromRun) {
    const n = fromRun[1].replace(/^r/i, '')
    return `Proof Round ${n}`
  }
  const fromDag = dagNodeId?.match(/r(\d{3,})$/i)
  if (fromDag) {
    return `Proof Round ${fromDag[1]}`
  }
  return 'Collaboration thread'
}

export function extractSteeringTab(turns: TransportDialogTurn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const m = turns[i].text?.match(OPENCODE_TAB_RE)
    if (m) return m[1]
  }
  return null
}

export type RunStatusKind = 'awaiting_human' | 'running' | 'completed' | 'idle' | 'offline' | 'aborted'

export function deriveRunStatus(
  pendingCount: number,
  deliveryState?: string,
  streamConnected?: boolean,
): { kind: RunStatusKind; label: string; sublabel?: string } {
  const h = deriveRunHealth({
    runId: 'status',
    pendingCount,
    deliveryState,
    sseLive: Boolean(streamConnected),
    events: [],
    workerTraceAvailable: false,
  })
  return { kind: h.kind, label: h.label, sublabel: h.sublabel }
}
