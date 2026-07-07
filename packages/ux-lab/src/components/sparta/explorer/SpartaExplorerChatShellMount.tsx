import React, { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import SharedChatShell from '../../shared-chat/SharedChatShell'
import type { SpartaComplianceAdapterOptions, UnknownRecord } from '../../shared-chat/memory-turn'
import type { EmbryVoiceStatus } from '../../embry-voice/EmbryVoiceOrb'

export interface SpartaExplorerChatShellMountProps {
  matrixContext?: UnknownRecord
  gateDepth?: SpartaComplianceAdapterOptions['gateDepth']
  runTypedEvidenceCaseStream?: SpartaComplianceAdapterOptions['runEvidenceCaseStream']
  scopeControls?: ReactNode
  depthControls?: ReactNode
  disabled?: boolean
}

export function SpartaExplorerChatShellMount({
  matrixContext,
  gateDepth = 'balanced',
  runTypedEvidenceCaseStream,
  scopeControls,
  depthControls,
  disabled = false,
}: SpartaExplorerChatShellMountProps): JSX.Element {
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<EmbryVoiceStatus>('off')

  const emitVoiceState = useCallback((state: EmbryVoiceStatus) => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('sparta:embry-voice-state', { detail: { state, surface: 'sparta-explorer' } }))
  }, [])

  const handleVoiceToggle = useCallback((enabled: boolean) => {
    setVoiceEnabled(enabled)
    const nextStatus: EmbryVoiceStatus = enabled ? 'listening' : 'off'
    setVoiceStatus(nextStatus)
    emitVoiceState(nextStatus)
  }, [emitVoiceState])

  const handleStreamingChange = useCallback((isStreaming: boolean) => {
    if (!voiceEnabled) return
    const nextStatus: EmbryVoiceStatus = isStreaming ? 'processing' : 'idle'
    setVoiceStatus(nextStatus)
    emitVoiceState(nextStatus)
  }, [emitVoiceState, voiceEnabled])

  const effectiveVoiceStatus = useMemo<EmbryVoiceStatus>(() => {
    if (!voiceEnabled) return 'off'
    return voiceStatus
  }, [voiceEnabled, voiceStatus])

  return (
    <section data-qid="sparta:chat:slideover:converged" style={{ minHeight: 0, height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr', gap: 12 }}>
      {(scopeControls || depthControls) && (
        <div data-qid="sparta:chat:scope-depth-controls" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>{scopeControls}</div>
          <div>{depthControls}</div>
        </div>
      )}
      <SharedChatShell
        surface="sparta-explorer"
        shellQid="sparta:chat:shell:slideover"
        hideHeader
        showModeToggle
        defaultMode="compliance"
        disabled={disabled}
        matrixContext={matrixContext}
        adapterOptions={{
          sparta: {
            matrixContext,
            gateDepth,
            runEvidenceCaseStream: runTypedEvidenceCaseStream,
          },
          personaplex: {
            wsUrl: 'ws://127.0.0.1:8788/ws',
            personaId: 'embry',
          },
        }}
        emptyTitle="Ask Embry"
        emptyDescription="Ask for SPARTA control evidence, memory recall, or a PersonaPlex turn from the same shared renderer."
        voiceEnabled={voiceEnabled}
        voiceStatus={effectiveVoiceStatus}
        voiceLabel="Embry voice"
        onVoiceToggle={handleVoiceToggle}
        onStreamingChange={handleStreamingChange}
        starterChips={[
          { label: 'Create evidence case', prompt: '/create-evidence-case for this control', dataQid: 'sparta:chat:chip:evidence-case' },
          { label: 'Summarize risks', prompt: 'Summarize the highest-risk compliance gaps in this view', dataQid: 'sparta:chat:chip:risk-summary' },
          { label: 'Ask Embry', prompt: 'Embry, what should I look at first?', dataQid: 'sparta:chat:chip:embry' },
        ]}
      />
    </section>
  )
}

export default SpartaExplorerChatShellMount
