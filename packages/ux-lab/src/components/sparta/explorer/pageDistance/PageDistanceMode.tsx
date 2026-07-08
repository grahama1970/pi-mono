/**
 * Page-native distance modes (10ft / 5ft / lean-in) for Sparta Explorer tabs.
 * Single source of truth for Explorer + Ask Embry distance (10ft / 5ft / lean-in).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { TabName } from '../SpartaExplorer'

export type PageDistanceMode = '10ft' | '5ft' | 'lean-in'
export type PageDistanceSlug =
  | 'overview'
  | 'posture'
  | 'coverage'
  | 'threat-matrix'
  | 'controls'
  | 'qras'
  | 'sources'
  | 'urls'
  | 'relationships'
  | 'pipeline'
  | 'supply-chain'

const LEGACY_STORAGE: Partial<Record<PageDistanceSlug, string>> = {
  posture: 'sparta.posture.mode',
  coverage: 'sparta.coverage.mode',
}

const STORAGE_PREFIX = 'sparta.pageDistance.'
const GLOBAL_STORAGE_KEY = `${STORAGE_PREFIX}global`
export const EMBRY_IDLE_TO_10FT_MS = 270_000
export const EMBRY_VIEW_STATE_EVENT = 'sparta:embry-view-state'

type EmbryVoiceState = 'off' | 'idle' | 'listening' | 'processing' | 'speaking' | 'spoken' | 'error'

export const PAGE_DISTANCE_TABS: TabName[] = [
  'Controls',
  'QRAs',
  'Sources',
  'URLs',
  'Threat Matrix',
]

export function tabNameToSlug(tab: TabName): PageDistanceSlug {
  const map: Record<TabName, PageDistanceSlug> = {
    Overview: 'overview',
    Sources: 'sources',
    Controls: 'controls',
    URLs: 'urls',
    QRAs: 'qras',
    Relationships: 'relationships',
    'Threat Matrix': 'threat-matrix',
    Pipeline: 'pipeline',
  }
  return map[tab]
}

export function isPageDistanceMode(value: string | null | undefined): value is PageDistanceMode {
  return value === '10ft' || value === '5ft' || value === 'lean-in'
}

function storageKey(slug: PageDistanceSlug): string {
  return `${STORAGE_PREFIX}${slug}`
}

function readLegacy(slug: PageDistanceSlug): PageDistanceMode | null {
  const legacy = LEGACY_STORAGE[slug]
  if (!legacy || typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(legacy)
  return isPageDistanceMode(raw) ? raw : null
}

export function readStoredPageDistanceMode(slug: PageDistanceSlug, fallback: PageDistanceMode = '10ft'): PageDistanceMode {
  if (typeof window === 'undefined') return fallback
  const globalRaw = window.sessionStorage.getItem(GLOBAL_STORAGE_KEY)
  if (isPageDistanceMode(globalRaw)) return globalRaw
  const raw = window.sessionStorage.getItem(storageKey(slug))
  if (isPageDistanceMode(raw)) return raw
  const legacy = readLegacy(slug)
  if (legacy) return legacy
  return fallback
}

export function persistPageDistanceMode(slug: PageDistanceSlug, mode: PageDistanceMode): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(GLOBAL_STORAGE_KEY, mode)
  window.sessionStorage.setItem(storageKey(slug), mode)
  const legacy = LEGACY_STORAGE[slug]
  if (legacy) window.sessionStorage.setItem(legacy, mode)
}

export function inferPageDistanceFromViewport(): PageDistanceMode {
  if (typeof window === 'undefined') return '10ft'
  const w = window.innerWidth
  if (w >= 1440) return '10ft'
  if (w >= 1024) return '5ft'
  return '5ft'
}

const PAGE_DISTANCE_URL_KEYS = ['chatMode', 'pageMode', 'postureMode', 'coverageMode', 'threatMode'] as const

export type PageDistanceUrlSlug = 'glance' | 'triage' | 'drilldown'

const MODE_TO_URL_SLUG: Record<PageDistanceMode, PageDistanceUrlSlug> = {
  '10ft': 'glance',
  '5ft': 'triage',
  'lean-in': 'drilldown',
}

export function parseUrlPageMode(raw: string | null | undefined): PageDistanceMode | null {
  if (!raw) return null
  if (isPageDistanceMode(raw)) return raw
  if (raw === 'glance') return '10ft'
  if (raw === 'triage') return '5ft'
  if (raw === 'drilldown') return 'lean-in'
  return null
}

function readUrlPageMode(): PageDistanceMode | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  for (const key of PAGE_DISTANCE_URL_KEYS) {
    const parsed = parseUrlPageMode(params.get(key))
    if (parsed) return parsed
  }
  return null
}

/** Click → URL. One job. */
export function syncPageDistanceModeUrl(mode: PageDistanceMode): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('chatMode', MODE_TO_URL_SLUG[mode])
  window.history.replaceState(null, '', url)
}

type PageDistanceContextValue = {
  activeTab: TabName
  slug: PageDistanceSlug
  mode: PageDistanceMode
  setMode: (mode: PageDistanceMode) => void
  supportsPageDistance: boolean
}


function dispatchPageDistanceChange(slug: PageDistanceSlug, mode: PageDistanceMode): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('sparta:page-distance-changed', { detail: { slug, mode } }))
}

function dispatchEmbryViewState(mode: PageDistanceMode, source: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EMBRY_VIEW_STATE_EVENT, { detail: { mode, source } }))
}

export function setPageDistanceModeForTab(activeTab: TabName, mode: PageDistanceMode): void {
  const slug = tabNameToSlug(activeTab)
  persistPageDistanceMode(slug, mode)
  dispatchPageDistanceChange(slug, mode)
  syncPageDistanceModeUrl(mode)
}


export function usePageDistanceModeExternal(activeTab: TabName): PageDistanceMode {
  const slug = tabNameToSlug(activeTab)
  const fallback = slug === 'coverage' ? '5ft' : '10ft'
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined') return () => {}
      const handler = () => onStoreChange()
      window.addEventListener('sparta:page-distance-changed', handler)
      return () => window.removeEventListener('sparta:page-distance-changed', handler)
    },
    () => readStoredPageDistanceMode(slug, fallback),
    () => fallback,
  )
}

const PageDistanceContext = createContext<PageDistanceContextValue | null>(null)

export function PageDistanceProvider({
  activeTab,
  children,
}: {
  activeTab: TabName
  children: ReactNode
}) {
  const slug = tabNameToSlug(activeTab)
  const supportsPageDistance = PAGE_DISTANCE_TABS.includes(activeTab)
  const defaultMode = slug === 'coverage' ? '5ft' : '10ft'

  const [mode, setCurrentMode] = useState<PageDistanceMode>(() => {
    const urlMode = readUrlPageMode()
    return urlMode ?? readStoredPageDistanceMode(slug, defaultMode)
  })

  useEffect(() => {
    persistPageDistanceMode(slug, mode)
  }, [slug, mode])

  useEffect(() => {
    const onExternal = (evt: Event) => {
      const detail = (evt as CustomEvent<{ slug?: PageDistanceSlug; mode?: PageDistanceMode }>).detail
      if (!detail?.slug || !isPageDistanceMode(detail.mode)) return
      setCurrentMode(detail.mode)
    }
    window.addEventListener('sparta:page-distance-changed', onExternal)
    return () => window.removeEventListener('sparta:page-distance-changed', onExternal)
  }, [])

  const setMode = useCallback((next: PageDistanceMode) => {
    setCurrentMode(next)
    persistPageDistanceMode(slug, next)
    dispatchPageDistanceChange(slug, next)
    syncPageDistanceModeUrl(next)
  }, [slug])

  const setModeFromEmbry = useCallback((next: PageDistanceMode, source: string) => {
    setCurrentMode(next)
    persistPageDistanceMode(slug, next)
    dispatchPageDistanceChange(slug, next)
    syncPageDistanceModeUrl(next)
    dispatchEmbryViewState(next, source)
  }, [slug])

  useEffect(() => {
    let idleTimer: number | undefined

    const armIdleTimer = () => {
      if (idleTimer !== undefined) window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        setModeFromEmbry('10ft', 'idle-timeout')
      }, EMBRY_IDLE_TO_10FT_MS)
    }

    const handleKeyDown = () => {
      setModeFromEmbry('lean-in', 'keyboard')
      armIdleTimer()
    }

    const handlePointerActivity = () => {
      setModeFromEmbry('lean-in', 'pointer')
      armIdleTimer()
    }

    const handleVoiceState = (evt: Event) => {
      const detail = (evt as CustomEvent<{ state?: EmbryVoiceState; status?: EmbryVoiceState }>).detail
      const state = detail?.state ?? detail?.status
      if (state === 'listening' || state === 'processing' || state === 'speaking' || state === 'spoken') {
        setModeFromEmbry('5ft', `voice:${state}`)
      }
      armIdleTimer()
    }

    const handleIdleNow = () => {
      setModeFromEmbry('10ft', 'idle-event')
      armIdleTimer()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('pointerdown', handlePointerActivity)
    window.addEventListener('pointermove', handlePointerActivity)
    window.addEventListener('sparta:embry-voice-state', handleVoiceState)
    window.addEventListener('sparta:embry-idle', handleIdleNow)
    armIdleTimer()

    return () => {
      if (idleTimer !== undefined) window.clearTimeout(idleTimer)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('pointerdown', handlePointerActivity)
      window.removeEventListener('pointermove', handlePointerActivity)
      window.removeEventListener('sparta:embry-voice-state', handleVoiceState)
      window.removeEventListener('sparta:embry-idle', handleIdleNow)
    }
  }, [setModeFromEmbry])

  const value = useMemo(() => ({
    activeTab,
    slug,
    mode,
    setMode,
    supportsPageDistance,
  }), [activeTab, slug, mode, setMode, supportsPageDistance])

  return (
    <PageDistanceContext.Provider value={value}>
      {children}
    </PageDistanceContext.Provider>
  )
}

export function usePageDistanceMode(): PageDistanceContextValue {
  const ctx = useContext(PageDistanceContext)
  if (!ctx) {
    throw new Error('usePageDistanceMode must be used within PageDistanceProvider')
  }
  return ctx
}

export function useOptionalPageDistanceMode(): PageDistanceContextValue | null {
  return useContext(PageDistanceContext)
}

const MODE_OPTIONS: Array<{ mode: PageDistanceMode; label: string; hint: string }> = [
  { mode: '10ft', label: 'Glance', hint: 'Wall / plant distance' },
  { mode: '5ft', label: 'Triage', hint: 'Standing operator queue' },
  { mode: 'lean-in', label: 'Drilldown', hint: 'Lean-in detail' },
]

const CHAT_DISTANCE_QID: Record<PageDistanceMode, string> = {
  '10ft': 'sparta:chat:distance:glance',
  '5ft': 'sparta:chat:distance:triage',
  'lean-in': 'sparta:chat:distance:drilldown',
}

export function PageDistanceModeSwitcher({ compact = false }: { compact?: boolean }) {
  const { slug, mode, setMode, supportsPageDistance } = usePageDistanceMode()

  if (!supportsPageDistance) return null

  return (
    <nav
      data-qid="sparta:chat:distance-switcher"
      data-page-slug={slug}
      aria-label="Page distance mode"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 4 : 8,
        border: '1px solid rgba(148, 163, 184, 0.3)',
        borderRadius: 10,
        padding: compact ? 3 : 5,
        background: 'rgba(15, 23, 42, 0.8)',
      }}
    >
      {MODE_OPTIONS.map(({ mode: optionMode, label, hint }) => {
        const active = mode === optionMode
        return (
          <button
            key={optionMode}
            type="button"
            data-qid={CHAT_DISTANCE_QID[optionMode]}
            data-qs-action={`PAGE_DISTANCE_${optionMode === 'lean-in' ? 'LEAN_IN' : optionMode.toUpperCase()}`}
            aria-pressed={active}
            title={hint}
            onClick={() => setMode(optionMode)}
            style={{
              minHeight: 44,
              border: active ? '1px solid rgba(0, 255, 65, 0.75)' : '1px solid transparent',
              borderRadius: 8,
              padding: compact ? '8px 10px' : '10px 14px',
              background: active ? 'rgba(0, 255, 65, 0.12)' : 'transparent',
              color: active ? '#eafff0' : '#94a3b8',
              fontSize: compact ? 11 : 12,
              fontWeight: 700,
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        )
      })}
    </nav>
  )
}

export function PageDistanceRoot({
  children,
  qid,
  className,
}: {
  children: ReactNode
  qid: string
  className?: string
}) {
  const { slug, mode } = usePageDistanceMode()
  return (
    <div className={className} data-qid={qid} data-page-distance-mode={mode} data-page-slug={slug} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {children}
    </div>
  )
}

export function pageModeBlocksChat(mode: PageDistanceMode): boolean {
  return mode === '10ft'
}
