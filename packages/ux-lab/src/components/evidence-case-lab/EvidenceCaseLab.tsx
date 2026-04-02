import { useMemo, useState } from 'react'
import {
  Shield,
  AlertTriangle,
  TrendingDown,
  Activity,
  FlaskConical,
  RefreshCw,
} from 'lucide-react'
import { EMBRY } from '../../common/EmbryStyle'
import { DriftView } from './DriftView'
import { StressTestView } from './StressTestView'

type TabMode = 'evaluate' | 'drift' | 'stress'

interface ChatMessage {
  id: number
  role: 'user'
  text: string
}

interface GateTraceRow {
  gate: string
  status: string
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace'

function asGateTrace(payload: unknown): GateTraceRow[] {
  if (typeof payload !== 'object' || payload === null) return []
  const record = payload as Record<string, unknown>
  const raw = record.gate_trace ?? record.trace ?? record.gates ?? record.gate_summary

  if (Array.isArray(raw)) {
    return raw.map((item, index) => {
      if (typeof item === 'object' && item !== null) {
        const gate = item as Record<string, unknown>
        return {
          gate: String(gate.gate ?? gate.name ?? `gate-${index + 1}`),
          status: String(gate.status ?? gate.result ?? gate.pass ?? 'unknown'),
        }
      }
      const text = String(item)
      const [left, right] = text.split(':')
      return {
        gate: left?.trim() || `gate-${index + 1}`,
        status: right?.trim() || text,
      }
    })
  }

  if (typeof raw === 'object' && raw !== null) {
    return Object.entries(raw as Record<string, unknown>).map(([gate, status]) => ({
      gate,
      status: String(status),
    }))
  }

  if (typeof raw === 'string') {
    return raw
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part, index) => {
        const [left, right] = part.split(':')
        return {
          gate: left?.trim() || `gate-${index + 1}`,
          status: right?.trim() || part,
        }
      })
  }

  return []
}

export default function EvidenceCaseLab() {
  const [activeTab, setActiveTab] = useState<TabMode>('evaluate')
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [evaluateLoading, setEvaluateLoading] = useState(false)
  const [evaluateError, setEvaluateError] = useState<string | null>(null)
  const [gateTrace, setGateTrace] = useState<GateTraceRow[]>([])

  const sendMessage = () => {
    const text = chatInput.trim()
    if (!text) return
    setChatMessages((prev) => [...prev, { id: Date.now(), role: 'user', text }])
    setQuestion(text)
    setChatInput('')
  }

  const runEvaluate = async () => {
    if (!question.trim()) return
    setEvaluateLoading(true)
    setEvaluateError(null)
    try {
      const response = await fetch('http://localhost:3001/api/evidence-case/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      if (!response.ok) {
        throw new Error(`Evaluate request failed (${response.status})`)
      }
      const payload: unknown = await response.json()
      setGateTrace(asGateTrace(payload))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setEvaluateError(message)
      setGateTrace([])
    } finally {
      setEvaluateLoading(false)
    }
  }

  const tabs = useMemo(() => ([
    { key: 'evaluate' as const, label: 'Evaluate', icon: Activity },
    { key: 'drift' as const, label: 'Drift', icon: TrendingDown },
    { key: 'stress' as const, label: 'Stress Test', icon: FlaskConical },
  ]), [])

  return (
    <div style={{
      display: 'flex',
      height: '100%',
      minHeight: 640,
      backgroundColor: '#141414',
      color: EMBRY.white,
      border: `1px solid ${EMBRY.border}`,
    }}>
      <aside style={{
        width: 320,
        borderRight: `1px solid ${EMBRY.border}`,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#1a1a1a',
      }}>
        <div style={{ padding: 12, borderBottom: `1px solid ${EMBRY.border}`, fontWeight: 700 }}>
          Chat
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {chatMessages.map((message) => (
            <div key={message.id} style={{
              backgroundColor: EMBRY.bg,
              border: `1px solid ${EMBRY.border}`,
              borderRadius: 8,
              padding: 10,
              fontSize: 12,
            }}>
              {message.text}
            </div>
          ))}
        </div>
        <div style={{ padding: 12, borderTop: `1px solid ${EMBRY.border}`, display: 'flex', gap: 8 }}>
          <input
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') sendMessage() }}
            placeholder="Ask a question..."
            style={{
              flex: 1,
              backgroundColor: EMBRY.bg,
              border: `1px solid ${EMBRY.border}`,
              color: EMBRY.white,
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 12,
            }}
          />
          <button
            type="button"
            onClick={sendMessage}
            style={{
              backgroundColor: EMBRY.bg,
              border: `1px solid ${EMBRY.border}`,
              color: EMBRY.white,
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Send
          </button>
        </div>
      </aside>

      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 12,
          borderBottom: `1px solid ${EMBRY.border}`,
          backgroundColor: '#1a1a1a',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
            <Shield size={16} color={EMBRY.green} />
            Evidence Case Lab
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {tabs.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    border: `1px solid ${active ? EMBRY.blue : EMBRY.border}`,
                    backgroundColor: active ? `${EMBRY.blue}1f` : EMBRY.bg,
                    color: active ? EMBRY.blue : EMBRY.white,
                    borderRadius: 8,
                    padding: '7px 10px',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </header>

        <div style={{ flex: 1, overflow: 'auto', backgroundColor: '#141414' }}>
          {activeTab === 'evaluate' && (
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Question"
                  style={{
                    flex: 1,
                    backgroundColor: '#1a1a1a',
                    border: `1px solid ${EMBRY.border}`,
                    color: EMBRY.white,
                    borderRadius: 8,
                    padding: '10px 12px',
                    fontSize: 13,
                  }}
                />
                <button
                  type="button"
                  onClick={runEvaluate}
                  disabled={evaluateLoading || !question.trim()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    backgroundColor: '#1a1a1a',
                    border: `1px solid ${EMBRY.border}`,
                    color: EMBRY.white,
                    borderRadius: 8,
                    padding: '10px 12px',
                    cursor: evaluateLoading ? 'wait' : 'pointer',
                  }}
                >
                  <RefreshCw size={14} />
                  {evaluateLoading ? 'Running...' : 'Run'}
                </button>
              </div>

              {evaluateError && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  border: `1px solid ${EMBRY.red}66`,
                  backgroundColor: `${EMBRY.red}15`,
                  color: EMBRY.red,
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 12,
                }}>
                  <AlertTriangle size={14} />
                  {evaluateError}
                </div>
              )}

              <div style={{
                backgroundColor: '#1a1a1a',
                border: `1px solid ${EMBRY.border}`,
                borderRadius: 10,
                overflow: 'hidden',
              }}>
                <div style={{ padding: '10px 12px', borderBottom: `1px solid ${EMBRY.border}`, color: EMBRY.dim, fontSize: 11 }}>
                  Gate trace
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: EMBRY.bg }}>
                      <th style={{ textAlign: 'left', padding: 8, fontSize: 12 }}>Gate</th>
                      <th style={{ textAlign: 'left', padding: 8, fontSize: 12 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gateTrace.map((row, index) => (
                      <tr key={`${row.gate}-${index}`}>
                        <td style={{ padding: 8, borderTop: `1px solid ${EMBRY.border}`, fontFamily: MONO, fontSize: 12 }}>
                          {row.gate}
                        </td>
                        <td style={{
                          padding: 8,
                          borderTop: `1px solid ${EMBRY.border}`,
                          color: row.status.toLowerCase().includes('pass') ? EMBRY.green : row.status.toLowerCase().includes('fail') ? EMBRY.red : EMBRY.white,
                          fontSize: 12,
                        }}>
                          {row.status}
                        </td>
                      </tr>
                    ))}
                    {gateTrace.length === 0 && (
                      <tr>
                        <td colSpan={2} style={{ padding: 10, color: EMBRY.dim, fontSize: 12 }}>
                          No gate trace yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {activeTab === 'drift' && <DriftView />}
          {activeTab === 'stress' && <StressTestView />}
        </div>
      </section>
    </div>
  )
}
