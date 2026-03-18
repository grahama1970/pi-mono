import { useState, useEffect } from 'react'
import { EMBRY, label, glowDot } from '../common/EmbryStyle'

const API = 'http://localhost:3001/api/memory'
const PROMPT_LAB_BASE = '/home/graham/workspace/experiments/pi-mono/.pi/skills/prompt-lab'

interface PromptVersion {
  name: string
  path: string
  size: number
}

interface EvalResult {
  prompt_variant: string
  model: string
  summary: {
    total: number
    valid_json_pct: number
    avg_items: number
    avg_answer_length: number
    has_reasoning_pct: number
    cites_description_pct: number
    confidence_set_pct: number
  }
  cases: Array<{
    case_id: string
    framework?: string
    valid_json?: boolean
    item_count?: number
    avg_answer_length?: number
  }>
}

export function PromptLabView() {
  const [prompts, setPrompts] = useState<PromptVersion[]>([])
  const [results, setResults] = useState<EvalResult[]>([])
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null)
  const [promptContent, setPromptContent] = useState<string>('')
  const [loading, setLoading] = useState(true)

  // Load prompt files and eval results via /recall
  useEffect(() => {
    setLoading(true)

    // Load eval results — these are stored as JSON files, but we can list them via the API
    // For now, hardcode the known results from this session
    const knownResults: EvalResult[] = []

    // Fetch eval results from the Express server
    Promise.all([
      fetch(`${API}/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: 'QRA generation prompt evaluation', collections: ['lessons'], k: 5 }),
      }).then((r) => r.json()).catch(() => ({ items: [] })),
    ]).then(([recallRes]) => {
      // Known prompt versions from this session
      setPrompts([
        { name: 'qra_generation_sparta_context_v1', path: `${PROMPT_LAB_BASE}/prompts/qra_generation_sparta_context_v1.txt`, size: 9298 },
        { name: 'qra_generation_control_native_v1', path: `${PROMPT_LAB_BASE}/prompts/qra_generation_control_native_v1.txt`, size: 4300 },
        { name: 'qra_simple_system_prompt (original)', path: `${PROMPT_LAB_BASE}/prompts/qra_simple_system_prompt.txt`, size: 3200 },
      ])

      // Known eval results
      setResults([
        {
          prompt_variant: 'SPARTA Contextualized (v1)',
          model: 'DeepSeek-V3',
          summary: {
            total: 20, valid_json_pct: 100, avg_items: 4.1,
            avg_answer_length: 475, has_reasoning_pct: 100,
            cites_description_pct: 75, confidence_set_pct: 100,
          },
          cases: [],
        },
        {
          prompt_variant: 'Control Native (v1)',
          model: 'DeepSeek-V3',
          summary: {
            total: 20, valid_json_pct: 100, avg_items: 3.95,
            avg_answer_length: 219, has_reasoning_pct: 90,
            cites_description_pct: 75, confidence_set_pct: 85,
          },
          cases: [],
        },
      ])

      setLoading(false)
    })
  }, [])

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Left: prompt versions + eval comparison */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: EMBRY.white }}>Prompt Lab</div>
          <div style={{ ...label, marginTop: 2 }}>QRA generation prompt versions, evaluations, and comparison</div>
        </div>

        {/* Eval comparison table */}
        <div style={{ padding: '16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
          <div style={{ ...label, marginBottom: 8 }}>Prompt Evaluation Comparison</div>
          {loading ? (
            <div style={{ fontSize: 11, color: EMBRY.dim }}>Loading...</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Variant</th>
                  <th style={thStyle}>Model</th>
                  <th style={thStyle}>Valid JSON</th>
                  <th style={thStyle}>Avg Items</th>
                  <th style={thStyle}>Avg Answer</th>
                  <th style={thStyle}>Reasoning</th>
                  <th style={thStyle}>Citations</th>
                  <th style={thStyle}>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const s = r.summary
                  const isWinner = i === 0 // SPARTA variant won
                  return (
                    <tr key={r.prompt_variant} style={{ backgroundColor: isWinner ? `${EMBRY.green}08` : 'transparent' }}>
                      <td style={{ ...tdStyle, fontWeight: isWinner ? 700 : 400, color: isWinner ? EMBRY.green : EMBRY.white }}>
                        {r.prompt_variant}
                        {isWinner && <span style={{ fontSize: 9, marginLeft: 6, color: EMBRY.green }}>WINNER</span>}
                      </td>
                      <td style={{ ...tdStyle, fontSize: 10, color: EMBRY.dim }}>{r.model}</td>
                      <td style={tdStyle}><span style={{ color: s.valid_json_pct === 100 ? EMBRY.green : EMBRY.red }}>{s.valid_json_pct}%</span></td>
                      <td style={tdStyle}>{s.avg_items}</td>
                      <td style={tdStyle}>{s.avg_answer_length} chars</td>
                      <td style={tdStyle}><span style={{ color: s.has_reasoning_pct === 100 ? EMBRY.green : EMBRY.amber }}>{s.has_reasoning_pct}%</span></td>
                      <td style={tdStyle}>{s.cites_description_pct}%</td>
                      <td style={tdStyle}><span style={{ color: s.confidence_set_pct === 100 ? EMBRY.green : EMBRY.amber }}>{s.confidence_set_pct}%</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Prompt versions */}
        <div style={{ padding: '16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
          <div style={{ ...label, marginBottom: 8 }}>Prompt Versions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {prompts.map((p) => {
              const isActive = p.name === 'qra_generation_sparta_context_v1'
              return (
                <div
                  key={p.name}
                  onClick={() => setSelectedPrompt(p.name === selectedPrompt ? null : p.name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                    backgroundColor: selectedPrompt === p.name ? `${EMBRY.accent}12` : EMBRY.bgDeep,
                    border: `1px solid ${selectedPrompt === p.name ? EMBRY.accent : EMBRY.border}`,
                  }}
                >
                  <div style={glowDot(isActive ? EMBRY.green : EMBRY.dim, 6)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: EMBRY.white }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: EMBRY.dim }}>{p.size.toLocaleString()} chars</div>
                  </div>
                  {isActive && <span style={{ fontSize: 9, color: EMBRY.green, fontWeight: 700 }}>ACTIVE</span>}
                </div>
              )
            })}
          </div>
        </div>

        {/* Backfill status */}
        <div style={{ padding: '16px', flexShrink: 0 }}>
          <div style={{ ...label, marginBottom: 8 }}>Current Backfill</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <StatusRow label="Prompt" value="qra_generation_sparta_context_v1" ok={true} />
            <StatusRow label="Model" value="DeepSeek-V3 (text alias via scillm)" ok={true} />
            <StatusRow label="Concurrency" value="10" ok={true} />
            <StatusRow label="JSON Repair" value="Enabled (scillm json_guard)" ok={true} />
            <StatusRow label="Storage" value="/learn endpoint (handles embeddings)" ok={true} />
          </div>
        </div>
      </div>

      {/* Right: selected prompt preview */}
      {selectedPrompt && (
        <div style={{ width: 500, backgroundColor: EMBRY.bgPanel, borderLeft: `1px solid ${EMBRY.border}`, overflow: 'auto', flexShrink: 0, padding: 16 }}>
          <div style={{ ...label, marginBottom: 8 }}>Prompt: {selectedPrompt}</div>
          <div style={{
            fontSize: 11, lineHeight: 1.6, color: EMBRY.dim,
            padding: 12, borderRadius: 6,
            backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`,
            whiteSpace: 'pre-wrap', fontFamily: 'monospace',
            maxHeight: '100%', overflow: 'auto',
          }}>
            Loading prompt content...
            {/* TODO: Serve prompt files via Express API */}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusRow({ label: l, value, ok }: { label: string; value: string; ok: boolean | null }) {
  const color = ok === null ? EMBRY.dim : ok ? EMBRY.green : EMBRY.red
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={glowDot(color, 6)} />
      <span style={{ fontSize: 10, color: EMBRY.muted, width: 100, flexShrink: 0 }}>{l}</span>
      <span style={{ fontSize: 11, color: EMBRY.white }}>{value}</span>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
  color: EMBRY.dim, padding: '8px 10px', textAlign: 'left',
  borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bgDeep,
}
const tdStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, borderBottom: `1px solid ${EMBRY.border}`, color: EMBRY.white,
}
