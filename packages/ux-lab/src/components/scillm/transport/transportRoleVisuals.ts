/**
 * Single visual contract for transport room roles (icons, labels, CSS classes, colors).
 */
import type { LucideIcon } from 'lucide-react'
import { BotMessageSquare, Route, Terminal, UserRound, Workflow } from 'lucide-react'
import { EMBRY } from '../../sparta/common/EmbryStyle'
import type { CardIconKind } from './messageCardContract'

export type TransportRoleVisualKey = 'human' | 'planner' | 'orchestrator' | 'subagent' | 'skill'

export interface TransportRoleVisual {
  key: TransportRoleVisualKey
  label: string
  Icon: LucideIcon
  iconSize: number
  strokeWidth: number
  color: string
  /** BEM suffix: transport-message--{cssClass}, transport-message__avatar--{cssClass} */
  cssClass: string
}

export const TRANSPORT_ROLE_VISUALS: Record<TransportRoleVisualKey, TransportRoleVisual> = {
  human: {
    key: 'human',
    label: 'Human',
    Icon: UserRound,
    iconSize: 18,
    strokeWidth: 1.75,
    color: EMBRY.blue,
    cssClass: 'human',
  },
  planner: {
    key: 'planner',
    label: 'Project agent',
    Icon: Route,
    iconSize: 18,
    strokeWidth: 1.75,
    color: EMBRY.amber,
    cssClass: 'planner',
  },
  orchestrator: {
    key: 'orchestrator',
    label: 'Harness',
    Icon: Workflow,
    iconSize: 18,
    strokeWidth: 1.75,
    color: EMBRY.dim,
    cssClass: 'orchestrator',
  },
  subagent: {
    key: 'subagent',
    label: 'Subagent',
    Icon: BotMessageSquare,
    iconSize: 18,
    strokeWidth: 1.75,
    color: EMBRY.green,
    cssClass: 'subagent',
  },
  skill: {
    key: 'skill',
    label: 'Project agent',
    Icon: Terminal,
    iconSize: 18,
    strokeWidth: 1.75,
    color: EMBRY.amber,
    cssClass: 'planner',
  },
}

export function cardIconKindToRoleKey(icon: CardIconKind): TransportRoleVisualKey {
  switch (icon) {
    case 'human':
      return 'human'
    case 'skill':
      return 'skill'
    case 'plan':
      return 'planner'
    case 'orchestrate':
    case 'system':
      return 'orchestrator'
    case 'worker':
      return 'subagent'
    default:
      return 'planner'
  }
}

export function roleVisualForCardIcon(icon: CardIconKind): TransportRoleVisual {
  return TRANSPORT_ROLE_VISUALS[cardIconKindToRoleKey(icon)]
}

export function roleVisualForCollaborator(
  collaborator: string | undefined,
  speaker?: string,
): TransportRoleVisual {
  const key = (collaborator || '').trim()
  if (key === 'human') return TRANSPORT_ROLE_VISUALS.human
  if (key === 'project_agent') return TRANSPORT_ROLE_VISUALS.planner
  if (key === 'worker') return TRANSPORT_ROLE_VISUALS.subagent
  const low = (speaker || '').toLowerCase()
  if (low.includes('worker') || low.includes('subagent')) return TRANSPORT_ROLE_VISUALS.subagent
  if (low.includes('project agent') || low.includes('planner')) return TRANSPORT_ROLE_VISUALS.planner
  if (low === 'human' || low === 'you') return TRANSPORT_ROLE_VISUALS.human
  return TRANSPORT_ROLE_VISUALS.orchestrator
}

export function formatSubagentPersona(kind?: string | null): string {
  const persona = kind?.trim()
  return persona || 'Subagent'
}

export function formatSpawnHeader(
  persona: string,
  agent?: string | null,
  attempt?: number | null,
): string {
  const runtime = agent?.trim()
  const base = runtime
    ? `Spawned subagent: ${persona} → ${runtime}`
    : `Spawned subagent: ${persona}`
  if (attempt && attempt > 0) return `${base} (attempt ${attempt})`
  return base
}

export function formatTaskHeader(persona: string, agentId?: string | null): string {
  const id = agentId?.trim()
  return id ? `${persona} · ${id}` : `${persona} — task`
}

export function formatDispatchSubtitle(persona: string, agent?: string | null): string {
  const runtime = agent?.trim()
  return runtime ? `Dispatching ${persona} → ${runtime}` : `Dispatching ${persona}`
}
