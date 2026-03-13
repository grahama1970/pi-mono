import { useState, useCallback } from 'react'
import { NVIS } from './theme'
import { InfiniteCanvas } from './canvas/InfiniteCanvas'
import { AgentOverlay } from './canvas/AgentOverlay'
import { Toolbar } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { PropertiesPanel } from './components/PropertiesPanel'
import { AgentPanel } from './components/AgentPanel'
import { ManifestPanel } from './components/ManifestPanel'
import { OperationLog } from './components/OperationLog'
import { CourseCorrection } from './components/CourseCorrection'
import { ExportPanel } from './components/ExportPanel'
import { StatusBar } from './components/StatusBar'
import { useKeyboardShortcuts } from './components/useKeyboardShortcuts'
import { useServerSync } from './hooks/useServerSync'
import { AnnotationView } from './components/annotation/AnnotationView'

type AppMode = 'canvas' | 'annotate'

const styles = {
  app: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100vh',
    width: '100vw',
    backgroundColor: NVIS.BG_PRIMARY,
    color: NVIS.WHITE,
    fontFamily: 'Inter, system-ui, sans-serif',
    overflow: 'hidden',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 36,
    backgroundColor: NVIS.BG_SECONDARY,
    borderBottom: `1px solid ${NVIS.DIM}`,
    padding: '0 12px',
    fontSize: 12,
    flexShrink: 0,
  },
  topBarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  brandName: {
    fontWeight: 700,
    fontSize: 14,
    color: NVIS.WHITE,
  },
  topBarButtons: {
    display: 'flex',
    gap: 4,
  },
  modeTab: {
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: 12,
    padding: '6px 12px',
    fontWeight: 600,
  },
  topButton: {
    border: 'none',
    backgroundColor: 'transparent',
    color: NVIS.DIM,
    cursor: 'pointer',
    fontSize: 11,
    padding: '4px 10px',
    borderRadius: 4,
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  canvasArea: {
    flex: 1,
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NVIS.BG_PRIMARY,
    overflow: 'hidden',
  },
  rightPanel: {
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
}

function App() {
  const [activeTool, setActiveTool] = useState('select')
  const [sidebarVisible, setSidebarVisible] = useState(false)
  const [exportVisible, setExportVisible] = useState(false)
  const [appMode, setAppMode] = useState<AppMode>('canvas')

  useKeyboardShortcuts(appMode)
  useServerSync()

  const handleToolSelect = useCallback((toolId: string) => {
    setActiveTool(toolId)
  }, [])

  return (
    <div style={styles.app}>
      {/* Top menu bar */}
      <div style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <span style={styles.brandName}>UX Lab</span>
          <button
            style={{
              ...styles.modeTab,
              color: appMode === 'canvas' ? NVIS.WHITE : NVIS.DIM,
              borderBottom: appMode === 'canvas' ? `2px solid ${NVIS.ACCENT}` : '2px solid transparent',
            }}
            onClick={() => setAppMode('canvas')}
          >
            Canvas
          </button>
          <button
            style={{
              ...styles.modeTab,
              color: appMode === 'annotate' ? NVIS.WHITE : NVIS.DIM,
              borderBottom: appMode === 'annotate' ? `2px solid ${NVIS.ACCENT}` : '2px solid transparent',
            }}
            onClick={() => setAppMode('annotate')}
          >
            Annotate
          </button>
        </div>
        <div style={styles.topBarButtons}>
          <button
            style={styles.topButton}
            onClick={() => setSidebarVisible((v) => !v)}
          >
            {sidebarVisible ? 'Hide Sidebar' : 'Sidebar'}
          </button>
          <button
            style={styles.topButton}
            onClick={() => setExportVisible(true)}
          >
            Export
          </button>
        </div>
      </div>

      {/* Main layout: mode-dependent */}
      {appMode === 'canvas' ? (
        <>
          <div style={styles.main}>
            <Toolbar activeTool={activeTool} onToolSelect={handleToolSelect} />

            <div style={styles.canvasArea}>
              <InfiniteCanvas width={1200} height={800} />
              <AgentOverlay />
            </div>

            {sidebarVisible && <Sidebar visible={sidebarVisible} />}
            <div style={styles.rightPanel}>
              <PropertiesPanel />
              <AgentPanel />
              <ManifestPanel />
            </div>
          </div>

          {/* Course correction chat well */}
          <CourseCorrection />

          {/* Operation log */}
          <OperationLog />
        </>
      ) : (
        <AnnotationView />
      )}

      {/* Status bar */}
      <StatusBar />

      {/* Export modal */}
      <ExportPanel visible={exportVisible} onClose={() => setExportVisible(false)} />
    </div>
  )
}

export default App
