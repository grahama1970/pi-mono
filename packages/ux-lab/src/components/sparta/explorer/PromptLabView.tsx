/**
 * PromptLabView — Prompt optimization lab.
 *
 * Layout: LeftPane (prompt versions + ground truth files) + main area
 * Main area: system prompt editor (top) → test cases table → results + optimize
 * Matches LlmEvalLabView layout pattern.
 */
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { marked } from 'marked'
import { EMBRY, label, heading, body, card, panel } from '../common/EmbryStyle'
import { useAgentBus } from '../common/useAgentBus'
import { RunButton } from '../common/RunButton'
import { ModelPicker, type ModelConfig } from '../common/ModelPicker'
import { LeftPane, LeftPaneSection, paneItemStyle, useLeftPaneSearch } from '../common/LeftPane'
import { EditModal } from '../common/EditModal'
import { Plus, Copy, Pencil, Trash2 } from 'lucide-react'

const API = 'http://localhost:3001/api'
const MONO = '"JetBrains Mono", "SF Mono", monospace'

// Helpers for TestCase input format (string or {name, description})
function getQuestion(tc: TestCase): string {
  if (typeof tc.input === 'string') return tc.input
  return tc.input.description || tc.input.name || ''
}
function getShortName(tc: TestCase): string {
  if (typeof tc.input === 'string') return tc.input.slice(0, 40)
  return tc.input.name || ''
}
function setQuestion(tc: TestCase, value: string): TestCase {
  if (typeof tc.input === 'string') return { ...tc, input: value }
  return { ...tc, input: { ...tc.input, description: value } }
}
function setShortName(tc: TestCase, value: string): TestCase {
  if (typeof tc.input === 'string') return tc // string inputs don't have a separate name
  return { ...tc, input: { ...tc.input, name: value } }
}

// ── Types ──────────────────────────────────────────────────────────────────

interface PromptVersion { name: string; filename: string; size: number }
interface GroundTruthFile { name: string; filename: string }
interface TestCase { id: string; input: string | { name: string; description: string }; expected: Record<string, unknown>; notes?: string }
interface GroundTruth { name: string; description?: string; cases: TestCase[] }

interface RoundLog { round: number; text: string; passCount: number; totalCount: number }

// ── Main view ──────────────────────────────────────────────────────────────

export function PromptLabView() {
  const [prompts, setPrompts] = useState<PromptVersion[]>([])
  const [groundTruthFiles, setGroundTruthFiles] = useState<GroundTruthFile[]>([])
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null)
  const [promptContent, setPromptContent] = useState('')
  const [editedContent, setEditedContent] = useState('')
  const [jsonSchema, setJsonSchema] = useState('')
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [selectedGT, setSelectedGT] = useState<string | null>(null)
  const [groundTruth, setGroundTruth] = useState<GroundTruth | null>(null)
  const [expandedCase, setExpandedCase] = useState<string | null>(null)
  const [editingCase, setEditingCase] = useState<TestCase | null>(null)

  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [currentRound, setCurrentRound] = useState(0)
  // Per-case eval status: caseId → { status, tries, f1, actual, runningCaseId }
  const [caseStatus, setCaseStatus] = useState<Record<string, { status: 'pending' | 'running' | 'pass' | 'fail'; tries: number; f1?: number; actual?: Record<string, unknown> }>>({})
  const [runningCaseId, setRunningCaseId] = useState<string | null>(null)
  const [roundLogs, setRoundLogs] = useState<RoundLog[]>([])
  const [finalPrompt, setFinalPrompt] = useState('')
  // expandedResult removed — results now shown inline in questions table
  const [reviewing, setReviewing] = useState(false)
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null)
  const [autoFixing, setAutoFixing] = useState(false)
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [allModels, setAllModels] = useState<Record<string, ModelConfig>>({})

  // Agent bus for streaming optimization events
  const { send: agentSend } = useAgentBus((msg) => {
    switch (msg.type) {
      case 'optimize-start':
        setRunning(true); setDone(false); setCurrentRound(0)
        setCaseStatus({}); setRoundLogs([]); setFinalPrompt('')
        break
      case 'optimize-round-start': {
        const round = (msg.payload.round as number) + 1
        setCurrentRound(round)
        // Reset all cases to pending for new round (keep tries count)
        setCaseStatus(prev => {
          const next = { ...prev }
          for (const id of Object.keys(next)) next[id] = { ...next[id], status: 'pending' }
          return next
        })
        setRoundLogs(prev => [...prev, { round, text: `Round ${round}: evaluating...`, passCount: 0, totalCount: groundTruth?.cases.length ?? 0 }])
        break
      }
      case 'eval-case-done': {
        const caseId = msg.payload.case_id as string
        const f1 = msg.payload.f1 as number ?? 0
        const predicted = msg.payload.predicted as Record<string, unknown> | undefined
        const passed = f1 >= 0.8
        setRunningCaseId(null)
        setCaseStatus(prev => ({
          ...prev,
          [caseId]: {
            status: passed ? 'pass' : 'fail',
            tries: (prev[caseId]?.tries ?? 0) + 1,
            f1, actual: predicted ?? undefined,
          },
        }))
        setRoundLogs(prev => { if (prev.length === 0) return prev; const last = { ...prev[prev.length - 1] }; if (passed) last.passCount++; last.text = `Round ${last.round}: ${last.passCount}/${last.totalCount} passed`; return [...prev.slice(0, -1), last] })
        break
      }
      case 'eval-case-start':
        setRunningCaseId(msg.payload.case_id as string ?? null)
        break
      case 'prompt-rewrite-done': {
        const newPrompt = msg.payload.new_prompt_preview as string ?? ''
        setRoundLogs(prev => [...prev, { round: 0, text: 'Optimizer rewrites prompt...', passCount: 0, totalCount: 0 }])
        setFinalPrompt(newPrompt)
        // Live-update the editor with the rewritten prompt
        if (newPrompt) {
          const schemaMatch = newPrompt.match(/(return\s+(?:ONLY\s+)?(?:valid\s+)?JSON[^{]*?)(\{[\s\S]*\})\s*$/i)
          if (schemaMatch) {
            setEditedContent(newPrompt.slice(0, newPrompt.lastIndexOf(schemaMatch[0])).trimEnd())
            setJsonSchema(schemaMatch[2])
          } else {
            setEditedContent(newPrompt)
          }
        }
        break
      }
      case 'optimize-done':
        setRunning(false); setDone(true); setRunningCaseId(null)
        if (msg.payload.final_prompt) setFinalPrompt(msg.payload.final_prompt as string)
        break
    }
  })

  // Load data
  useEffect(() => {
    Promise.all([
      fetch(`${API}/prompt-lab/prompts`).then(r => r.json()).catch(() => ({ prompts: [] })),
      fetch(`${API}/prompt-lab/ground-truth`).then(r => r.json()).catch(() => ({ ground_truth: [] })),
      fetch(`${API}/projects/llm-eval-lab/models`).then(r => r.json()).catch(() => ({})),
    ]).then(([p, gt, m]) => {
      setPrompts(p.prompts ?? [])
      setGroundTruthFiles(gt.ground_truth ?? [])
      const clean: Record<string, ModelConfig> = {}
      for (const [k, v] of Object.entries(m)) {
        if (!k.startsWith('_') && typeof v === 'object') clean[k] = v as ModelConfig
      }
      setAllModels(clean)
    })
  }, [])

  useEffect(() => { if (!selectedPrompt && prompts.length > 0) setSelectedPrompt((prompts.find(p => p.name === 'taxonomy_v1') ?? prompts[0]).name) }, [prompts, selectedPrompt])
  useEffect(() => { if (!selectedGT && groundTruthFiles.length > 0) setSelectedGT((groundTruthFiles.find(f => f.name === 'taxonomy') ?? groundTruthFiles[0]).name) }, [groundTruthFiles, selectedGT])

  useEffect(() => {
    if (!selectedPrompt) return
    fetch(`${API}/prompt-lab/prompts/${selectedPrompt}`).then(r => r.json())
      .then(d => {
        const content = d.content ?? ''
        setPromptContent(content)
        // Auto-detect JSON schema at end of prompt (after "Return ONLY valid JSON:" or similar)
        const schemaMatch = content.match(/(return\s+(?:ONLY\s+)?(?:valid\s+)?JSON[^{]*?)(\{[\s\S]*\})\s*$/i)
        if (schemaMatch) {
          const schemaStr = schemaMatch[2]
          const fullMatch = schemaMatch[0]
          // Remove the entire "Return ... {schema}" block from instructions
          const instructions = content.slice(0, content.lastIndexOf(fullMatch)).trimEnd()
          setEditedContent(instructions)
          setJsonSchema(schemaStr)
          setSchemaOpen(true)
        } else {
          setEditedContent(content)
          setJsonSchema('')
        }
      })
      .catch(() => setPromptContent(''))
  }, [selectedPrompt])

  useEffect(() => {
    if (!selectedGT) return
    fetch(`${API}/prompt-lab/ground-truth/${selectedGT}`).then(r => r.json())
      .then(d => setGroundTruth(d)).catch(() => setGroundTruth(null))
  }, [selectedGT])

  const saveTestCase = useCallback((updated: TestCase) => {
    if (!groundTruth) return
    const exists = groundTruth.cases.some(c => c.id === updated.id)
    const newCases = exists
      ? groundTruth.cases.map(c => c.id === updated.id ? updated : c)
      : [...groundTruth.cases, updated]
    const newGT = { ...groundTruth, cases: newCases }
    setGroundTruth(newGT)
    setEditingCase(null)
    // Persist
    if (selectedGT) {
      fetch(`${API}/prompt-lab/ground-truth/${selectedGT}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newGT),
      }).catch(() => {})
    }
  }, [groundTruth, selectedGT])

  const removeTestCase = useCallback((id: string) => {
    if (!groundTruth) return
    const newGT = { ...groundTruth, cases: groundTruth.cases.filter(c => c.id !== id) }
    setGroundTruth(newGT)
    if (selectedGT) {
      fetch(`${API}/prompt-lab/ground-truth/${selectedGT}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newGT),
      }).catch(() => {})
    }
  }, [groundTruth, selectedGT])

  // Combine prompt + schema for saving/sending
  const fullPrompt = jsonSchema.trim()
    ? `${editedContent}\n\nReturn ONLY valid JSON in this format:\n${jsonSchema}`
    : editedContent

  const savePrompt = useCallback(async () => {
    if (!selectedPrompt) return
    await fetch(`${API}/prompt-lab/prompts/${selectedPrompt}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: fullPrompt }),
    }).catch(() => {})
    setPromptContent(fullPrompt)
  }, [selectedPrompt, fullPrompt])

  const runOptimize = useCallback(async () => {
    if (!selectedPrompt) return
    setRunning(true); setDone(false); setResults([]); setRoundLogs([]); setFinalPrompt('')
    try {
      await fetch(`${API}/prompt-lab/optimize-live`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: selectedPrompt, models: selectedModels.slice(0, 1), ground_truth: selectedGT, cases: groundTruth?.cases.length ?? 3, max_rounds: 5 }),
      })
    } catch { /* */ }
  }, [selectedPrompt, selectedModels, selectedGT, groundTruth])

  const reviewPrompt = useCallback(async () => {
    if (!fullPrompt.trim()) return
    setReviewing(true)
    setReviewFeedback(null)

    // Sample up to 3 random questions for context
    const cases = groundTruth?.cases ?? []
    const sample = cases.length <= 3 ? cases : cases.sort(() => Math.random() - 0.5).slice(0, 3)
    const sampleText = sample.length > 0
      ? `\n\nHere are ${sample.length} sample questions this prompt will be tested against:\n${sample.map((c, i) =>
          `${i + 1}. Question: "${typeof c.input === 'string' ? c.input : c.input.description}"\n   Expected: ${JSON.stringify(c.expected)}`
        ).join('\n')}`
      : ''

    try {
      const resp = await fetch(`${API}/scillm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'text',
          messages: [
            { role: 'system', content: `You are a prompt engineering expert. Review the following system prompt for issues.

Flag these categories:
1. **Duplicate instructions** — same thing said twice
2. **Contradictions** — rules that conflict with each other
3. **Vague language** — instructions like "be specific" without saying how
4. **Missing constraints** — no output format, no length limit, no error handling
5. **Unnecessary verbosity** — could be said in fewer words
6. **Question compatibility** — does the prompt work for the sample questions provided?

For each issue: cite the exact problematic text, explain why it's a problem, suggest a fix.
Use markdown with ## headers per category. Skip categories with no issues.
End with a 1-line overall verdict: READY / NEEDS WORK / MAJOR ISSUES.` },
            { role: 'user', content: `Review this system prompt:\n\n---\n${fullPrompt}\n---${sampleText}` },
          ],
          max_tokens: 2048,
        }),
      })
      if (!resp.ok) throw new Error(`${resp.status}`)
      const data = await resp.json()
      setReviewFeedback(data?.choices?.[0]?.message?.content ?? 'No feedback received.')
    } catch (err) {
      setReviewFeedback(`Review failed: ${err}`)
    }
    setReviewing(false)
  }, [fullPrompt, groundTruth])

  const autoFixPrompt = useCallback(async () => {
    if (!reviewFeedback || !editedContent.trim()) return
    setAutoFixing(true)
    // Only send the instructions part (not the schema) — schema is preserved separately
    const schemaNote = jsonSchema.trim()
      ? `\n\nIMPORTANT: The prompt has a separate JSON schema section that is NOT included above. Do NOT add any JSON format instructions — those are managed separately.`
      : ''
    try {
      const resp = await fetch(`${API}/scillm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'text',
          messages: [
            { role: 'system', content: `You are a prompt engineering expert. Rewrite ONLY the system prompt instructions to fix ALL issues identified in the review. Preserve the prompt's intent. Do NOT add JSON format instructions — those are managed separately. Output ONLY the fixed instruction text — no explanations, no markdown, no commentary, no JSON schema.` },
            { role: 'user', content: `Original prompt instructions:\n---\n${editedContent}\n---${schemaNote}\n\nReview findings:\n---\n${reviewFeedback}\n---\n\nRewrite the instructions to fix all issues. Output ONLY the fixed prompt text:` },
          ],
          max_tokens: 4096,
        }),
      })
      if (!resp.ok) throw new Error(`${resp.status}`)
      const data = await resp.json()
      const fixed = data?.choices?.[0]?.message?.content ?? ''
      if (fixed.trim()) {
        // Only update instructions — preserve the schema as-is
        setEditedContent(fixed.trim())
        setReviewFeedback(null)
      }
    } catch { /* */ }
    setAutoFixing(false)
  }, [editedContent, jsonSchema, reviewFeedback])

  const isDirty = fullPrompt !== promptContent

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', background: EMBRY.bg }}>
      <style>{`
.eval-hover-row:hover { background: rgba(124, 58, 237, 0.05) !important; }
.prompt-review-md h2 { font-size: 13px; font-weight: 700; color: ${EMBRY.amber}; margin: 16px 0 8px; letter-spacing: 0.02em; }
.prompt-review-md h3 { font-size: 12px; font-weight: 700; color: ${EMBRY.white}; margin: 12px 0 6px; }
.prompt-review-md strong { color: ${EMBRY.white}; }
.prompt-review-md code { font-family: ${MONO}; font-size: 11px; background: ${EMBRY.bgDeep}; padding: 1px 4px; border-radius: 3px; color: ${EMBRY.green}; }
.prompt-review-md pre { background: ${EMBRY.bgDeep}; padding: 12px; border-radius: 4px; overflow-x: auto; margin: 8px 0; }
.prompt-review-md pre code { background: none; padding: 0; }
.prompt-review-md ul, .prompt-review-md ol { padding-left: 20px; margin: 6px 0; }
.prompt-review-md li { margin: 4px 0; }
.prompt-review-md p { margin: 6px 0; }
      `}</style>

      {/* ── Left pane: prompt versions + ground truth ──────── */}
      <LeftPane title="Prompt Lab" searchable>
        <PromptLabPaneContent
          prompts={prompts} groundTruthFiles={groundTruthFiles}
          selectedPrompt={selectedPrompt} selectedGT={selectedGT}
          onSelectPrompt={setSelectedPrompt} onSelectGT={setSelectedGT}
        />
      </LeftPane>

      {/* ── Main content area (vertical stack) ─────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── System Prompt Editor ──────────────────────────── */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ padding: '10px 20px', background: EMBRY.bgHeader, borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={label}>System Prompt</div>
              <div style={{ fontSize: 12, color: EMBRY.white, fontFamily: MONO }}>{selectedPrompt ?? '—'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {isDirty && (
                <button onClick={savePrompt} aria-label="Save prompt"
                  style={{ padding: '4px 14px', borderRadius: 4, border: 'none', cursor: 'pointer', background: EMBRY.blue, color: '#fff', fontSize: 10, fontWeight: 700 }}>
                  SAVE
                </button>
              )}
              <span style={{ fontSize: 10, color: EMBRY.dim, fontFamily: MONO }}>
                {selectedModels.length > 0 ? selectedModels[0] : 'no model'}
              </span>
              <RunButton onClick={runOptimize} disabled={running || !selectedPrompt || selectedModels.length === 0}
                ariaLabel="Optimize prompt">
                {running ? 'Optimizing...' : 'Optimize'}
              </RunButton>
            </div>
          </div>

          {/* Model picker */}
          <div style={{ padding: '8px 20px', borderBottom: `1px solid ${EMBRY.border}`, background: EMBRY.bgCard }}>
            <ModelPicker allModels={allModels} selected={selectedModels}
              onToggle={alias => setSelectedModels(prev => prev.includes(alias) ? prev.filter(m => m !== alias) : [alias])}
              labelText="Optimize with Model (pick 1)" />
          </div>

          {/* JSON Schema field */}
          <div style={{ borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
            <div onClick={() => setSchemaOpen(p => !p)}
              style={{ padding: '8px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, background: jsonSchema.trim() ? 'rgba(0,255,136,0.03)' : 'transparent' }}>
              <span style={{ fontSize: 10, color: EMBRY.dim }}>{schemaOpen ? '▾' : '▸'}</span>
              <span style={label}>Response JSON Schema</span>
              {jsonSchema.trim() && <span style={{ fontSize: 9, color: EMBRY.green, fontFamily: MONO }}>defined</span>}
              {!jsonSchema.trim() && <span style={{ fontSize: 9, color: EMBRY.muted, fontFamily: MONO }}>none</span>}
            </div>
            {schemaOpen && (
              <textarea value={jsonSchema} onChange={e => setJsonSchema(e.target.value)}
                placeholder='{"conceptual": ["tag1"], "tactical": ["tag1"], "confidence": 0.8}'
                aria-label="JSON response schema" rows={4}
                style={{
                  width: '100%', resize: 'vertical', background: EMBRY.bgDeep, color: EMBRY.green,
                  border: 'none', outline: 'none', padding: '12px 20px',
                  fontSize: 12, lineHeight: 1.5, fontFamily: MONO, boxSizing: 'border-box',
                  minHeight: 60, maxHeight: 200,
                }} />
            )}
          </div>

          {/* Round indicator during optimization */}
          {running && currentRound > 0 && (
            <div style={{ padding: '6px 20px', background: EMBRY.accent + '10', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: EMBRY.accent, fontWeight: 700, fontFamily: MONO }}>ROUND {currentRound}</span>
              <span style={{ fontSize: 10, color: EMBRY.dim }}>Prompt is being optimized — editor is read-only</span>
            </div>
          )}
          <textarea value={editedContent} readOnly={running}
            onChange={e => {
              if (running) return
              setEditedContent(e.target.value)
              const el = e.target
              el.style.height = 'auto'
              el.style.height = Math.min(Math.max(el.scrollHeight, 120), 600) + 'px'
            }}
            ref={el => {
              if (el) { el.style.height = 'auto'; el.style.height = Math.min(Math.max(el.scrollHeight, 120), 600) + 'px' }
            }}
            onBlur={() => { if (isDirty && !running) savePrompt() }}
            spellCheck={false} aria-label="System prompt editor"
            style={{
              width: '100%', minHeight: 120, maxHeight: 600, resize: 'vertical',
              opacity: running ? 0.7 : 1,
              background: EMBRY.bgDeep, color: EMBRY.white,
              border: 'none', borderBottom: `1px solid ${EMBRY.border}`, outline: 'none',
              padding: '16px 20px', fontSize: 12, lineHeight: 1.7, fontFamily: MONO, boxSizing: 'border-box',
              overflow: 'auto',
            }} />

          {/* Review action strip — always visible below prompt */}
          <div style={{ padding: '8px 20px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 12, background: EMBRY.bgCard }}>
            <button onClick={reviewPrompt} disabled={reviewing || !fullPrompt.trim()}
              aria-label="Review prompt for issues"
              style={{
                padding: '6px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                background: reviewing ? EMBRY.muted : 'transparent',
                color: reviewing ? EMBRY.dim : EMBRY.amber,
                border: `1px solid ${reviewing ? EMBRY.border : EMBRY.amber + '55'}`,
                transition: 'all 0.15s',
              }}>
              {reviewing ? 'Reviewing...' : 'Review Prompt'}
            </button>
            <span style={{ fontSize: 10, color: EMBRY.muted }}>Check for issues before running against questions</span>
          </div>

          {/* Review feedback */}
          {reviewFeedback && (
            <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}`, background: 'rgba(255,170,0,0.03)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ ...label, color: EMBRY.amber }}>Prompt Review</div>
                <button onClick={() => setReviewFeedback(null)} aria-label="Dismiss review"
                  style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', fontSize: 12 }}>dismiss</button>
              </div>
              <div className="prompt-review-md"
                style={{ fontSize: 12, color: EMBRY.white, lineHeight: 1.6, fontFamily: 'Inter, sans-serif' }}
                dangerouslySetInnerHTML={{ __html: marked.parse(reviewFeedback) as string }} />
              {/* Auto-fix action */}
              {!reviewFeedback.includes('READY') && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${EMBRY.border}` }}>
                  <RunButton onClick={autoFixPrompt} disabled={autoFixing}
                    ariaLabel="Auto-fix prompt based on review">
                    {autoFixing ? 'Fixing...' : 'Auto-fix Prompt'}
                  </RunButton>
                  <span style={{ fontSize: 10, color: EMBRY.muted, alignSelf: 'center' }}>
                    Rewrites the prompt to address all flagged issues
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Scrollable bottom: test cases + results ──────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* Test Cases */}
          <div style={{ ...panel, padding: 0, overflow: 'hidden', marginBottom: 20 }}>
            <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={label}>Questions</div>
                <div style={{ fontSize: 11, color: EMBRY.white, fontFamily: MONO }}>{selectedGT ?? '—'}</div>
              </div>
              <div style={{ fontSize: 10, color: EMBRY.dim, fontFamily: MONO }}>{groundTruth?.cases.length ?? 0} cases</div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <th style={{ ...thStyle, width: 40 }}>#</th>
                  <th style={thStyle}>ID</th>
                  <th style={thStyle}>Question</th>
                  <th style={thStyle}>Expected Answer</th>
                  <th style={{ ...thStyle, width: 70, textAlign: 'center' }}>Status</th>
                  <th style={{ ...thStyle, width: 50, textAlign: 'center' }}>Tries</th>
                </tr>
              </thead>
              <tbody>
                {groundTruth?.cases.map((tc, i) => (
                  <Fragment key={tc.id}>
                    <tr onClick={() => setEditingCase({ ...tc })}
                      role="button" tabIndex={0} aria-label={`Edit test case ${tc.id}`}
                      style={{ borderBottom: `1px solid ${EMBRY.border}`, cursor: 'pointer', background: expandedCase === tc.id ? 'rgba(124,58,237,0.05)' : 'transparent' }}
                      className="eval-hover-row">
                      <td style={tdStyle}><span style={{ color: EMBRY.dim, fontFamily: MONO, fontSize: 11 }}>{i + 1}</span></td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: EMBRY.white, fontFamily: MONO, fontSize: 11 }}>{tc.id}</td>
                      <td style={{ ...tdStyle, color: EMBRY.dim, fontSize: 11 }}>
                        <span style={{ fontSize: 10, color: EMBRY.dim, marginRight: 4 }}>{expandedCase === tc.id ? '▾' : '▸'}</span>
                        {getShortName(tc) || getQuestion(tc).slice(0, 50)}
                      </td>
                      <td style={{ ...tdStyle, color: EMBRY.green, fontFamily: MONO, fontSize: 10, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {JSON.stringify(tc.expected)}
                      </td>
                      {/* Live status + tries */}
                      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700, fontFamily: MONO, fontSize: 11 }}>
                        {(() => {
                          const cs = caseStatus[tc.id]
                          if (!cs) return <span style={{ color: EMBRY.muted }}>—</span>
                          if (cs.status === 'running' || runningCaseId === tc.id) return <span style={{ color: EMBRY.accent }}>●</span>
                          if (cs.status === 'pass') return <span style={{ color: cs.tries > 1 ? EMBRY.amber : EMBRY.green }}>{cs.tries > 1 ? `Pass/${cs.tries}` : 'Pass'}</span>
                          if (cs.status === 'fail') return <span style={{ color: EMBRY.red }}>Fail</span>
                          return <span style={{ color: EMBRY.muted }}>…</span>
                        })()}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontFamily: MONO, fontSize: 11, color: EMBRY.dim }}>
                        {caseStatus[tc.id]?.tries ?? '—'}
                      </td>
                    </tr>
                    {/* Row detail removed — edit modal replaces it */}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {/* Add test case row */}
            {groundTruth && (
              <div onClick={() => setEditingCase({ id: `q_${(groundTruth?.cases.length ?? 0) + 1}`, input: '', expected: {} })}
                role="button" tabIndex={0} aria-label="Add test case"
                style={{ padding: '14px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: EMBRY.dim, fontSize: 12, borderTop: `1px solid ${EMBRY.border}` }}
                className="eval-hover-row">
                + Add question...
              </div>
            )}
            {(!groundTruth || groundTruth.cases.length === 0) && (
              <div style={{ padding: 30, textAlign: 'center', color: EMBRY.muted, fontFamily: MONO, fontSize: 11 }}>
                Select a ground truth file from the left pane.
              </div>
            )}
          </div>

          {/* Edit test case modal */}
          {editingCase && (
            <EditModal title={groundTruth?.cases.some(c => c.id === editingCase.id) ? `Edit: ${editingCase.id}` : 'New Question'}
              onClose={() => setEditingCase(null)} width={700}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ width: 120 }}>
                    <div style={label}>ID</div>
                    <input value={editingCase.id}
                      onChange={e => setEditingCase(p => p ? { ...p, id: e.target.value } : p)}
                      aria-label="Question ID" style={{ ...inputStyle, width: '100%', marginTop: 6 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={label}>Short Name</div>
                    <input value={getShortName(editingCase)}
                      onChange={e => setEditingCase(p => p ? setShortName(p, e.target.value) : p)}
                      aria-label="Short name" autoFocus style={{ ...inputStyle, width: '100%', marginTop: 6 }} />
                  </div>
                </div>
                <div>
                  <div style={label}>Question</div>
                  <textarea value={getQuestion(editingCase)}
                    onChange={e => setEditingCase(p => p ? setQuestion(p, e.target.value) : p)}
                    aria-label="Question text" rows={4}
                    placeholder="The question that will be sent to the model as the user message..."
                    style={{ ...inputStyle, width: '100%', marginTop: 6, resize: 'vertical', fontFamily: MONO, fontSize: 12, lineHeight: 1.6 }} />
                </div>
                <div>
                  <div style={label}>Expected Answer</div>
                  <textarea value={JSON.stringify(editingCase.expected, null, 2)}
                    onChange={e => { try { setEditingCase(p => p ? { ...p, expected: JSON.parse(e.target.value) } : p) } catch { /* invalid JSON — let user keep typing */ } }}
                    aria-label="Expected JSON response" rows={4}
                    style={{ ...inputStyle, width: '100%', marginTop: 6, resize: 'vertical', fontFamily: MONO, fontSize: 12, lineHeight: 1.5, color: EMBRY.green }} />
                </div>
                <div>
                  <div style={label}>Notes (optional)</div>
                  <input value={editingCase.notes ?? ''}
                    onChange={e => setEditingCase(p => p ? { ...p, notes: e.target.value || undefined } : p)}
                    placeholder="e.g. Tests edge case with ambiguous input"
                    aria-label="Notes" style={{ ...inputStyle, width: '100%', marginTop: 6 }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {groundTruth?.cases.some(c => c.id === editingCase.id) && (
                    <button onClick={() => { removeTestCase(editingCase.id); setEditingCase(null) }}
                      style={{ padding: '6px 16px', borderRadius: 4, border: `1px solid ${EMBRY.red}44`, background: 'transparent', color: EMBRY.red, cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>
                      DELETE
                    </button>
                  )}
                  <div style={{ flex: 1 }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setEditingCase(null)}
                      style={{ padding: '6px 16px', borderRadius: 4, border: `1px solid ${EMBRY.border}`, background: 'transparent', color: EMBRY.dim, cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>
                      CANCEL
                    </button>
                    <button onClick={() => saveTestCase(editingCase)}
                      disabled={!editingCase.id || !getQuestion(editingCase).trim()}
                      style={{
                        padding: '6px 20px', borderRadius: 4, border: 'none', cursor: 'pointer',
                        background: editingCase.id && getQuestion(editingCase).trim() ? EMBRY.green : EMBRY.muted,
                        color: '#000', fontWeight: 700, fontSize: 10,
                      }}>
                      {groundTruth?.cases.some(c => c.id === editingCase.id) ? 'UPDATE' : 'ADD'}
                    </button>
                  </div>
                </div>
              </div>
            </EditModal>
          )}

          {/* Activity Log */}
          {(running || done || roundLogs.length > 0) && (
            <div style={{ ...panel, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={label}>Activity Log</div>
                {running && <span style={{ fontSize: 10, color: EMBRY.accent, fontFamily: MONO }}>● optimizing...</span>}
                {done && (
                  <span style={{ fontSize: 10, fontWeight: 700, fontFamily: MONO, color: Object.values(caseStatus).every(c => c.status === 'pass') ? EMBRY.green : EMBRY.amber }}>
                    {Object.values(caseStatus).every(c => c.status === 'pass') ? 'CONVERGED' : `${Object.values(caseStatus).filter(c => c.status === 'pass').length}/${Object.keys(caseStatus).length} pass`}
                  </span>
                )}
              </div>
              <div style={{ padding: '8px 20px', fontFamily: MONO, fontSize: 11, maxHeight: 200, overflowY: 'auto' }}>
                {roundLogs.map((log, i) => (
                  <div key={i} style={{
                    color: log.round === 0 ? EMBRY.accent : log.passCount === log.totalCount ? EMBRY.green : EMBRY.dim,
                    padding: '3px 0',
                  }}>
                    {log.text}
                  </div>
                ))}
              </div>

              {/* Approve/Reject when done */}
              {done && (
                <div style={{ padding: '12px 20px', borderTop: `1px solid ${EMBRY.border}`, display: 'flex', gap: 8 }}>
                  <RunButton onClick={() => agentSend({ type: 'user-action', payload: { action: 'approve', prompt: selectedPrompt } })}
                    ariaLabel="Approve and save prompt">
                    Approve & Save
                  </RunButton>
                  <button onClick={() => agentSend({ type: 'user-action', payload: { action: 'reject', prompt: selectedPrompt } })}
                    style={{ padding: '8px 24px', borderRadius: 6, border: `1px solid ${EMBRY.border}`, cursor: 'pointer', background: 'transparent', color: EMBRY.dim, fontSize: 12, fontWeight: 700 }}>
                    Reject
                  </button>
                  <span style={{ flex: 1 }} />
                  <button onClick={async () => {
                    // Compute prompt hash for artifact lineage
                    const promptBytes = new TextEncoder().encode(fullPrompt)
                    const hashBuffer = await crypto.subtle.digest('SHA-256', promptBytes)
                    const promptHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12)

                    // Package prompt + questions into LLM Eval Lab ground truth format
                    const evalGT = {
                      title: `${selectedPrompt} — optimized`,
                      models: selectedModels,
                      system_prompt: fullPrompt,
                      prompt_hash: promptHash,
                      prompt_name: selectedPrompt,
                      eval_mode: 'agent_judge',
                      questions: (groundTruth?.cases ?? []).map((tc, i) => ({
                        id: i + 1,
                        short: typeof tc.input === 'string' ? tc.input.slice(0, 40) : (tc.input?.name || `Q${i+1}`),
                        input: typeof tc.input === 'string' ? tc.input : tc.input?.description || '',
                        expected: JSON.stringify(tc.expected),
                        eval: 'agent_judge' as const,
                      })),
                    }
                    const filename = `from_promptlab_${promptHash}.json`
                    await fetch(`${API}/projects/llm-eval-lab/ground-truth/${filename}`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(evalGT),
                    }).catch(() => {})
                    window.location.hash = 'llm-eval-lab'
                  }}
                    aria-label="Send prompt and questions to LLM Eval Lab"
                    style={{
                      padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                      background: 'transparent', color: EMBRY.blue,
                      border: `1px solid ${EMBRY.blue}44`,
                    }}>
                    Test Across Models →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Left pane content with unified prompt list ──────────────────────────────

function PromptLabPaneContent({ prompts, groundTruthFiles, selectedPrompt, selectedGT, onSelectPrompt, onSelectGT }: {
  prompts: PromptVersion[]; groundTruthFiles: GroundTruthFile[]
  selectedPrompt: string | null; selectedGT: string | null
  onSelectPrompt: (name: string) => void; onSelectGT: (name: string) => void
}) {
  const search = useLeftPaneSearch().toLowerCase()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; name: string; type: 'prompt' | 'gt' } | null>(null)

  // Build unified list: prompts paired with matching ground truth
  const gtNames = new Set(groundTruthFiles.map(f => f.name))
  const allPrompts = prompts.map(p => ({
    ...p,
    hasGT: gtNames.has(p.name) || gtNames.has(p.name.replace(/_v\d+$/, '')),
  }))
  const filtered = search ? allPrompts.filter(p => p.name.toLowerCase().includes(search)) : allPrompts

  // Ground truth files without a matching prompt
  const promptNames = new Set(prompts.map(p => p.name))
  const orphanGT = groundTruthFiles.filter(f => !promptNames.has(f.name))
  const filteredOrphanGT = search ? orphanGT.filter(f => f.name.toLowerCase().includes(search)) : orphanGT

  const handleContextMenu = (e: React.MouseEvent, name: string, type: 'prompt' | 'gt') => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, name, type })
  }

  const handleAction = async (action: string) => {
    if (!contextMenu) return
    const { name, type } = contextMenu
    setContextMenu(null)
    const endpoint = type === 'prompt' ? 'prompts' : 'ground-truth'
    const ext = type === 'prompt' ? '.txt' : '.json'

    if (action === 'duplicate') {
      const newName = prompt(`Duplicate "${name}" as:`, `${name}_copy`)
      if (!newName) return
      const resp = await fetch(`${API}/prompt-lab/${endpoint}/${name}`)
      const data = await resp.json()
      const body = type === 'prompt' ? JSON.stringify({ content: data.content }) : JSON.stringify(data)
      await fetch(`${API}/prompt-lab/${endpoint}/${newName}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      window.location.reload()
    } else if (action === 'rename') {
      const newName = prompt(`Rename "${name}" to:`, name)
      if (!newName || newName === name) return
      const resp = await fetch(`${API}/prompt-lab/${endpoint}/${name}`)
      const data = await resp.json()
      const body = type === 'prompt' ? JSON.stringify({ content: data.content }) : JSON.stringify(data)
      await fetch(`${API}/prompt-lab/${endpoint}/${newName}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      // Note: no delete endpoint yet — old file remains
      window.location.reload()
    } else if (action === 'delete') {
      if (!confirm(`Delete "${name}${ext}"?`)) return
      await fetch(`${API}/prompt-lab/${endpoint}/${name}`, { method: 'DELETE' })
      window.location.reload()
    }
  }

  const handleAdd = async () => {
    const newName = prompt('New prompt name:')
    if (!newName) return
    await fetch(`${API}/prompt-lab/prompts/${newName}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '[SYSTEM]\nYou are a helpful assistant.\n\n[USER]\n{input}' }),
    })
    window.location.reload()
  }

  return (
    <>
      <LeftPaneSection title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span>Prompts ({filtered.length + filteredOrphanGT.length})</span>
          <Plus size={14} color={EMBRY.muted} style={{ cursor: 'pointer' }} onClick={handleAdd} />
        </div>
      }>
        {filtered.map(p => (
          <div key={p.name}
            onClick={() => { onSelectPrompt(p.name); if (p.hasGT) onSelectGT(p.name) }}
            onContextMenu={e => handleContextMenu(e, p.name, 'prompt')}
            style={{ ...paneItemStyle(selectedPrompt === p.name), display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
            {p.hasGT && <span title="Has ground truth" style={{ fontSize: 8, color: EMBRY.green, flexShrink: 0 }}>GT</span>}
          </div>
        ))}
        {filteredOrphanGT.length > 0 && filteredOrphanGT.map(f => (
          <div key={`gt-${f.name}`}
            onClick={() => onSelectGT(f.name)}
            onContextMenu={e => handleContextMenu(e, f.name, 'gt')}
            style={{ ...paneItemStyle(selectedGT === f.name), display: 'flex', alignItems: 'center', gap: 6, opacity: 0.6 }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
            <span title="Ground truth only (no prompt)" style={{ fontSize: 8, color: '#facc15', flexShrink: 0 }}>GT</span>
          </div>
        ))}
        {filtered.length === 0 && filteredOrphanGT.length === 0 && (
          <div style={{ padding: '8px 16px', fontSize: 10, color: EMBRY.muted }}>
            {search ? 'No matches' : 'No prompts found'}
          </div>
        )}
      </LeftPaneSection>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setContextMenu(null)} />
          <div style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 1000,
            background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 6,
            padding: 4, minWidth: 140, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          }}>
            {[
              { action: 'rename', icon: <Pencil size={12} />, label: 'Rename' },
              { action: 'duplicate', icon: <Copy size={12} />, label: 'Duplicate' },
              { action: 'delete', icon: <Trash2 size={12} />, label: 'Delete' },
            ].map(({ action, icon, label }) => (
              <div key={action} onClick={() => handleAction(action)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                  fontSize: 11, color: action === 'delete' ? '#f87171' : EMBRY.dim,
                  cursor: 'pointer', borderRadius: 4,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                {icon} {label}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  fontSize: 11, background: EMBRY.bgDeep, color: EMBRY.white,
  border: `1px solid ${EMBRY.border}`, borderRadius: 4,
  padding: '4px 8px', outline: 'none', fontFamily: MONO,
}

const thStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: EMBRY.dim,
  letterSpacing: '0.15em', whiteSpace: 'nowrap',
  padding: '12px 20px', textAlign: 'left', borderBottom: `1px solid ${EMBRY.border}`,
}

const tdStyle: React.CSSProperties = {
  padding: '10px 20px', fontSize: 11, color: EMBRY.dim,
  borderBottom: `1px solid ${EMBRY.border}`, verticalAlign: 'middle',
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`,
  borderRadius: 6, color: EMBRY.white, outline: 'none', fontSize: 12, boxSizing: 'border-box' as const,
}
