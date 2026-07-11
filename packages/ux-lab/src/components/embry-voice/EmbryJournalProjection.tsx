import { useEffect, useMemo, useState } from 'react'
import {
  SharedChatShell,
  createJournalProjectionSource,
  type EmbryChatProjectionV1,
} from '@agent-skills/ux-lab-ui'
import type { ChatMessage } from '@agent-skills/ux-lab-ui/memory-turn'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; projection: EmbryChatProjectionV1 }

function toMessages(projection: EmbryChatProjectionV1): ChatMessage[] {
  return projection.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.created_at,
    title: message.role === 'assistant' ? 'Embry' : undefined,
    reasoningSteps: message.reasoning_steps?.map((step) => ({
      id: step.id,
      label: step.label,
      status: step.status,
      detail: step.detail,
      data: {
        eventId: step.event_id,
        eventType: step.event_type,
        sequence: step.sequence,
        receiptHash: step.receipt_hash,
      },
    })),
    metadata: {
      branch: 'embry-voice',
      sessionId: projection.session_id,
      turnId: projection.turn_id,
      contentSha256: message.content_sha256,
      annotations: message.annotations.map((annotation) => ({
        id: annotation.id,
        mention: annotation.mention,
        start: annotation.start,
        end: annotation.end,
        kind: annotation.kind,
        grounded: annotation.grounded,
        source: annotation.source,
        extractionEventId: annotation.extraction_event_id,
        extractionResultSha256: annotation.extraction_result_sha256,
      })),
      audioArtifacts: message.audio_artifacts?.map((artifact) => ({
        artifactId: artifact.artifact_id,
        state: artifact.state,
        url: `/api/projects/embry${artifact.url.replace(/^\/v1/, '')}`,
        sha256: artifact.sha256,
        bytes: artifact.bytes,
        contentType: artifact.content_type,
        channels: artifact.channels,
        sampleRateHz: artifact.sample_rate_hz,
        durationMs: artifact.duration_ms,
        playbackEnabled: false,
      })) ?? [],
      provenance: message.provenance,
    },
  }))
}

export function EmbryJournalProjection({ sessionId, turnId }: { sessionId: string; turnId: string }): JSX.Element {
  const source = useMemo(() => createJournalProjectionSource('/api/projects/embry'), [])
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    source.load({ sessionId, turnId, signal: controller.signal })
      .then((projection) => setState({ status: 'ready', projection }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      })
    return () => controller.abort()
  }, [sessionId, source, turnId])

  if (state.status === 'loading') {
    return <div data-qid="embry:journal-projection:loading" className="h-full grid place-items-center bg-[#121214] text-[#a1a1aa]">Loading journal projection…</div>
  }
  if (state.status === 'error') {
    return <div data-qid="embry:journal-projection:error" className="h-full grid place-items-center bg-[#121214] text-red-300">Projection unavailable: {state.error}</div>
  }
  return (
    <section
      data-qid="embry:journal-projection:route"
      data-session-id={sessionId}
      data-turn-id={turnId}
      data-projection-sha256={state.projection.projection_sha256}
      className="h-full min-h-0 bg-[#121214] p-3"
    >
      <SharedChatShell
        projectionOnly
        messages={toMessages(state.projection)}
        projectLabel="Embry"
        surface="embry-voice"
        shellQid="embry:journal-projection:shell"
        qid="embry:journal-projection:well"
        showModeToggle={false}
        showComposer={false}
      />
    </section>
  )
}

export default EmbryJournalProjection
