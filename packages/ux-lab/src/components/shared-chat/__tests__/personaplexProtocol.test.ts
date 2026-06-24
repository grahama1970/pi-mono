import { describe, expect, it } from 'vitest'
import { buildSpeechFinalMessage, traceRowsFromEvents } from '../personaplexProtocol'

describe('personaplexProtocol', () => {
  it('builds the golden_state_server speech_final envelope', () => {
    expect(
      buildSpeechFinalMessage({
        sessionId: 'session-1',
        text: '  hello Embry  ',
        personaId: 'embry',
        turnId: 3,
      }),
    ).toEqual({
      type: 'speech_final',
      session_id: 'session-1',
      text: 'hello Embry',
      persona_id: 'embry',
      turn_id: 3,
    })
  })

  it('maps real_* server events to visible trace rows', () => {
    const rows = traceRowsFromEvents([
      {
        type: 'grounding_stage',
        stage: 'gpu_personaplex',
        status: 'complete',
        real_flags: {
          real_personaplex_ws: true,
          real_memory_intent: true,
          real_gpu_personaplex: true,
        },
      },
    ])
    expect(rows.find((row) => row.realFlag === 'real_personaplex_ws')?.real).toBe(true)
    expect(rows.find((row) => row.realFlag === 'real_memory_intent')?.real).toBe(true)
    expect(rows.find((row) => row.realFlag === 'real_gpu_personaplex')?.real).toBe(true)
  })
})
