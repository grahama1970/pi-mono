/**
 * Who is acting in the transport room and what they are doing (name + action + icon).
 */
import type { LucideIcon } from 'lucide-react'
import type { DisplayMessage, DisplayMessageKind } from './messageParse'
import type { CardContract } from './messageCardContract'
import { TRANSPORT_ROLE_VISUALS } from './transportRoleVisuals'
import {
  lucideIconForSubagentPersona,
  normalizeSubagentPersonaSlug,
  roleVisualForSubagentPersona,
} from './subagentPersonaIcons'
import type { TransportRoleVisual } from './transportRoleVisuals'

export interface TransportActorDisplay {
  /** Primary name shown in the message header (e.g. Code reviewer, Project agent). */
  actorName: string
  /** Stable worker slug when applicable (code-reviewer). */
  agentId?: string
  /** Uppercase phase chip (Task, Result, Spawn, …). */
  phaseLabel: string
  /** One-line description of what this actor is doing in this message. */
  actionLine: string
  visual: TransportRoleVisual
  personaSlug: string | null
}

export function workerPersonaName(message: DisplayMessage): string {
  const fromMeta = message.metadata.subagentPersona?.trim()
  if (fromMeta) return fromMeta
  const fromChip = message.chipLabel?.trim()
  if (fromChip && fromChip.toLowerCase() !== 'subagent') return fromChip
  const fromId = message.metadata.agentId?.trim()
  if (fromId) {
    return fromId
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }
  return 'Subagent'
}

function phaseForKind(kind: DisplayMessageKind, message: DisplayMessage): string {
  if (kind === 'human') return 'Steering'
  if (kind === 'agent_card') return 'Spawn'
  if (kind === 'task_card') return 'Task'
  if (kind === 'worker') return message.metadata.verdict ? 'Result' : 'Update'
  if (kind === 'system') return 'System'
  if (kind === 'transport_start') return 'Start'
  if (kind === 'reviewer') return 'Review'
  return 'Message'
}

function actionLineForMessage(message: DisplayMessage, kind: DisplayMessageKind): string {
  if (message.subtitle?.trim()) return message.subtitle.trim()
  const persona = workerPersonaName(message)
  const agentId = message.metadata.agentId?.trim()
  const runtime = message.metadata.workerAgent?.trim()

  switch (kind) {
    case 'human':
      return 'Steering the collaboration (human in the loop)'
    case 'agent_card':
      if (message.title?.toLowerCase().includes('spawned')) {
        return agentId
          ? `Project agent spawned ${persona} (${agentId})`
          : `Project agent spawned ${persona}`
      }
      return `Project agent handed work to ${persona}`
    case 'task_card':
      return runtime
        ? `Assigned task to ${persona} — OpenCode \`${runtime}\``
        : `Assigned task to ${persona}`
    case 'worker':
      if (message.metadata.verdict) {
        return `${persona} completed the task — VERDICT: ${message.metadata.verdict}`
      }
      return `${persona} posted a worker update`
    case 'system':
      return message.collapseLabel || 'Transport system event'
    case 'transport_start':
      return 'Transport run started'
    default:
      if (message.collaborator === 'project_agent') {
        return 'Project agent message in the collaboration room'
      }
      return message.title || 'Collaboration update'
  }
}

export function actorDisplayForMessage(
  message: DisplayMessage,
  contract: CardContract,
): TransportActorDisplay {
  const kind = message.kind
  const phaseLabel = contract.phaseLabel || phaseForKind(kind, message)

  if (kind === 'human') {
    const visual = TRANSPORT_ROLE_VISUALS.human
    return {
      actorName: 'You',
      phaseLabel,
      actionLine: actionLineForMessage(message, kind),
      visual,
      personaSlug: null,
    }
  }

  if (kind === 'worker' || kind === 'task_card' || kind === 'reviewer') {
    const persona = workerPersonaName(message)
    const agentId = message.metadata.agentId?.trim() || undefined
    const personaSlug = normalizeSubagentPersonaSlug(
      persona,
      message.metadata.subagentRoleSlug,
      agentId,
    )
    const visual = roleVisualForSubagentPersona(persona, message.metadata.subagentRoleSlug, agentId)
    return {
      actorName: persona,
      agentId,
      phaseLabel,
      actionLine: actionLineForMessage(message, kind),
      visual: { ...visual, label: persona },
      personaSlug,
    }
  }

  if (kind === 'agent_card' || message.collaborator === 'project_agent') {
    const visual = TRANSPORT_ROLE_VISUALS.planner
    const persona = workerPersonaName(message)
    const spawning = kind === 'agent_card'
    return {
      actorName: 'Project agent',
      phaseLabel: spawning ? 'Spawn' : phaseLabel,
      actionLine: actionLineForMessage(message, spawning ? 'agent_card' : kind),
      visual,
      personaSlug: null,
    }
  }

  if (kind === 'system' || kind === 'transport_start') {
    const visual = TRANSPORT_ROLE_VISUALS.orchestrator
    return {
      actorName: 'Harness',
      phaseLabel,
      actionLine: actionLineForMessage(message, kind),
      visual,
      personaSlug: null,
    }
  }

  const visual = TRANSPORT_ROLE_VISUALS.planner
  return {
    actorName: contract.roleLabel || 'Project agent',
    phaseLabel,
    actionLine: actionLineForMessage(message, kind),
    visual,
    personaSlug: null,
  }
}

export function lucideForMessage(message: DisplayMessage, contract: CardContract): LucideIcon {
  return actorDisplayForMessage(message, contract).visual.Icon
}
