import React, { FormEvent, useMemo, useState } from 'react'
import { ArrowUp, Mic, Shield, Sparkles } from 'lucide-react'
import type { ChatMessage, StreamingStep, TurnBranch, UnknownRecord } from './memory-turn'
import { liveStatusLabelFromSteps, streamingStepsToThinkingTrace } from './memory-turn'
import MessageFooter from './MessageFooter'
import ThinkingTrace from './ThinkingTrace'
import { MarkdownRenderer } from './MarkdownRenderer'
import { InlineEvidenceCase } from './InlineEvidenceCase'
import { ToolAction } from './ToolAction'
import { RecallCard } from '../sparta/query/RecallCard'
import { GateChain } from '../sparta/query/GateChain'
import { ThreatMatrixCard } from '../sparta/query/ThreatMatrixCard'
import { SpartaShieldIcon } from './SpartaShieldIcon'
import type { EvidenceCaseSpan } from './types'
import {
  branchFromMessage,
  branchFromSteps,
  leadingIconForBranch,
  thinkingStepsForMessage,
  thinkingTraceDisclosureParts,
} from './thinkingTraceHelpers'

export interface StarterChip {
  label: string
  prompt: string
  dataQid?: string
}

export interface ComplianceChatWellProps {
  messages?: ChatMessage[]
  streamingSteps?: StreamingStep[]
  isStreaming?: boolean
  liveAssistantMessage?: ChatMessage
  onSend?: (text: string) => void | Promise<void>
  placeholder?: string
  disabled?: boolean
  composerDisabled?: boolean
  showComposer?: boolean
  emptyTitle?: string
  emptyDescription?: string
  starterChips?: StarterChip[]
  qid?: string
  surface?: string
  className?: string
  activeBranch?: TurnBranch
  sidebar?: boolean
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function spanPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null
  const [start, end] = value
  return typeof start === 'number' && typeof end === 'number' && end > start ? [start, end] : null
}

function spanFromExtractEntityNode(value: unknown): EvidenceCaseSpan | null {
  if (!isRecord(value)) return null
  const extracted = isRecord(value.extracted) ? value.extracted : {}
  const metadata = isRecord(value.metadata) ? value.metadata : {}
  const span = spanPair(value.span) ?? spanPair(extracted.span)
  if (!span) return null
  const text = value.mention ?? value.text ?? value.entity ?? extracted.text ?? metadata.control_id ?? metadata.name
  const name = metadata.name ?? value.name ?? text
  const framework = metadata.framework ?? value.framework
  const kind = extracted.kind ?? value.kind ?? value.node_kind ?? metadata.type
  return {
    text: typeof text === 'string' ? text : undefined,
    span,
    kind: typeof kind === 'string' ? kind : undefined,
    framework: typeof framework === 'string' ? framework : undefined,
    name: typeof name === 'string' ? name : undefined,
    grounded_to_framework: metadata.grounded === true || metadata.exists === true || value.status === 'grounded',
  }
}

function collectExtractEntitySpans(value: unknown): EvidenceCaseSpan[] {
  if (Array.isArray(value)) return value.map(spanFromExtractEntityNode).filter((span): span is EvidenceCaseSpan => Boolean(span))
  if (!isRecord(value)) return []

  const spans: EvidenceCaseSpan[] = []
  for (const key of ['entitySpans', 'entity_spans', 'spans', 'glossary', 'entity_nodes']) {
    spans.push(...collectExtractEntitySpans(value[key]))
  }
  const nodes = isRecord(value.nodes) ? value.nodes : undefined
  if (nodes) {
    for (const key of ['anchors', 'validated_context', 'context_terms', 'unsupported']) {
      spans.push(...collectExtractEntitySpans(nodes[key]))
    }
  }
  const packet = isRecord(value.proof_packet) ? value.proof_packet : undefined
  if (packet) {
    for (const key of ['anchors', 'validated_context', 'context_terms', 'unsupported']) {
      spans.push(...collectExtractEntitySpans(packet[key]))
    }
  }
  return spans
}

function extractEntitySpansFromMessage(message: ChatMessage, meta: UnknownRecord): EvidenceCaseSpan[] {
  const messageRecord = message as unknown as UnknownRecord
  const spans: EvidenceCaseSpan[] = []
  for (const source of [
    messageRecord.entitySpans,
    messageRecord.entity_spans,
    meta.entitySpans,
    meta.entity_spans,
    meta.entityContext,
    meta.entity_context,
    meta.extract_entities,
    meta.entities,
  ]) {
    spans.push(...collectExtractEntitySpans(source))
  }

  const seen = new Set<string>()
  return spans
    .filter((span): span is EvidenceCaseSpan & { span: [number, number] } => Boolean(spanPair(span.span)))
    .sort((left, right) => left.span[0] - right.span[0])
    .filter((span) => {
      const key = `${span.span[0]}:${span.span[1]}:${span.text ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function ComplianceChatWell({
  messages = [],
  streamingSteps = [],
  isStreaming = false,
  liveAssistantMessage,
  onSend,
  placeholder = 'Ask a question…',
  disabled = false,
  composerDisabled = false,
  showComposer = true,
  emptyTitle = 'Hello, Graham',
  emptyDescription = 'Ask for compliance evidence, scene context, or PersonaPlex memory.',
  starterChips = [],
  qid = 'shared-chat:compliance-well',
  surface = 'shared-chat',
  className,
  activeBranch,
  sidebar = false,
}: ComplianceChatWellProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const liveBranch = activeBranch ?? branchFromSteps(streamingSteps) ?? branchFromMessage(liveAssistantMessage) ?? 'compliance'
  const disclosure = thinkingTraceDisclosureParts({ branch: liveBranch, message: liveAssistantMessage, streamingSteps })
  const liveTraceSteps = streamingStepsToThinkingTrace(streamingSteps)
  const liveStatus = liveStatusLabelFromSteps(streamingSteps, disclosure.liveStatusLabel)

  const renderedMessages = useMemo(() => {
    if (!liveAssistantMessage) return messages
    return [...messages, liveAssistantMessage]
  }, [liveAssistantMessage, messages])

  async function submit(event?: FormEvent): Promise<void> {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || disabled || composerDisabled || !onSend) return
    setDraft('')
    await onSend(text)
  }

  return (
    <section
      className={className}
      data-qid={qid}
      data-surface={surface}
      data-variant={sidebar ? 'sidebar' : 'full'}
      style={{
        minHeight: 0,
        height: '100%',
        display: 'grid',
        gridTemplateRows: '1fr auto',
        background: 'transparent',
        color: '#e8eaed',
        overflow: 'hidden',
        maxWidth: sidebar ? 380 : 'none',
        borderLeft: sidebar ? '1px solid rgba(255,255,255,0.06)' : 'none',
        paddingLeft: sidebar ? 4 : 0,
      }}
    >
      <div
        data-qid={`${qid}:messages`}
        style={{ overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {renderedMessages.length === 0 && !isStreaming ? (
          <EmptyState title={emptyTitle} description={emptyDescription} chips={starterChips} onChip={(prompt) => { setDraft(prompt); void onSend?.(prompt) }} />
        ) : (
          renderedMessages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}

        {isStreaming && (
          <div
            data-qid={`${qid}:streaming`}
            style={{
              alignSelf: 'stretch',
              padding: '10px 0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9aa0a6', fontSize: 12 }}>
              {liveBranch === 'personaplex' ? <Mic size={14} /> : liveBranch === 'watch' ? <Sparkles size={14} /> : <Shield size={14} />}
              <span>{liveStatus}</span>
            </div>
          </div>
        )}
      </div>

      {showComposer && (
        <form
          data-qid={`${qid}:composer`}
          onSubmit={(event) => { void submit(event) }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px 12px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <textarea
            data-qid={`${qid}:input`}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder={placeholder}
            disabled={disabled || composerDisabled || isStreaming}
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              minHeight: 36,
              maxHeight: 120,
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.04)',
              color: '#e8eaed',
              padding: '8px 12px',
              outline: 'none',
              font: 'inherit',
              fontSize: 13,
            }}
          />
          <button
            type="button"
            data-qid={`${qid}:voice`}
            title={activeBranch === 'personaplex' ? 'Talk to Embry' : 'Voice input'}
            disabled={disabled || composerDisabled || isStreaming}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: 0,
              background: 'transparent',
              color: activeBranch === 'personaplex' ? '#8ab4f8' : '#9aa0a6',
              display: 'grid',
              placeItems: 'center',
              cursor: disabled || composerDisabled || isStreaming ? 'not-allowed' : 'pointer',
              opacity: activeBranch === 'personaplex' ? 1 : 0.6,
            }}
          >
            <Mic size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="submit"
            data-qid={`${qid}:send`}
            disabled={disabled || composerDisabled || isStreaming || !draft.trim()}
            title="Send"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: 0,
              background: draft.trim() && !isStreaming ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: draft.trim() && !isStreaming ? '#e8eaed' : '#5f6368',
              display: 'grid',
              placeItems: 'center',
              cursor: draft.trim() && !isStreaming ? 'pointer' : 'not-allowed',
            }}
          >
            <ArrowUp size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </form>
      )}
    </section>
  )
}

function EmptyState({
  title,
  description,
  chips,
  onChip,
}: {
  title: string
  description: string
  chips: StarterChip[]
  onChip: (prompt: string) => void
}): JSX.Element {
  return (
    <div data-qid="shared-chat:empty" style={{ margin: 'auto', maxWidth: 560, textAlign: 'center', padding: '42px 12px' }}>
      <div style={{ display: 'inline-grid', placeItems: 'center', width: 46, height: 46, borderRadius: 18, background: 'rgba(0,255,136,0.1)', marginBottom: 14 }}>
        <Sparkles size={22} strokeWidth={1.7} aria-hidden="true" />
      </div>
      <h2 style={{ margin: 0, fontSize: 20, letterSpacing: '-0.02em' }}>{title}</h2>
      <p style={{ margin: '8px auto 0', color: '#9ba8b8', lineHeight: 1.5 }}>{description}</p>
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 18 }}>
          {chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              data-qid={chip.dataQid ?? 'shared-chat:starter-chip'}
              onClick={() => onChip(chip.prompt)}
              style={{
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.05)',
                color: '#dce6f3',
                padding: '8px 11px',
                cursor: 'pointer',
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  const isUser = message.role === 'user'
  const branch = branchFromMessage(message)
  const steps = thinkingStepsForMessage(message)
  const disclosure = thinkingTraceDisclosureParts({ message, branch })
  const align = isUser ? 'flex-end' : 'flex-start'
  const meta = (message.metadata ?? {}) as UnknownRecord

  const evidenceCaseData = meta.evidenceCase ?? meta.evidence_case
  const matrixSummary = meta.matrixSummary ?? meta.matrix_summary
  const recallItems = meta.recallItems ?? meta.recall_items ?? meta.recall
  const resultCount = meta.resultCount ?? meta.result_count
  const entities = meta.entities
  const entitySpans = extractEntitySpansFromMessage(message, meta)
  const verdict = meta.verdict
  const querySpec = meta._querySpec ?? meta.querySpec ?? meta.query_spec
  const figureArtifact = meta.figureArtifact ?? meta.figure_artifact
  const tableData = meta.tableData ?? meta.table_data

  return (
    <article
      data-qid={`shared-chat:message:${message.role}`}
      data-branch={branch ?? message.role}
      style={{
        alignSelf: align,
        maxWidth: isUser ? '70%' : '100%',
        background: isUser ? 'rgba(255,255,255,0.06)' : 'transparent',
        borderRadius: isUser ? 12 : 0,
        padding: isUser ? '8px 12px' : '4px 0',
        color: '#e8eaed',
        lineHeight: 1.5,
        fontSize: 13,
      }}
    >

      {/* Tool action line */}
      {!isUser && message.skillUsed && <ToolAction label={`Ran /${message.skillUsed}`} qid={`chat:skill:${message.skillUsed}`} />}

      {/* Evidence Case */}
      {!isUser && evidenceCaseData && <InlineEvidenceCase data={evidenceCaseData as any} />}

      {/* Figure artifact */}
      {!isUser && figureArtifact && (
        <div data-qid="shared-chat:figure" style={{ marginTop: 8 }}>
          <img src={(figureArtifact as any).url ?? (figureArtifact as any).src} alt={(figureArtifact as any).alt ?? 'Figure'} style={{ maxWidth: '100%', borderRadius: 12 }} />
        </div>
      )}

      {/* Table data */}
      {!isUser && tableData && (
        <div data-qid="shared-chat:table" style={{ marginTop: 8, overflowX: 'auto' }}>
          <MarkdownRenderer content={renderTable(tableData as any)} />
        </div>
      )}

      {/* Content text */}
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, fontSize: 14, marginTop: (!isUser && (evidenceCaseData || figureArtifact || tableData)) ? 12 : 0 }}>
        {message.content ? <MarkdownRenderer content={message.content} entitySpans={entitySpans} /> : null}
      </div>

      {/* Recall cards */}
      {!isUser && recallItems && Array.isArray(recallItems) && recallItems.length > 0 && (
        <RecallCard items={recallItems as any} resultCount={typeof resultCount === 'number' ? resultCount : recallItems.length} />
      )}

      {/* Threat matrix card */}
      {!isUser && matrixSummary && (
        <ThreatMatrixCard summary={matrixSummary as any} />
      )}

      {/* Entity pills */}
      {!isUser && entities && Array.isArray(entities) && entities.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {(entities as any[]).map((e: any, i: number) => (
            <span key={i} style={{ padding: '3px 8px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', fontSize: 11, color: '#bcd0e7' }}>
              {e.label ?? e.id ?? e}
            </span>
          ))}
        </div>
      )}

      {/* Gate chain */}
      {!isUser && verdict && !evidenceCaseData && (
        <GateChain gates={(verdict as any).gates ?? []} verdict={(verdict as any).state ?? 'INCONCLUSIVE'} tier={(verdict as any).tier} />
      )}

      {/* QuerySpec collapsible */}
      {!isUser && querySpec && (
        <details style={{ marginTop: 6, fontSize: 11 }}>
          <summary style={{ color: '#9ba8b8', cursor: 'pointer' }}>QuerySpec</summary>
          <pre style={{ color: '#9ba8b8', fontSize: 11, whiteSpace: 'pre-wrap', marginTop: 4, padding: 6, background: 'rgba(0,0,0,0.3)', borderRadius: 6, overflow: 'auto', maxHeight: 150 }}>
            {JSON.stringify(querySpec, null, 2)}
          </pre>
        </details>
      )}

      {/* Thinking trace */}
      {!isUser && steps.length > 0 && (
        <ThinkingTrace
          steps={steps}
          title={disclosure.title}
          label={disclosure.label}
          disclosureVariant={disclosure.disclosureVariant}
          leadingIcon={leadingIconForBranch(branch, disclosure.disclosureVariant)}
          placement="footer"
          displayMode="full"
          dataQid="shared-chat:message:thinking-trace"
        />
      )}

      {/* Footer */}
      {!isUser && <MessageFooter message={message} />}
    </article>
  )
}

function renderTable(data: { headers?: string[]; rows?: string[][] }): string {
  if (!data.headers || !data.rows) return ''
  const header = `| ${data.headers.join(' | ')} |`
  const separator = `| ${data.headers.map(() => '---').join(' | ')} |`
  const body = data.rows.map(row => `| ${row.join(' | ')} |`).join('\n')
  return `${header}\n${separator}\n${body}`
}

export default ComplianceChatWell
