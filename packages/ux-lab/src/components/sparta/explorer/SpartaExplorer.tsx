import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { EMBRY, glowDot } from '../common/EmbryStyle'
import { AgentControl } from '../common/AgentControl'
import { ChatFab } from '../../ChatFab'

const TABS = [
  'Overview', 'Sources', 'Controls', 'URLs',
  'QRAs', 'Relationships', 'Threat Matrix', 'Pipeline',
] as const

export type TabName = (typeof TABS)[number]

interface TabPlaceholderProps { name: TabName; message?: string }
function TabPlaceholder({ name, message }: TabPlaceholderProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: EMBRY.dim }}>
      <span style={{ fontSize: 18, fontWeight: 700 }}>{name}</span>
      <span style={{ fontSize: 13, marginLeft: 8, opacity: 0.5 }}>— {message ?? 'no data available'}</span>
    </div>
  )
}

export interface SpartaExplorerProps {
  views?: Partial<Record<TabName, ReactNode>>
  /** Per-tab loading state — when true, shows a subtle loading indicator on the tab */
  loadingTabs?: Partial<Record<TabName, boolean>>
}

function tabFromHash(): TabName {
  const raw = window.location.hash.slice(1)
  const hash = decodeURIComponent(raw).toLowerCase()
  const match = TABS.find((t) => t.toLowerCase() === hash)
  return match ?? 'Overview'
}

export function SpartaExplorer({ views = {}, loadingTabs = {} }: SpartaExplorerProps) {
  const [activeTab, setActiveTab] = useState<TabName>(tabFromHash)
  const [daemonHealth, setDaemonHealth] = useState<{ ok: boolean; counts?: Record<string, number> }>({ ok: false })

  // Sync tab to URL hash
  function switchTab(tab: TabName) {
    setActiveTab(tab)
    window.location.hash = tab.toLowerCase()
  }

  // Listen for browser back/forward
  useEffect(() => {
    function onHashChange() { setActiveTab(tabFromHash()) }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Keyboard: number keys 1-8 for direct tab access
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const num = Number.parseInt(e.key)
      if (num >= 1 && num <= TABS.length) {
        switchTab(TABS[num - 1])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Periodic health check
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3001/api/health')
      const data = await res.json()
      setDaemonHealth({ ok: data.memory_daemon === 'connected', counts: data.counts })
    } catch {
      setDaemonHealth({ ok: false })
    }
  }, [])

  useEffect(() => {
    checkHealth()
    const interval = setInterval(checkHealth, 30_000)
    return () => clearInterval(interval)
  }, [checkHealth])

  // Navigate to a tab (used by child views for cross-tab linking)
  const navigateToTab = useCallback((tab: TabName) => switchTab(tab), [])

  return (
    <div style={styles.container}>
      {/* NavBar */}
      <nav style={styles.nav}>
        <div style={styles.navBrand}>
          <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: '-0.02em' }}>SPARTA</span>
          <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 6 }}>Explorer</span>
        </div>
        <div style={styles.navTabs}>
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              style={{
                ...styles.tabButton,
                color: activeTab === tab ? EMBRY.white : EMBRY.dim,
                borderBottom: activeTab === tab ? `2px solid ${EMBRY.accent}` : '2px solid transparent',
                backgroundColor: activeTab === tab ? `${EMBRY.accent}12` : 'transparent',
              }}
              title={`${tab} (${i + 1})`}
            >
              <span style={{ fontSize: 9, color: EMBRY.muted, marginRight: 3 }}>{i + 1}</span>
              {tab}
              {loadingTabs[tab] && (
                <span style={{ display: 'inline-block', width: 4, height: 4, borderRadius: '50%', backgroundColor: EMBRY.accent, marginLeft: 4, animation: 'pulse 1s infinite' }} />
              )}
            </button>
          ))}
        </div>
        <AgentControl projectId="sparta-explorer" />
      </nav>

      {/* Content area — each tab is kept mounted to preserve state */}
      <div style={styles.content}>
        {TABS.map((tab) => (
          <div
            key={tab}
            style={{
              display: activeTab === tab ? 'flex' : 'none',
              flexDirection: 'column',
              flex: 1,
              overflow: 'hidden',
            }}
          >
            {views[tab] ?? <TabPlaceholder name={tab} />}
          </div>
        ))}
      </div>

      {/* StatusBar */}
      <div style={styles.statusBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={glowDot(daemonHealth.ok ? EMBRY.green : EMBRY.red, 6)} />
          <span style={{ fontSize: 10, color: EMBRY.dim }}>
            Memory daemon: {daemonHealth.ok ? 'connected' : 'unreachable'}
          </span>
          {daemonHealth.counts && (
            <span style={{ fontSize: 10, color: EMBRY.muted }}>
              {Object.entries(daemonHealth.counts).filter(([k]) => k.startsWith('sparta_')).map(([k, v]) => `${k.replace('sparta_', '')}:${v}`).join(' · ')}
            </span>
          )}
        </div>
        <span style={{ fontSize: 10, color: EMBRY.muted }}>
          {activeTab} · Press 1-{TABS.length} to switch tabs
        </span>
      </div>

      {/* Chat overlay for natural language SPARTA queries */}
      <ChatFab />
    </div>
  )
}

// Allow child views to call navigateToTab
export { TABS }

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    overflow: 'hidden',
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 16px',
    height: 44,
    backgroundColor: EMBRY.bgHeader,
    borderBottom: `1px solid ${EMBRY.border}`,
    flexShrink: 0,
  },
  navBrand: {
    display: 'flex',
    alignItems: 'baseline',
    marginRight: 8,
    flexShrink: 0,
  },
  navTabs: {
    display: 'flex',
    gap: 0,
    overflow: 'auto',
    flex: 1,
  },
  tabButton: {
    background: 'none',
    border: 'none',
    padding: '10px 12px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    transition: 'color 0.15s, background-color 0.15s',
  },
  content: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    backgroundColor: EMBRY.bg,
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 16px',
    height: 28,
    backgroundColor: EMBRY.bgHeader,
    borderTop: `1px solid ${EMBRY.border}`,
    flexShrink: 0,
  },
}
