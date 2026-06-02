/**
 * Typed card labels for transport transcript (role + phase + collapse policy).
 */
import type { DisplayMessage, DisplayMessageKind } from './messageParse'

export type CardRoleClass = 'human' | 'reviewer' | 'worker' | 'system'
export type CardIconKind = 'human' | 'handoff' | 'worker' | 'skill' | 'system'

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
  if (kind === 'worker' || kind === 'task_card') return 'worker'
  if (kind === 'system' || kind === 'transport_start') return 'system'
  return 'reviewer'
}

export function cardContractFor(message: DisplayMessage): CardContract {
  if (isSkillCallMessage(message)) {
    return {
      roleLabel: 'Reviewer',
      phaseLabel: 'Skill',
      roleClass: 'reviewer',
      icon: 'skill',
      headerTitle: 'Skill call',
    }
  }

  switch (message.kind) {
    case 'human':
      return {
        roleLabel: 'Human',
        phaseLabel: 'Input',
        roleClass: 'human',
        icon: 'human',
        headerTitle: 'Human',
      }
    case 'agent_card':
      return {
        roleLabel: 'Reviewer',
        phaseLabel: 'Spawn',
        roleClass: 'reviewer',
        icon: 'handoff',
        headerTitle: 'Reviewer spawned worker',
      }
    case 'task_card':
      return {
        roleLabel: 'Worker',
        phaseLabel: 'Spawn',
        roleClass: 'worker',
        icon: 'worker',
        headerTitle: 'Worker task',
      }
    case 'worker':
      return {
        roleLabel: 'Worker',
        phaseLabel: message.metadata.verdict ? 'Result' : 'Handoff',
        roleClass: 'worker',
        icon: 'worker',
        headerTitle: message.metadata.verdict ? 'Worker result' : 'Worker update',
      }
    case 'transport_start':
      return {
        roleLabel: 'System',
        phaseLabel: 'System',
        roleClass: 'system',
        icon: 'system',
        headerTitle: 'Transport started',
      }
    case 'system':
      return {
        roleLabel: 'System',
        phaseLabel: 'System',
        roleClass: 'system',
        icon: 'system',
        headerTitle: message.collapseLabel || 'System event',
      }
    case 'reviewer':
    default:
      return {
        roleLabel: 'Reviewer',
        phaseLabel: 'Handoff',
        roleClass: 'reviewer',
        icon: 'handoff',
        headerTitle: 'Reviewer handoff',
      }
  }
}
