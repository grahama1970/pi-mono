import { useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { NVIS } from '../theme'
import { exportCanvas } from '../export/index'
import type { ExportFormat } from '../export/index'

export type { ExportFormat }

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'react', label: 'React JSX' },
  { value: 'svg', label: 'SVG' },
  { value: 'png', label: 'PNG' },
]

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: `${NVIS.BG_PRIMARY}99`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  panel: {
    width: 500,
    maxHeight: '80vh',
    backgroundColor: NVIS.BG_SECONDARY,
    borderRadius: 8,
    border: `1px solid ${NVIS.DIM}`,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: `1px solid ${NVIS.DIM}`,
  },
  title: {
    fontSize: 14,
    fontWeight: 700,
    color: NVIS.WHITE,
  },
  closeButton: {
    border: 'none',
    backgroundColor: 'transparent',
    color: NVIS.DIM,
    cursor: 'pointer',
    fontSize: 18,
    padding: '0 4px',
  },
  body: {
    padding: 16,
    flex: 1,
    overflowY: 'auto' as const,
  },
  formatRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 12,
  },
  formatButton: (active: boolean) => ({
    flex: 1,
    padding: '8px 0',
    border: `1px solid ${active ? NVIS.ACCENT : NVIS.BG_TERTIARY}`,
    borderRadius: 6,
    backgroundColor: active ? NVIS.ACCENT : NVIS.BG_TERTIARY,
    color: active ? NVIS.WHITE : NVIS.DIM,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  }),
  preview: {
    backgroundColor: NVIS.BG_TERTIARY,
    border: `1px solid ${NVIS.DIM}`,
    borderRadius: 6,
    padding: 12,
    fontFamily: 'monospace',
    fontSize: 11,
    color: NVIS.DIM,
    whiteSpace: 'pre-wrap' as const,
    maxHeight: 300,
    overflowY: 'auto' as const,
    marginBottom: 12,
    wordBreak: 'break-all' as const,
  },
  copyButton: {
    width: '100%',
    padding: '10px 0',
    border: 'none',
    borderRadius: 6,
    backgroundColor: NVIS.ACCENT,
    color: NVIS.WHITE,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  },
  successMessage: {
    textAlign: 'center' as const,
    color: NVIS.GREEN,
    fontSize: 12,
    marginTop: 8,
  },
}

function generateExportContent(format: ExportFormat, json: Record<string, unknown>): string {
  if (format === 'png') {
    return '// PNG export requires canvas rendering (use browser canvas.toDataURL())'
  }
  const elements = Object.values(json) as Array<{ id: string; type: string; x: number; y: number; width: number; height: number; props: Record<string, unknown> }>
  return exportCanvas(elements, format).content
}

export interface ExportPanelProps {
  visible: boolean
  onClose: () => void
}

export function ExportPanel({ visible, onClose }: ExportPanelProps) {
  const toJSON = useCanvasStore((s) => s.toJSON)
  const [format, setFormat] = useState<ExportFormat>('json')
  const [copied, setCopied] = useState(false)

  if (!visible) return null

  const json = toJSON()
  const content = generateExportContent(format, json)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for environments without clipboard API
      const textarea = document.createElement('textarea')
      textarea.value = content
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose} data-testid="export-panel">
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Export</span>
          <button style={styles.closeButton} onClick={onClose}>
            x
          </button>
        </div>
        <div style={styles.body}>
          <div style={styles.formatRow}>
            {FORMATS.map((f) => (
              <button
                key={f.value}
                style={styles.formatButton(format === f.value)}
                onClick={() => {
                  setFormat(f.value)
                  setCopied(false)
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div style={styles.preview}>{content}</div>
          <button style={styles.copyButton} onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
          {copied && <div style={styles.successMessage}>Copied to clipboard</div>}
        </div>
      </div>
    </div>
  )
}
