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
import { LeftPane, paneItemStyle, ContextMenu, useContextMenu } from '../common/LeftPane'
import type { ContextMenuAction } from '../common/LeftPane'
import { ImageThumb } from '../common/ImageLightbox'
import { AgentControl } from '../common/AgentControl'
import { RunButton } from '../common/RunButton'
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
  useEffect(() => {
    if (!selectedProjectId) return
    fetch(`${API}/projects/classifier-lab/benchmark-results/${selectedProjectId}`)
      .then(r => r.json()).then(setBenchmarkData)
      .catch(() => setBenchmarkData(null))
  }, [selectedProjectId])

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
      params: 0, time: '-',
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
      <LeftPane title="CLASSIFIER LAB" searchable>
        <div style={{ padding: '0 4px' }}>
          {projects.map(p => {
            const sel = p.id === selectedProjectId
            const f1Color = !p.f1 ? EMBRY.muted : p.f1 < 0.80 ? EMBRY.red : p.f1 >= 0.90 ? EMBRY.green : EMBRY.dim
            return (
              <div key={p.id} data-testid={`clf-project-${p.id}`}
                onClick={() => setSelectedProjectId(p.id)}
                onContextMenu={e => triggerContextMenu(e, p.id)}
                style={{ ...paneItemStyle(sel), display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, fontFamily: MONO, color: sel ? EMBRY.accent : EMBRY.white }}>{p.name}</div>
                  <div style={{ fontSize: 9, color: EMBRY.dim }}>{p.modality}, {p.classes} cl, {(p.samples ?? 0).toLocaleString()} spl</div>
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
          <AgentControl projectId="classifier-lab" />
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
          <div style={{ ...card, border: `1px solid ${EMBRY.green}`, textAlign: 'center', background: 'rgba(0,255,136,0.03)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <ShieldCheck size={32} color={EMBRY.green} style={{ marginBottom: 12 }} />
            <div style={{ ...heading, color: EMBRY.green, marginBottom: 8 }}>VALIDATION PASSED</div>
            <div style={{ ...body, fontSize: 12, color: EMBRY.dim }}>
              All {dataInfo.classCount} classes have {dataInfo.gateThreshold}+ training samples.
            </div>
          </div>
        )}
      </div>

      {/* Dataset file browser table */}
      <DataFileTable projectId={project.id} classes={classes.map(c => c.name)} />
    </div>
  )
}

// ── Data File Table (virtualized with @tanstack/react-table) ──────

interface DataFileRow { filename: string; className: string; split: string; path: string }
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

  const columns = useMemo(() => [
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
    fileColumnHelper.accessor('filename', {
      header: 'FILENAME',
      cell: info => <span>{info.getValue()}</span>,
    }),
    fileColumnHelper.accessor('className', {
      header: 'CLASS',
      cell: info => {
        const idx = classes.indexOf(info.getValue())
        const colors = [EMBRY.green, EMBRY.blue, EMBRY.accent, '#22d3ee', EMBRY.amber, EMBRY.red]
        return <span style={{ color: colors[idx % colors.length], fontWeight: 700 }}>{info.getValue()}</span>
      },
    }),
    fileColumnHelper.accessor('split', {
      header: 'SPLIT',
      cell: info => {
        const s = info.getValue()
        const color = s === 'train' ? EMBRY.green : s === 'val' ? EMBRY.amber : EMBRY.blue
        return <span style={{ ...statusBadge, background: `${color}15`, color }}>{s.toUpperCase()}</span>
      },
    }),
    fileColumnHelper.accessor('path', {
      header: 'PATH',
      cell: info => <span style={{ color: EMBRY.dim, fontSize: 10 }}>{info.getValue()}</span>,
    }),
  ], [classes])

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

function TrainTab({ project, rows }: { project: Project; rows: TrainingRow[] }) {
  const [selectedGpu, setSelectedGpu] = useState('local')
  const [gpuInfo, setGpuInfo] = useState<any>(null)
  const best = rows.find(r => r.status === 'pass')
  const passCount = rows.filter(r => r.status === 'pass').length
  const totalCount = rows.length

  // Fetch real GPU info
  useEffect(() => {
    fetch(`${API}/projects/classifier-lab/gpu-info`)
      .then(r => r.json()).then(setGpuInfo)
      .catch(() => setGpuInfo(null))
  }, [])

  const localGpu = gpuInfo?.gpus?.[0]

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ ...heading, fontSize: 22 }}>{project.name.toUpperCase()}</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
            <span style={{ ...gateBadge, background: 'rgba(124,58,237,0.1)', color: EMBRY.accent, borderColor: EMBRY.accent + '44' }}>TARGET: F1 ≥ 0.90</span>
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
                <td style={{ ...tdStyle, fontWeight: 700, color: r.f1 >= 0.90 ? EMBRY.green : r.f1 > 0 ? EMBRY.red : EMBRY.muted }}>
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

  const trials: any[] = tuneData.trials || []
  const completedTrials = trials.filter((t: any) => t.status === 'complete')
  const bestTrial = completedTrials.sort((a: any, b: any) => (b.testF1 || b.valF1 || 0) - (a.testF1 || a.valF1 || 0))[0]
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
            Round #{bestTrial.trial} — {bestTrial.backbone} — Test F1 {(bestTrial.testF1 || bestTrial.valF1 || 0).toFixed(3)}
          </span>
          <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 'auto' }}>
            LR={bestTrial.lr} epochs={bestTrial.epochs} augment={bestTrial.augment || '—'}
          </span>
        </div>
      )}

      {/* Round progress circles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        {trials.map((t: any, i: number) => {
          const passed = t.passed
          const isRunning = t.status === 'running'
          return (
            <div key={i} style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 900, fontFamily: MONO,
              background: passed ? EMBRY.green + '20' : isRunning ? EMBRY.amber + '20' : EMBRY.red + '15',
              color: passed ? EMBRY.green : isRunning ? EMBRY.amber : EMBRY.red,
              border: `1px solid ${passed ? EMBRY.green + '44' : isRunning ? EMBRY.amber + '44' : EMBRY.red + '33'}`,
            }}>
              {passed ? '✓' : i + 1}
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
            {trials.map((t: any) => {
              const isBest = bestTrial && t.trial === bestTrial.trial
              const testF1 = t.testF1 || 0
              const valF1 = t.valF1 || 0
              return (
                <tr key={t.trial} style={{
                  borderBottom: `1px solid ${EMBRY.border}`,
                  borderLeft: isBest ? `3px solid ${EMBRY.green}` : '3px solid transparent',
                  background: t.status === 'running' ? 'rgba(124,58,237,0.03)' : 'transparent',
                }}>
                  <td style={tdStyle}>#{t.trial}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: isBest ? EMBRY.green : EMBRY.white }}>{t.backbone}</td>
                  <td style={tdStyle}>{t.epochs || '—'}</td>
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
          {trials.length > 1 ? trials.slice(1).map((t: any, i: number) => {
            const prev = trials[i]
            const changes: string[] = []
            if (t.lr !== prev.lr) changes.push(`LR: ${prev.lr} → ${t.lr}`)
            if (t.epochs !== prev.epochs) changes.push(`Epochs: ${prev.epochs} → ${t.epochs}`)
            if (t.augment !== prev.augment) changes.push(`Augment: ${prev.augment || 'none'} → ${t.augment || 'none'}`)
            if (!changes.length) changes.push('No changes')
            return (
              <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${EMBRY.border}` }}>
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

function BenchmarkTab({ project, data: propData }: { project: Project; data?: any[] }) {
  const data = propData?.length ? propData : []
  const bestF1 = Math.max(...data.map(d => d.f1))
  const bestLat = Math.min(...data.map(d => d.lat50))

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

      {/* Parallel coordinates placeholder */}
      <div style={{ ...card, position: 'relative', padding: '40px 40px 60px' }}>
        <div style={{ ...label, marginBottom: 16 }}>HYPERPARAMETER OPTIMIZATION (PARALLEL COORDINATES)</div>
        <svg width="100%" height="200" viewBox="0 0 1000 200" style={{ overflow: 'visible' }}>
          {/* Axes */}
          {['LEARNING RATE', 'BATCH SIZE', 'DROPOUT', 'WEIGHT DECAY', 'VAL F1'].map((name, i) => {
            const x = i * 225 + 50
            return (
              <g key={name}>
                <line x1={x} y1={0} x2={x} y2={200} stroke={EMBRY.muted} strokeWidth={1} strokeDasharray="4 2" />
                <text x={x} y={220} fill={EMBRY.dim} fontSize={9} textAnchor="middle" fontWeight={700}>{name}</text>
              </g>
            )
          })}
          {/* Winner line (green) */}
          <path d="M 50 40 L 275 80 L 500 30 L 725 100 L 950 20" fill="none" stroke={EMBRY.green} strokeWidth={2.5} opacity={0.8} />
          {/* Runner-up (blue) */}
          <path d="M 50 80 L 275 60 L 500 70 L 725 80 L 950 60" fill="none" stroke={EMBRY.blue} strokeWidth={2} opacity={0.6} />
          {/* Worst (red) */}
          <path d="M 50 160 L 275 170 L 500 150 L 725 50 L 950 170" fill="none" stroke={EMBRY.red} strokeWidth={1.5} opacity={0.4} />
          {/* Legend */}
          <g>
            <line x1={800} y1={-10} x2={830} y2={-10} stroke={EMBRY.green} strokeWidth={2} />
            <text x={835} y={-7} fill={EMBRY.dim} fontSize={8}>HIGH F1</text>
            <line x1={900} y1={-10} x2={930} y2={-10} stroke={EMBRY.red} strokeWidth={2} />
            <text x={935} y={-7} fill={EMBRY.dim} fontSize={8}>LOW F1</text>
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

  const classes: string[] = evalData.classes || []
  const matrix: number[][] = evalData.confusion_matrix || []
  const perClass = classes.map(cls => evalData.per_class?.[cls] || { precision: 0, recall: 0, f1: 0, support: 0 })
  const macroF1 = evalData.macro_f1 || 0
  const accuracy = evalData.accuracy || 0
  const passed = evalData.holdout_passed === true
  const gateColor = passed ? EMBRY.green : EMBRY.red
  const maxCmVal = Math.max(...matrix.flat().map(Math.abs), 1)

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Result banner */}
      <div style={{ ...panel, border: `1px solid ${gateColor}33`, background: `${gateColor}08`, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={glowDot(gateColor, 10)} />
        <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 14 }}>
          {evalData.model} — F1 {macroF1.toFixed(3)} — HOLDOUT {passed ? 'PASSED' : 'FAILED'}
        </span>
        <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 'auto' }}>
          {evalData.test_samples} test samples
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
              HOLDOUT {passed ? 'PASSED' : 'FAILED'} — F1 {macroF1.toFixed(3)} {passed ? '≥' : '<'} 0.90
            </span>
          </div>

          {/* Accuracy */}
          <div style={{ marginTop: 12, fontSize: 11, color: EMBRY.dim, fontFamily: MONO }}>
            Accuracy: {accuracy.toFixed(3)} ({evalData.test_samples} samples)
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

  useEffect(() => {
    setLoading(true)
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

  const modelName: string = evalData.model || 'unknown'
  const macroF1: number = evalData.macro_f1 || 0
  const accuracy: number = evalData.accuracy || 0
  const holdoutPassed: boolean = evalData.holdout_passed === true
  const testSamples: number = evalData.test_samples || 0
  const winningRound: number | undefined = evalData.winning_round
  const classes: string[] = evalData.classes || []
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
            HOLDOUT {holdoutPassed ? 'PASSED' : 'FAILED'} {'\u2014'} F1 {macroF1.toFixed(3)} {holdoutPassed ? '\u2265' : '<'} 0.90
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
                <div style={label}>EXPORT ARTIFACTS</div>
                {['PyTorch (.pt)', 'ONNX', 'TorchScript'].map(a => (
                  <label key={a} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" defaultChecked style={{ accentColor: EMBRY.green }} />
                    <span style={{ fontFamily: MONO }}>{a}</span>
                  </label>
                ))}
              </div>
              <div style={panel}>
                <div style={label}>DEPLOYMENT TARGET</div>
                {['Production Registry', 'Staging', 'Extended Shadow Mode'].map((a, i) => (
                  <label key={a} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, cursor: 'pointer' }}>
                    <input type="radio" name="target" defaultChecked={i === 0} style={{ accentColor: EMBRY.green }} />
                    <span>{a}</span>
                  </label>
                ))}
              </div>
            </div>

            <RunButton onClick={() => {/* POST endpoint wired separately */}}>
              PROMOTE TO PRODUCTION
            </RunButton>
            <div style={{ marginTop: 12, fontSize: 10, color: EMBRY.dim }}>or continue in shadow mode</div>
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
const filterSelect: React.CSSProperties = {
  background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, color: EMBRY.white,
  padding: '4px 8px', borderRadius: 4, fontSize: 10, fontFamily: MONO, cursor: 'pointer', outline: 'none',
}
const paginationBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)', border: `1px solid ${EMBRY.border}`, color: EMBRY.dim,
  padding: '4px 12px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer',
}
