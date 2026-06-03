import { describe, expect, it } from 'vitest'
import { buildStructuredAttachmentIndex } from './attachmentEvents'
import type { TransportStreamEvent } from './types'

describe('attachmentEvents', () => {
  it('indexes evidence_case_snapshot and figure_artifact by call id', () => {
    const events: TransportStreamEvent[] = [
      {
        event_type: 'evidence_case_snapshot',
        subagent_run_id: 'call-1',
        evidence_case: {
          verdict: 'satisfied',
          gates_passed: 1,
          gates_total: 1,
          gate_summary: 'ok',
          control_ids: [],
          tier: 'grounded',
        },
      },
      {
        event_type: 'figure_artifact',
        subagent_run_id: 'call-1',
        figure: {
          path: '/tmp/a.png',
          label: 'a.png',
          format: 'png',
          artifact_name: 'a.png',
          artifact_url: '/v1/scillm/opencode/transport/runs/otr-x/artifacts/a.png',
        },
      },
    ]
    const index = buildStructuredAttachmentIndex(events, 'otr-x')
    expect(index.evidenceByCall.get('call-1')?.verdict).toBe('satisfied')
    expect(index.figuresByCall.get('call-1')).toHaveLength(1)
    expect(index.figuresByCall.get('call-1')?.[0]?.previewUrl).toContain('/artifacts/a.png')
  })
})
