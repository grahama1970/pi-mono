/**
 * LlmEvalLabView — Model evaluation lab with three tabs.
 *
 * Playground: experiment with models, test prompts side-by-side.
 * Library: build question sets, pick models, set eval modes.
 * Results: view grid-eval output, pick the winner.
 */
import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { EMBRY, label, heading, body, card, panel } from '../common/EmbryStyle'
import { Plus, X } from 'lucide-react'
import { LeftPane, paneItemStyle } from '../common/LeftPane'
import { ModelPicker, type ModelConfig } from '../common/ModelPicker'
import { RunButton } from '../common/RunButton'
import { EditModal } from '../common/EditModal'
import { useRegisterAction } from '../../../hooks/useRegisterAction'

const API = 'http://localhost:3001/api'
const MONO = '"JetBrains Mono", "SF Mono", monospace'
const EVAL_MODES = ['contains', 'exact', 'regex', 'json_field', 'not_empty', 'agent_judge'] as const
type EvalMode = typeof EVAL_MODES[number]

// --- Types ---

type Tab = 'playground' | 'library' | 'results'

interface GridCell { pass: boolean; tries: number; error?: boolean; output?: string }
interface GridRow { short: string; input?: string; expected?: string; results: Record<string, GridCell> }
interface GridData {
  timestamp: string; title: string; models: string[]; question_count: number; max_retries: number
  grid: Record<string, GridRow>
  summary: Record<string, { passed: number; retries: number; params_b: number }>
  recommendation: string | null
}

interface Question { id: number; short: string; input: string; expected: string; eval: EvalMode; max_tries?: number }
interface GroundTruth { title: string; models: string[]; questions: Question[] }

// ModelConfig imported from ../common/ModelPicker

// --- Component ---

export function LlmEvalLabView() {
  const [activeTab, setActiveTab] = useState<Tab>('playground')
  const [pendingResultFile, setPendingResultFile] = useState<string | null>(null)

  useRegisterAction('eval-lab:tab:playground', { app: 'sparta-explorer', action: 'SWITCH_TAB_PLAYGROUND', label: 'Playground Tab', description: 'Switch to the Playground tab for side-by-side model testing' })
  useRegisterAction('eval-lab:tab:library', { app: 'sparta-explorer', action: 'SWITCH_TAB_LIBRARY', label: 'Library Tab', description: 'Switch to the Library tab to manage evaluation question sets' })
  useRegisterAction('eval-lab:tab:results', { app: 'sparta-explorer', action: 'SWITCH_TAB_RESULTS', label: 'Results Tab', description: 'Switch to the Results tab to view grid-eval output' })

  // Shared: models registry
  const [allModels, setAllModels] = useState<Record<string, ModelConfig>>({})
  const loadModels = useCallback(() => {
    fetch(`${API}/projects/llm-eval-lab/models`).then(r => r.json())
      .then(d => { const clean: Record<string, ModelConfig> = {}; for (const [k, v] of Object.entries(d)) { if (!k.startsWith('_') && typeof v === 'object') clean[k] = v as ModelConfig }; setAllModels(clean) })
      .catch(() => {})
  }, [])
  useEffect(() => { loadModels() }, [loadModels])

  // Navigate to results tab with a specific file
  const goToResults = useCallback((file?: string) => {
    if (file) setPendingResultFile(file)
    setActiveTab('results')
  }, [])

  return (
    <div style={{ backgroundColor: EMBRY.bg, minHeight: '100%', color: EMBRY.white, display: 'flex', flexDirection: 'column', fontFamily: 'Inter, sans-serif' }}>
      <style>{INLINE_CSS}</style>

      {/* Tab bar */}
      <div role="tablist" aria-label="LLM Eval Lab tabs" style={{ height: 52, borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', paddingLeft: 20, gap: 32, background: EMBRY.bgHeader, flexShrink: 0, position: 'sticky', top: 0, zIndex: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
        {(['playground', 'library', 'results'] as const).map(t => (
          <button key={t} role="tab" aria-selected={activeTab === t} aria-controls={`tabpanel-${t}`}
            data-qid={`eval-lab:tab:${t}`}
            title={`Switch to ${t} tab`}
            onClick={() => setActiveTab(t)}
            style={{
              height: '100%', background: 'none', border: 'none', padding: '0 12px',
              color: activeTab === t ? EMBRY.accent : EMBRY.white, cursor: 'pointer',
              borderBottom: activeTab === t ? `2px solid ${EMBRY.accent}` : '2px solid transparent',
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em',
              transition: 'all 0.15s', opacity: activeTab === t ? 1 : 0.7,
            }}>
            {t}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`tabpanel-${activeTab}`} style={{ flex: 1, overflow: 'hidden', ...(activeTab === 'playground' ? { padding: 24, overflowY: 'auto' } : {}) }}>
        {activeTab === 'playground' && <PlaygroundTab allModels={allModels} onModelsChanged={loadModels} />}
        {activeTab === 'library' && <LibraryTab allModels={allModels} onModelsChanged={loadModels} goToResults={goToResults} />}
        {activeTab === 'results' && <ResultsTab allModels={allModels} pendingFile={pendingResultFile} onFileConsumed={() => setPendingResultFile(null)} />}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYGROUND TAB — experiment with models, test prompts side-by-side
// ═══════════════════════════════════════════════════════════════════════════

function PlaygroundTab({ allModels, onModelsChanged }: { allModels: Record<string, ModelConfig>; onModelsChanged?: () => void }) {
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [outputs, setOutputs] = useState<Record<string, { content: string; loading: boolean; latency?: number }>>({})

  useRegisterAction('eval-lab:playground:system-prompt', { app: 'sparta-explorer', action: 'SET_SYSTEM_PROMPT', label: 'System Prompt', description: 'Set the system prompt used for all models in the playground' })
  useRegisterAction('eval-lab:playground:prompt', { app: 'sparta-explorer', action: 'SET_PROMPT', label: 'Prompt Input', description: 'Enter a prompt to test across all selected models side-by-side' })
  useRegisterAction('eval-lab:playground:run', { app: 'sparta-explorer', action: 'RUN_PROMPT', label: 'Run Prompt', description: 'Run the current prompt against all selected models concurrently' })

  // Auto-select first 2 local models
  useEffect(() => {
    if (selectedModels.length > 0) return
    const locals = Object.entries(allModels).filter(([, c]) => c.local || c.provider === 'ollama').map(([k]) => k).slice(0, 2)
    if (locals.length > 0) setSelectedModels(locals)
  }, [allModels, selectedModels.length])

  const toggleModel = (alias: string) => {
    setSelectedModels(prev => prev.includes(alias) ? prev.filter(m => m !== alias) : [...prev, alias])
  }

  const runPrompt = useCallback(async () => {
    if (!prompt.trim() || selectedModels.length === 0) return
    const newOutputs: typeof outputs = {}
    selectedModels.forEach(m => { newOutputs[m] = { content: '', loading: true } })
    setOutputs(newOutputs)

    // Run all models concurrently
    const callModel = async (model: string) => {
      const config = allModels[model]
      const messages: Array<{ role: string; content: string }> = []
      if (systemPrompt.trim()) messages.push({ role: 'system', content: systemPrompt })
      messages.push({ role: 'user', content: prompt })

      // scillm routing: always send the actual model ID from config
      // local → ollama tag (e.g. "qwen3:8b"), cloud → Chutes ID (e.g. "Qwen/Qwen3-30B-A3B")
      const scillmModel = config?.model || model

      const start = Date.now()
      try {
        const resp = await fetch(`${API}/scillm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: scillmModel, messages, max_tokens: 512 }),
        })
        if (!resp.ok) {
          const errText = await resp.text()
          throw new Error(`${resp.status}: ${errText.slice(0, 100)}`)
        }
        const data = await resp.json()
        const content = data?.choices?.[0]?.message?.content ?? data?.content ?? JSON.stringify(data)
        setOutputs(prev => ({ ...prev, [model]: { content, loading: false, latency: Date.now() - start } }))
      } catch (err) {
        setOutputs(prev => ({ ...prev, [model]: { content: `ERROR: ${err}`, loading: false, latency: Date.now() - start } }))
      }
    }

    await Promise.allSettled(selectedModels.map(callModel))
  }, [prompt, systemPrompt, selectedModels, allModels])

  return (
    <>
      {/* System prompt */}
      <div style={{ marginBottom: 16 }}>
        <div style={label}>System Prompt (optional)</div>
        <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
          placeholder="You are a helpful assistant..."
          aria-label="System prompt"
          data-qid="eval-lab:playground:system-prompt"
          title="System prompt applied to all models"
          rows={2}
          style={{ ...inputStyle, width: '100%', marginTop: 8, resize: 'vertical', fontFamily: MONO, fontSize: 11 }} />
      </div>

      {/* Model picker */}
      <ModelPicker allModels={allModels} selected={selectedModels} onToggle={toggleModel} onModelsChanged={onModelsChanged} />

      {/* Prompt input + run */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder="Enter a prompt to test across models..."
          aria-label="Prompt input"
          data-qid="eval-lab:playground:prompt"
          title="Prompt to test across selected models (Cmd+Enter to run)"
          rows={3}
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) runPrompt() }}
          style={{ ...inputStyle, flex: 1, resize: 'vertical', fontSize: 13 }} />
        <div style={{ alignSelf: 'flex-end' }} data-qid="eval-lab:playground:run" title="Run prompt against all selected models (Cmd+Enter)">
          <RunButton onClick={runPrompt} disabled={!prompt.trim() || selectedModels.length === 0} ariaLabel="Run prompt">
            RUN
          </RunButton>
        </div>
      </div>

      {/* Side-by-side outputs */}
      {selectedModels.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(selectedModels.length, 3)}, 1fr)`, gap: 16 }}>
          {selectedModels.map(model => {
            const out = outputs[model]
            return (
              <div key={model} style={{ ...panel, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ ...label, color: EMBRY.white }}>{model}</div>
                  {out?.latency && <div style={{ fontSize: 9, fontFamily: MONO, color: out.latency > 2000 ? EMBRY.amber : EMBRY.dim }}>{(out.latency / 1000).toFixed(1)}s</div>}
                </div>
                <div style={{
                  flex: 1, minHeight: 120, padding: 12, background: EMBRY.bgDeep, borderRadius: 4,
                  fontFamily: MONO, fontSize: 11, color: out?.loading ? EMBRY.dim : EMBRY.white,
                  lineHeight: 1.6, whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 400,
                }}>
                  {out?.loading ? '[ Running... ]' : out?.content || '[ Awaiting prompt ]'}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// LIBRARY TAB — build question sets, pick models, set eval modes
// ═══════════════════════════════════════════════════════════════════════════

function LibraryTab({ allModels, onModelsChanged, goToResults }: { allModels: Record<string, ModelConfig>; onModelsChanged?: () => void; goToResults?: (file?: string) => void }) {
  const [gtFiles, setGtFiles] = useState<string[]>([])
  const [selectedGtFile, setSelectedGtFile] = useState('')
  const [gt, setGt] = useState<GroundTruth>({ title: 'New Evaluation', models: [], questions: [] })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useRegisterAction('eval-lab:library:select-gt-file', { app: 'sparta-explorer', action: 'SELECT_GT_FILE', label: 'Select Ground Truth File', description: 'Load a ground truth evaluation file from the left panel' })
  useRegisterAction('eval-lab:library:title', { app: 'sparta-explorer', action: 'SET_EVAL_TITLE', label: 'Evaluation Title', description: 'Set the title for the current evaluation set' })
  useRegisterAction('eval-lab:library:save', { app: 'sparta-explorer', action: 'SAVE_GT', label: 'Save Ground Truth', description: 'Save the current ground truth evaluation set to disk' })
  useRegisterAction('eval-lab:library:add-import', { app: 'sparta-explorer', action: 'OPEN_ADD_QUESTION_MODAL', label: 'Add / Import Questions', description: 'Open the modal to add a single question or import a batch from JSON' })
  useRegisterAction('eval-lab:library:clear', { app: 'sparta-explorer', action: 'CLEAR_QUESTIONS', label: 'Clear All Questions', description: 'Remove all questions from the current evaluation set' })
  useRegisterAction('eval-lab:library:run-eval', { app: 'sparta-explorer', action: 'RUN_EVAL', label: 'Run Evaluation', description: 'Save the evaluation set and trigger a full grid evaluation run' })
  useRegisterAction('eval-lab:library:edit-question-row', { app: 'sparta-explorer', action: 'EDIT_QUESTION', label: 'Edit Question', description: 'Open the edit modal for an existing question' })
  useRegisterAction('eval-lab:library:remove-question', { app: 'sparta-explorer', action: 'REMOVE_QUESTION', label: 'Remove Question', description: 'Delete a question from the evaluation set' })
  useRegisterAction('eval-lab:library:add-question-row', { app: 'sparta-explorer', action: 'ADD_QUESTION_ROW', label: 'Add Question Row', description: 'Open the add question modal from the table footer' })
  useRegisterAction('eval-lab:library:modal-mode-single', { app: 'sparta-explorer', action: 'MODAL_MODE_SINGLE', label: 'Single Question Mode', description: 'Switch add modal to single question entry form' })
  useRegisterAction('eval-lab:library:modal-mode-import', { app: 'sparta-explorer', action: 'MODAL_MODE_IMPORT', label: 'Import Mode', description: 'Switch add modal to batch JSON import mode' })
  useRegisterAction('eval-lab:library:modal-close', { app: 'sparta-explorer', action: 'CLOSE_QUESTION_MODAL', label: 'Close Modal', description: 'Close the add/edit question modal without saving' })
  useRegisterAction('eval-lab:library:modal-cancel', { app: 'sparta-explorer', action: 'CANCEL_QUESTION_EDIT', label: 'Cancel Edit', description: 'Cancel the question add or edit and close the modal' })
  useRegisterAction('eval-lab:library:modal-save', { app: 'sparta-explorer', action: 'SAVE_QUESTION', label: 'Save Question', description: 'Save the new or edited question to the evaluation set' })
  useRegisterAction('eval-lab:library:modal-import', { app: 'sparta-explorer', action: 'IMPORT_BATCH', label: 'Import Batch', description: 'Import the pasted JSON batch of questions into the evaluation set' })
  useRegisterAction('eval-lab:library:modal-short-name', { app: 'sparta-explorer', action: 'SET_QUESTION_SHORT_NAME', label: 'Short Name', description: 'Set the short identifier for the question' })
  useRegisterAction('eval-lab:library:modal-question-input', { app: 'sparta-explorer', action: 'SET_QUESTION_INPUT', label: 'Question Input', description: 'Set the question text sent to the model' })
  useRegisterAction('eval-lab:library:modal-expected', { app: 'sparta-explorer', action: 'SET_EXPECTED_ANSWER', label: 'Expected Answer', description: 'Set the expected answer used for evaluation scoring' })
  useRegisterAction('eval-lab:library:modal-eval-mode', { app: 'sparta-explorer', action: 'SET_EVAL_MODE', label: 'Eval Mode', description: 'Choose the evaluation comparison method (contains, exact, regex, etc.)' })
  useRegisterAction('eval-lab:library:modal-max-tries', { app: 'sparta-explorer', action: 'SET_MAX_TRIES', label: 'Max Tries', description: 'Set the maximum number of retry attempts for this question' })
  useRegisterAction('eval-lab:library:modal-import-text', { app: 'sparta-explorer', action: 'SET_IMPORT_TEXT', label: 'Batch Import JSON', description: 'Paste a JSON array of questions to import in bulk' })

  // Load ground truth file list
  useEffect(() => {
    fetch(`${API}/projects/llm-eval-lab/ground-truth`).then(r => r.json())
      .then(d => { const f = d.files ?? []; setGtFiles(f); if (f.length > 0) setSelectedGtFile(f[0]) })
      .catch(() => {})
  }, [])

  // Load selected file
  useEffect(() => {
    if (!selectedGtFile) return
    fetch(`${API}/projects/llm-eval-lab/ground-truth/${selectedGtFile}`).then(r => r.json())
      .then(d => { setGt(d); setDirty(false) })
      .catch(() => {})
  }, [selectedGtFile])

  const updateGt = useCallback((fn: (prev: GroundTruth) => GroundTruth) => {
    setGt(prev => { const next = fn(prev); setDirty(true); return next })
  }, [])

  const addQuestion = () => {
    const nextId = gt.questions.length > 0 ? Math.max(...gt.questions.map(q => q.id)) + 1 : 1
    setEditingQ({ id: nextId, short: '', input: '', expected: '', eval: 'contains' })
  }

  const saveEditingQ = () => {
    if (!editingQ) return
    const exists = gt.questions.some(q => q.id === editingQ.id)
    if (exists) {
      updateGt(prev => ({ ...prev, questions: prev.questions.map(q => q.id === editingQ.id ? editingQ : q) }))
    } else {
      updateGt(prev => ({ ...prev, questions: [...prev.questions, editingQ] }))
    }
    setEditingQ(null)
  }

  const updateQuestion = (id: number, field: keyof Question, value: string) => {
    updateGt(prev => ({
      ...prev,
      questions: prev.questions.map(q => q.id === id ? { ...q, [field]: field === 'id' ? Number(value) : value } : q),
    }))
  }

  const removeQuestion = (id: number) => {
    updateGt(prev => ({ ...prev, questions: prev.questions.filter(q => q.id !== id) }))
  }

  const clearAllQuestions = () => {
    if (gt.questions.length === 0) return
    updateGt(prev => ({ ...prev, questions: [] }))
  }

  const [editingQ, setEditingQ] = useState<Question | null>(null)
  const [addModalMode, setAddModalMode] = useState<'single' | 'import'>('single')
  const [importText, setImportText] = useState('')

  const importBatch = () => {
    try {
      const parsed = JSON.parse(importText)
      const questions: Question[] = Array.isArray(parsed) ? parsed : parsed.questions ?? []
      if (questions.length === 0) return
      const maxId = gt.questions.length > 0 ? Math.max(...gt.questions.map(q => q.id)) : 0
      const normalized = questions.map((q, i) => ({
        id: q.id ?? maxId + i + 1,
        short: q.short ?? `Q${maxId + i + 1}`,
        input: q.input ?? '',
        expected: q.expected ?? '',
        eval: (q.eval ?? 'contains') as EvalMode,
      }))
      updateGt(prev => ({ ...prev, questions: [...prev.questions, ...normalized] }))
      setImportText('')
    } catch { /* invalid JSON — do nothing */ }
  }

  const toggleModel = (alias: string) => {
    updateGt(prev => ({
      ...prev,
      models: prev.models.includes(alias) ? prev.models.filter(m => m !== alias) : [...prev.models, alias],
    }))
  }

  const save = async () => {
    const filename = selectedGtFile || `eval_${Date.now()}.json`
    setSaving(true)
    try {
      // Save to file
      await fetch(`${API}/projects/llm-eval-lab/ground-truth/${filename}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gt),
      })
      setDirty(false)
      if (!selectedGtFile) { setSelectedGtFile(filename); setGtFiles(prev => [filename, ...prev]) }
      // Also save to memory for cross-session recall
      if (gt.questions.length > 0) {
        fetch(`${API}/memory/learn`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            problem: `LLM eval ground truth: ${gt.title} (${gt.questions.length} questions, ${gt.models.length} models)`,
            solution: JSON.stringify(gt),
            scope: 'llm-eval-lab',
            tags: ['eval', 'ground-truth', 'llm-eval-lab'],
          }),
        }).catch(() => {})
      }
    } catch { /* */ }
    setSaving(false)
  }

  const [runningEval, setRunningEval] = useState(false)
  const runEval = async () => {
    // Save first, then trigger eval
    const filename = selectedGtFile || `eval_${Date.now()}.json`
    setSaving(true)
    try {
      await fetch(`${API}/projects/llm-eval-lab/ground-truth/${filename}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gt),
      })
      setDirty(false)
      if (!selectedGtFile) { setSelectedGtFile(filename); setGtFiles(prev => [filename, ...prev]) }
    } catch { setSaving(false); return }
    setSaving(false)

    setRunningEval(true)
    try {
      const resp = await fetch(`${API}/projects/llm-eval-lab/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ground_truth: filename }),
      })
      const data = await resp.json()
      if (data.ok && data.resultFile) {
        goToResults?.(data.resultFile)
      }
    } catch { /* */ }
    setRunningEval(false)
  }

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%' }}>
      <LeftPane title="Ground Truth Files">
        {gtFiles.map(f => (
          <div key={f} onClick={() => setSelectedGtFile(f)}
            data-qid="eval-lab:library:select-gt-file"
            title={`Load ground truth file: ${f}`}
            role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') setSelectedGtFile(f) }}
            style={{
              padding: '8px 16px', cursor: 'pointer', fontSize: 11, fontFamily: MONO,
              color: selectedGtFile === f ? EMBRY.accent : EMBRY.dim,
              background: selectedGtFile === f ? 'rgba(124,58,237,0.08)' : 'transparent',
              borderLeft: selectedGtFile === f ? `3px solid ${EMBRY.accent}` : '3px solid transparent',
              transition: 'all 0.15s',
            }}>
            {f.replace('.json', '')}
          </div>
        ))}
        {gtFiles.length === 0 && (
          <div style={{ padding: '8px 16px', fontSize: 10, color: EMBRY.muted }}>No files yet</div>
        )}
      </LeftPane>

      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
      {/* Header: title + actions */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div style={label}>Title</div>
          <input value={gt.title} onChange={e => updateGt(prev => ({ ...prev, title: e.target.value }))}
            aria-label="Evaluation title"
            data-qid="eval-lab:library:title"
            title="Evaluation set title"
            style={{ ...inputStyle, width: '100%', marginTop: 6, fontSize: 13 }} />
        </div>
        <button onClick={save} disabled={!dirty || saving} aria-label="Save ground truth"
          data-qid="eval-lab:library:save"
          title="Save the current evaluation set to disk"
          style={{
            padding: '8px 20px', borderRadius: 6, border: 'none', cursor: dirty ? 'pointer' : 'default',
            background: dirty ? EMBRY.blue : EMBRY.muted, color: dirty ? '#fff' : EMBRY.dim,
            fontWeight: 700, fontSize: 11, transition: 'all 0.15s',
          }}>
          {saving ? 'SAVING...' : dirty ? 'SAVE' : 'SAVED'}
        </button>
        <button onClick={() => { setAddModalMode('single'); setEditingQ({ id: (gt.questions.length > 0 ? Math.max(...gt.questions.map(q => q.id)) + 1 : 1), short: '', input: '', expected: '', eval: 'contains' }) }}
          aria-label="Add or import questions"
          data-qid="eval-lab:library:add-import"
          title="Add a single question or import a batch from JSON"
          style={{ ...actionBtn, color: EMBRY.accent, borderColor: EMBRY.accent + '44' }}>
          + ADD / IMPORT
        </button>
        <button onClick={clearAllQuestions} aria-label="Clear all questions"
          disabled={gt.questions.length === 0}
          data-qid="eval-lab:library:clear"
          title="Remove all questions from this evaluation set"
          style={{ ...actionBtn, color: gt.questions.length > 0 ? EMBRY.red : EMBRY.muted, borderColor: EMBRY.border }}>
          CLEAR
        </button>
        <div style={{ flex: 1 }} />
        <div data-qid="eval-lab:library:run-eval" title="Save and run the full grid evaluation across all selected models">
          <RunButton onClick={runEval}
            disabled={runningEval || gt.questions.length === 0 || gt.models.length === 0}
            ariaLabel="Run evaluation">
            {runningEval ? 'RUNNING...' : 'RUN EVAL'}
          </RunButton>
        </div>
      </div>

      {/* Model picker for this eval set */}
      <ModelPicker allModels={allModels} selected={gt.models} onToggle={toggleModel}
        onModelsChanged={onModelsChanged} labelText="Models for Evaluation" />

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 20 }}>
        <StatCard label="Questions" value={gt.questions.length} />
        <StatCard label="Models" value={gt.models.length} />
        <StatCard label="Eval Modes" value={new Set(gt.questions.map(q => q.eval)).size} />
      </div>

      {/* Question list */}
      <div style={{ ...panel, padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${EMBRY.border}`, background: 'rgba(255,255,255,0.02)' }}>
              <th style={{ ...thStyle, width: 32 }}>#</th>
              <th style={{ ...thStyle, width: 130 }}>Short Name</th>
              <th style={thStyle}>Question Input</th>
              <th style={{ ...thStyle, width: 120 }}>Expected</th>
              <th style={{ ...thStyle, width: 80, whiteSpace: 'nowrap' }}>Eval</th>
              <th style={{ ...thStyle, width: 50, whiteSpace: 'nowrap' }}>Tries</th>
              <th style={{ ...thStyle, width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {gt.questions.map(q => (
              <tr key={q.id} onClick={() => setEditingQ({ ...q })}
                role="button" tabIndex={0} aria-label={`Edit question ${q.id}: ${q.short}`}
                data-qid="eval-lab:library:edit-question-row"
                title={`Edit question ${q.id}: ${q.short}`}
                onKeyDown={e => { if (e.key === 'Enter') setEditingQ({ ...q }) }}
                style={{ borderBottom: `1px solid ${EMBRY.border}`, cursor: 'pointer', transition: 'background 0.15s' }}
                className="eval-hover-row">
                <td style={tdStyle}>
                  <span style={{ fontFamily: MONO, color: EMBRY.dim, fontSize: 11 }}>{q.id}</span>
                </td>
                <td style={{ ...tdStyle, fontWeight: 600, color: EMBRY.white }}>{truncate(q.short, 18)}</td>
                <td style={{ ...tdStyle, color: EMBRY.dim, fontFamily: MONO, fontSize: 11 }}>{truncate(q.input, 70)}</td>
                <td style={{ ...tdStyle, color: EMBRY.green, fontFamily: MONO, fontSize: 11 }}>{truncate(q.expected, 15)}</td>
                <td style={{ ...tdStyle, fontFamily: MONO, fontSize: 10, color: EMBRY.dim }}>{q.eval}</td>
                <td style={{ ...tdStyle, fontFamily: MONO, fontSize: 11, color: EMBRY.white, textAlign: 'center' }}>{q.max_tries ?? '—'}</td>
                <td style={tdStyle}>
                  <button onClick={e => { e.stopPropagation(); removeQuestion(q.id) }}
                    aria-label={`Remove question ${q.id}`}
                    data-qid="eval-lab:library:remove-question"
                    title={`Remove question ${q.id}: ${q.short}`}
                    style={{ background: 'none', border: 'none', color: EMBRY.red, cursor: 'pointer', fontSize: 14, padding: 4 }}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Add row at bottom of table */}
        <div onClick={() => { setAddModalMode('single'); setEditingQ({ id: (gt.questions.length > 0 ? Math.max(...gt.questions.map(q => q.id)) + 1 : 1), short: '', input: '', expected: '', eval: 'contains' }) }}
          role="button" tabIndex={0} aria-label="Add new question"
          data-qid="eval-lab:library:add-question-row"
          title="Add a new question to the evaluation set"
          onKeyDown={e => { if (e.key === 'Enter') { setAddModalMode('single'); setEditingQ({ id: (gt.questions.length > 0 ? Math.max(...gt.questions.map(q => q.id)) + 1 : 1), short: '', input: '', expected: '', eval: 'contains' }) } }}
          style={{
            padding: '14px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
            color: EMBRY.dim, fontSize: 12, borderTop: `1px solid ${EMBRY.border}`,
            transition: 'color 0.15s',
          }}
          className="eval-hover-row">
          <Plus size={14} /> Add question...
        </div>
        {gt.questions.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: EMBRY.muted, fontFamily: MONO, fontSize: 11 }}>
            No questions yet. Click above or use "+ ADD / IMPORT" to get started.
          </div>
        )}
      </div>

      {/* Add/Edit/Import modal */}
      {editingQ && (
        <div data-qid="llm-eval:modal:edit-backdrop" data-qs-action="CLOSE_LLM_EVAL_EDIT_MODAL" style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => { setEditingQ(null); setImportText('') }}>
          <div onClick={e => e.stopPropagation()}
            style={{ ...card, width: 640, maxWidth: '90vw', maxHeight: '85vh', overflow: 'auto' }}>
            {/* Modal header with tabs */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <div style={heading}>
                  {gt.questions.some(q => q.id === editingQ.id) ? `Edit #${editingQ.id}` : 'Add Questions'}
                </div>
                {!gt.questions.some(q => q.id === editingQ.id) && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['single', 'import'] as const).map(m => (
                      <button key={m} onClick={() => setAddModalMode(m)}
                        data-qid={`eval-lab:library:modal-mode-${m}`}
                        title={m === 'single' ? 'Add a single question' : 'Batch import questions from JSON'}
                        style={{
                          padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 10,
                          fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                          background: addModalMode === m ? EMBRY.accent + '20' : 'transparent',
                          color: addModalMode === m ? EMBRY.accent : EMBRY.dim,
                          border: `1px solid ${addModalMode === m ? EMBRY.accent + '44' : EMBRY.border}`,
                        }}>
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => { setEditingQ(null); setImportText('') }} aria-label="Close"
                data-qid="eval-lab:library:modal-close"
                title="Close the question modal without saving"
                style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            {/* Single question form */}
            {(addModalMode === 'single' || gt.questions.some(q => q.id === editingQ.id)) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <div style={label}>Short Name</div>
                  <input value={editingQ.short}
                    onChange={e => setEditingQ(p => p ? { ...p, short: e.target.value } : p)}
                    aria-label="Short name" autoFocus
                    data-qid="eval-lab:library:modal-short-name"
                    title="Short identifier for this question"
                    style={{ ...inputStyle, width: '100%', marginTop: 6 }} />
                </div>
                <div>
                  <div style={label}>Question Input</div>
                  <textarea value={editingQ.input}
                    onChange={e => setEditingQ(p => p ? { ...p, input: e.target.value } : p)}
                    aria-label="Question input text" rows={4}
                    data-qid="eval-lab:library:modal-question-input"
                    title="The question text that will be sent to the model"
                    style={{ ...inputStyle, width: '100%', marginTop: 6, resize: 'vertical', fontFamily: MONO, fontSize: 12, lineHeight: 1.6 }} />
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={label}>Expected Answer</div>
                    <input value={editingQ.expected}
                      onChange={e => setEditingQ(p => p ? { ...p, expected: e.target.value } : p)}
                      aria-label="Expected answer"
                      data-qid="eval-lab:library:modal-expected"
                      title="Expected answer used for evaluation scoring"
                      style={{ ...inputStyle, width: '100%', marginTop: 6, color: EMBRY.green }} />
                  </div>
                  <div style={{ width: 130 }}>
                    <div style={label}>Eval Mode</div>
                    <select value={editingQ.eval}
                      onChange={e => setEditingQ(p => p ? { ...p, eval: e.target.value as EvalMode } : p)}
                      aria-label="Eval mode"
                      data-qid="eval-lab:library:modal-eval-mode"
                      title="Evaluation comparison method for this question"
                      style={{ ...selectStyle, width: '100%', marginTop: 6 }}>
                      {EVAL_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div style={{ width: 80 }}>
                    <div style={label}>Max Tries</div>
                    <input type="number" min={1} max={10}
                      value={editingQ.max_tries ?? ''}
                      onChange={e => setEditingQ(p => p ? { ...p, max_tries: e.target.value ? parseInt(e.target.value) : undefined } : p)}
                      placeholder="def" aria-label="Max tries"
                      data-qid="eval-lab:library:modal-max-tries"
                      title="Maximum retry attempts for this question (default: global setting)"
                      style={{ ...inputStyle, width: '100%', marginTop: 6, fontFamily: MONO }} />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={() => { setEditingQ(null); setImportText('') }}
                    data-qid="eval-lab:library:modal-cancel"
                    title="Cancel and close the question modal"
                    style={{ ...actionBtn, color: EMBRY.dim }}>Cancel</button>
                  <button onClick={saveEditingQ}
                    disabled={!editingQ.short.trim() || !editingQ.input.trim()}
                    data-qid="eval-lab:library:modal-save"
                    title={gt.questions.some(q => q.id === editingQ.id) ? 'Update the existing question' : 'Add this question to the evaluation set'}
                    style={{
                      padding: '8px 24px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: editingQ.short.trim() && editingQ.input.trim() ? EMBRY.green : EMBRY.muted,
                      color: '#000', fontWeight: 700, fontSize: 11,
                    }}>
                    {gt.questions.some(q => q.id === editingQ.id) ? 'UPDATE' : 'ADD'}
                  </button>
                </div>
              </div>
            )}

            {/* Batch import */}
            {addModalMode === 'import' && !gt.questions.some(q => q.id === editingQ.id) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ ...body, color: EMBRY.dim, fontSize: 12 }}>
                  Paste a JSON array of questions, or an object with a "questions" key.
                </div>
                <textarea value={importText} onChange={e => setImportText(e.target.value)}
                  aria-label="Batch import JSON" autoFocus rows={10}
                  data-qid="eval-lab:library:modal-import-text"
                  title="Paste a JSON array of questions to import in bulk"
                  placeholder={'[\n  {"short": "Math", "input": "What is 2+2?", "expected": "4", "eval": "contains"},\n  {"short": "Coding", "input": "Write fizzbuzz", "expected": "def fizzbuzz", "eval": "contains"}\n]'}
                  style={{ ...inputStyle, width: '100%', fontFamily: MONO, fontSize: 11, resize: 'vertical', lineHeight: 1.6 }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 10, fontFamily: MONO, color: EMBRY.dim }}>
                    {importText.trim() ? (() => { try { const p = JSON.parse(importText); const n = Array.isArray(p) ? p.length : p.questions?.length ?? 0; return `${n} question${n !== 1 ? 's' : ''} detected` } catch { return 'Invalid JSON' } })() : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setEditingQ(null); setImportText('') }}
                      data-qid="eval-lab:library:modal-cancel"
                      title="Cancel and close the import modal"
                      style={{ ...actionBtn, color: EMBRY.dim }}>Cancel</button>
                    <button onClick={() => { importBatch(); setEditingQ(null) }}
                      disabled={!importText.trim()}
                      data-qid="eval-lab:library:modal-import"
                      title="Import pasted JSON questions into the evaluation set"
                      style={{
                        padding: '8px 24px', borderRadius: 6, border: 'none', cursor: 'pointer',
                        background: importText.trim() ? EMBRY.green : EMBRY.muted,
                        color: '#000', fontWeight: 700, fontSize: 11,
                      }}>
                      IMPORT
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// RESULTS TAB — view grid-eval output, pick the winner
// ═══════════════════════════════════════════════════════════════════════════

function ResultsTab({ allModels: _allModels, pendingFile, onFileConsumed }: {
  allModels: Record<string, ModelConfig>; pendingFile?: string | null; onFileConsumed?: () => void
}) {
  const [files, setFiles] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState('')
  const [gridData, setGridData] = useState<GridData | null>(null)
  const [threshold, setThreshold] = useState(0.8)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useRegisterAction('eval-lab:results:select-file', { app: 'sparta-explorer', action: 'SELECT_RESULT_FILE', label: 'Select Result File', description: 'Load a grid evaluation result file from the left panel' })
  useRegisterAction('eval-lab:results:threshold', { app: 'sparta-explorer', action: 'SET_THRESHOLD', label: 'Accuracy Threshold', description: 'Set the minimum pass-rate threshold for model viability recommendations' })
  useRegisterAction('eval-lab:results:expand-row', { app: 'sparta-explorer', action: 'EXPAND_RESULT_ROW', label: 'Expand Result Row', description: 'Expand a question row to see per-model outputs and full question text' })

  const loadFiles = useCallback(() => {
    fetch(`${API}/projects/llm-eval-lab/results`).then(r => r.json())
      .then(d => { const f = d.files ?? []; setFiles(f); if (f.length > 0 && !selectedFile) setSelectedFile(f[0]) })
      .catch(() => {})
  }, [selectedFile])

  useEffect(() => { loadFiles() }, [loadFiles])

  // Handle pending file from Library's RUN EVAL
  useEffect(() => {
    if (pendingFile) {
      loadFiles()
      setSelectedFile(pendingFile)
      onFileConsumed?.()
    }
  }, [pendingFile, onFileConsumed, loadFiles])

  useEffect(() => {
    if (!selectedFile) return
    setLoading(true)
    fetch(`${API}/projects/llm-eval-lab/results/${selectedFile}`).then(r => r.json())
      .then(d => { setGridData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [selectedFile])

  const recommendations = useMemo(() => {
    if (!gridData) return null
    const totalQ = Object.keys(gridData.grid).length
    const stats = Object.entries(gridData.summary)
      .map(([name, s]) => ({ name, ...s, total: totalQ }))
      .sort((a, b) => a.params_b - b.params_b)
    const minViable = stats.find(m => (m.passed / m.total) >= threshold)
    const mostReliable = [...stats].sort((a, b) => b.passed - a.passed || a.retries - b.retries)[0]
    return { minViable, mostReliable }
  }, [gridData, threshold])

  return (
    <div style={{ display: 'flex', gap: 0, height: '100%' }}>
      <LeftPane title="Eval Runs">
        {files.map(f => (
          <div key={f} onClick={() => setSelectedFile(f)}
            data-qid="eval-lab:results:select-file"
            title={`Load result file: ${f}`}
            role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') setSelectedFile(f) }}
            style={{
              padding: '8px 16px', cursor: 'pointer', fontSize: 10, fontFamily: MONO,
              color: selectedFile === f ? EMBRY.accent : EMBRY.dim,
              background: selectedFile === f ? 'rgba(124,58,237,0.08)' : 'transparent',
              borderLeft: selectedFile === f ? `3px solid ${EMBRY.accent}` : '3px solid transparent',
              transition: 'all 0.15s',
            }}>
            {f.replace('.json', '').replace('grid_eval_', '')}
          </div>
        ))}
        {files.length === 0 && (
          <div style={{ padding: '8px 16px', fontSize: 10, color: EMBRY.muted }}>No results yet. Run an eval from Library.</div>
        )}
      </LeftPane>

      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 32, marginBottom: 24, alignItems: 'flex-end' }}>
        <div>
        </div>
        <div>
          <div style={{ ...label, display: 'flex', justifyContent: 'space-between', width: 200 }}>
            <span>Threshold</span>
            <span style={{ fontFamily: MONO }}>{(threshold * 100).toFixed(0)}%</span>
          </div>
          <input type="range" min={50} max={100} value={threshold * 100}
            onChange={e => setThreshold(Number(e.target.value) / 100)}
            aria-label="Accuracy threshold"
            data-qid="eval-lab:results:threshold"
            title="Minimum pass-rate threshold for model viability (currently shown above)"
            style={{ marginTop: 10, width: 200, accentColor: EMBRY.accent }} />
        </div>
        {gridData && (
          <div style={{ ...label, color: EMBRY.muted, marginBottom: 4 }}>
            {gridData.title} · {Object.keys(gridData.grid).length}q · {gridData.models.length} models
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ fontFamily: MONO, fontSize: 12, color: EMBRY.dim }}>[ LOADING... ]</div>
      ) : gridData ? (
        <>
          {/* Grid Table */}
          <div style={{ ...panel, padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${EMBRY.border}`, background: 'rgba(255,255,255,0.02)' }}>
                  <th style={{ ...thStyle, width: 40 }}>#</th>
                  <th style={thStyle}>Question</th>
                  <th style={{ ...thStyle, width: 120 }}>Expected</th>
                  {gridData.models.map(m => <th key={m} style={{ ...thStyle, textAlign: 'center' }}>{m}</th>)}
                </tr>
              </thead>
              <tbody style={{ fontFamily: MONO, fontSize: 11 }}>
                {Object.entries(gridData.grid).map(([id, row]) => (
                  <Fragment key={id}>
                    <tr onClick={() => setExpandedId(expandedId === id ? null : id)}
                      role="button" tabIndex={0} aria-expanded={expandedId === id}
                      aria-label={`Question ${id}: ${row.short}`}
                      data-qid="eval-lab:results:expand-row"
                      title={`${expandedId === id ? 'Collapse' : 'Expand'} question ${id}: ${row.short}`}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(expandedId === id ? null : id) } }}
                      style={{
                        borderBottom: `1px solid ${EMBRY.border}`, cursor: 'pointer',
                        background: expandedId === id ? 'rgba(124,58,237,0.05)' : 'transparent',
                      }}>
                      <td style={tdStyle}><span style={{ color: EMBRY.dim }}>{id}</span></td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: 10, color: EMBRY.dim, marginRight: 6 }}>{expandedId === id ? '▾' : '▸'}</span>
                        <span style={{ color: EMBRY.white }}>{row.short}</span>
                      </td>
                      <td style={tdStyle}><span style={{ color: EMBRY.dim }}>{truncate(row.expected ?? '', 15)}</span></td>
                      {gridData.models.map(m => {
                        const { text, color } = cellDisplay(row.results[m])
                        return <td key={m} style={{ ...tdStyle, textAlign: 'center', color, fontWeight: 700 }}>{text}</td>
                      })}
                    </tr>
                    {expandedId === id && (
                      <tr style={{ borderBottom: `1px solid ${EMBRY.border}`, background: EMBRY.bgDeep }}>
                        <td colSpan={3 + gridData.models.length} style={{ padding: '20px 40px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 24 }}>
                            <div>
                              <div style={{ ...label, marginBottom: 8 }}>Question Input</div>
                              <div style={{ fontSize: 12, color: EMBRY.white, background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 4, lineHeight: 1.5 }}>
                                {row.input || 'Input text not stored in results.'}
                              </div>
                              <div style={{ ...label, marginTop: 16, marginBottom: 8 }}>Expected Output</div>
                              <div style={{ fontSize: 12, color: EMBRY.green, fontFamily: MONO }}>{row.expected ?? '—'}</div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(gridData.models.length, 3)}, 1fr)`, gap: 12 }}>
                              {gridData.models.map(m => {
                                const { color } = cellDisplay(row.results[m])
                                return (
                                  <div key={m} style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
                                    <div style={{ ...label, fontSize: 9, color }}>{m}</div>
                                    <div style={{ fontSize: 11, color: EMBRY.dim, marginTop: 6, maxHeight: 80, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
                                      {row.results[m]?.output || '[ Output not logged ]'}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'rgba(255,255,255,0.05)', fontWeight: 700 }}>
                  <td colSpan={3} style={{ padding: '16px 20px', ...label, color: EMBRY.white }}>TOTAL</td>
                  {gridData.models.map(m => {
                    const s = gridData.summary[m]
                    const totalQ = Object.keys(gridData.grid).length
                    const rate = s ? s.passed / totalQ : 0
                    const color = rate >= threshold ? EMBRY.green : rate >= threshold * 0.8 ? EMBRY.amber : EMBRY.red
                    return (
                      <td key={m} style={{ padding: '16px 20px', textAlign: 'center', fontFamily: MONO, fontSize: 13 }}>
                        <div style={{ color }}>{s ? `${s.passed}/${totalQ}` : '—'}</div>
                        {s && s.retries > 0 && <div style={{ color: EMBRY.dim, fontSize: 9 }}>({s.retries}r)</div>}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Recommendation cards */}
          {recommendations && (
            <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {recommendations.minViable && (
                <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'center', borderLeft: `4px solid ${EMBRY.green}` }}>
                  <div>
                    <div style={label}>Minimum Viable</div>
                    <div style={{ ...heading, fontSize: 20, margin: '4px 0' }}>{recommendations.minViable.name}</div>
                    <div style={{ fontSize: 11, color: EMBRY.dim, fontFamily: MONO }}>
                      {recommendations.minViable.passed}/{recommendations.minViable.total} pass · {recommendations.minViable.retries}r · {recommendations.minViable.params_b}B
                    </div>
                  </div>
                </div>
              )}
              {recommendations.mostReliable && (
                <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'center', borderLeft: `4px solid ${EMBRY.accent}` }}>
                  <div>
                    <div style={label}>Most Reliable</div>
                    <div style={{ ...heading, fontSize: 20, margin: '4px 0' }}>{recommendations.mostReliable.name}</div>
                    <div style={{ fontSize: 11, color: EMBRY.dim, fontFamily: MONO }}>
                      {recommendations.mostReliable.passed}/{recommendations.mostReliable.total} pass · {recommendations.mostReliable.retries}r · {recommendations.mostReliable.params_b}B
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={{ ...body, color: EMBRY.dim }}>
          {files.length === 0
            ? 'No result files found. Run: ./run.sh grid-eval -g example_qwen_comparison.json'
            : 'No results yet. Run an eval from the Library tab.'}
        </div>
      )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED HELPERS & STYLES
// ═══════════════════════════════════════════════════════════════════════════

// LeftPane, ModelPicker, RunButton, EditModal imported from ../common/
function StatCard({ label: lbl, value }: { label: string; value: number }) {
  return (
    <div style={{ ...card, padding: '12px 20px', minWidth: 100 }}>
      <div style={{ fontSize: 24, fontWeight: 900, fontFamily: MONO, color: EMBRY.white }}>{value}</div>
      <div style={{ ...label, marginTop: 4 }}>{lbl}</div>
    </div>
  )
}

function cellDisplay(cell: GridCell | undefined): { text: string; color: string } {
  if (!cell) return { text: '—', color: EMBRY.muted }
  if (cell.error) return { text: 'Err', color: EMBRY.accent }
  if (cell.pass) {
    if (cell.tries === 1) return { text: 'Pass', color: EMBRY.green }
    return { text: `Pass/${cell.tries}`, color: EMBRY.amber }
  }
  return { text: 'Fail', color: EMBRY.red }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

const thStyle: React.CSSProperties = {
  padding: '16px 20px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.15em', color: EMBRY.dim, textAlign: 'left', whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '12px 20px', verticalAlign: 'middle',
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`,
  borderRadius: 6, color: EMBRY.white, outline: 'none', fontSize: 12,
}

const inlineInput: React.CSSProperties = {
  padding: '6px 8px', background: 'transparent', border: `1px solid ${EMBRY.border}`,
  borderRadius: 4, color: EMBRY.white, outline: 'none', fontSize: 11, fontFamily: MONO,
  transition: 'border-color 0.15s, background 0.15s',
}

const selectStyle: React.CSSProperties = {
  padding: '6px 10px', background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`,
  borderRadius: 4, color: EMBRY.white, outline: 'none', fontSize: 11, fontFamily: MONO,

}

const actionBtn: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 6, border: `1px solid ${EMBRY.border}`,
  background: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.05em',
}

const INLINE_CSS = `
.eval-inline-input:focus { border-color: ${EMBRY.accent} !important; background: ${EMBRY.bgDeep} !important; }
.eval-inline-input:hover { border-color: ${EMBRY.borderHover} !important; }
.eval-hover-row:hover { background: rgba(124, 58, 237, 0.05) !important; }
`
