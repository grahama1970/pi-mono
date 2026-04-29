/**
 * ClassifierLabView — Multi-modality classifier training pipeline.
 *
 * Pipeline: Research → Data → Tune → Train → Benchmark → Evaluate → Promote
 * Core product: live leaderboard of backbone candidates racing to meet a quality gate.
 * Reuses shared components: LeftPane, RunButton, EditModal, AgentControl, useAgentBus.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRegisterAction } from '../../../../hooks/useRegisterAction'
import { EMBRY, card, panel, label } from '../../common/EmbryStyle'
import { LeftPane, paneItemStyle, ContextMenu, useContextMenu, useLeftPaneSort } from '../../common/LeftPane'
import type { ContextMenuAction, SortMode } from '../../common/LeftPane'
import { AgentControl } from '../../common/AgentControl'
import { RerunButton } from '../../common/RerunButton'
import { useAgentBus } from '../../common/useAgentBus'

import { API, MONO, TABS } from './types'
import type { Tab, Project, TrainingRow } from './types'
import { computePreflights, PreflightBar } from './shared'
import { filterSelect, btnOutline } from './shared'

import { ResearchTab } from './ResearchTab'
import { DataTab } from './DataTab'
import { TrainTab } from './TrainTab'
import { TuneTab } from './TuneTab'
import { BenchmarkTab } from './BenchmarkTab'
import { EvaluateTab } from './EvaluateTab'
import { PromoteTab } from './PromoteTab'
import { RunButton } from '../../common/RunButton'

// ── Sorted Project List (left pane) ─────────────────────────────────

function SortedProjectList({ projects, sortFn, selectedProjectId, setSelectedProjectId, filterModality, setFilterModality, triggerContextMenu }: {
  projects: Project[]
  sortFn: (mode: SortMode, list: Project[]) => Project[]
  selectedProjectId: string
  setSelectedProjectId: (id: string) => void
  filterModality: string
  setFilterModality: (m: string) => void
  triggerContextMenu: (e: React.MouseEvent, id: string) => void
}) {
  const sortMode = useLeftPaneSort()
  const sorted = useMemo(() => sortFn(sortMode, projects), [sortMode, projects, sortFn])

  return (
    <div style={{ padding: '0 4px' }}>
      {sorted.map(p => {
        const sel = p.id === selectedProjectId
        const f1Color = !p.f1 ? EMBRY.muted : p.f1 < 0.80 ? EMBRY.red : p.f1 >= 0.90 ? EMBRY.green : EMBRY.dim
        return (
          <div key={p.id} data-qid={`clf:project:${p.id}`} data-qs-action="CLF_SELECT_PROJECT" title={`Select project ${p.name}`}
            onClick={() => setSelectedProjectId(p.id)}
            onContextMenu={e => triggerContextMenu(e, p.id)}
            style={{ ...paneItemStyle(sel), display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, fontFamily: MONO, color: sel ? EMBRY.accent : EMBRY.white }}>{p.name}</div>
              <div style={{ fontSize: 9, color: EMBRY.dim }}>
                <span data-qid={`clf:filter-modality:${p.modality}`} data-qs-action="CLF_FILTER_MODALITY" style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setFilterModality(p.modality === filterModality ? '' : p.modality) }}
                  title={`Filter by ${p.modality}`}>{p.modality}</span>, {p.classes ?? 0} cl, {(p.samples ?? 0).toLocaleString()} spl
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {p.status === 'training' ? (
                <span style={{ fontSize: 9, fontWeight: 900, color: EMBRY.amber }}>TRAINING</span>
              ) : p.status === 'halted' ? (
                <span style={{ fontSize: 9, fontWeight: 900, color: EMBRY.amber }}>HALTED</span>
              ) : p.status === 'failed' ? (
                <span style={{ fontSize: 9, fontWeight: 900, color: EMBRY.red }}>FAILED</span>
              ) : (
                <span style={{ fontSize: 11, fontWeight: 900, fontFamily: MONO, color: f1Color }}>
                  {p.f1 ? `${p.f1.toFixed(2)}` : '—'}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main View ───────────────────────────────────────────────────────

export function ClassifierLabView({ initialTab }: { initialTab?: string } = {}) {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = (initialTab || '').toLowerCase() as Tab
    return TABS.includes(t) ? t : 'data'
  })
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [trainingRows, setTrainingRows] = useState<TrainingRow[]>([])
  const [dataGatePassed, setDataGatePassed] = useState(false)
  const [researchGatePassed, setResearchGatePassed] = useState(false)
  const [researchGateInfo, setResearchGateInfo] = useState<any>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectGoal, setNewProjectGoal] = useState('')
  const [newProjectModality, setNewProjectModality] = useState('text')
  const [creating, setCreating] = useState(false)
  const [filterModality, setFilterModality] = useState<string>('')
  const [mainDataInfo, setMainDataInfo] = useState<any>(null)
  const [mainTuneConfig, setMainTuneConfig] = useState<any>(null)
  const [mainEvalData, setMainEvalData] = useState<any>(null)

  useEffect(() => {
    const t = (initialTab || '').toLowerCase() as Tab
    if (TABS.includes(t) && t !== activeTab) setActiveTab(t)
  }, [initialTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const { connected, narration } = useAgentBus((msg) => {
    if (msg.type === 'training-update' && msg.payload.projectId === selectedProjectId) {
      setTrainingRows(msg.payload.rows as TrainingRow[])
    }
  })

  const loadProjects = useCallback(() => {
    fetch(`${API}/projects/classifier-lab/projects`)
      .then(r => r.json()).then(setProjects)
      .catch(() => setProjects([]))
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects])

  useEffect(() => {
    if (!selectedProjectId && projects.length) setSelectedProjectId(projects[0].id)
  }, [projects, selectedProjectId])

  const GATED_TABS: Tab[] = ['tune', 'train', 'benchmark', 'evaluate', 'promote']
  const isTabBlocked = (t: Tab) => {
    if (!GATED_TABS.includes(t)) return false
    if (!dataGatePassed) return true
    if (!researchGatePassed) return true
    return false
  }

  useEffect(() => {
    if (!selectedProjectId) return
    fetch(`${API}/projects/classifier-lab/data/${selectedProjectId}`)
      .then(r => r.json()).then(d => { setDataGatePassed(d.gatePassed ?? false); setMainDataInfo(d) })
      .catch(() => { setDataGatePassed(false); setMainDataInfo(null) })
    fetch(`${API}/projects/classifier-lab/tune-config/${selectedProjectId}`)
      .then(r => r.json()).then(setMainTuneConfig)
      .catch(() => setMainTuneConfig(null))
    fetch(`${API}/projects/classifier-lab/eval-results/${selectedProjectId}`)
      .then(r => r.json()).then(d => { if (d && !d.error) setMainEvalData(d); else setMainEvalData(null) })
      .catch(() => setMainEvalData(null))
  }, [selectedProjectId])

  useEffect(() => {
    if (!selectedProjectId) return
    fetch(`${API}/projects/classifier-lab/research-gate/${selectedProjectId}`)
      .then(r => r.json()).then(d => { setResearchGatePassed(d.passed ?? false); setResearchGateInfo(d) })
      .catch(() => { setResearchGatePassed(false); setResearchGateInfo(null) })
  }, [selectedProjectId])

  const [benchmarkData, setBenchmarkData] = useState<any>(null)
  const loadBenchmarkData = useCallback((projectId: string) => {
    fetch(`${API}/projects/classifier-lab/benchmark-results/${projectId}`)
      .then(r => r.json()).then(setBenchmarkData)
      .catch(() => setBenchmarkData(null))
  }, [])

  useEffect(() => {
    if (!selectedProjectId) return
    loadBenchmarkData(selectedProjectId)
  }, [selectedProjectId, loadBenchmarkData])

  const sortProjects = useCallback((mode: SortMode, list: Project[]) => {
    const filtered = filterModality
      ? list.filter(p => p.modality?.toLowerCase().includes(filterModality.toLowerCase()))
      : list
    const sorted = [...filtered]
    if (mode === 'score') {
      sorted.sort((a, b) => (b.f1 ?? 0) - (a.f1 ?? 0))
    } else if (mode === 'alpha') {
      sorted.sort((a, b) => a.name.localeCompare(b.name))
    } else {
      sorted.sort((a, b) => {
        const aT = a.status === 'trained' || a.f1 ? 1 : 0
        const bT = b.status === 'trained' || b.f1 ? 1 : 0
        if (aT !== bT) return bT - aT
        if (aT && bT) return (b.f1 ?? 0) - (a.f1 ?? 0)
        return a.name.localeCompare(b.name)
      })
    }
    return sorted
  }, [filterModality])

  const activeProject = useMemo(
    () => projects.find(p => p.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  )

  const displayRows: TrainingRow[] = useMemo(() => {
    if (trainingRows.length) return trainingRows
    if (!benchmarkData?.results) return []
    return benchmarkData.results.map((r: any, i: number) => ({
      rank: i + 1, backbone: r.backbone, lr: '-', bs: 0,
      f1: r.macro_f1 || 0, acc: r.accuracy || 0,
      latency: '-', cost: 'FREE',
      status: (r.macro_f1 || 0) >= 0.90 ? 'pass' as const : 'fail' as const,
    }))
  }, [trainingRows, benchmarkData])

  const benchmarkRows = useMemo(() => {
    if (!benchmarkData?.results) return []
    return benchmarkData.results.map((r: any) => ({
      name: r.backbone, f1: r.macro_f1 || 0, acc: r.accuracy || 0,
      wilson: r.wilson_score_lower || 0, lat50: 0, lat95: 0,
      params: 0, time: '-', rounds: Number(r.rounds || 0),
      winner: benchmarkData.selected_backbone === r.backbone,
    }))
  }, [benchmarkData])

  const deleteProject = useCallback((id: string) => {
    if (!confirm(`Delete project "${id}"? This removes the data directory.`)) return
    fetch(`${API}/projects/classifier-lab/projects/${id}`, { method: 'DELETE' })
      .then(() => { loadProjects(); if (selectedProjectId === id) setSelectedProjectId('') })
      .catch(() => {})
  }, [selectedProjectId, loadProjects])

  const handleContextAction = useCallback((itemId: string, action: ContextMenuAction) => {
    if (action === 'delete') deleteProject(itemId)
    else if (action === 'rename') {
      const newName = prompt(`Rename "${itemId}" to:`, itemId)
      if (newName && newName !== itemId) {
        console.log(`Rename ${itemId} → ${newName} (not yet implemented)`)
      }
    } else if (action === 'copy') {
      navigator.clipboard.writeText(itemId)
    }
  }, [deleteProject])

  const { menuProps, triggerContextMenu } = useContextMenu(handleContextAction)

  // ── QuerySpec action registrations ──────────────────────────────
  const APP = 'classifier-lab'
  useRegisterAction('clf:create', { app: APP, action: 'CLF_CREATE_PROJECT', label: 'Create Project', description: 'Create a new classifier project with goal and modality' })
  useRegisterAction('clf:tab', { app: APP, action: 'CLF_SWITCH_TAB', label: 'Switch Tab', description: 'Switch between pipeline tabs: research, data, tune, train, benchmark, evaluate, promote', params: { tab: { type: 'string' } } })
  useRegisterAction('clf:btn', { app: APP, action: 'CLF_NEW_CLASSIFIER', label: 'New Classifier', description: 'Open the create new classifier dialog' })
  useRegisterAction('clf:project-name', { app: APP, action: 'CLF_SET_PROJECT_NAME', label: 'Set Project Name', description: 'Set the name for a new classifier project', params: { name: { type: 'string' } } })
  useRegisterAction('clf:project-goal', { app: APP, action: 'CLF_SET_PROJECT_GOAL', label: 'Set Project Goal', description: 'Describe what the classifier should do', params: { goal: { type: 'string' } } })
  useRegisterAction('clf:modality', { app: APP, action: 'CLF_SET_MODALITY', label: 'Set Modality', description: 'Set input modality: text, vision, or tabular', params: { modality: { type: 'string' } } })
  useRegisterAction('clf:cancel', { app: APP, action: 'CLF_CANCEL_CREATE', label: 'Cancel', description: 'Cancel project creation dialog' })

  const createProject = useCallback(async () => {
    const name = newProjectName.trim().replace(/[^a-z0-9-]/gi, '-').toLowerCase()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch(`${API}/projects/classifier-lab/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, goal: newProjectGoal.trim(), modality: newProjectModality }),
      })
      const data = await res.json()
      if (data.status === 'CREATED') {
        loadProjects()
        setSelectedProjectId(data.id || name)
        setActiveTab('research')
        setShowCreateDialog(false)
        setNewProjectName('')
        setNewProjectGoal('')
        setNewProjectModality('text')
      }
    } catch { /* */ }
    setCreating(false)
  }, [newProjectName, newProjectGoal, newProjectModality, loadProjects])

  if (!projects.length && !showCreateDialog) return (
    <div style={{ background: EMBRY.bg, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ color: EMBRY.dim, fontSize: 13 }}>No classifier projects found.</div>
      <button data-qid="clf:create" data-qs-action="CLF_CREATE_PROJECT" title="Create your first classifier project" onClick={() => setShowCreateDialog(true)} style={{
        background: EMBRY.accent, border: 'none', color: EMBRY.white,
        padding: '10px 24px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
      }}>+ CREATE FIRST CLASSIFIER</button>
    </div>
  )

  return (
    <div data-qid="clf:root" style={{ display: 'flex', height: '100%', background: EMBRY.bg, color: EMBRY.white, fontFamily: 'Inter, sans-serif' }}>
      {menuProps && <ContextMenu {...menuProps} />}
      {/* Left pane */}
      <LeftPane title="CLASSIFIER LAB" searchable sortable
        activeFilter={filterModality || undefined}
        onClearFilter={() => setFilterModality('')}>
        <SortedProjectList projects={projects} sortFn={sortProjects}
          selectedProjectId={selectedProjectId} setSelectedProjectId={setSelectedProjectId}
          filterModality={filterModality} setFilterModality={setFilterModality}
          triggerContextMenu={triggerContextMenu} />
        <div style={{ padding: 12, borderTop: `1px solid ${EMBRY.border}`, marginTop: 'auto' }}>
          <button data-qid="clf:btn" data-qs-action="CLF_NEW_CLASSIFIER" title="Create a new classifier project" style={{
            width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px dashed ${EMBRY.border}`,
            color: EMBRY.dim, padding: 8, borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer',
          }} onClick={() => setShowCreateDialog(true)}>+ NEW CLASSIFIER</button>
        </div>
      </LeftPane>

      {/* Create project dialog */}
      {showCreateDialog && (
        <div data-qid="classifier-lab:modal:create-backdrop" data-qs-action="CLOSE_CLASSIFIER_CREATE_MODAL" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setShowCreateDialog(false)}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, width: 480, padding: 32 }}>
            <div style={{ ...label, fontSize: 16, fontWeight: 900, marginBottom: 16 }}>New Classifier Project</div>
            <div style={{ ...label, marginBottom: 6 }}>PROJECT NAME</div>
            <input data-qid="clf:project-name" data-qs-action="CLF_SET_PROJECT_NAME" title="Project name (lowercase, hyphens)" value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
              placeholder="e.g. email-spam-detection, sentiment-analysis"
              autoFocus
              style={{
                width: '100%', background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`,
                borderRadius: 4, padding: '10px 12px', color: EMBRY.white, fontSize: 12,
                fontFamily: MONO, outline: 'none', boxSizing: 'border-box',
              }} />
            <div style={{ ...label, marginBottom: 6, marginTop: 14 }}>WHAT SHOULD THIS CLASSIFIER DO?</div>
            <textarea data-qid="clf:project-goal" data-qs-action="CLF_SET_PROJECT_GOAL" title="Describe what this classifier should do" value={newProjectGoal} onChange={e => setNewProjectGoal(e.target.value)}
              placeholder="e.g. Classify customer emails as spam or not spam. Detect phishing attempts in incoming messages."
              rows={3}
              style={{
                width: '100%', background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`,
                borderRadius: 4, padding: '10px 12px', color: EMBRY.white, fontSize: 11,
                fontFamily: MONO, outline: 'none', boxSizing: 'border-box', resize: 'vertical',
              }} />
            <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ ...label, marginBottom: 6 }}>MODALITY</div>
                <select data-qid="clf:modality" data-qs-action="CLF_SET_MODALITY" title="Select input modality: text, vision, or tabular" value={newProjectModality} onChange={e => setNewProjectModality(e.target.value)}
                  style={{ ...filterSelect, width: '100%', padding: '10px 12px' }}>
                  <option value="text">Text</option>
                  <option value="vision">Vision (images)</option>
                  <option value="tabular">Tabular (structured data)</option>
                </select>
              </div>
            </div>
            <div style={{ fontSize: 9, color: EMBRY.muted, marginTop: 8 }}>
              The agent will run /dogpile to research backbones, search HuggingFace for training data, and seed the project.
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end' }}>
              <button data-qid="clf:cancel" data-qs-action="CLF_CANCEL_CREATE" title="Cancel project creation" onClick={() => setShowCreateDialog(false)}
                style={{ ...btnOutline, padding: '8px 16px' }}>CANCEL</button>
              <RunButton data-qid="clf:create" data-qs-action="CLF_CREATE_PROJECT" title="Create the classifier project and run kickoff research" onClick={createProject} disabled={!newProjectName.trim() || creating}>
                {creating ? 'CREATING...' : 'CREATE PROJECT'}
              </RunButton>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header with pipeline tabs */}
        <header style={{
          height: 48, borderBottom: `1px solid ${EMBRY.border}`, background: EMBRY.bgPanel,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingLeft: 20, paddingRight: 16, flexShrink: 0,
        }}>
          <nav style={{ display: 'flex', gap: 24, height: '100%', alignItems: 'stretch' }}>
            {TABS.map(t => {
              const blocked = isTabBlocked(t)
              return (
                <button data-qid={`clf:tab:${t}`} data-qs-action="CLF_SWITCH_TAB" key={t}
                  onClick={() => { if (!blocked) { setActiveTab(t); window.location.hash = `classifier-lab/${t}` } }}
                  title={blocked ? (!researchGatePassed ? 'Research gate: run /dogpile first' : 'Data gate: need ≥200 samples per class') : `Switch to ${t} tab`}
                  style={{
                    background: 'none', border: 'none',
                    borderBottom: activeTab === t ? `2px solid ${EMBRY.accent}` : '2px solid transparent',
                    color: blocked ? EMBRY.muted : activeTab === t ? EMBRY.white : EMBRY.dim,
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
                    cursor: blocked ? 'not-allowed' : 'pointer', padding: '0 4px',
                    display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s',
                    opacity: blocked ? 0.4 : 1,
                  }}>
                  {t}
                  {blocked && <span style={{ fontSize: 8, color: EMBRY.red }}>●</span>}
                </button>
              )
            })}
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <RerunButton
              projectId={selectedProjectId}
              disabled={!selectedProjectId}
              onRerun={() => {
                setTrainingRows([])
                if (selectedProjectId) loadBenchmarkData(selectedProjectId)
              }}
            />
            <AgentControl projectId="classifier-lab" />
          </div>
        </header>

        {/* Tab content */}
        <main data-qid="clf:main" style={{ flex: 1, overflowY: 'auto', padding: 28 }}>
          {activeTab !== 'research' && activeTab !== 'data' && (
            <PreflightBar checks={computePreflights(activeTab, activeProject, mainDataInfo, mainTuneConfig, displayRows, benchmarkData, mainEvalData)} />
          )}
          {activeTab === 'research' && <ResearchTab projectId={selectedProjectId} gateInfo={researchGateInfo} />}
          {activeTab === 'data' && <DataTab project={activeProject} onGateChange={setDataGatePassed} />}
          {activeTab === 'train' && <TrainTab project={activeProject} rows={displayRows} />}
          {activeTab === 'tune' && <TuneTab project={activeProject} />}
          {activeTab === 'benchmark' && <BenchmarkTab project={activeProject} data={benchmarkRows} />}
          {activeTab === 'evaluate' && <EvaluateTab project={activeProject} />}
          {activeTab === 'promote' && <PromoteTab project={activeProject} />}
        </main>
      </div>
    </div>
  )
}
