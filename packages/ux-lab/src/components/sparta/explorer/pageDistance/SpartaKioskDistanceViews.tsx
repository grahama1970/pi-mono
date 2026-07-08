import type { CSSProperties, ReactNode } from 'react'
import { AlertTriangle, Boxes, Check, Globe, HelpCircle, Layers, Mic, MoreHorizontal, Network, Square, Target, Workflow } from 'lucide-react'
import { useRegisterAction } from '../../../../hooks/useRegisterAction'
import type { CollectionCounts } from '../../../../hooks/useSpartaCollections'
import type { TabName } from '../SpartaExplorer'
import {
  TAB_PURPOSE_CONTRACTS,
  deriveCoveragePagePurposeState,
  type CoverageHealthSnapshot,
  type PagePurposeContract,
  type PagePurposeState,
} from '../pagePurposeContracts'
import { PageDistanceModeSwitcher, usePageDistanceMode, type PageDistanceMode } from './PageDistanceMode'
import { EmbryVoiceOrb, type EmbryVoiceStatus } from '../../../embry-voice/EmbryVoiceOrb'

type KioskState = 'READY' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN'
type VoiceState = 'READY' | 'LISTENING' | 'SPEAKING' | 'EVIDENCE MISSING'

type KioskTile = {
  tab: TabName
  qid: string
  state: KioskState
  stateReason: string
  primaryMetric: string
  primaryLabel: string
  secondaryLine: string
  nextAction: string
  voiceCommand: string
  sourceStatus: 'authoritative' | 'missing' | 'stale'
}

const PAGES: TabName[] = ['Coverage', 'QRAs', 'Controls', 'Sources', 'URLs', 'Threat Matrix', 'Posture', 'Supply Chain']

const C = {
  surfaceRoot: '#101418',
  surfacePanel: '#171C22',
  surfaceCard: '#20262E',
  border: '#3B4652',
  text: '#F5F7FA',
  secondary: '#D7DEE8',
  muted: '#AAB4C0',
  readyBg: '#12382B',
  readyBorder: '#36D399',
  readyFg: '#E3FFF3',
  degradedBg: '#3A2A13',
  degradedBorder: '#F2B84B',
  degradedFg: '#FFF1CC',
  blockedBg: '#3A1515',
  blockedBorder: '#F87171',
  blockedFg: '#FFE4E4',
  unknownBg: '#252B33',
  unknownBorder: '#AAB4C0',
  unknownFg: '#F1F5F9',
  listeningBg: '#0B3440',
  listeningBorder: '#22D3EE',
  listeningFg: '#D7FAFF',
  speakingBg: '#2A1B4A',
  speakingBorder: '#A78BFA',
  speakingFg: '#F0E9FF',
  missingBg: '#3A1320',
  missingBorder: '#FB7185',
  missingFg: '#FFE4EC',
}

const fontStack = 'Inter, "Segoe UI", "Aptos", system-ui, -apple-system, BlinkMacSystemFont, sans-serif'

const stateStyle: Record<KioskState, { bg: string; border: string; fg: string; icon: ReactNode }> = {
  READY: { bg: C.readyBg, border: C.readyBorder, fg: C.readyFg, icon: <Check size={18} strokeWidth={3} /> },
  DEGRADED: { bg: C.degradedBg, border: C.degradedBorder, fg: C.degradedFg, icon: <AlertTriangle size={18} strokeWidth={2.6} /> },
  BLOCKED: { bg: C.blockedBg, border: C.blockedBorder, fg: C.blockedFg, icon: <Square size={15} fill="currentColor" strokeWidth={0} /> },
  UNKNOWN: { bg: C.unknownBg, border: C.unknownBorder, fg: C.unknownFg, icon: <HelpCircle size={18} strokeWidth={2.6} /> },
}

const voiceStyle: Record<VoiceState, { bg: string; border: string; fg: string }> = {
  READY: { bg: C.readyBg, border: C.readyBorder, fg: C.readyFg },
  LISTENING: { bg: C.listeningBg, border: C.listeningBorder, fg: C.listeningFg },
  SPEAKING: { bg: C.speakingBg, border: C.speakingBorder, fg: C.speakingFg },
  'EVIDENCE MISSING': { bg: C.missingBg, border: C.missingBorder, fg: C.missingFg },
}

const sharedOrbStateByVoiceState: Record<VoiceState, EmbryVoiceStatus> = {
  READY: 'idle',
  LISTENING: 'listening',
  SPEAKING: 'speaking',
  'EVIDENCE MISSING': 'error',
}

const orbLabelByVoiceState: Record<VoiceState, string> = {
  READY: 'READY',
  LISTENING: 'LISTENING',
  SPEAKING: 'EMBRY',
  'EVIDENCE MISSING': 'ERROR',
}

function purposeToKioskState(state?: PagePurposeState): KioskState {
  if (state === 'pass') return 'READY'
  if (state === 'degraded') return 'DEGRADED'
  if (state === 'fail') return 'BLOCKED'
  return 'UNKNOWN'
}

function formatCount(value: number | undefined | null): string {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? n.toLocaleString() : 'UNKNOWN'
}

function hasKnownCount(value: number | undefined | null): boolean {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0
}

function sourceFreshness(sourceStatus: KioskTile['sourceStatus'], coverageHealth: CoverageHealthSnapshot | null | undefined): string {
  if (sourceStatus === 'missing') return 'Freshness: UNKNOWN - fail closed'
  if (sourceStatus === 'stale') return 'Freshness: STALE - fail closed'
  const generated = coverageHealth?.generated_at ?? coverageHealth?.monitorClosure?.generated_at ?? coverageHealth?.supervisor?.heartbeat_at
  if (!generated) return 'Freshness: UNKNOWN - fail closed'
  const date = new Date(generated)
  const compact = Number.isNaN(date.getTime())
    ? generated
    : date.toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z').replace('T', ' ')
  return `Freshness: monitor-sparta ${compact}`
}

function qualityGapTotal(health: CoverageHealthSnapshot | null | undefined): number {
  return (health?.controlFrameworks ?? []).reduce((sum, row) => sum + Number(row.quality_gaps ?? 0), 0)
}

function inventoryGapTotal(health: CoverageHealthSnapshot | null | undefined): number {
  const inventory = health?.corpusInventory ?? {}
  return Object.values(inventory).reduce((sum, lane) => sum + Number(lane?.missing ?? 0), 0)
}

function getContract(tab: TabName, coverageHealth: CoverageHealthSnapshot | null | undefined): PagePurposeContract | undefined {
  const base = TAB_PURPOSE_CONTRACTS[tab]
  if (!base) return undefined
  if (tab !== 'Coverage') return base
  const live = deriveCoveragePagePurposeState(coverageHealth)
  return { ...base, ...live }
}

function buildTile(tab: TabName, counts: CollectionCounts, coverageHealth: CoverageHealthSnapshot | null | undefined): KioskTile {
  const contract = getContract(tab, coverageHealth)
  const state = purposeToKioskState(contract?.state)
  const sourceMissing = !contract
  const healthMissing = tab === 'Coverage' && !coverageHealth
  const sourceStatus: KioskTile['sourceStatus'] = sourceMissing || healthMissing ? 'missing' : coverageHealth?.stale ? 'stale' : 'authoritative'
  const stateReason = contract?.stateReason ?? 'Missing page-purpose state contract.'

  if (tab === 'Coverage') {
    const passed = coverageHealth?.monitor?.passed
    const total = coverageHealth?.monitor?.total
    const monitor = passed != null && total != null && total > 0 ? `${passed}/${total}` : 'UNKNOWN'
    const gaps = qualityGapTotal(coverageHealth) || inventoryGapTotal(coverageHealth)
    return {
      tab,
      qid: 'sparta:kiosk:tile:coverage',
      state: healthMissing ? 'UNKNOWN' : state,
      stateReason,
      primaryMetric: monitor,
      primaryLabel: 'monitor',
      secondaryLine: gaps > 0 ? `${gaps.toLocaleString()} quality gaps` : healthMissing ? 'missing health' : 'largest gap clear',
      nextAction: gaps > 0 ? 'Open coverage gaps' : 'Review coverage health',
      voiceCommand: 'Show Coverage',
      sourceStatus,
    }
  }

  if (tab === 'QRAs') {
    const corpus = counts.qrasTotal || counts.qras
    return {
      tab,
      qid: 'sparta:kiosk:tile:qras',
      state,
      stateReason,
      primaryMetric: formatCount(corpus),
      primaryLabel: 'corpus',
      secondaryLine: hasKnownCount(corpus) ? 'review queue needs action' : 'count unknown - fail closed',
      nextAction: 'Open QRA review queue',
      voiceCommand: 'Open QRA review queue',
      sourceStatus,
    }
  }

  if (tab === 'Controls') {
    return {
      tab,
      qid: 'sparta:kiosk:tile:controls',
      state,
      stateReason,
      primaryMetric: formatCount(counts.controls),
      primaryLabel: 'controls',
      secondaryLine: 'mapping gaps',
      nextAction: 'Open control mappings',
      voiceCommand: 'Show Controls',
      sourceStatus,
    }
  }

  if (tab === 'Sources') {
    return {
      tab,
      qid: 'sparta:kiosk:tile:sources',
      state,
      stateReason,
      primaryMetric: hasKnownCount(counts.knowledge) ? formatCount(counts.knowledge) : 'UNKNOWN',
      primaryLabel: hasKnownCount(counts.knowledge) ? 'source chunks' : 'sources',
      secondaryLine: hasKnownCount(counts.knowledge) ? 'lineage blockers' : 'source count unknown',
      nextAction: 'Open source lineage',
      voiceCommand: 'Show Sources',
      sourceStatus: hasKnownCount(counts.knowledge) ? sourceStatus : 'missing',
    }
  }

  if (tab === 'URLs') {
    return {
      tab,
      qid: 'sparta:kiosk:tile:urls',
      state,
      stateReason,
      primaryMetric: formatCount(counts.urls),
      primaryLabel: 'urls',
      secondaryLine: 'stale / quarantine',
      nextAction: 'Open URL quarantine',
      voiceCommand: 'Show URLs',
      sourceStatus,
    }
  }

  if (tab === 'Threat Matrix') {
    return {
      tab,
      qid: 'sparta:kiosk:tile:threat-matrix',
      state,
      stateReason,
      primaryMetric: hasKnownCount(counts.relationships) ? formatCount(counts.relationships) : 'UNKNOWN',
      primaryLabel: 'relationships',
      secondaryLine: 'top unmapped risk',
      nextAction: 'Open threat mapping',
      voiceCommand: 'Show Threats',
      sourceStatus: hasKnownCount(counts.relationships) ? sourceStatus : 'missing',
    }
  }

  if (tab === 'Posture') {
    return {
      tab,
      qid: 'sparta:kiosk:tile:posture',
      state,
      stateReason,
      primaryMetric: state,
      primaryLabel: 'signoff state',
      secondaryLine: 'top blocker',
      nextAction: 'Open posture blocker',
      voiceCommand: 'Show Posture',
      sourceStatus,
    }
  }

  return {
    tab,
    qid: 'sparta:kiosk:tile:supply-chain',
    state,
    stateReason,
    primaryMetric: state === 'UNKNOWN' ? 'UNKNOWN' : 'SUPPLY',
    primaryLabel: 'supply chain',
    secondaryLine: state === 'UNKNOWN' ? 'source contract missing' : 'dependency blocker',
    nextAction: 'Open supply chain risk',
    voiceCommand: 'Show Supply Chain',
    sourceStatus: state === 'UNKNOWN' ? 'missing' : sourceStatus,
  }
}

function buildTiles(counts: CollectionCounts, coverageHealth: CoverageHealthSnapshot | null | undefined): KioskTile[] {
  return PAGES.map((tab) => buildTile(tab, counts, coverageHealth))
}

function globalState(tiles: KioskTile[]): KioskState {
  if (tiles.some((tile) => tile.state === 'BLOCKED')) return 'BLOCKED'
  if (tiles.some((tile) => tile.state === 'UNKNOWN')) return 'UNKNOWN'
  if (tiles.some((tile) => tile.state === 'DEGRADED')) return 'DEGRADED'
  return 'READY'
}

function topBlocker(tiles: KioskTile[]): KioskTile {
  return tiles.find((tile) => tile.state === 'BLOCKED')
    ?? tiles.find((tile) => tile.state === 'UNKNOWN')
    ?? tiles.find((tile) => tile.state === 'DEGRADED')
    ?? tiles[0]
}

function operatorBlocker(tile: KioskTile): string {
  if (tile.sourceStatus === 'missing') return `${tile.tab} source contract is missing.`
  if (tile.tab === 'QRAs') return 'COTS/QID backlog blocks QRA readiness.'
  if (tile.state === 'READY') return `${tile.tab} is ready for review.`
  if (tile.state === 'UNKNOWN') return `${tile.tab} readiness is unknown.`
  return `${tile.tab} needs repair before review.`
}

function KioskStateChip({ state, qid, compact = false }: { state: KioskState; qid?: string; compact?: boolean }) {
  const s = stateStyle[state]
  const icon = compact
    ? {
        READY: <Check size={12} strokeWidth={3} />,
        DEGRADED: <AlertTriangle size={12} strokeWidth={2.6} />,
        BLOCKED: <Square size={10} fill="currentColor" strokeWidth={0} />,
        UNKNOWN: <HelpCircle size={12} strokeWidth={2.6} />,
      }[state]
    : s.icon
  return (
    <span
      data-qid={qid}
      data-state={state.toLowerCase()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 4 : 10,
        padding: compact ? '4px 6px' : '9px 14px',
        borderRadius: 8,
        border: `2px solid ${s.border}`,
        background: s.bg,
        color: s.fg,
        fontSize: compact ? 12 : 26,
        lineHeight: 1,
        fontWeight: 850,
        letterSpacing: '0.04em',
      }}
    >
      {icon}
      {state}
    </span>
  )
}

function EmbryVoiceMast({
  mode,
  activeTab,
  selectedTarget,
  voiceState: voiceStateProp,
  onSelectPage,
}: {
  mode: PageDistanceMode
  activeTab: TabName
  selectedTarget?: string
  voiceState?: VoiceState
  onSelectPage: (tab: TabName) => void
}) {
  const voiceState: VoiceState = voiceStateProp ?? (mode === '5ft' ? 'SPEAKING' : 'READY')
  const s = voiceStyle[voiceState]
  const sharedOrbState = sharedOrbStateByVoiceState[voiceState]
  const orbLabel = orbLabelByVoiceState[voiceState]
  const mastStyle: CSSProperties = mode === '5ft'
    ? {
        ...S.embryMast,
        position: 'relative',
        top: 'auto',
        right: 'auto',
        bottom: 'auto',
        width: '100%',
        minHeight: 0,
        height: '100%',
        display: 'grid',
        gridTemplateRows: 'auto auto auto auto',
        alignContent: 'center',
        justifyItems: 'center',
      }
    : S.embryMast
  const commands: Array<{ label: string; qid: string; tab?: TabName }> = [
    { label: 'What blocks readiness?', qid: 'embry:command-chip:readiness' },
    { label: 'Open QRA review queue', qid: 'embry:command-chip:qras', tab: 'QRAs' },
    { label: 'Show Coverage', qid: 'embry:command-chip:coverage', tab: 'Coverage' },
    { label: 'Show URLs', qid: 'embry:command-chip:urls', tab: 'URLs' },
    { label: 'Show Posture', qid: 'embry:command-chip:posture', tab: 'Posture' },
    { label: 'Open top blocker', qid: 'embry:command-chip:top-blocker' },
  ]

  return (
    <aside data-qid="sparta:kiosk:embry-mast" style={mastStyle} aria-label="Embry voice control">
      <style>{`
        @keyframes sparta-live-ping {
          0% { transform: scale(0.72); opacity: 0.78; }
          78%, 100% { transform: scale(2.15); opacity: 0; }
        }
      `}</style>
      <div
        data-qid="embry:orb"
        data-embry-orb-state={sharedOrbState}
        style={{
          ...S.orb,
          width: mode === '5ft' ? 104 : 224,
          height: mode === '5ft' ? 104 : 224,
        }}
      >
        <EmbryVoiceOrb
          voiceStatus={sharedOrbState}
          isStreaming={sharedOrbState === 'processing'}
          tone={sharedOrbState === 'idle' ? undefined : 'good'}
          size={mode === '5ft' ? 104 : 224}
          surface="toolbar"
          phaseSpeedMs={650}
        />
      </div>
      <div data-qid="embry:voice-state" style={{ ...S.voiceState, color: s.fg, fontSize: mode === '5ft' ? 34 : S.voiceState.fontSize }}>
        {orbLabel}
      </div>
      <div data-qid="embry:heard-line" style={{ ...S.heardLine, fontSize: mode === '5ft' ? 18 : S.heardLine.fontSize }}>
        {mode === '5ft' ? `Heard: show ${activeTab}` : 'Say "Embry" then a command'}
      </div>
      {mode !== '5ft' ? (
        <div style={S.voiceChipGrid} aria-label="Embry voice shortcuts">
          {commands.map((command) => (
            <button
              key={command.qid}
              type="button"
              data-qid={command.qid}
              data-qs-action={command.tab ? `VOICE_SELECT_PAGE_${command.tab.toUpperCase().replace(/\s+/g, '_')}` : 'VOICE_READINESS_ACTION'}
              title={command.label}
              onClick={() => {
                if (command.tab) onSelectPage(command.tab)
              }}
              style={S.voiceChip}
            >
              <span style={S.voiceChipIcon}><Mic size={20} strokeWidth={3} /></span>
              {command.label}
            </button>
          ))}
        </div>
      ) : null}
      {mode !== '5ft' ? (
        <div data-qid="embry:selected-target" style={S.selectedTarget}>
          Target: {selectedTarget ?? activeTab}
        </div>
      ) : null}
    </aside>
  )
}

function KioskTileCard({ tile, active, onSelect }: { tile: KioskTile; active: boolean; onSelect: () => void }) {
  const s = stateStyle[tile.state]
  const Icon = iconForTile(tile.tab)
  const isVoid = tile.state === 'UNKNOWN' || tile.primaryMetric === 'UNKNOWN'
  const displayMetric = isVoid ? '--' : abbreviateKioskMetric(tile.primaryMetric)
  const metricFontSize = kioskMetricFontSize(displayMetric)
  const titleFontSize = kioskTitleFontSize(tile.tab)
  const bottomText = `${tile.primaryLabel} - ${tile.secondaryLine}`
  return (
    <button
      type="button"
      data-qid={tile.qid}
      data-qs-action="KIOSK_SELECT_TILE"
      title={`${tile.tab}: ${tile.state}. ${tile.secondaryLine}`}
      onClick={onSelect}
      style={{
        ...S.tile,
        borderLeftColor: s.border,
        background: tile.state === 'BLOCKED' ? '#2B1518' : isVoid ? '#151A20' : C.surfaceCard,
        opacity: isVoid ? 0.72 : 1,
        boxShadow: active ? `inset 0 0 0 3px ${s.border}` : 'none',
      }}
    >
      <header style={S.tileHeader}>
        <Icon size={40} strokeWidth={3} style={{ color: isVoid ? C.muted : C.secondary, flex: '0 0 auto' }} />
        <span
          aria-label={tile.state}
          title={tile.state}
          style={{
            ...S.statusDot,
            background: s.fg,
            boxShadow: tile.state === 'READY' || tile.state === 'UNKNOWN' ? 'none' : `0 0 18px ${s.fg}88`,
          }}
        />
      </header>
      <div style={S.metricBlock}>
        <div style={{ ...S.primaryMetric, color: isVoid ? C.muted : C.text, fontSize: metricFontSize }}>{displayMetric}</div>
        <div style={{ ...S.metricTitle, color: isVoid ? C.muted : tile.state === 'BLOCKED' ? '#FECACA' : C.secondary, fontSize: titleFontSize }}>{tile.tab}</div>
      </div>
      <div style={{ ...S.secondaryLine, color: isVoid ? C.muted : C.secondary }}>{bottomText}</div>
    </button>
  )
}

function abbreviateKioskMetric(value: string): string {
  const numeric = Number(value.replace(/,/g, ''))
  if (!Number.isFinite(numeric)) return value.length > 10 ? value.slice(0, 9).toUpperCase() : value
  if (numeric >= 1_000_000) return `${Math.round(numeric / 100_000) / 10}M`
  if (numeric >= 100_000) return `${Math.round(numeric / 1_000)}k`
  if (numeric >= 10_000) return `${Math.round(numeric / 1_000)}k`
  return value
}

function kioskMetricFontSize(value: string): number {
  if (value === '--') return 64
  if (value.includes('/')) return 58
  if (/[A-Za-z]/.test(value) && value.length >= 8) return 38
  if (/[A-Za-z]/.test(value) && value.length >= 6) return 52
  if (value.length >= 6) return 62
  return 68
}

function kioskTitleFontSize(tab: TabName): number {
  if (tab === 'Supply Chain') return 29
  if (tab === 'Threat Matrix') return 29
  if (tab.length >= 8) return 31
  return 34
}

function iconForTile(tab: TabName) {
  if (tab === 'Coverage') return Target
  if (tab === 'QRAs') return Layers
  if (tab === 'Controls') return Square
  if (tab === 'Sources') return Network
  if (tab === 'URLs') return Globe
  if (tab === 'Threat Matrix') return AlertTriangle
  if (tab === 'Posture') return Check
  if (tab === 'Supply Chain') return Boxes
  return Workflow
}

function notificationPriority(state: KioskState): number {
  if (state === 'BLOCKED') return 0
  if (state === 'DEGRADED') return 1
  if (state === 'UNKNOWN') return 2
  return 3
}

function readinessNotifications(tiles: KioskTile[]): KioskTile[] {
  const active = tiles.filter((tile) => tile.state !== 'READY')
  if (active.length === 0) return tiles.slice(0, 1)
  return [...active]
    .sort((a, b) => notificationPriority(a.state) - notificationPriority(b.state))
    .slice(0, 3)
}

function TelemetryPill({
  global,
  notifications,
  moreNotificationCount,
}: {
  global: KioskState
  notifications: KioskTile[]
  moreNotificationCount: number
}) {
  const activeCount = notifications.filter((tile) => tile.state !== 'READY').length + moreNotificationCount
  const summaryTone = global === 'BLOCKED' ? 'BLOCKED' : global === 'DEGRADED' ? 'DEGRADED' : global === 'UNKNOWN' ? 'UNKNOWN' : 'READY'
  const summaryText = global === 'READY'
    ? 'ALL SYSTEMS READY'
    : `${Math.max(1, activeCount)} SYSTEM${Math.max(1, activeCount) === 1 ? '' : 'S'} ${summaryTone}`
  const summaryTitle = global === 'READY' ? 'Review ready' : `Review ${summaryTone.toLowerCase()}`
  const toneColor = global === 'READY' ? '#34D399' : global === 'BLOCKED' ? '#FB7185' : global === 'DEGRADED' ? '#F2B84B' : '#94A3B8'
  const visibleNotifications = notifications.slice(0, 3)

  return (
    <div data-qid="sparta:kiosk:telemetry-pill-root" style={S.telemetryRoot}>
      <style>{`
        @keyframes sparta-telemetry-reveal {
          from { opacity: 0; transform: translateX(-50%) translateY(-6px) scale(0.96); }
          to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
      `}</style>
      <div
        data-qid="sparta:kiosk:telemetry-pill"
        title="SPARTA notifications"
        style={S.telemetryPill}
      >
        <span style={{ ...S.telemetryPulse, background: toneColor, boxShadow: `0 0 18px ${toneColor}88` }} />
        <span style={S.telemetryTextGroup}>
          <span style={S.telemetryTitle}>{summaryTitle}</span>
          <span style={S.telemetryText}>{summaryText}</span>
        </span>
        <MoreHorizontal size={18} strokeWidth={2.6} aria-hidden="true" />
      </div>
      <div data-qid="sparta:kiosk:telemetry-dropdown" style={S.telemetryDropdown}>
        <div data-qid="sparta:kiosk:telemetry-stack" style={S.telemetryStack}>
          {visibleNotifications.map((tile, index) => {
            const ns = stateStyle[tile.state]
            const NotificationIcon = tile.state === 'READY' ? Check : AlertTriangle
            return (
              <div
                key={tile.tab}
                data-qid={`sparta:kiosk:notification:${index + 1}`}
                style={{
                  ...S.telemetryCard,
                  zIndex: 10 - index,
                  transform: `translateY(${index * 12}px) scale(${1 - index * 0.04})`,
                  opacity: 1 - index * 0.2,
                }}
              >
                <div style={S.telemetryCardMeta}>
                  <span style={S.telemetrySource}>
                    <span style={{ ...S.telemetryIcon, color: ns.fg, background: `${ns.fg}18` }}>
                      <NotificationIcon size={16} strokeWidth={2.8} />
                    </span>
                    {index === 0 ? 'CURRENT' : 'RECENT'} · {tile.tab}
                  </span>
                  <span>{index === 0 ? 'NOW' : 'RECENT'}</span>
                </div>
                <div data-qid={index === 0 ? 'sparta:kiosk:top-blocker' : undefined} style={S.telemetryCardTitle}>
                  {global === 'READY' ? 'All monitored pages ready' : tile.secondaryLine}
                </div>
              </div>
            )
          })}
        </div>
        {moreNotificationCount > 0 ? (
          <button
            type="button"
            data-qid="sparta:kiosk:notification:more"
            data-qs-action="KIOSK_SHOW_OLDER_NOTIFICATIONS"
            title={`${moreNotificationCount} older notifications`}
            style={S.telemetryMoreButton}
          >
            {moreNotificationCount} Older Notifications
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function SpartaKioskDistanceView({
  activeTab,
  counts,
  coverageHealth,
  children,
  onSelectTab,
}: {
  activeTab: TabName
  counts: CollectionCounts
  coverageHealth: CoverageHealthSnapshot | null
  children: ReactNode
  onSelectTab: (tab: TabName) => void
}) {
  const { mode, setMode, isPinned } = usePageDistanceMode()
  const tiles = buildTiles(counts, coverageHealth)
  const global = globalState(tiles)
  const blocker = topBlocker(tiles)
  const activeTile = tiles.find((tile) => tile.tab === activeTab) ?? blocker
  const notifications = readinessNotifications(tiles)
  const moreNotificationCount = Math.max(0, tiles.filter((tile) => tile.state !== 'READY').length - notifications.length)

  useRegisterAction('sparta:kiosk:global-readiness', {
    app: 'sparta-explorer',
    action: 'KIOSK_GLOBAL_READINESS',
    label: 'Kiosk global readiness',
    description: 'Read the 10ft SPARTA readiness verdict',
  })

  if (mode === 'lean-in') return <>{children}</>

  const selectPage = (tab: TabName) => {
    onSelectTab(tab)
    setMode('5ft')
  }

  if (mode === '5ft') {
    return (
      <section data-qid="sparta:triage:root" data-page-distance-mode="5ft" data-page-distance-pinned={isPinned ? 'true' : 'false'} style={S.root} aria-label="SPARTA 5ft voice triage">
        <div data-qid="sparta:triage:view-state-controls" style={S.viewStateDock}>
          <PageDistanceModeSwitcher compact qidPrefix="sparta:triage:distance" />
        </div>
        <header data-qid="sparta:triage:selected-page" style={S.triageHeader}>
          <div>
            <div style={S.kicker}>SPARTA TRIAGE / 5FT</div>
            <h1 style={S.triageTitle}>{activeTile.tab}</h1>
          </div>
          <KioskStateChip state={activeTile.state} qid="sparta:triage:page-state" compact />
          <div style={S.headerMetric}>
            <span>{activeTile.primaryMetric}</span>
            <strong>{activeTile.primaryLabel}</strong>
          </div>
          <div style={S.freshness}>{sourceFreshness(activeTile.sourceStatus, coverageHealth)}</div>
        </header>
        <main style={S.triageBody}>
          <section data-qid="sparta:triage:transcript" style={S.transcriptPanel}>
            <TranscriptBlock qid="sparta:triage:human-said" label="HUMAN SAID" text={`"Show ${activeTile.tab}."`} />
            <TranscriptBlock qid="sparta:triage:embry-heard" label="EMBRY HEARD" text={`show ${activeTile.tab.toLowerCase()} -> page=${activeTile.tab.toLowerCase().replace(/\s+/g, '-')} -> qid=${activeTile.qid}`} />
            <TranscriptBlock qid="embry:selected-target" label="SELECTED" text={`${activeTile.tab} / ${activeTile.state}`} />
            <TranscriptBlock
              qid="sparta:triage:embry-says"
              label="EMBRY SAYS"
              text={`The ${activeTile.tab} page is ${activeTile.state.toLowerCase()}. ${activeTile.primaryMetric} ${activeTile.primaryLabel}. ${activeTile.secondaryLine}. Next action: ${activeTile.nextAction}.`}
            />
          </section>
          <section style={S.triageRail} aria-label="Selected page actions">
            <EmbryVoiceMast mode="5ft" activeTab={activeTile.tab} selectedTarget={activeTile.qid} voiceState="SPEAKING" onSelectPage={selectPage} />
            <div data-qid="sparta:triage:top-blockers" style={S.actionPanel}>
              <div style={S.panelLabel}>Top blockers</div>
              <ol style={S.blockerList}>
                <li>{activeTile.secondaryLine}</li>
                <li>{operatorBlocker(activeTile)}</li>
                <li>Evidence policy: {activeTile.state === 'READY' ? 'ANSWER' : activeTile.state === 'UNKNOWN' ? 'CLARIFY' : 'DEFLECT - repair required'}</li>
              </ol>
            </div>
            <button
              type="button"
              data-qid="sparta:triage:primary-action"
              data-qs-action="TRIAGE_PRIMARY_ACTION"
              title={activeTile.nextAction}
              onClick={() => setMode('lean-in')}
              style={S.primaryAction}
            >
              {activeTile.nextAction}
            </button>
          </section>
        </main>
      </section>
    )
  }

  return (
    <section data-qid="sparta:kiosk:root" data-page-distance-mode="10ft" data-page-distance-pinned={isPinned ? 'true' : 'false'} style={S.root} aria-label="SPARTA 10ft readiness board">
      <div data-qid="sparta:kiosk:view-state-controls" style={S.viewStateDock}>
        <PageDistanceModeSwitcher compact qidPrefix="sparta:kiosk:distance" />
      </div>
      <div data-qid="sparta:kiosk:global-readiness" style={S.kioskTitleBar}>
        <div style={S.kioskTitleKicker}>SPARTA EXPLORER</div>
        <div style={S.kioskTitleText}>10ft readiness board</div>
      </div>
      <TelemetryPill global={global} notifications={notifications} moreNotificationCount={moreNotificationCount} />
      <div data-qid="sparta:kiosk:grid" style={S.grid}>
        {tiles.map((tile) => (
          <KioskTileCard
            key={tile.tab}
            tile={tile}
            active={tile.tab === activeTab}
            onSelect={() => selectPage(tile.tab)}
          />
        ))}
      </div>
      <EmbryVoiceMast mode="10ft" activeTab={activeTab} selectedTarget={activeTile.qid} onSelectPage={selectPage} />
    </section>
  )
}

function TranscriptBlock({ qid, label, text }: { qid: string; label: string; text: string }) {
  return (
    <div data-qid={qid} style={S.transcriptBlock}>
      <div style={S.transcriptLabel}>{label}</div>
      <div style={S.transcriptText}>{text}</div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    flex: 1,
    minHeight: 0,
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    background: C.surfaceRoot,
    color: C.text,
    fontFamily: fontStack,
    fontVariantNumeric: 'tabular-nums',
  },
  viewStateDock: {
    position: 'absolute',
    top: 12,
    right: 28,
    zIndex: 1200,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'auto',
  },
  kioskTitleBar: {
    position: 'absolute',
    top: 18,
    left: 28,
    zIndex: 1010,
    minWidth: 260,
    display: 'grid',
    gap: 5,
  },
  kioskTitleKicker: {
    color: '#8FB7DA',
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: '0.22em',
    lineHeight: 1,
    textTransform: 'uppercase',
  },
  kioskTitleText: {
    color: C.text,
    fontSize: 22,
    fontWeight: 850,
    lineHeight: 1,
    letterSpacing: '-0.01em',
    textTransform: 'uppercase',
  },
  telemetryRoot: {
    position: 'fixed',
    top: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1250,
    display: 'grid',
    justifyItems: 'center',
    pointerEvents: 'auto',
  },
  telemetryPill: {
    minHeight: 58,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 26px',
    borderRadius: 22,
    border: '1px solid rgba(255, 255, 255, 0.10)',
    background: 'rgba(28, 28, 30, 0.90)',
    color: '#D4D4D8',
    boxShadow: '0 8px 28px rgba(0, 0, 0, 0.46)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    cursor: 'default',
    transition: 'background 180ms ease, transform 220ms cubic-bezier(0.23, 1, 0.32, 1)',
  },
  telemetryPulse: {
    width: 14,
    height: 14,
    borderRadius: '50%',
    flex: '0 0 auto',
    animation: 'sparta-live-ping 1.8s ease-out infinite',
  },
  telemetryText: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: '0.12em',
    lineHeight: 1,
    textTransform: 'uppercase',
  },
  telemetryTextGroup: {
    display: 'grid',
    gap: 4,
  },
  telemetryTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 950,
    lineHeight: 0.9,
    letterSpacing: '-0.03em',
    textTransform: 'uppercase',
  },
  telemetryDropdown: {
    position: 'absolute',
    top: 74,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 410,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    transformOrigin: 'top center',
    animation: 'sparta-telemetry-reveal 180ms cubic-bezier(0.23, 1, 0.32, 1)',
    zIndex: 1260,
  },
  telemetryStack: {
    position: 'relative',
    width: '100%',
    height: 126,
    perspective: 900,
  },
  telemetryCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    padding: 14,
    borderRadius: 18,
    border: '1px solid rgba(255, 255, 255, 0.08)',
    background: 'rgba(28, 28, 30, 0.96)',
    boxShadow: '0 16px 40px rgba(0, 0, 0, 0.62)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    boxSizing: 'border-box',
    transformOrigin: 'top center',
  },
  telemetryCardMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: 900,
    lineHeight: 1,
    letterSpacing: '0.09em',
    textTransform: 'uppercase',
    marginBottom: 7,
  },
  telemetrySource: {
    minWidth: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
  telemetryIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    display: 'inline-grid',
    placeItems: 'center',
    flex: '0 0 auto',
  },
  telemetryCardTitle: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: 900,
    lineHeight: 1.18,
    letterSpacing: '0',
  },
  telemetryMoreButton: {
    minHeight: 34,
    alignSelf: 'center',
    padding: '0 16px',
    border: '1px solid rgba(255, 255, 255, 0.07)',
    borderRadius: 999,
    background: 'rgba(28, 28, 30, 0.94)',
    color: '#D4D4D8',
    fontSize: 12,
    fontWeight: 850,
    letterSpacing: '0.02em',
    cursor: 'pointer',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
  },
  globalBanner: {
    position: 'absolute',
    left: 28,
    top: 0,
    right: 376,
    height: 176,
    border: '0',
    borderRadius: 0,
    display: 'flex',
    alignItems: 'stretch',
    padding: '8px 0',
    boxSizing: 'border-box',
    overflow: 'hidden',
    color: '#FFFFFF',
    background: '#0B1118',
    boxShadow: '0 8px 26px rgba(0, 0, 0, 0.30)',
  },
  annunciatorLeft: {
    width: 300,
    flex: '0 0 300px',
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    minWidth: 0,
    padding: '18px 20px',
    boxSizing: 'border-box',
    borderLeft: '8px solid transparent',
    borderRadius: 6,
    background: '#111821',
    boxShadow: 'inset 0 0 0 1px rgba(148, 163, 184, 0.18)',
  },
  annunciatorStackZone: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
    background: 'transparent',
    borderLeft: '0',
    padding: '0 0 0 14px',
    boxSizing: 'border-box',
  },
  notificationStack: {
    position: 'relative',
    flex: 1,
    minWidth: 0,
    height: '100%',
    display: 'grid',
    alignContent: 'start',
    gap: 10,
    paddingRight: 58,
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  notificationItem: {
    position: 'relative',
    minHeight: 58,
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    border: '1px solid rgba(148, 163, 184, 0.22)',
    borderRadius: 6,
    padding: '9px 78px 9px 12px',
    boxSizing: 'border-box',
    boxShadow: 'none',
  },
  notificationIcon: {
    width: 42,
    height: 42,
    borderRadius: 4,
    display: 'inline-grid',
    placeItems: 'center',
    flex: '0 0 auto',
    boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.10)',
  },
  notificationCopy: {
    flex: '1 1 auto',
    minWidth: 0,
    display: 'grid',
    gap: 3,
  },
  notificationMeta: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: 850,
    lineHeight: 1,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  notificationText: {
    minWidth: 0,
    color: '#FFFFFF',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 22,
    fontWeight: 900,
    lineHeight: 1.05,
    letterSpacing: '-0.035em',
    textTransform: 'uppercase',
  },
  notificationTime: {
    position: 'absolute',
    top: 13,
    right: 14,
    flex: '0 0 auto',
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: 850,
    lineHeight: 1,
    textTransform: 'uppercase',
  },
  notificationMore: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 46,
    height: 30,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    border: '1px solid rgba(148, 163, 184, 0.24)',
    borderRadius: 6,
    background: 'rgba(15, 23, 42, 0.88)',
    color: '#94A3B8',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: '0.02em',
  },
  notificationFreshness: {
    color: '#64748B',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: '0.06em',
    paddingLeft: 58,
    textTransform: 'uppercase',
  },
  annunciatorRight: {
    width: 168,
    flex: '0 0 168px',
    display: 'grid',
    justifyItems: 'end',
    alignContent: 'center',
    gap: 8,
    minWidth: 0,
    borderRadius: 6,
    background: '#111821',
    padding: '12px 14px',
    boxShadow: 'inset 0 0 0 1px rgba(148, 163, 184, 0.18)',
  },
  annunciatorKicker: { color: '#94A3B8', fontSize: 12, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', lineHeight: 1 },
  annunciatorVerdict: { marginTop: 7, color: '#FFFFFF', fontSize: 31, fontWeight: 950, lineHeight: 0.96, letterSpacing: '-0.035em', textTransform: 'uppercase' },
  annunciatorSubcopy: { marginTop: 8, color: '#CBD5E1', fontSize: 15, fontWeight: 760, lineHeight: 1.12 },
  annunciatorTicker: {
    marginTop: 8,
    color: '#FFFFFF',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 23,
    fontWeight: 900,
    lineHeight: 1,
    letterSpacing: '-0.025em',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  annunciatorFreshness: { color: '#FFFFFF', fontSize: 24, fontWeight: 850, lineHeight: 1.05, textAlign: 'right' },
  liveLed: { position: 'relative', width: 26, height: 26, display: 'inline-flex', flex: '0 0 auto' },
  liveLedPulse: { position: 'absolute', inset: 0, borderRadius: '50%', background: '#FFFFFF', opacity: 0.72, animation: 'sparta-live-ping 1.6s ease-out infinite' },
  liveLedCore: { position: 'relative', width: 26, height: 26, borderRadius: '50%', background: '#FFFFFF', boxShadow: '0 0 18px rgba(255,255,255,0.9)' },
  globalLeft: { minWidth: 0 },
  globalRight: { display: 'grid', alignContent: 'center', justifyItems: 'end', gap: 12 },
  kicker: {
    color: C.muted,
    fontSize: 20,
    fontWeight: 850,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    lineHeight: 1.05,
  },
  globalVerdict: {
    marginTop: 6,
    fontSize: 54,
    fontWeight: 900,
    lineHeight: 0.95,
    letterSpacing: '-0.02em',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  blockerSentence: {
    marginTop: 8,
    color: C.text,
    fontSize: 24,
    fontWeight: 760,
    lineHeight: 1.05,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
  },
  freshness: { color: C.secondary, fontSize: 16, fontWeight: 760, lineHeight: 1.12 },
  nextAction: { color: C.text, fontSize: 20, fontWeight: 820, lineHeight: 1.08 },
  grid: {
    position: 'absolute',
    left: 28,
    top: 238,
    right: 376,
    bottom: 28,
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
    gap: 28,
  },
  tile: {
    position: 'relative',
    minWidth: 0,
    minHeight: 0,
    display: 'grid',
    gridTemplateRows: '64px minmax(0, 1fr) 86px',
    gap: 0,
    padding: '24px 24px 20px 26px',
    border: '0',
    borderLeft: '12px solid transparent',
    borderRadius: '0 8px 8px 0',
    background: C.surfaceCard,
    color: C.text,
    textAlign: 'left',
    cursor: 'pointer',
    overflow: 'hidden',
  },
  tileHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, minWidth: 0 },
  tileTitleGroup: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
  tileTitle: { color: C.text, fontSize: 24, fontWeight: 900, lineHeight: 1.05, letterSpacing: '0.035em', textTransform: 'uppercase', minWidth: 0 },
  statusDot: { width: 30, height: 30, borderRadius: '50%', flex: '0 0 auto' },
  metricBlock: { alignSelf: 'stretch', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 8 },
  metricWrap: { alignSelf: 'center', minWidth: 0, display: 'flex', alignItems: 'center', overflowWrap: 'anywhere' },
  primaryMetric: { color: C.text, fontSize: 68, fontWeight: 950, lineHeight: 0.9, letterSpacing: '-0.035em', whiteSpace: 'nowrap' },
  metricTitle: { marginTop: 10, fontSize: 34, fontWeight: 950, lineHeight: 1, letterSpacing: '0.04em', textTransform: 'uppercase', overflowWrap: 'normal', wordBreak: 'normal' },
  primaryLabel: { marginTop: 0, color: C.secondary, fontSize: 20, fontWeight: 850, lineHeight: 1.05, textTransform: 'uppercase', letterSpacing: '0.025em' },
  secondaryLine: {
    alignSelf: 'stretch',
    paddingTop: 12,
    borderTop: '1px solid rgba(148, 163, 184, 0.18)',
    fontSize: 18,
    fontWeight: 800,
    lineHeight: 1.12,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
    overflowWrap: 'anywhere',
  },
  voiceAction: { color: C.secondary, fontSize: 18, fontWeight: 780, lineHeight: 1.08, overflowWrap: 'anywhere' },
  embryMast: {
    position: 'absolute',
    top: 24,
    right: 28,
    bottom: 28,
    width: 320,
    border: '0',
    borderLeft: `8px solid #1F2937`,
    borderRadius: 0,
    background: '#0B1118',
    display: 'grid',
    gridTemplateRows: 'auto auto auto 1fr auto',
    justifyItems: 'center',
    gap: 14,
    padding: '18px 16px',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  orb: {
    display: 'grid',
    placeItems: 'center',
    boxSizing: 'border-box',
    overflow: 'visible',
  },
  voiceState: { fontSize: 42, fontWeight: 900, lineHeight: 0.95, letterSpacing: '0.02em', textAlign: 'center' },
  heardLine: { color: C.secondary, fontSize: 22, fontWeight: 740, lineHeight: 1.12, textAlign: 'center' },
  voiceChipGrid: { width: '100%', display: 'grid', gap: 10, alignContent: 'start' },
  voiceChip: {
    minHeight: 48,
    width: '100%',
    borderRadius: 0,
    border: '0',
    background: 'transparent',
    color: C.secondary,
    fontSize: 20,
    fontWeight: 820,
    lineHeight: 1.08,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    textAlign: 'left',
    padding: '6px 0',
  },
  voiceChipIcon: {
    width: 34,
    height: 34,
    borderRadius: '50%',
    display: 'inline-grid',
    placeItems: 'center',
    flex: '0 0 auto',
    background: '#1F2937',
    color: '#6B7280',
  },
  selectedTarget: { width: '100%', color: C.secondary, fontSize: 20, fontWeight: 740, lineHeight: 1.15, textAlign: 'center' },
  triageHeader: {
    position: 'absolute',
    left: 28,
    top: 24,
    right: 28,
    height: 128,
    border: `2px solid ${C.border}`,
    borderRadius: 8,
    background: C.surfacePanel,
    display: 'grid',
    gridTemplateColumns: '1fr auto 240px 360px',
    alignItems: 'center',
    gap: 24,
    padding: '16px 24px',
    boxSizing: 'border-box',
  },
  triageTitle: { margin: 0, color: C.text, fontSize: 64, fontWeight: 900, lineHeight: 0.95 },
  headerMetric: { display: 'grid', gap: 4, justifyItems: 'end', color: C.text },
  triageBody: { position: 'absolute', left: 28, right: 28, top: 176, bottom: 28, display: 'grid', gridTemplateColumns: '65fr 35fr', gap: 24, overflow: 'hidden' },
  transcriptPanel: { border: `2px solid ${C.border}`, borderRadius: 8, background: C.surfacePanel, padding: 24, display: 'grid', gap: 18, alignContent: 'start', overflow: 'hidden' },
  transcriptBlock: { minWidth: 0 },
  transcriptLabel: { color: C.muted, fontSize: 26, fontWeight: 850, letterSpacing: '0.1em', lineHeight: 1, marginBottom: 8 },
  transcriptText: { color: C.text, fontSize: 38, fontWeight: 760, lineHeight: 1.16 },
  triageRail: { position: 'relative', minWidth: 0, minHeight: 0, display: 'grid', gridTemplateRows: '1fr auto auto', gap: 16, overflow: 'hidden' },
  actionPanel: { border: `2px solid ${C.border}`, borderRadius: 8, background: C.surfacePanel, padding: 20, overflow: 'hidden' },
  panelLabel: { color: C.muted, fontSize: 22, fontWeight: 850, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 },
  blockerList: { margin: 0, paddingLeft: 26, color: C.text, fontSize: 26, fontWeight: 720, lineHeight: 1.16 },
  primaryAction: {
    minHeight: 72,
    borderRadius: 8,
    border: `2px solid ${C.listeningBorder}`,
    background: C.listeningBg,
    color: C.listeningFg,
    fontSize: 30,
    fontWeight: 850,
    cursor: 'pointer',
  },
}
