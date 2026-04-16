/**
 * InlineFigure — Renders figure artifacts inline in chat (SVG, HTML, diagrams).
 * Follows same pattern as RecallCard for collapsible/expandable behavior.
 * COTS compliant: fonts >= 12px, touch targets >= 44px, data-qid on ALL elements.
 */

import { useState } from 'react'
import { Maximize2, Copy, Check } from 'lucide-react'
import type { Artifact } from './types'
import { EMBRY } from '../sparta/common/EmbryStyle'

export interface InlineFigureProps {
  artifact: Artifact
  onExpand?: () => void
  loading?: boolean
}

export function InlineFigure({ artifact, onExpand, loading }: InlineFigureProps) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      console.error('Failed to copy:', e)
    }
  }

  const handleExpand = () => {
    setExpanded(!expanded)
    onExpand?.()
  }

  if (loading) {
    return (
      <div
        data-qid={`figure:skeleton:${artifact.id}`}
        title="Loading figure..."
        style={{
          background: EMBRY.surface,
          borderRadius: 8,
          padding: 16,
          marginTop: 8,
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      >
        <div style={{ height: 120, background: 'rgba(255,255,255,0.05)', borderRadius: 4 }} />
        <div style={{ height: 14, width: '60%', background: 'rgba(255,255,255,0.05)', borderRadius: 4, marginTop: 8 }} />
      </div>
    )
  }

  const isSvg = artifact.type === 'figure' || artifact.type === 'gsn-diagram' || artifact.content?.trim().startsWith('<svg')
  const isHtml = artifact.type === 'html' || (!isSvg && artifact.content?.trim().startsWith('<'))

  return (
    <div
      data-qid={`figure:container:${artifact.id}`}
      data-qs-action="FIGURE_CONTAINER"
      title={artifact.figureSpec?.title || artifact.title || 'Figure'}
      style={{
        background: EMBRY.surface,
        border: `1px solid ${EMBRY.border}`,
        borderRadius: 8,
        padding: 12,
        marginTop: 8,
        overflow: 'hidden',
      }}
    >
      {/* Header with title and controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span
          data-qid={`figure:title:${artifact.id}`}
          title={artifact.figureSpec?.title || artifact.title}
          style={{ color: EMBRY.text, fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-sans)' }}
        >
          {artifact.figureSpec?.title || artifact.title || 'Figure'}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            data-qid={`figure:copy:${artifact.id}`}
            data-qs-action="FIGURE_COPY"
            title="Copy figure content"
            onClick={handleCopy}
            style={{
              background: 'none',
              border: `1px solid ${EMBRY.border}`,
              borderRadius: 4,
              padding: '4px 8px',
              cursor: 'pointer',
              color: copied ? '#00ff88' : EMBRY.muted,
              fontSize: 12,
              minWidth: 44,
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          {onExpand && (
            <button
              data-qid={`figure:expand:${artifact.id}`}
              data-qs-action="FIGURE_EXPAND"
              title="Open in full panel"
              onClick={handleExpand}
              style={{
                background: 'none',
                border: `1px solid ${EMBRY.border}`,
                borderRadius: 4,
                padding: '4px 8px',
                cursor: 'pointer',
                color: EMBRY.muted,
                fontSize: 12,
                minWidth: 44,
                minHeight: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Maximize2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Figure content */}
      <div
        data-qid={`figure:content:${artifact.id}`}
        data-qs-action="FIGURE_CONTENT"
        title="Figure content area"
        style={{
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 4,
          padding: 8,
          maxHeight: expanded ? 'none' : 300,
          overflow: expanded ? 'visible' : 'auto',
        }}
      >
        {isSvg || isHtml ? (
          // Render SVG/HTML content - sanitization note: content comes from trusted skill output
          <div
            dangerouslySetInnerHTML={{ __html: artifact.content }}
            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
          />
        ) : (
          // Plain text/code fallback
          <pre style={{ margin: 0, fontSize: 12, color: EMBRY.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' }}>
            {artifact.content}
          </pre>
        )}
      </div>

      {/* Caption */}
      {artifact.figureSpec?.caption && (
        <p
          data-qid={`figure:caption:${artifact.id}`}
          title={artifact.figureSpec.caption}
          style={{
            color: EMBRY.muted,
            fontSize: 12,
            fontStyle: 'italic',
            marginTop: 8,
            marginBottom: 0,
            fontFamily: 'var(--font-sans)',
          }}
        >
          {artifact.figureSpec.caption}
        </p>
      )}
    </div>
  )
}
