/**
 * SpartaHudInput — Split-Level Gemini-Style Tactical Reasoning Hub
 *
 * Two-tier architecture:
 * - Top Tier: Query composition (full-width textarea)
 * - Bottom Tier: Tools (left) + Reasoning Status (right)
 *
 * The "Thinking" pill expands to show live CAE trace (LiveGateChain).
 *
 * Complies with:
 * - COTS C02: 44px minimum touch targets
 * - NVIS Class A: White Phosphor palette, 1.25px strokes
 * - 2026 Industrial Elegance: Split-level, blur(32px), interior glow
 */
import { useCallback, useRef, useState, useEffect, type KeyboardEvent, type ChangeEvent } from 'react'
import { Terminal, ChevronDown, ChevronUp, ArrowUp, Loader2, Shield, FileText, X } from 'lucide-react'
import { useRegisterAction } from '../../../hooks/useRegisterAction'

// NVIS 2026 Color Palette
const NVIS = {
  phosphor: '#e0e4e8',
  cyan: '#00d1ff',
  dim: '#8b949e',
  glassBg: 'rgba(18, 19, 21, 0.85)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  cyanGlow: 'rgba(0, 209, 255, 0.15)',
  dark: '#08090a',
  red: '#f85149',
}

export interface ReasoningStep {
  id: string
  type: string
  skill?: string
  status: 'pending' | 'running' | 'done' | 'failed'
  summary: string
  detail?: string
  duration?: number
  startedAt?: number
}

interface SpartaHudInputProps {
  onSend: (query: string, type: 'natural' | 'aql') => void
  onSkillsOpen?: () => void
  onIngestEvidence?: () => void
  placeholder?: string
  disabled?: boolean
  /** True when reasoning/thinking is active */
  isThinking?: boolean
  /** Live reasoning steps for CAE trace */
  reasoningSteps?: ReasoningStep[]
  /** Label for thinking pill */
  thinkingLabel?: string
  /** Controlled value (optional - enables Skills Palette sync) */
  value?: string
  /** Controlled value change handler */
  onValueChange?: (value: string) => void
}

export function SpartaHudInput({
  onSend,
  onSkillsOpen,
  onIngestEvidence,
  placeholder = 'Enter a prompt for SPARTA Explorer...',
  disabled = false,
  isThinking = false,
  reasoningSteps = [],
  thinkingLabel = 'Thinking',
  value: controlledValue,
  onValueChange,
}: SpartaHudInputProps) {
  const [internalValue, setInternalValue] = useState('')
  const [thinkingExpanded, setThinkingExpanded] = useState(false)
  const [pdfName, setPdfName] = useState('')
  const [pdfStatus, setPdfStatus] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  // Register actions for QID compliance (4-attribute rule)
  useRegisterAction('sparta:hud:input', { app: 'sparta-explorer', action: 'ENTER_QUERY', label: 'Query Input', description: 'Enter a compliance query for SPARTA' })
  useRegisterAction('sparta:hud:ingest', { app: 'sparta-explorer', action: 'INGEST_EVIDENCE', label: 'Add Evidence', description: 'Add compliance evidence to datalake' })
  useRegisterAction('sparta:hud:skills', { app: 'sparta-explorer', action: 'OPEN_SKILLS', label: 'Skills Palette', description: 'Open the skills command palette' })
  useRegisterAction('sparta:hud:thinking', { app: 'sparta-explorer', action: 'TOGGLE_REASONING', label: 'View CAE Trace', description: 'Expand or collapse the reasoning trace' })
  useRegisterAction('sparta:hud:transmit', { app: 'sparta-explorer', action: 'SEND_QUERY', label: 'Transmit', description: 'Send the query for processing' })
  useRegisterAction('sparta:hud:pdf-upload', { app: 'sparta-explorer', action: 'UPLOAD_PDF_EVIDENCE', label: 'Attach PDF evidence', description: 'Attach a PDF evidence document for evidence-case binding' })
  useRegisterAction('sparta:hud:pdf-clear', { app: 'sparta-explorer', action: 'CLEAR_PDF_EVIDENCE', label: 'Clear PDF evidence', description: 'Remove the currently attached PDF evidence document' })

  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : internalValue

  const setValue = useCallback((newValue: string) => {
    if (isControlled) {
      onValueChange?.(newValue)
    } else {
      setInternalValue(newValue)
    }
  }, [isControlled, onValueChange])

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    // Auto-expand textarea
    const ta = e.target
    ta.style.height = ''
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled || isThinking) return

    const isAql = trimmed.toLowerCase().startsWith('for ') || trimmed.includes('RETURN')
    onSend(trimmed, isAql ? 'aql' : 'natural')
    setValue('')

    if (textareaRef.current) {
      textareaRef.current.style.height = ''
    }
  }, [value, disabled, isThinking, onSend])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === '/' && value === '' && onSkillsOpen) {
      e.preventDefault()
      onSkillsOpen()
    }
  }, [handleSubmit, value, onSkillsOpen])

  const handlePdfChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      setPdfName('')
      setPdfStatus('Only PDF evidence files can be attached.')
      e.target.value = ''
      return
    }
    setPdfName(file.name)
    setPdfStatus('PDF accepted · extraction pending · not available for approved evidence yet')
    onIngestEvidence?.()
  }, [onIngestEvidence])

  const clearPdf = useCallback(() => {
    setPdfName('')
    setPdfStatus('')
    if (pdfInputRef.current) pdfInputRef.current.value = ''
  }, [])

  const canSend = value.trim().length > 0 && !disabled && !isThinking

  return (
    <div style={styles.container}>
      <div style={styles.hud}>
        {/* Top Tier: Shield + Query Input */}
        <div style={styles.topTier}>
          <Shield size={16} strokeWidth={1.25} style={styles.shieldIcon} />
          <textarea
            ref={textareaRef}
            data-qid="sparta:hud:input"
            data-qs-action="ENTER_QUERY"
            title="Enter a compliance query for SPARTA (Enter to send, Shift+Enter for newline)"
            placeholder={placeholder}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled || isThinking}
            rows={1}
            style={styles.textarea}
          />
        </div>

        {/* Bottom Tier: Tools + Status */}
        <div style={styles.bottomTier}>
          {/* Left: Tool Cluster */}
          <div style={styles.toolCluster}>
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={handlePdfChange}
              style={{ display: 'none' }}
            />
            <button
              data-qid="sparta:hud:pdf-upload"
              data-qs-action="UPLOAD_PDF_EVIDENCE"
              title="Attach PDF evidence"
              style={styles.pdfBtn}
              onClick={() => pdfInputRef.current?.click()}
              disabled={disabled}
            >
              <FileText size={16} strokeWidth={1.25} />
              <span>PDF</span>
            </button>
            <button
              data-qid="sparta:hud:skills"
              data-qs-action="OPEN_SKILLS"
              title="Skills Palette (⌘K)"
              style={styles.iconBtn}
              onClick={onSkillsOpen}
              disabled={disabled}
            >
              <Terminal size={16} strokeWidth={1.25} />
            </button>
            <span style={styles.toolLabel}>Tools</span>
          </div>

          {/* Right: Status Cluster */}
          <div style={styles.statusCluster}>
            {/* Thinking Pill */}
            {(isThinking || reasoningSteps.length > 0) && (
              <button
                data-qid="sparta:hud:thinking"
                data-qs-action="TOGGLE_REASONING"
                title="View CAE Trace"
                style={{
                  ...styles.reasoningPill,
                  ...(isThinking ? styles.reasoningPillActive : {}),
                }}
                onClick={() => setThinkingExpanded(!thinkingExpanded)}
              >
                {isThinking && (
                  <Loader2 size={14} strokeWidth={1.25} style={{ animation: 'spin 1s linear infinite' }} />
                )}
                <span>{thinkingLabel}</span>
                {thinkingExpanded ? (
                  <ChevronUp size={14} strokeWidth={1.25} />
                ) : (
                  <ChevronDown size={14} strokeWidth={1.25} />
                )}
              </button>
            )}

            {/* Transmit Button */}
            <button
              data-qid="sparta:hud:transmit"
              data-qs-action="SEND_QUERY"
              title="Transmit (Enter)"
              style={{
                ...styles.transmitBtn,
                ...(canSend ? styles.transmitBtnActive : {}),
              }}
              onClick={handleSubmit}
              disabled={!canSend}
            >
              <ArrowUp size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {(pdfName || pdfStatus) && (
          <div
            data-qid="sparta:hud:pdf-status"
            title={pdfStatus || `Attached PDF evidence: ${pdfName}`}
            style={styles.pdfStatus}
          >
            {pdfName && <span style={styles.pdfName}>{pdfName}</span>}
            <span style={{ color: pdfStatus.startsWith('Only') ? NVIS.red : NVIS.dim }}>{pdfStatus}</span>
            {pdfName && (
              <button
                data-qid="sparta:hud:pdf-clear"
                data-qs-action="CLEAR_PDF_EVIDENCE"
                title="Remove attached PDF evidence"
                onClick={clearPdf}
                style={styles.clearPdfBtn}
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {/* Expanded: Reasoning Trace */}
        {thinkingExpanded && reasoningSteps.length > 0 && (
          <div style={styles.reasoningTrace}>
            {reasoningSteps.map((step) => (
              <div key={step.id} style={styles.reasoningStep}>
                <span style={{
                  ...styles.stepIndicator,
                  background: step.status === 'done' ? '#3fb950'
                    : step.status === 'running' ? NVIS.cyan
                    : step.status === 'failed' ? '#f85149'
                    : NVIS.dim,
                  boxShadow: step.status === 'running' ? `0 0 6px ${NVIS.cyan}` : 'none',
                }} />
                <span style={{
                  ...styles.stepLabel,
                  color: step.status === 'running' ? NVIS.phosphor : NVIS.dim,
                }}>
                  {step.summary}
                </span>
                {step.detail && (
                  <span style={styles.stepDetail}>{step.detail}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Keyframe for spinner */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    zIndex: 100,
  },
  hud: {
    display: 'flex',
    flexDirection: 'column',
    background: NVIS.glassBg,
    backdropFilter: 'blur(32px)',
    WebkitBackdropFilter: 'blur(32px)',
    border: `1px solid ${NVIS.glassBorder}`,
    borderRadius: 12,
    padding: '12px 12px 8px 12px',
    boxShadow: `0 8px 32px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05)`,
  },
  topTier: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 6,
  },
  shieldIcon: {
    color: NVIS.dim,
    marginTop: 3,
    flexShrink: 0,
    opacity: 0.6,
  },
  textarea: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    maxHeight: 200,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: NVIS.phosphor,
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: 15,
    fontWeight: 300,
    lineHeight: 1.5,
    padding: 0,
    resize: 'none',
    overflow: 'hidden',
  },
  bottomTier: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toolCluster: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  iconBtn: {
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    color: NVIS.dim,
    cursor: 'pointer',
    transition: 'color 0.15s',
  },
  pdfBtn: {
    minWidth: 44,
    minHeight: 44,
    padding: '0 10px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    background: 'transparent',
    border: `1px solid ${NVIS.glassBorder}`,
    borderRadius: 8,
    color: NVIS.phosphor,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
  },
  pdfStatus: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
    borderTop: `1px solid ${NVIS.glassBorder}`,
    color: NVIS.dim,
    fontSize: 12,
    lineHeight: 1.4,
  },
  pdfName: {
    color: NVIS.phosphor,
    fontFamily: 'monospace',
    overflowWrap: 'anywhere',
  },
  clearPdfBtn: {
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    padding: 0,
    borderRadius: 8,
    border: `1px solid ${NVIS.glassBorder}`,
    background: 'transparent',
    color: NVIS.dim,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: NVIS.dim,
    marginLeft: 2,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    opacity: 0.6,
  },
  statusCluster: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  reasoningPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 44,
    minHeight: 44,
    padding: '0 16px',
    background: 'rgba(255, 255, 255, 0.06)',
    border: `1px solid ${NVIS.glassBorder}`,
    borderRadius: 22,
    color: NVIS.dim,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  reasoningPillActive: {
    color: NVIS.cyan,
    borderColor: `${NVIS.cyan}40`,
    background: NVIS.cyanGlow,
  },
  transmitBtn: {
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    borderRadius: 10,
    background: 'transparent',
    border: `1px solid ${NVIS.glassBorder}`,
    color: NVIS.dim,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.15s',
    opacity: 0.5,
  },
  transmitBtnActive: {
    opacity: 1,
    background: NVIS.cyan,
    border: `1px solid ${NVIS.cyan}`,
    color: NVIS.dark,
  },
  reasoningTrace: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: `1px solid ${NVIS.glassBorder}`,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  reasoningStep: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  stepIndicator: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: 500,
  },
  stepDetail: {
    fontSize: 11,
    color: NVIS.dim,
    marginLeft: 'auto',
  },
}
