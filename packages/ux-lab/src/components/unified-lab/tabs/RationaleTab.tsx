import { useMemo, useState } from 'react'
import { EMBRY, card, label } from '../../sparta/common/EmbryStyle'
import { EvalGrid } from '../components/EvalGrid'
import { PromptEditor } from '../components/PromptEditor'
import { GatesStrip } from '../components/GatesStrip'
import { ReasoningToast } from '../components/ReasoningToast'
import { mockEvalData } from '../data/mockEvalData'

type Layout = 'split' | 'grid-only' | 'prompt-only'

export function RationaleTab() {
  const [layout, setLayout] = useState<Layout>('split')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [judgeModel, setJudgeModel] = useState('gemini/gemini-2.5-flash')

  const stats = useMemo(() => {
    const allCells = mockEvalData.flatMap((r) => Object.values(r.cells))
    const total = allCells.length
    if (total === 0) return { passRate: '0%', grounded: '0%', avgLatency: '0ms', testCases: '0' }
    const passRate = Math.round((allCells.filter((c) => c.pass).length / total) * 100)
    const groundedRate = Math.round((allCells.filter((c) => c.grounded).length / total) * 100)
    const avgLatency = Math.round(allCells.reduce((s, c) => s + c.latencyMs, 0) / total)
    return {
      passRate: `${passRate}%`,
      grounded: `${groundedRate}%`,
      avgLatency: `${avgLatency}ms`,
      testCases: String(mockEvalData.length),
    }
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        gap: 12,
        padding: 16,
        overflow: 'hidden',
      }}
    >
      <ReasoningToast message="Evaluating 5 test cases across 3 models. Checking grounding against SPARTA controls database. 2 failures detected in DeepSeek-V3 outputs." />

      {/* Controls bar: gates, judge model, layout toggle */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...label }}>Quality Gates</span>
        <GatesStrip />

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Judge model selector */}
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: EMBRY.dim }}>
            Judge:
          </span>
          <input
            type="text"
            value={judgeModel}
            onChange={(e) => setJudgeModel(e.target.value)}
            placeholder="judge model (litellm)"
            style={{
              backgroundColor: EMBRY.bgPanel,
              border: `1px solid ${EMBRY.border}`,
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 11,
              color: EMBRY.accent,
              outline: 'none',
              width: 180,
            }}
          />

          {/* Layout toggle buttons */}
          <div style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
            {([
              { id: 'grid-only' as Layout, icon: '|||', tip: 'Grid only' },
              { id: 'split' as Layout, icon: '||:', tip: 'Split view' },
              { id: 'prompt-only' as Layout, icon: ':', tip: 'Prompt only' },
            ]).map((l) => (
              <button
                key={l.id}
                title={l.tip}
                onClick={() => setLayout(l.id)}
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: `1px solid ${layout === l.id ? EMBRY.accent : EMBRY.border}`,
                  backgroundColor: layout === l.id ? `${EMBRY.accent}20` : 'transparent',
                  color: layout === l.id ? EMBRY.accent : EMBRY.dim,
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                }}
              >
                {l.icon}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div style={{ display: 'flex', gap: 12, flex: 1, overflow: 'hidden' }}>
        {layout !== 'prompt-only' && (
          <div style={{ ...card, flex: 2, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ ...label, marginBottom: 8 }}>Eval Grid</div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <EvalGrid systemPrompt={systemPrompt} judgeModel={judgeModel} />
            </div>
          </div>
        )}

        {layout !== 'grid-only' && (
          <div
            style={{
              ...card,
              flex: layout === 'prompt-only' ? 1 : 1,
              display: 'flex',
              flexDirection: 'column',
              minWidth: layout === 'split' ? 300 : undefined,
            }}
          >
            <div style={{ ...label, marginBottom: 8 }}>Prompt Editor</div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <PromptEditor
                collapsed={false}
                onPromptChange={setSystemPrompt}
              />
            </div>
          </div>
        )}
      </div>

      {/* Bottom stats bar */}
      <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
        <div
          style={{
            ...card,
            flex: 1,
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            padding: 12,
          }}
        >
          <Stat label="Pass Rate" value={stats.passRate} color={EMBRY.green} />
          <Stat label="Grounded" value={stats.grounded} color={EMBRY.blue} />
          <Stat label="Avg Latency" value={stats.avgLatency} color={EMBRY.amber} />
          <Stat label="Test Cases" value={stats.testCases} color={EMBRY.white} />
          <div style={{ marginLeft: 'auto', fontSize: 10, color: EMBRY.dim }}>
            Judge: <span style={{ color: EMBRY.accent }}>{judgeModel}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label: lbl, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: EMBRY.dim }}>
        {lbl}
      </div>
      <div style={{ fontSize: 18, fontWeight: 900, color }}>{value}</div>
    </div>
  )
}
