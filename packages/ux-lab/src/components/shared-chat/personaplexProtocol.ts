export type PersonaPlexChatMode = 'personaplex' | 'compliance'

export type PersonaPlexRealFlagName =
  | 'real_deepgram_asr'
  | 'real_turn_gate'
  | 'real_memory_intent'
  | 'real_memory_recall'
  | 'real_evidence_case'
  | 'real_gpu_personaplex'
  | 'real_memory_upsert'
  | 'real_session_compaction'
  | 'real_personaplex_ws'

export interface SpeechFinalEnvelope {
  type: 'speech_final'
  session_id: string
  text: string
  persona_id: string
  turn_id: number
}

export interface PersonaPlexSpeechFinalOptions {
  wsUrl?: string
  sessionId?: string
  personaId?: string
  turnId?: number
  timeoutMs?: number
  WebSocketCtor?: typeof WebSocket
  onEvent?: (event: PersonaPlexServerEvent) => void
}

export interface PersonaPlexServerEvent {
  type: string
  stage?: string
  status?: string
  text?: string
  transcript?: string
  answer?: string
  response?: string
  audio_url?: string
  audioUrl?: string
  real_flags?: Partial<Record<PersonaPlexRealFlagName | string, boolean>>
  scores?: Record<string, number>
  verdict?: string
  error?: string
  payload?: Record<string, unknown>
  tool_name?: string
  endpoint?: string
  raw?: unknown
}

export interface PersonaPlexSendResult {
  sent: boolean
  real_personaplex_ws: boolean
  generatedOutputReceived: boolean
  generatedText?: string
  audioUrl?: string
  events: PersonaPlexServerEvent[]
  error?: string
}

export interface PersonaPlexTraceRow {
  id: string
  label: string
  status: 'pending' | 'running' | 'ok' | 'failed' | 'fallback'
  realFlag: PersonaPlexRealFlagName | string
  real: boolean
  detail?: string
}

export const DEFAULT_PERSONAPLEX_WS_URL = 'ws://127.0.0.1:8788/ws'
export const DEFAULT_PERSONAPLEX_PERSONA_ID = 'embry'

export function makeSessionId(prefix = 'personaplex-ui'): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now()}-${random}`
}

export function buildSpeechFinalMessage(input: {
  sessionId: string
  text: string
  personaId?: string
  turnId?: number
}): SpeechFinalEnvelope {
  const text = input.text.trim()
  if (!text) {
    throw new Error('speech_final text must not be empty')
  }
  return {
    type: 'speech_final',
    session_id: input.sessionId,
    text,
    persona_id: input.personaId ?? DEFAULT_PERSONAPLEX_PERSONA_ID,
    turn_id: input.turnId ?? 1,
  }
}

function parseServerEvent(data: MessageEvent['data']): PersonaPlexServerEvent {
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as PersonaPlexServerEvent
      return { ...parsed, raw: parsed }
    } catch {
      return { type: 'text', text: data, raw: data }
    }
  }
  if (data instanceof Blob) {
    return { type: 'binary_audio', status: 'received', raw: data }
  }
  return { type: 'unknown', raw: data }
}

export function extractGeneratedText(event: PersonaPlexServerEvent): string | undefined {
  const payload = event.payload
  const payloadCandidates = payload && typeof payload === 'object'
      ? [payload.speakable_text, payload.spoken_text, payload.answer, payload.response, payload.text]
      : []
  const payloadText = payloadCandidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const candidates = [payloadText, event.answer, event.response, event.text, event.transcript]
  return candidates.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim()
}

export function extractAudioUrl(event: PersonaPlexServerEvent): string | undefined {
  const value = event.audio_url ?? event.audioUrl
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function traceRowsFromEvents(events: PersonaPlexServerEvent[]): PersonaPlexTraceRow[] {
  const rows = new Map<string, PersonaPlexTraceRow>()
  const seed: Array<[PersonaPlexRealFlagName, string]> = [
    ['real_personaplex_ws', 'PersonaPlex WebSocket'],
    ['real_turn_gate', 'Turn gate'],
    ['real_memory_intent', 'Memory intent'],
    ['real_memory_recall', 'Recall scores'],
    ['real_evidence_case', 'Evidence verdict'],
    ['real_gpu_personaplex', 'GPU PersonaPlex'],
    ['real_memory_upsert', 'Persistence upsert'],
    ['real_session_compaction', 'Session compaction'],
  ]
  for (const [flag, label] of seed) {
    rows.set(flag, {
      id: flag,
      label,
      status: 'pending',
      realFlag: flag,
      real: false,
      detail: 'waiting',
    })
  }
  for (const event of events) {
    const flags = event.real_flags ?? {}
    for (const [flag, real] of Object.entries(flags)) {
      rows.set(flag, {
        id: flag,
        label: flag.replace(/^real_/, '').replaceAll('_', ' '),
        status: real ? 'ok' : 'fallback',
        realFlag: flag,
        real: Boolean(real),
        detail: event.verdict ?? event.status ?? event.stage ?? event.type,
      })
    }
    if (event.type === 'grounding_stage_complete' || event.status === 'complete') {
      const stage = String(event.stage ?? event.endpoint ?? event.tool_name ?? '')
      const stageFlags: Array<[PersonaPlexRealFlagName, boolean]> = []
      if (stage.includes('intent')) stageFlags.push(['real_memory_intent', true])
      if (stage.includes('recall')) stageFlags.push(['real_memory_recall', true])
      if (stage.includes('evidence')) stageFlags.push(['real_evidence_case', true])
      if (stage.includes('answer') || stage.includes('clarify') || stage.includes('deflect') || stage.includes('voice_output')) {
        stageFlags.push(['real_turn_gate', true])
      }
      if (stage.includes('voice_output')) stageFlags.push(['real_gpu_personaplex', true])
      for (const [flag, real] of stageFlags) {
        rows.set(flag, {
          id: flag,
          label: flag.replace(/^real_/, '').replaceAll('_', ' '),
          status: real ? 'ok' : 'fallback',
          realFlag: flag,
          real,
          detail: event.status ?? event.stage ?? event.type,
        })
      }
    }
    if (event.type === 'personaplex_turn_complete') {
      const ok = Boolean(event.payload && (event.payload as Record<string, unknown>).ok)
      rows.set('real_turn_gate', {
        id: 'real_turn_gate',
        label: 'turn gate',
        status: ok ? 'ok' : 'failed',
        realFlag: 'real_turn_gate',
        real: ok,
        detail: ok ? 'turn complete' : String(event.error ?? 'turn failed'),
      })
    }
    const stageKey = event.stage ?? event.type
    if (stageKey && stageKey !== 'unknown') {
      const existing = rows.get(stageKey)
      rows.set(stageKey, {
        id: stageKey,
        label: stageKey.replaceAll('_', ' '),
        status: event.status === 'error' ? 'failed' : 'ok',
        realFlag: `real_${stageKey}`,
        real: Object.values(flags).some(Boolean),
        detail: event.verdict ?? event.status ?? extractGeneratedText(event) ?? undefined,
      })
      if (existing?.real) {
        rows.set(stageKey, { ...rows.get(stageKey)!, real: true })
      }
    }
  }
  return [...rows.values()]
}

export async function sendPersonaPlexSpeechFinalBestEffort(
  text: string,
  options: PersonaPlexSpeechFinalOptions = {},
): Promise<PersonaPlexSendResult> {
  const events: PersonaPlexServerEvent[] = []
  const WebSocketImpl = options.WebSocketCtor ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined)
  if (!WebSocketImpl) {
    return {
      sent: false,
      real_personaplex_ws: false,
      generatedOutputReceived: false,
      events,
      error: 'WebSocket is not available in this runtime',
    }
  }

  const envelope = buildSpeechFinalMessage({
    sessionId: options.sessionId ?? makeSessionId(),
    text,
    personaId: options.personaId,
    turnId: options.turnId,
  })

  const wsUrl = options.wsUrl ?? DEFAULT_PERSONAPLEX_WS_URL
  const timeoutMs = options.timeoutMs ?? 30000

  return await new Promise<PersonaPlexSendResult>((resolve) => {
    let settled = false
    let sent = false
    let generatedText: string | undefined
    let audioUrl: string | undefined
    const finish = (result: Partial<PersonaPlexSendResult> = {}) => {
      if (settled) return
      settled = true
      try {
        socket.close()
      } catch {
        // Ignore close failures.
      }
      resolve({
        sent,
        real_personaplex_ws: sent && !result.error,
        generatedOutputReceived: Boolean(generatedText || audioUrl),
        generatedText,
        audioUrl,
        events,
        ...result,
      })
    }

    const timer = globalThis.setTimeout(() => {
      finish({ error: generatedText || audioUrl ? undefined : `PersonaPlex WS timed out after ${timeoutMs}ms` })
    }, timeoutMs)

    const socket = new WebSocketImpl(wsUrl)
    socket.onopen = () => {
      sent = true
      socket.send(JSON.stringify(envelope))
      const openEvent: PersonaPlexServerEvent = {
        type: 'speech_final_sent',
        status: 'ok',
        real_flags: { real_personaplex_ws: true },
        text: envelope.text,
      }
      events.push(openEvent)
      options.onEvent?.(openEvent)
    }
    socket.onerror = () => {
      globalThis.clearTimeout(timer)
      finish({ error: `PersonaPlex WS connection failed: ${wsUrl}`, real_personaplex_ws: false })
    }
    socket.onmessage = (message) => {
      const event = parseServerEvent(message.data)
      events.push(event)
      options.onEvent?.(event)
      const maybeText = extractGeneratedText(event)
      if (maybeText) generatedText = maybeText
      const maybeAudioUrl = extractAudioUrl(event)
      if (maybeAudioUrl) audioUrl = maybeAudioUrl
      if (event.type === 'personaplex_turn_complete' || event.type === 'assistant_response' || event.type === 'answer' || (event.status === 'complete' && event.stage === 'voice_output') || audioUrl) {
        globalThis.clearTimeout(timer)
        finish()
      }
    }
    socket.onclose = () => {
      globalThis.clearTimeout(timer)
      finish({ error: generatedText || audioUrl || sent ? undefined : 'PersonaPlex WS closed before speech_final was accepted' })
    }
  })
}
