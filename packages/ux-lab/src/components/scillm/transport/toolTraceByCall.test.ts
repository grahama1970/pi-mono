import { describe, expect, it } from 'vitest'
import { buildToolTraceByCall } from './toolTraceByCall'
import type { TransportStreamEvent } from './types'

const CALL_ID = 'otr-run-tools-1'

describe('buildToolTraceByCall', () => {
  it('merges tool_call rows per call', () => {
    const events: TransportStreamEvent[] = [
      {
        event_type: 'tool_call',
        subagent_run_id: CALL_ID,
        tool: 'read',
        status: 'running',
        part_id: 'p1',
      },
      {
        event_type: 'tool_call',
        subagent_run_id: CALL_ID,
        tool: 'read',
        status: 'completed',
        output_excerpt: 'done',
        part_id: 'p1',
      },
      {
        event_type: 'tool_call',
        subagent_run_id: CALL_ID,
        tool: 'bash',
        status: 'completed',
        output_excerpt: 'ok',
      },
    ]
    const rows = buildToolTraceByCall(events).get(CALL_ID)
    expect(rows).toHaveLength(2)
    expect(rows?.[0].tool).toBe('read')
    expect(rows?.[0].status).toBe('completed')
    expect(rows?.[0].outputExcerpt).toBe('done')
  })
})
