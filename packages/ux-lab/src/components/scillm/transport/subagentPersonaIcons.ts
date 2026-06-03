/**
 * Per-persona Lucide icons for transport subagents (Executor roles).
 * Persona overrides sit on top of TRANSPORT_ROLE_VISUALS (Human / Project agent / Harness).
 * Keys align with scillm opencode_transport.subagent_kind_label where possible.
 */
import type { LucideIcon } from 'lucide-react'
import {
  BotMessageSquare,
  ClipboardCheck,
  CodeXml,
  FilePenLine,
  Gavel,
  Hammer,
  Palette,
  PenLine,
  Scale,
  ScanEye,
  Search,
  SearchCode,
  ShieldCheck,
  SquareTerminal,
  Wrench,
} from 'lucide-react'
import { EMBRY } from '../../sparta/common/EmbryStyle'
import { formatSubagentPersona, type TransportRoleVisual, TRANSPORT_ROLE_VISUALS } from './transportRoleVisuals'

/** Normalized slug for icon lookup and CSS modifier. */
export type SubagentPersonaSlug =
  | 'designer'
  | 'coder'
  | 'runner'
  | 'code_reviewer'
  | 'design_reviewer'
  | 'reviewer'
  | 'prompt_reviewer'
  | 'researcher'
  | 'copywriter'
  | 'editor'
  | 'judge'
  | 'arbiter'
  | 'debugger'
  | 'patch'
  | 'explore'
  | 'build'
  | 'validator'
  | 'worker'

/** Lucide glyph per persona — functional UI glyphs, not illustrative avatars. */
const PERSONA_ICON: Record<SubagentPersonaSlug, LucideIcon> = {
  designer: Palette,
  coder: CodeXml,
  runner: SquareTerminal,
  code_reviewer: SearchCode,
  design_reviewer: ScanEye,
  reviewer: ClipboardCheck,
  prompt_reviewer: ClipboardCheck,
  researcher: Search,
  copywriter: PenLine,
  editor: FilePenLine,
  judge: Scale,
  arbiter: Gavel,
  debugger: SquareTerminal,
  patch: Wrench,
  explore: Search,
  build: Hammer,
  validator: ShieldCheck,
  worker: BotMessageSquare,
}

/** Map display labels and role slugs → normalized slug. */
const PERSONA_ALIASES: Record<string, SubagentPersonaSlug> = {
  designer: 'designer',
  coder: 'coder',
  code: 'coder',
  implementation: 'coder',
  runner: 'runner',
  'terminal coder': 'runner',
  'square terminal': 'runner',
  terminal: 'runner',
  code_reviewer: 'code_reviewer',
  'code reviewer': 'code_reviewer',
  codereviewer: 'code_reviewer',
  design_reviewer: 'design_reviewer',
  'design reviewer': 'design_reviewer',
  designreviewer: 'design_reviewer',
  reviewer: 'reviewer',
  researcher: 'researcher',
  research: 'researcher',
  copywriter: 'copywriter',
  'copy writer': 'copywriter',
  editor: 'editor',
  'doc writer': 'editor',
  'document writer': 'editor',
  judge: 'judge',
  arbiter: 'arbiter',
  'hard judge': 'arbiter',
  debugger: 'debugger',
  'scillm-debugger': 'debugger',
  patch: 'patch',
  patcher: 'patch',
  'patch worker': 'patch',
  explore: 'explore',
  explorer: 'explore',
  build: 'build',
  builder: 'build',
  validator: 'validator',
  worker: 'worker',
  subagent: 'worker',
}

export function normalizeSubagentPersonaSlug(
  persona?: string | null,
  roleSlug?: string | null,
  agentId?: string | null,
): SubagentPersonaSlug {
  for (const raw of [persona, roleSlug]) {
    const s = (raw || '').trim().toLowerCase()
    if (!s) continue
    if (PERSONA_ALIASES[s]) return PERSONA_ALIASES[s]
    const compact = s.replace(/[\s_-]+/g, '')
    if (PERSONA_ALIASES[compact]) return PERSONA_ALIASES[compact]
    if (s.includes('code') && s.includes('review')) return 'code_reviewer'
    if (s.includes('design') && s.includes('review')) return 'design_reviewer'
    if (s.includes('copy') && (s.includes('write') || s.includes('writer'))) return 'copywriter'
    if (s.includes('terminal') || s.includes('shell') || s.includes('cli')) return 'runner'
  }
  const fallback = (persona || roleSlug || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (fallback && fallback in PERSONA_ICON) return fallback as SubagentPersonaSlug
  return 'worker'
}

export function lucideIconForSubagentPersona(
  persona?: string | null,
  roleSlug?: string | null,
  agentId?: string | null,
): LucideIcon {
  const slug = normalizeSubagentPersonaSlug(persona, roleSlug, agentId)
  return PERSONA_ICON[slug] ?? BotMessageSquare
}

/** Subagent visual with persona-specific icon; shares size/color with generic subagent lane. */
export function roleVisualForSubagentPersona(
  persona?: string | null,
  roleSlug?: string | null,
  agentId?: string | null,
): TransportRoleVisual {
  const slug = normalizeSubagentPersonaSlug(persona, roleSlug, agentId)
  const base = TRANSPORT_ROLE_VISUALS.subagent
  const label = formatSubagentPersona(persona || roleSlug)
  return {
    ...base,
    key: 'subagent',
    label,
    Icon: PERSONA_ICON[slug],
    cssClass: `subagent subagent--${slug}`,
    color: base.color ?? EMBRY.green,
  }
}
