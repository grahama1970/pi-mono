import { useState } from 'react'
import { EMBRY, panel, label } from '../../sparta/common/EmbryStyle'

const API = 'http://localhost:3001'

function ActionBtn({ label: lbl, tooltip, color, onClick, loading }: {
  label: string; tooltip: string; color: string; onClick: () => void; loading?: boolean
}) {
  return (
    <button
      title={tooltip}
      onClick={onClick}
      disabled={loading}
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: '4px 10px',
        borderRadius: 4,
        border: `1px solid ${color}44`,
        backgroundColor: loading ? `${color}30` : `${color}15`,
        color,
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.6 : 1,
      }}
    >
      {loading ? `${lbl}...` : lbl}
    </button>
  )
}

interface PromptVersion {
  id: string
  label: string
  date: string
  text: string
}

const INITIAL_PROMPT = `You are a SPARTA security analyst. Given a control ID and question, provide:
1. A direct answer grounded in the control specification
2. Relevant CWE/ATT&CK mappings
3. Practical implementation guidance

Rules:
- Never fabricate control IDs
- Always cite the source framework
- Keep responses under 200 words`

const INITIAL_VERSIONS: PromptVersion[] = [
  { id: 'v3', label: 'v3 (current)', date: '2026-03-16', text: INITIAL_PROMPT },
  { id: 'v2', label: 'v2', date: '2026-03-14', text: `You are a SPARTA security analyst. Answer questions about space security controls.\n\nRules:\n- Cite source frameworks\n- Keep responses concise` },
  { id: 'v1', label: 'v1 (baseline)', date: '2026-03-10', text: `Answer questions about SPARTA security controls accurately.` },
]

export interface PromptEditorProps {
  collapsed?: boolean
  onPromptChange?: (prompt: string) => void
}

export function PromptEditor({ collapsed, onPromptChange }: PromptEditorProps) {
  const [versions, setVersions] = useState<PromptVersion[]>(INITIAL_VERSIONS)
  const [activeVersion, setActiveVersion] = useState('v3')
  const [prompt, setPrompt] = useState(INITIAL_PROMPT)
  const [optimizing, setOptimizing] = useState(false)
  const [evaling, setEvaling] = useState(false)
  const [evalResult, setEvalResult] = useState<string | null>(null)
  const [diffView, setDiffView] = useState<{ from: string; to: string } | null>(null)

  function handlePromptChange(text: string) {
    setPrompt(text)
    onPromptChange?.(text)
  }

  function switchVersion(id: string) {
    setActiveVersion(id)
    const v = versions.find((v) => v.id === id)
    if (v) {
      setPrompt(v.text)
      onPromptChange?.(v.text)
    }
    setDiffView(null)
  }

  async function handleOptimize() {
    setOptimizing(true)
    setEvalResult(null)
    try {
      const res = await fetch(`${API}/api/prompt-lab/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      if (data.optimized_prompt) {
        handlePromptChange(data.optimized_prompt)
        setEvalResult('Prompt optimized via /prompt-lab self-correct')
      } else if (data.raw) {
        setEvalResult(`Optimize output: ${data.raw.slice(0, 200)}`)
      } else {
        setEvalResult(`Response: ${JSON.stringify(data).slice(0, 200)}`)
      }
    } catch (err) {
      setEvalResult(`Optimize error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setOptimizing(false)
    }
  }

  async function handleEval() {
    setEvaling(true)
    setEvalResult(null)
    try {
      const res = await fetch(`${API}/api/prompt-lab/eval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      if (data.scores) {
        const summary = Object.entries(data.scores)
          .map(([k, v]) => `${k}: ${v}`)
          .join(' | ')
        setEvalResult(`Eval: ${summary}`)
      } else if (data.raw) {
        setEvalResult(`Eval output: ${data.raw.slice(0, 300)}`)
      } else {
        setEvalResult(`Eval: ${JSON.stringify(data).slice(0, 300)}`)
      }
    } catch (err) {
      setEvalResult(`Eval error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setEvaling(false)
    }
  }

  function handleSaveVersion() {
    const nextNum = versions.length + 1
    const newVersion: PromptVersion = {
      id: `v${nextNum}`,
      label: `v${nextNum} (current)`,
      date: new Date().toISOString().slice(0, 10),
      text: prompt,
    }
    // Demote the previous "current" label
    const updated = versions.map((v) => ({
      ...v,
      label: v.label.replace(' (current)', ''),
    }))
    setVersions([newVersion, ...updated])
    setActiveVersion(newVersion.id)
    setEvalResult(`Saved as ${newVersion.label}`)
  }

  function handleDiff() {
    if (versions.length < 2) return
    const currentIdx = versions.findIndex((v) => v.id === activeVersion)
    const prevIdx = currentIdx + 1 < versions.length ? currentIdx + 1 : 0
    setDiffView({ from: versions[prevIdx].text, to: prompt })
  }

  if (collapsed) {
    return (
      <div style={{ padding: 8, fontSize: 11, color: EMBRY.dim }}>
        <span style={{ fontFamily: 'monospace' }}>{prompt.length} chars</span>
        {' | '}
        <span>{activeVersion}</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 12, height: '100%' }}>
      <div style={{ width: 140, flexShrink: 0 }}>
        <div style={{ ...label, marginBottom: 8 }}>Versions</div>
        {versions.map((v) => (
          <button
            key={v.id}
            onClick={() => switchVersion(v.id)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 8px',
              marginBottom: 4,
              borderRadius: 4,
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: activeVersion === v.id ? 700 : 400,
              color: activeVersion === v.id ? EMBRY.green : EMBRY.dim,
              backgroundColor:
                activeVersion === v.id ? `${EMBRY.green}18` : 'transparent',
            }}
          >
            {v.label}
            <div style={{ fontSize: 9, color: EMBRY.dim, marginTop: 2 }}>
              {v.date}
            </div>
          </button>
        ))}
      </div>
      <div style={{ ...panel, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...label, marginBottom: 6 }}>System Prompt</div>

        {diffView ? (
          <div style={{ flex: 1, overflow: 'auto', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6 }}>
            {computeDiff(diffView.from, diffView.to).map((line, i) => (
              <div
                key={i}
                style={{
                  padding: '1px 8px',
                  backgroundColor:
                    line.type === 'add' ? `${EMBRY.green}15` :
                    line.type === 'remove' ? `${EMBRY.red}15` : 'transparent',
                  color:
                    line.type === 'add' ? EMBRY.green :
                    line.type === 'remove' ? EMBRY.red : EMBRY.dim,
                }}
              >
                {line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  '}
                {line.text}
              </div>
            ))}
            <button
              onClick={() => setDiffView(null)}
              style={{
                marginTop: 8,
                fontSize: 10,
                padding: '4px 10px',
                borderRadius: 4,
                border: `1px solid ${EMBRY.border}`,
                backgroundColor: 'transparent',
                color: EMBRY.dim,
                cursor: 'pointer',
              }}
            >
              Close Diff
            </button>
          </div>
        ) : (
          <textarea
            value={prompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1,
              backgroundColor: EMBRY.bg,
              color: EMBRY.white,
              border: `1px solid ${EMBRY.border}`,
              borderRadius: 6,
              padding: 12,
              fontSize: 12,
              fontFamily: 'monospace',
              lineHeight: 1.6,
              resize: 'none',
              outline: 'none',
            }}
          />
        )}

        {evalResult && (
          <div
            style={{
              marginTop: 6,
              padding: '6px 10px',
              borderRadius: 4,
              backgroundColor: `${EMBRY.accent}15`,
              border: `1px solid ${EMBRY.accent}33`,
              fontSize: 11,
              color: EMBRY.accent,
              lineHeight: 1.4,
            }}
          >
            {evalResult}
          </div>
        )}

        <div
          style={{
            marginTop: 8,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <ActionBtn
              label="Optimize"
              tooltip="Run /prompt-lab self-correct to improve this prompt"
              color={EMBRY.accent}
              onClick={handleOptimize}
              loading={optimizing}
            />
            <ActionBtn
              label="Eval"
              tooltip="Run /prompt-lab eval against ground truth"
              color={EMBRY.green}
              onClick={handleEval}
              loading={evaling}
            />
            <ActionBtn
              label="Diff"
              tooltip="Show red/green diff against previous version"
              color={EMBRY.blue}
              onClick={handleDiff}
            />
            <ActionBtn
              label="Save Version"
              tooltip="Save current text as new version"
              color={EMBRY.dim}
              onClick={handleSaveVersion}
            />
          </div>
          <span style={{ fontSize: 10, color: EMBRY.dim }}>{prompt.length} chars</span>
        </div>
      </div>
    </div>
  )
}

function computeDiff(from: string, to: string) {
  const fromLines = from.split('\n')
  const toLines = to.split('\n')
  const result: { type: 'add' | 'remove' | 'same'; text: string }[] = []

  const fromSet = new Set(fromLines)
  const toSet = new Set(toLines)

  const maxLen = Math.max(fromLines.length, toLines.length)
  let fi = 0, ti = 0
  while (fi < fromLines.length || ti < toLines.length) {
    if (fi < fromLines.length && ti < toLines.length && fromLines[fi] === toLines[ti]) {
      result.push({ type: 'same', text: fromLines[fi] })
      fi++; ti++
    } else if (fi < fromLines.length && !toSet.has(fromLines[fi])) {
      result.push({ type: 'remove', text: fromLines[fi] })
      fi++
    } else if (ti < toLines.length && !fromSet.has(toLines[ti])) {
      result.push({ type: 'add', text: toLines[ti] })
      ti++
    } else {
      // Mismatch: show both
      if (fi < fromLines.length) {
        result.push({ type: 'remove', text: fromLines[fi] })
        fi++
      }
      if (ti < toLines.length) {
        result.push({ type: 'add', text: toLines[ti] })
        ti++
      }
    }
    if (result.length > maxLen + 50) break // safety
  }
  return result
}
