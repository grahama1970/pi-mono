import { describe, expect, it } from 'vitest'
import { classifyVoiceRun, summarizeVoiceReadiness, type VoiceReadinessRun } from './embryVoiceReadiness'

function run(id: string, gateStatuses: Array<'passed' | 'failed' | 'pending'>, failedGates: string[] = [], active = false): VoiceReadinessRun {
  return {
    id,
    ok: failedGates.length === 0 && !gateStatuses.includes('failed'),
    active,
    live: true,
    mocked: false,
    failedGates,
    gates: gateStatuses.map((status, index) => ({ status, name: `${id}:${index}` })),
  }
}

describe('embryVoiceReadiness', () => {
  it('keeps superseded browser ASR failures out of current readiness', () => {
    const classified = classifyVoiceRun(run('browser-asr-blocker', ['passed', 'failed', 'failed'], ['realtimestt_listener_ok', 'listener_transcript_present']))

    expect(classified.classification).toBe('historical')
    expect(classified.currentProfileApplies).toBe(false)
    expect(classified.supersededBy).toBe('browser-webcam-success')
  })

  it('separates current readiness from retained device and requirements evidence', () => {
    const summary = summarizeVoiceReadiness([
      run('full-audible-suite', ['passed', 'passed', 'passed', 'passed'], [], true),
      run('browser-asr-blocker', ['passed', 'failed', 'failed'], ['realtimestt_listener_ok', 'listener_transcript_present']),
      run('device-failure-matrix', ['failed', 'failed'], ['jabra_empty_asr', 'default_zero_rms']),
      run('requirements-gap', ['pending'], ['seeded_session_only']),
    ])

    expect(summary.currentState).toBe('ready')
    expect(summary.current.failed).toBe(0)
    expect(summary.current.passed).toBe(4)
    expect(summary.retained.failedGates).toBe(4)
    expect(summary.device.failedGates).toBe(2)
    expect(summary.requirements.pendingGates).toBe(1)
    expect(summary.plantState).toBe('degraded')
  })

  it('fails closed when there is no current active receipt', () => {
    const summary = summarizeVoiceReadiness([
      run('browser-asr-blocker', ['failed'], ['listener_transcript_present']),
      run('device-failure-matrix', ['failed'], ['jabra_empty_asr']),
    ])

    expect(summary.currentState).toBe('unknown')
    expect(summary.current.runCount).toBe(0)
    expect(summary.retained.failedGates).toBe(2)
  })
})
