/**
 * RightInspector — Element inspector panel for ArchitectureView.
 * Three tabs: Properties | Code | Files
 */
import { useMemo, useState, useRef } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  Paperclip, ChevronLeft, ChevronRight,
  Zap, Clock, Code2, AlignLeft, Map, Pencil,
} from 'lucide-react'
import { EMBRY, label, body } from '../common/EmbryStyle'

/* ─── Types ─────────────────────────────────────────────────── */

export interface ElementCustomData {
  name?: string
  label?: string
  latency?: string
  description?: string
  codeRef?: string
  files?: string[]
}

export interface InspectedElement {
  id: string
  type: string
  customData?: ElementCustomData
}

export interface AttachedFile {
  path: string
  content?: string
}

export type RightTab = 'properties' | 'code' | 'files'

/* ─── Helpers ────────────────────────────────────────────────── */

export function langFromPath(path: string): string {
  if (path.endsWith('.py')) return 'python'
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript'
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.md')) return 'markdown'
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.sh')) return 'bash'
  return 'text'
}

/* ─── PropRow ────────────────────────────────────────────────── */

function PropRow({
  icon,
  rowLabel,
  value,
}: {
  icon: React.ReactNode
  rowLabel: string
  value: string
}) {
  return (
    <div>
      <div
        style={{ ...label, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}
      >
        {icon}
        {rowLabel}
      </div>
      <div
        style={{
          ...body,
          fontSize: 11,
          background: EMBRY.bgDeep,
          padding: '6px 10px',
          borderRadius: 4,
          border: `1px solid ${EMBRY.border}`,
          fontFamily: '"JetBrains Mono", monospace',
        }}
      >
        {value}
      </div>
    </div>
  )
}

/* ─── RightInspector ─────────────────────────────────────────── */

export interface RightInspectorProps {
  element: InspectedElement | null
  tab: RightTab
  onTab: (t: RightTab) => void
  files: AttachedFile[]
  onAddFile: (files: FileList | null) => void
  collapsed: boolean
  onCollapse: () => void
  width: number
}

function isCodePath(path: string): boolean {
  return ['.py', '.ts', '.tsx', '.js', '.jsx'].some(ext => path.endsWith(ext))
}

function renderMarkdownHtml(markdown: string): string {
  const escaped = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return escaped
    .replace(/^### (.*)$/gm, '<h3 style="margin:8px 0 4px;font-size:12px;color:#e2e8f0;">$1</h3>')
    .replace(/^## (.*)$/gm, '<h2 style="margin:10px 0 6px;font-size:13px;color:#e2e8f0;">$1</h2>')
    .replace(/^# (.*)$/gm, '<h1 style="margin:12px 0 8px;font-size:14px;color:#e2e8f0;">$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:#0b1220;padding:1px 4px;border-radius:4px;border:1px solid rgba(255,255,255,0.13);">$1</code>')
    .replace(/\n/g, '<br/>')
}

export function RightInspector({
  element,
  tab,
  onTab,
  files,
  onAddFile,
  collapsed,
  onCollapse,
  width,
}: RightInspectorProps) {
  const [openFile, setOpenFile] = useState<AttachedFile | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cd: ElementCustomData = element?.customData ?? {}
  const codeFiles = useMemo(() => files.filter(f => isCodePath(f.path)), [files])
  const selectedCodeFile = useMemo(() => {
    if (openFile && isCodePath(openFile.path)) return openFile
    return codeFiles[0] ?? null
  }, [openFile, codeFiles])

  const TABS: { id: RightTab; icon: React.ReactNode; lbl: string }[] = [
    { id: 'properties', icon: <AlignLeft size={11} />, lbl: 'Properties' },
    { id: 'code', icon: <Code2 size={11} />, lbl: 'Code' },
    { id: 'files', icon: <Paperclip size={11} />, lbl: 'Files' },
  ]

  if (collapsed) {
    return (
      <div
        style={{
          width: 28,
          flexShrink: 0,
          background: EMBRY.bgPanel,
          borderLeft: `1px solid ${EMBRY.border}`,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: 12,
        }}
      >
        <button
          onClick={onCollapse}
          title="Open inspector"
          style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 2 }}
        >
          <ChevronLeft size={14} />
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        width,
        flexShrink: 0,
        background: EMBRY.bgPanel,
        borderLeft: `1px solid ${EMBRY.border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: `1px solid ${EMBRY.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Zap size={10} color={EMBRY.accent} />
          Element Inspector
        </div>
        <button
          onClick={onCollapse}
          title="Collapse inspector"
          style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 2 }}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            style={{
              flex: 1,
              padding: '8px 4px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: tab === t.id ? EMBRY.accent : EMBRY.dim,
              borderBottom: tab === t.id ? `2px solid ${EMBRY.accent}` : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            {t.icon}
            {t.lbl}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {!element && (
          <div style={{ ...body, color: EMBRY.dim, textAlign: 'center', paddingTop: 32, fontSize: 11 }}>
            Select an element on the canvas
          </div>
        )}

        {element && tab === 'properties' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <PropRow icon={<Pencil size={11} color={EMBRY.dim} />} rowLabel="Name" value={cd.label ?? cd.name ?? element.id} />
            <PropRow icon={<Map size={11} color={EMBRY.dim} />} rowLabel="Type" value={element.type} />
            <PropRow icon={<Clock size={11} color={EMBRY.dim} />} rowLabel="Latency" value={cd.latency ?? '—'} />
            <div>
              <div style={{ ...label, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                <AlignLeft size={9} color={EMBRY.dim} />
                Description
              </div>
              <div
                style={{
                  ...body,
                  fontSize: 11,
                  color: EMBRY.white,
                  background: EMBRY.bgDeep,
                  padding: 10,
                  borderRadius: 6,
                  border: `1px solid ${EMBRY.border}`,
                  minHeight: 60,
                  lineHeight: 1.7,
                }}
              >
                {cd.description ?? 'No description. Add customData.description to this element.'}
              </div>
            </div>
          </div>
        )}

        {element && tab === 'code' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {codeFiles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {codeFiles.map((f, i) => {
                  const active = selectedCodeFile?.path === f.path
                  return (
                    <button
                      key={`${f.path}-${i}`}
                      onClick={() => setOpenFile(f)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 8px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        background: active ? `${EMBRY.accent}18` : 'transparent',
                        border: `1px solid ${active ? `${EMBRY.accent}44` : EMBRY.border}`,
                        color: EMBRY.white,
                        fontSize: 10,
                        fontFamily: '"JetBrains Mono", monospace',
                        textAlign: 'left',
                      }}
                    >
                      <Code2 size={10} color={EMBRY.dim} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.path}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            {selectedCodeFile?.content ? (
              <SyntaxHighlighter
                language={langFromPath(selectedCodeFile.path)}
                style={vscDarkPlus}
                customStyle={{ margin: 0, borderRadius: 6, fontSize: 10, background: EMBRY.bgDeep }}
              >
                {selectedCodeFile.content}
              </SyntaxHighlighter>
            ) : (
              <div style={{ ...body, color: EMBRY.dim, textAlign: 'center', paddingTop: 32, fontSize: 11 }}>
                {cd.codeRef
                  ? `Attach ${cd.codeRef} in Files to preview code.`
                  : 'No code attached. Add a .py/.ts/.tsx/.js/.jsx file via the Files tab.'}
              </div>
            )}
          </div>
        )}

        {element && tab === 'files' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {files.length === 0 && (
              <div style={{ ...body, color: EMBRY.dim, fontSize: 11, textAlign: 'center', paddingTop: 20 }}>
                No files attached
              </div>
            )}
            {files.map((f, i) => (
              <div
                key={i}
                onClick={() => setOpenFile(openFile?.path === f.path ? null : f)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: openFile?.path === f.path ? `${EMBRY.accent}18` : 'transparent',
                  border: `1px solid ${openFile?.path === f.path ? `${EMBRY.accent}44` : 'transparent'}`,
                  transition: 'all 0.15s',
                }}
              >
                <Paperclip size={10} color={EMBRY.dim} />
                <span
                  style={{
                    fontSize: 10,
                    color: EMBRY.white,
                    fontFamily: '"JetBrains Mono", monospace',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {f.path.split('/').pop() ?? f.path}
                </span>
              </div>
            ))}
            {openFile?.content && (
              <div style={{ marginTop: 8 }}>
                {openFile.path.endsWith('.md') ? (
                  <div
                    style={{
                      ...body,
                      fontSize: 11,
                      background: EMBRY.bgDeep,
                      border: `1px solid ${EMBRY.border}`,
                      borderRadius: 6,
                      padding: 10,
                    }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(openFile.content) }}
                  />
                ) : openFile.path.endsWith('.html') ? (
                  <iframe
                    title={openFile.path}
                    srcDoc={openFile.content}
                    style={{
                      width: '100%',
                      minHeight: 180,
                      border: `1px solid ${EMBRY.border}`,
                      borderRadius: 6,
                      background: '#ffffff',
                    }}
                  />
                ) : (
                  <SyntaxHighlighter
                    language={langFromPath(openFile.path)}
                    style={vscDarkPlus}
                    customStyle={{ margin: 0, borderRadius: 6, fontSize: 9, background: EMBRY.bgDeep }}
                  >
                    {openFile.content}
                  </SyntaxHighlighter>
                )}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={e => onAddFile(e.target.files)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 8,
                padding: '6px 10px',
                background: 'none',
                border: `1px dashed ${EMBRY.border}`,
                borderRadius: 4,
                cursor: 'pointer',
                color: EMBRY.dim,
                fontSize: 10,
                width: '100%',
                justifyContent: 'center',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = EMBRY.accent }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = EMBRY.border }}
            >
              <Paperclip size={10} />
              Attach File
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
