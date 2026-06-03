import { apiUrl } from '../../../lib/apiBase'

const TRANSPORT_API_PREFIX = '/scillm/v1/scillm/opencode/transport'

/** Resolve a transport artifact URL for inline browser preview (img src). */
export function transportArtifactPreviewUrl(
  figure: { artifact_url?: string; artifact_name?: string },
  transportRunId: string,
): string | undefined {
  const raw = typeof figure.artifact_url === 'string' ? figure.artifact_url.trim() : ''
  if (raw) {
    if (/^https?:\/\//i.test(raw)) return raw
    const suffix = raw.startsWith('/v1/scillm/opencode/transport')
      ? raw.replace('/v1/scillm/opencode/transport', TRANSPORT_API_PREFIX)
      : raw.startsWith(TRANSPORT_API_PREFIX)
        ? raw
        : `${TRANSPORT_API_PREFIX}${raw.startsWith('/') ? raw : `/${raw}`}`
    return apiUrl(suffix)
  }
  const name = typeof figure.artifact_name === 'string' ? figure.artifact_name.trim() : ''
  if (name && transportRunId) {
    return apiUrl(
      `${TRANSPORT_API_PREFIX}/runs/${encodeURIComponent(transportRunId)}/artifacts/${encodeURIComponent(name)}`,
    )
  }
  return undefined
}

export function figureSupportsInlinePreview(format: string): boolean {
  return format === 'png' || format === 'jpeg' || format === 'webp' || format === 'svg'
}
