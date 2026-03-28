/**
 * ClassifierLabView — Multi-modality classifier training pipeline.
 *
 * Pipeline: Research → Data → Tune → Train → Benchmark → Evaluate → Promote
 * Core product: live leaderboard of backbone candidates racing to meet a quality gate.
 * Reuses shared components: LeftPane, RunButton, EditModal, AgentControl, useAgentBus.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  AlertTriangle, Cpu, ShieldCheck, Rocket,
  ChevronDown, ChevronRight, FileText, Search,
} from 'lucide-react'
import { marked } from 'marked'
import {
  useReactTable, getCoreRowModel,
  flexRender, createColumnHelper,
  type SortingState, type PaginationState,
} from '@tanstack/react-table'
import { EMBRY, label, heading, body, card, panel, glowDot } from '../common/EmbryStyle'
import { LeftPane, paneItemStyle, ContextMenu, useContextMenu, useLeftPaneSort } from '../common/LeftPane'
import type { ContextMenuAction, SortMode } from '../common/LeftPane'
import { ImageThumb } from '../common/ImageLightbox'
import { AgentControl } from '../common/AgentControl'
import { RunButton } from '../common/RunButton'
import { RerunButton } from '../common/RerunButton'
import { useAgentBus } from '../common/useAgentBus'

const API = 'http://localhost:3001/api'
const MONO = '"JetBrains Mono", "SF Mono", monospace'

// ── Types ───────────────────────────────────────────────────────────

interface Project {
  id: string; name: string; modality: string; status: string
  f1?: number; samples: number; classes: number
}

interface TrainingRow {
  rank: number; backbone: string; lr: string; bs: number
  f1: number; acc: number; latency: string; cost: string
  status: 'pass' | 'fail' | 'training' | 'queued'; progress?: number
}

interface BenchmarkRow {
  name: string
  f1: number
  acc: number
  wilson: number
  rounds: number
  lat50: number
  lat95: number
  params: number
  time: string
  winner?: boolean
}

interface BenchmarkBackboneCandidate {
  backbone?: string
}

interface BenchmarkTrainConfigResponse {
  gate_f1?: number
  max_rounds?: number
  max_train_samples?: number
  backbones?: string[]
  results?: BenchmarkBackboneCandidate[]
}

type Tab = 'research' | 'data' | 'tune' | 'train' | 'benchmark' | 'evaluate' | 'promote'
const TABS: Tab[] = ['research', 'data', 'tune', 'train', 'benchmark', 'evaluate', 'promote']

// No mock data — all tabs fetch from real API endpoints

// ── Main View ───────────────────────────────────────────────────────

export function ClassifierLabView() {
  const [activeTab, setActiveTab] = useState<Tab>('data')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [trainingRows, setTrainingRows] = useState<TrainingRow[]>([])
  const [dataGatePassed, setDataGatePassed] = useState(false)
  const [researchGatePassed, setResearchGatePassed] = useState(false)
  const [researchGateInfo, setResearchGateInfo] = useState<any>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [creating, setCreating] = useState(false)
  const [filterModality, setFilterModality] = useState<string>('')

  // Agent bus for live training telemetry
  const { connected, narration } = useAgentBus((msg) => {
    if (msg.type === 'training-update' && msg.payload.projectId === selectedProjectId) {
      setTrainingRows(msg.payload.rows as TrainingRow[])
    }
  })

  // Load projects from real API
  const loadProjects = useCallback(() => {
    fetch(`${API}/projects/classifier-lab/projects`)
      .then(r => r.json()).then(setProjects)
      .catch(() => setProjects([]))
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects])

  // Auto-select first project
  useEffect(() => {
    if (!selectedProjectId && projects.length) setSelectedProjectId(projects[0].id)
  }, [projects, selectedProjectId])

  // Tabs that require BOTH research AND data gates to pass
  const GATED_TABS: Tab[] = ['tune', 'train', 'benchmark', 'evaluate', 'promote']
  const isTabBlocked = (t: Tab) => {
    if (!GATED_TABS.includes(t)) return false
    if (!dataGatePassed) return true
    if (!researchGatePassed) return true
    return false
  }

  // Check data gate on project change
  useEffect(() => {
    if (!selectedProjectId) return
    fetch(`${API}/projects/classifier-lab/data/${selectedProjectId}`)
      .then(r => r.json()).then(d => setDataGatePassed(d.gatePassed ?? false))
      .catch(() => setDataGatePassed(false))
  }, [selectedProjectId])

  // Check research gate on project change
  useEffect(() => {
    if (!selectedProjectId) return
    fetch(`${API}/projects/classifier-lab/research-gate/${selectedProjectId}`)
      .then(r => r.json()).then(d => { setResearchGatePassed(d.passed ?? false); setResearchGateInfo(d) })
      .catch(() => { setResearchGatePassed(false); setResearchGateInfo(null) })
  }, [selectedProjectId])

  // Load benchmark results when project changes
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

  // Sort + filter projects — sorting driven by shared LeftPane sort context
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
      // recent: trained projects first (by F1 desc), then rest alphabetically
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

  // Build train rows from real benchmark data
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

  // Build benchmark rows from real data
  const benchmarkRows = useMemo(() => {
    if (!benchmarkData?.results) return []
    return benchmarkData.results.map((r: any) => ({
      name: r.backbone, f1: r.macro_f1 || 0, acc: r.accuracy || 0,
      wilson: r.wilson_score_lower || 0, lat50: 0, lat95: 0,
      params: 0, time: '-', rounds: Number(r.rounds || 0),
      winner: benchmarkData.selected_backbone === r.backbone,
    }))
  }, [benchmarkData])

  // Delete project
  const deleteProject = useCallback((id: string) => {
    if (!confirm(`Delete project "${id}"? This removes the data directory.`)) return
    fetch(`${API}/projects/classifier-lab/projects/${id}`, { method: 'DELETE' })
      .then(() => { loadProjects(); if (selectedProjectId === id) setSelectedProjectId('') })
      .catch(() => {})
  }, [selectedProjectId, loadProjects])

  // Right-click context menu for left pane items
  const handleContextAction = useCallback((itemId: string, action: ContextMenuAction) => {
    if (action === 'delete') deleteProject(itemId)
    else if (action === 'rename') {
      const newName = prompt(`Rename "${itemId}" to:`, itemId)
      if (newName && newName !== itemId) {
        // Rename is a data dir rename on the server — would need a new endpoint
        // For now just log it
        console.log(`Rename ${itemId} → ${newName} (not yet implemented)`)
      }
    } else if (action === 'copy') {
      navigator.clipboard.writeText(itemId)
    }
  }, [deleteProject])

  const { menuProps, triggerContextMenu } = useContextMenu(handleContextAction)

  // Create new project
  const createProject = useCallback(async () => {
    const name = newProjectName.trim().replace(/[^a-z0-9-]/gi, '-').toLowerCase()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch(`${API}/projects/classifier-lab/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (data.status === 'CREATED') {
        loadProjects()
        setSelectedProjectId(name)
        setActiveTab('research')
        setShowCreateDialog(false)
        setNewProjectName('')
      }
    } catch { /* */ }
    setCreating(false)
  }, [newProjectName, loadProjects])

  if (!projects.length && !showCreateDialog) return (
    <div style={{ background: EMBRY.bg, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ color: EMBRY.dim, fontSize: 13 }}>No classifier projects found.</div>
      <button onClick={() => setShowCreateDialog(true)} style={{
        background: EMBRY.accent, border: 'none', color: EMBRY.white,
        padding: '10px 24px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
      }}>+ CREATE FIRST CLASSIFIER</button>
    </div>
  )

  return (
    <div data-testid="classifier-lab" style={{ display: 'flex', height: '100%', background: EMBRY.bg, color: EMBRY.white, fontFamily: 'Inter, sans-serif' }}>
      {menuProps && <ContextMenu {...menuProps} />}
      {/* Left pane — classifier project list */}
      <LeftPane title="CLASSIFIER LAB" searchable sortable
        activeFilter={filterModality || undefined}
        onClearFilter={() => setFilterModality('')}>
        <SortedProjectList projects={projects} sortFn={sortProjects}
          selectedProjectId={selectedProjectId} setSelectedProjectId={setSelectedProjectId}
          filterModality={filterModality} setFilterModality={setFilterModality}
          triggerContextMenu={triggerContextMenu} />
        <div style={{ padding: 12, borderTop: `1px solid ${EMBRY.border}`, marginTop: 'auto' }}>
          <button style={{
            width: '100%', background: 'rgba(255,255,255,0.03)', border: `1px dashed ${EMBRY.border}`,
            color: EMBRY.dim, padding: 8, borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer',
          }} onClick={() => setShowCreateDialog(true)}>+ NEW CLASSIFIER</button>
        </div>
      </LeftPane>

      {/* Create project dialog */}
      {showCreateDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setShowCreateDialog(false)}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, width: 400, padding: 32 }}>
            <div style={{ ...heading, marginBottom: 16 }}>New Classifier Project</div>
            <div style={{ ...label, marginBottom: 6 }}>PROJECT NAME</div>
            <input value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createProject()}
              placeholder="e.g. leaf-disease, table-structure, intent-clf"
              autoFocus
              style={{
                width: '100%', background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`,
                borderRadius: 4, padding: '10px 12px', color: EMBRY.white, fontSize: 12,
                fontFamily: MONO, outline: 'none', boxSizing: 'border-box',
              }} />
            <div style={{ fontSize: 9, color: EMBRY.muted, marginTop: 6 }}>
              Alphanumeric and hyphens only. Data will be stored at /classifier-lab/data/{'{name}'}/
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreateDialog(false)}
                style={{ ...btnOutline, padding: '8px 16px' }}>CANCEL</button>
              <RunButton onClick={createProject} disabled={!newProjectName.trim() || creating}>
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
                <button key={t} data-testid={`clf-tab-${t}`}
                  onClick={() => { if (!blocked) setActiveTab(t) }}
                  title={blocked ? (!researchGatePassed ? 'Research gate: run /dogpile first' : 'Data gate: need ≥200 samples per class') : ''}
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
        <main data-testid="clf-main" style={{ flex: 1, overflowY: 'auto', padding: 28 }}>
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

// ── Research Tab ─────────────────────────────────────────────────────

function ResearchTab({ projectId, gateInfo }: { projectId: string; gateInfo?: any }) {
  const [md, setMd] = useState('')
  const [source, setSource] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/projects/classifier-lab/research/${projectId}`)
      .then(r => r.json())
      .then(d => {
        if (d.markdown) { setMd(d.markdown); setSource(d.source || '') }
        else { setMd(''); setSource('') }
        setLoading(false)
      })
      .catch(() => { setMd(''); setLoading(false) })
  }, [projectId])

  if (loading) return <div style={{ color: EMBRY.dim, padding: 40 }}>Loading research...</div>

  if (!md) return (
    <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
      <div style={card}>
        <div style={{ padding: 40 }}>
          <FileText size={32} color={EMBRY.dim} style={{ marginBottom: 12 }} />
          <div style={{ ...heading, color: EMBRY.dim, marginBottom: 8 }}>NO RESEARCH OUTPUT</div>
          <div style={{ ...body, fontSize: 12, color: EMBRY.muted }}>
            Run <code style={{ color: EMBRY.accent, fontFamily: MONO }}>/dogpile</code> to research optimal backbones for this task.
          </div>
          <div style={{ marginTop: 16, fontSize: 10, color: EMBRY.dim }}>
            Output will be saved to <code style={{ fontFamily: MONO, fontSize: 9 }}>data/{projectId}/research.md</code>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <style>{MD_CSS}</style>
      {/* Research gate status */}
      {gateInfo && (
        <div style={{
          ...panel, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12,
          border: `1px solid ${gateInfo.passed ? EMBRY.green : EMBRY.red}33`,
          background: `${gateInfo.passed ? EMBRY.green : EMBRY.red}08`,
        }}>
          {gateInfo.passed
            ? <ShieldCheck size={14} color={EMBRY.green} />
            : <AlertTriangle size={14} color={EMBRY.red} />}
          <span style={{ fontSize: 10, fontWeight: 700, color: gateInfo.passed ? EMBRY.green : EMBRY.red }}>
            RESEARCH GATE {gateInfo.passed ? 'PASSED' : 'FAILED'}
          </span>
          {gateInfo.hash && (
            <span style={{ fontSize: 9, color: EMBRY.muted, fontFamily: MONO, marginLeft: 'auto' }}>
              SHA: {gateInfo.hash} · {gateInfo.lineCount} lines
              {gateInfo.memoryVerified && ' · ✓ /memory verified'}
            </span>
          )}
          {!gateInfo.passed && (
            <span style={{ fontSize: 9, color: EMBRY.red, marginLeft: 'auto' }}>
              {gateInfo.message || 'Run /dogpile to unlock Tune/Train tabs'}
            </span>
          )}
        </div>
      )}
      {source && (
        <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 8, fontFamily: MONO }}>
          Source: {source.split('/').slice(-3).join('/')}
        </div>
      )}
      <div style={{ ...card, padding: 32 }}>
        <div className="clf-markdown" style={{ ...body, lineHeight: 1.8 }}
          dangerouslySetInnerHTML={{ __html: marked(md) as string }} />
      </div>
    </div>
  )
}

// ── Data Tab ────────────────────────────────────────────────────────

function DataTab({ project, onGateChange }: { project: Project; onGateChange: (passed: boolean) => void }) {
  const [dataInfo, setDataInfo] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/projects/classifier-lab/data/${project.id}`)
      .then(r => r.json()).then(d => { setDataInfo(d); setLoading(false); onGateChange(d.gatePassed ?? false) })
      .catch(() => { setLoading(false); onGateChange(false) })
  }, [project.id, onGateChange])

  if (loading) return <div style={{ color: EMBRY.dim, padding: 40 }}>Loading dataset info...</div>
  if (!dataInfo || dataInfo.error) return (
    <div style={{ ...card, maxWidth: 600, margin: '60px auto', textAlign: 'center', padding: 40 }}>
      <AlertTriangle size={32} color={EMBRY.amber} style={{ marginBottom: 12 }} />
      <div style={{ ...heading, color: EMBRY.amber, marginBottom: 8 }}>NO DATASET</div>
      <div style={{ ...body, fontSize: 12, color: EMBRY.dim }}>No training data found for this project.</div>
    </div>
  )

  const classes: { name: string; train: number; val: number; test: number }[] = dataInfo.classes || []
  const maxCount = Math.max(...classes.map(c => c.train), 1)
  const failedClasses = classes.filter(c => c.train < dataInfo.gateThreshold)
  const passed = dataInfo.gatePassed

  // Color assignment per class
  const CLASS_COLORS = [EMBRY.green, EMBRY.blue, EMBRY.accent, '#22d3ee', EMBRY.amber, EMBRY.red]

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 32 }}>
        <StatPanel title="SOURCE" value={dataInfo.path?.split('/').slice(-2).join('/') || project.id} mono />
        <StatPanel title="MODALITY" value={dataInfo.modality || 'Vision'} color={EMBRY.green} />
        <StatPanel title="TRAIN SAMPLES" value={String(dataInfo.totalTrain)} />
        <StatPanel title="CLASSES" value={String(dataInfo.classCount)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        {/* Distribution bars — real data */}
        <div style={card}>
          <div style={{ ...heading, marginBottom: 20 }}>Class Distribution (Train)</div>
          {classes.map((c, i) => {
            const color = c.train < dataInfo.gateThreshold ? EMBRY.red : CLASS_COLORS[i % CLASS_COLORS.length]
            return (
              <div key={c.name} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontFamily: MONO }}>{c.name}</span>
                  <span style={{ color: c.train < dataInfo.gateThreshold ? EMBRY.red : EMBRY.dim, fontFamily: MONO }}>
                    {c.train} train / {c.val} val / {c.test} test
                  </span>
                </div>
                <div style={{ height: 6, background: EMBRY.bgDeep, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${(c.train / (maxCount * 1.2)) * 100}%`, height: '100%', background: color, borderRadius: 3 }} />
                </div>
              </div>
            )
          })}
          {/* Threshold line */}
          <div style={{ fontSize: 9, color: EMBRY.dim, marginTop: 8, fontFamily: MONO }}>
            Min per class: {dataInfo.minPerClass} (threshold: {dataInfo.gateThreshold})
          </div>
        </div>

        {/* Validation gate — real status */}
        {!passed ? (
          <div style={{ ...card, border: `1px solid ${EMBRY.red}`, textAlign: 'center', background: 'rgba(255,68,68,0.03)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={32} color={EMBRY.red} style={{ marginBottom: 12 }} />
            <div style={{ ...heading, color: EMBRY.red, marginBottom: 8 }}>VALIDATION FAILED</div>
            <div style={{ ...body, fontSize: 12, color: EMBRY.dim }}>
              {failedClasses.map(c => `"${c.name}" has only ${c.train} samples`).join('. ')}.<br />
              Minimum is <b>{dataInfo.gateThreshold} per class</b>.
            </div>
            <div style={{ marginTop: 16, fontSize: 10, color: EMBRY.red, fontWeight: 700 }}>
              Tune and Train tabs are BLOCKED until data gate passes.
            </div>
            <button style={{
              marginTop: 16, background: 'none', border: `1px solid ${EMBRY.red}`,
              color: EMBRY.red, padding: '8px 16px', borderRadius: 4, fontWeight: 900, cursor: 'pointer', fontSize: 10,
            }}>AUGMENT DATASET</button>
          </div>
        ) : (
          <DataTrainingSummary projectId={project.id} classCount={dataInfo.classCount} gateThreshold={dataInfo.gateThreshold} />
        )}
      </div>

      {/* Dataset file browser table */}
      <DataFileTable projectId={project.id} classes={classes.map(c => c.name)} />
    </div>
  )
}

/** Shows training results instead of a vague "PASSED" badge */
function DataTrainingSummary({ projectId, classCount, gateThreshold }: { projectId: string; classCount: number; gateThreshold: number }) {
  const [bench, setBench] = useState<any>(null)
  useEffect(() => {
    fetch(`${API}/projects/classifier-lab/benchmark-results/${projectId}`)
      .then(r => r.json()).then(setBench).catch(() => {})
  }, [projectId])

  const winner = bench?.selected_backbone
  const f1 = bench?.selected_metrics?.macro_f1
  const acc = bench?.selected_metrics?.accuracy
  const results = bench?.results || []
  const gatePassed = f1 != null && f1 >= (bench?.gate_f1 || 0.90)

  // No training results yet — show simple data gate pass
  if (!bench || !results.length) return (
    <div style={{ ...card, border: `1px solid ${EMBRY.green}`, background: 'rgba(0,255,136,0.03)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <ShieldCheck size={24} color={EMBRY.green} style={{ marginBottom: 8 }} />
      <div style={{ fontSize: 11, fontWeight: 700, color: EMBRY.green, marginBottom: 4 }}>DATA GATE PASSED</div>
      <div style={{ fontSize: 10, color: EMBRY.dim }}>{classCount} classes, {gateThreshold}+ samples/class</div>
      <div style={{ fontSize: 9, color: EMBRY.muted, marginTop: 8 }}>Run training to see results here</div>
    </div>
  )

  const borderColor = gatePassed ? EMBRY.green : EMBRY.amber
  return (
    <div style={{ ...card, border: `1px solid ${borderColor}`, background: `${borderColor}05`, padding: 20 }}>
      {/* Winner headline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        {gatePassed ? <ShieldCheck size={18} color={EMBRY.green} /> : <AlertTriangle size={18} color={EMBRY.amber} />}
        <span style={{ fontSize: 12, fontWeight: 900, color: borderColor }}>
          {gatePassed ? 'GATE PASSED' : 'GATE NOT MET'}
        </span>
        <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 'auto' }}>
          gate: F1 ≥ {bench?.gate_f1 || 0.90}
        </span>
      </div>

      {/* Winner stats */}
      {winner && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 2 }}>WINNER</div>
            <div style={{ fontSize: 12, fontWeight: 700, fontFamily: MONO, color: EMBRY.white }}>{winner}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 2 }}>F1 SCORE</div>
            <div style={{ fontSize: 20, fontWeight: 900, fontFamily: MONO, color: gatePassed ? EMBRY.green : EMBRY.amber }}>
              {f1?.toFixed(3)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 2 }}>ACCURACY</div>
            <div style={{ fontSize: 20, fontWeight: 900, fontFamily: MONO, color: EMBRY.white }}>
              {acc?.toFixed(3)}
            </div>
          </div>
        </div>
      )}

      {/* All backbones mini-table */}
      {results.length > 1 && (
        <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12 }}>
          <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 8 }}>ALL BACKBONES</div>
          {results.map((r: any, i: number) => {
            const isWinner = r.backbone === winner
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                opacity: isWinner ? 1 : 0.6 }}>
                <span style={{ fontSize: 10, fontFamily: MONO, flex: 1, color: isWinner ? EMBRY.white : EMBRY.dim }}>
                  {r.backbone}
                </span>
                <span style={{ fontSize: 11, fontFamily: MONO, fontWeight: 700,
                  color: r.gate_passed ? EMBRY.green : EMBRY.red }}>
                  {(r.macro_f1 || 0).toFixed(3)}
                </span>
                <span style={{ fontSize: 9, color: EMBRY.muted, width: 30, textAlign: 'left' }}>
                  R{r.rounds || '?'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Data File Table (virtualized with @tanstack/react-table) ──────

interface DataFileRow { filename: string; className: string; split: string; path: string; text?: string }
const fileColumnHelper = createColumnHelper<DataFileRow>()

function DataFileTable({ projectId, classes }: { projectId: string; classes: string[] }) {
  const [data, setData] = useState<DataFileRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [splitFilter, setSplitFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 })

  // Debounce search input (300ms)
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPagination(p => ({ ...p, pageIndex: 0 })) }, 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(pagination.pageIndex),
      pageSize: String(pagination.pageSize),
      ...(splitFilter ? { split: splitFilter } : {}),
      ...(classFilter ? { class: classFilter } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(sorting.length ? { sortBy: sorting[0].id, sortDir: sorting[0].desc ? 'desc' : 'asc' } : {}),
    })
    fetch(`${API}/projects/classifier-lab/data/${projectId}/files?${params}`)
      .then(r => r.json())
      .then(d => { setData(d.rows || []); setTotal(d.total || 0); setLoading(false) })
      .catch(() => { setData([]); setLoading(false) })
  }, [projectId, pagination.pageIndex, pagination.pageSize, splitFilter, classFilter, debouncedSearch, sorting])

  const isImageFile = (f: string) => /\.(jpg|jpeg|png|gif|webp)$/i.test(f)
  const imageUrl = (row: DataFileRow) => `${API}/projects/classifier-lab/images/${projectId}/${row.path}`

  const hasText = data.some(r => r.text)
  const hasImages = data.some(r => isImageFile(r.filename))

  const columns = useMemo(() => [
    // Thumbnail for vision, icon for text
    fileColumnHelper.display({
      id: 'thumb',
      header: '',
      size: 44,
      cell: ({ row }) => {
        const r = row.original
        if (!isImageFile(r.filename)) return <FileText size={11} color={EMBRY.dim} />
        return <ImageThumb src={imageUrl(r)} alt={`${r.className} — ${r.filename}`} size={32} />
      },
    }),
    // Class label — always first real column
    fileColumnHelper.accessor('className', {
      header: 'CLASS',
      size: 100,
      cell: info => {
        const idx = classes.indexOf(info.getValue())
        const colors = [EMBRY.green, EMBRY.blue, EMBRY.accent, '#22d3ee', EMBRY.amber, EMBRY.red]
        return <span style={{ color: colors[idx % colors.length], fontWeight: 700 }}>{info.getValue()}</span>
      },
    }),
    // Text content for text modality, filename for vision
    ...(hasText ? [
      fileColumnHelper.accessor('text', {
        header: 'TEXT',
        size: 500,
        cell: (info: any) => (
          <span style={{ color: EMBRY.dim, fontSize: 11, lineHeight: 1.4, display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>
            {info.getValue() || '—'}
          </span>
        ),
      }),
    ] : [
      fileColumnHelper.accessor('filename', {
        header: 'FILENAME',
        cell: (info: any) => <span>{info.getValue()}</span>,
      }),
    ]),
    // Split badge
    fileColumnHelper.accessor('split', {
      header: 'SPLIT',
      size: 80,
      cell: info => {
        const s = info.getValue()
        const color = s === 'train' ? EMBRY.green : s === 'val' ? EMBRY.amber : EMBRY.blue
        return <span style={{ ...statusBadge, background: `${color}15`, color }}>{s.toUpperCase()}</span>
      },
    }),
  ], [classes, hasText])

  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination },
    onSortingChange: (updater) => {
      setSorting(updater)
      setPagination(p => ({ ...p, pageIndex: 0 })) // reset to page 1 on sort change
    },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    pageCount: Math.ceil(total / pagination.pageSize),
  })

  const totalPages = Math.ceil(total / pagination.pageSize)

  return (
    <div style={{ marginTop: 28 }}>
      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={label}>DATASET FILES</div>
        <span style={{ fontSize: 10, color: EMBRY.dim, fontFamily: MONO }}>{total.toLocaleString()} files</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: EMBRY.bgDeep, borderRadius: 4, border: `1px solid ${EMBRY.border}` }}>
            <Search size={11} color={EMBRY.dim} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search files..." aria-label="Search dataset files"
              style={{ background: 'none', border: 'none', outline: 'none', color: EMBRY.white, fontSize: 10, fontFamily: MONO, width: 120 }} />
          </div>
          <select value={splitFilter} onChange={e => { setSplitFilter(e.target.value); setPagination(p => ({ ...p, pageIndex: 0 })) }}
            style={filterSelect}>
            <option value="">All splits</option>
            <option value="train">Train</option>
            <option value="val">Val</option>
            <option value="test">Test</option>
          </select>
          <select value={classFilter} onChange={e => { setClassFilter(e.target.value); setPagination(p => ({ ...p, pageIndex: 0 })) }}
            style={filterSelect}>
            <option value="">All classes</option>
            {classes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: EMBRY.dim }}>Loading files...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id} style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
                  {hg.headers.map(h => (
                    <th key={h.id} onClick={h.column.getToggleSortingHandler()}
                      style={{ ...thStyle, cursor: h.column.getCanSort() ? 'pointer' : 'default' }}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {{ asc: ' ▲', desc: ' ▼' }[h.column.getIsSorted() as string] ?? ''}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map(row => (
                <tr key={row.id} style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} style={tdStyle}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <span style={{ fontSize: 10, color: EMBRY.dim, fontFamily: MONO }}>
            Page {pagination.pageIndex + 1} of {totalPages}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPagination(p => ({ ...p, pageIndex: Math.max(0, p.pageIndex - 1) }))}
              disabled={pagination.pageIndex === 0} style={paginationBtn}>← Prev</button>
            <button onClick={() => setPagination(p => ({ ...p, pageIndex: Math.min(totalPages - 1, p.pageIndex + 1) }))}
              disabled={pagination.pageIndex >= totalPages - 1} style={paginationBtn}>Next →</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Train Tab (the core product — live leaderboard) ─────────────────

/** Inner component that reads LeftPane sort context and renders sorted project list */
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
          <div key={p.id} data-testid={`clf-project-${p.id}`}
            onClick={() => setSelectedProjectId(p.id)}
            onContextMenu={e => triggerContextMenu(e, p.id)}
            style={{ ...paneItemStyle(sel), display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, fontFamily: MONO, color: sel ? EMBRY.accent : EMBRY.white }}>{p.name}</div>
              <div style={{ fontSize: 9, color: EMBRY.dim }}>
                <span style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setFilterModality(p.modality === filterModality ? '' : p.modality) }}
                  title={`Filter by ${p.modality}`}>{p.modality}</span>, {p.classes ?? 0} cl, {(p.samples ?? 0).toLocaleString()} spl
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {p.status === 'training' ? (
                <span style={{ fontSize: 9, fontWeight: 900, color: EMBRY.amber }}>TRAINING</span>
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

function TrainTab({ project, rows }: { project: Project; rows: TrainingRow[] }) {
  const [selectedGpu, setSelectedGpu] = useState('local')
  const [gpuInfo, setGpuInfo] = useState<any>(null)
  const [backbonesInput, setBackbonesInput] = useState('')
  const [gateF1Input, setGateF1Input] = useState('0.90')
  const [maxRoundsInput, setMaxRoundsInput] = useState('5')
  const [maxTrainSamplesInput, setMaxTrainSamplesInput] = useState('10000')
  const best = rows.find(r => r.status === 'pass')
  const passCount = rows.filter(r => r.status === 'pass').length
  const totalCount = rows.length

  const parseBackbones = useCallback((data: BenchmarkTrainConfigResponse): string[] => {
    if (Array.isArray(data.backbones) && data.backbones.length) {
      return data.backbones
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    }
    if (Array.isArray(data.results) && data.results.length) {
      return data.results
        .map((result) => result.backbone)
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    }
    return []
  }, [])

  const fallbackBackbones = useMemo(
    () => Array.from(new Set(rows.map((row) => row.backbone.trim()).filter((item) => item.length > 0))),
    [rows],
  )

  // Fetch real GPU info
  useEffect(() => {
    fetch(`${API}/projects/classifier-lab/gpu-info`)
      .then(r => r.json()).then(setGpuInfo)
      .catch(() => setGpuInfo(null))
  }, [])

  useEffect(() => {
    setGateF1Input('0.90')
    setMaxRoundsInput('5')
    setMaxTrainSamplesInput('10000')
    setBackbonesInput(fallbackBackbones.join(', '))
    fetch(`${API}/projects/classifier-lab/benchmark-results/${project.id}`)
      .then(r => r.json())
      .then((data: BenchmarkTrainConfigResponse) => {
        const parsedBackbones = parseBackbones(data)
        if (parsedBackbones.length > 0) {
          setBackbonesInput(parsedBackbones.join(', '))
        }
        if (typeof data.gate_f1 === 'number' && Number.isFinite(data.gate_f1)) {
          setGateF1Input(data.gate_f1.toFixed(2))
        }
        if (typeof data.max_rounds === 'number' && Number.isFinite(data.max_rounds)) {
          setMaxRoundsInput(String(Math.max(1, Math.round(data.max_rounds))))
        }
        if (typeof data.max_train_samples === 'number' && Number.isFinite(data.max_train_samples)) {
          setMaxTrainSamplesInput(String(Math.max(1, Math.round(data.max_train_samples))))
        }
      })
      .catch(() => {})
  }, [fallbackBackbones, parseBackbones, project.id])

  const rerunBackbones = useMemo(
    () => backbonesInput.split(',').map((item) => item.trim()).filter((item) => item.length > 0),
    [backbonesInput],
  )
  const gateF1 = Number(gateF1Input)
  const maxRounds = Number(maxRoundsInput)
  const maxTrainSamples = Number(maxTrainSamplesInput)
  const rerunGateF1 = Number.isFinite(gateF1) && gateF1 > 0 ? gateF1 : 0.9
  const rerunMaxRounds = Number.isFinite(maxRounds) && maxRounds > 0 ? Math.round(maxRounds) : 5
  const rerunMaxTrainSamples = Number.isFinite(maxTrainSamples) && maxTrainSamples > 0 ? Math.round(maxTrainSamples) : 10000

  const localGpu = gpuInfo?.gpus?.[0]

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ ...heading, fontSize: 22 }}>{project.name.toUpperCase()}</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
            <span style={{ ...gateBadge, background: 'rgba(124,58,237,0.1)', color: EMBRY.accent, borderColor: EMBRY.accent + '44' }}>
              TARGET: F1 ≥ {rerunGateF1.toFixed(2)}
            </span>
            {totalCount > 0 && (
              <span style={{ ...gateBadge, background: 'rgba(255,170,0,0.1)', color: EMBRY.amber, borderColor: EMBRY.amber + '44' }}>
                {passCount > 0 ? `${passCount} PASSED` : `${totalCount} CANDIDATES`}
              </span>
            )}
            {best && (
              <span style={{ ...gateBadge, background: 'rgba(0,255,136,0.1)', color: EMBRY.green, borderColor: EMBRY.green + '44' }}>
                BEST: {best.backbone} F1 {best.f1.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button style={{ ...btnOutline, borderColor: EMBRY.amber + '66', color: EMBRY.amber }}>CONTINUE SEARCH</button>
          <RunButton onClick={() => {}} disabled={!best}>PROMOTE</RunButton>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 14, padding: 16 }}>
        <div style={{ ...label, marginBottom: 12 }}>RERUN CONFIGURATION</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <div style={{ ...label, fontSize: 8, marginBottom: 6 }}>BACKBONES</div>
            <input
              value={backbonesInput}
              onChange={(e) => setBackbonesInput(e.target.value)}
              placeholder="resnet50, efficientnet_b0, convnext_tiny"
              style={rerunInputStyle}
            />
          </div>
          <div>
            <div style={{ ...label, fontSize: 8, marginBottom: 6 }}>GATE F1</div>
            <input
              type="number"
              min={0}
              step="0.01"
              value={gateF1Input}
              onChange={(e) => setGateF1Input(e.target.value)}
              style={rerunInputStyle}
            />
          </div>
          <div>
            <div style={{ ...label, fontSize: 8, marginBottom: 6 }}>MAX ROUNDS</div>
            <input
              type="number"
              min={1}
              step={1}
              value={maxRoundsInput}
              onChange={(e) => setMaxRoundsInput(e.target.value)}
              style={rerunInputStyle}
            />
          </div>
          <div>
            <div style={{ ...label, fontSize: 8, marginBottom: 6 }}>MAX TRAIN SAMPLES</div>
            <input
              type="number"
              min={1}
              step={1}
              value={maxTrainSamplesInput}
              onChange={(e) => setMaxTrainSamplesInput(e.target.value)}
              style={rerunInputStyle}
            />
          </div>
          <RerunButton
            projectId={project.id}
            disabled={rerunBackbones.length === 0}
            rerunOverrides={{
              backbones: rerunBackbones,
              gate_f1: rerunGateF1,
              max_rounds: rerunMaxRounds,
              max_train_samples: rerunMaxTrainSamples,
            }}
            onRerun={() => {}}
          />
        </div>
      </div>

      {/* Leaderboard */}
      <div style={{ ...label, marginBottom: 8 }}>LIVE TRAINING LEADERBOARD</div>
      <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 28 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
              {['#', 'BACKBONE', 'LR', 'BS', 'F1', 'ACC', 'LATENCY', 'COST', 'GATE'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.backbone} style={{
                borderBottom: `1px solid ${EMBRY.border}`,
                borderLeft: r.rank === 1 && r.status === 'pass' ? `3px solid ${EMBRY.green}` : '3px solid transparent',
                background: r.status === 'training' ? 'rgba(124,58,237,0.03)' : 'transparent',
              }}>
                <td style={tdStyle}>{r.rank}</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: r.rank === 1 ? EMBRY.green : EMBRY.white }}>{r.backbone}</td>
                <td style={tdStyle}>{r.lr}</td>
                <td style={tdStyle}>{r.bs || '—'}</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: r.f1 >= rerunGateF1 ? EMBRY.green : r.f1 > 0 ? EMBRY.red : EMBRY.muted }}>
                  {r.f1 ? r.f1.toFixed(2) : '—'}
                </td>
                <td style={tdStyle}>{r.acc ? r.acc.toFixed(2) : '—'}</td>
                <td style={tdStyle}>{r.latency}</td>
                <td style={{ ...tdStyle, color: r.cost === 'FREE' ? EMBRY.green : EMBRY.white }}>{r.cost}</td>
                <td style={tdStyle}>
                  {r.status === 'training' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 60, height: 4, background: EMBRY.bgDeep, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${r.progress ?? 0}%`, background: EMBRY.amber }} />
                      </div>
                      <span style={{ fontSize: 8, color: EMBRY.amber, fontWeight: 700 }}>{r.progress}%</span>
                    </div>
                  ) : r.status === 'queued' ? (
                    <span style={{ ...statusBadge, background: 'rgba(100,116,139,0.15)', color: EMBRY.dim }}>QUEUED</span>
                  ) : (
                    <span style={{ ...statusBadge, background: r.status === 'pass' ? 'rgba(0,255,136,0.1)' : 'rgba(255,68,68,0.1)', color: r.status === 'pass' ? EMBRY.green : EMBRY.red }}>
                      {r.status.toUpperCase()}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Best recommendation */}
      {best && (
        <div style={{ ...panel, border: `1px solid ${EMBRY.green}33`, background: 'rgba(0,255,136,0.03)', marginBottom: 28 }}>
          <span style={{ ...label, color: EMBRY.green }}>RECOMMENDED</span>
          <span style={{ marginLeft: 12, fontFamily: MONO, fontWeight: 700, fontSize: 13 }}>
            {best.backbone} — F1 {best.f1.toFixed(2)}, {best.latency}, {best.cost}
          </span>
        </div>
      )}

      {/* GPU picker */}
      <div style={{ ...label, marginBottom: 8 }}>RESOURCE ALLOCATION</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <GpuCard
          name={localGpu ? `LOCAL ${localGpu.name}` : 'LOCAL GPU'}
          vram={localGpu ? `${Math.round(localGpu.memoryTotal / 1024)}GB` : '—'}
          price="FREE"
          avail={localGpu ? Math.max(0, 100 - localGpu.utilization) : 0}
          active={selectedGpu === 'local'} onClick={() => setSelectedGpu('local')}
        />
        <GpuCard name="H100" vram="80GB" price="$2.49/hr" avail={0} active={selectedGpu === 'h100'} onClick={() => setSelectedGpu('h100')} />
        <GpuCard name="A100" vram="80GB" price="$1.64/hr" avail={0} active={selectedGpu === 'a100'} onClick={() => setSelectedGpu('a100')} />
        <GpuCard name="B200" vram="192GB" price="$5.49/hr" avail={0} active={selectedGpu === 'b200'} onClick={() => setSelectedGpu('b200')} />
      </div>
      <div style={{ fontSize: 9, color: EMBRY.muted, marginTop: 8 }}>
        Remote GPUs via /ops-runpod — availability checked on demand
      </div>
    </div>
  )
}

// ── Benchmark Tab ───────────────────────────────────────────────────

// ── Tune Tab (HP self-improvement loop) ─────────────────────────────

function TuneTab({ project }: { project: Project }) {
  const [tuneData, setTuneData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/projects/classifier-lab/tune-results/${project.id}`)
      .then(r => r.json())
      .then(d => { setTuneData(d); setLoading(false) })
      .catch(() => { setTuneData(null); setLoading(false) })
  }, [project.id])

  if (loading) return <div style={{ color: EMBRY.dim, padding: 40 }}>Loading tune results...</div>

  if (!tuneData || tuneData.error) return (
    <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
      <div style={card}>
        <div style={{ padding: 40 }}>
          <Cpu size={32} color={EMBRY.dim} style={{ marginBottom: 12 }} />
          <div style={{ ...heading, color: EMBRY.dim, marginBottom: 8 }}>NO TUNE RESULTS</div>
          <div style={{ ...body, fontSize: 12, color: EMBRY.muted }}>
            No hyperparameter search results found.<br />
            Start a benchmark to generate self-improvement loop data.
          </div>
        </div>
      </div>
    </div>
  )

  type TuneTrial = {
    trial: number
    backbone: string
    epochs: number | null
    lr: string
    augment: string
    valF1: number | null
    testF1: number | null
    status: string
    passed: boolean
  }

  const asRecord = (value: unknown): Record<string, unknown> | null => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  )
  const asNumber = (value: unknown): number | null => (
    typeof value === 'number' && Number.isFinite(value) ? value : null
  )
  const normalizeStatus = (value: unknown): string => {
    if (typeof value !== 'string') return 'pending'
    const status = value.toLowerCase()
    if (status === 'complete' || status === 'completed' || status === 'passed' || status === 'failed' || status === 'running') {
      return status
    }
    return status || 'pending'
  }

  const rawTrials: unknown[] = Array.isArray(tuneData.trials) ? tuneData.trials : []
  const trials: TuneTrial[] = rawTrials.map((value, i) => {
    const record = asRecord(value) ?? {}
    const hps = asRecord(record.hps) ?? {}
    const trialNum = asNumber(record.trial) ?? asNumber(record.round) ?? (i + 1)
    const rawStatus = normalizeStatus(record.status)
    const valF1 = asNumber(record.valF1) ?? asNumber(record.val_f1)
    const testF1 = asNumber(record.testF1) ?? asNumber(record.test_f1) ?? asNumber(record.f1)
    const passed = record.passed === true || record.gate_passed === true || rawStatus === 'passed'

    return {
      trial: Math.max(1, Math.round(trialNum)),
      backbone: typeof record.backbone === 'string' && record.backbone.trim().length > 0 ? record.backbone : '—',
      epochs: asNumber(record.epochs) ?? asNumber(hps.epochs),
      lr: String(record.lr ?? hps.lr ?? '—'),
      augment: String(record.augment ?? record.augmentation ?? '—'),
      valF1,
      testF1,
      status: rawStatus,
      passed,
    }
  }).sort((a, b) => a.trial - b.trial)

  const completedTrials = trials.filter((t) => t.status === 'complete' || t.status === 'completed' || t.status === 'passed' || t.status === 'failed')
  const bestTrial = [...completedTrials].sort((a, b) => (b.testF1 ?? b.valF1 ?? 0) - (a.testF1 ?? a.valF1 ?? 0))[0]
  const totalCount = trials.length
  const completedCount = completedTrials.length
  const strategy = tuneData.strategy || 'self-improvement-loop'
  const winningRound = tuneData.winningRound

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ ...heading, fontSize: 18 }}>HYPERPARAMETER OPTIMIZATION — {project.name.toUpperCase()}</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <span style={{ ...gateBadge, background: 'rgba(124,58,237,0.1)', color: EMBRY.accent, borderColor: EMBRY.accent + '44' }}>
              {completedCount} / {totalCount} ROUNDS
            </span>
            <span style={{ ...gateBadge, background: 'rgba(0,255,136,0.1)', color: EMBRY.green, borderColor: EMBRY.green + '44' }}>
              STRATEGY: {strategy.toUpperCase().replace(/-/g, ' ')}
            </span>
            <span style={{ ...gateBadge, background: 'rgba(255,170,0,0.1)', color: EMBRY.amber, borderColor: EMBRY.amber + '44' }}>
              TARGET: F1 ≥ 0.90
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {winningRound && (
            <span style={{ ...gateBadge, background: 'rgba(0,255,136,0.1)', color: EMBRY.green, borderColor: EMBRY.green + '44' }}>
              WINNER: ROUND {winningRound}
            </span>
          )}
        </div>
      </div>

      {/* Best trial banner */}
      {bestTrial && (
        <div style={{ ...panel, border: `1px solid ${bestTrial.passed ? EMBRY.green : EMBRY.amber}33`, background: `${bestTrial.passed ? EMBRY.green : EMBRY.amber}08`, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={glowDot(bestTrial.passed ? EMBRY.green : EMBRY.amber, 10)} />
          <span style={{ ...label, color: bestTrial.passed ? EMBRY.green : EMBRY.amber }}>BEST SO FAR</span>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13 }}>
            Round #{bestTrial.trial} — {bestTrial.backbone} — Test F1 {(bestTrial.testF1 ?? bestTrial.valF1 ?? 0).toFixed(3)}
          </span>
          <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 'auto' }}>
            LR={bestTrial.lr} epochs={bestTrial.epochs} augment={bestTrial.augment || '—'}
          </span>
        </div>
      )}

      {/* Round progress circles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        {trials.map((t) => {
          const passed = t.passed
          const isRunning = t.status === 'running'
          const isDone = t.status === 'complete' || t.status === 'completed' || t.status === 'passed' || t.status === 'failed'
          return (
            <div key={t.trial} style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 900, fontFamily: MONO,
              background: passed ? EMBRY.green + '20' : isRunning ? EMBRY.amber + '20' : isDone ? EMBRY.red + '15' : EMBRY.blue + '15',
              color: passed ? EMBRY.green : isRunning ? EMBRY.amber : isDone ? EMBRY.red : EMBRY.blue,
              border: `1px solid ${passed ? EMBRY.green + '44' : isRunning ? EMBRY.amber + '44' : isDone ? EMBRY.red + '33' : EMBRY.blue + '33'}`,
            }}>
              {t.trial}
            </div>
          )
        })}
        <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 8 }}>
          {completedCount} / {totalCount} rounds complete
          {winningRound ? ` — Gate passed at round ${winningRound}` : ''}
        </span>
      </div>

      {/* Self-improvement trial table */}
      <div style={{ ...label, marginBottom: 8 }}>SELF-IMPROVEMENT ROUNDS</div>
      <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 28 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
              {['ROUND', 'BACKBONE', 'EPOCHS', 'LR', 'AUGMENT', 'VAL F1', 'TEST F1', 'GATE'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trials.map((t) => {
              const isBest = bestTrial && t.trial === bestTrial.trial
              const testF1 = t.testF1 ?? 0
              const valF1 = t.valF1 ?? 0
              return (
                <tr key={t.trial} style={{
                  borderBottom: `1px solid ${EMBRY.border}`,
                  borderLeft: isBest ? `3px solid ${EMBRY.green}` : '3px solid transparent',
                  background: t.status === 'running' ? 'rgba(124,58,237,0.03)' : 'transparent',
                }}>
                  <td style={tdStyle}>#{t.trial}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: isBest ? EMBRY.green : EMBRY.white }}>{t.backbone}</td>
                  <td style={tdStyle}>{t.epochs ?? '—'}</td>
                  <td style={tdStyle}>{t.lr}</td>
                  <td style={tdStyle}>{t.augment || '—'}</td>
                  <td style={{ ...tdStyle, color: valF1 >= 0.90 ? EMBRY.green : valF1 > 0 ? EMBRY.white : EMBRY.muted }}>
                    {valF1 ? valF1.toFixed(3) : '—'}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: testF1 >= 0.90 ? EMBRY.green : testF1 > 0 ? EMBRY.red : EMBRY.muted }}>
                    {testF1 ? testF1.toFixed(3) : '—'}
                  </td>
                  <td style={tdStyle}>
                    {t.passed ? (
                      <span style={{ ...statusBadge, background: 'rgba(0,255,136,0.1)', color: EMBRY.green }}>PASSED</span>
                    ) : t.status === 'running' ? (
                      <span style={{ ...statusBadge, background: 'rgba(124,58,237,0.15)', color: EMBRY.accent }}>RUNNING</span>
                    ) : t.status === 'pending' ? (
                      <span style={{ ...statusBadge, background: 'rgba(56,189,248,0.15)', color: EMBRY.blue }}>PENDING</span>
                    ) : (
                      <span style={{ ...statusBadge, background: 'rgba(255,68,68,0.1)', color: EMBRY.red }}>FAILED</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Config + HP changes between rounds */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={card}>
          <div style={{ ...heading, fontSize: 13, marginBottom: 16 }}>Self-Improvement Configuration</div>
          {[
            { key: 'Strategy', value: strategy === 'self-improvement-loop' ? 'Iterative HP adjustment' : strategy },
            { key: 'Target F1', value: '≥ 0.90 on held-out test set' },
            { key: 'Max rounds', value: String(totalCount) },
            { key: 'Completed rounds', value: String(completedCount) },
            { key: 'Winning round', value: winningRound ? `Round ${winningRound}` : 'None yet' },
          ].map(({ key, value }) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${EMBRY.border}`, fontSize: 11 }}>
              <span style={{ color: EMBRY.dim }}>{key}</span>
              <span style={{ fontFamily: MONO, fontWeight: 700 }}>{value}</span>
            </div>
          ))}
        </div>

        {/* HP delta between rounds */}
        <div style={card}>
          <div style={{ ...heading, fontSize: 13, marginBottom: 16 }}>HP Changes Between Rounds</div>
          {trials.length > 1 ? trials.slice(1).map((t, i) => {
            const prev = trials[i]
            const changes: string[] = []
            if (t.lr !== prev.lr) changes.push(`LR: ${prev.lr} → ${t.lr}`)
            if (t.epochs !== prev.epochs) changes.push(`Epochs: ${prev.epochs} → ${t.epochs}`)
            if (t.augment !== prev.augment) changes.push(`Augment: ${prev.augment || 'none'} → ${t.augment || 'none'}`)
            const prevScore = prev.testF1 ?? prev.valF1 ?? null
            const currentScore = t.testF1 ?? t.valF1 ?? null
            if (prevScore !== null && currentScore !== null) {
              const delta = currentScore - prevScore
              const sign = delta > 0 ? '+' : ''
              changes.push(`F1 Δ: ${sign}${delta.toFixed(3)} (${prevScore.toFixed(3)} → ${currentScore.toFixed(3)})`)
            }
            if (!changes.length) changes.push('No changes')
            return (
              <div key={`${prev.trial}-${t.trial}`} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${EMBRY.border}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: t.passed ? EMBRY.green : EMBRY.dim, marginBottom: 4 }}>
                  Round {prev.trial} → {t.trial}
                </div>
                {changes.map((c, j) => (
                  <div key={j} style={{ fontSize: 10, color: EMBRY.muted, fontFamily: MONO, marginLeft: 8 }}>• {c}</div>
                ))}
              </div>
            )
          }) : (
            <div style={{ fontSize: 11, color: EMBRY.muted }}>Only one round completed — no deltas to show.</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Benchmark Tab ───────────────────────────────────────────────────

function BenchmarkTab({ project, data: propData }: { project: Project; data?: BenchmarkRow[] }) {
  const data = propData?.length ? propData : []
  const bestF1 = data.length ? Math.max(...data.map(d => d.f1)) : 0
  const bestLat = data.length ? Math.min(...data.map(d => d.lat50)) : 0
  const fallbackWinner = data.reduce<BenchmarkRow | null>(
    (best, row) => (!best || row.f1 > best.f1 ? row : best),
    null,
  )
  const winnerName = data.find(d => d.winner)?.name || fallbackWinner?.name || ''
  const chartTop = 8
  const chartBottom = 192
  const axisX = [60, 360, 660, 960]

  const parallelAxes = [
    { key: 'f1', label: 'F1' },
    { key: 'acc', label: 'ACCURACY' },
    { key: 'wilson', label: 'WILSON LOWER' },
    { key: 'rounds', label: 'ROUNDS' },
  ] as const

  const axisBounds = parallelAxes.map((axis) => {
    const values = data.map(d => d[axis.key])
    if (!values.length) return { min: 0, max: 1 }
    return { min: Math.min(...values), max: Math.max(...values) }
  })

  const axisY = (axisIdx: number, value: number) => {
    const { min, max } = axisBounds[axisIdx]
    if (max === min) return chartTop + (chartBottom - chartTop) / 2
    const t = (value - min) / (max - min)
    return chartBottom - t * (chartBottom - chartTop)
  }

  const linePath = (row: BenchmarkRow) => parallelAxes
    .map((axis, axisIdx) => `${axisIdx === 0 ? 'M' : 'L'} ${axisX[axisIdx]} ${axisY(axisIdx, row[axis.key]).toFixed(2)}`)
    .join(' ')

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ ...heading, fontSize: 16 }}>BACKBONE COMPARISON — {project.name.toUpperCase()} ({data.length} backbones)</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnOutline}>FILTER</button>
          <button style={btnOutline}>EXPORT</button>
        </div>
      </div>

      {/* Comparison grid */}
      <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 28 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
              {['BACKBONE', 'MACRO F1', 'ACCURACY', 'WILSON CI', 'LAT p50 (ms)', 'LAT p95 (ms)', 'PARAMS (M)', 'TRAIN TIME'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((b, i) => (
              <tr key={b.name} style={{
                borderBottom: `1px solid ${EMBRY.border}`,
                borderLeft: i === 0 ? `3px solid ${EMBRY.green}` : '3px solid transparent',
                background: i === 0 ? 'rgba(0,255,136,0.02)' : 'transparent',
              }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: i === 0 ? EMBRY.green : EMBRY.white }}>
                  {i === 0 && '★ '}{b.name}
                </td>
                <td style={{ ...tdStyle, fontWeight: 700, color: b.f1 === bestF1 ? EMBRY.green : EMBRY.white }}>{b.f1.toFixed(3)}</td>
                <td style={tdStyle}>{b.acc.toFixed(3)}</td>
                <td style={tdStyle}>{b.wilson.toFixed(3)}</td>
                <td style={{ ...tdStyle, color: b.lat50 === bestLat ? EMBRY.green : EMBRY.white }}>{b.lat50}</td>
                <td style={tdStyle}>{b.lat95}</td>
                <td style={tdStyle}>{b.params}</td>
                <td style={tdStyle}>{b.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Parallel coordinates from real benchmark results */}
      <div style={{ ...card, position: 'relative', padding: '40px 40px 60px' }}>
        <div style={{ ...label, marginBottom: 16 }}>BENCHMARK METRICS (PARALLEL COORDINATES)</div>
        <svg width="100%" height="200" viewBox="0 0 1000 200" style={{ overflow: 'visible' }}>
          {/* Axes */}
          {parallelAxes.map((axis, i) => {
            const x = axisX[i]
            const bounds = axisBounds[i]
            return (
              <g key={axis.key}>
                <line x1={x} y1={0} x2={x} y2={200} stroke={EMBRY.muted} strokeWidth={1} strokeDasharray="4 2" />
                <text x={x} y={-8} fill={EMBRY.muted} fontSize={8} textAnchor="middle" fontFamily={MONO}>
                  {bounds.max.toFixed(axis.key === 'rounds' ? 0 : 3)}
                </text>
                <text x={x} y={208} fill={EMBRY.muted} fontSize={8} textAnchor="middle" fontFamily={MONO}>
                  {bounds.min.toFixed(axis.key === 'rounds' ? 0 : 3)}
                </text>
                <text x={x} y={220} fill={EMBRY.dim} fontSize={9} textAnchor="middle" fontWeight={700}>{axis.label}</text>
              </g>
            )
          })}

          {/* One line per backbone */}
          {data.map(row => {
            const isWinner = row.name === winnerName
            return (
              <path
                key={row.name}
                d={linePath(row)}
                fill="none"
                stroke={isWinner ? EMBRY.accent : EMBRY.blue}
                strokeWidth={isWinner ? 3 : 1.4}
                opacity={isWinner ? 0.95 : 0.4}
              />
            )
          })}

          {/* Legend */}
          <g>
            <line x1={740} y1={-10} x2={770} y2={-10} stroke={EMBRY.accent} strokeWidth={2.5} />
            <text x={775} y={-7} fill={EMBRY.dim} fontSize={8}>
              WINNER {winnerName ? `(${winnerName})` : ''}
            </text>
            <line x1={900} y1={-10} x2={930} y2={-10} stroke={EMBRY.blue} strokeWidth={2} opacity={0.7} />
            <text x={935} y={-7} fill={EMBRY.dim} fontSize={8}>OTHER BACKBONES</text>
          </g>
        </svg>
      </div>
    </div>
  )
}

// ── Evaluate Tab ────────────────────────────────────────────────────

function EvaluateTab({ project }: { project: Project }) {
  const [evalData, setEvalData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/projects/classifier-lab/eval-results/${project.id}`)
      .then(r => r.json()).then(d => { setEvalData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [project.id])

  if (loading) return <div style={{ color: EMBRY.dim, padding: 40 }}>Loading evaluation results...</div>
  if (!evalData || evalData.error) return (
    <div style={{ ...card, maxWidth: 600, margin: '60px auto', textAlign: 'center', padding: 40 }}>
      <AlertTriangle size={32} color={EMBRY.amber} style={{ marginBottom: 12 }} />
      <div style={{ ...heading, color: EMBRY.amber, marginBottom: 8 }}>NO EVALUATION DATA</div>
      <div style={{ ...body, fontSize: 12, color: EMBRY.dim }}>
        Run evaluation on held-out test set to see results here.<br />
        Training validation metrics are NOT evaluation.
      </div>
    </div>
  )

  const toFiniteNumber = (value: unknown): number => (
    typeof value === 'number' && Number.isFinite(value) ? value : 0
  )
  const toMetric = (value: unknown): { precision: number; recall: number; f1: number; support: number } => {
    const record = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
    return {
      precision: toFiniteNumber(record.precision),
      recall: toFiniteNumber(record.recall),
      f1: toFiniteNumber(record.f1),
      support: toFiniteNumber(record.support),
    }
  }

  const modelName = typeof evalData.model === 'string' && evalData.model.trim().length > 0
    ? evalData.model
    : (typeof evalData.winner === 'string' ? evalData.winner : 'unknown')
  const gateThreshold = toFiniteNumber(evalData.gate_threshold ?? evalData.holdout_gate_f1) || 0.90
  const macroF1 = toFiniteNumber(evalData.macro_f1 ?? evalData.f1)
  const accuracy = toFiniteNumber(evalData.accuracy)

  const rawPerClass = evalData.per_class && typeof evalData.per_class === 'object' && !Array.isArray(evalData.per_class)
    ? evalData.per_class as Record<string, unknown>
    : {}
  const fallbackClasses = Object.keys(rawPerClass)
  const classes: string[] = Array.isArray(evalData.classes)
    ? evalData.classes.filter((value: unknown): value is string => typeof value === 'string')
    : fallbackClasses
  const perClass = classes.map((cls) => toMetric(rawPerClass[cls]))

  const rawMatrix = Array.isArray(evalData.confusion_matrix) ? evalData.confusion_matrix : []
  const matrix: number[][] = rawMatrix.length > 0
    ? rawMatrix
      .filter((row: unknown): row is unknown[] => Array.isArray(row))
      .slice(0, classes.length)
      .map((row: unknown[]) => {
        const normalizedRow = row.map((value) => toFiniteNumber(value)).slice(0, classes.length)
        while (normalizedRow.length < classes.length) normalizedRow.push(0)
        return normalizedRow
      })
    : classes.map(() => classes.map(() => 0))
  while (matrix.length < classes.length) matrix.push(classes.map(() => 0))
  const inferredTestSamples = matrix.flat().reduce((sum, value) => sum + value, 0)
  const testSamples = toFiniteNumber(evalData.test_samples) || inferredTestSamples

  const passed = typeof evalData.holdout_passed === 'boolean'
    ? evalData.holdout_passed
    : (evalData.gate_passed === true || macroF1 >= gateThreshold)
  const gateColor = passed ? EMBRY.green : EMBRY.red
  const maxCmVal = Math.max(...matrix.flat().map(Math.abs), 1)

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Result banner */}
      <div style={{ ...panel, border: `1px solid ${gateColor}33`, background: `${gateColor}08`, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={glowDot(gateColor, 10)} />
        <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 14 }}>
          {modelName} — F1 {macroF1.toFixed(3)} — HOLDOUT {passed ? 'PASSED' : 'FAILED'}
        </span>
        <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 'auto' }}>
          {testSamples} test samples
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>
        {/* Confusion matrix — real counts */}
        <div style={card}>
          <div style={{ ...heading, marginBottom: 16 }}>Confusion Matrix (Test Set)</div>
          <div style={{ display: 'grid', gridTemplateColumns: `80px repeat(${classes.length}, 1fr)`, gap: 3, marginBottom: 3 }}>
            <div />
            {classes.map(c => (
              <div key={c} style={{ textAlign: 'center', fontSize: 7, fontWeight: 700, color: EMBRY.dim, textTransform: 'uppercase' }}>{c}</div>
            ))}
          </div>
          {matrix.map((row, ri) => (
            <div key={ri} style={{ display: 'grid', gridTemplateColumns: `80px repeat(${classes.length}, 1fr)`, gap: 3, marginBottom: 3 }}>
              <div style={{ fontSize: 7, fontWeight: 700, color: EMBRY.dim, display: 'flex', alignItems: 'center', textTransform: 'uppercase' }}>{classes[ri]}</div>
              {row.map((count, ci) => {
                const isDiag = ri === ci
                const intensity = count / maxCmVal
                const bgColor = isDiag
                  ? `rgba(0,255,136,${0.15 + intensity * 0.5})`
                  : count > 0 ? `rgba(255,68,68,${0.1 + intensity * 0.6})` : 'rgba(255,255,255,0.02)'
                return (
                  <div key={ci} style={{
                    height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: bgColor, borderRadius: 4,
                    color: isDiag ? (intensity > 0.5 ? '#000' : EMBRY.green) : (count > 0 ? EMBRY.red : EMBRY.muted),
                    fontWeight: 900, fontSize: 14, fontFamily: MONO,
                  }}>{count}</div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Per-class metrics — real data */}
        <div style={card}>
          <div style={{ ...heading, marginBottom: 16 }}>Per-Class Metrics (Test Set)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
                {['CLASS', 'PREC', 'RECALL', 'F1', 'SUPPORT'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {classes.map((cls, i) => {
                const m = perClass[i]
                const f1Color = m.f1 >= 0.90 ? EMBRY.green : m.f1 >= 0.80 ? EMBRY.white : EMBRY.red
                return (
                  <tr key={cls} style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{cls}</td>
                    <td style={{ ...tdStyle, color: m.precision >= 0.90 ? EMBRY.green : EMBRY.white }}>{m.precision.toFixed(2)}</td>
                    <td style={{ ...tdStyle, color: m.recall >= 0.90 ? EMBRY.green : EMBRY.white }}>{m.recall.toFixed(2)}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: f1Color }}>{m.f1.toFixed(2)}</td>
                    <td style={tdStyle}>{m.support}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Holdout gate — real result */}
          <div style={{
            marginTop: 20, padding: '10px 16px', borderRadius: 6,
            background: `${gateColor}0A`, border: `1px solid ${gateColor}33`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {passed ? <ShieldCheck size={16} color={gateColor} /> : <AlertTriangle size={16} color={gateColor} />}
            <span style={{ fontSize: 11, fontWeight: 700, color: gateColor, fontFamily: MONO }}>
              HOLDOUT {passed ? 'PASSED' : 'FAILED'} — F1 {macroF1.toFixed(3)} {passed ? '≥' : '<'} {gateThreshold.toFixed(2)}
            </span>
          </div>

          {/* Accuracy */}
          <div style={{ marginTop: 12, fontSize: 11, color: EMBRY.dim, fontFamily: MONO }}>
            Accuracy: {accuracy.toFixed(3)} ({testSamples} samples)
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Promote Tab ─────────────────────────────────────────────────────

function PromoteTab({ project }: { project: Project }) {
  const [evalData, setEvalData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [promoting, setPromoting] = useState(false)
  const [promoteStatus, setPromoteStatus] = useState<{ kind: 'idle' | 'success' | 'warn' | 'error'; text: string }>({ kind: 'idle', text: '' })

  useEffect(() => {
    setLoading(true)
    setPromoteStatus({ kind: 'idle', text: '' })
    fetch(`${API}/projects/classifier-lab/eval-results/${project.id}`)
      .then(r => r.json()).then(d => { setEvalData(d); setLoading(false) })
      .catch(() => { setEvalData(null); setLoading(false) })
  }, [project.id])

  if (loading) return <div style={{ color: EMBRY.dim, padding: 40 }}>Loading promotion data...</div>

  // Empty state — no eval results yet
  if (!evalData || evalData.error) return (
    <div style={{ ...card, maxWidth: 600, margin: '60px auto', textAlign: 'center', padding: 40 }}>
      <Rocket size={32} color={EMBRY.dim} style={{ marginBottom: 12 }} />
      <div style={{ ...heading, color: EMBRY.dim, marginBottom: 8 }}>NO CANDIDATE READY</div>
      <div style={{ ...body, fontSize: 12, color: EMBRY.dim }}>
        Run evaluation first to identify a winner for promotion.<br />
        The Evaluate tab must complete with holdout results before promoting.
      </div>
    </div>
  )

  const toFiniteNumber = (value: unknown): number => (
    typeof value === 'number' && Number.isFinite(value) ? value : 0
  )
  const formatStatus = (value: unknown, emptyLabel: string): string => {
    if (typeof value === 'boolean') return value ? 'Complete' : 'Pending'
    if (typeof value === 'string' && value.trim().length > 0) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      if (typeof record.status === 'string' && record.status.trim().length > 0) return record.status
      if (typeof record.state === 'string' && record.state.trim().length > 0) return record.state
      if (record.completed === true || record.ok === true || record.success === true) return 'Complete'
      if (record.completed === false || record.ok === false || record.success === false) return 'Pending'
    }
    return emptyLabel
  }
  const modelName = typeof evalData.model === 'string' && evalData.model.trim().length > 0
    ? evalData.model
    : (typeof evalData.winner === 'string' && evalData.winner.trim().length > 0 ? evalData.winner : 'unknown')
  const gateThreshold = toFiniteNumber(evalData.gate_threshold ?? evalData.holdout_gate_f1) || 0.90
  const macroF1 = toFiniteNumber(evalData.macro_f1 ?? evalData.f1)
  const accuracy = toFiniteNumber(evalData.accuracy)
  const holdoutPassed = typeof evalData.holdout_passed === 'boolean'
    ? evalData.holdout_passed
    : (evalData.gate_passed === true || macroF1 >= gateThreshold)
  const testSamples = toFiniteNumber(evalData.test_samples)
  const winningRound: number | undefined = evalData.winning_round
  const classes: string[] = evalData.classes || []
  const exportStatus = formatStatus(
    evalData.export_status ?? evalData.export ?? evalData.exported,
    'Not exported',
  )
  const deploymentStatus = formatStatus(
    evalData.deployment_status ?? evalData.deployment ?? evalData.deployed,
    'Not deployed',
  )
  const exportArtifacts: string[] = Array.isArray(evalData.export_artifacts)
    ? evalData.export_artifacts.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

  const promoteModel = async () => {
    if (!holdoutPassed || promoting) return
    setPromoting(true)
    setPromoteStatus({ kind: 'idle', text: '' })
    try {
      const response = await fetch(`${API}/projects/classifier-lab/promote/${project.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, macro_f1: macroF1, accuracy }),
      })
      let payload: Record<string, unknown> = {}
      try {
        payload = await response.json() as Record<string, unknown>
      } catch {
        payload = {}
      }

      if (response.ok) {
        setPromoteStatus({ kind: 'success', text: 'Promotion submitted.' })
      } else if (response.status === 404) {
        setPromoteStatus({
          kind: 'warn',
          text: 'Promote API not available. Manual step: export winner artifacts and deploy via your registry pipeline.',
        })
      } else {
        const detail = typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`
        setPromoteStatus({ kind: 'error', text: detail })
      }
    } catch {
      setPromoteStatus({
        kind: 'warn',
        text: 'Unable to reach promote API. Manual step: export winner artifacts and deploy via your registry pipeline.',
      })
    } finally {
      setPromoting(false)
    }
  }

  const gateColor = holdoutPassed ? EMBRY.green : EMBRY.red
  const gateIcon = holdoutPassed
    ? <ShieldCheck size={56} color={EMBRY.green} style={{ marginBottom: 20 }} />
    : <AlertTriangle size={56} color={EMBRY.red} style={{ marginBottom: 20 }} />

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={{ ...card, padding: 48, textAlign: 'center' }}>
        {gateIcon}
        <div style={{ ...heading, fontSize: 28, marginBottom: 8 }}>
          {holdoutPassed ? 'Promote to Production' : 'Promotion Blocked'}
        </div>
        <div style={{ ...body, color: EMBRY.dim, marginBottom: 12 }}>
          {holdoutPassed
            ? <>Candidate <b style={{ color: EMBRY.white, fontFamily: MONO }}>{modelName}</b> passed holdout gate.</>
            : <>Candidate <b style={{ color: EMBRY.white, fontFamily: MONO }}>{modelName}</b> failed holdout gate.</>
          }
        </div>

        {/* Holdout gate badge */}
        <div style={{ marginBottom: 36 }}>
          <span style={{
            ...gateBadge,
            color: gateColor,
            borderColor: gateColor + '66',
            background: gateColor + '0A',
          }}>
            HOLDOUT {holdoutPassed ? 'PASSED' : 'FAILED'} {'\u2014'} F1 {macroF1.toFixed(3)} {holdoutPassed ? '\u2265' : '<'} {gateThreshold.toFixed(2)}
          </span>
        </div>

        {/* Winner stats */}
        <div style={{ display: 'grid', gridTemplateColumns: winningRound !== undefined ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
          <StatPanel title="F1 SCORE" value={macroF1.toFixed(3)} color={macroF1 >= 0.90 ? EMBRY.green : EMBRY.red} />
          <StatPanel title="ACCURACY" value={accuracy.toFixed(3)} color={accuracy >= 0.90 ? EMBRY.green : EMBRY.red} />
          <StatPanel title="TEST SAMPLES" value={String(testSamples)} />
          {winningRound !== undefined && (
            <StatPanel title="WINNING ROUND" value={String(winningRound)} />
          )}
        </div>

        {/* Classes */}
        {classes.length > 0 && (
          <div style={{ ...panel, textAlign: 'left', marginBottom: 36 }}>
            <div style={label}>CLASSES ({classes.length})</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {classes.map(cls => (
                <span key={cls} style={{
                  ...statusBadge, fontFamily: MONO,
                  background: 'rgba(255,255,255,0.05)', color: EMBRY.white,
                  border: `1px solid ${EMBRY.border}`,
                }}>{cls}</span>
              ))}
            </div>
          </div>
        )}

        {holdoutPassed && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, textAlign: 'left', marginBottom: 36 }}>
              <div style={panel}>
                <div style={label}>EXPORT STATUS</div>
                <div style={{ marginTop: 8, fontSize: 12, fontFamily: MONO, color: exportStatus.toLowerCase().includes('not') ? EMBRY.amber : EMBRY.green }}>
                  {exportStatus}
                </div>
                {exportArtifacts.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 11, color: EMBRY.dim, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {exportArtifacts.map((artifact) => (
                      <span key={artifact} style={{ ...statusBadge, fontFamily: MONO, color: EMBRY.white, background: 'rgba(255,255,255,0.05)', border: `1px solid ${EMBRY.border}` }}>
                        {artifact}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={panel}>
                <div style={label}>DEPLOYMENT STATUS</div>
                <div style={{ marginTop: 8, fontSize: 12, fontFamily: MONO, color: deploymentStatus.toLowerCase().includes('not') ? EMBRY.amber : EMBRY.green }}>
                  {deploymentStatus}
                </div>
              </div>
            </div>

            <RunButton onClick={promoteModel} disabled={promoting}>
              {promoting ? 'PROMOTING...' : 'PROMOTE TO PRODUCTION'}
            </RunButton>
            <div style={{ marginTop: 12, fontSize: 10, color: EMBRY.dim }}>Promote endpoint: POST /api/projects/classifier-lab/promote/{project.id}</div>
            {promoteStatus.kind !== 'idle' && (
              <div style={{
                marginTop: 10,
                fontSize: 10,
                color: promoteStatus.kind === 'success'
                  ? EMBRY.green
                  : promoteStatus.kind === 'error'
                    ? EMBRY.red
                    : EMBRY.amber,
                fontFamily: MONO,
              }}>
                {promoteStatus.text}
              </div>
            )}
          </>
        )}

        {!holdoutPassed && (
          <div style={{ ...panel, marginTop: 12, border: `1px solid ${EMBRY.red}33`, background: `${EMBRY.red}08` }}>
            <div style={{ fontSize: 11, color: EMBRY.red, fontWeight: 700 }}>
              Promotion blocked until holdout gate passes (F1 &ge; 0.90).
            </div>
            <div style={{ fontSize: 10, color: EMBRY.dim, marginTop: 4 }}>
              Return to Train or Tune tabs to improve model performance, then re-evaluate.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

function StatPanel({ title, value, mono, color }: { title: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div style={panel}>
      <div style={label}>{title}</div>
      <div style={{ ...heading, fontSize: mono ? 12 : 22, fontFamily: mono ? MONO : 'inherit', color: color ?? EMBRY.white, marginTop: 4 }}>{value}</div>
    </div>
  )
}

function GpuCard({ name, vram, price, avail, active, onClick }: {
  name: string; vram: string; price: string; avail: number; active: boolean; onClick: () => void
}) {
  const barColor = avail < 10 ? EMBRY.red : avail < 40 ? EMBRY.amber : EMBRY.green
  return (
    <div onClick={onClick} style={{
      ...card, padding: 12, cursor: 'pointer',
      border: `1px solid ${active ? EMBRY.green + '66' : EMBRY.border}`,
      background: active ? 'rgba(0,255,136,0.04)' : EMBRY.bgCard,
      transition: 'all 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Cpu size={11} color={active ? EMBRY.green : EMBRY.dim} />
        <span style={{ fontSize: 10, fontWeight: 900 }}>{name}</span>
        <span style={{ fontSize: 8, color: EMBRY.dim, fontFamily: MONO }}>{vram}</span>
      </div>
      <div style={{ fontSize: 10, color: active ? EMBRY.green : EMBRY.dim, fontWeight: 700, fontFamily: MONO, marginBottom: 8 }}>{price}</div>
      <div style={{ height: 3, background: EMBRY.bgDeep, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${avail}%`, background: barColor, borderRadius: 2 }} />
      </div>
      <div style={{ fontSize: 7, color: EMBRY.dim, marginTop: 2, fontFamily: MONO }}>{avail} available</div>
    </div>
  )
}

// ── Style constants ─────────────────────────────────────────────────

// Markdown rendering CSS for Research tab
const MD_CSS = `
.clf-markdown h1 { font-size: 20px; font-weight: 900; color: #e2e8f0; margin: 0 0 16px 0; letter-spacing: -0.02em; }
.clf-markdown h2 { font-size: 14px; font-weight: 700; color: #e2e8f0; margin: 24px 0 12px 0; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; }
.clf-markdown p { margin: 8px 0; color: #94a3b8; }
.clf-markdown strong { color: #e2e8f0; }
.clf-markdown ul { padding-left: 20px; margin: 8px 0; }
.clf-markdown li { margin: 6px 0; color: #94a3b8; }
.clf-markdown li::marker { color: #00ff88; }
.clf-markdown table { width: 100%; border-collapse: collapse; margin: 12px 0; font-family: "JetBrains Mono", monospace; font-size: 11px; }
.clf-markdown th { text-align: left; padding: 8px 12px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.13); }
.clf-markdown td { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); color: #e2e8f0; }
.clf-markdown tr:hover td { background: rgba(255,255,255,0.02); }
.clf-markdown code { font-family: "JetBrains Mono", monospace; background: #0b1220; padding: 2px 6px; border-radius: 3px; font-size: 11px; color: #00ff88; }
`

const thStyle: React.CSSProperties = { padding: '12px 14px', ...label, fontSize: 8, textAlign: 'left' }
const tdStyle: React.CSSProperties = { padding: '12px 14px', fontSize: 11, fontFamily: MONO }
const statusBadge: React.CSSProperties = { padding: '2px 6px', borderRadius: 3, fontSize: 8, fontWeight: 900 }
const gateBadge: React.CSSProperties = { padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700, border: '1px solid', fontFamily: MONO }
const btnOutline: React.CSSProperties = {
  background: 'none', border: `1px solid ${EMBRY.border}`, color: EMBRY.dim,
  padding: '8px 16px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer',
}
const rerunInputStyle: React.CSSProperties = {
  width: '100%',
  background: EMBRY.bgDeep,
  border: `1px solid ${EMBRY.border}`,
  color: EMBRY.white,
  padding: '8px 10px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: MONO,
  outline: 'none',
  boxSizing: 'border-box',
}
const filterSelect: React.CSSProperties = {
  background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, color: EMBRY.white,
  padding: '4px 8px', borderRadius: 4, fontSize: 10, fontFamily: MONO, cursor: 'pointer', outline: 'none',
}
const paginationBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)', border: `1px solid ${EMBRY.border}`, color: EMBRY.dim,
  padding: '4px 12px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer',
}
