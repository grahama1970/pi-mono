export type VoiceReadinessClass = 'current' | 'historical' | 'device' | 'factory' | 'requirements'

export type VoiceReadinessRun = {
  id: string
  ok: boolean
  active?: boolean
  live: boolean
  mocked: boolean
  failedGates: string[]
  gates: Array<{ status: 'passed' | 'failed' | 'pending' }>
}

export type ClassifiedVoiceRun<T extends VoiceReadinessRun = VoiceReadinessRun> = {
  run: T
  classification: VoiceReadinessClass
  currentProfileApplies: boolean
  label: string
  impact: string
  supersededBy?: string
}

export type VoiceReadinessSummary = {
  current: { passed: number; pending: number; failed: number; runCount: number }
  retained: { failedRuns: number; failedGates: number }
  device: { failedRuns: number; failedGates: number }
  factory: { failedRuns: number; failedGates: number }
  requirements: { pendingRuns: number; pendingGates: number }
  currentState: 'ready' | 'degraded' | 'blocked' | 'unknown'
  plantState: 'ready' | 'degraded' | 'blocked' | 'unknown'
}

export function classifyVoiceRun<T extends VoiceReadinessRun>(run: T): ClassifiedVoiceRun<T> {
  if (run.id === 'browser-asr-blocker') {
    return {
      run,
      classification: 'historical',
      currentProfileApplies: false,
      label: 'Superseded browser ASR regression',
      impact: 'Retained as regression evidence; not counted against current browser/lab readiness.',
      supersededBy: 'browser-webcam-success',
    }
  }
  if (run.id === 'device-failure-matrix') {
    return {
      run,
      classification: 'device',
      currentProfileApplies: false,
      label: 'Device qualification failure',
      impact: 'Blocks only the named Jabra/default device profiles; retained outside current browser/lab readiness.',
    }
  }
  if (run.id === 'requirements-gap') {
    return {
      run,
      classification: 'requirements',
      currentProfileApplies: false,
      label: 'Requirements gap',
      impact: 'Pending non-mocked coverage remains visible but is not a current live-readiness failure.',
    }
  }
  if (run.id.includes('factory') && !run.ok) {
    return {
      run,
      classification: 'factory',
      currentProfileApplies: false,
      label: 'Factory acoustic qualification failure',
      impact: 'Blocks plant-floor qualification until scoped and retested.',
    }
  }
  return {
    run,
    classification: 'current',
    currentProfileApplies: Boolean(run.active),
    label: run.active ? 'Current browser/lab readiness authority' : 'Supporting current-profile proof',
    impact: run.active
      ? 'Drives the current browser/lab readiness banner.'
      : 'Supports the live voice path without being the active readiness authority.',
  }
}

function gateCount(run: VoiceReadinessRun, status: 'passed' | 'failed' | 'pending'): number {
  return run.gates.filter((gate) => gate.status === status).length
}

export function summarizeVoiceReadiness<T extends VoiceReadinessRun>(runs: T[]): VoiceReadinessSummary {
  const classified = runs.map(classifyVoiceRun)
  const currentRuns = classified.filter((item) => item.currentProfileApplies).map((item) => item.run)
  const current = currentRuns.reduce(
    (summary, run) => ({
      passed: summary.passed + gateCount(run, 'passed'),
      pending: summary.pending + gateCount(run, 'pending'),
      failed: summary.failed + gateCount(run, 'failed'),
      runCount: summary.runCount + 1,
    }),
    { passed: 0, pending: 0, failed: 0, runCount: 0 },
  )
  const failedByClass = (classification: VoiceReadinessClass) => classified
    .filter((item) => item.classification === classification && item.run.failedGates.length > 0)
  const pendingRequirements = classified
    .filter((item) => item.classification === 'requirements')
    .map((item) => item.run)
  const retainedFailures = classified.filter((item) => (
    (item.classification === 'historical' || item.classification === 'device' || item.classification === 'factory')
    && item.run.failedGates.length > 0
  ))
  const retainedFailedGates = retainedFailures.reduce((count, item) => count + item.run.failedGates.length, 0)
  const deviceFailures = failedByClass('device')
  const factoryFailures = failedByClass('factory')
  const requirementsPendingGates = pendingRequirements.reduce((count, run) => count + gateCount(run, 'pending'), 0)
  const currentState = current.runCount === 0
    ? 'unknown'
    : current.failed > 0
      ? 'blocked'
      : current.pending > 0
        ? 'degraded'
        : 'ready'
  const plantState = factoryFailures.length || deviceFailures.length || requirementsPendingGates
    ? 'degraded'
    : currentState
  return {
    current,
    retained: {
      failedRuns: retainedFailures.length,
      failedGates: retainedFailedGates,
    },
    device: {
      failedRuns: deviceFailures.length,
      failedGates: deviceFailures.reduce((count, item) => count + item.run.failedGates.length, 0),
    },
    factory: {
      failedRuns: factoryFailures.length,
      failedGates: factoryFailures.reduce((count, item) => count + item.run.failedGates.length, 0),
    },
    requirements: {
      pendingRuns: pendingRequirements.length,
      pendingGates: requirementsPendingGates,
    },
    currentState,
    plantState,
  }
}
