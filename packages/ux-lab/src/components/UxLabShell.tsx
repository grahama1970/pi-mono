/**
 * UX Lab Shell — project navigator + content area
 * Converted from Stitch design (project 5752752744733317670)
 * Design system: Tactical HUD (0px radius, NVIS colors, Space Grotesk + JetBrains Mono)
 */
import { useState } from 'react'
import { SpartaExplorer } from './sparta/explorer/SpartaExplorer'
import { OverviewView } from './sparta/explorer/OverviewView'
import { SourcesView } from './sparta/explorer/SourcesView'
import { ControlsView } from './sparta/explorer/ControlsView'
import { URLsView } from './sparta/explorer/URLsView'
import { QRAsView } from './sparta/explorer/QRAsView'
import { RelationshipsView } from './sparta/explorer/RelationshipsView'
import { ThreatMatrixView } from './sparta/explorer/ThreatMatrixView'
import { PipelineView } from './sparta/explorer/PipelineView'
import { PromptLabView } from './sparta/explorer/PromptLabView'
import { MusicLabWorkbench } from './music-lab/MusicLabWorkbench'
import { ChatWell } from './ChatWell'

type ProjectId = 'sparta' | 'music-lab' | 'prompt-lab'
type TabId = 'mockups' | 'components' | 'design-board' | 'reviews'

const PROJECTS = [
  { id: 'sparta' as ProjectId, label: 'SPARTA Explorer', icon: 'query_stats' },
  { id: 'music-lab' as ProjectId, label: 'Music Lab Pipeline', icon: 'settings_input_component' },
  { id: 'prompt-lab' as ProjectId, label: 'Prompt Lab', icon: 'terminal' },
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
          <button className="w-full flex items-center gap-3 px-4 py-2 text-slate-400 hover:text-white transition-colors">
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
            <button className="p-2 text-slate-400 hover:bg-white/5 transition-all">
              <span className="material-symbols-outlined text-sm">notifications</span>
            </button>
            <button className="bg-primary text-white px-4 py-1.5 flex items-center gap-2 hover:bg-primary/80 transition-all active:scale-95 text-xs font-bold uppercase tracking-widest font-headline">
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
                Overview: <OverviewView />,
                Sources: <SourcesView />,
                Controls: <ControlsView />,
                URLs: <URLsView />,
                QRAs: <QRAsView />,
                Relationships: <RelationshipsView />,
                'Threat Matrix': <ThreatMatrixView />,
                Pipeline: <PipelineView />,
                'Prompt Lab': <PromptLabView />,
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

      <ChatWell />
    </div>
  )
}
