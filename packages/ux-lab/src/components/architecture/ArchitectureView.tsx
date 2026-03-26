/**
 * ArchitectureView — Three-panel architecture diagram editor.
 * Left: project list (LeftPane) | Center: Excalidraw canvas | Right: element inspector
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw'
import {
  Plus, Save, Brain, Map,
  Trash2, Copy, Pencil, History, GitBranch,
} from 'lucide-react'
import { EMBRY, heading } from '../common/EmbryStyle'
import { LeftPane, LeftPaneSection, paneItemStyle } from '../common/LeftPane'
import { ContextMenu } from '../common/ContextMenu'
import type { ContextMenuItem } from '../common/ContextMenu'
import { AgentControl } from '../common/AgentControl'
import { StatusBar } from '../common/StatusBar'
import {
  RightInspector,
  type InspectedElement,
  type AttachedFile,
  type ElementCustomData,
  type RightTab,
} from './RightInspector'

/* ─── Types ─────────────────────────────────────────────────── */

interface ArchProject {
  id: string
  name: string
  createdAt: string
}

/* ─── Constants ─────────────────────────────────────────────── */

const FALLBACK_PROJECTS: ArchProject[] = [
  { id: 'new-architecture', name: 'New Architecture', createdAt: new Date().toISOString().slice(0, 10) },
]

const EXCALIDRAW_CSS = `
.excalidraw {
  --color-primary: ${EMBRY.accent};
  --color-primary-darker: ${EMBRY.accent}cc;
  --color-primary-darkest: ${EMBRY.accent}99;
}
.excalidraw,
.excalidraw .layer-ui__wrapper {
  background: transparent !important;
}

/* Glassmorphism on top toolbar — lift it off the canvas */
.excalidraw .App-toolbar-container,
.excalidraw .Island {
  background: rgba(20, 20, 40, 0.7) !important;
  backdrop-filter: blur(12px) !important;
  -webkit-backdrop-filter: blur(12px) !important;
  border: 1px solid rgba(124, 58, 237, 0.15) !important;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3) !important;
}

/* Hide Excalidraw's bottom bar — undo/redo lives in our StatusBar */
.excalidraw .App-bottom-bar,
.excalidraw .layer-ui__wrapper__footer {
  display: none !important;
}

/* Hide Excalidraw's right side panel — we have our own inspector */
.excalidraw .sidebar-trigger,
.excalidraw .layer-ui__wrapper__footer-right {
  display: none !important;
}

/* Scale down toolbar to 65% — less visual noise */
.excalidraw .App-toolbar-container {
  transform: scale(0.65) !important;
  transform-origin: top center !important;
}

/* Scale down right-side lock/hand buttons too */
.excalidraw .layer-ui__wrapper__top-right {
  transform: scale(0.65) !important;
  transform-origin: top right !important;
}

/* Excalidraw dark mode applies filter: invert() hue-rotate() to the ENTIRE canvas,
   which inverts all element colors including strokeColor.
   Disable the filter so programmatic colors render as specified.
   See: https://github.com/excalidraw/excalidraw/issues/6669 */
.excalidraw.theme--dark .excalidraw__canvas {
  filter: none !important;
}
`

/* ─── DragHandle ─────────────────────────────────────────────── */

function DragHandle({ onDrag }: { onDrag: (delta: number) => void }) {
  const startX = useRef(0)
  const active = useRef(false)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      active.current = true
      startX.current = e.clientX
      const onMove = (ev: MouseEvent) => {
        if (!active.current) return
        const delta = ev.clientX - startX.current
        startX.current = ev.clientX
        onDrag(delta)
      }
      const onUp = () => {
        active.current = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [onDrag],
  )

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        width: 4,
        flexShrink: 0,
        cursor: 'col-resize',
        background: EMBRY.border,
        transition: 'background 0.15s',
        zIndex: 1,
        position: 'relative',
      }}
      onMouseEnter={e => {
        ;(e.currentTarget as HTMLDivElement).style.background = `${EMBRY.accent}88`
      }}
      onMouseLeave={e => {
        ;(e.currentTarget as HTMLDivElement).style.background = EMBRY.border
      }}
    />
  )
}

/* ─── ArchitectureView ───────────────────────────────────────── */

export function ArchitectureView() {
  const [projects, setProjects] = useState<ArchProject[]>(FALLBACK_PROJECTS)
  const [activeId, setActiveId] = useState<string>('')
  const [projectsLoaded, setProjectsLoaded] = useState(false)

  /* Fetch project list from API on mount */
  useEffect(() => {
    let cancelled = false
    async function loadProjects() {
      try {
        const res = await fetch('/api/architecture')
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const list: ArchProject[] = (data.architectures ?? []).map((a: { id: string; title?: string; name?: string; createdAt?: string }) => ({
          id: a.id,
          name: (a.name || a.title || a.id).replace(/^architecture:/, ''),
          createdAt: a.createdAt ?? new Date().toISOString().slice(0, 10),
        }))
        if (list.length > 0) {
          setProjects(list)
          setActiveId(list[0].id)
        } else {
          setActiveId(FALLBACK_PROJECTS[0].id)
        }
      } catch {
        setActiveId(FALLBACK_PROJECTS[0].id)
      }
      setProjectsLoaded(true)
    }
    loadProjects()
    return () => { cancelled = true }
  }, [])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [selectedElement, setSelectedElement] = useState<InspectedElement | null>(null)
  const [rightTab, setRightTab] = useState<RightTab>('properties')
  const [attachedFilesByElement, setAttachedFilesByElement] = useState<Record<string, AttachedFile[]>>({})
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [leftWidth, setLeftWidth] = useState(260)
  const [rightWidth, setRightWidth] = useState(320)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; projectId: string } | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null)
  // Track latest scene for Save to Memory (avoids prop drilling)
  const sceneRef = useRef<{ elements: readonly unknown[]; appState: Record<string, unknown> }>({
    elements: [],
    appState: {},
  })

  const activeProject = projects.find(p => p.id === activeId) ?? projects[0]
  const attachedFiles = useMemo(() => {
    if (!selectedElement) return []
    return attachedFilesByElement[selectedElement.id] ?? []
  }, [selectedElement, attachedFilesByElement])

  /* Hydrate minimal stored elements into full Excalidraw format */
  const hydrateElement = (el: Record<string, unknown>) => {
    const base = {
      version: (el.version as number) ?? 2,  // preserve version to respect strokeColor
      versionNonce: Math.floor(Math.random() * 2_000_000_000),
      seed: Math.floor(Math.random() * 2_000_000_000),
      isDeleted: false,
      fillStyle: 'solid',
      strokeWidth: 2,
      roughness: 0,
      opacity: 100,
      angle: 0,
      groupIds: [] as string[],
      roundness: { type: 3 },
      boundElements: [] as unknown[],
      link: null,
      locked: false,
      updated: Date.now(),
    }
    const merged = { ...base, ...el }
    if (el.type === 'arrow') {
      merged.points = (el.points as number[][]) ?? [[0, 0], [0, (el.height as number) ?? 60]]
      merged.lastCommittedPoint = null
      merged.startArrowhead = null
      merged.endArrowhead = 'arrow'
    }
    return merged
  }

  /* Auto-load active architecture from ArangoDB */
  const pendingLoadRef = useRef<string | null>(null)

  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    async function loadArchitecture() {
      try {
        const res = await fetch(`/api/architecture/${encodeURIComponent(activeId)}`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (cancelled) return
        const scene = typeof data === 'object' && data && typeof data.excalidraw === 'object'
          ? data.excalidraw
          : data
        if (scene?.elements?.length) {
          const hydrated = scene.elements.map((e: Record<string, unknown>) => hydrateElement(e))
          const api = excalidrawAPIRef.current
          if (api) {
            api.updateScene({ elements: hydrated })
            // Force text colors after updateScene (Excalidraw dark theme overrides strokeColor)
            setTimeout(() => {
              const els = api.getSceneElements()
              const fixed = els.map((e: Record<string, unknown>) => {
                if (e.type === 'text' && e.strokeColor !== '#ffffff') {
                  return { ...e, strokeColor: '#ffffff', version: ((e.version as number) || 1) + 1 }
                }
                return e
              })
              api.updateScene({ elements: fixed })
              api.scrollToContent(undefined, { fitToContent: true })
            }, 50)
          } else {
            pendingLoadRef.current = JSON.stringify(hydrated)
          }
        }
        // Load file attachments from API response + fetch code content
        const attachments = data?.attachments ?? data?.excalidraw?.attachments ?? {}
        if (Object.keys(attachments).length > 0) {
          const mapped: Record<string, AttachedFile[]> = {}
          for (const [elemId, paths] of Object.entries(attachments)) {
            mapped[elemId] = await Promise.all(
              (paths as string[]).map(async (p) => {
                try {
                  const r = await fetch(`/api/architecture/file-content?path=${encodeURIComponent(p)}`)
                  if (r.ok) {
                    const text = await r.text()
                    return { path: p, content: text }
                  }
                } catch { /* file read failed */ }
                return { path: p, content: `// ${p}\n// File content not available — click Files tab to attach` }
              })
            )
          }
          if (!cancelled) setAttachedFilesByElement(mapped)
        }
      } catch {
        /* daemon offline */
      }
    }
    loadArchitecture()
    return () => { cancelled = true }
  }, [activeId])

  /* Save current scene to ArangoDB via Express API */
  const handleSave = useCallback(async () => {
    if (saveStatus === 'saving') return
    setSaveStatus('saving')
    try {
      const res = await fetch(`/api/architecture/${encodeURIComponent(activeId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elements: sceneRef.current.elements,
          appState: sceneRef.current.appState,
          name: activeProject?.name ?? activeId,
        }),
      })
      const data = await res.json()
      setSaveStatus(data.saved ? 'saved' : 'error')
    } catch {
      setSaveStatus('error')
    }
    setTimeout(() => setSaveStatus('idle'), 2000)
  }, [activeId, activeProject, saveStatus])

  /* Context menu items */
  const ctxItems = useCallback(
    (projectId: string): ContextMenuItem[] => [
      {
        label: 'Rename',
        icon: <Pencil size={11} />,
        onClick: () => {
          const p = projects.find(q => q.id === projectId)
          if (p) { setRenamingId(p.id); setRenameValue(p.name) }
        },
      },
      {
        label: 'Duplicate',
        icon: <Copy size={11} />,
        onClick: () => {
          const p = projects.find(q => q.id === projectId)
          if (p) {
            const dup: ArchProject = {
              id: `arch-${Date.now()}`,
              name: `${p.name} (copy)`,
              createdAt: new Date().toISOString().slice(0, 10),
            }
            setProjects(prev => [...prev, dup])
          }
        },
      },
      { label: 'Version History', icon: <History size={11} />, onClick: () => {} },
      {
        label: 'Delete',
        icon: <Trash2 size={11} />,
        danger: true,
        onClick: () => {
          const remaining = projects.filter(p => p.id !== projectId)
          setProjects(remaining)
          if (activeId === projectId && remaining.length > 0) setActiveId(remaining[0].id)
        },
      },
    ],
    [projects, activeId],
  )

  /* Add new project */
  const addProject = useCallback(() => {
    const p: ArchProject = {
      id: `arch-${Date.now()}`,
      name: 'New Architecture',
      createdAt: new Date().toISOString().slice(0, 10),
    }
    setProjects(prev => [...prev, p])
    setActiveId(p.id)
    setRenamingId(p.id)
    setRenameValue(p.name)
  }, [])

  /* Commit rename */
  const commitRename = useCallback(() => {
    if (!renamingId) return
    if (renameValue.trim()) {
      setProjects(prev =>
        prev.map(p => (p.id === renamingId ? { ...p, name: renameValue.trim() } : p)),
      )
    }
    setRenamingId(null)
  }, [renamingId, renameValue])

  /* Drag panel widths */
  const handleLeftDrag = useCallback(
    (delta: number) => setLeftWidth(w => Math.max(160, Math.min(480, w + delta))),
    [],
  )
  const handleRightDrag = useCallback(
    (delta: number) => setRightWidth(w => Math.max(240, Math.min(520, w - delta))),
    [],
  )

  /* Excalidraw change — track selected element + update scene ref */
  const selectedElementRef = useRef<InspectedElement | null>(null)
  const handleChange = useCallback(
    (
      elements: readonly { id: string; type: string; customData?: Record<string, unknown> }[],
      appState: { selectedElementIds: Readonly<Record<string, true>> } & Record<string, unknown>,
    ) => {
      sceneRef.current = {
        elements,
        appState,
      }
      const selIds = Object.keys(appState.selectedElementIds ?? {})
      if (selIds.length === 1) {
        const el = elements.find(e => e.id === selIds[0])
        if (el && selectedElementRef.current?.id !== el.id) {
          const next = {
            id: el.id,
            type: el.type,
            customData: el.customData as ElementCustomData | undefined,
          }
          selectedElementRef.current = next
          setSelectedElement(next)
        }
      } else if (selectedElementRef.current !== null) {
        selectedElementRef.current = null
        setSelectedElement(null)
      }
    },
    [],
  )

  /* Attach file to selected element */
  const handleAddFile = useCallback(async (fileList: FileList | null) => {
    if (!selectedElement || !fileList || fileList.length === 0) return
    const nextFiles = await Promise.all(
      Array.from(fileList).map(async (file) => ({
        path: file.name,
        content: await file.text(),
      })),
    )
    setAttachedFilesByElement(prev => {
      const existing = prev[selectedElement.id] ?? []
      return {
        ...prev,
        [selectedElement.id]: [...existing, ...nextFiles],
      }
    })
  }, [selectedElement])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: EMBRY.bgDeep,
        overflow: 'hidden',
      }}
    >
      <style>{EXCALIDRAW_CSS}</style>

      {/* ── Top bar ── */}
      <div
        style={{
          height: 44,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 16px',
          background: EMBRY.bgHeader,
          borderBottom: `1px solid ${EMBRY.border}`,
          zIndex: 10,
        }}
      >
        <Map size={16} color={EMBRY.accent} />
        <span style={{ ...heading, fontSize: 13, flex: 1 }}>
          {activeProject?.name ?? 'Architecture'}
        </span>
        <AgentControl projectId={`arch-${activeId}`} />
      </div>

      {/* ── Three-panel content ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Left: project list */}
        <LeftPane title="Architecture" width={leftWidth} searchable>
          <LeftPaneSection
            title={
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <span>Projects</span>
                <button
                  onClick={addProject}
                  title="New architecture"
                  aria-label="New architecture"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: EMBRY.dim,
                    cursor: 'pointer',
                    padding: 2,
                    lineHeight: 1,
                  }}
                  onMouseEnter={e => {
                    ;(e.currentTarget as HTMLButtonElement).style.color = EMBRY.accent
                  }}
                  onMouseLeave={e => {
                    ;(e.currentTarget as HTMLButtonElement).style.color = EMBRY.dim
                  }}
                >
                  <Plus size={12} />
                </button>
              </div>
            }
          >
            {projects.map(p => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={`Select architecture: ${p.name}`}
                aria-current={activeId === p.id ? 'true' : undefined}
                onContextMenu={e => {
                  e.preventDefault()
                  setCtxMenu({ x: e.clientX, y: e.clientY, projectId: p.id })
                }}
                onClick={() => { if (renamingId !== p.id) setActiveId(p.id) }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setActiveId(p.id) }}
                style={paneItemStyle(activeId === p.id)}
              >
                {renamingId === p.id ? (
                  <input
                    value={renameValue}
                    autoFocus
                    aria-label="Rename project"
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onClick={e => e.stopPropagation()}
                    style={{
                      background: EMBRY.bgDeep,
                      border: `1px solid ${EMBRY.accent}`,
                      borderRadius: 3,
                      color: EMBRY.white,
                      fontSize: 11,
                      padding: '1px 4px',
                      width: '100%',
                      fontFamily: '"JetBrains Mono", monospace',
                      outline: 'none',
                    }}
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Brain size={10} color={activeId === p.id ? EMBRY.accent : EMBRY.dim} />
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.name}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </LeftPaneSection>
        </LeftPane>

        {/* Drag handle: left | canvas */}
        <DragHandle onDrag={handleLeftDrag} />

        {/* Center: Excalidraw canvas */}
        <div style={{
          flex: 1,
          minWidth: 0,
          position: 'relative',
          height: '100%',
          background: `#1a1a2e`,
          backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)`,
          backgroundSize: `24px 24px`,
        }}>
          <Excalidraw
            key={activeId}
            theme="dark"
            gridModeEnabled={false}
            initialData={{
              appState: {
                viewBackgroundColor: 'transparent',
                theme: 'dark',
                currentItemStrokeColor: '#ffffff',
                currentItemFontFamily: 3,
              },
            }}
            excalidrawAPI={(api) => {
              excalidrawAPIRef.current = api
              if (pendingLoadRef.current) {
                const els = JSON.parse(pendingLoadRef.current)
                pendingLoadRef.current = null
                api.updateScene({ elements: els })
                api.scrollToContent(undefined, { fitToContent: true })
              }
            }}
            // @ts-expect-error — minimal element type subset; full OrderedExcalidrawElement not required
            onChange={handleChange}
            UIOptions={{
              canvasActions: {
                saveToActiveFile: false,
                loadScene: true,
                clearCanvas: true,
                toggleTheme: false,
                changeViewBackgroundColor: false,
                export: { saveFileToDisk: true },
              },
            }}
          />
        </div>

        {/* Drag handle: canvas | right */}
        {!rightCollapsed && <DragHandle onDrag={handleRightDrag} />}

        {/* Right: element inspector */}
        <RightInspector
          element={selectedElement}
          tab={rightTab}
          onTab={setRightTab}
          files={attachedFiles}
          onAddFile={handleAddFile}
          collapsed={rightCollapsed}
          onCollapse={() => setRightCollapsed(c => !c)}
          width={rightWidth}
        />
      </div>

      {/* ── Bottom bar — shared StatusBar with undo/redo ── */}
      <StatusBar
        projectId="architecture"
        connected={true}
        connectionLabel="memory daemon"
        items={[
          { label: activeProject?.name ?? activeId },
          { label: `${sceneRef.current.elements.length} elements` },
          { label: selectedElement ? `selected: ${selectedElement.type}` : '' },
        ].filter(i => i.label)}
        rightItems={[
          { label: saveStatus === 'saving' ? '● saving…' : saveStatus === 'saved' ? '● saved' : '', color: saveStatus === 'saved' ? EMBRY.green : EMBRY.amber },
          { label: '◀ undo' },
          { label: 'redo ▶' },
        ].filter(i => i.label)}
      />

      {/* ── Context menu ── */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems(ctxMenu.projectId)}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}
