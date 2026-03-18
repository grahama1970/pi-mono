import { useState, useEffect, useCallback } from 'react'
import { EMBRY, label, glowDot } from '../common/EmbryStyle'

const API = 'http://localhost:3001/api'

interface PromptVersion {
  name: string
  filename: string
  size: number
}

interface EvalResult {
  prompt_variant: string
  model: string
  summary: Record<string, number>
  cases: Array<Record<string, unknown>>
}

export function PromptLabView() {
  const [prompts, setPrompts] = useState<PromptVersion[]>([])
  const [results, setResults] = useState<EvalResult[]>([])
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null)
  const [promptContent, setPromptContent] = useState<string>('')
  const [editedContent, setEditedContent] = useState<string>('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Load prompts and results
  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/prompt-lab/prompts`).then((r) => r.json()).catch(() => ({ prompts: [] })),
      fetch(`${API}/prompt-lab/results`).then((r) => r.json()).catch(() => ({ results: [] })),
    ]).then(([promptRes, resultRes]) => {
      setPrompts(promptRes.prompts ?? [])
      setResults(resultRes.results ?? [])
      setLoading(false)
    })
  }, [])

  // Load selected prompt content
  useEffect(() => {
    if (!selectedPrompt) return
    fetch(`${API}/prompt-lab/prompts/${selectedPrompt}`)
      .then((r) => r.json())
      .then((data) => {
        setPromptContent(data.content ?? '')
        setEditedContent(data.content ?? '')
      })
      .catch(() => setPromptContent('Failed to load'))
  }, [selectedPrompt])

  // Save edited prompt
  const savePrompt = useCallback(async () => {
    if (!selectedPrompt) return
    setSaving(true)
    try {
      await fetch(`${API}/prompt-lab/prompts/${selectedPrompt}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editedContent }),
      })
      setPromptContent(editedContent)
      setEditing(false)
    } catch { /* */ }
    setSaving(false)
  }, [selectedPrompt, editedContent])

  // Test prompt on a single control via /api/scillm
  const testPrompt = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const resp = await fetch(`${API}/scillm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'text',
          messages: [
            { role: 'system', content: editing ? editedContent : promptContent },
            { role: 'user', content: 'Generate factual questions about this control.\n\nControl:\n{"control_id": "CWE-79", "framework": "CWE", "type": "weakness", "name": "Cross-site Scripting (XSS)", "description": "The product does not neutralize or incorrectly neutralizes user-controllable input before it is placed in output that is used as a web page that is served to other users.", "knowledge_excerpts": []}\n\nJSON:' },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 1024,
          temperature: 0,
        }),
      })
      const data = await resp.json()
      const content = data.choices?.[0]?.message?.content ?? 'No response'
      try {
        setTestResult(JSON.stringify(JSON.parse(content), null, 2))
      } catch {
        setTestResult(content)
      }
    } catch (e) {
      setTestResult(`Error: ${e}`)
    }
    setTesting(false)
  }, [promptContent, editedContent, editing])

  const activePrompt = 'qra_generation_sparta_context_v1'

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Left: prompt list + eval results */}
      <div style={{ width: 400, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: EMBRY.white }}>Prompt Lab</div>
          <div style={{ ...label, marginTop: 2 }}>QRA generation prompts · click to view/edit</div>
        </div>

        {/* Prompt versions */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
          <div style={{ ...label, marginBottom: 8 }}>Prompt Versions ({prompts.length})</div>
          {loading ? <div style={{ fontSize: 11, color: EMBRY.dim }}>Loading...</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {prompts.map((p) => {
                const isActive = p.name === activePrompt
                const isSel = p.name === selectedPrompt
                return (
                  <div
                    key={p.name}
                    onClick={() => setSelectedPrompt(isSel ? null : p.name)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', borderRadius: 4, cursor: 'pointer',
                      backgroundColor: isSel ? `${EMBRY.accent}12` : 'transparent',
                      border: `1px solid ${isSel ? EMBRY.accent : 'transparent'}`,
                    }}
                  >
                    <div style={glowDot(isActive ? EMBRY.green : EMBRY.dim, 6)} />
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: EMBRY.white, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ fontSize: 9, color: EMBRY.dim }}>{p.size.toLocaleString()} chars</div>
                    </div>
                    {isActive && <span style={{ fontSize: 8, color: EMBRY.green, fontWeight: 700 }}>ACTIVE</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Eval comparison */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
          <div style={{ ...label, marginBottom: 8 }}>Evaluation Results ({results.length})</div>
          {results.map((r, i) => (
            <div key={`eval-${i}`} style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${EMBRY.border}`, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: EMBRY.white, marginBottom: 4 }}>{r.prompt_variant}</div>
              <div style={{ fontSize: 10, color: EMBRY.dim, marginBottom: 6 }}>Model: {r.model}</div>
              {r.summary && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {Object.entries(r.summary).map(([k, v]) => (
                    <div key={k} style={{ fontSize: 9, color: EMBRY.dim }}>
                      {k}: <span style={{ color: EMBRY.white }}>{typeof v === 'number' && v < 10 ? v.toFixed(1) : v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right: prompt editor + test */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selectedPrompt ? (
          <>
            {/* Toolbar */}
            <div style={{ padding: '8px 16px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: EMBRY.white, flex: 1 }}>{selectedPrompt}</span>
              {!editing ? (
                <>
                  <button onClick={() => setEditing(true)} style={btnStyle}>Edit</button>
                  <button onClick={testPrompt} disabled={testing} style={{ ...btnStyle, color: EMBRY.accent, borderColor: `${EMBRY.accent}44` }}>
                    {testing ? 'Testing...' : 'Test on CWE-79'}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={savePrompt} disabled={saving} style={{ ...btnStyle, color: EMBRY.green, borderColor: `${EMBRY.green}44` }}>
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={() => { setEditing(false); setEditedContent(promptContent) }} style={btnStyle}>Cancel</button>
                  <button onClick={testPrompt} disabled={testing} style={{ ...btnStyle, color: EMBRY.accent, borderColor: `${EMBRY.accent}44` }}>
                    {testing ? 'Testing...' : 'Test Edit'}
                  </button>
                </>
              )}
            </div>

            {/* Editor / Viewer */}
            <div style={{ flex: 1, overflow: 'auto', padding: 0 }}>
              {editing ? (
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  style={{
                    width: '100%', height: '100%', resize: 'none',
                    backgroundColor: EMBRY.bgDeep, color: EMBRY.white,
                    border: 'none', outline: 'none',
                    padding: 16, fontSize: 12, lineHeight: 1.6,
                    fontFamily: 'monospace',
                  }}
                />
              ) : (
                <pre style={{
                  margin: 0, padding: 16, fontSize: 12, lineHeight: 1.6,
                  color: EMBRY.dim, fontFamily: 'monospace', whiteSpace: 'pre-wrap',
                }}>
                  {promptContent || 'Select a prompt to view'}
                </pre>
              )}
            </div>

            {/* Test result */}
            {testResult && (
              <div style={{ maxHeight: 300, overflow: 'auto', borderTop: `1px solid ${EMBRY.border}`, padding: 16, flexShrink: 0 }}>
                <div style={{ ...label, marginBottom: 6 }}>Test Result (CWE-79)</div>
                <pre style={{
                  margin: 0, fontSize: 11, lineHeight: 1.5, color: EMBRY.green,
                  fontFamily: 'monospace', whiteSpace: 'pre-wrap',
                  padding: 12, borderRadius: 6, backgroundColor: EMBRY.bgDeep,
                  border: `1px solid ${EMBRY.border}`,
                }}>
                  {testResult}
                </pre>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: EMBRY.dim }}>
            Select a prompt to view, edit, or test
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
