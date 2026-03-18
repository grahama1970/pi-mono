import { useState, useEffect, useCallback } from 'react'
import { EMBRY, label, glowDot } from '../common/EmbryStyle'

const API = 'http://localhost:3001/api'

interface PromptVersion { name: string; filename: string; size: number }
interface EvalResult { prompt_variant: string; model: string; summary: Record<string, number>; cases: Array<Record<string, unknown>> }
interface ModelGroup { label: string; models: string[] }

export function PromptLabView() {
  const [prompts, setPrompts] = useState<PromptVersion[]>([])
  const [results, setResults] = useState<EvalResult[]>([])
  const [models, setModels] = useState<ModelGroup[]>([])
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null)
  const [promptContent, setPromptContent] = useState('')
  const [editedContent, setEditedContent] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedModel, setSelectedModel] = useState('text')
  const [testInput, setTestInput] = useState('{"control_id": "CWE-79", "framework": "CWE", "type": "weakness", "name": "Cross-site Scripting (XSS)", "description": "The product does not neutralize or incorrectly neutralizes user-controllable input before it is placed in output that is used as a web page that is served to other users.", "knowledge_excerpts": []}')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [loading, setLoading] = useState(true)

  // Load data
  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/prompt-lab/prompts`).then((r) => r.json()).catch(() => ({ prompts: [] })),
      fetch(`${API}/prompt-lab/results`).then((r) => r.json()).catch(() => ({ results: [] })),
      fetch(`${API}/models`).then((r) => r.json()).catch(() => ({ groups: [] })),
    ]).then(([p, r, m]) => {
      setPrompts(p.prompts ?? [])
      setResults(r.results ?? [])
      setModels(m.groups ?? [])
      setLoading(false)
    })
  }, [])

  // Load prompt content
  useEffect(() => {
    if (!selectedPrompt) return
    fetch(`${API}/prompt-lab/prompts/${selectedPrompt}`)
      .then((r) => r.json())
      .then((d) => { setPromptContent(d.content ?? ''); setEditedContent(d.content ?? '') })
      .catch(() => setPromptContent('Failed to load'))
  }, [selectedPrompt])

  const savePrompt = useCallback(async () => {
    if (!selectedPrompt) return
    setSaving(true)
    await fetch(`${API}/prompt-lab/prompts/${selectedPrompt}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editedContent }),
    }).catch(() => {})
    setPromptContent(editedContent)
    setEditing(false)
    setSaving(false)
  }, [selectedPrompt, editedContent])

  const runTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const prompt = editing ? editedContent : promptContent
      const resp = await fetch(`${API}/scillm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: `Generate factual questions about this control.\n\nControl:\n${testInput}\n\nJSON:` },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 2048, temperature: 0,
        }),
      })
      const data = await resp.json()
      const content = data.choices?.[0]?.message?.content ?? 'No response'
      try { setTestResult(JSON.stringify(JSON.parse(content), null, 2)) }
      catch { setTestResult(content) }
    } catch (e) { setTestResult(`Error: ${e}`) }
    setTesting(false)
  }, [promptContent, editedContent, editing, selectedModel, testInput])

  const activePrompt = 'qra_generation_sparta_context_v1'

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Left panel: prompts + models + results */}
      <div style={{ width: 360, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: EMBRY.white }}>Prompt Lab</div>
          <div style={{ ...label, marginTop: 2 }}>Edit prompts · test models · compare results</div>
        </div>

        {/* Model selector */}
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
          <div style={{ ...label, marginBottom: 6 }}>Model</div>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            style={{ width: '100%', backgroundColor: EMBRY.bgDeep, color: EMBRY.white, border: `1px solid ${EMBRY.border}`, borderRadius: 4, padding: '4px 8px', fontSize: 11 }}
          >
            {models.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Prompt list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 16px' }}>
          <div style={{ ...label, marginBottom: 6 }}>Prompts ({prompts.length})</div>
          {loading ? <div style={{ fontSize: 11, color: EMBRY.dim }}>Loading...</div> : (
            prompts.map((p) => {
              const isActive = p.name === activePrompt
              const isSel = p.name === selectedPrompt
              return (
                <div key={p.name} onClick={() => setSelectedPrompt(isSel ? null : p.name)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', marginBottom: 2,
                    backgroundColor: isSel ? `${EMBRY.accent}12` : 'transparent' }}>
                  <div style={glowDot(isActive ? EMBRY.green : EMBRY.dim, 5)} />
                  <span style={{ fontSize: 10, color: EMBRY.white, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <span style={{ fontSize: 9, color: EMBRY.muted }}>{(p.size / 1000).toFixed(1)}k</span>
                </div>
              )
            })
          )}
        </div>

        {/* Eval results */}
        <div style={{ maxHeight: 200, overflow: 'auto', padding: '8px 16px', borderTop: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 6 }}>Evaluations ({results.length})</div>
          {results.map((r, i) => (
            <div key={`eval-${i}`} style={{ padding: '6px 8px', borderRadius: 4, border: `1px solid ${EMBRY.border}`, marginBottom: 4, fontSize: 10 }}>
              <div style={{ fontWeight: 600, color: EMBRY.white }}>{r.prompt_variant}</div>
              <div style={{ color: EMBRY.dim }}>{r.model} · {r.summary?.total ?? '?'} cases</div>
              {r.summary && (
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  <span style={{ color: r.summary.valid_json_pct === 100 ? EMBRY.green : EMBRY.red }}>JSON:{r.summary.valid_json_pct}%</span>
                  <span>Items:{r.summary.avg_items}</span>
                  <span>Ans:{r.summary.avg_answer_length}ch</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right: editor + test */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selectedPrompt ? (
          <>
            {/* Toolbar */}
            <div style={{ padding: '8px 16px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: EMBRY.white, flex: 1 }}>{selectedPrompt}</span>
              {!editing ? (
                <button onClick={() => setEditing(true)} style={btnStyle}>Edit</button>
              ) : (
                <>
                  <button onClick={savePrompt} disabled={saving} style={{ ...btnStyle, color: EMBRY.green, borderColor: `${EMBRY.green}44` }}>{saving ? 'Saving...' : 'Save'}</button>
                  <button onClick={() => { setEditing(false); setEditedContent(promptContent) }} style={btnStyle}>Cancel</button>
                </>
              )}
              <button onClick={runTest} disabled={testing} style={{ ...btnStyle, color: EMBRY.accent, borderColor: `${EMBRY.accent}44` }}>
                {testing ? 'Running...' : `Test with ${selectedModel}`}
              </button>
            </div>

            {/* Split: editor top, test input + result bottom */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Prompt editor */}
              <div style={{ flex: 1, overflow: 'auto' }}>
                {editing ? (
                  <textarea value={editedContent} onChange={(e) => setEditedContent(e.target.value)}
                    style={{ width: '100%', height: '100%', resize: 'none', backgroundColor: EMBRY.bgDeep, color: EMBRY.white, border: 'none', outline: 'none', padding: 16, fontSize: 12, lineHeight: 1.6, fontFamily: 'monospace' }} />
                ) : (
                  <pre style={{ margin: 0, padding: 16, fontSize: 12, lineHeight: 1.6, color: EMBRY.dim, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                    {promptContent}
                  </pre>
                )}
              </div>

              {/* Test input */}
              <div style={{ borderTop: `1px solid ${EMBRY.border}`, flexShrink: 0, padding: '8px 16px' }}>
                <div style={{ ...label, marginBottom: 4 }}>Test Input (control JSON)</div>
                <textarea value={testInput} onChange={(e) => setTestInput(e.target.value)}
                  rows={3}
                  style={{ width: '100%', resize: 'vertical', backgroundColor: EMBRY.bgDeep, color: EMBRY.white, border: `1px solid ${EMBRY.border}`, borderRadius: 4, padding: 8, fontSize: 11, fontFamily: 'monospace', lineHeight: 1.4 }} />
              </div>

              {/* Test result */}
              {testResult && (
                <div style={{ maxHeight: 300, overflow: 'auto', borderTop: `1px solid ${EMBRY.border}`, padding: 16, flexShrink: 0 }}>
                  <div style={{ ...label, marginBottom: 6 }}>Result ({selectedModel})</div>
                  <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: EMBRY.green, fontFamily: 'monospace', whiteSpace: 'pre-wrap', padding: 12, borderRadius: 6, backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}` }}>
                    {testResult}
                  </pre>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: EMBRY.dim, flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 16 }}>Select a prompt to begin</div>
            <div style={{ fontSize: 12 }}>Edit → Test → Compare → Deploy</div>
          </div>
        )}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 4,
  border: `1px solid ${EMBRY.border}`, backgroundColor: 'transparent',
  color: EMBRY.white, cursor: 'pointer',
}
