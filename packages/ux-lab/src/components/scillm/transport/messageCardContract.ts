/**
 * Typed card labels for transport transcript (role + phase + collapse policy).
 */
import type { DisplayMessage, DisplayMessageKind } from './messageParse'
import { TRANSPORT_ROLE_VISUALS } from './transportRoleVisuals'
import { workerPersonaName } from './transportActorDisplay'

export type CardRoleClass = 'human' | 'planner' | 'subagent' | 'orchestrator'
/** plan=Route (planner); orchestrate=Workflow (harness dispatch/spawn/system) */
export type CardIconKind = 'human' | 'plan' | 'orchestrate' | 'worker' | 'skill' | 'system'

export interface CardContract {
  roleLabel: string
  phaseLabel: string
  roleClass: CardRoleClass
  icon: CardIconKind
  headerTitle: string
}

const COLLAPSE_CHARS = 280

export function messageBodyLength(message: DisplayMessage): number {
  return (
    message.prose.length
    + message.artifacts.reduce((n, a) => n + a.length, 0)
    + (message.raw?.length ?? 0)
  )
}

export function isSkillCallMessage(message: DisplayMessage): boolean {
  const blob = `${message.raw}\n${message.prose}`.toLowerCase()
  return (
    /skill[_\s-]?call/.test(blob)
    || /scillm\.skill_call/.test(blob)
    || (Boolean(message.skills?.length) && /\/(?:dogpile|memory|debugger|scillm)\b/.test(blob))
  )
}

export function shouldCollapseByDefault(message: DisplayMessage): boolean {
  if (message.kind === 'task_card') return true
  if (message.kind === 'agent_card') return messageBodyLength(message) > 220
  if (message.kind === 'worker') return messageBodyLength(message) > COLLAPSE_CHARS
  if (message.kind === 'reviewer') return messageBodyLength(message) > 400
  if (isSkillCallMessage(message)) return messageBodyLength(message) > 180
  return false
}

export function summarizeMessage(message: DisplayMessage): string {
  if (message.metadata.verdict) {
    return `VERDICT: ${message.metadata.verdict}`
  }
  const lines = message.prose.split('\n').map((l) => l.trim()).filter(Boolean)
  const headline = lines.find((l) => !l.startsWith('#') && !l.startsWith('Mode:'))
    ?? lines[0]
    ?? message.title
  if (!headline) return '—'
  return headline.length > 160 ? `${headline.slice(0, 157)}…` : headline
}

function roleClassFor(kind: DisplayMessageKind): CardRoleClass {
  if (kind === 'human') return 'human'
  if (kind === 'worker' || kind === 'task_card') return 'subagent'
  if (kind === 'system' || kind === 'transport_start') return 'orchestrator'
  return 'planner'
}

export function cardContractFor(message: DisplayMessage): CardContract {
  if (isSkillCallMessage(message)) {
    const v = TRANSPORT_ROLE_VISUALS.skill
    return {
      roleLabel: v.label,
      phaseLabel: 'Skill',
      roleClass: 'planner',
      icon: 'skill',
      headerTitle: 'Skill call',
    }
  }

  switch (message.kind) {
    case 'human': {
      const v = TRANSPORT_ROLE_VISUALS.human
      return {
        roleLabel: v.label,
        phaseLabel: 'Steering',
        roleClass: 'human',
        icon: 'human',
        headerTitle: 'Human',
      }
    }
    case 'agent_card': {
      const v = TRANSPORT_ROLE_VISUALS.planner
      const persona = workerPersonaName(message)
      return {
        roleLabel: v.label,
        phaseLabel: 'Spawn',
        roleClass: 'planner',
        icon: 'plan',
        headerTitle: message.title || `Spawned ${persona}`,
      }
    }
    case 'task_card': {
      const persona = workerPersonaName(message)
      return {
        roleLabel: persona,
        phaseLabel: 'Task',
        roleClass: 'subagent',
        icon: 'worker',
        headerTitle: message.title || `${persona} — task`,
      }
    }
    case 'worker': {
      const persona = workerPersonaName(message)
      return {
        roleLabel: persona,
        phaseLabel: message.metadata.verdict ? 'Result' : 'Update',
        roleClass: 'subagent',
        icon: 'worker',
        headerTitle: message.metadata.verdict
          ? `${persona} — ${message.metadata.verdict}`
          : `${persona} — update`,
      }
    }
    case 'transport_start': {
      const v = TRANSPORT_ROLE_VISUALS.orchestrator
      return {
        roleLabel: v.label,
        phaseLabel: 'Transport',
        roleClass: 'orchestrator',
        icon: 'orchestrate',
        headerTitle: 'Transport started',
      }
    }
    case 'system': {
      const v = TRANSPORT_ROLE_VISUALS.orchestrator
      return {
        roleLabel: v.label,
        phaseLabel: 'System',
        roleClass: 'orchestrator',
        icon: 'orchestrate',
        headerTitle: message.collapseLabel || 'Harness event',
      }
    }
    case 'reviewer':
    default: {
      const v = TRANSPORT_ROLE_VISUALS.planner
      return {
        roleLabel: v.label,
        phaseLabel: 'Plan',
        roleClass: 'planner',
        icon: 'plan',
        headerTitle: 'Project agent update',
      }
    }
  }
}
