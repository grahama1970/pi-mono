export function formatAgo(ms: number, now = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - ms) / 1000))
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

/** Sidebar/header label — keep full `otr-…` id so it matches Load run and the API. */
export function runTitleFromId(runId: string): string {
  const id = runId.trim()
  return id || runId
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/** Human-readable harness / verify label from dag_node_id. */
export function humanizeRunLabel(dag: string): string {
  const trimmed = dag.trim()
  if (!trimmed) return ''

  const attempt = trimmed.match(/-attempt-(\d+)-(.+)$/i)
  if (attempt) {
    const phase = attempt[2].replace(/_/g, ' ')
    return `Attempt ${attempt[1]} · ${titleCaseWords(phase)}`
  }

  if (trimmed.startsWith('transport-verify-')) {
    const rest = trimmed.replace(/^transport-verify-/, '').replace(/[-_]/g, ' ')
    return titleCaseWords(`Verify ${rest}`)
  }

  const segments = trimmed.split(/[-_]/).filter(Boolean)
  if (segments.length >= 3) {
    const tail = segments.slice(-2).join(' ').replace(/_/g, ' ')
    return titleCaseWords(tail)
  }

  return titleCaseWords(trimmed.replace(/[-_]/g, ' '))
}

/** Sidebar primary label: DAG/harness name when known, else short run id. */
export function runDisplayName(row: {
  transport_run_id: string
  dag_node_id?: string
  title?: string
}): string {
  const custom = row.title?.trim()
  if (custom && !custom.toUpperCase().startsWith('DAG ')) return custom

  const dag = row.dag_node_id?.trim()
  if (dag) return humanizeRunLabel(dag)

  const id = row.transport_run_id.trim()
  const tail = id.replace(/^otr-/, '')
  if (tail.length >= 8) return `Run ${tail.slice(0, 8)}`
  return id || 'Transport run'
}

