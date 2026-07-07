export async function extractEntitiesForSpartaChatMessage(text: string): Promise<unknown | null> {
  try {
    const response = await fetch('/api/extract-entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        query: text,
        collection: 'sparta_controls',
        view: 'verbose',
        surface: 'sparta-explorer',
      }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}
