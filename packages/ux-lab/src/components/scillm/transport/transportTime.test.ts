import { describe, expect, it } from 'vitest'
import { humanizeRunLabel, runDisplayName } from './transportTime'

describe('runDisplayName', () => {
  it('humanizes harness dag nodes', () => {
    expect(
      runDisplayName({
        transport_run_id: 'otr-75643656e866',
        dag_node_id: 'phased-agentic-example-attempt-2-code_review_gate',
      }),
    ).toBe('Attempt 2 · Code Review Gate')
  })

  it('humanizes verify runs', () => {
    expect(
      runDisplayName({
        transport_run_id: 'otr-95f37fdf3941',
        dag_node_id: 'transport-verify-persona-010',
      }),
    ).toBe('Verify Persona 010')
  })

  it('falls back to short run id', () => {
    expect(runDisplayName({ transport_run_id: 'otr-95f37fdf3941' })).toBe('Run 95f37fdf')
  })
})

describe('humanizeRunLabel', () => {
  it('handles patch worker labels', () => {
    expect(humanizeRunLabel('phased-agentic-example-attempt-2-patch_worker_write')).toBe(
      'Attempt 2 · Patch Worker Write',
    )
  })
})
