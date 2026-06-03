/** Split worker reasoning text into display steps (paragraphs or list lines). */
export function parseReasoningSteps(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const paragraphs = trimmed.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean)
  if (paragraphs.length > 1) return paragraphs

  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean)
  const listLike = lines.filter((l) => /^(-|\*|\d+[.)])\s+/.test(l))
  if (listLike.length >= 2 && listLike.length === lines.length) {
    return listLike.map((l) => l.replace(/^(-|\*|\d+[.)])\s+/, ''))
  }

  if (lines.length > 1) return lines
  return [trimmed]
}

export function reasoningPreview(steps: string[], maxChars = 140): string {
  if (steps.length === 0) return ''
  const joined = steps.join(' · ')
  if (joined.length <= maxChars) return joined
  return `${joined.slice(0, maxChars).trimEnd()}…`
}
