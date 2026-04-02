import { useMemo, useState } from 'react'
import { EMBRY } from '../../common/EmbryStyle'

type ChangeDirection = 'up' | 'down'

interface GateDot {
  name: string
  pass: boolean | null
}

interface VerdictSnapshot {
  verdict: string
  gatesPassed: number
  gatesTotal: number
  gates: GateDot[]
}

interface DriftResponseShape {
  previous_verdict?: unknown
  current_verdict?: unknown
  previous?: unknown
  current?: unknown
  affected_control_ids?: unknown
  control_ids?: unknown
  changed_gates?: unknown
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace'

function asString(value: unknown, fallback = 'unknown'): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback
}

function asGateSummary(value: unknown): GateDot[] {
  if (Array.isArray(value)) {
    return value.map((item, idx) => {
      if (typeof item === 'object' && item !== null) {
        const record = item as Record<string, unknown>
        const status = record.status ?? record.result ?? record.pass ?? record.ok
        const statusStr = String(status ?? '').toLowerCase()
        const pass = statusStr.includes('pass') || statusStr === 'true' || status === true
        const fail = statusStr.includes('fail') || statusStr === 'false' || status === false
        return {
          name: asString(record.name ?? record.gate, `gate-${idx + 1}`),
          pass: pass ? true : fail ? false : null,
        }
      }
      const itemStr = String(item ?? '')
      const lower = itemStr.toLowerCase()
      return {
        name: itemStr || `gate-${idx + 1}`,
        pass: lower.includes('pass') ? true : lower.includes('fail') ? false : null,
      }
    })
  }

  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>).map(([name, status]) => {
      const statusStr = String(status ?? '').toLowerCase()
      const pass = statusStr.includes('pass') || statusStr === 'true' || status === true
      const fail = statusStr.includes('fail') || statusStr === 'false' || status === false
      return { name, pass: pass ? true : fail ? false : null }
    })
  }

  if (typeof value === 'string') {
    return value
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part, idx) => {
        const [left, right] = part.split(':')
        const statusStr = String(right ?? part).toLowerCase()
        const pass = statusStr.includes('pass') || statusStr.includes('ok')
        const fail = statusStr.includes('fail')
        return { name: left?.trim() || `gate-${idx + 1}`, pass: pass ? true : fail ? false : null }
      })
  }

  return []
}

function parseSnapshot(source: unknown, fallbackVerdict: unknown): VerdictSnapshot {
  if (typeof source === 'object' && source !== null) {
    const record = source as Record<string, unknown>
    const gates = asGateSummary(record.gate_summary ?? record.gates ?? record.trace)
    const gatesPassedRaw = record.gates_passed ?? record.passed ?? record.pass_count
    const gatesTotalRaw = record.gates_total ?? record.total ?? gates.length
    const gatesPassed = typeof gatesPassedRaw === 'number'
      ? gatesPassedRaw
      : gates.filter((gate) => gate.pass === true).length
    const gatesTotal = typeof gatesTotalRaw === 'number' ? gatesTotalRaw : gates.length

    return {
      verdict: asString(record.verdict ?? fallbackVerdict),
      gatesPassed,
      gatesTotal,
      gates,
    }
  }

  return {
    verdict: asString(fallbackVerdict),
    gatesPassed: 0,
    gatesTotal: 0,
    gates: [],
  }
}

function parseControlIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item)).filter(Boolean)
  }
  return []
}

function parseDriftPayload(raw: unknown): {
  previous: VerdictSnapshot
  current: VerdictSnapshot
  affectedControlIds: string[]
  changedGates: Set<string>
} {
  const base = (raw ?? {}) as DriftResponseShape
  const previous = parseSnapshot(base.previous, base.previous_verdict)
  const current = parseSnapshot(base.current, base.current_verdict)

  const changedFromPayload = Array.isArray(base.changed_gates)
    ? new Set(base.changed_gates.map((gate) => String(gate)))
    : new Set<string>()

  if (changedFromPayload.size === 0) {
    const previousMap = new Map(previous.gates.map((gate) => [gate.name, gate.pass]))
    const currentMap = new Map(current.gates.map((gate) => [gate.name, gate.pass]))
    const all = new Set([...previousMap.keys(), ...currentMap.keys()])
    all.forEach((name) => {
      if (previousMap.get(name) !== currentMap.get(name)) changedFromPayload.add(name)
    })
  }

  return {
    previous,
    current,
    affectedControlIds: parseControlIds(base.affected_control_ids ?? base.control_ids),
    changedGates: changedFromPayload,
  }
}

function verdictColor(verdict: string): string {
  const lower = verdict.toLowerCase()
  if (lower.includes('support') || lower.includes('pass')) return EMBRY.green
  if (lower.includes('refut') || lower.includes('fail')) return EMBRY.red
  return EMBRY.amber
}

function buildDirectionMap(previous: VerdictSnapshot, current: VerdictSnapshot): Map<string, ChangeDirection> {
  const previousMap = new Map(previous.gates.map((gate) => [gate.name, gate.pass]))
  const currentMap = new Map(current.gates.map((gate) => [gate.name, gate.pass]))
  const all = new Set([...previousMap.keys(), ...currentMap.keys()])
  const output = new Map<string, ChangeDirection>()
  all.forEach((name) => {
    const prev = previousMap.get(name)
    const curr = currentMap.get(name)
    if (prev === curr) return
    if (prev === false && curr === true) output.set(name, 'up')
    else output.set(name, 'down')
  })
  return output
}

export function DriftView() {
  const [controlInput, setControlInput] = useState('AC-1, AC-2')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ReturnType<typeof parseDriftPayload> | null>(null)

  const directionMap = useMemo(() => {
    if (!data) return new Map<string, ChangeDirection>()
    return buildDirectionMap(data.previous, data.current)
  }, [data])

  const controlIds = useMemo(() => {
    return controlInput
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  }, [controlInput])

  const runDrift = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('http://localhost:3001/api/evidence-case/drift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ control_ids: controlIds }),
      })
      if (!response.ok) {
        throw new Error(`Drift request failed (${response.status})`)
      }
      const payload: unknown = await response.json()
      setData(parseDriftPayload(payload))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const renderColumn = (title: string, snapshot: VerdictSnapshot, isCurrent: boolean) => {
    return (
      <div style={{
        backgroundColor: EMBRY.bgCard,
        border: `1px solid ${EMBRY.border}`,
        borderRadius: 10,
        padding: 14,
        minHeight: 190,
      }}>
        <div style={{ color: EMBRY.dim, fontSize: 11, marginBottom: 10 }}>{title}</div>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          border: `1px solid ${verdictColor(snapshot.verdict)}66`,
          backgroundColor: `${verdictColor(snapshot.verdict)}1f`,
          color: verdictColor(snapshot.verdict),
          fontSize: 11,
          borderRadius: 999,
          padding: '3px 9px',
          marginBottom: 10,
        }}>
          {snapshot.verdict}
        </div>
        <div style={{ color: EMBRY.white, fontSize: 12, marginBottom: 12 }}>
          Gates: {snapshot.gatesPassed}/{snapshot.gatesTotal}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {snapshot.gates.map((gate) => {
            const changed = data?.changedGates.has(gate.name) ?? false
            const direction = directionMap.get(gate.name)
            const baseColor = gate.pass === true ? EMBRY.green : gate.pass === false ? EMBRY.red : EMBRY.dim
            const borderColor = !changed
              ? EMBRY.border
              : isCurrent
                ? direction === 'up' ? EMBRY.green : EMBRY.red
                : direction === 'up' ? EMBRY.red : EMBRY.green

            return (
              <span
                key={`${title}-${gate.name}`}
                title={`${gate.name}: ${gate.pass === true ? 'pass' : gate.pass === false ? 'fail' : 'unknown'}`}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  border: `2px solid ${borderColor}`,
                  backgroundColor: `${baseColor}55`,
                  display: 'inline-block',
                }}
              />
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, color: EMBRY.white }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={controlInput}
          onChange={(event) => setControlInput(event.target.value)}
          placeholder="Control IDs (comma separated)"
          style={{
            flex: 1,
            backgroundColor: EMBRY.bgCard,
            border: `1px solid ${EMBRY.border}`,
            color: EMBRY.white,
            borderRadius: 8,
            padding: '10px 12px',
            fontFamily: MONO,
            fontSize: 12,
          }}
        />
        <button
          type="button"
          onClick={runDrift}
          disabled={loading || controlIds.length === 0}
          style={{
            border: `1px solid ${EMBRY.border}`,
            backgroundColor: EMBRY.bgCard,
            color: EMBRY.white,
            borderRadius: 8,
            padding: '10px 12px',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Running...' : 'Run Drift'}
        </button>
      </div>

      {error && (
        <div style={{
          backgroundColor: `${EMBRY.red}15`,
          border: `1px solid ${EMBRY.red}66`,
          color: EMBRY.red,
          borderRadius: 8,
          padding: 10,
          marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {renderColumn('Previous verdict', data.previous, false)}
            {renderColumn('Current verdict', data.current, true)}
          </div>
          <div style={{
            marginTop: 12,
            backgroundColor: EMBRY.bgCard,
            border: `1px solid ${EMBRY.border}`,
            borderRadius: 10,
            padding: 12,
          }}>
            <div style={{ color: EMBRY.dim, fontSize: 11, marginBottom: 8 }}>Affected control_ids</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {data.affectedControlIds.length === 0 && <span style={{ color: EMBRY.dim }}>none</span>}
              {data.affectedControlIds.map((controlId) => (
                <span
                  key={controlId}
                  style={{
                    border: `1px solid ${EMBRY.border}`,
                    backgroundColor: EMBRY.bg,
                    borderRadius: 999,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontFamily: MONO,
                    color: EMBRY.white,
                  }}
                >
                  {controlId}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
