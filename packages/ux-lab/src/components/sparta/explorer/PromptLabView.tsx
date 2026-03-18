import { useState, useEffect, useCallback, useRef } from 'react'
import { EMBRY, label, glowDot } from '../common/EmbryStyle'

const API = 'http://localhost:3001/api'

interface PromptVersion { name: string; filename: string; size: number }
interface EvalResult { prompt_variant: string; model: string; summary: Record<string, number>; cases: Array<Record<string, unknown>> }
interface ModelGroup { label: string; models: string[] }

// ── Draggable vertical divider ──────────────────────────────────────────────

function useDraggableWidth(initial: number, min: number, max: number) {
  const [width, setWidth] = useState(initial)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    startX.current = e.clientX
    startW.current = width
    e.preventDefault()
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      setWidth(Math.max(min, Math.min(max, startW.current + (ev.clientX - startX.current))))
    }
    const onUp = () => { dragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [width, min, max])

  return { width, onMouseDown }
}

// ── Main view ───────────────────────────────────────────────────────────────

export function PromptLabView() {
  const [prompts, setPrompts] = useState<PromptVersion[]>([])
  const [results, setResults] = useState<EvalResult[]>([])
  const [models, setModels] = useState<ModelGroup[]>([])
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null)
  const [promptContent, setPromptContent] = useState('')
  const [editedContent, setEditedContent] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set(['text', 'text-gemini']))
  const [testInput, setTestInput] = useState(JSON.stringify({
    control_id: 'CWE-79', framework: 'CWE', type: 'weakness',
    name: 'Cross-site Scripting (XSS)',
    description: 'The product does not neutralize or incorrectly neutralizes user-controllable input before it is placed in output that is used as a web page that is served to other users.',
    knowledge_excerpts: [],
  }, null, 2))
  const [userTemplate, setUserTemplate] = useState('Generate factual questions about this control.\n\nControl:\n{input}\n\nJSON:')
  const [testResults, setTestResults] = useState<Map<string, { content: string; elapsed: number; items: number; tokens?: number }>>(new Map())
  const [testing, setTesting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [payloadView, setPayloadView] = useState(false)

  const { width: leftWidth, onMouseDown: onDragLeft } = useDraggableWidth(380, 240, 600)

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

  /** Build the full messages array that will be sent */
  const buildMessages = useCallback((prompt: string) => {
    const userMsg = userTemplate.replace('{input}', testInput)
    return [
      { role: 'system', content: prompt },
      { role: 'user', content: userMsg },
    ]
  }, [userTemplate, testInput])

  const runTest = useCallback(async () => {
    setTesting(true)
    setTestResults(new Map())
    const prompt = editing ? editedContent : promptContent
    const modelsToTest = [...selectedModels]
    const messages = buildMessages(prompt)

    await Promise.all(modelsToTest.map(async (model) => {
      const t0 = Date.now()
      try {
        // Route subagent-service models differently
        const isSubagent = ['claude-sonnet', 'claude-opus', 'codex', 'gemini'].includes(model)
        const endpoint = isSubagent ? `${API}/subagent` : `${API}/scillm`

        const resp = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            response_format: { type: 'json_object' },
            max_tokens: 2048, temperature: 0,
          }),
        })
        const data = await resp.json()
        const content = data.choices?.[0]?.message?.content ?? data.content ?? 'No response'
        const elapsed = (Date.now() - t0) / 1000
        const tokens = data.usage?.total_tokens
        let items = 0
        try { items = JSON.parse(content).items?.length ?? 0 } catch {}
        const formatted = (() => { try { return JSON.stringify(JSON.parse(content), null, 2) } catch { return content } })()
        setTestResults((prev) => new Map(prev).set(model, { content: formatted, elapsed, items, tokens }))
      } catch (e) {
        setTestResults((prev) => new Map(prev).set(model, { content: `Error: ${e}`, elapsed: (Date.now() - t0) / 1000, items: 0 }))
      }
    }))
    setTesting(false)
  }, [promptContent, editedContent, editing, selectedModels, buildMessages])

  const activePrompt = 'qra_generation_sparta_context_v1'

  function toggleModel(m: string) {
    setSelectedModels((prev) => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m); else next.add(m)
      return next
    })
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* ── Left panel ─────────────────────────────────────────── */}
      <div style={{ width: leftWidth, display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: EMBRY.white }}>Prompt Lab</div>
          <div style={{ ...label, marginTop: 2 }}>Edit prompts · test models · compare results</div>
        </div>

        {/* ── Model selector with groups ── */}
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0, maxHeight: 260, overflow: 'auto' }}>
          <div style={{ ...label, marginBottom: 8 }}>Models ({selectedModels.size} selected)</div>
          {models.map((g) => (
            <div key={g.label} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: EMBRY.muted, marginBottom: 4 }}>
                {g.label}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {g.models.map((m) => {
                  const sel = selectedModels.has(m)
                  const isAgent = g.label.includes('subagent')
                  return (
                    <button
                      key={m}
                      onClick={() => toggleModel(m)}
                      style={{
                        fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                        border: `1px solid ${sel ? (isAgent ? EMBRY.amber : EMBRY.accent) : EMBRY.border}`,
                        backgroundColor: sel ? (isAgent ? `${EMBRY.amber}18` : `${EMBRY.accent}12`) : 'transparent',
                        color: sel ? (isAgent ? EMBRY.amber : EMBRY.accent) : EMBRY.dim,
                        fontWeight: sel ? 600 : 400,
                      }}
                    >
                      {isAgent && sel ? '🤖 ' : ''}{m}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── Prompt list ── */}
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

        {/* ── Eval results ── */}
        {results.length > 0 && (
          <div style={{ maxHeight: 200, overflow: 'auto', padding: '8px 16px', borderTop: `1px solid ${EMBRY.border}` }}>
            <div style={{ ...label, marginBottom: 6 }}>Evaluations ({results.length})</div>
            {results.map((r, i) => (
              <div key={`eval-${i}`} style={{ padding: '6px 8px', borderRadius: 4, border: `1px solid ${EMBRY.border}`, marginBottom: 4, fontSize: 10 }}>
                <div style={{ fontWeight: 600, color: EMBRY.white }}>{r.prompt_variant}</div>
                <div style={{ color: EMBRY.dim }}>{r.model} · {r.summary?.total ?? '?'} cases</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Drag handle ── */}
      <div
        onMouseDown={onDragLeft}
        style={{ width: 4, cursor: 'col-resize', backgroundColor: EMBRY.border, flexShrink: 0 }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = EMBRY.accent }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = EMBRY.border }}
      />

      {/* ── Right panel: editor + payload + results ── */}
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
              <button onClick={() => setPayloadView(!payloadView)} style={{ ...btnStyle, color: payloadView ? EMBRY.accent : EMBRY.dim }}>
                {payloadView ? 'Editor' : 'Payload'}
              </button>
              <button onClick={runTest} disabled={testing || selectedModels.size === 0} style={{ ...btnStyle, color: EMBRY.accent, borderColor: `${EMBRY.accent}44` }}>
                {testing ? `Testing ${selectedModels.size} models...` : `Test ${selectedModels.size} models`}
              </button>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {payloadView ? (
                /* ── Full payload view — shows exactly what gets sent ── */
                <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
                  <div style={{ ...label, marginBottom: 8 }}>Complete Request Payload</div>
                  {/* System message */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: EMBRY.accent, padding: '4px 8px', backgroundColor: `${EMBRY.accent}12`, borderRadius: '4px 4px 0 0', border: `1px solid ${EMBRY.accent}33`, borderBottom: 'none' }}>
                      [SYSTEM] — {selectedPrompt} ({(editing ? editedContent : promptContent).length.toLocaleString()} chars)
                    </div>
                    <pre style={{ margin: 0, padding: 12, fontSize: 11, lineHeight: 1.5, color: EMBRY.dim, fontFamily: 'monospace', whiteSpace: 'pre-wrap', backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: '0 0 4px 4px', maxHeight: 300, overflow: 'auto' }}>
                      {editing ? editedContent : promptContent}
                    </pre>
                  </div>
                  {/* User message template */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: EMBRY.blue, padding: '4px 8px', backgroundColor: `${EMBRY.blue}12`, borderRadius: '4px 4px 0 0', border: `1px solid ${EMBRY.blue}33`, borderBottom: 'none' }}>
                      [USER] — Template (edit below)
                    </div>
                    <textarea
                      value={userTemplate}
                      onChange={(e) => setUserTemplate(e.target.value)}
                      rows={3}
                      style={{ width: '100%', resize: 'vertical', backgroundColor: EMBRY.bgDeep, color: EMBRY.white, border: `1px solid ${EMBRY.border}`, borderRadius: '0 0 4px 4px', padding: 12, fontSize: 11, fontFamily: 'monospace', lineHeight: 1.5 }}
                    />
                  </div>
                  {/* Input variable */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: EMBRY.green, padding: '4px 8px', backgroundColor: `${EMBRY.green}12`, borderRadius: '4px 4px 0 0', border: `1px solid ${EMBRY.green}33`, borderBottom: 'none' }}>
                      {'{'}<span>input</span>{'}'} — Test Variable
                    </div>
                    <textarea
                      value={testInput}
                      onChange={(e) => setTestInput(e.target.value)}
                      rows={6}
                      style={{ width: '100%', resize: 'vertical', backgroundColor: EMBRY.bgDeep, color: EMBRY.white, border: `1px solid ${EMBRY.border}`, borderRadius: '0 0 4px 4px', padding: 12, fontSize: 11, fontFamily: 'monospace', lineHeight: 1.5 }}
                    />
                  </div>
                  {/* Resolved user message preview */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: EMBRY.muted, padding: '4px 8px', backgroundColor: `${EMBRY.muted}12`, borderRadius: '4px 4px 0 0', border: `1px solid ${EMBRY.muted}33`, borderBottom: 'none' }}>
                      [USER] — Resolved ({userTemplate.replace('{input}', testInput).length.toLocaleString()} chars)
                    </div>
                    <pre style={{ margin: 0, padding: 12, fontSize: 11, lineHeight: 1.5, color: EMBRY.dim, fontFamily: 'monospace', whiteSpace: 'pre-wrap', backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: '0 0 4px 4px', maxHeight: 200, overflow: 'auto' }}>
                      {userTemplate.replace('{input}', testInput)}
                    </pre>
                  </div>
                  {/* Request metadata */}
                  <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 4, backgroundColor: `${EMBRY.muted}08`, border: `1px solid ${EMBRY.border}`, fontSize: 10, color: EMBRY.dim }}>
                    <span style={{ fontWeight: 700 }}>Request config:</span>
                    {' '}response_format: json_object · max_tokens: 2048 · temperature: 0
                    <br />
                    <span style={{ fontWeight: 700 }}>Models:</span>
                    {' '}{[...selectedModels].join(', ') || 'none selected'}
                    <br />
                    <span style={{ fontWeight: 700 }}>Total payload:</span>
                    {' '}{((editing ? editedContent : promptContent).length + userTemplate.replace('{input}', testInput).length).toLocaleString()} chars
                  </div>
                </div>
              ) : (
                /* ── Prompt editor view ── */
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
              )}

              {/* ── Multi-model comparison results ── */}
              {testResults.size > 0 && (
                <div style={{ borderTop: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
                  <div style={{ padding: '8px 16px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ ...label }}>Results ({testResults.size}/{selectedModels.size})</div>
                    {[...testResults.entries()].map(([model, r]) => (
                      <span key={model} style={{ fontSize: 10, color: r.items > 0 ? EMBRY.green : EMBRY.red }}>
                        {model}: {r.items} items · {r.elapsed.toFixed(1)}s{r.tokens ? ` · ${r.tokens}tok` : ''}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', overflow: 'auto', maxHeight: 400 }}>
                    {[...testResults.entries()].map(([model, r]) => (
                      <div key={model} style={{ flex: 1, minWidth: 300, borderRight: `1px solid ${EMBRY.border}`, overflow: 'auto' }}>
                        <div style={{ padding: '6px 12px', backgroundColor: EMBRY.bgDeep, borderBottom: `1px solid ${EMBRY.border}`, fontSize: 10, fontWeight: 700, color: EMBRY.white, position: 'sticky', top: 0 }}>
                          {model}
                          <span style={{ color: r.items > 0 ? EMBRY.green : EMBRY.red, marginLeft: 8 }}>
                            {r.items} items · {r.elapsed.toFixed(1)}s
                          </span>
                        </div>
                        <pre style={{ margin: 0, padding: 12, fontSize: 10, lineHeight: 1.4, color: EMBRY.dim, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                          {r.content}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: EMBRY.dim, flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 16 }}>Select a prompt to begin</div>
            <div style={{ fontSize: 12 }}>Edit → Payload → Test → Compare → Deploy</div>
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
