import { useEffect, useRef, useState } from 'react'
import { EMBRY, card, label, panel, glowDot } from '../../sparta/common/EmbryStyle'

const API = 'http://localhost:3001'

interface ModelGroup {
  label: string
  models: string[]
}

const FALLBACK_GROUPS: ModelGroup[] = [
  { label: 'scillm aliases', models: ['text', 'deepseek'] },
  { label: 'Subagents (Docker)', models: ['claude-sonnet-4-20250514', 'gpt-5.3-codex', 'gemini-2.5-pro'] },
]

// Group bg tints for visual separation in <select>
const GROUP_COLORS: Record<string, string> = {
  'scillm aliases': '#1a1a2e',
  'Ollama (local)': '#1a2e1a',
  'Subagents (Docker)': '#1a1a3e',
}

const MAX_AUTO_ROUNDS = 10
const CONVERGENCE_THRESHOLD = 90

interface TestCase {
  id: string
  question: string
  answer?: string
  expectedVerdict?: 'PASS' | 'FAIL'
}

interface PromptVersion {
  name: string
  path: string
  content: string
}

interface ClassMetrics {
  tp: number; fp: number; fn: number; tn: number
  passRecall: number; failRecall: number; macroF1: number
}

interface RoundResult {
  round: number
  prompt: string
  passRate: number
  groundedRate: number
  avgLatency: number
  failures: { id: string; question: string; output: string; reason: string }[]
  total: number
  timestamp: string
}

export interface ConvergenceLoopProps {
  initialPrompt?: string
  onPromptAccepted?: (prompt: string) => void
}

function parseVerdict(output: string): 'PASS' | 'FAIL' {
  const m = output.match(/"verdict"\s*:\s*"(PASS|FAIL)"/i)
  if (m) return m[1].toUpperCase() as 'PASS' | 'FAIL'
  const m2 = output.match(/"grade"\s*:\s*"(PASS|FAIL)"/i)
  if (m2) return m2[1].toUpperCase() as 'PASS' | 'FAIL'
  if (/\bPASS\b/i.test(output)) return 'PASS'
  return 'FAIL'
}

export function ConvergenceLoop({ initialPrompt = '', onPromptAccepted }: ConvergenceLoopProps) {
  const [prompt, setPrompt] = useState(initialPrompt || INITIAL_PROMPT)
  const [userRequest, setUserRequest] = useState(INITIAL_USER_REQUEST)
  const [model, setModel] = useState('gemini/gemini-2.5-flash')
  const [metaModel, setMetaModel] = useState('gemini/gemini-2.5-flash')
  const [testCases, setTestCases] = useState<TestCase[]>([])
  const [rounds, setRounds] = useState<RoundResult[]>([])
  const [running, setRunning] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [status, setStatus] = useState('')
  const [sampleSize, setSampleSize] = useState(5)
  const [searchQuery, setSearchQuery] = useState('')
  const [candidatePrompt, setCandidatePrompt] = useState<string | null>(null)
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>(FALLBACK_GROUPS)
  const [optimizing, setOptimizing] = useState(false)
  const optimizingRef = useRef(false)
  const [dataSource, setDataSource] = useState<'arango' | 'jsonl'>('arango')
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([])
  const [selectedVersion, setSelectedVersion] = useState('Custom')
  const [classMetrics, setClassMetrics] = useState<ClassMetrics | null>(null)
  const [humanLabels, setHumanLabels] = useState<Record<string, 'PASS' | 'FAIL'>>({})
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [preflightResults, setPreflightResults] = useState<{ passRecall: number; failRecall: number; correct: number; total: number } | null>(null)
  const batchResolveRef = useRef<((approved: boolean) => void) | null>(null)
  const [exportStatus, setExportStatus] = useState('')

  useEffect(() => {
    fetch(`${API}/api/models`)
      .then((r) => r.json())
      .then((d) => {
        if (d.groups?.length) {
          // Filter out "Remote APIs (via scillm)" — redundant with subagents
          const filtered = d.groups.filter((g: ModelGroup) => g.label !== 'Remote APIs (via scillm)')
          setModelGroups(filtered)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch(`${API}/api/prompt-versions`)
      .then((r) => r.json())
      .then((d) => { if (d.versions?.length) setPromptVersions(d.versions) })
      .catch(() => {})
  }, [])

  async function loadTestCases(mode: 'sample' | 'search') {
    if (dataSource === 'jsonl' && mode === 'sample') {
      setStatus('Loading test cases from training JSONL...')
      try {
        const res = await fetch(`${API}/api/test-cases/jsonl`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: sampleSize, random: true }),
        })
        const data = await res.json()
        const cases: TestCase[] = (data.rows || []).map((r: any) => ({
          id: r.id, question: r.question, answer: r.answer, expectedVerdict: r.expectedVerdict,
        }))
        setTestCases(cases)
        setClassMetrics(null)
        setStatus(`Loaded ${cases.length} test cases from JSONL (2715 available)`)
      } catch (err) {
        setStatus(`Load error: ${err instanceof Error ? err.message : String(err)}`)
      }
      return
    }
    setStatus('Loading test cases from /memory...')
    try {
      const url = mode === 'sample' ? `${API}/api/test-cases/sample` : `${API}/api/test-cases/search`
      const body = mode === 'sample' ? { limit: sampleSize } : { query: searchQuery, limit: sampleSize }
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      const cases: TestCase[] = (data.rows || []).map((r: any) => ({ id: r.id, question: r.question || r.label, answer: r.answer }))
      setTestCases(cases)
      setClassMetrics(null)
      setStatus(`Loaded ${cases.length} test cases`)
    } catch (err) {
      setStatus(`Load error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function runEval() {
    if (testCases.length === 0) {
      setStatus('Load test cases first')
      return
    }
    setRunning(true)
    setStatus(`Running round ${rounds.length + 1} eval across ${testCases.length} cases...`)

    const results: { id: string; question: string; output: string; pass: boolean; grounded: boolean; latencyMs: number }[] = []

    for (const tc of testCases) {
      try {
        const res = await fetch(`${API}/api/eval/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemPrompt: prompt, question: userRequest.replace('{{question}}', tc.question), models: [model] }),
        })
        const data = await res.json()
        const modelResult = data.results?.[model]
        if (modelResult) {
          const pass = modelResult.status === 'ok' && modelResult.output?.length > 20
          results.push({
            id: tc.id,
            question: tc.question,
            output: modelResult.output || '',
            pass,
            grounded: pass,
            latencyMs: modelResult.latencyMs || 0,
          })
        }
      } catch {
        results.push({ id: tc.id, question: tc.question, output: 'ERROR', pass: false, grounded: false, latencyMs: 0 })
      }
    }

    const passRate = Math.round((results.filter((r) => r.pass).length / results.length) * 100)
    const groundedRate = Math.round((results.filter((r) => r.grounded).length / results.length) * 100)
    const avgLatency = Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length)
    const failures = results.filter((r) => !r.pass).map((r) => ({
      id: r.id, question: r.question, output: r.output, reason: r.output === 'ERROR' ? 'API error' : 'Low quality output',
    }))

    const round: RoundResult = {
      round: rounds.length + 1,
      prompt,
      passRate,
      groundedRate,
      avgLatency,
      failures,
      total: results.length,
      timestamp: new Date().toISOString(),
    }

    setRounds((prev) => [...prev, round])
    setRunning(false)

    // Compute per-class metrics if we have expected verdicts
    const hasExpected = testCases.some((tc) => tc.expectedVerdict)
    if (hasExpected) {
      let tp = 0, fp = 0, fn = 0, tn = 0
      for (const r of results) {
        const tc = testCases.find((t) => t.id === r.id)
        if (!tc?.expectedVerdict) continue
        const predicted = parseVerdict(r.output)
        if (predicted === 'PASS' && tc.expectedVerdict === 'PASS') tp++
        else if (predicted === 'PASS' && tc.expectedVerdict === 'FAIL') fp++
        else if (predicted === 'FAIL' && tc.expectedVerdict === 'PASS') fn++
        else tn++
      }
      const passRecall = tp + fn > 0 ? tp / (tp + fn) : 0
      const failRecall = tn + fp > 0 ? tn / (tn + fp) : 0
      const passPrec = tp + fp > 0 ? tp / (tp + fp) : 0
      const failPrec = tn + fn > 0 ? tn / (tn + fn) : 0
      const passF1 = passPrec + passRecall > 0 ? (2 * passPrec * passRecall) / (passPrec + passRecall) : 0
      const failF1 = failPrec + failRecall > 0 ? (2 * failPrec * failRecall) / (failPrec + failRecall) : 0
      const macroF1 = (passF1 + failF1) / 2
      setClassMetrics({ tp, fp, fn, tn, passRecall, failRecall, macroF1 })
    }

    setStatus(`Round ${round.round}: ${passRate}% pass, ${groundedRate}% grounded, ~${avgLatency}ms avg`)
  }

  async function selfCorrect() {
    const lastRound = rounds[rounds.length - 1]
    if (!lastRound || lastRound.failures.length === 0) {
      setStatus('No failures to correct')
      return
    }
    setCorrecting(true)
    setStatus('Sending failures to meta-model for self-correction...')

    try {
      const res = await fetch(`${API}/api/convergence/self-correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          model: metaModel,
          failures: lastRound.failures.slice(0, 5),
        }),
      })
      const data = await res.json()
      if (data.corrected_prompt) {
        setCandidatePrompt(data.corrected_prompt)
        setStatus('Self-correction complete. Review the candidate prompt below.')
      } else {
        setStatus(`Self-correct response: ${JSON.stringify(data).slice(0, 200)}`)
      }
    } catch (err) {
      setStatus(`Self-correct error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCorrecting(false)
    }
  }

  function acceptCandidate() {
    if (!candidatePrompt) return
    setPrompt(candidatePrompt)
    setCandidatePrompt(null)
    setStatus('Candidate accepted. Run eval to see the delta.')
    onPromptAccepted?.(candidatePrompt)
  }

  function rejectCandidate() {
    setCandidatePrompt(null)
    setStatus('Candidate rejected. Edit prompt manually or try again.')
  }

  function stopOptimize() {
    optimizingRef.current = false
    setOptimizing(false)
    setStatus('Auto-optimize stopped.')
  }

  async function autoOptimize() {
    if (testCases.length === 0) {
      setStatus('Load test cases first')
      return
    }

    // Gate: if scaling past 10 samples, require preflight approval
    if (sampleSize > 10) {
      setStatus('Running preflight (10 samples) before full batch...')
      await runPreflight()
      // Show modal and wait for user decision
      const approved = await new Promise<boolean>((resolve) => {
        batchResolveRef.current = resolve
        setShowBatchModal(true)
      })
      setShowBatchModal(false)
      batchResolveRef.current = null
      if (!approved) {
        setStatus('Batch cancelled.')
        return
      }
    }

    setOptimizing(true)
    optimizingRef.current = true

    for (let i = 0; i < MAX_AUTO_ROUNDS; i++) {
      if (!optimizingRef.current) break

      // 1. Eval
      setStatus(`Auto-optimize round ${rounds.length + 1}/${MAX_AUTO_ROUNDS}... evaluating`)
      await runEval()

      // Check if we converged
      const latest = rounds[rounds.length - 1]
      if (!latest) break
      if (latest.passRate >= CONVERGENCE_THRESHOLD) {
        setStatus(`Converged at ${latest.passRate}% (>=${CONVERGENCE_THRESHOLD}% threshold)`)
        break
      }

      if (!optimizingRef.current) break
      if (latest.failures.length === 0) break

      // 2. Self-correct
      setStatus(`Auto-optimize round ${rounds.length}/${MAX_AUTO_ROUNDS}... self-correcting`)
      await selfCorrect()

      if (!optimizingRef.current) break
      if (!candidatePrompt) break

      // 3. Auto-accept the candidate
      setPrompt(candidatePrompt)
      setCandidatePrompt(null)
    }

    optimizingRef.current = false
    setOptimizing(false)
  }

  async function saveHumanLabel(id: string, question: string, verdict: 'PASS' | 'FAIL') {
    setHumanLabels((prev) => ({ ...prev, [id]: verdict }))
    try {
      await fetch(`${API}/api/ground-truth/save`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labels: [{ id, question, verdict }] }),
      })
    } catch { /* silent — label is already set locally */ }
  }

  async function runPreflight() {
    setRunning(true); setStatus('Preflight: loading 10 random JSONL samples...')
    try {
      const res = await fetch(`${API}/api/test-cases/jsonl`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 10, random: true }) })
      const cases: TestCase[] = ((await res.json()).rows || []).map((r: any) => ({ id: r.id, question: r.question, answer: r.answer, expectedVerdict: r.expectedVerdict }))
      setTestCases(cases); setStatus('Preflight: evaluating 10 samples...')
      const results: { id: string; output: string }[] = []
      for (const tc of cases) {
        try {
          const er = await fetch(`${API}/api/eval/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemPrompt: prompt, question: userRequest.replace('{{question}}', tc.question), models: [model] }) })
          results.push({ id: tc.id, output: (await er.json()).results?.[model]?.output || '' })
        } catch { results.push({ id: tc.id, output: 'ERROR' }) }
      }
      let tp = 0, fp = 0, fn = 0, tn = 0, correct = 0
      for (const r of results) {
        const tc = cases.find((c) => c.id === r.id); if (!tc?.expectedVerdict) continue
        const predicted = parseVerdict(r.output); if (predicted === tc.expectedVerdict) correct++
        if (predicted === 'PASS' && tc.expectedVerdict === 'PASS') tp++; else if (predicted === 'PASS') fp++
        else if (tc.expectedVerdict === 'PASS') fn++; else tn++
      }
      const passRecall = tp + fn > 0 ? tp / (tp + fn) : 0, failRecall = tn + fp > 0 ? tn / (tn + fp) : 0
      setPreflightResults({ passRecall, failRecall, correct, total: results.length })
      setClassMetrics({ tp, fp, fn, tn, passRecall, failRecall, macroF1: 0 })
      setStatus(`Preflight: ${correct}/${results.length} correct | PASS Recall: ${(passRecall * 100).toFixed(0)}% | FAIL Recall: ${(failRecall * 100).toFixed(0)}%`)
    } catch (err) { setStatus(`Preflight error: ${err instanceof Error ? err.message : String(err)}`) }
    finally { setRunning(false) }
  }

  async function exportPrompt() {
    setExportStatus('Saving...')
    try {
      const res = await fetch(`${API}/api/prompt-versions/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: prompt, baseName: 'cascade_grader' }) })
      const data = await res.json()
      if (data.saved) {
        setExportStatus(`Saved as ${data.name}`)
        const vData = await (await fetch(`${API}/api/prompt-versions`)).json()
        if (vData.versions?.length) setPromptVersions(vData.versions)
      } else { setExportStatus(`Save failed: ${data.error || 'unknown'}`) }
    } catch (err) { setExportStatus(`Export error: ${err instanceof Error ? err.message : String(err)}`) }
    setTimeout(() => setExportStatus(''), 4000)
  }

  const currRound = rounds.length >= 1 ? rounds[rounds.length - 1] : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12, padding: 16, overflow: 'hidden' }}>
      {showBatchModal && preflightResults && (
        <BatchApprovalModal
          preflight={preflightResults}
          onApprove={() => batchResolveRef.current?.(true)}
          onCancel={() => batchResolveRef.current?.(false)}
        />
      )}
      {/* Workflow stepper */}
      <WorkflowStepper
        step={
          candidatePrompt ? 'review' :
          correcting ? 'correct' :
          running ? 'eval' :
          rounds.length > 0 && currRound && currRound.failures.length > 0 ? 'diagnose' :
          testCases.length === 0 ? 'load' :
          'setup'
        }
      />

      {/* Config bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <ModelSelect label="Eval Model" value={model} onChange={setModel} groups={modelGroups} tooltip="The model being evaluated — this is the one you're optimizing the prompt for" />
        <ModelSelect label="Judge Model" value={metaModel} onChange={setMetaModel} groups={modelGroups} tooltip="Higher-reasoning model that analyzes failures and rewrites the prompt" />
        <ConfigInput label="Sample" value={String(sampleSize)} onChange={(v) => setSampleSize(Math.max(1, Math.min(50, Number(v) || 5)))} width={50} />
        <form onSubmit={(e) => { e.preventDefault(); loadTestCases('search') }} style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            placeholder="Search QRAs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ ...inputStyle, width: 150 }}
          />
          <ActionBtn label="Search" color={EMBRY.blue} onClick={() => loadTestCases('search')} />
        </form>
        <select
          value={dataSource}
          onChange={(e) => setDataSource(e.target.value as 'arango' | 'jsonl')}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          <option value="arango">ArangoDB</option>
          <option value="jsonl">Training JSONL</option>
        </select>
        <ActionBtn label="Random" color={EMBRY.green} onClick={() => loadTestCases('sample')} />
        <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 'auto' }}>
          {testCases.length} loaded{dataSource === 'jsonl' ? ' / 2715' : ''}
        </span>
      </div>

      {/* Main content: prompt + rounds */}
      <div style={{ display: 'flex', gap: 12, flex: 1, overflow: 'hidden' }}>
        {/* Prompt editor */}
        <div style={{ ...card, flex: 1, display: 'flex', flexDirection: 'column', minWidth: 300 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={label}>System Prompt</div>
            {promptVersions.length > 0 && (
              <select
                value={selectedVersion}
                onChange={(e) => {
                  const v = promptVersions.find((p) => p.name === e.target.value)
                  if (v) { setPrompt(v.content); setSelectedVersion(v.name) }
                  else setSelectedVersion('Custom')
                }}
                style={{ ...inputStyle, fontSize: 10, cursor: 'pointer' }}
              >
                <option value="Custom">Custom</option>
                {promptVersions.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
            )}
          </div>
          <textarea
            value={prompt}
            onChange={(e) => { setPrompt(e.target.value); setSelectedVersion('Custom') }}
            spellCheck={false}
            style={{
              flex: 2, backgroundColor: EMBRY.bg, color: EMBRY.white,
              border: `1px solid ${EMBRY.border}`, borderRadius: 6,
              padding: 12, fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6,
              resize: 'none', outline: 'none',
            }}
          />
          <div style={{ ...label, marginBottom: 4, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            User Request Template
            <span style={{ fontSize: 9, fontWeight: 400, color: EMBRY.dim }}>{'{{question}} is replaced per test case'}</span>
          </div>
          <textarea
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1, minHeight: 48, backgroundColor: EMBRY.bg, color: EMBRY.accent,
              border: `1px solid ${EMBRY.accent}33`, borderRadius: 6,
              padding: 10, fontSize: 11, fontFamily: 'monospace', lineHeight: 1.5,
              resize: 'none', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <ActionBtn label={running ? 'Evaluating...' : 'Eval'} color={EMBRY.green} onClick={runEval} loading={running} />
            <ActionBtn label="Preflight (10)" color={EMBRY.blue} onClick={runPreflight} loading={running} disabled={running || correcting} tooltip="Quick sanity check: 10 random JSONL samples" />
            <ActionBtn
              label={correcting ? 'Correcting...' : 'Self-Correct'}
              color={EMBRY.accent}
              onClick={selfCorrect}
              loading={correcting}
              disabled={!currRound || currRound.failures.length === 0}
            />
            <div style={{ width: 1, height: 20, backgroundColor: EMBRY.border, margin: '0 2px' }} />
            {optimizing ? (
              <ActionBtn label="Stop" color={EMBRY.red} onClick={stopOptimize} />
            ) : (
              <ActionBtn
                label="Optimize"
                color={EMBRY.amber}
                onClick={autoOptimize}
                disabled={testCases.length === 0 || running || correcting}
                tooltip={`Auto eval→correct→eval loop until ${CONVERGENCE_THRESHOLD}% pass (max ${MAX_AUTO_ROUNDS} rounds)`}
              />
            )}
            <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              {prompt.length} chars
              <ActionBtn label="Export" color={EMBRY.accent} onClick={exportPrompt} tooltip="Save as next cascade_grader version to /prompt-lab" />
              {exportStatus && <span style={{ fontSize: 9, color: EMBRY.green }}>{exportStatus}</span>}
            </span>
          </div>

          {/* Candidate prompt (from self-correct) */}
          {candidatePrompt && (
            <div style={{ marginTop: 8, border: `1px solid ${EMBRY.accent}44`, borderRadius: 6, padding: 10, backgroundColor: `${EMBRY.accent}08` }}>
              <div style={{ ...label, color: EMBRY.accent, marginBottom: 6, fontSize: 10 }}>Candidate Prompt (from self-correct)</div>
              <div style={{ fontSize: 11, color: EMBRY.white, fontFamily: 'monospace', lineHeight: 1.5, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                {candidatePrompt}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <ActionBtn label="Accept" color={EMBRY.green} onClick={acceptCandidate} />
                <ActionBtn label="Reject" color={EMBRY.red} onClick={rejectCandidate} />
              </div>
            </div>
          )}
        </div>

        {/* Round history + delta */}
        <div style={{ ...card, width: 340, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ ...label, marginBottom: 8 }}>Rounds</div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {rounds.length === 0 ? (
              <div style={{ fontSize: 11, color: EMBRY.dim, padding: 12 }}>
                Load test cases, then click Eval to start round 1.
              </div>
            ) : (
              rounds.map((r, i) => {
                const prev = i > 0 ? rounds[i - 1] : null
                const passDelta = prev ? r.passRate - prev.passRate : 0
                const groundedDelta = prev ? r.groundedRate - prev.groundedRate : 0
                const latencyDelta = prev ? r.avgLatency - prev.avgLatency : 0

                return (
                  <div
                    key={r.round}
                    style={{
                      padding: '8px 10px',
                      borderBottom: `1px solid ${EMBRY.border}`,
                      backgroundColor: i === rounds.length - 1 ? `${EMBRY.accent}08` : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: EMBRY.white }}>Round {r.round}</span>
                      <span style={{ fontSize: 9, color: EMBRY.dim }}>
                        {r.timestamp.slice(11, 19)}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 12 }}>
                      <MetricPill label="Pass" value={`${r.passRate}%`} delta={passDelta} suffix="%" />
                      <MetricPill label="Grnd" value={`${r.groundedRate}%`} delta={groundedDelta} suffix="%" />
                      <MetricPill label="Lat" value={`${r.avgLatency}ms`} delta={-latencyDelta} suffix="ms" invertDelta />
                    </div>

                    {r.failures.length > 0 && (
                      <div style={{ marginTop: 6, fontSize: 10, color: EMBRY.red }}>
                        {r.failures.length}/{r.total} failed
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Convergence chart (sparkline) */}
          {rounds.length >= 2 && (
            <div style={{ ...panel, marginTop: 8, padding: 10 }}>
              <div style={{ ...label, fontSize: 9, marginBottom: 6 }}>Convergence</div>
              <ConvergenceSparkline rounds={rounds} />
            </div>
          )}

          {/* Confusion matrix */}
          {classMetrics && (
            <div style={{ ...panel, marginTop: 8, padding: 10 }}>
              <div style={{ ...label, fontSize: 9, marginBottom: 6 }}>Confusion Matrix</div>
              <ConfusionMatrix metrics={classMetrics} />
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      {status && (
        <div style={{
          padding: '6px 12px', borderRadius: 6,
          backgroundColor: `${EMBRY.blue}15`, border: `1px solid ${EMBRY.blue}33`,
          fontSize: 11, color: EMBRY.blue, lineHeight: 1.4, flexShrink: 0,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{status}</span>
          {classMetrics && (
            <span style={{ fontSize: 10, fontFamily: 'monospace' }}>
              PASS Recall: {(classMetrics.passRecall * 100).toFixed(0)}%
              {' | '}FAIL Recall: {(classMetrics.failRecall * 100).toFixed(0)}%
              {' | '}Macro F1: {(classMetrics.macroF1 * 100).toFixed(1)}%
            </span>
          )}
        </div>
      )}

      {/* Failure details for current round */}
      {currRound && currRound.failures.length > 0 && (
        <div style={{ ...card, flexShrink: 0, maxHeight: 200, overflow: 'auto' }}>
          <div style={{ ...label, marginBottom: 6, color: EMBRY.red }}>
            Round {currRound.round} Failures ({currRound.failures.length})
          </div>
          {currRound.failures.map((f) => (
            <div key={f.id} style={{ padding: '4px 0', borderBottom: `1px solid ${EMBRY.border}`, fontSize: 11, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <span style={{ color: EMBRY.dim, fontFamily: 'monospace' }}>{f.id}</span>
                {' '}
                <span style={{ color: EMBRY.white }}>{f.question.slice(0, 80)}</span>
                <div style={{ color: EMBRY.red, fontSize: 10, marginTop: 2 }}>{f.reason}: {f.output.slice(0, 100)}</div>
              </div>
              <div style={{ display: 'flex', gap: 2, flexShrink: 0, alignItems: 'center' }}>
                {humanLabels[f.id] && (
                  <span style={{ fontSize: 8, color: EMBRY.accent, marginRight: 2 }}>labeled</span>
                )}
                <button
                  onClick={() => saveHumanLabel(f.id, f.question, 'PASS')}
                  style={{
                    fontSize: 9, padding: '2px 6px', borderRadius: 3, cursor: 'pointer',
                    border: `1px solid ${EMBRY.green}44`,
                    backgroundColor: humanLabels[f.id] === 'PASS' ? `${EMBRY.green}30` : 'transparent',
                    color: EMBRY.green,
                  }}
                >P</button>
                <button
                  onClick={() => saveHumanLabel(f.id, f.question, 'FAIL')}
                  style={{
                    fontSize: 9, padding: '2px 6px', borderRadius: 3, cursor: 'pointer',
                    border: `1px solid ${EMBRY.red}44`,
                    backgroundColor: humanLabels[f.id] === 'FAIL' ? `${EMBRY.red}30` : 'transparent',
                    color: EMBRY.red,
                  }}
                >F</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BatchApprovalModal({ preflight, onApprove, onCancel }: {
  preflight: { passRecall: number; failRecall: number; correct: number; total: number }; onApprove: () => void; onCancel: () => void
}) {
  const passP = Math.round(preflight.passRecall * 100), failP = Math.round(preflight.failRecall * 100)
  const blocked = passP < 50 || failP < 50
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.7)' }}>
      <div style={{ ...card, width: 380, padding: 24 }}>
        <div style={{ ...label, fontSize: 13, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={glowDot(blocked ? EMBRY.amber : EMBRY.green)} /> Batch Approval Gate
        </div>
        <div style={{ fontSize: 12, color: EMBRY.white, marginBottom: 10 }}>Preflight: <strong>{preflight.correct}/{preflight.total}</strong> correct</div>
        <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: passP >= 50 ? EMBRY.green : EMBRY.red }}>PASS Recall: {passP}%</div>
          <div style={{ fontSize: 12, color: failP >= 50 ? EMBRY.green : EMBRY.red }}>FAIL Recall: {failP}%</div>
        </div>
        {blocked && <div style={{ fontSize: 10, color: EMBRY.red, marginBottom: 10, padding: '4px 8px', backgroundColor: `${EMBRY.red}15`, borderRadius: 4 }}>Both class recalls must be &ge; 50%</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={onApprove} disabled={blocked} style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 12, cursor: blocked ? 'not-allowed' : 'pointer', backgroundColor: blocked ? EMBRY.muted : EMBRY.green, color: blocked ? EMBRY.dim : '#000', opacity: blocked ? 0.5 : 1 }}>Approve Full Batch (2715)</button>
          <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer', backgroundColor: EMBRY.red, color: '#fff' }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function ModelSelect({ label: lbl, value, onChange, groups, tooltip }: {
  label: string; value: string; onChange: (v: string) => void; groups: ModelGroup[]; tooltip?: string
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const lowerFilter = filter.toLowerCase()
  const filteredGroups = groups
    .map((g) => ({
      ...g,
      models: g.models.filter((m) => !lowerFilter || m.toLowerCase().includes(lowerFilter) || g.label.toLowerCase().includes(lowerFilter)),
    }))
    .filter((g) => g.models.length > 0)

  return (
    <div ref={containerRef} style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }} title={tooltip}>
      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: EMBRY.dim }}>{lbl}:</span>
      <input
        type="text"
        value={open ? filter : value}
        onChange={(e) => { setFilter(e.target.value); if (!open) setOpen(true) }}
        onFocus={() => { setOpen(true); setFilter('') }}
        placeholder="Search models..."
        style={{ ...inputStyle, width: 220 }}
      />
      {open && filteredGroups.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 40, zIndex: 2000,
          width: 280, maxHeight: 320, overflow: 'auto',
          backgroundColor: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`,
          borderRadius: 6, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', marginTop: 2,
        }}>
          {filteredGroups.map((group) => (
            <div key={group.label}>
              <div style={{
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
                padding: '6px 10px 3px', color: EMBRY.dim,
                backgroundColor: GROUP_COLORS[group.label] || 'transparent',
              }}>
                {group.label}
              </div>
              {group.models.map((m) => (
                <div
                  key={m}
                  onClick={() => { onChange(m); setOpen(false); setFilter('') }}
                  style={{
                    padding: '5px 10px 5px 18', fontSize: 11, color: m === value ? EMBRY.accent : EMBRY.white,
                    backgroundColor: GROUP_COLORS[group.label] || 'transparent',
                    cursor: 'pointer', fontWeight: m === value ? 700 : 400,
                  }}
                  onMouseEnter={(e) => { (e.target as HTMLDivElement).style.backgroundColor = `${EMBRY.accent}20` }}
                  onMouseLeave={(e) => { (e.target as HTMLDivElement).style.backgroundColor = GROUP_COLORS[group.label] || 'transparent' }}
                >
                  {m === value ? `\u2713 ${m}` : m}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ConfigInput({ label: lbl, value, onChange, width }: { label: string; value: string; onChange: (v: string) => void; width: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: EMBRY.dim }}>{lbl}:</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, width }} />
    </div>
  )
}

function ActionBtn({ label: lbl, color, onClick, loading, disabled, tooltip }: {
  label: string; color: string; onClick: () => void; loading?: boolean; disabled?: boolean; tooltip?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      title={tooltip}
      style={{
        fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 4,
        border: `1px solid ${color}44`,
        backgroundColor: loading ? `${color}30` : `${color}15`,
        color, cursor: loading || disabled ? 'not-allowed' : 'pointer',
        opacity: loading || disabled ? 0.5 : 1,
      }}
    >
      {lbl}
    </button>
  )
}

function MetricPill({ label: lbl, value, delta, suffix, invertDelta }: {
  label: string; value: string; delta: number; suffix: string; invertDelta?: boolean
}) {
  const showDelta = delta !== 0
  const isPositive = invertDelta ? delta > 0 : delta > 0
  const deltaColor = isPositive ? EMBRY.green : EMBRY.red

  return (
    <div>
      <div style={{ fontSize: 9, color: EMBRY.dim, textTransform: 'uppercase' }}>{lbl}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: EMBRY.white }}>{value}</div>
      {showDelta && (
        <div style={{ fontSize: 9, fontWeight: 700, color: deltaColor }}>
          {delta > 0 ? '+' : ''}{delta}{suffix}
        </div>
      )}
    </div>
  )
}

function ConvergenceSparkline({ rounds }: { rounds: RoundResult[] }) {
  const width = 280
  const height = 40
  const maxPass = 100
  const points = rounds.map((r, i) => ({
    x: (i / (rounds.length - 1)) * width,
    y: height - (r.passRate / maxPass) * height,
  }))
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {/* Grid line at 80% */}
      <line x1={0} y1={height * 0.2} x2={width} y2={height * 0.2} stroke={`${EMBRY.green}33`} strokeDasharray="4 4" />
      <text x={width - 2} y={height * 0.2 - 2} fill={EMBRY.dim} fontSize={8} textAnchor="end">80%</text>
      {/* Path */}
      <path d={pathD} fill="none" stroke={EMBRY.accent} strokeWidth={2} />
      {/* Points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={EMBRY.accent} />
      ))}
    </svg>
  )
}

function ConfusionMatrix({ metrics }: { metrics: ClassMetrics }) {
  const cell = (_val: number, isCorrect: boolean): React.CSSProperties => ({
    padding: '4px 8px', textAlign: 'center' as const, fontSize: 12, fontWeight: 700,
    color: isCorrect ? EMBRY.green : EMBRY.red,
    backgroundColor: isCorrect ? `${EMBRY.green}15` : `${EMBRY.red}15`,
    border: `1px solid ${EMBRY.border}`,
  })
  const hdr: React.CSSProperties = {
    padding: '3px 6px', fontSize: 9, fontWeight: 700, color: EMBRY.dim,
    textTransform: 'uppercase', textAlign: 'center', border: `1px solid ${EMBRY.border}`,
  }
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr><td style={hdr} /><td style={hdr}>Pred PASS</td><td style={hdr}>Pred FAIL</td></tr>
      </thead>
      <tbody>
        <tr>
          <td style={hdr}>Act PASS</td>
          <td style={cell(metrics.tp, true)}>{metrics.tp}</td>
          <td style={cell(metrics.fn, false)}>{metrics.fn}</td>
        </tr>
        <tr>
          <td style={hdr}>Act FAIL</td>
          <td style={cell(metrics.fp, false)}>{metrics.fp}</td>
          <td style={cell(metrics.tn, true)}>{metrics.tn}</td>
        </tr>
      </tbody>
    </table>
  )
}

const inputStyle: React.CSSProperties = {
  backgroundColor: EMBRY.bgPanel,
  border: `1px solid ${EMBRY.border}`,
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 11,
  color: EMBRY.white,
  outline: 'none',
}

type WorkflowStep = 'load' | 'setup' | 'eval' | 'diagnose' | 'correct' | 'review'

const WORKFLOW_STEPS: { id: WorkflowStep; label: string; hint: string }[] = [
  { id: 'load', label: '1. Load', hint: 'Load test cases from /memory' },
  { id: 'setup', label: '2. Setup', hint: 'Edit system prompt + user request' },
  { id: 'eval', label: '3. Eval', hint: 'Run prompt against test cases' },
  { id: 'diagnose', label: '4. Diagnose', hint: 'Review failures below' },
  { id: 'correct', label: '5. Self-Correct', hint: 'Judge model rewrites prompt' },
  { id: 'review', label: '6. Accept/Reject', hint: 'Compare and loop' },
]

function WorkflowStepper({ step }: { step: WorkflowStep }) {
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0 }}>
      {WORKFLOW_STEPS.map((s, i) => {
        const isActive = s.id === step
        const stepIdx = WORKFLOW_STEPS.findIndex((ws) => ws.id === step)
        const isPast = i < stepIdx
        const color = isActive ? EMBRY.accent : isPast ? EMBRY.green : EMBRY.dim
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <div
              title={s.hint}
              style={{
                fontSize: 10,
                fontWeight: isActive ? 700 : 400,
                padding: '3px 10px',
                borderRadius: 4,
                color,
                backgroundColor: isActive ? `${EMBRY.accent}18` : isPast ? `${EMBRY.green}08` : 'transparent',
                border: `1px solid ${isActive ? EMBRY.accent + '44' : 'transparent'}`,
                cursor: 'default',
              }}
            >
              {s.label}
            </div>
            {i < WORKFLOW_STEPS.length - 1 && (
              <span style={{ color: isPast ? EMBRY.green : EMBRY.dim, fontSize: 10 }}>&#8594;</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

const INITIAL_USER_REQUEST = `{{question}}`

const INITIAL_PROMPT = `You are a SPARTA security analyst. Given a control ID and question, provide:
1. A direct answer grounded in the control specification
2. Relevant CWE/ATT&CK mappings
3. Practical implementation guidance

Rules:
- Never fabricate control IDs
- Always cite the source framework
- Keep responses under 200 words`
