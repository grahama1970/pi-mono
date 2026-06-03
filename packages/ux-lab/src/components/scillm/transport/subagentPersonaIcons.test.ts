import { describe, expect, it } from 'vitest'
import {
  BotMessageSquare,
  ClipboardCheck,
  CodeXml,
  Palette,
  Scale,
  ScanEye,
  Search,
  SearchCode,
  SquareTerminal,
} from 'lucide-react'
import { lucideIconForSubagentPersona, normalizeSubagentPersonaSlug, roleVisualForSubagentPersona } from './subagentPersonaIcons'

describe('subagentPersonaIcons', () => {
  it('normalizes scillm display labels to slugs', () => {
    expect(normalizeSubagentPersonaSlug('Reviewer', 'reviewer')).toBe('reviewer')
    expect(normalizeSubagentPersonaSlug('Debugger', 'debugger')).toBe('debugger')
    expect(normalizeSubagentPersonaSlug('Patch worker', 'patch')).toBe('patch')
    expect(normalizeSubagentPersonaSlug('Code reviewer', 'reviewer')).toBe('code_reviewer')
  })

  it('maps personas to recommended Lucide icons', () => {
    expect(lucideIconForSubagentPersona('Reviewer')).toBe(ClipboardCheck)
    expect(lucideIconForSubagentPersona('Code reviewer')).toBe(SearchCode)
    expect(lucideIconForSubagentPersona('Design reviewer')).toBe(ScanEye)
    expect(lucideIconForSubagentPersona('Debugger')).toBe(SquareTerminal)
    expect(lucideIconForSubagentPersona('Designer')).toBe(Palette)
    expect(lucideIconForSubagentPersona('Coder')).toBe(CodeXml)
    expect(lucideIconForSubagentPersona('Judge')).toBe(Scale)
    expect(lucideIconForSubagentPersona('Researcher')).toBe(Search)
    expect(lucideIconForSubagentPersona('unknown-role')).toBe(BotMessageSquare)
  })

  it('returns css modifier per persona', () => {
    expect(roleVisualForSubagentPersona('Reviewer').cssClass).toContain('subagent--reviewer')
  })
})
