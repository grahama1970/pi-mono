/**
 * Chat artifact receipt — contextual navigator teasers (3-row rule, frameless thumbnails).
 */
import type { MouseEvent, ReactNode } from 'react'
import DOMPurify from 'dompurify'
import { ExternalLink, FileText, Maximize2 } from 'lucide-react'
import type { Artifact } from './types'
import { EMBRY } from '../sparta/common/EmbryStyle'
import { useChatReadable } from './chatReadableContext'
import { artifactPreviewSvg, isThreatMapArtifact } from './artifactReceiptHelpers'

function provenanceLabel(artifact: Artifact): string | null {
  const state = artifact.provenanceState ?? (artifact.sampleDerived ? 'sample-derived' : undefined)
  if (!state || state === 'bound') return null
  return state
}

interface ChatTableData {
  columns: { key: string; label: string }[]
  rows: Record<string, unknown>[]
}

function isChatTableData(data: unknown): data is ChatTableData {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return Array.isArray(obj.columns) && Array.isArray(obj.rows)
}

function ArtifactIconRail({ children }: { children: ReactNode }) {
  return <div className="artifact-receipt-icon-rail">{children}</div>
}

function ArtifactIconButton({
  title,
  onClick,
  qid,
  action,
  children,
}: {
  title: string
  onClick: (event: MouseEvent) => void
  qid: string
  action: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="artifact-receipt-icon-btn"
      data-qid={qid}
      data-qs-action={action}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function WorkspaceDeepLink({
  label,
  onClick,
  qid,
}: {
  label: string
  onClick: (event: MouseEvent) => void
  qid: string
}) {
  return (
    <button type="button" className="artifact-receipt-workspace-link" data-qid={qid} onClick={onClick}>
      <ExternalLink size={12} aria-hidden />
      {label}
    </button>
  )
}

function FigureOverlayButton({
  title,
  onClick,
  qid,
  action,
}: {
  title: string
  onClick: (event: MouseEvent) => void
  qid: string
  action: string
}) {
  return (
    <button
      type="button"
      className="artifact-receipt-overlay-btn"
      data-qid={qid}
      data-qs-action={action}
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick(event)
      }}
    >
      <ExternalLink size={16} aria-hidden />
    </button>
  )
}

function FigureMediaFrame({
  artifactId,
  previewSvg,
  embeddedInWell = false,
  frameless = false,
  onClick,
}: {
  artifactId: string
  previewSvg: string
  embeddedInWell?: boolean
  frameless?: boolean
  onClick?: (event: MouseEvent) => void
}) {
  const CHAT_READABLE = useChatReadable()
  const qid = frameless ? `sparta:chat:figure-well:${artifactId}` : `artifact:receipt:thumb:${artifactId}`

  return (
    <div
      className={[
        frameless ? 'artifact-receipt-thumbnail artifact-receipt-thumbnail--frameless' : undefined,
        embeddedInWell && !frameless ? 'artifact-receipt-mini-map' : undefined,
      ].filter(Boolean).join(' ') || undefined}
      data-qid={qid}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(e as unknown as MouseEvent) } : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? 'Open in Evidence Workspace' : undefined}
      style={{ marginTop: embeddedInWell ? 2 : 10, width: '100%' }}
    >
      <div
        className={[
          'artifact-receipt-media',
          embeddedInWell ? 'artifact-receipt-media--embedded' : '',
          frameless ? 'artifact-receipt-media--frameless' : '',
        ].filter(Boolean).join(' ')}
        style={{
          overflow: 'hidden',
          border: 'none',
          background: 'transparent',
          maxHeight: embeddedInWell || frameless ? undefined : CHAT_READABLE.chatArtifactMaxHeight,
          lineHeight: 0,
        }}
      >
        <div
          style={{ width: '100%', display: 'block' }}
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(previewSvg, { USE_PROFILES: { svg: true, svgFilters: true } }),
          }}
        />
      </div>
    </div>
  )
}

function ChatTablePreview({
  artifact,
  data,
  rowLimit,
  embeddedInWell = false,
}: {
  artifact: Artifact
  data: ChatTableData
  rowLimit?: number
  embeddedInWell?: boolean
}) {
  const CHAT_READABLE = useChatReadable()
  const truncated = Boolean(rowLimit && data.rows.length > rowLimit)

  return (
    <div
      data-qid={`artifact:receipt:preview:${artifact.id}`}
      className={[
        truncated && embeddedInWell ? 'artifact-receipt-table-fade chat-table-preview chat-table-preview--embedded' : 'chat-table-preview',
        embeddedInWell ? 'chat-table-preview--embedded' : '',
      ].filter(Boolean).join(' ')}
      style={{
        overflowX: 'auto',
        overflowY: embeddedInWell && truncated ? 'hidden' : undefined,
        marginTop: embeddedInWell ? 4 : 8,
        position: 'relative',
        maxHeight: embeddedInWell && truncated ? CHAT_READABLE.chatTableMaxHeight : undefined,
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: embeddedInWell ? CHAT_READABLE.tablePreviewFontSize : CHAT_READABLE.metaSize, fontFamily: CHAT_READABLE.fontSans }}>
        <thead>
          <tr>
            {data.columns.map(col => (
              <th
                key={col.key}
                style={{
                  padding: embeddedInWell ? '4px 0' : '8px 4px 8px 0',
                  textAlign: 'left',
                  color: EMBRY.muted,
                  fontSize: embeddedInWell ? CHAT_READABLE.tablePreviewFontSize : CHAT_READABLE.labelSize,
                  fontWeight: embeddedInWell ? 500 : 600,
                  borderBottom: embeddedInWell ? '1px solid rgba(255,255,255,0.06)' : `1px solid ${CHAT_READABLE.borderMedium}`,
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(rowLimit ? data.rows.slice(0, rowLimit) : data.rows).map((row, idx, arr) => (
            <tr key={idx}>
              {data.columns.map(col => (
                <td
                  key={col.key}
                  style={{
                    padding: embeddedInWell ? '4px 0' : '10px 4px 10px 0',
                    color: EMBRY.white,
                    borderBottom: embeddedInWell
                      ? (idx === arr.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.06)')
                      : (idx === (rowLimit ? Math.min(rowLimit, data.rows.length) : data.rows.length) - 1 ? 'none' : `1px solid ${CHAT_READABLE.borderSubtle}`),
                    verticalAlign: 'top',
                    lineHeight: CHAT_READABLE.lineHeight,
                  }}
                >
                  {String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export interface ArtifactReceiptProps {
  artifact: Artifact
  onOpen?: (artifact: Artifact) => void
  onViewWorkspace?: () => void
  onOpenThreatMatrix?: () => void
  embeddedInWell?: boolean
}

export function ArtifactReceipt({ artifact, onOpen, onViewWorkspace, onOpenThreatMatrix, embeddedInWell = false }: ArtifactReceiptProps) {
  const CHAT_READABLE = useChatReadable()
  const previewSvg = artifactPreviewSvg(artifact)
  const provenance = provenanceLabel(artifact)
  const isFigure = (artifact.type === 'figure' || artifact.type === 'graph') && Boolean(previewSvg)
  const threatMap = isThreatMapArtifact(artifact)
  const framelessThreat = embeddedInWell && threatMap

  const handleOpen = onOpen
    ? (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        onOpen(artifact)
      }
    : undefined

  const handleViewWorkspace = onViewWorkspace
    ? (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        onViewWorkspace()
      }
    : undefined

  const handleThreatDeepLink = (onOpenThreatMatrix ?? onViewWorkspace)
    ? (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        if (onOpenThreatMatrix) onOpenThreatMatrix()
        else onViewWorkspace?.()
      }
    : undefined

  const titleStyle = {
    color: EMBRY.muted,
    fontSize: CHAT_READABLE.labelSize,
    fontWeight: 600,
    lineHeight: 1.35,
    fontFamily: CHAT_READABLE.fontSans,
    margin: 0,
  } as const

  const iconRail = (actions: ReactNode) => (
    embeddedInWell && !framelessThreat ? <ArtifactIconRail>{actions}</ArtifactIconRail> : null
  )

  if (isFigure) {
    const deepLink = handleThreatDeepLink ?? handleViewWorkspace

    return (
      <figure
        data-qid={`artifact:receipt:${artifact.id}`}
        className={framelessThreat ? 'artifact-receipt-figure--frameless' : undefined}
        style={{ width: '100%', margin: embeddedInWell ? (framelessThreat ? '4px 0 0' : '4px 0 0') : `0 0 ${CHAT_READABLE.blockGap}px 0`, padding: 0, border: 'none', background: 'transparent' }}
      >
        {!embeddedInWell ? (
          <div data-qid={`artifact:receipt:title:${artifact.id}`} style={{ ...titleStyle, color: EMBRY.white, fontSize: CHAT_READABLE.metaSize, paddingTop: 10 }}>
            {artifact.title}
          </div>
        ) : null}

        {previewSvg ? (
          <div className={framelessThreat ? 'artifact-receipt-preview-shell artifact-receipt-preview-shell--frameless' : 'artifact-receipt-preview-shell'}>
            {framelessThreat ? (
              <>
                {deepLink ? (
                  <FigureOverlayButton
                    title="View full threat map in Workspace"
                    onClick={deepLink}
                    qid={`artifact:receipt:overlay:${artifact.id}`}
                    action="ARTIFACT_RECEIPT_VIEW_TRACE"
                  />
                ) : null}
                <FigureMediaFrame
                  artifactId={artifact.id}
                  previewSvg={previewSvg}
                  embeddedInWell={embeddedInWell}
                  frameless
                  onClick={deepLink}
                />
              </>
            ) : (
              <>
                <FigureMediaFrame
                  artifactId={artifact.id}
                  previewSvg={previewSvg}
                  embeddedInWell={embeddedInWell}
                  onClick={embeddedInWell ? handleViewWorkspace : undefined}
                />
                {embeddedInWell ? (
                  <div className="artifact-receipt__hover-actions" aria-label="Figure actions">
                    {provenance ? (
                      <ArtifactIconButton
                        title={`Source state: ${provenance}`}
                        onClick={handleViewWorkspace ?? ((e) => e.preventDefault())}
                        qid={`artifact:receipt:source:${artifact.id}`}
                        action="ARTIFACT_RECEIPT_SOURCE"
                      >
                        <FileText size={13} aria-hidden />
                      </ArtifactIconButton>
                    ) : null}
                    {handleViewWorkspace ? (
                      <ArtifactIconButton
                        title="View in Evidence Workspace"
                        onClick={handleViewWorkspace}
                        qid={`artifact:receipt:view-trace:${artifact.id}`}
                        action="ARTIFACT_RECEIPT_VIEW_TRACE"
                      >
                        <ExternalLink size={13} aria-hidden />
                      </ArtifactIconButton>
                    ) : null}
                    {handleOpen ? (
                      <ArtifactIconButton
                        title={`Expand ${artifact.title}`}
                        onClick={handleOpen}
                        qid={`artifact:receipt:expand:${artifact.id}`}
                        action="ARTIFACT_RECEIPT_OPEN"
                      >
                        <Maximize2 size={13} aria-hidden />
                      </ArtifactIconButton>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        <span data-qid={`artifact:receipt:provenance:${artifact.id}`} style={{ display: 'none' }}>{provenance ?? ''}</span>
      </figure>
    )
  }

  const tableData = isChatTableData(artifact.data) ? artifact.data : null
  const isTable = (artifact.type === 'react-table' || artifact.type === 'table') && Boolean(tableData)

  if (isTable && tableData) {
    const heading = artifact.sectionHeading ?? artifact.title
    const truncated = tableData.rows.length > CHAT_READABLE.tablePreviewRows

    return (
      <figure
        data-qid={`artifact:receipt:${artifact.id}`}
        style={{ width: '100%', margin: embeddedInWell ? '4px 0 0' : `${CHAT_READABLE.blockGap}px 0 0`, padding: 0, border: 'none', background: 'transparent' }}
      >
        {!embeddedInWell ? (
          <h3 data-qid={`artifact:receipt:title:${artifact.id}`} style={{ ...titleStyle, color: EMBRY.white, fontSize: CHAT_READABLE.metaSize }}>
            {heading}
          </h3>
        ) : null}

        <div className="artifact-receipt-preview-shell">
          <ChatTablePreview
            artifact={artifact}
            data={tableData}
            rowLimit={CHAT_READABLE.tablePreviewRows}
            embeddedInWell={embeddedInWell}
          />
          {embeddedInWell && truncated && handleViewWorkspace ? (
            <WorkspaceDeepLink
              label={`View all ${tableData.rows.length} rows in Workspace`}
              onClick={handleViewWorkspace}
              qid={`artifact:receipt:view-all:${artifact.id}`}
            />
          ) : null}
          {embeddedInWell ? (
            <div className="artifact-receipt__hover-actions" aria-label="Table actions">
              {provenance ? (
                <ArtifactIconButton
                  title={`Source state: ${provenance}`}
                  onClick={handleViewWorkspace ?? ((e) => e.preventDefault())}
                  qid={`artifact:receipt:source:${artifact.id}`}
                  action="ARTIFACT_RECEIPT_SOURCE"
                >
                  <FileText size={13} aria-hidden />
                </ArtifactIconButton>
              ) : null}
              {handleOpen ? (
                <ArtifactIconButton
                  title={`Expand ${artifact.title}`}
                  onClick={handleOpen}
                  qid={`artifact:receipt:expand:${artifact.id}`}
                  action="ARTIFACT_RECEIPT_OPEN"
                >
                  <Maximize2 size={13} aria-hidden />
                </ArtifactIconButton>
              ) : null}
            </div>
          ) : null}
        </div>
      </figure>
    )
  }

  const label = artifact.type === 'react-table' || artifact.type === 'table'
    ? `Table: ${artifact.title}`
    : `Artifact: ${artifact.title}`

  return (
    <div data-qid={`artifact:receipt:${artifact.id}`} style={{ width: '100%', marginTop: embeddedInWell ? 4 : CHAT_READABLE.messageGap, padding: 0 }}>
      <div style={{ color: EMBRY.muted, fontSize: CHAT_READABLE.metaSize, lineHeight: CHAT_READABLE.lineHeight, fontFamily: CHAT_READABLE.fontSans }}>
        {label}
      </div>
    </div>
  )
}
