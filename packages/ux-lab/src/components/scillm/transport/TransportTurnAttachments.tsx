import { InlineEvidenceCase } from '../../shared-chat/InlineEvidenceCase'
import type { TransportTurnAttachments } from './messageAttachments'
import { TransportFigureBlock } from './TransportFigureBlock'
import { TransportReasoningBlock } from './TransportReasoningBlock'
import { TransportSkillReceiptBlock } from './TransportSkillReceiptBlock'
import { TransportToolTraceBlock } from './TransportToolTraceBlock'

export function TransportTurnAttachmentsView({
  attachments,
  messageId,
  transportRunId,
}: {
  attachments: TransportTurnAttachments
  messageId: string
  transportRunId?: string
}) {
  return (
    <div className="tr-turn-attachments" data-qid={`transport:attachments:${messageId}`}>
      {attachments.skillReceipt ? (
        <TransportSkillReceiptBlock receipt={attachments.skillReceipt} messageId={messageId} />
      ) : null}
      {attachments.reasoning ? (
        <TransportReasoningBlock
          excerpt={attachments.reasoning.excerpt}
          live={attachments.reasoning.live}
          messageId={messageId}
        />
      ) : null}
      {attachments.toolTrace ? (
        <TransportToolTraceBlock
          entries={attachments.toolTrace.entries}
          live={attachments.toolTrace.live}
          messageId={messageId}
        />
      ) : null}
      {attachments.evidenceCase ? (
        <div className="tr-evidence-case-wrap" data-qid={`transport:evidence-case:${messageId}`}>
          <InlineEvidenceCase data={attachments.evidenceCase} />
        </div>
      ) : null}
      {attachments.figures?.length ? (
        <TransportFigureBlock figures={attachments.figures} messageId={messageId} transportRunId={transportRunId} />
      ) : null}
    </div>
  )
}
