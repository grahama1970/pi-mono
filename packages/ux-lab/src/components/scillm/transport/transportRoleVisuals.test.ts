import { describe, expect, it } from 'vitest'
import { cardIconKindToRoleKey, formatSpawnHeader, roleVisualForCardIcon } from './transportRoleVisuals'

describe('transportRoleVisuals', () => {
  it('maps orchestrate to harness visual', () => {
    expect(roleVisualForCardIcon('orchestrate').label).toBe('Harness')
    expect(cardIconKindToRoleKey('orchestrate')).toBe('orchestrator')
  })

  it('formats spawn header with persona and runtime', () => {
    expect(formatSpawnHeader('Reviewer', 'scillm-worker', 1)).toBe(
      'Spawned subagent: Reviewer → scillm-worker (attempt 1)',
    )
  })
})
