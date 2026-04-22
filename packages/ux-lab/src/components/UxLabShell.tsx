/**
 * UX Lab Shell — project navigator + content area
 * Converted from Stitch design (project 5752752744733317670)
 * Design system: Tactical HUD (0px radius, NVIS colors, Space Grotesk + JetBrains Mono)
 */
import { useState, useMemo } from 'react'
import type { ChatMessage } from './shared-chat/ChatWell'
import { SpartaExplorer } from './sparta/explorer/SpartaExplorer'
import { SourcesView } from './sparta/explorer/SourcesView'
import { ControlsView } from './sparta/explorer/ControlsView'
import { URLsView } from './sparta/explorer/URLsView'
import { QRAsView } from './sparta/explorer/QRAsView'
import { ThreatMatrixView } from './sparta/explorer/ThreatMatrixView'
import { SupplyChainView } from './sparta/explorer/SupplyChainView'
import { MusicLabWorkbench } from './music-lab/MusicLabWorkbench'
import { PromptLabView } from './sparta/explorer/PromptLabView'
import { ChatWell } from './ChatWell'
import { useRegisterAction } from '../hooks/useRegisterAction'

type ProjectId = 'sparta' | 'music-lab' | 'prompt-lab' | 'datalake-explorer'
type TabId = 'mockups' | 'components' | 'design-board' | 'reviews'

const PROJECTS = [
  { id: 'sparta' as ProjectId, label: 'SPARTA Explorer', icon: 'query_stats' },
  { id: 'music-lab' as ProjectId, label: 'Music Lab Pipeline', icon: 'settings_input_component' },
  { id: 'prompt-lab' as ProjectId, label: 'Prompt Lab', icon: 'terminal' },
  { id: 'datalake-explorer' as ProjectId, label: 'Datalake Explorer', icon: 'description' },
]

const TABS: { id: TabId; label: string }[] = [
  { id: 'mockups', label: 'Mockups' },
  { id: 'components', label: 'Components' },
  { id: 'design-board', label: 'Design Board' },
  { id: 'reviews', label: 'Reviews' },
]

export function UxLabShell() {
  const [activeProject, setActiveProject] = useState<ProjectId>('music-lab')
  const [activeTab, setActiveTab] = useState<TabId>('mockups')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const emptyMessages = useMemo<ChatMessage[]>(() => [], [])

  useRegisterAction('shell:button:sidebar-toggle', { app: 'ux-lab', action: 'TOGGLE_SIDEBAR', label: 'Toggle Sidebar', description: 'Collapse or expand the sidebar' })
  useRegisterAction('shell:button:project-select', { app: 'ux-lab', action: 'SELECT_PROJECT', label: 'Select Project', description: 'Switch to a different project workspace' })
  useRegisterAction('shell:button:settings', { app: 'ux-lab', action: 'OPEN_SETTINGS', label: 'Open Settings', description: 'Open UX Lab settings' })
  useRegisterAction('shell:button:tab-select', { app: 'ux-lab', action: 'SELECT_TAB', label: 'Select Tab', description: 'Switch between main view tabs' })
  useRegisterAction('shell:button:notifications', { app: 'ux-lab', action: 'OPEN_NOTIFICATIONS', label: 'Notifications', description: 'View latest alerts' })
  useRegisterAction('shell:button:deploy', { app: 'ux-lab', action: 'DEPLOY_PROJECT', label: 'Deploy', description: 'Deploy the current project' })

  const sidebarWidth = sidebarCollapsed ? 48 : 240

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-slate-200 flex">
      {/* ── Sidebar ── */}
      <aside
        className="h-full flex flex-col bg-surface-low border-r border-white/10 flex-shrink-0 transition-all duration-200"
        style={{ width: sidebarWidth }}
      >
        {/* Brand */}
        <div className="h-14 flex items-center px-4 border-b border-white/10 gap-3">
          <button
            data-qid="shell:button:sidebar-toggle"
            data-qs-action="TOGGLE_SIDEBAR"
            title="Toggle Sidebar"
            onClick={() => setSidebarCollapsed(v => !v)}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined text-sm">
              {sidebarCollapsed ? 'menu' : 'menu_open'}
            </span>
          </button>
          {!sidebarCollapsed && (
            <div className="flex flex-col">
              <span className="text-primary font-bold tracking-tighter text-lg uppercase font-headline">
                UX Lab
              </span>
              <span className="text-[9px] text-slate-500 font-mono tracking-widest uppercase -mt-1">
                v1.0 · Embry OS
              </span>
            </div>
          )}
        </div>

        {/* Projects */}
        <nav className="flex-1 py-4 space-y-1 overflow-y-auto">
          {PROJECTS.map(p => (
            <button
              key={p.id}
              data-qid={`shell:button:project-select`}
              data-qs-action="SELECT_PROJECT"
              title={`Switch to ${p.label}`}
              onClick={() => setActiveProject(p.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ${
                activeProject === p.id
                  ? 'text-primary border-l-4 border-primary bg-surface-high font-bold'
                  : 'text-slate-400 border-l-4 border-transparent hover:text-slate-100 hover:bg-surface-high'
              }`}
            >
              <span className="material-symbols-outlined text-sm">{p.icon}</span>
              {!sidebarCollapsed && <span className="text-sm truncate">{p.label}</span>}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/10 py-3">
          <button 
            data-qid="shell:button:settings"
            data-qs-action="OPEN_SETTINGS"
            title="Settings"
            className="w-full flex items-center gap-3 px-4 py-2 text-slate-400 hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined text-sm">settings</span>
            {!sidebarCollapsed && <span className="text-sm">Settings</span>}
          </button>
        </div>
      </aside>

      {/* ── Main Area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar with tabs */}
        <header className="h-14 bg-surface-low/80 backdrop-blur-md border-b border-white/10 flex justify-between items-center px-6 flex-shrink-0">
          <div className="flex h-full gap-8">
            {TABS.map(tab => (
              <button
                key={tab.id}
                data-qid={`shell:button:tab-select`}
                data-qs-action="SELECT_TAB"
                title={`Select ${tab.label}`}
                onClick={() => setActiveTab(tab.id)}
                className={`h-full flex items-center text-xs font-headline font-medium uppercase tracking-widest transition-all ${
                  activeTab === tab.id
                    ? 'text-primary border-b-2 border-primary'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button 
              data-qid="shell:button:notifications"
              data-qs-action="OPEN_NOTIFICATIONS"
              title="Notifications"
              className="p-2 text-slate-400 hover:bg-white/5 transition-all"
            >
              <span className="material-symbols-outlined text-sm">notifications</span>
            </button>
            <button 
              data-qid="shell:button:deploy"
              data-qs-action="DEPLOY_PROJECT"
              title="Deploy Project"
              className="bg-primary text-white px-4 py-1.5 flex items-center gap-2 hover:bg-primary/80 transition-all active:scale-95 text-xs font-bold uppercase tracking-widest font-headline"
            >
              <span className="material-symbols-outlined text-sm">rocket_launch</span>
              Deploy
            </button>
          </div>
        </header>

        {/* Content area — renders active project */}
        <main className="flex-1 overflow-hidden">
          {activeTab === 'mockups' && activeProject === 'sparta' && (
            <SpartaExplorer
              views={{
                Sources: <SourcesView />,
                Controls: <ControlsView />,
                URLs: <URLsView />,
                QRAs: <QRAsView />,
                'Threat Matrix': <ThreatMatrixView />,
                'Supply Chain': <SupplyChainView />,
              }}
            />
          )}
          {activeTab === 'mockups' && activeProject === 'music-lab' && <MusicLabWorkbench />}
          {activeTab === 'mockups' && activeProject === 'prompt-lab' && <PromptLabView />}

          {activeTab === 'components' && (
            <div className="p-8 text-slate-500 font-mono text-sm">
              Components view — list of React files with build status
            </div>
          )}
          {activeTab === 'design-board' && (
            <div className="p-8 text-slate-500 font-mono text-sm">
              Design Board — iteration rounds with comparison PNGs
            </div>
          )}
          {activeTab === 'reviews' && (
            <div className="p-8 text-slate-500 font-mono text-sm">
              Reviews — VLM visual diff (mockup vs implementation)
            </div>
          )}
        </main>
      </div>

      <ChatWell messages={emptyMessages} />
    </div>
  )
}
