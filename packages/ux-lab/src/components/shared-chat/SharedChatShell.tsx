/**
 * SharedChatShell — Active Intelligence Dashboard Shell
 * 
 * Passes through all props to ComplianceChatWell for the dashboard experience
 */
import React, { useMemo, useRef, useState } from 'react'
import { Mic, Shield } from 'lucide-react'
import { EmbryVoiceOrb } from '../embry-voice/EmbryVoiceOrb'
import ComplianceChatWell, { type ComplianceChatWellProps, type StarterChip, type InputMode } from './ComplianceChatWell'
import {
  createAdapterRegistry,
  errorToMessage,
  isAsyncIterable,
  makeMessageId,
  type ChatMessage,
  type MemoryTurnAdapter,
  type PersonaPlexAdapterOptions,
  type SpartaComplianceAdapterOptions,
  type StreamingStep,
  type TurnBranch,
  type TurnInput,
  type TurnSurface,
  type WatchChatAdapterOptions,
} from './memory-turn'
import { extractEntitiesForSpartaChatMessage } from './spartaEntityExtraction'

export type PersonaPlexChatMode = 'compliance' | 'personaplex'

export type SharedChatAdapterOptions = {
  sparta?: SpartaComplianceAdapterOptions
  watch?: WatchChatAdapterOptions
  personaplex?: PersonaPlexAdapterOptions
}

export type SharedChatShellProps = Omit<
  ComplianceChatWellProps,
  'messages' | 'onSend' | 'starterChips'
> & {
  projectLabel?: string
  messages?: ChatMessage[]
  initialMessages?: ChatMessage[]
  onMessagesChange?: (messages: ChatMessage[]) => void
  onSend?: (...args: unknown[]) => void | Promise<void>
  streamingSteps?: StreamingStep[]
  isStreaming?: boolean
  activeBranch?: TurnBranch
  showModeToggle?: boolean
  defaultMode?: PersonaPlexChatMode
  mode?: PersonaPlexChatMode | string
  wsUrl?: string
  personaId?: string
  showTracePanel?: boolean
  initialTraceRows?: unknown[]
  modeLabels?: Partial<Record<PersonaPlexChatMode, string>>
  modeTitles?: Partial<Record<PersonaPlexChatMode, string>>
  onModeChange?: (mode: PersonaPlexChatMode) => void
  onStreamingStepsChange?: (steps: StreamingStep[]) => void
  onStreamingChange?: (isStreaming: boolean) => void
  surface?: TurnSurface
  adapter?: MemoryTurnAdapter
  adapterOptions?: SharedChatAdapterOptions
  shellQid?: string
  hideHeader?: boolean
  context?: TurnInput['context']
  matrixContext?: TurnInput['matrixContext']
  starterChips?: StarterChip[]
  /** Active Chatterbox receipt tone for secondary orb modulation */
  voiceTone?: string
  /** Optional: convert filesystem paths to URLs for inline media (image=/path, clip=/path, audio=/path) */
  mediaUrl?: (path: string) => string
}

export function SharedChatShell({
  projectLabel = 'Chat',
  messages,
  initialMessages = [],
  onMessagesChange,
  onSend,
  streamingSteps: externalStreamingSteps,
  isStreaming: externalIsStreaming,
  activeBranch: externalActiveBranch,
  showModeToggle = true,
  defaultMode = 'compliance',
  modeLabels,
  modeTitles,
  onModeChange,
  onStreamingStepsChange,
  onStreamingChange,
  surface = 'shared-chat',
  adapter,
  adapterOptions,
  shellQid,
  hideHeader = false,
  context,
  matrixContext,
  starterChips,
  placeholder,
  disabled,
  composerDisabled,
  showComposer,
  emptyTitle,
  emptyDescription,
  qid,
  className,
  sidebar,
  recentChats,
  promptTemplates,
  onDeleteMessage,
  onCopyMessage,
  onDownloadMessage,
  onEditTitle,
  chatTitle,
  agentStatus,
  mediaUrl,
  voiceEnabled,
  voiceStatus,
  voiceTone,
  voiceLabel,
  onVoiceToggle,
  activeProcessingTurnId,
  activeProcessingMessageId,
}: SharedChatShellProps): JSX.Element {
  const [mode, setModeState] = useState<PersonaPlexChatMode>(defaultMode)
  const [internalMessages, setInternalMessages] = useState<ChatMessage[]>(initialMessages)
  const [internalStreamingSteps, setInternalStreamingSteps] = useState<StreamingStep[]>([])
  const [internalIsStreaming, setIsInternalStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const controlled = messages !== undefined
  const isExternalMode = onSend !== undefined
  const displayMessages = messages ?? internalMessages
  const displayStreamingSteps = isExternalMode && externalStreamingSteps ? externalStreamingSteps : internalStreamingSteps
  const displayIsStreaming = isExternalMode ? (externalIsStreaming ?? false) : internalIsStreaming
  const displayActiveBranch = externalActiveBranch ?? (surface === 'watch' ? 'watch' : mode === 'personaplex' ? 'personaplex' : undefined)

  const registry = useMemo(
    () =>
      createAdapterRegistry({
        surface,
        mode,
        sparta: adapterOptions?.sparta,
        watch: adapterOptions?.watch,
        personaplex: adapterOptions?.personaplex,
      }),
    [adapterOptions?.personaplex, adapterOptions?.sparta, adapterOptions?.watch, mode, surface],
  )

  function setMode(nextMode: PersonaPlexChatMode): void {
    setModeState(nextMode)
    onModeChange?.(nextMode)
  }

  function replaceMessages(nextMessages: ChatMessage[]): void {
    if (!controlled) setInternalMessages(nextMessages)
    onMessagesChange?.(nextMessages)
  }

  async function handleSend(text: string, inputMode?: InputMode): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || displayIsStreaming) return

    if (onSend) {
      await onSend(trimmed, inputMode)
      return
    }

    const entityContext = surface === 'sparta-explorer'
      ? await extractEntitiesForSpartaChatMessage(trimmed)
      : null
    const userMessage: ChatMessage = {
      id: makeMessageId('user'),
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
      metadata: {
        surface,
        mode,
        ...(entityContext ? {
          entities: entityContext,
          extract_entities: entityContext,
          entityContext,
        } : {}),
      },
    }

    const baseMessages = [...displayMessages, userMessage]
    replaceMessages(baseMessages)
    setInternalStreamingSteps([])
    onStreamingStepsChange?.([])
    setIsInternalStreaming(true)
    onStreamingChange?.(true)

    const abortController = new AbortController()
    abortRef.current = abortController

    try {
      const activeAdapter =
        adapter ??
        registry.getAdapter({
          text: trimmed,
          mode,
          surface,
          branchHint: surface === 'watch' ? 'watch' : undefined,
        })

      const result = activeAdapter.sendTurn({
        text: trimmed,
        mode,
        surface,
        messages: baseMessages,
        context,
        matrixContext,
        abortSignal: abortController.signal,
      })

      let finalMessage: ChatMessage | undefined
      const awaited = await result
      if (isAsyncIterable<StreamingStep>(awaited)) {
        const iterator = awaited[Symbol.asyncIterator]()
        let streamingStepsSnapshot: StreamingStep[] = []
        for (;;) {
          const next = await iterator.next()
          if (next.done) {
            const returned = next.value as ChatMessage | void
            if (returned) finalMessage = returned
            break
          }
          const step = next.value as StreamingStep
          streamingStepsSnapshot = [...streamingStepsSnapshot, step]
          setInternalStreamingSteps(streamingStepsSnapshot)
          onStreamingStepsChange?.(streamingStepsSnapshot)
          if (step.kind === 'final' && step.message) finalMessage = step.message
        }
      } else {
        finalMessage = awaited as ChatMessage
      }

      if (finalMessage) {
        const assistantEntityContext = surface === 'sparta-explorer'
          ? await extractEntitiesForSpartaChatMessage(finalMessage.content)
          : null
        const renderableFinalMessage: ChatMessage = assistantEntityContext
          ? {
            ...finalMessage,
            metadata: {
              ...(finalMessage.metadata ?? {}),
              response_entities: assistantEntityContext,
              extract_entities: assistantEntityContext,
              entityContext: assistantEntityContext,
            },
          }
          : finalMessage
        replaceMessages([...baseMessages, renderableFinalMessage])
      }
    } catch (error) {
      replaceMessages([
        ...baseMessages,
        {
          id: makeMessageId('assistant-error'),
          role: 'assistant',
          content: `I could not complete that turn: ${errorToMessage(error)}`,
          createdAt: new Date().toISOString(),
          metadata: { surface, mode, error: errorToMessage(error), branch: mode === 'personaplex' ? 'personaplex' : 'compliance' },
        },
      ])
    } finally {
      setIsInternalStreaming(false)
      onStreamingChange?.(false)
      abortRef.current = null
    }
  }

  const shellId = shellQid ?? (surface === 'watch' ? 'watch:chat:shell' : surface === 'sparta-explorer' ? 'sparta:chat:shell:slideover' : 'shared-chat:shell')

  return (
    <section
      data-qid={shellId}
      data-surface={surface}
      data-mode={mode}
      className={className}
      style={{ minHeight: 0, height: '100%', display: 'grid', gridTemplateRows: hideHeader ? '1fr' : 'auto 1fr', gap: hideHeader ? 0 : 8 }}
    >
      {!hideHeader && (
        <header
          data-qid={`${shellId}:header`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            minWidth: 0,
            minHeight: voiceStatus !== undefined ? 104 : undefined,
            padding: voiceStatus !== undefined ? '10px 16px' : '8px 12px',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14, letterSpacing: '-0.02em' }}>{projectLabel}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {voiceStatus !== undefined && (
              <EmbryVoiceOrb
                voiceStatus={voiceStatus}
                isStreaming={displayIsStreaming}
                tone={voiceTone}
                size={96}
              />
            )}
            {showModeToggle && <ModeToggle mode={mode} labels={modeLabels} titles={modeTitles} onModeChange={setMode} />}
          </div>
        </header>
      )}

      {hideHeader && showModeToggle && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px' }}>
          <ModeToggle mode={mode} labels={modeLabels} titles={modeTitles} onModeChange={setMode} />
        </div>
      )}

      <ComplianceChatWell
        messages={displayMessages}
        streamingSteps={displayStreamingSteps}
        isStreaming={displayIsStreaming}
        activeBranch={displayActiveBranch}
        onSend={(text) => void handleSend(String(text))}
        placeholder={placeholder ?? (mode === 'personaplex' ? 'Ask Embry…' : 'Ask a question…')}
        disabled={disabled}
        composerDisabled={composerDisabled}
        showComposer={showComposer}
        emptyTitle={emptyTitle ?? (surface === 'watch' ? 'Hello, Graham' : 'How can I help?')}
        emptyDescription={emptyDescription}
        starterChips={starterChips}
        qid={qid ?? `${shellId}:well`}
        surface={surface}
        sidebar={sidebar}
        recentChats={recentChats}
        promptTemplates={promptTemplates}
        onDeleteMessage={onDeleteMessage}
        onCopyMessage={onCopyMessage}
        onDownloadMessage={onDownloadMessage}
        onEditTitle={onEditTitle}
        chatTitle={chatTitle}
        agentStatus={agentStatus}
        mediaUrl={mediaUrl}
        voiceEnabled={voiceEnabled}
        voiceStatus={voiceStatus}
        voiceLabel={voiceLabel}
        onVoiceToggle={onVoiceToggle}
        activeProcessingTurnId={activeProcessingTurnId}
        activeProcessingMessageId={activeProcessingMessageId}
      />
    </section>
  )
}

function ModeToggle({
  mode,
  labels,
  titles,
  onModeChange,
}: {
  mode: PersonaPlexChatMode
  labels?: Partial<Record<PersonaPlexChatMode, string>>
  titles?: Partial<Record<PersonaPlexChatMode, string>>
  onModeChange: (mode: PersonaPlexChatMode) => void
}): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Chat mode"
      data-qid="sparta:chat:mode-toggle"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: 3,
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      <ModeButton
        mode="compliance"
        active={mode === 'compliance'}
        label={labels?.compliance ?? 'Compliance'}
        title={titles?.compliance ?? 'SPARTA compliance chat with evidence receipts'}
        qid="sparta:chat:mode:compliance"
        onClick={onModeChange}
      />
      <ModeButton
        mode="personaplex"
        active={mode === 'personaplex'}
        label={labels?.personaplex ?? 'Persona'}
        title={titles?.personaplex ?? 'Embry PersonaPlex voice chat'}
        qid="sparta:chat:mode:personaplex"
        onClick={onModeChange}
      />
    </div>
  )
}

function ModeButton({
  mode,
  active,
  label,
  title,
  qid,
  onClick,
}: {
  mode: PersonaPlexChatMode
  active: boolean
  label: string
  title: string
  qid: string
  onClick: (mode: PersonaPlexChatMode) => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-qid={qid}
      data-qs-action={mode === 'compliance' ? 'CHAT_MODE_COMPLIANCE' : 'CHAT_MODE_PERSONAPLEX'}
      title={title}
      onClick={() => onClick(mode)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        border: 0,
        borderRadius: 6,
        padding: '5px 10px',
        background: active ? '#4f46e5' : 'transparent',
        color: active ? 'white' : '#94a3b8',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {mode === 'compliance' ? <Shield size={13} strokeWidth={2} aria-hidden="true" /> : <Mic size={13} strokeWidth={2} aria-hidden="true" />}
      <span>{label}</span>
    </button>
  )
}

export default SharedChatShell
