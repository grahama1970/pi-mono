/**
 * Unified stream artifact card — figure/graph previews live in a recessed content well.
 */
import { type MouseEvent } from 'react'
import DOMPurify from 'dompurify'
import { ExternalLink, X } from 'lucide-react'
import type { Artifact } from './types'
import { artifactPreviewSvg, isThreatMapArtifact } from './artifactReceiptHelpers'

export interface ChatArtifactCardProps {
  artifact: Artifact
  caseId?: string | null
  contextShareLabel?: string | null
  onDismissContextShare?: () => void
  onOpen?: () => void
}

function parseCaseIdFromContext(label?: string | null, fallback?: string | null): string | null {
  if (fallback?.trim()) return fallback.trim()
  if (!label?.trim()) return null
  const parts = label.replace(/^Sharing\s+/i, '').split('·').map(p => p.trim()).filter(Boolean)
  const last = parts[parts.length - 1]
  return last && /^[A-Z]{2,}-/.test(last) ? last : null
}

function parseModeFromContext(label?: string | null): string | null {
  if (!label) return null
  if (/drilldown/i.test(label)) return 'Drilldown active'
  if (/triage/i.test(label)) return 'Triage'
  if (/glance/i.test(label)) return 'Glance'
  return null
}


function provenanceKicker(artifact: Artifact): string | null {
  const state = artifact.provenanceState ?? (artifact.sampleDerived ? 'sample-derived' : null)
  if (state) return state
  if (artifact.sourceSkill) return artifact.sourceSkill.replace(/^\//, '')
  return null
}

function figureModeLabel(artifact: Artifact): string | null {
  const caption = artifact.caption?.trim() || artifact.figureSpec?.caption?.trim()
  if (caption) return caption.length > 56 ? `${caption.slice(0, 53)}…` : caption
  const title = artifact.title?.trim()
  if (title) return title.length > 56 ? `${title.slice(0, 53)}…` : title
  return 'Figure preview'
}

export function shouldUseChatArtifactCard(artifact: Artifact): boolean {
  if (!artifactPreviewSvg(artifact)) return false
  if (isThreatMapArtifact(artifact)) return true
  return artifact.type === 'figure' || artifact.type === 'graph'
}

export function ChatArtifactCard({
  artifact,
  caseId,
  contextShareLabel,
  onDismissContextShare,
  onOpen,
}: ChatArtifactCardProps) {
  const previewSvg = artifactPreviewSvg(artifact)
  const threat = isThreatMapArtifact(artifact)
  const resolvedCaseId = parseCaseIdFromContext(contextShareLabel, caseId ?? artifact.caseId ?? null)
  const modeLabel = threat ? parseModeFromContext(contextShareLabel) : figureModeLabel(artifact)
  const provenanceLabel = provenanceKicker(artifact)
  const variant = threat ? 'threat' : 'figure'

  const handleOpen = onOpen
    ? (event: MouseEvent) => {
        event.preventDefault()
        onOpen()
      }
    : undefined

  if (!previewSvg) return null

  return (
    <article
      className={`chat-artifact-card chat-artifact-card--${variant}`}
      data-qid={`chat:artifact-card:${variant}:${artifact.id}`}
    >
      {(resolvedCaseId || modeLabel || onDismissContextShare) ? (
        <header className="chat-artifact-card__header">
          <div className="chat-artifact-card__header-main">
            {resolvedCaseId ? (
              <span className="chat-artifact-card__badge" data-qid={`chat:artifact-card:case:${artifact.id}`}>
                {resolvedCaseId}
              </span>
            ) : null}
            {modeLabel ? (
              <span className="chat-artifact-card__mode">{modeLabel}</span>
            ) : null}
            {provenanceLabel ? (
              <span
                className="chat-artifact-card__provenance"
                data-qid={`chat:artifact-card:provenance:${artifact.id}`}
                title={provenanceLabel === 'sample-derived' ? 'Sample or demo data — export blocked' : `Provenance: ${provenanceLabel}`}
              >
                {provenanceLabel}
              </span>
            ) : null}
          </div>
          {onDismissContextShare ? (
            <button
              type="button"
              className="chat-artifact-card__dismiss"
              data-qid="chat:artifact-card:dismiss-context"
              data-qs-action="DISMISS_CONTEXT_SHARE"
              title="Dismiss shared context"
              aria-label="Dismiss shared context"
              onClick={onDismissContextShare}
            >
              <X size={14} aria-hidden />
            </button>
          ) : null}
        </header>
      ) : null}

      <div
        className="chat-artifact-card__heatmap"
        data-qid={`sparta:chat:figure-well:${artifact.id}`}
        role={handleOpen ? 'button' : undefined}
        tabIndex={handleOpen ? 0 : undefined}
        onClick={handleOpen}
        onKeyDown={handleOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') handleOpen(e as unknown as MouseEvent) } : undefined}
      >
        {handleOpen ? (
          <button
            type="button"
            className="chat-artifact-card__expand"
            data-qid={`artifact:receipt:overlay:${artifact.id}`}
            data-qs-action="ARTIFACT_RECEIPT_VIEW_TRACE"
            title={threat ? 'Open full threat map in Threat Matrix' : 'Open in Evidence Workspace'}
            aria-label={threat ? 'Open full threat map in Threat Matrix' : 'Open in Evidence Workspace'}
            onClick={(event) => {
              event.stopPropagation()
              handleOpen(event)
            }}
          >
            <ExternalLink size={15} aria-hidden />
          </button>
        ) : null}
        <div
          className="chat-artifact-card__svg"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(previewSvg, { USE_PROFILES: { svg: true, svgFilters: true } }),
          }}
        />
      </div>
    </article>
  )
}
