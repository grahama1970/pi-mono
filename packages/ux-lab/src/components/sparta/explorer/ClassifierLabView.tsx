/**
 * ClassifierLabView — Multi-modality classifier training pipeline.
 *
 * Pipeline: Research → Data → Tune → Train → Benchmark → Evaluate → Promote
 * Core product: live leaderboard of backbone candidates racing to meet a quality gate.
 * Reuses shared components: LeftPane, RunButton, EditModal, AgentControl, useAgentBus.
 */
import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import {
  AlertTriangle, Cpu, ShieldCheck, Rocket,
  ChevronDown, ChevronRight, FileText, Search, Plus, Upload, Play, Trash2, Pencil,
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

interface FailureRound {
  round: number; strategy: string; backbone: string
  f1: number; accuracy: number; diagnosis: string | null
  errors: string[] | null; hps: Record<string, unknown> | null
}

interface NextSteps {
  best_backbone: string; best_f1: number; gate_threshold: number; gap: number
  total_rounds: number; plateau_detected: boolean; diagnosis: string
  strategies_exhausted: string[]; dogpile_hypotheses: string
  timestamp: string
}

interface FailureAnalysis {
  projectId: string; totalRounds: number; bestF1: number
  strategiesTried: string[]; lastDiagnosis: string | null
  rounds: FailureRound[]
  dogpileInsights: Array<{ round: number; phase: string; query: string }>
  researchMd: string
  nextSteps: NextSteps | null
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

// ── Glossary — plain-language tooltips for technical terms ──────────

const GLOSSARY: Record<string, string> = {
  'F1': 'A score from 0 to 1 that balances how many correct predictions the model makes (precision) with how many it misses (recall). Higher is better.',
  'Macro F1': 'F1 averaged equally across all classes — treats rare classes as important as common ones.',
  'Precision': 'Of all the items the model labeled as this class, how many were actually correct.',
  'Recall': 'Of all the items that actually belong to this class, how many did the model find.',
  'Accuracy': 'Percentage of all predictions that were correct. Can be misleading if classes are imbalanced.',
  'Backbone': 'The pre-trained model architecture used as a starting point (e.g., distilbert-base-uncased). Like choosing a foundation to build on.',
  'Learning Rate': 'How much the model adjusts on each training step. Too high = unstable, too low = slow. Typical range: 1e-5 to 1e-3.',
  'Epochs': 'Number of times the model sees the entire training dataset. More epochs = more learning, but too many can cause overfitting.',
  'Batch Size': 'Number of samples processed together in one training step. Larger = faster but uses more memory.',
  'Holdout': 'A separate test set the model has never seen during training — used to check real performance.',
  'Wilson CI': 'Wilson confidence interval — a statistical range for the true score. Higher lower bound = more reliable result.',
  'Gate': 'A minimum quality threshold the model must meet before proceeding to the next step.',
  'Confusion Matrix': 'A grid showing what the model predicted vs what was correct. Green diagonal = correct, red off-diagonal = mistakes.',
  'Dropout': 'Randomly disables parts of the model during training to prevent memorizing the training data.',
  'Weight Decay': 'Penalizes large model weights to keep the model simple and generalizable.',
  'Label Smoothing': 'Slightly softens the training targets to make the model less overconfident.',
  'Augmentation': 'Artificially modifying training data (mixing, cropping, erasing) to help the model generalize better.',
  'ONNX': 'Open Neural Network Exchange — a portable model format that runs on many platforms.',
  'SafeTensors': 'A safe, fast model file format. Preferred for HuggingFace models.',
  'GGUF': 'A model format optimized for CPU inference. Used by llama.cpp and similar tools.',
}

/** Wraps a technical term with a hover tooltip from the glossary.
 * Usage: <Term>F1</Term>, <Term>Backbone</Term> */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Term({ children }: { children: string }) {
  const tip = GLOSSARY[children]
  if (!tip) return <span>{children}</span>
  return (
    <span style={{ borderBottom: '1px dotted rgba(100,116,139,0.5)', cursor: 'help', position: 'relative' }} title={tip}>
      {children}
    </span>
  )
}

// ── Pre-flight checks — deterministic "should we even attempt this?" ──

interface PreflightResult {
  check: string       // what we're checking
  passed: boolean     // did it pass
  detail: string      // what we found
  blocker?: string    // what to do if it failed
}

/** Deterministic pre-flight for each pipeline step.
 *  Each step checks whether the prerequisites from previous steps exist.
 *  No ML needed — just "does the required input exist?" */
function computePreflights(
  tab: Tab,
  project: Project,
  dataInfo: any,
  tuneConfig: any,
  trainRows: TrainingRow[],
  benchData: any,
  evalData: any,
): PreflightResult[] {
  const checks: PreflightResult[] = []

  if (tab === 'research') {
    checks.push({
      check: 'Task description defined',
      passed: !!project.name && project.name !== project.id,
      detail: project.name || 'No name',
      blocker: 'Define what this classifier is for',
    })
  }

  if (tab === 'data') {
    // Data sufficiency is handled inside DataTab's GateCard — no extra preflight needed
    return []
  }

  if (tab === 'tune') {
    const suff = dataInfo?.sufficiency
    checks.push({
      check: 'Data gate passed',
      passed: !!dataInfo?.gatePassed,
      detail: suff ? `${suff.available} samples (need ${suff.required})` : dataInfo?.gatePassed ? 'Yes' : 'No data',
      blocker: suff && !suff.sufficient ? `Need ${suff.deficit} more samples` : 'Add training data in Data tab',
    })
  }

  if (tab === 'train') {
    checks.push({
      check: 'Data sufficient for training',
      passed: !!dataInfo?.gatePassed,
      detail: dataInfo?.gatePassed ? 'Yes' : 'Data gate not passed',
      blocker: 'Fix data issues in Data tab first',
    })
    checks.push({
      check: 'Tune config set by agent or human (not defaults)',
      passed: !!tuneConfig && tuneConfig._source && tuneConfig._source !== 'default' && !tuneConfig._source?.startsWith('default-'),
      detail: tuneConfig?._source ? `Source: ${tuneConfig._source}` : 'Not configured',
      blocker: 'Run /dogpile research first — it sets initial HP recommendations. Or configure manually in Tune tab.',
    })
  }

  if (tab === 'benchmark') {
    const hasResults = trainRows.length > 0 || (benchData?.results?.length > 0)
    checks.push({
      check: 'Trained models exist to compare',
      passed: hasResults,
      detail: hasResults ? `${trainRows.length || benchData?.results?.length || 0} backbones` : 'No models trained',
      blocker: 'Run training in Train tab first',
    })
  }

  if (tab === 'evaluate') {
    const hasModel = !!benchData?.selected_backbone || trainRows.some(r => r.status === 'pass')
    checks.push({
      check: 'Trained model available',
      passed: hasModel,
      detail: hasModel ? (benchData?.selected_backbone || 'Model available') : 'No model',
      blocker: 'Train a model first in Train tab',
    })
  }

  if (tab === 'promote') {
    checks.push({
      check: 'Evaluation completed',
      passed: !!evalData && !evalData.error,
      detail: evalData?.macro_f1 ? `F1 ${evalData.macro_f1.toFixed(3)}` : 'No eval results',
      blocker: 'Run evaluation in Evaluate tab first',
    })
    if (evalData?.macro_f1) {
      const gate = evalData.gate_threshold ?? evalData.holdout_gate_f1 ?? 0.90
      checks.push({
        check: 'Holdout gate passed',
        passed: evalData.holdout_passed ?? evalData.macro_f1 >= gate,
        detail: `F1 ${evalData.macro_f1.toFixed(3)} vs ${gate.toFixed(2)} target`,
        blocker: 'Improve model performance — go to Train tab',
      })
    }
  }

  return checks
}

/** Renders pre-flight checks as a compact bar above the tab content */
function PreflightBar({ checks }: { checks: PreflightResult[] }) {
  if (!checks.length) return null
  const allPassed = checks.every(c => c.passed)
  const blockers = checks.filter(c => !c.passed)

  if (allPassed) return null  // Don't show anything if all pre-flights pass

  return (
    <div style={{
      ...card, marginBottom: 16, padding: '12px 16px',
      border: `1px solid ${EMBRY.amber}33`, background: `${EMBRY.amber}04`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: blockers.length > 0 ? 10 : 0 }}>
        <AlertTriangle size={14} color={EMBRY.amber} />
        <span style={{ fontSize: 11, fontWeight: 900, color: EMBRY.amber }}>
          PRE-FLIGHT: {blockers.length} blocker{blockers.length === 1 ? '' : 's'}
        </span>
      </div>
      {blockers.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: i < blockers.length - 1 ? 6 : 0 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: EMBRY.amber, marginTop: 5, flexShrink: 0 }} />
          <div>
            <span style={{ fontSize: 10, fontWeight: 700, color: EMBRY.white }}>{c.check}</span>
            <span style={{ fontSize: 10, color: EMBRY.dim }}> — {c.detail}</span>
            {c.blocker && <div style={{ fontSize: 9, color: EMBRY.amber, marginTop: 2 }}>→ {c.blocker}</div>}
          </div>
        </div>
      ))}
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
  const [creating, setCreating] = useState(false)
  const [filterModality, setFilterModality] = useState<string>('')
  const [mainDataInfo, setMainDataInfo] = useState<any>(null)
  const [mainTuneConfig, setMainTuneConfig] = useState<any>(null)
  const [mainEvalData, setMainEvalData] = useState<any>(null)

  // Sync tab from parent subpath (browser back/forward)
  useEffect(() => {
    const t = (initialTab || '').toLowerCase() as Tab
    if (TABS.includes(t) && t !== activeTab) setActiveTab(t)
  }, [initialTab]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Check data gate + fetch preflight data on project change
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
                  onClick={() => { if (!blocked) { setActiveTab(t); window.location.hash = `classifier-lab/${t}` } }}
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

        {/* Tab content — each tab gets a pre-flight check */}
        <main data-testid="clf-main" style={{ flex: 1, overflowY: 'auto', padding: 28 }}>
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

// ── Research Tab ─────────────────────────────────────────────────────

interface ResearchTimelineEntry {
  round: number; phase: string; query: string
  resultLength: number; timestamp: number
}

function ResearchTab({ projectId, gateInfo }: { projectId: string; gateInfo?: any }) {
  const [md, setMd] = useState('')
  const [timeline, setTimeline] = useState<ResearchTimelineEntry[]>([])
  const [nextStepsQuery, setNextStepsQuery] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(-1) // -1 = primary research doc
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/projects/classifier-lab/research/${projectId}`)
      .then(r => r.json())
      .then(d => {
        setMd(d.markdown || '')
        setTimeline(Array.isArray(d.timeline) ? d.timeline : [])
        setNextStepsQuery(d.nextStepsQuery || null)
        setSelectedIdx(-1)
        setLoading(false)
      })
      .catch(() => { setMd(''); setTimeline([]); setLoading(false) })
  }, [projectId])

  if (loading) return <div style={{ color: EMBRY.dim, padding: 40 }}>Loading research...</div>

  if (!md && timeline.length === 0) return (
    <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
      <div style={card}>
        <div style={{ padding: 40 }}>
          <FileText size={32} color={EMBRY.dim} style={{ marginBottom: 12 }} />
          <div style={{ ...heading, color: EMBRY.dim, marginBottom: 8 }}>NO RESEARCH OUTPUT</div>
          <div style={{ ...body, fontSize: 12, color: EMBRY.muted }}>
            Run <code style={{ color: EMBRY.accent, fontFamily: MONO }}>/dogpile</code> to research optimal backbones for this task.
          </div>
        </div>
      </div>
    </div>
  )

  // Build the list of selectable items: primary doc + timeline entries + next-steps
  const items: Array<{ label: string; sublabel: string; color: string; idx: number }> = []
  if (md) items.push({ label: 'INITIAL RESEARCH', sublabel: 'Pre-training /dogpile', color: EMBRY.accent, idx: -1 })
  timeline.forEach((t, i) => {
    const phaseLabel = t.phase === 'research' ? 'Pre-training' :
      t.phase.startsWith('round-') ? `Round ${t.round} failure` :
      t.phase === 'targeted-research' ? 'Targeted' : t.phase
    items.push({
      label: `R${t.round}`,
      sublabel: phaseLabel,
      color: t.round === 0 ? EMBRY.accent : EMBRY.amber,
      idx: i,
    })
  })
  if (nextStepsQuery) items.push({ label: 'NEXT STEPS', sublabel: 'Post-exhaustion hypothesis', color: EMBRY.green, idx: -2 })

  // Determine what to show in the detail pane
  let detailTitle = ''
  let detailContent = ''
  let detailMeta = ''
  let detailIsMarkdown = false

  if (selectedIdx === -1 && md) {
    detailTitle = 'Initial Research'
    detailContent = md
    detailIsMarkdown = true
  } else if (selectedIdx === -2 && nextStepsQuery) {
    detailTitle = 'Next-Step Hypotheses'
    detailContent = nextStepsQuery
    detailIsMarkdown = true
    detailMeta = 'Generated after all training rounds exhausted'
  } else if (selectedIdx >= 0 && selectedIdx < timeline.length) {
    const entry = timeline[selectedIdx]
    detailTitle = `Round ${entry.round} — ${entry.phase}`
    detailContent = entry.query
    detailMeta = `${entry.resultLength.toLocaleString()} chars returned · ${new Date(entry.timestamp * 1000).toLocaleString()}`
  }

  const hasTimeline = items.length > 1

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
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

      {/* Split-pane: timeline nav (left) + detail (right) */}
      {hasTimeline ? (
        <div style={{ display: 'flex', border: `1px solid ${EMBRY.border}`, borderRadius: 8, overflow: 'hidden', minHeight: 500 }}>
          {/* Left nav */}
          <div style={{ width: 220, flexShrink: 0, borderRight: `1px solid ${EMBRY.border}`, background: EMBRY.bgCard, overflowY: 'auto' }}>
            <div style={{ ...label, padding: '12px 14px 8px', fontSize: 8 }}>RESEARCH TIMELINE</div>
            {items.map(item => {
              const isActive = item.idx === selectedIdx
              return (
                <button
                  key={item.idx}
                  onClick={() => setSelectedIdx(item.idx)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: isActive ? 'rgba(124,58,237,0.08)' : 'transparent',
                    border: 'none', borderLeft: isActive ? `3px solid ${item.color}` : '3px solid transparent',
                    padding: '10px 14px', cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, fontFamily: MONO, color: isActive ? item.color : EMBRY.dim }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 9, color: isActive ? EMBRY.white : EMBRY.muted, marginTop: 2 }}>
                    {item.sublabel}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Right detail */}
          <div style={{ flex: 1, padding: 28, overflowY: 'auto', background: EMBRY.bg }}>
            {detailTitle && (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
                  <span style={{ ...heading, fontSize: 16, color: EMBRY.white }}>{detailTitle}</span>
                  {detailMeta && <span style={{ fontSize: 9, color: EMBRY.muted, fontFamily: MONO }}>{detailMeta}</span>}
                </div>
                {detailIsMarkdown ? (
                  <div className="clf-markdown" style={{ ...body, lineHeight: 1.8 }}
                    dangerouslySetInnerHTML={{ __html: marked(detailContent) as string }} />
                ) : (
                  <div style={{
                    background: EMBRY.bgCard, borderLeft: `3px solid ${EMBRY.accent}`,
                    padding: 16, borderRadius: 4, fontFamily: MONO, fontSize: 11,
                    color: EMBRY.white, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                  }}>
                    {detailContent}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        /* No timeline — just show the primary research doc */
        <div style={{ ...card, padding: 32 }}>
          <div className="clf-markdown" style={{ ...body, lineHeight: 1.8 }}
            dangerouslySetInnerHTML={{ __html: marked(md) as string }} />
        </div>
      )}
    </div>
  )
}

// ── Data Tab ────────────────────────────────────────────────────────

function DataTab({ project, onGateChange }: { project: Project; onGateChange: (passed: boolean) => void }) {
  const [dataInfo, setDataInfo] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [enriching, setEnriching] = useState(false)
  const [enrichResult, setEnrichResult] = useState<any>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/projects/classifier-lab/data/${project.id}`)
      .then(r => r.json()).then(d => { setDataInfo(d); setLoading(false); onGateChange(d.gatePassed ?? false) })
      .catch(() => { setLoading(false); onGateChange(false) })
    fetch(`${API}/projects/classifier-lab/data/${project.id}/profile`)
      .then(r => r.json()).then(d => { if (!d.error) setProfile(d) })
      .catch(() => {})
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
  const suff = dataInfo.sufficiency as { required: number; available: number; sufficient: boolean; deficit: number; minPerClass: number; minRequired: number; isMultiLabel: boolean; perClassDeficit?: Array<{ name: string; have: number; need: number }> } | null

  // Color assignment per class
  const CLASS_COLORS = [EMBRY.green, EMBRY.blue, EMBRY.accent, '#22d3ee', EMBRY.amber, EMBRY.red]

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Data sufficiency gate — deterministic pre-flight check */}
      <div style={{ marginBottom: 20 }}>
        <GateCard
          name="DATA GATE"
          passed={passed}
          metrics={[
            { label: 'TRAIN SAMPLES', value: String(suff?.available ?? dataInfo.totalTrain ?? '—') },
            { label: 'CLASSES', value: String(dataInfo.classCount ?? classes.length ?? '—') },
            { label: 'MIN / CLASS', value: String(dataInfo.minPerClass ?? '—'), color: suff && suff.minPerClass < suff.minRequired ? EMBRY.red : EMBRY.green },
          ]}
          checks={[
            { label: `≥ ${suff?.minRequired ?? 100} samples per class`, ok: suff ? suff.minPerClass >= suff.minRequired : passed, detail: suff ? `min: ${suff.minPerClass}` : '—' },
            { label: `Total ≥ ${suff?.required ?? '?'} (${dataInfo.classCount ?? '?'} classes × ${suff?.minRequired ?? 100})`, ok: suff ? suff.sufficient : passed, detail: suff ? `${suff.available} / ${suff.required}` : '—' },
            { label: 'Has validation split', ok: classes.some(c => c.val > 0), detail: classes.some(c => c.val > 0) ? 'Yes' : 'No val split' },
            { label: 'Has test split', ok: classes.some(c => c.test > 0), detail: classes.some(c => c.test > 0) ? 'Yes' : 'No test split' },
          ]}
          halt={suff && !suff.sufficient ? {
            reason: `Need ${suff.required.toLocaleString()} training samples (${dataInfo.classCount} classes × ${suff.minRequired} per class). Have ${suff.available.toLocaleString()} — short by ${suff.deficit.toLocaleString()}.${suff.perClassDeficit && suff.perClassDeficit.length > 0 ? ` ${suff.perClassDeficit.length} classes below minimum.` : ''}`,
            action: `Search HuggingFace and GitHub for additional training data, or mine conversation transcripts.`,
          } : null}
        />
      </div>

      {/* Data enrichment — triggered when gate halts */}
      {suff && !suff.sufficient && (
        <div style={{ ...card, marginBottom: 20, padding: 16, border: `1px solid ${EMBRY.accent}33` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: enrichResult ? 12 : 0 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: EMBRY.white }}>DATA ENRICHMENT</div>
              <div style={{ fontSize: 9, color: EMBRY.dim, marginTop: 2 }}>
                Searches HuggingFace → GitHub → conversation transcripts until sufficient or exhausted
              </div>
            </div>
            <button
              onClick={async () => {
                setEnriching(true)
                setEnrichResult(null)
                try {
                  const resp = await fetch(`${API}/projects/classifier-lab/data/${project.id}/enrich`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ min_per_class: suff.minRequired }),
                  })
                  const result = await resp.json()
                  setEnrichResult(result)
                  // Reload data info
                  const d = await fetch(`${API}/projects/classifier-lab/data/${project.id}`).then(r => r.json())
                  setDataInfo(d)
                  onGateChange(d.gatePassed ?? false)
                } catch (e) {
                  setEnrichResult({ status: 'error', error: String(e) })
                }
                setEnriching(false)
              }}
              disabled={enriching}
              style={{
                background: EMBRY.accent, border: 'none', color: '#000',
                padding: '8px 16px', borderRadius: 6, fontSize: 10, fontWeight: 900,
                cursor: enriching ? 'default' : 'pointer', opacity: enriching ? 0.5 : 1,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Search size={12} />
              {enriching ? 'SEARCHING...' : 'SEARCH FOR MORE DATA'}
            </button>
          </div>
          {enrichResult && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 4, fontSize: 10, fontFamily: MONO,
              background: enrichResult.status === 'sufficient' ? 'rgba(0,255,136,0.06)' : enrichResult.status === 'abandoned' ? 'rgba(255,68,68,0.06)' : 'rgba(255,170,0,0.06)',
              color: enrichResult.status === 'sufficient' ? EMBRY.green : enrichResult.status === 'abandoned' ? EMBRY.red : EMBRY.amber,
              border: `1px solid ${enrichResult.status === 'sufficient' ? EMBRY.green : enrichResult.status === 'abandoned' ? EMBRY.red : EMBRY.amber}22`,
            }}>
              {enrichResult.status === 'sufficient' && `Data sufficient! ${enrichResult.total_train} samples now available (needed ${enrichResult.required}).`}
              {enrichResult.status === 'abandoned' && `Enrichment exhausted. Searched HuggingFace + transcripts — not enough matching data found. ${enrichResult.total_train || 0} samples available.`}
              {enrichResult.status === 'insufficient' && `Found some data but still insufficient. ${enrichResult.total_train || 0} / ${enrichResult.required || '?'} samples.`}
              {enrichResult.error && `Error: ${enrichResult.error}`}
              {enrichResult.attempts && (
                <div style={{ marginTop: 4, fontSize: 9, color: EMBRY.dim }}>
                  Strategies tried: {enrichResult.attempts.map((a: any) => `${a.strategy} (${a.new_samples || 0} found)`).join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 32 }}>
        <StatPanel title="SOURCE" value={dataInfo.path?.split('/').slice(-2).join('/') || project.id} mono />
        <StatPanel title="MODALITY" value={dataInfo.modality || project.modality || '—'} color={EMBRY.green} />
        <StatPanel title="TRAIN SAMPLES" value={String(dataInfo.totalTrain ?? dataInfo.totalSamples ?? '—')} />
        <StatPanel title="CLASSES" value={String(dataInfo.classCount ?? classes.length ?? '—')} />
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
          <div style={card}>
            {/* Data gate passed */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <ShieldCheck size={18} color={EMBRY.green} />
              <span style={{ fontSize: 12, fontWeight: 900, color: EMBRY.green }}>DATA GATE PASSED</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 2 }}>CLASSES</div>
                <div style={{ fontSize: 18, fontWeight: 900, fontFamily: MONO }}>{dataInfo.classCount}</div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 2 }}>MIN / CLASS</div>
                <div style={{ fontSize: 18, fontWeight: 900, fontFamily: MONO, color: EMBRY.green }}>{dataInfo.minPerClass}</div>
              </div>
            </div>
            {/* Split breakdown */}
            <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12 }}>
              <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 8 }}>SPLIT BREAKDOWN</div>
              {['train', 'val', 'test'].map(split => {
                const count = classes.reduce((sum, c) => sum + ((c as any)[split] || 0), 0)
                const total = dataInfo.totalTrain + classes.reduce((s, c) => s + c.val + c.test, 0)
                const pct = total > 0 ? ((count / total) * 100).toFixed(0) : '0'
                return (
                  <div key={split} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontFamily: MONO, width: 40, color: EMBRY.dim }}>{split}</span>
                    <div style={{ flex: 1, height: 4, background: EMBRY.bgDeep, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: split === 'train' ? EMBRY.accent : split === 'val' ? EMBRY.blue : EMBRY.amber, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 10, fontFamily: MONO, color: EMBRY.dim, width: 60, textAlign: 'right' }}>{count} ({pct}%)</span>
                  </div>
                )
              })}
            </div>
            {/* Data quality checks */}
            <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12, marginTop: 12 }}>
              <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 6 }}>QUALITY CHECKS</div>
              {[
                { label: 'Min samples/class met', ok: true },
                { label: 'All classes have val+test splits', ok: classes.every(c => c.val > 0 && c.test > 0) },
                { label: 'Class balance ratio', ok: dataInfo.minPerClass / Math.max(...classes.map(c => c.train), 1) > 0.5, detail: `${(dataInfo.minPerClass / Math.max(...classes.map(c => c.train), 1) * 100).toFixed(0)}%` },
              ].map((check, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: check.ok ? EMBRY.green : EMBRY.amber }} />
                  <span style={{ color: EMBRY.dim }}>{check.label}</span>
                  {check.detail && <span style={{ fontFamily: MONO, color: check.ok ? EMBRY.green : EMBRY.amber, marginLeft: 'auto' }}>{check.detail}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Data profile panel */}
      {profile && <DataProfilePanel profile={profile} />}

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

      {/* Next-steps teaser when gate not met */}
      {!gatePassed && <NextStepsTeaser projectId={projectId} />}
    </div>
  )
}

/** Compact next-steps preview shown inside the GATE NOT MET card. */
function NextStepsTeaser({ projectId }: { projectId: string }) {
  const [ns, setNs] = useState<NextSteps | null>(null)
  const [showModal, setShowModal] = useState(false)
  useEffect(() => {
    fetch(`${API}/projects/classifier-lab/failure-analysis/${projectId}`)
      .then(r => r.json()).then((d: FailureAnalysis) => setNs(d.nextSteps ?? null))
      .catch(() => {})
  }, [projectId])

  if (!ns) return null

  // Render first hypothesis only as teaser
  const fullMd = ns.dogpile_hypotheses || ''
  const firstHypothesis = fullMd.split(/(?=###\s+Hypothesis\s+2)/i)[0]?.trim() || ''
  const hasMore = fullMd.includes('Hypothesis 2')

  return (
    <>
      <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12, marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Cpu size={10} color={EMBRY.accent} />
          <span style={{ fontSize: 9, fontWeight: 700, color: EMBRY.accent }}>NEXT STEPS (via /dogpile)</span>
          <span style={{ fontSize: 8, color: EMBRY.dim, marginLeft: 'auto' }}>
            gap: {ns.gap.toFixed(3)}{ns.plateau_detected ? ' | PLATEAU' : ''}
          </span>
        </div>
        {firstHypothesis ? (
          <>
            <div
              className="next-steps-teaser"
              style={{ fontSize: 10, color: EMBRY.white, lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: marked.parse(firstHypothesis) as string }}
            />
            {hasMore && (
              <button
                onClick={() => setShowModal(true)}
                style={{
                  background: 'none', border: `1px solid ${EMBRY.accent}44`, borderRadius: 4,
                  color: EMBRY.accent, fontSize: 9, fontWeight: 700, padding: '4px 10px',
                  cursor: 'pointer', marginTop: 8,
                }}
              >
                VIEW ALL HYPOTHESES
              </button>
            )}
          </>
        ) : (
          <div style={{ fontSize: 9, color: EMBRY.dim, fontStyle: 'italic' }}>
            Hypotheses generating after pipeline completes...
          </div>
        )}
      </div>

      {/* Full hypotheses modal */}
      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.75)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: EMBRY.bgCard, border: `1px solid ${EMBRY.accent}44`,
              borderRadius: 10, maxWidth: 720, width: '90vw', maxHeight: '80vh',
              overflow: 'auto', padding: 28, position: 'relative',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Cpu size={16} color={EMBRY.accent} />
              <span style={{ ...heading, color: EMBRY.accent, fontSize: 14 }}>
                NEXT-STEP HYPOTHESES
              </span>
              <span style={{ fontSize: 9, color: EMBRY.dim, marginLeft: 'auto' }}>
                {ns.strategies_exhausted.length} strategies exhausted | gap: {ns.gap.toFixed(3)}
              </span>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'none', border: 'none', color: EMBRY.dim,
                  fontSize: 18, cursor: 'pointer', padding: '0 4px',
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 12, fontFamily: MONO }}>
              {ns.strategies_exhausted.join(' → ')}
            </div>
            <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 16 }}>
              <div
                className="next-steps-full"
                style={{ fontSize: 12, color: EMBRY.white, lineHeight: 1.7 }}
                dangerouslySetInnerHTML={{ __html: marked.parse(fullMd) as string }}
              />
            </div>
            {ns.diagnosis && (
              <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 6, background: 'rgba(255,170,0,0.06)', border: `1px solid ${EMBRY.amber}33` }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: EMBRY.amber, marginBottom: 4 }}>DIAGNOSIS</div>
                <div style={{ fontSize: 10, color: EMBRY.dim, fontFamily: MONO }}>{ns.diagnosis}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ── Data Profile Panel ─────────────────────────────────────────────

function DataProfilePanel({ profile }: { profile: any }) {
  const modality = profile.modality || 'text'
  const q = profile.quality || {}

  // Build quality checks based on modality
  const qualityChecks: Array<{ label: string; ok: boolean; detail: string }> = []
  if (modality === 'text') {
    qualityChecks.push(
      { label: 'Empty texts', ok: (q.emptyTexts ?? 0) === 0, detail: String(q.emptyTexts ?? 0) },
      { label: 'Short texts (<5 words)', ok: (q.shortTexts ?? 0) === 0, detail: String(q.shortTexts ?? 0) },
      { label: 'Duplicate texts', ok: (q.duplicateTexts ?? 0) === 0, detail: String(q.duplicateTexts ?? 0) },
      { label: 'Conflicting labels', ok: (q.conflictingLabels ?? 0) === 0, detail: String(q.conflictingLabels ?? 0) },
    )
  } else if (modality === 'vision') {
    qualityChecks.push(
      { label: 'Corrupt images', ok: (q.corruptImages ?? 0) === 0, detail: String(q.corruptImages ?? 0) },
      { label: 'Uniform dimensions', ok: !q.needsResize, detail: q.needsResize ? `${q.uniqueDimensions} sizes` : 'Yes' },
      { label: 'Duplicate paths', ok: (q.duplicatePaths ?? 0) === 0, detail: String(q.duplicatePaths ?? 0) },
    )
  } else if (modality === 'tabular') {
    qualityChecks.push(
      { label: 'Columns with nulls', ok: (q.columnsWithNulls ?? 0) === 0, detail: String(q.columnsWithNulls ?? 0) },
      { label: 'Total null values', ok: (q.totalNulls ?? 0) === 0, detail: String(q.totalNulls ?? 0) },
      { label: 'Constant columns', ok: (q.constantColumns?.length ?? 0) === 0, detail: String(q.constantColumns?.length ?? 0) },
      { label: 'High cardinality', ok: (q.highCardinality?.length ?? 0) === 0, detail: String(q.highCardinality?.length ?? 0) },
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginTop: 24, marginBottom: 24 }}>
      {/* Column 1: Modality-specific stats */}
      <div style={card}>
        {modality === 'text' && profile.textStats && (
          <>
            <div style={{ ...label, marginBottom: 12 }}>TEXT STATISTICS</div>
            <ProfileStatsTable rows={[
              { label: 'Words', ...profile.textStats, min: profile.textStats.wordMin, max: profile.textStats.wordMax, mean: profile.textStats.wordMean, median: profile.textStats.wordMedian },
              { label: 'Chars', min: profile.textStats.charMin, max: profile.textStats.charMax, mean: profile.textStats.charMean, median: profile.textStats.charMedian },
            ]} />
            <div style={{ marginTop: 12, fontSize: 10, fontFamily: MONO, color: EMBRY.dim }}>
              Vocabulary: <span style={{ color: EMBRY.accent, fontWeight: 700 }}>{profile.vocabSize?.toLocaleString()}</span> unique tokens
            </div>
          </>
        )}
        {modality === 'vision' && profile.imageStats && (
          <>
            <div style={{ ...label, marginBottom: 12 }}>IMAGE STATISTICS</div>
            <ProfileStatsTable rows={[
              { label: 'Width (px)', ...profile.imageStats.width },
              { label: 'Height (px)', ...profile.imageStats.height },
              { label: 'File size (B)', ...profile.imageStats.fileSize },
            ]} />
            {profile.imageStats.channels && (
              <div style={{ marginTop: 12, fontSize: 10, fontFamily: MONO, color: EMBRY.dim }}>
                Channels: {Object.entries(profile.imageStats.channels).map(([ch, ct]) => `${ch}ch: ${ct}`).join(', ')}
              </div>
            )}
          </>
        )}
        {modality === 'tabular' && (
          <>
            <div style={{ ...label, marginBottom: 12 }}>FEATURE COLUMNS ({profile.featureCount})</div>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {(profile.columns || []).slice(0, 10).map((col: any) => (
                <div key={col.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 10 }}>
                  <span style={{ fontFamily: MONO, fontWeight: 700, flex: 1 }}>{col.name}</span>
                  <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: col.dtype === 'numeric' ? 'rgba(0,255,136,0.1)' : 'rgba(124,58,237,0.1)', color: col.dtype === 'numeric' ? EMBRY.green : EMBRY.accent }}>
                    {col.dtype}
                  </span>
                  {col.nulls > 0 && <span style={{ fontSize: 8, color: EMBRY.red }}>{col.nullPct}% null</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Column 2: Per-class breakdown */}
      <div style={card}>
        <div style={{ ...label, marginBottom: 12 }}>
          {modality === 'text' ? 'WORDS PER CLASS' : 'SAMPLES PER CLASS'}
        </div>
        {Object.entries(profile.perClass || {}).map(([cls, info]: [string, any]) => {
          const allCounts = Object.values(profile.perClass || {}).map((v: any) => v.mean_words || v.count || 0)
          const maxVal = Math.max(...allCounts) * 1.2 || 1
          const barVal = info.mean_words || info.count || 0
          return (
            <div key={cls} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontFamily: MONO }}>{cls}</span>
                <span style={{ color: EMBRY.dim, fontFamily: MONO }}>
                  {info.mean_words != null ? `${info.min_words}–${info.max_words} (μ ${info.mean_words})` : `${info.count} samples`}
                </span>
              </div>
              <div style={{ height: 4, background: EMBRY.bgDeep, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(barVal / maxVal) * 100}%`, height: '100%', background: EMBRY.blue, borderRadius: 2 }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Column 3: Quality checks */}
      <div style={card}>
        <div style={{ ...label, marginBottom: 12 }}>DATA QUALITY</div>
        {qualityChecks.map((check, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '6px 0', borderBottom: i < qualityChecks.length - 1 ? `1px solid ${EMBRY.border}` : 'none' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: check.ok ? EMBRY.green : EMBRY.red, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: EMBRY.dim, flex: 1 }}>{check.label}</span>
            <span style={{ fontSize: 12, fontFamily: MONO, fontWeight: 700, color: check.ok ? EMBRY.green : EMBRY.red }}>
              {check.detail}
            </span>
          </div>
        ))}
        {profile.topWords && (
          <div style={{ marginTop: 12, borderTop: `1px solid ${EMBRY.border}`, paddingTop: 10 }}>
            <div style={{ fontSize: 8, color: EMBRY.muted, marginBottom: 6 }}>TOP TOKENS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {profile.topWords.slice(0, 12).map((tw: any) => (
                <span key={tw.word} style={{
                  fontSize: 9, fontFamily: MONO, padding: '2px 6px', borderRadius: 3,
                  background: 'rgba(124,58,237,0.1)', color: EMBRY.dim,
                }}>
                  {tw.word} <span style={{ color: EMBRY.muted }}>{tw.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Reusable min/max/mean/median stats table */
function ProfileStatsTable({ rows }: { rows: Array<{ label: string; min: number; max: number; mean: number; median: number }> }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
          {['', 'MIN', 'MAX', 'MEAN', 'MEDIAN'].map(h => (
            <th key={h} style={{ ...label, fontSize: 7, padding: '4px 6px', textAlign: h ? 'right' : 'left' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.label} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${EMBRY.border}` : 'none' }}>
            <td style={{ fontSize: 10, padding: '6px', color: EMBRY.dim }}>{row.label}</td>
            <td style={{ fontSize: 11, padding: '6px', fontFamily: MONO, textAlign: 'right' }}>{row.min}</td>
            <td style={{ fontSize: 11, padding: '6px', fontFamily: MONO, textAlign: 'right' }}>{row.max}</td>
            <td style={{ fontSize: 11, padding: '6px', fontFamily: MONO, textAlign: 'right' }}>{row.mean}</td>
            <td style={{ fontSize: 11, padding: '6px', fontFamily: MONO, textAlign: 'right', fontWeight: 700 }}>{row.median}</td>
          </tr>
        ))}
      </tbody>
    </table>
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

function TrainTab({ project, rows }: { project: Project; rows: TrainingRow[] }) {
  const [selectedGpu, setSelectedGpu] = useState('local')
  const [gpuInfo, setGpuInfo] = useState<any>(null)
  const [backbonesInput, setBackbonesInput] = useState('')
  const [gateF1Input, setGateF1Input] = useState('0.90')
  const [maxRoundsInput, setMaxRoundsInput] = useState('5')
  const [maxTrainSamplesInput, setMaxTrainSamplesInput] = useState('10000')
  const [trainSorting, setTrainSorting] = useState<SortingState>([{ id: 'f1', desc: true }])
  const [retrying, setRetrying] = useState<string | null>(null)
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

      {/* Train gate card */}
      <div style={{ marginBottom: 20 }}>
        <GateCard
          name="TRAIN GATE"
          passed={passCount > 0}
          metrics={[
            { label: 'BEST F1', value: best ? best.f1.toFixed(3) : rows.length > 0 ? Math.max(...rows.map(r => r.f1)).toFixed(3) : '—', color: best ? EMBRY.green : rows.length > 0 ? EMBRY.red : EMBRY.dim },
            { label: 'BACKBONES', value: String(totalCount) },
            { label: 'PASSED', value: `${passCount} / ${totalCount}`, color: passCount > 0 ? EMBRY.green : EMBRY.red },
          ]}
          checks={[
            { label: 'Gate met by ≥1 backbone', ok: passCount > 0, detail: passCount > 0 ? `${passCount} passed` : 'No' },
            { label: 'No crashed runs', ok: !rows.some(r => r.status === 'fail' && r.f1 === 0), detail: rows.filter(r => r.f1 === 0).length > 0 ? `${rows.filter(r => r.f1 === 0).length} crashed` : 'Clean' },
            { label: 'All runs complete', ok: !rows.some(r => r.status === 'training' || r.status === 'queued'), detail: rows.filter(r => r.status === 'training' || r.status === 'queued').length > 0 ? 'In progress' : 'Yes' },
          ]}
          halt={passCount === 0 && totalCount > 0 && !rows.some(r => r.status === 'training' || r.status === 'queued') ? (() => {
            const bestF1 = rows.length > 0 ? Math.max(...rows.map(r => r.f1)) : 0
            const gap = rerunGateF1 - bestF1
            if (gap > 0.3) return { reason: `Best F1 (${bestF1.toFixed(3)}) is ${gap.toFixed(3)} below gate — this is likely a data problem, not a model problem.`, action: 'Add more training data, especially for underperforming classes. Check the Data tab for class balance. Consider lowering the gate threshold if the task is inherently difficult.' }
            if (gap > 0.1) return { reason: `Best F1 (${bestF1.toFixed(3)}) is ${gap.toFixed(3)} below gate — significant gap remaining after all backbones tried.`, action: 'Try a larger backbone model, increase epochs, or tune hyperparameters on the Tune tab. Check Failure Analysis below for specific /dogpile suggestions.' }
            return { reason: `Best F1 (${bestF1.toFixed(3)}) is close but ${gap.toFixed(3)} below gate.`, action: 'Small gap — try label smoothing, learning rate warmup, or ensemble of top backbones on the Tune tab.' }
          })() : null}
        />
      </div>

      {/* Rerun config — clearer labels with tooltips */}
      <div style={{ ...card, marginBottom: 14, padding: 16 }}>
        <div style={{ ...label, marginBottom: 12 }}>TRAINING CONFIGURATION</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <div style={{ ...label, fontSize: 8, marginBottom: 6, cursor: 'help', borderBottom: '1px dotted rgba(100,116,139,0.4)', display: 'inline-block' }} title="Comma-separated list of pre-trained model architectures to race against each other">BACKBONES</div>
            <input
              value={backbonesInput}
              onChange={(e) => setBackbonesInput(e.target.value)}
              placeholder="resnet50, efficientnet_b0, convnext_tiny"
              style={rerunInputStyle}
            />
          </div>
          <div>
            <div style={{ ...label, fontSize: 8, marginBottom: 6, cursor: 'help', borderBottom: '1px dotted rgba(100,116,139,0.4)', display: 'inline-block' }} title="Minimum macro F1 score on held-out test set to pass the quality gate">TARGET F1</div>
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
            <div style={{ ...label, fontSize: 8, marginBottom: 6, cursor: 'help', borderBottom: '1px dotted rgba(100,116,139,0.4)', display: 'inline-block' }} title="Maximum self-improvement iterations per backbone before escalating to next strategy">MAX ROUNDS</div>
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
            <div style={{ ...label, fontSize: 8, marginBottom: 6, cursor: 'help', borderBottom: '1px dotted rgba(100,116,139,0.4)', display: 'inline-block' }} title="Cap training samples per class to speed up experimentation">MAX SAMPLES</div>
            <input
              type="number"
              min={1}
              step={1}
              value={maxTrainSamplesInput}
              onChange={(e) => setMaxTrainSamplesInput(e.target.value)}
              style={rerunInputStyle}
            />
          </div>
          <button
            onClick={() => {
              if (rerunBackbones.length === 0) return
              fetch(`${API}/projects/classifier-lab/rerun/${project.id}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  backbones: rerunBackbones, gate_f1: rerunGateF1,
                  max_rounds: rerunMaxRounds, max_train_samples: rerunMaxTrainSamples,
                  modality: project.modality, task: project.name,
                }),
              }).catch(() => {})
            }}
            disabled={rerunBackbones.length === 0}
            style={{
              background: rerunBackbones.length > 0 ? EMBRY.accent : 'transparent',
              border: `1px solid ${rerunBackbones.length > 0 ? EMBRY.accent : EMBRY.border}`,
              color: rerunBackbones.length > 0 ? '#000' : EMBRY.dim,
              padding: '10px 24px', borderRadius: 6, fontSize: 11, fontWeight: 900,
              cursor: rerunBackbones.length > 0 ? 'pointer' : 'default',
              whiteSpace: 'nowrap',
            }}
          >
            START TRAINING
          </button>
        </div>
      </div>

      {/* Sortable leaderboard */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={label}>LIVE TRAINING LEADERBOARD</div>
        {rows.some(r => r.status === 'fail') && (
          <button
            onClick={() => {
              const failed = rows.filter(r => r.status === 'fail').map(r => r.backbone)
              if (!failed.length) return
              setRetrying(failed.join(','))
              fetch(`${API}/projects/classifier-lab/rerun/${project.id}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  backbones: failed, gate_f1: rerunGateF1,
                  max_rounds: rerunMaxRounds, max_train_samples: rerunMaxTrainSamples,
                  modality: project.modality, task: project.name, retry: true,
                }),
              }).finally(() => setRetrying(null))
            }}
            disabled={!!retrying}
            style={{ ...btnOutline, borderColor: EMBRY.amber + '66', color: EMBRY.amber, fontSize: 9, padding: '4px 12px' }}
          >
            {retrying ? 'RETRYING...' : `RETRY ${rows.filter(r => r.status === 'fail').length} FAILED BACKBONE${rows.filter(r => r.status === 'fail').length === 1 ? '' : 'S'}`}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div style={{ ...card, padding: 32, textAlign: 'center', marginBottom: 28 }}>
          <Cpu size={24} color={EMBRY.dim} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: EMBRY.dim, marginBottom: 4 }}>NO TRAINING RUNS</div>
          <div style={{ fontSize: 10, color: EMBRY.muted }}>
            Configure backbones above and click START TRAINING to begin.
          </div>
        </div>
      ) : (
      <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 28 }}>
        {(() => {
          const trainColumns = [
            { id: 'rank', header: '#', tip: 'Rank by F1 score (best first)', accessor: (r: TrainingRow) => r.rank, sortable: true },
            { id: 'backbone', header: 'BACKBONE', tip: 'Pre-trained model architecture being evaluated', accessor: (r: TrainingRow) => r.backbone, sortable: true },
            { id: 'lr', header: 'LR', tip: 'Learning rate used for this training run', accessor: (r: TrainingRow) => parseFloat(r.lr) || 0, sortable: true },
            { id: 'bs', header: 'BATCH', tip: 'Number of samples per gradient update step', accessor: (r: TrainingRow) => r.bs, sortable: true },
            { id: 'f1', header: 'F1', tip: 'Macro F1 on held-out test set — primary quality metric', accessor: (r: TrainingRow) => r.f1, sortable: true },
            { id: 'acc', header: 'ACC', tip: 'Overall accuracy — can be misleading with imbalanced classes', accessor: (r: TrainingRow) => r.acc, sortable: true },
            { id: 'latency', header: 'LATENCY', tip: 'Inference latency per sample (p50)', accessor: (r: TrainingRow) => r.latency, sortable: false },
            { id: 'cost', header: 'COST', tip: 'Training cost for this backbone (FREE = local GPU)', accessor: (r: TrainingRow) => r.cost, sortable: false },
            { id: 'gate', header: 'GATE', tip: `Whether F1 ≥ ${rerunGateF1.toFixed(2)} on held-out test set`, accessor: (r: TrainingRow) => r.status, sortable: true },
          ]
          const sorted = [...rows].sort((a, b) => {
            if (!trainSorting.length) return 0
            const { id, desc } = trainSorting[0]
            const col = trainColumns.find(c => c.id === id)
            if (!col) return 0
            const av = col.accessor(a), bv = col.accessor(b)
            const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
            return desc ? -cmp : cmp
          })
          const sortIcon = (colId: string) => {
            const s = trainSorting.find(x => x.id === colId)
            if (!s) return ' ↕'
            return s.desc ? ' ↓' : ' ↑'
          }
          const toggleSort = (colId: string) => {
            setTrainSorting(prev => {
              const existing = prev.find(x => x.id === colId)
              if (!existing) return [{ id: colId, desc: true }]
              if (existing.desc) return [{ id: colId, desc: false }]
              return []
            })
          }
          return (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
                  {trainColumns.map(col => (
                    <th
                      key={col.id}
                      style={{ ...thStyle, cursor: col.sortable ? 'pointer' : 'help', userSelect: 'none' }}
                      title={col.tip}
                      onClick={() => col.sortable && toggleSort(col.id)}
                    >
                      {col.header}{col.sortable ? sortIcon(col.id) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.backbone} style={{
                    borderBottom: `1px solid ${EMBRY.border}`,
                    borderLeft: r.status === 'pass' && r.f1 === Math.max(...rows.filter(x => x.status === 'pass').map(x => x.f1)) ? `3px solid ${EMBRY.green}` : '3px solid transparent',
                    background: r.status === 'training' ? 'rgba(124,58,237,0.03)' : 'transparent',
                  }}>
                    <td style={tdStyle}>{r.rank}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: r.status === 'pass' ? EMBRY.green : EMBRY.white }}>{r.backbone}</td>
                    <td style={tdStyle}>{r.lr}</td>
                    <td style={tdStyle}>{r.bs || '—'}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: r.f1 >= rerunGateF1 ? EMBRY.green : r.f1 > 0 ? EMBRY.red : EMBRY.muted }}>
                      {r.f1 ? r.f1.toFixed(3) : '—'}
                    </td>
                    <td style={tdStyle}>{r.acc ? r.acc.toFixed(3) : '—'}</td>
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
          )
        })()}
      </div>
      )}

      {/* All-failed inline guidance — when every backbone missed the gate */}
      {!best && rows.length > 0 && (
        <div style={{ ...card, border: `1px solid ${EMBRY.amber}33`, background: 'rgba(255,170,0,0.03)', marginBottom: 16, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <AlertTriangle size={14} color={EMBRY.amber} />
            <span style={{ fontSize: 11, fontWeight: 900, color: EMBRY.amber }}>
              ALL {rows.length} BACKBONES FAILED GATE (F1 {'<'} {rerunGateF1.toFixed(2)})
            </span>
          </div>
          <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.6 }}>
            {(() => {
              const bestRow = [...rows].sort((a, b) => b.f1 - a.f1)[0]
              const gap = bestRow ? rerunGateF1 - bestRow.f1 : 0
              const suggestions: string[] = []
              if (gap < 0.02) suggestions.push('Gap is small — try label smoothing (0.1) or a larger model (bert-base-uncased)')
              if (gap >= 0.02 && gap < 0.1) suggestions.push('Try a larger backbone (bert-base, roberta-base) or increase epochs')
              if (gap >= 0.1) suggestions.push('Model is far from gate — check data quality, consider more training data')
              if (bestRow && !bestRow.lr) suggestions.push('LR and batch size not recorded — check Tune tab HP configuration')
              suggestions.push('See Failure Analysis below for /dogpile research and per-round diagnosis')
              return suggestions.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
                  <span style={{ color: EMBRY.amber }}>→</span> {s}
                </div>
              ))
            })()}
          </div>
        </div>
      )}

      {/* Best recommendation — above failure analysis for visibility */}
      {best && (
        <div style={{ ...panel, border: `1px solid ${EMBRY.green}33`, background: 'rgba(0,255,136,0.03)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={glowDot(EMBRY.green, 8)} />
          <span style={{ ...label, color: EMBRY.green }}>RECOMMENDED</span>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13 }}>
            {best.backbone}
          </span>
          <span style={{ fontSize: 11, color: EMBRY.dim, fontFamily: MONO }}>
            F1 {best.f1.toFixed(3)} · {best.latency || '—'} · {best.cost || 'FREE'}
          </span>
        </div>
      )}

      {/* Failure analysis — auto-expand when gate has failed */}
      <FailureAnalysisPanel project={project} autoExpand={!best && rows.length > 0} />

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

// ── Failure Analysis Panel ──────────────────────────────────────────

function FailureAnalysisPanel({ project, autoExpand = false }: { project: Project; autoExpand?: boolean }) {
  const [analysis, setAnalysis] = useState<FailureAnalysis | null>(null)
  const [expanded, setExpanded] = useState(autoExpand)

  // Sync autoExpand when it changes (data loads async)
  useEffect(() => { if (autoExpand) setExpanded(true) }, [autoExpand])

  useEffect(() => {
    fetch(`${API}/projects/classifier-lab/failure-analysis/${project.id}`)
      .then(r => r.json()).then((d: FailureAnalysis) => {
        if (d.totalRounds > 0) setAnalysis(d)
        else setAnalysis(null)
      })
      .catch(() => setAnalysis(null))
  }, [project.id])

  if (!analysis || analysis.totalRounds === 0) return null

  const hasFailed = analysis.bestF1 < 0.90
  if (!hasFailed) return null

  return (
    <div style={{ marginBottom: 28 }}>
      <style>{MD_CSS}</style>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          ...card, width: '100%', cursor: 'pointer', textAlign: 'left',
          border: `1px solid ${EMBRY.red}33`, background: 'rgba(255,68,68,0.04)',
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
        }}
      >
        <AlertTriangle size={16} color={EMBRY.red} />
        <span style={{ ...label, color: EMBRY.red, flex: 1 }}>
          FAILURE ANALYSIS — {analysis.totalRounds} ROUNDS, BEST F1 {analysis.bestF1.toFixed(3)} {'<'} 0.90
        </span>
        {expanded ? <ChevronDown size={14} color={EMBRY.dim} /> : <ChevronRight size={14} color={EMBRY.dim} />}
      </button>

      {expanded && (
        <div style={{ ...card, borderTop: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0, padding: 0 }}>
          {/* Strategy timeline */}
          <div style={{ padding: '16px 16px 0' }}>
            <div style={{ ...label, marginBottom: 10 }}>STRATEGIES TRIED</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
                {['RND', 'STRATEGY', 'BACKBONE', 'F1', 'ACC', 'DIAGNOSIS'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analysis.rounds.map(r => (
                <tr key={`${r.round}-${r.backbone}`} style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
                  <td style={tdStyle}>{r.round}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{r.strategy || '—'}</td>
                  <td style={tdStyle}>{r.backbone || '—'}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: r.f1 >= 0.90 ? EMBRY.green : r.f1 > 0 ? EMBRY.red : EMBRY.muted }}>
                    {r.f1 > 0 ? r.f1.toFixed(3) : '—'}
                  </td>
                  <td style={tdStyle}>{r.accuracy > 0 ? r.accuracy.toFixed(3) : '—'}</td>
                  <td style={{ ...tdStyle, fontSize: 9, color: EMBRY.dim, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.diagnosis || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Dogpile insights */}
          {analysis.dogpileInsights.length > 0 && (
            <div style={{ padding: 16, borderTop: `1px solid ${EMBRY.border}` }}>
              <div style={{ ...label, marginBottom: 8 }}>DOGPILE RESEARCH ({analysis.dogpileInsights.length} queries)</div>
              {analysis.dogpileInsights.map((d, i) => (
                <div key={i} style={{ fontSize: 10, color: EMBRY.dim, marginBottom: 4, fontFamily: MONO }}>
                  <span style={{ color: EMBRY.amber }}>R{d.round}</span> [{d.phase}] {d.query}
                </div>
              ))}
            </div>
          )}

          {/* Last diagnosis + recommendation */}
          {analysis.lastDiagnosis && (
            <div style={{ padding: 16, borderTop: `1px solid ${EMBRY.border}`, background: 'rgba(255,170,0,0.03)' }}>
              <div style={{ ...label, color: EMBRY.amber, marginBottom: 6 }}>LAST DIAGNOSIS</div>
              <div style={{ fontSize: 11, color: EMBRY.white, fontFamily: MONO, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {analysis.lastDiagnosis}
              </div>
            </div>
          )}

          {/* Next-steps hypotheses from /dogpile */}
          {analysis.nextSteps && (
            <div style={{ padding: 16, borderTop: `1px solid ${EMBRY.border}`, background: 'rgba(124,58,237,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Cpu size={14} color={EMBRY.accent} />
                <span style={{ ...label, color: EMBRY.accent }}>NEXT-STEP HYPOTHESES</span>
                <span style={{ fontSize: 8, color: EMBRY.dim, marginLeft: 'auto' }}>
                  via /dogpile | gap: {analysis.nextSteps.gap.toFixed(3)}
                  {analysis.nextSteps.plateau_detected && ' | PLATEAU DETECTED'}
                </span>
              </div>
              <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 10, fontFamily: MONO }}>
                {analysis.nextSteps.strategies_exhausted.length} strategies exhausted: {analysis.nextSteps.strategies_exhausted.join(' → ')}
              </div>
              {analysis.nextSteps.dogpile_hypotheses ? (
                <div
                  className="next-steps-full clf-markdown"
                  style={{ fontSize: 12, color: EMBRY.white, lineHeight: 1.7 }}
                  dangerouslySetInnerHTML={{ __html: marked.parse(analysis.nextSteps.dogpile_hypotheses) as string }}
                />
              ) : (
                <div style={{ fontSize: 11, color: EMBRY.dim, fontStyle: 'italic' }}>
                  /dogpile research pending — hypotheses will appear after pipeline completes
                </div>
              )}
            </div>
          )}
        </div>
      )}
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

      {/* Tune gate card */}
      <div style={{ marginBottom: 20 }}>
        <GateCard
          name="TUNE GATE"
          passed={bestTrial != null && (bestTrial.testF1 ?? bestTrial.valF1 ?? 0) >= (project.f1 ? 0.90 : 0.90)}
          metrics={[
            { label: 'BEST F1', value: bestTrial ? (bestTrial.testF1 ?? bestTrial.valF1 ?? 0).toFixed(3) : '—', color: bestTrial && (bestTrial.testF1 ?? bestTrial.valF1 ?? 0) >= 0.90 ? EMBRY.green : EMBRY.red },
            { label: 'ROUNDS', value: `${completedCount} / ${totalCount}` },
            { label: 'STRATEGY', value: strategy.replace(/-/g, ' ').slice(0, 20) },
          ]}
          checks={[
            { label: 'HPs configured (not defaults)', ok: completedCount > 0, detail: completedCount > 0 ? 'Yes' : 'Pending' },
            { label: 'At least 1 round completed', ok: completedCount > 0 },
            { label: 'Gate met by ≥1 trial', ok: trials.some(t => t.passed), detail: trials.filter(t => t.passed).length > 0 ? `${trials.filter(t => t.passed).length} passed` : 'No' },
          ]}
        />
      </div>

      {/* Fix 5: F1 trend sparkline + Round progress circles with Fix 2: tooltips + click */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        {/* Sparkline */}
        {trials.length > 1 && (() => {
          const f1s = trials.map(t => t.testF1 ?? t.valF1 ?? 0)
          const maxF1 = Math.max(...f1s, 0.91)
          const minF1 = Math.min(...f1s.filter(v => v > 0), 0)
          const range = maxF1 - minF1 || 1
          const w = Math.min(trials.length * 24, 160)
          const h = 24
          const points = f1s.map((f, i) => `${(i / (f1s.length - 1)) * w},${h - ((f - minF1) / range) * h}`).join(' ')
          return (
            <svg width={w} height={h + 4} style={{ flexShrink: 0 }}>
              {/* Gate line */}
              <line x1={0} y1={h - ((0.90 - minF1) / range) * h} x2={w} y2={h - ((0.90 - minF1) / range) * h} stroke={EMBRY.amber} strokeWidth={0.5} strokeDasharray="3 2" />
              <polyline points={points} fill="none" stroke={EMBRY.accent} strokeWidth={1.5} />
              {f1s.map((f, i) => (
                <circle key={i} cx={(i / (f1s.length - 1)) * w} cy={h - ((f - minF1) / range) * h} r={2.5}
                  fill={f >= 0.90 ? EMBRY.green : EMBRY.red} />
              ))}
            </svg>
          )
        })()}
        {/* Round circles — Fix 2: tooltips + click-to-load */}
        {trials.map((t) => {
          const f1Val = t.testF1 ?? t.valF1 ?? 0
          const passed = f1Val >= 0.90  // Gate-based, not backend status
          const isRunning = t.status === 'running'
          const isDone = t.status === 'complete' || t.status === 'completed' || t.status === 'passed' || t.status === 'failed'
          return (
            <div key={t.trial}
              onClick={() => {
                // Scroll to HP controls and load this round
                const el = document.querySelector('[data-tune-controls]')
                el?.scrollIntoView({ behavior: 'smooth' })
              }}
              title={`Round ${t.trial} — ${t.backbone}\nTest F1: ${f1Val.toFixed(3)}\nLR: ${t.lr} | Epochs: ${t.epochs ?? '?'}\nAugment: ${t.augment || 'none'}\nStatus: ${t.status}`}
              style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 900, fontFamily: MONO, cursor: 'pointer',
                background: passed ? EMBRY.green + '20' : isRunning ? EMBRY.amber + '20' : isDone ? EMBRY.red + '15' : EMBRY.blue + '15',
                color: passed ? EMBRY.green : isRunning ? EMBRY.amber : isDone ? EMBRY.red : EMBRY.blue,
                border: `1px solid ${passed ? EMBRY.green + '44' : isRunning ? EMBRY.amber + '44' : isDone ? EMBRY.red + '33' : EMBRY.blue + '33'}`,
                transition: 'transform 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.2)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
            >
              {t.trial}
            </div>
          )
        })}
        <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 8 }}>
          {completedCount} / {totalCount} rounds complete
          {winningRound ? ` — Gate passed at round ${winningRound}` : ''}
        </span>
      </div>

      {/* Self-improvement rounds table — Fix 4: expandable delta rows */}
      <div style={{ ...label, marginBottom: 8 }}>SELF-IMPROVEMENT ROUNDS</div>
      {trials.length === 0 ? (
        <div style={{ ...card, padding: 32, textAlign: 'center' }}>
          <Cpu size={24} color={EMBRY.dim} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: EMBRY.dim, marginBottom: 4 }}>NO TRAINING ROUNDS YET</div>
          <div style={{ fontSize: 10, color: EMBRY.muted }}>
            Configure hyperparameters below, then start training from the Train tab.
          </div>
        </div>
      ) : (
      <TuneRoundsTable trials={trials} bestTrial={bestTrial} />
      )}

      {/* HP Controls + Change log */}
      <div data-tune-controls>
        <TuneHPControls projectId={project.id} />
      </div>
    </div>
  )
}

/** Interactive HP control surface — shared between human and agent */
/** Fix 4: Rounds table with inline expandable HP deltas */
function TuneRoundsTable({ trials, bestTrial }: { trials: Array<{ trial: number; backbone: string; epochs: number | null; lr: string; augment: string; valF1: number | null; testF1: number | null; status: string; passed: boolean }>; bestTrial: typeof trials[0] | undefined }) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 28 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
            {([
              { h: '', tip: 'Expand to see HP changes from previous round' },
              { h: 'ROUND', tip: 'Self-improvement iteration number.' },
              { h: 'BACKBONE', tip: 'Pre-trained model architecture.' },
              { h: 'EPOCHS', tip: 'Full passes over training data.' },
              { h: 'LR', tip: 'Learning rate for gradient updates.' },
              { h: 'AUGMENT', tip: 'Data augmentation applied.' },
              { h: 'VAL F1', tip: 'F1 on validation split (early stopping).' },
              { h: 'TEST F1', tip: 'F1 on held-out test set (gate check).' },
              { h: 'GATE', tip: 'Whether Test F1 ≥ 0.90.' },
            ]).map(({ h, tip }) => (
              <th key={h || '_expand'} style={{ ...thStyle, cursor: h ? 'help' : 'default', width: h ? undefined : 28 }} title={tip}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trials.map((t, idx) => {
            const isBest = bestTrial && t.trial === bestTrial.trial
            const testF1 = t.testF1 ?? 0
            const valF1 = t.valF1 ?? 0
            const isExpanded = expandedRow === t.trial
            const prev = idx > 0 ? trials[idx - 1] : null

            // Compute deltas
            const deltas: Array<{ hp: string; from: string; to: string; delta?: string; color: string }> = []
            if (prev) {
              if (t.lr !== prev.lr) deltas.push({ hp: 'LR', from: prev.lr, to: t.lr, color: EMBRY.accent })
              if (t.epochs !== prev.epochs) deltas.push({ hp: 'Epochs', from: String(prev.epochs ?? '?'), to: String(t.epochs ?? '?'), color: EMBRY.accent })
              if (t.augment !== prev.augment) deltas.push({ hp: 'Augment', from: prev.augment || 'none', to: t.augment || 'none', color: EMBRY.accent })
              const prevF1 = prev.testF1 ?? prev.valF1 ?? 0
              if (prevF1 > 0 && testF1 > 0) {
                const d = testF1 - prevF1
                deltas.push({ hp: 'F1', from: prevF1.toFixed(3), to: testF1.toFixed(3), delta: `${d > 0 ? '+' : ''}${d.toFixed(3)}`, color: d > 0 ? EMBRY.green : EMBRY.red })
              }
            }

            return (
              <Fragment key={t.trial}>
                <tr style={{
                  borderBottom: isExpanded ? 'none' : `1px solid ${EMBRY.border}`,
                  borderLeft: isBest ? `3px solid ${EMBRY.green}` : '3px solid transparent',
                  background: t.status === 'running' ? 'rgba(124,58,237,0.03)' : 'transparent',
                  cursor: prev ? 'pointer' : 'default',
                }} onClick={() => prev && setExpandedRow(isExpanded ? null : t.trial)}>
                  <td style={{ ...tdStyle, width: 28, padding: '8px 6px' }}>
                    {prev && (isExpanded
                      ? <ChevronDown size={12} color={EMBRY.dim} />
                      : <ChevronRight size={12} color={EMBRY.dim} />
                    )}
                  </td>
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
                {/* Expanded delta row */}
                {isExpanded && deltas.length > 0 && (
                  <tr style={{ borderBottom: `1px solid ${EMBRY.border}`, background: 'rgba(124,58,237,0.02)' }}>
                    <td colSpan={9} style={{ padding: '8px 14px 8px 42px' }}>
                      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: 8, fontWeight: 700, color: EMBRY.muted }}>CHANGES FROM R{prev!.trial}:</span>
                        {deltas.map(d => (
                          <span key={d.hp} style={{ fontSize: 10, fontFamily: MONO }}>
                            <span style={{ color: EMBRY.dim }}>{d.hp}: </span>
                            <span style={{ color: EMBRY.muted }}>{d.from}</span>
                            <span style={{ color: EMBRY.dim }}> → </span>
                            <span style={{ color: EMBRY.white }}>{d.to}</span>
                            {d.delta && <span style={{ color: d.color, fontWeight: 700, marginLeft: 4 }}>{d.delta}</span>}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TuneHPControls({ projectId }: { projectId: string }) {
  const [config, setConfig] = useState<any>(null)
  const [rounds, setRounds] = useState<Array<{ round: number; f1: number; strategy: string; hps: Record<string, number> }>>([])
  const [profile, setProfile] = useState<any>(null)
  const [bestF1, setBestF1] = useState(0)
  const [viewingRound, setViewingRound] = useState<number | null>(null) // null = active config
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`${API}/projects/classifier-lab/tune-config/${projectId}`)
      .then(r => r.json()).then(d => { setConfig(d); setDirty(false) })
      .catch(() => {})
    fetch(`${API}/projects/classifier-lab/failure-analysis/${projectId}`)
      .then(r => r.json()).then((d: FailureAnalysis) => {
        const roundData = (d.rounds || [])
          .filter(r => r.hps && Object.keys(r.hps).length > 0)
          .map(r => ({ round: r.round, f1: r.f1, strategy: (r as any).strategy || '', hps: r.hps as Record<string, number> }))
        setRounds(roundData)
        setBestF1(d.bestF1 || 0)
      })
      .catch(() => {})
    fetch(`${API}/projects/classifier-lab/data/${projectId}/profile`)
      .then(r => r.json()).then(d => { if (!d.error) setProfile(d) })
      .catch(() => {})
  }, [projectId])

  if (!config) return null

  const set = (key: string, value: number) => {
    setConfig((prev: any) => ({ ...prev, [key]: value }))
    setDirty(true)
    setViewingRound(null) // User is now editing, not viewing a past round
  }

  const save = async () => {
    setSaving(true)
    try {
      const roundLabel = viewingRound != null ? `human (restored R${viewingRound})` : 'human'
      await fetch(`${API}/projects/classifier-lab/tune-config/${projectId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, _source: roundLabel, _round: viewingRound }),
      })
      setDirty(false)
    } catch { /* ignore */ }
    setSaving(false)
  }

  const loadRound = (roundData: { round: number; hps: Record<string, number> }) => {
    setViewingRound(roundData.round)
    setConfig((prev: any) => {
      const merged = { ...prev }
      for (const [k, v] of Object.entries(roundData.hps)) {
        if (k in merged) merged[k] = v
      }
      return merged
    })
    setDirty(true)
  }

  const loadActive = () => {
    setViewingRound(null)
    fetch(`${API}/projects/classifier-lab/tune-config/${projectId}`)
      .then(r => r.json()).then(d => { setConfig(d); setDirty(false) })
      .catch(() => {})
  }

  const changelog: Array<{ timestamp: string; source: string; changes: Record<string, { from: unknown; to: unknown }> }> = config._changelog || []
  const source = config._source || 'default'

  // Contextual recommendations based on dataset profile and training history
  const n = profile?.total || 0
  const nClasses = profile ? Object.keys(profile.perClass || {}).length : 0
  const modality = profile?.modality || 'text'
  const gap = bestF1 > 0 ? (0.90 - bestF1) : 0
  const isCloseToGate = gap > 0 && gap < 0.03

  const knobs: Array<{ key: string; label: string; tip: string; min: number; max: number; step: number; log?: boolean }> = [
    { key: 'lr', label: 'Learning Rate', min: 0.000001, max: 0.01, step: 0.000001, log: true,
      tip: `Step size for gradient updates.${modality === 'text' ? ` With ${n} samples and transformer fine-tuning, try 2e-5 to 5e-5.` : ` With ${n} samples, try 1e-4 to 3e-4 for vision CNNs.`}${bestF1 > 0 ? ` Current best F1=${bestF1.toFixed(3)} — ${Number(config?.lr) > 5e-5 ? 'current LR may be too high, try halving' : 'LR looks reasonable'}.` : ''}` },
    { key: 'batch_size', label: 'Batch Size', min: 4, max: 128, step: 4,
      tip: `Samples per gradient step.${nClasses > 0 ? ` ${nClasses} classes × ${Math.round(n / nClasses)} samples/class — use ${Math.min(32, Math.max(8, nClasses * 4))} for balanced coverage.` : ''} Larger = smoother gradients but more memory.` },
    { key: 'epochs', label: 'Epochs', min: 1, max: 20, step: 1,
      tip: `Full passes over data.${n > 0 ? ` ${n} samples is ${n < 1000 ? 'small — overfitting risk past epoch 3-4. Watch for double descent at 8+' : n < 5000 ? 'moderate — 3-5 epochs typical' : 'large — 2-3 epochs usually sufficient'}.` : ''}` },
    { key: 'dropout', label: 'Dropout', min: 0, max: 0.5, step: 0.05,
      tip: `Randomly zeros outputs during training.${n > 0 && n < 2000 ? ` Small dataset (${n}) — try 0.2-0.3 to prevent overfitting.` : ' 0.1 typical for large datasets.'}` },
    { key: 'weight_decay', label: 'Weight Decay', min: 0, max: 0.1, step: 0.0001, log: true,
      tip: `L2 regularization on weights. 0.01 typical for AdamW.${isCloseToGate ? ' Close to gate — slight increase (0.02) may help generalization.' : ''}` },
    { key: 'label_smoothing', label: 'Label Smoothing', min: 0, max: 0.3, step: 0.05,
      tip: `Softens hard labels (1.0 → 0.9).${isCloseToGate ? ` F1 ${bestF1.toFixed(3)} is only ${gap.toFixed(3)} below gate — smoothing 0.1 typically closes gaps this small.` : ' Reduces overconfidence on boundary samples.'}` },
    { key: 'mixup_alpha', label: 'Mixup Alpha', min: 0, max: 1, step: 0.1,
      tip: `Interpolates training sample pairs.${modality === 'text' ? ' NOT recommended for text — degrades semantic content.' : ' Try 0.2-0.4 for vision tasks.'} Alpha controls mix strength.` },
    { key: 'cutmix_alpha', label: 'CutMix Alpha', min: 0, max: 1, step: 0.1,
      tip: `Replaces image patches between samples.${modality !== 'vision' ? ` Vision-only — not applicable for ${modality}.` : ` With ${n} images, try 0.2-0.4.`}` },
    { key: 'random_erasing', label: 'Random Erasing', min: 0, max: 0.5, step: 0.05,
      tip: `Randomly masks rectangular regions.${modality !== 'vision' ? ` Vision-only — not applicable for ${modality}.` : ' Forces global feature learning. Try 0.1-0.2.'}` },
    { key: 'warmup_ratio', label: 'Warmup Ratio', min: 0, max: 0.2, step: 0.01,
      tip: `Linearly increase LR during early training.${modality === 'text' ? ' Critical for transformer fine-tuning — prevents catastrophic forgetting. 0.06-0.1 typical.' : ' 0.05-0.1 typical.'}` },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
      {/* HP Knobs */}
      <div style={card}>
        {/* Header with round selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ ...heading, fontSize: 13 }}>HYPERPARAMETER CONTROLS</div>
          <span style={{
            fontSize: 8, padding: '2px 6px', borderRadius: 3, fontFamily: MONO, fontWeight: 700,
            background: source === 'human' || source.startsWith('human') ? 'rgba(0,255,136,0.1)' : source === 'agent' ? 'rgba(124,58,237,0.1)' : 'rgba(100,116,139,0.1)',
            color: source === 'human' || source.startsWith('human') ? EMBRY.green : source === 'agent' ? EMBRY.accent : EMBRY.dim,
          }}>
            {source.toUpperCase()}
          </span>
          {viewingRound != null && (
            <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 3, fontFamily: MONO, fontWeight: 700, background: 'rgba(255,170,0,0.1)', color: EMBRY.amber }}>
              VIEWING R{viewingRound}
            </span>
          )}
          {config._updated && (
            <span style={{ fontSize: 8, color: EMBRY.muted, fontFamily: MONO, marginLeft: 'auto' }}>
              {new Date(config._updated).toLocaleString()}
            </span>
          )}
        </div>

        {/* Round selector */}
        {rounds.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 8, color: EMBRY.muted, fontWeight: 700 }}>LOAD FROM ROUND:</span>
              <button
                onClick={loadActive}
                style={{
                  ...roundPillStyle,
                  background: viewingRound == null ? EMBRY.accent + '20' : 'transparent',
                  borderColor: viewingRound == null ? EMBRY.accent + '66' : EMBRY.border,
                  color: viewingRound == null ? EMBRY.accent : EMBRY.dim,
                }}
              >
                ACTIVE
              </button>
              {rounds.map(r => (
                <button
                  key={r.round}
                  onClick={() => loadRound(r)}
                  title={`Strategy: ${r.strategy} | F1: ${r.f1.toFixed(3)}`}
                  style={{
                    ...roundPillStyle,
                    background: viewingRound === r.round ? EMBRY.amber + '20' : 'transparent',
                    borderColor: viewingRound === r.round ? EMBRY.amber + '66' : EMBRY.border,
                    color: viewingRound === r.round ? EMBRY.amber : EMBRY.dim,
                  }}
                >
                  R{r.round}
                  <span style={{ fontSize: 7, color: r.f1 >= 0.90 ? EMBRY.green : EMBRY.red, marginLeft: 3 }}>
                    {r.f1.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
            {/* Rationale for viewed round */}
            {viewingRound != null && (() => {
              const rd = rounds.find(r => r.round === viewingRound)
              if (!rd) return null
              // Get diagnosis from failure analysis data
              return (
                <div style={{ padding: '8px 12px', background: 'rgba(255,170,0,0.04)', border: `1px solid ${EMBRY.amber}22`, borderRadius: 4, fontSize: 10 }}>
                  <span style={{ fontWeight: 700, color: EMBRY.amber }}>R{rd.round} RATIONALE: </span>
                  <span style={{ color: EMBRY.dim }}>
                    Strategy: <span style={{ color: EMBRY.white, fontFamily: MONO }}>{rd.strategy}</span>
                    {' · '}F1: <span style={{ color: rd.f1 >= 0.90 ? EMBRY.green : EMBRY.red, fontFamily: MONO }}>{rd.f1.toFixed(3)}</span>
                  </span>
                </div>
              )
            })()}
          </div>
        )}

        {/* Fix 3: Grouped knobs — Core, Regularization, Augmentation */}
        {([
          { group: 'CORE', keys: ['lr', 'batch_size', 'epochs', 'warmup_ratio'] },
          { group: 'REGULARIZATION', keys: ['dropout', 'weight_decay', 'label_smoothing'] },
          { group: 'AUGMENTATION', keys: ['mixup_alpha', 'cutmix_alpha', 'random_erasing'] },
        ] as const).map(({ group, keys }) => {
          const groupKnobs = knobs.filter(k => keys.includes(k.key as any))
          if (!groupKnobs.length) return null
          return (
            <div key={group} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: EMBRY.muted, letterSpacing: '0.1em', marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${EMBRY.border}` }}>{group}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {groupKnobs.map(k => {
                  const val = Number(config[k.key]) || 0
                  return (
                    <div key={k.key} style={{ padding: '6px 0' }} title={k.tip}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'help', borderBottom: '1px dotted rgba(100,116,139,0.4)' }}>{k.label}</span>
                        {/* Fix 1: Direct numeric input */}
                        <input
                          type="text"
                          value={k.log && val > 0 ? val.toExponential(1) : val % 1 === 0 ? String(val) : val.toFixed(4)}
                          onChange={e => {
                            const parsed = Number(e.target.value)
                            if (Number.isFinite(parsed)) set(k.key, parsed)
                          }}
                          style={{
                            width: 70, textAlign: 'right', background: 'transparent', border: `1px solid ${EMBRY.border}`,
                            borderRadius: 3, padding: '2px 4px', fontSize: 11, fontFamily: MONO, fontWeight: 700,
                            color: EMBRY.white, outline: 'none',
                          }}
                          onFocus={e => { e.target.style.borderColor = EMBRY.accent; e.target.select() }}
                          onBlur={e => { e.target.style.borderColor = EMBRY.border }}
                        />
                      </div>
                      <input
                        type="range"
                        min={k.min} max={k.max} step={k.step}
                        value={val}
                        onChange={e => set(k.key, Number(e.target.value))}
                        style={{ width: '100%', accentColor: EMBRY.accent, height: 4 }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${EMBRY.border}` }}>
          <button
            onClick={save}
            disabled={!dirty || saving}
            style={{
              background: dirty ? EMBRY.accent : 'transparent',
              border: `1px solid ${dirty ? EMBRY.accent : EMBRY.border}`,
              color: dirty ? '#000' : EMBRY.dim,
              padding: '8px 20px', borderRadius: 4, fontSize: 10, fontWeight: 900, cursor: dirty ? 'pointer' : 'default',
            }}
          >
            {saving ? 'SAVING...' : dirty
              ? viewingRound != null ? `APPLY R${viewingRound} AS NEXT RUN` : 'SAVE OVERRIDES'
              : 'NO CHANGES'}
          </button>
          <button onClick={loadActive} style={{ ...btnOutline, fontSize: 10 }}>RESET</button>
        </div>
      </div>

      {/* Change log */}
      <div style={card}>
        <div style={{ ...heading, fontSize: 13, marginBottom: 16 }}>CHANGE LOG</div>
        {changelog.length > 0 ? (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {[...changelog].reverse().map((entry, i) => (
              <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${EMBRY.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 8, padding: '1px 5px', borderRadius: 3, fontWeight: 700,
                    background: entry.source?.startsWith('human') ? 'rgba(0,255,136,0.1)' : 'rgba(124,58,237,0.1)',
                    color: entry.source?.startsWith('human') ? EMBRY.green : EMBRY.accent,
                  }}>
                    {(entry.source || 'unknown').toUpperCase()}
                  </span>
                  <span style={{ fontSize: 8, color: EMBRY.muted, fontFamily: MONO }}>
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
                {Object.entries(entry.changes).map(([key, delta]) => (
                  <div key={key} style={{ fontSize: 10, color: EMBRY.dim, fontFamily: MONO, marginLeft: 8 }}>
                    {key}: <span style={{ color: EMBRY.muted }}>{String(delta.from)}</span> → <span style={{ color: EMBRY.white }}>{String(delta.to)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 10, color: EMBRY.muted }}>No HP changes recorded yet. Adjust a knob or load a round to start.</div>
        )}
      </div>
    </div>
  )
}

// ── Benchmark Tab ───────────────────────────────────────────────────

function BenchmarkTab({ project, data: propData }: { project: Project; data?: BenchmarkRow[] }) {
  const data = propData?.length ? propData : []
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggleSelect = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }
  const comparing = selected.size >= 2
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

  const benchPassed = bestF1 >= 0.90 && data.length >= 2
  const winnerWilson = fallbackWinner?.wilson ?? 0

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Benchmark gate card */}
      <div style={{ marginBottom: 20 }}>
        <GateCard
          name="BENCHMARK GATE"
          passed={benchPassed}
          metrics={[
            { label: benchPassed ? 'BEST F1' : 'BEST F1 (below target)', value: bestF1 > 0 ? bestF1.toFixed(3) : '—', color: benchPassed ? EMBRY.green : EMBRY.red },
            { label: 'WILSON CI', value: winnerWilson > 0 ? winnerWilson.toFixed(3) : '—' },
            { label: 'BACKBONES', value: String(data.length) },
          ]}
          checks={[
            { label: `Best F1 meets target`, ok: bestF1 >= 0.90, detail: bestF1 > 0 ? bestF1.toFixed(3) : 'No data' },
            { label: '≥2 backbones compared', ok: data.length >= 2, detail: `${data.length} tested` },
            { label: 'Latency within budget', ok: bestLat > 0 && bestLat < 100, detail: bestLat > 0 ? `${bestLat}ms` : '—' },
          ]}
          halt={!benchPassed && data.length > 0 ? (() => {
            if (data.length < 2) return { reason: 'Only 1 backbone tested — not enough to compare.', action: 'Go to Train tab and add more backbone candidates.' }
            const gap = 0.90 - bestF1
            if (gap > 0.3) return { reason: `Best backbone F1 (${bestF1.toFixed(3)}) is far below target. No backbone is competitive for this task with current data.`, action: 'This is likely a data problem. Go to the Data tab to add more training samples, then retrain.' }
            return { reason: `No backbone met the target. Best: ${winnerName} at F1 ${bestF1.toFixed(3)}.`, action: 'Try different backbones or tune hyperparameters. Check the Train tab failure analysis for specific suggestions.' }
          })() : null}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ ...heading, fontSize: 16 }}>BACKBONE COMPARISON — {project.name.toUpperCase()} ({data.length} backbones)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {comparing && (
            <span style={{ fontSize: 9, color: EMBRY.accent, fontWeight: 700 }}>
              COMPARING {selected.size} BACKBONES
            </span>
          )}
          {selected.size > 0 && (
            <button style={{ ...btnOutline, fontSize: 9, padding: '4px 10px' }} onClick={() => setSelected(new Set())}>CLEAR</button>
          )}
          <button style={btnOutline}>EXPORT</button>
        </div>
      </div>

      {/* Comparison grid */}
      <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 28 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
              <th style={{ ...thStyle, width: 32 }}>
                <input type="checkbox" checked={selected.size === data.length && data.length > 0}
                  onChange={() => setSelected(prev => prev.size === data.length ? new Set() : new Set(data.map(d => d.name)))}
                  style={{ accentColor: EMBRY.accent }} />
              </th>
              {[
                { h: 'BACKBONE', tip: GLOSSARY['Backbone'] },
                { h: 'MACRO F1', tip: GLOSSARY['Macro F1'] },
                { h: 'ACCURACY', tip: GLOSSARY['Accuracy'] },
                { h: 'WILSON CI', tip: GLOSSARY['Wilson CI'] },
                { h: 'LAT p50 (ms)', tip: 'Median inference latency — time to classify one sample' },
                { h: 'LAT p95 (ms)', tip: '95th percentile latency — worst case for most requests' },
                { h: 'PARAMS (M)', tip: 'Model size in millions of parameters — larger models are slower but may be more accurate' },
                { h: 'TRAIN TIME', tip: 'Wall-clock time to train this backbone' },
              ].map(({ h, tip }) => (
                <th key={h} style={{ ...thStyle, cursor: 'help' }} title={tip}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((b, i) => {
              const isSelected = selected.has(b.name)
              const dimmed = comparing && !isSelected
              return (
                <tr key={b.name} onClick={() => toggleSelect(b.name)} style={{
                  borderBottom: `1px solid ${EMBRY.border}`,
                  borderLeft: isSelected ? `3px solid ${EMBRY.accent}` : i === 0 ? `3px solid ${EMBRY.green}` : '3px solid transparent',
                  background: isSelected ? 'rgba(124,58,237,0.06)' : i === 0 ? 'rgba(0,255,136,0.02)' : 'transparent',
                  opacity: dimmed ? 0.4 : 1,
                  cursor: 'pointer',
                  transition: 'opacity 0.15s',
                }}>
                  <td style={{ ...tdStyle, width: 32 }} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(b.name)} style={{ accentColor: EMBRY.accent }} />
                  </td>
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
              )
            })}
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

          {/* One line per backbone — selected highlighted in comparison mode */}
          {data.map(row => {
            const isWinner = row.name === winnerName
            const isSelected = selected.has(row.name)
            const dimmed = comparing && !isSelected
            return (
              <path
                key={row.name}
                d={linePath(row)}
                fill="none"
                stroke={isSelected ? EMBRY.accent : isWinner ? EMBRY.green : EMBRY.blue}
                strokeWidth={isSelected ? 3 : isWinner ? 2.5 : 1.4}
                opacity={dimmed ? 0.1 : isSelected ? 0.95 : isWinner ? 0.9 : 0.4}
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

      {/* Comparison delta panel — shows when 2+ selected */}
      {comparing && (() => {
        const sel = data.filter(d => selected.has(d.name))
        const best = sel.reduce((a, b) => a.f1 > b.f1 ? a : b)
        const metrics = ['f1', 'acc', 'wilson', 'lat50', 'lat95', 'params'] as const
        const metricLabels: Record<string, string> = { f1: 'Macro F1', acc: 'Accuracy', wilson: 'Wilson CI', lat50: 'Lat p50', lat95: 'Lat p95', params: 'Params (M)' }
        const lowerIsBetter = new Set(['lat50', 'lat95', 'params'])
        return (
          <div style={{ ...card, marginTop: 16 }}>
            <div style={{ ...label, marginBottom: 12 }}>COMPARISON DELTA</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
                  <th style={thStyle}>BACKBONE</th>
                  {metrics.map(m => <th key={m} style={thStyle}>{metricLabels[m]}</th>)}
                </tr>
              </thead>
              <tbody>
                {sel.map(row => (
                  <tr key={row.name} style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: row.name === best.name ? EMBRY.green : EMBRY.white }}>
                      {row.name === best.name && '★ '}{row.name}
                    </td>
                    {metrics.map(m => {
                      const val = row[m]
                      const bestVal = lowerIsBetter.has(m) ? Math.min(...sel.map(s => s[m])) : Math.max(...sel.map(s => s[m]))
                      const isBest = val === bestVal
                      return (
                        <td key={m} style={{ ...tdStyle, fontWeight: isBest ? 700 : 400, color: isBest ? EMBRY.green : EMBRY.white }}>
                          {typeof val === 'number' ? (m === 'params' || m === 'lat50' || m === 'lat95' ? val : val.toFixed(3)) : val}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })()}
    </div>
  )
}

// ── Evaluate Tab — Test Suite ───────────────────────────────────────

interface EvalQuestion {
  id: string; text: string; expected: string
  predicted?: string | null; passed?: boolean | null
}

function EvaluateTab({ project }: { project: Project }) {
  const [questions, setQuestions] = useState<EvalQuestion[]>([])
  const [results, setResults] = useState<EvalQuestion[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editExpected, setEditExpected] = useState('')
  const [newText, setNewText] = useState('')
  const [newExpected, setNewExpected] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importData, setImportData] = useState('')
  const [importFormat, setImportFormat] = useState<'csv' | 'jsonl'>('jsonl')
  const [saving, setSaving] = useState(false)

  // Fetch existing questions
  useEffect(() => {
    setLoading(true)
    fetch(`${API}/projects/classifier-lab/eval-questions/${project.id}`)
      .then(r => r.json())
      .then(d => {
        setQuestions(d.questions || [])
        if (d.results && Array.isArray(d.results)) setResults(d.results)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [project.id])

  // Get classes from meta for the expected dropdown
  const [classes, setClasses] = useState<string[]>([])
  useEffect(() => {
    fetch(`${API}/projects/classifier-lab/eval-results/${project.id}`)
      .then(r => r.json())
      .then(d => { if (d.classes) setClasses(d.classes) })
      .catch(() => {})
  }, [project.id])

  const saveQuestions = async (qs: EvalQuestion[]) => {
    setSaving(true)
    setQuestions(qs)
    await fetch(`${API}/projects/classifier-lab/eval-questions/${project.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: qs }),
    }).catch(() => {})
    setSaving(false)
  }

  const addQuestion = () => {
    if (!newText.trim() || !newExpected.trim()) return
    const q: EvalQuestion = { id: `q_${Date.now()}`, text: newText.trim(), expected: newExpected.trim() }
    saveQuestions([...questions, q])
    setNewText('')
    setNewExpected('')
  }

  const deleteQuestion = (id: string) => saveQuestions(questions.filter(q => q.id !== id))

  const saveEdit = (id: string) => {
    saveQuestions(questions.map(q => q.id === id ? { ...q, text: editText, expected: editExpected } : q))
    setEditingId(null)
  }

  const importQuestions = async () => {
    if (!importData.trim()) return
    setSaving(true)
    const resp = await fetch(`${API}/projects/classifier-lab/eval-questions/${project.id}/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: importFormat, data: importData }),
    }).then(r => r.json()).catch(() => null)
    if (resp?.ok) {
      // Reload
      const d = await fetch(`${API}/projects/classifier-lab/eval-questions/${project.id}`).then(r => r.json())
      setQuestions(d.questions || [])
      setImportData('')
      setShowImport(false)
    }
    setSaving(false)
  }

  const runEval = async () => {
    setRunning(true)
    const resp = await fetch(`${API}/projects/classifier-lab/eval-questions/${project.id}/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }).then(r => r.json()).catch(() => null)
    if (resp?.results) {
      setResults(resp.results)
    }
    setRunning(false)
  }

  // Compute summary from results
  const evaluated = results && results.some(r => r.predicted !== null && r.predicted !== undefined)
  const passCount = evaluated ? results!.filter(r => r.passed).length : 0
  const failCount = evaluated ? results!.filter(r => r.passed === false).length : 0
  const totalQ = questions.length

  if (loading) return <div style={{ color: EMBRY.dim, padding: 40 }}>Loading test suite...</div>

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Gate card — derived from test suite results */}
      <div style={{ marginBottom: 20 }}>
        <GateCard
          name="EVAL GATE"
          passed={evaluated ? failCount === 0 : false}
          metrics={[
            { label: 'QUESTIONS', value: String(totalQ) },
            { label: 'PASSED', value: evaluated ? String(passCount) : '—', color: passCount > 0 ? EMBRY.green : EMBRY.dim },
            { label: 'FAILED', value: evaluated ? String(failCount) : '—', color: failCount > 0 ? EMBRY.red : EMBRY.dim },
          ]}
          checks={[
            { label: 'Test suite has questions', ok: totalQ > 0, detail: `${totalQ} questions` },
            { label: 'Evaluation run', ok: !!evaluated, detail: evaluated ? 'Yes' : 'Not yet' },
            { label: 'All questions passed', ok: evaluated ? failCount === 0 : false, detail: evaluated ? (failCount === 0 ? 'Yes' : `${failCount} failed`) : '—' },
          ]}
          halt={evaluated && failCount > 0 ? {
            reason: `${failCount} of ${totalQ} test questions failed. The model is not classifying correctly for these inputs.`,
            action: `Review the failed questions below. Either fix the model (retrain from Train tab) or fix the questions (edit expected class if the label was wrong).`,
          } : totalQ === 0 ? {
            reason: 'No evaluation questions defined. Cannot assess model quality without test cases.',
            action: 'Add test questions below — type examples of each class and what the model should predict. Or import a batch from CSV/JSONL.',
          } : null}
        />
      </div>

      {/* Actions bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ ...label, fontSize: 11 }}>TEST SUITE — {totalQ} questions</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowImport(!showImport)} style={{ ...btnOutline, fontSize: 9, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Upload size={10} /> IMPORT
          </button>
          <button
            onClick={runEval}
            disabled={running || totalQ === 0}
            style={{
              background: totalQ > 0 ? EMBRY.accent : 'transparent',
              border: `1px solid ${totalQ > 0 ? EMBRY.accent : EMBRY.border}`,
              color: totalQ > 0 ? '#000' : EMBRY.dim,
              padding: '4px 14px', borderRadius: 6, fontSize: 10, fontWeight: 900, cursor: totalQ > 0 ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <Play size={10} /> {running ? 'RUNNING...' : totalQ === 0 ? 'ADD QUESTIONS FIRST' : 'RUN EVALUATION'}
          </button>
        </div>
      </div>

      {/* Import panel */}
      {showImport && (
        <div style={{ ...card, marginBottom: 16, padding: 16 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 10, alignItems: 'center' }}>
            <div style={label}>IMPORT QUESTIONS</div>
            <select value={importFormat} onChange={e => setImportFormat(e.target.value as 'csv' | 'jsonl')} style={filterSelect}>
              <option value="jsonl">JSONL (one JSON per line)</option>
              <option value="csv">CSV (text,expected)</option>
            </select>
          </div>
          <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 8 }}>
            {importFormat === 'jsonl'
              ? 'Each line: {"text": "...", "expected": "Business"} — also accepts "class", "label", "question", "input" field names'
              : 'First row is header. Columns: text,expected'}
          </div>
          <textarea
            value={importData}
            onChange={e => setImportData(e.target.value)}
            placeholder={importFormat === 'jsonl'
              ? '{"text": "Apple stock rises 5%", "expected": "Business"}\n{"text": "Lakers win championship", "expected": "Sports"}'
              : 'text,expected\n"Apple stock rises 5%",Business\n"Lakers win championship",Sports'}
            style={{
              width: '100%', minHeight: 120, resize: 'vertical',
              background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 4,
              color: EMBRY.white, fontFamily: MONO, fontSize: 10, lineHeight: 1.5,
              padding: 10, outline: 'none', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={importQuestions} disabled={saving || !importData.trim()} style={{ ...btnOutline, borderColor: EMBRY.accent + '66', color: EMBRY.accent, fontSize: 9, padding: '4px 12px' }}>
              {saving ? 'IMPORTING...' : 'IMPORT'}
            </button>
            <button onClick={() => setShowImport(false)} style={{ ...btnOutline, fontSize: 9, padding: '4px 12px' }}>CANCEL</button>
          </div>
        </div>
      )}

      {/* Questions table */}
      <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${EMBRY.border}` }}>
              <th style={{ ...thStyle, width: 40 }}>#</th>
              <th style={thStyle}>INPUT TEXT</th>
              <th style={{ ...thStyle, width: 120 }}>EXPECTED</th>
              {evaluated && <th style={{ ...thStyle, width: 120 }}>PREDICTED</th>}
              {evaluated && <th style={{ ...thStyle, width: 60, textAlign: 'center' }}>RESULT</th>}
              <th style={{ ...thStyle, width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {questions.map((q, i) => {
              const r = results?.find(r => r.id === q.id)
              const isEditing = editingId === q.id
              return (
                <tr key={q.id} style={{ borderBottom: `1px solid ${EMBRY.border}`, background: r?.passed === false ? 'rgba(255,68,68,0.03)' : 'transparent' }}>
                  <td style={{ ...tdStyle, color: EMBRY.muted, width: 40 }}>{i + 1}</td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <input value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveEdit(q.id)}
                        style={{ ...rerunInputStyle, fontSize: 10, padding: '4px 8px' }} autoFocus />
                    ) : (
                      <span style={{ fontSize: 10 }}>{q.text}</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, width: 120 }}>
                    {isEditing ? (
                      classes.length > 0 ? (
                        <select value={editExpected} onChange={e => setEditExpected(e.target.value)} style={{ ...filterSelect, fontSize: 10 }}>
                          {classes.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <input value={editExpected} onChange={e => setEditExpected(e.target.value)} style={{ ...rerunInputStyle, fontSize: 10, padding: '4px 8px' }} />
                      )
                    ) : (
                      <span style={{ fontSize: 10, fontFamily: MONO }}>{q.expected}</span>
                    )}
                  </td>
                  {evaluated && (
                    <td style={{ ...tdStyle, width: 120, fontFamily: MONO, fontSize: 10, color: r?.predicted ? (r.passed ? EMBRY.green : EMBRY.red) : EMBRY.muted }}>
                      {r?.predicted || '—'}
                    </td>
                  )}
                  {evaluated && (
                    <td style={{ textAlign: 'center', padding: '8px 4px' }}>
                      {r?.passed !== null && r?.passed !== undefined ? (
                        <span style={{ ...statusBadge, fontSize: 8, background: r.passed ? 'rgba(0,255,136,0.1)' : 'rgba(255,68,68,0.1)', color: r.passed ? EMBRY.green : EMBRY.red }}>
                          {r.passed ? 'PASS' : 'FAIL'}
                        </span>
                      ) : <span style={{ fontSize: 8, color: EMBRY.muted }}>—</span>}
                    </td>
                  )}
                  <td style={{ ...tdStyle, width: 60 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {isEditing ? (
                        <button onClick={() => saveEdit(q.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: EMBRY.green, fontSize: 10, fontWeight: 700 }}>SAVE</button>
                      ) : (
                        <>
                          <button onClick={() => { setEditingId(q.id); setEditText(q.text); setEditExpected(q.expected) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                            <Pencil size={10} color={EMBRY.dim} />
                          </button>
                          <button onClick={() => deleteQuestion(q.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                            <Trash2 size={10} color={EMBRY.dim} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {/* Empty state */}
            {questions.length === 0 && (
              <tr>
                <td colSpan={evaluated ? 6 : 4} style={{ padding: 32, textAlign: 'center', color: EMBRY.dim, fontSize: 11 }}>
                  No evaluation questions yet. Add them below or import a batch.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add question inline */}
      <div style={{ ...card, padding: 12, display: 'flex', gap: 10, alignItems: 'end' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 8, color: EMBRY.muted, marginBottom: 4 }}>INPUT TEXT</div>
          <input
            value={newText}
            onChange={e => setNewText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addQuestion()}
            placeholder="Type a test input for the classifier..."
            style={rerunInputStyle}
          />
        </div>
        <div style={{ width: 150 }}>
          <div style={{ fontSize: 8, color: EMBRY.muted, marginBottom: 4 }}>EXPECTED CLASS</div>
          {classes.length > 0 ? (
            <select value={newExpected} onChange={e => setNewExpected(e.target.value)} style={{ ...filterSelect, width: '100%', padding: '8px 10px' }}>
              <option value="">Select...</option>
              {classes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <input
              value={newExpected}
              onChange={e => setNewExpected(e.target.value)}
              placeholder="Class name"
              style={rerunInputStyle}
            />
          )}
        </div>
        <button onClick={addQuestion} disabled={!newText.trim() || !newExpected.trim()} style={{
          background: newText.trim() && newExpected.trim() ? EMBRY.accent : 'transparent',
          border: `1px solid ${newText.trim() && newExpected.trim() ? EMBRY.accent : EMBRY.border}`,
          color: newText.trim() && newExpected.trim() ? '#000' : EMBRY.dim,
          padding: '8px 16px', borderRadius: 6, fontSize: 10, fontWeight: 900, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
        }}>
          <Plus size={12} /> ADD
        </button>
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
  const [modelCardMd, setModelCardMd] = useState('')
  const [exportFormat, setExportFormat] = useState('safetensors')
  const [pushToHf, setPushToHf] = useState(false)
  const [showModelCard, setShowModelCard] = useState(false)
  const [editingCard, setEditingCard] = useState(false)
  const [cardDraft, setCardDraft] = useState('')

  useEffect(() => {
    setLoading(true)
    setPromoteStatus({ kind: 'idle', text: '' })
    Promise.all([
      fetch(`${API}/projects/classifier-lab/eval-results/${project.id}`).then(r => r.json()),
      fetch(`${API}/projects/classifier-lab/model-card/${project.id}`).then(r => r.json()).catch(() => ({ markdown: '' })),
    ]).then(([evalD, cardD]) => {
      setEvalData(evalD)
      setModelCardMd(cardD.markdown || '')
      setLoading(false)
    }).catch(() => { setEvalData(null); setLoading(false) })
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
        body: JSON.stringify({ model: modelName, macro_f1: macroF1, accuracy, format: exportFormat, pushToHf }),
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
      {/* Promote gate card */}
      <div style={{ marginBottom: 20 }}>
        <GateCard
          name="PROMOTE GATE"
          passed={holdoutPassed}
          metrics={[
            { label: 'HOLDOUT F1', value: macroF1.toFixed(3), color: holdoutPassed ? EMBRY.green : EMBRY.red },
            { label: 'MODEL', value: modelName.split('/').pop() || modelName },
            { label: 'EXPORT', value: exportStatus },
          ]}
          checks={[
            { label: 'Eval gate passed', ok: holdoutPassed, detail: holdoutPassed ? `F1 ${macroF1.toFixed(3)}` : 'Run Evaluate first' },
          ]}
          halt={!holdoutPassed ? {
            reason: `Model F1 (${macroF1.toFixed(3)}) did not pass the holdout gate (≥ ${gateThreshold.toFixed(2)}). Cannot promote.`,
            action: 'Go back to the Train tab to improve the model, or lower the gate threshold if this performance is acceptable for your use case.',
          } : null}
        />
      </div>

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
          <StatPanel title="F1 SCORE" value={macroF1.toFixed(3)} color={holdoutPassed ? EMBRY.green : EMBRY.red} />
          <StatPanel title="ACCURACY" value={accuracy.toFixed(3)} color={holdoutPassed ? EMBRY.green : EMBRY.white} />
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

        {/* Export settings */}
        {holdoutPassed && (
          <div style={{ ...panel, textAlign: 'left', marginBottom: 24 }}>
            <div style={{ ...label, marginBottom: 12 }}>EXPORT SETTINGS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 4 }}>FORMAT</div>
                <select
                  value={exportFormat}
                  onChange={e => setExportFormat(e.target.value)}
                  style={filterSelect}
                >
                  <option value="safetensors">SafeTensors (.safetensors)</option>
                  <option value="onnx">ONNX (.onnx)</option>
                  <option value="gguf">GGUF (.gguf)</option>
                  <option value="torchscript">TorchScript (.pt)</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 4 }}>HUGGING FACE</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={pushToHf}
                    onChange={e => setPushToHf(e.target.checked)}
                    style={{ accentColor: EMBRY.accent }}
                  />
                  <span style={{ fontSize: 10, color: EMBRY.white }}>
                    Push to HuggingFace Hub
                  </span>
                </label>
                {pushToHf && (
                  <div style={{ fontSize: 8, color: EMBRY.muted, marginTop: 4, fontFamily: MONO }}>
                    Requires HF_TOKEN in environment
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Model card — editable with preview */}
        {holdoutPassed && modelCardMd && (() => {
          // Strip YAML frontmatter for markdown rendering
          const stripFrontmatter = (md: string) => {
            const match = md.match(/^---\n[\s\S]*?\n---\n/)
            return match ? md.slice(match[0].length) : md
          }
          const currentMd = editingCard ? cardDraft : modelCardMd
          return (
            <div style={{ ...panel, textAlign: 'left', marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showModelCard ? 12 : 0 }}>
                <button
                  onClick={() => setShowModelCard(!showModelCard)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}
                >
                  {showModelCard ? <ChevronDown size={12} color={EMBRY.dim} /> : <ChevronRight size={12} color={EMBRY.dim} />}
                  <span style={label}>MODEL CARD</span>
                  <span style={{ fontSize: 9, color: EMBRY.muted }}>— auto-generated, editable before push</span>
                </button>
                {showModelCard && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => {
                        if (editingCard) {
                          setEditingCard(false)
                          setModelCardMd(cardDraft)
                        } else {
                          setCardDraft(modelCardMd)
                          setEditingCard(true)
                        }
                      }}
                      style={{ ...btnOutline, fontSize: 8, padding: '2px 8px', borderColor: editingCard ? EMBRY.accent + '66' : EMBRY.border, color: editingCard ? EMBRY.accent : EMBRY.dim }}
                    >{editingCard ? 'PREVIEW' : 'EDIT'}</button>
                    <button
                      onClick={() => navigator.clipboard?.writeText(currentMd)}
                      style={{ ...btnOutline, fontSize: 8, padding: '2px 8px' }}
                    >COPY</button>
                  </div>
                )}
              </div>
              {showModelCard && (
                editingCard ? (
                  <textarea
                    value={cardDraft}
                    onChange={e => setCardDraft(e.target.value)}
                    style={{
                      width: '100%', minHeight: 400, maxHeight: 600, resize: 'vertical',
                      background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 4,
                      color: EMBRY.white, fontFamily: MONO, fontSize: 11, lineHeight: 1.6,
                      padding: 12, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                ) : (
                  <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12 }}>
                    <style>{MD_CSS}</style>
                    <div
                      className="clf-markdown"
                      style={{ fontSize: 11, lineHeight: 1.6, maxHeight: 500, overflow: 'auto' }}
                      dangerouslySetInnerHTML={{ __html: marked(stripFrontmatter(currentMd)) as string }}
                    />
                  </div>
                )
              )}
            </div>
          )
        })()}

        {holdoutPassed && (() => {
          const exportReady = exportStatus !== 'Not exported'
          const artifactsReady = exportArtifacts.length > 0
          const registryReady = deploymentStatus !== 'Not deployed' && deploymentStatus !== 'Pending'
          const deployed = deploymentStatus.toLowerCase().includes('complete') || deploymentStatus.toLowerCase().includes('deployed')
          const steps = [
            { id: 'eval', label: 'Holdout evaluation passed', detail: `F1 ${macroF1.toFixed(3)} ≥ ${gateThreshold.toFixed(2)}`, done: true },
            { id: 'export', label: 'Export model', detail: exportReady ? exportStatus : 'Not exported', done: exportReady },
            { id: 'artifacts', label: 'Generate artifacts', detail: artifactsReady ? `${exportArtifacts.length} files` : 'None yet', done: artifactsReady },
            { id: 'registry', label: 'Register in model registry', detail: registryReady ? deploymentStatus : 'Not registered', done: registryReady },
            { id: 'deploy', label: 'Deploy to production', detail: deployed ? deploymentStatus : 'Not deployed', done: deployed },
          ]
          const completedSteps = steps.filter(s => s.done).length
          const allDone = completedSteps === steps.length
          // Find first incomplete step
          const nextStep = steps.find(s => !s.done)
          return (
            <>
              {/* Workflow checklist */}
              <div style={{ ...panel, textAlign: 'left', marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={label}>PROMOTION WORKFLOW</div>
                  <span style={{ fontSize: 9, fontFamily: MONO, color: allDone ? EMBRY.green : EMBRY.amber }}>
                    {completedSteps}/{steps.length} COMPLETE
                  </span>
                </div>
                {/* Progress bar */}
                <div style={{ height: 4, background: EMBRY.bgDeep, borderRadius: 2, overflow: 'hidden', marginBottom: 16 }}>
                  <div style={{ height: '100%', width: `${(completedSteps / steps.length) * 100}%`, background: allDone ? EMBRY.green : EMBRY.accent, borderRadius: 2, transition: 'width 0.3s' }} />
                </div>
                {steps.map((step, i) => {
                  const isNext = step.id === nextStep?.id
                  return (
                    <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: i < steps.length - 1 ? 12 : 0 }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: step.done ? EMBRY.green : isNext ? EMBRY.accent + '22' : 'transparent',
                        border: step.done ? 'none' : `2px solid ${isNext ? EMBRY.accent : EMBRY.border}`,
                        fontSize: 10, fontWeight: 900,
                        color: step.done ? '#000' : isNext ? EMBRY.accent : EMBRY.dim,
                      }}>
                        {step.done ? '✓' : i + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: step.done ? EMBRY.white : isNext ? EMBRY.white : EMBRY.dim }}>{step.label}</div>
                        <div style={{ fontSize: 9, fontFamily: MONO, color: step.done ? EMBRY.green : EMBRY.muted, marginTop: 2 }}>{step.detail}</div>
                      </div>
                      {/* Action button for the next incomplete step */}
                      {isNext && step.id === 'export' && (
                        <button
                          onClick={() => {
                            fetch(`${API}/projects/classifier-lab/promote/${project.id}`, {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ model: modelName, macro_f1: macroF1, accuracy, action: 'export' }),
                            }).catch(() => {})
                          }}
                          style={{ ...btnOutline, borderColor: EMBRY.accent + '66', color: EMBRY.accent, fontSize: 9, padding: '4px 12px', whiteSpace: 'nowrap' }}
                        >EXPORT MODEL</button>
                      )}
                      {isNext && step.id === 'registry' && (
                        <button
                          onClick={() => {
                            fetch(`${API}/projects/classifier-lab/promote/${project.id}`, {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ model: modelName, macro_f1: macroF1, accuracy, action: 'register' }),
                            }).catch(() => {})
                          }}
                          style={{ ...btnOutline, borderColor: EMBRY.accent + '66', color: EMBRY.accent, fontSize: 9, padding: '4px 12px', whiteSpace: 'nowrap' }}
                        >REGISTER</button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Artifacts list */}
              {exportArtifacts.length > 0 && (
                <div style={{ ...panel, textAlign: 'left', marginBottom: 24 }}>
                  <div style={{ ...label, marginBottom: 8 }}>EXPORT ARTIFACTS</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {exportArtifacts.map(artifact => (
                      <span key={artifact} style={{ ...statusBadge, fontFamily: MONO, color: EMBRY.white, background: 'rgba(255,255,255,0.05)', border: `1px solid ${EMBRY.border}`, padding: '3px 8px' }}>
                        <FileText size={8} style={{ marginRight: 4, verticalAlign: 'middle' }} />{artifact}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <RunButton onClick={promoteModel} disabled={promoting || !allDone}>
                {promoting ? 'PROMOTING...' : allDone ? 'PROMOTE TO PRODUCTION' : 'COMPLETE STEPS ABOVE FIRST'}
              </RunButton>
              {promoteStatus.kind !== 'idle' && (
                <div style={{
                  marginTop: 10, fontSize: 10, fontFamily: MONO,
                  color: promoteStatus.kind === 'success' ? EMBRY.green : promoteStatus.kind === 'error' ? EMBRY.red : EMBRY.amber,
                }}>
                  {promoteStatus.text}
                </div>
              )}
            </>
          )
        })()}

        {!holdoutPassed && (
          <div style={{ ...panel, marginTop: 12, border: `1px solid ${EMBRY.red}33`, background: `${EMBRY.red}08` }}>
            <div style={{ fontSize: 11, color: EMBRY.red, fontWeight: 700 }}>
              Promotion blocked until holdout gate passes (F1 ≥ {gateThreshold.toFixed(2)}).
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

/** Reusable gate status card — used in every tab beyond Research */
function GateCard({ name, passed, metrics, checks, bars, halt }: {
  name: string
  passed: boolean
  metrics: Array<{ label: string; value: string | number; color?: string }>
  checks: Array<{ label: string; ok: boolean; detail?: string }>
  bars?: Array<{ label: string; value: number; total: number; color: string }>
  halt?: { reason: string; action: string } | null
}) {
  const halted = !!halt && !passed
  const borderColor = passed ? EMBRY.green : halted ? EMBRY.amber : EMBRY.red
  const statusLabel = passed ? 'PASSED' : halted ? 'HALTED' : 'FAILED'
  const statusIcon = passed
    ? <ShieldCheck size={18} color={EMBRY.green} />
    : halted
      ? <AlertTriangle size={18} color={EMBRY.amber} />
      : <AlertTriangle size={18} color={EMBRY.red} />
  return (
    <div style={{ ...card, border: `1px solid ${borderColor}33`, background: `${borderColor}04` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: halted ? 12 : 16 }}>
        {statusIcon}
        <span style={{ fontSize: 12, fontWeight: 900, color: borderColor }}>
          {name} {statusLabel}
        </span>
      </div>
      {/* Halt diagnosis — shown prominently when halted */}
      {halted && halt && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 6, background: `${EMBRY.amber}08`, border: `1px solid ${EMBRY.amber}22` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: EMBRY.amber, marginBottom: 6 }}>WHY THIS STEP HALTED</div>
          <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.6, marginBottom: 8 }}>{halt.reason}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: EMBRY.accent, marginBottom: 4 }}>WHAT WOULD UNBLOCK IT</div>
          <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.6 }}>{halt.action}</div>
        </div>
      )}
      {/* Key metrics */}
      {metrics.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(metrics.length, 3)}, 1fr)`, gap: 12, marginBottom: 16 }}>
          {metrics.map(m => (
            <div key={m.label}>
              <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 2 }}>{m.label}</div>
              <div style={{ fontSize: 18, fontWeight: 900, fontFamily: MONO, color: m.color || EMBRY.white }}>{m.value}</div>
            </div>
          ))}
        </div>
      )}
      {/* Progress bars */}
      {bars && bars.length > 0 && (
        <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12, marginBottom: 12 }}>
          {bars.map(b => {
            const pct = b.total > 0 ? (b.value / b.total) * 100 : 0
            return (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontFamily: MONO, width: 50, color: EMBRY.dim }}>{b.label}</span>
                <div style={{ flex: 1, height: 4, background: EMBRY.bgDeep, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: b.color, borderRadius: 2 }} />
                </div>
                <span style={{ fontSize: 10, fontFamily: MONO, color: EMBRY.dim, width: 80, textAlign: 'right' }}>{b.value} ({pct.toFixed(0)}%)</span>
              </div>
            )
          })}
        </div>
      )}
      {/* Quality checks */}
      {checks.length > 0 && (
        <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12 }}>
          <div style={{ fontSize: 9, color: EMBRY.muted, marginBottom: 6 }}>QUALITY CHECKS</div>
          {checks.map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: 10 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: c.ok ? EMBRY.green : EMBRY.amber }} />
              <span style={{ color: EMBRY.dim, flex: 1 }}>{c.label}</span>
              {c.detail && <span style={{ fontFamily: MONO, color: c.ok ? EMBRY.green : EMBRY.amber }}>{c.detail}</span>}
            </div>
          ))}
        </div>
      )}
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
const roundPillStyle: React.CSSProperties = {
  background: 'transparent', border: `1px solid ${EMBRY.border}`, borderRadius: 12,
  padding: '2px 8px', fontSize: 9, fontFamily: MONO, fontWeight: 700, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center',
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
