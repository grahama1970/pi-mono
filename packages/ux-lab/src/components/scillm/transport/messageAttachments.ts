/**
 * Build per-turn attachment payloads (reasoning, tools, evidence, figures) for transport chat.
 */
import type { EvidenceCaseData } from '../../shared-chat/types'
import type { TransportCallRow } from './callInspector'
import { resolveSubagentRunId } from './callInspector'
import type { DisplayMessage } from './messageParse'
import {
  extractEvidenceCaseFromText,
  extractFiguresFromText,
  extractSkillReceipt,
  type FigureAttachment,
  type SkillReceiptSummary,
} from './parseStructuredArtifacts'
import {
  buildReasoningByCall,
  isReasoningLive,
} from './reasoningByCall'
import {
  buildToolTraceByCall,
  isToolTraceLive,
  type ToolCallEntry,
} from './toolTraceByCall'
import {
  buildStructuredAttachmentIndex,
  mergeFigureLists,
  type StructuredAttachmentIndex,
} from './attachmentEvents'
import type { TransportStreamEvent } from './types'

export interface TransportTurnAttachments {
  reasoning?: { excerpt: string; live: boolean }
  toolTrace?: { entries: ToolCallEntry[]; live: boolean }
  evidenceCase?: EvidenceCaseData
  figures?: FigureAttachment[]
  skillReceipt?: SkillReceiptSummary
}

function textChunks(message: DisplayMessage): string[] {
  return [message.raw, message.prose, ...message.artifacts].filter(Boolean)
}

export function attachmentsForMessage(
  message: DisplayMessage,
  calls: TransportCallRow[],
  events: TransportStreamEvent[],
  nestMessages?: DisplayMessage[],
  reasoningByCall = buildReasoningByCall(events),
  toolTraceByCall = buildToolTraceByCall(events),
  structuredIndex?: StructuredAttachmentIndex,
  transportRunId = '',
): TransportTurnAttachments | null {
  const out: TransportTurnAttachments = {}
  const chunks = textChunks(message)

  const skillReceipt = extractSkillReceipt(`${message.raw}\n${message.prose}`)
  if (skillReceipt) out.skillReceipt = skillReceipt

  const index =
    structuredIndex ?? (transportRunId ? buildStructuredAttachmentIndex(events, transportRunId) : undefined)

  const evidenceCase = extractEvidenceCaseFromText(chunks)
  if (evidenceCase) out.evidenceCase = evidenceCase

  const figures = extractFiguresFromText(chunks)
  if (figures.length) out.figures = figures

  const callId = resolveSubagentRunId(message, calls, nestMessages)
  if (index) {
    if (callId && index.evidenceByCall.has(callId)) {
      out.evidenceCase = index.evidenceByCall.get(callId)
    } else if (index.evidenceByMessageId.has(message.id)) {
      out.evidenceCase = index.evidenceByMessageId.get(message.id)
    }
    const sseFigures = mergeFigureLists(
      callId ? index.figuresByCall.get(callId) : undefined,
      index.figuresByMessageId.get(message.id),
    )
    out.figures = mergeFigureLists(sseFigures, out.figures)
  }
  if (callId) {
    const reasoning = reasoningByCall.get(callId)?.trim()
    if (reasoning) {
      out.reasoning = { excerpt: reasoning, live: isReasoningLive(callId, calls, events) }
    }
    const tools = toolTraceByCall.get(callId)
    if (tools?.length) {
      out.toolTrace = { entries: tools, live: isToolTraceLive(callId, calls, events) }
    }
  }

  if (
    !out.reasoning &&
    !out.toolTrace &&
    !out.evidenceCase &&
    !out.figures?.length &&
    !out.skillReceipt
  ) {
    return null
  }
  return out
}

export function hasTransportAttachments(attachments: TransportTurnAttachments | null | undefined): boolean {
  return attachments != null
}
