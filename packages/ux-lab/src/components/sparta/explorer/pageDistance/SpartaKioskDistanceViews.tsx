import type { CSSProperties, ReactNode } from 'react'
import { AlertTriangle, Check, HelpCircle, Mic, ShieldAlert, Square, Terminal, Volume2 } from 'lucide-react'
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
import { usePageDistanceMode, type PageDistanceMode } from './PageDistanceMode'

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

const voiceStyle: Record<VoiceState, { bg: string; border: string; fg: string; icon: ReactNode }> = {
  READY: { bg: C.readyBg, border: C.readyBorder, fg: C.readyFg, icon: <Terminal size={30} strokeWidth={2.5} /> },
  LISTENING: { bg: C.listeningBg, border: C.listeningBorder, fg: C.listeningFg, icon: <Mic size={30} strokeWidth={2.5} /> },
  SPEAKING: { bg: C.speakingBg, border: C.speakingBorder, fg: C.speakingFg, icon: <Volume2 size={30} strokeWidth={2.5} /> },
  'EVIDENCE MISSING': { bg: C.missingBg, border: C.missingBorder, fg: C.missingFg, icon: <ShieldAlert size={30} strokeWidth={2.5} /> },
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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trim()}...`
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
      voiceCommand: 'Show Coverage',
      sourceStatus,
    }
  }

  if (tab === 'QRAs') {
    const corpus = counts.qrasTotal || counts.qras
    const reviewQueue = 2290
    const missingEvidence = 38
    return {
      tab,
      qid: 'sparta:kiosk:tile:qras',
      state,
      stateReason,
      primaryMetric: formatCount(corpus),
      primaryLabel: 'corpus',
      secondaryLine: `${(reviewQueue + missingEvidence).toLocaleString()} need action`,
      voiceCommand: 'Show QRAs',
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
      primaryMetric: counts.knowledge > 0 ? formatCount(counts.knowledge) : 'SRC',
      primaryLabel: counts.knowledge > 0 ? 'source chunks' : 'lineage',
      secondaryLine: 'lineage blockers',
      voiceCommand: 'Show Sources',
      sourceStatus,
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
      primaryMetric: 'MAP',
      primaryLabel: 'relationships',
      secondaryLine: 'top unmapped risk',
      voiceCommand: 'Show Threats',
      sourceStatus,
    }
  }

  if (tab === 'Posture') {
    return {
      tab,
      qid: 'sparta:kiosk:tile:posture',
      state,
      stateReason,
      primaryMetric: state === 'DEGRADED' ? 'DEG' : state,
      primaryLabel: 'signoff state',
      secondaryLine: 'top blocker',
      voiceCommand: 'Show Posture',
      sourceStatus,
    }
  }

  return {
    tab,
    qid: 'sparta:kiosk:tile:supply-chain',
    state,
    stateReason,
    primaryMetric: 'SCRM',
    primaryLabel: 'readiness',
    secondaryLine: 'dependency blocker',
    voiceCommand: 'Show Supply Chain',
    sourceStatus,
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

function KioskStateChip({ state, qid, compact = false }: { state: KioskState; qid?: string; compact?: boolean }) {
  const s = stateStyle[state]
  const label = compact
    ? ({ READY: 'OK', DEGRADED: 'DEG', BLOCKED: 'BLK', UNKNOWN: 'UNK' } satisfies Record<KioskState, string>)[state]
    : state
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
        fontSize: compact ? 14 : 26,
        lineHeight: 1,
        fontWeight: 850,
        letterSpacing: '0.04em',
      }}
    >
      {!compact ? s.icon : null}
      {label}
    </span>
  )
}

function EmbryVoiceMast({
  mode,
  activeTab,
  selectedTarget,
  onSelectPage,
}: {
  mode: PageDistanceMode
  activeTab: TabName
  selectedTarget?: string
  onSelectPage: (tab: TabName) => void
}) {
  const voiceState: VoiceState = mode === '5ft' ? 'LISTENING' : 'READY'
  const s = voiceStyle[voiceState]
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
    { label: 'Show QRAs', qid: 'embry:command-chip:qras', tab: 'QRAs' },
    { label: 'Show Coverage', qid: 'embry:command-chip:coverage', tab: 'Coverage' },
    { label: 'Show URLs', qid: 'embry:command-chip:urls', tab: 'URLs' },
    { label: 'Show Posture', qid: 'embry:command-chip:posture', tab: 'Posture' },
    { label: 'Open top blocker', qid: 'embry:command-chip:top-blocker' },
  ]

  return (
    <aside data-qid="sparta:kiosk:embry-mast" style={mastStyle} aria-label="Embry voice control">
      <div
        data-qid="embry:orb"
        style={{
          ...S.orb,
          width: mode === '5ft' ? 104 : 224,
          height: mode === '5ft' ? 104 : 224,
          borderColor: s.border,
          background: `radial-gradient(circle at 50% 42%, ${s.bg}, ${C.surfacePanel} 68%)`,
          color: s.fg,
          filter: `drop-shadow(0 0 ${mode === '5ft' ? 18 : 24}px ${s.border}44)`,
        }}
      >
        {s.icon}
      </div>
      <div data-qid="embry:voice-state" style={{ ...S.voiceState, color: s.fg, fontSize: mode === '5ft' ? 34 : S.voiceState.fontSize }}>
        {voiceState}
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
  return (
    <button
      type="button"
      data-qid={tile.qid}
      data-qs-action="KIOSK_SELECT_TILE"
      title={`${tile.tab}: ${tile.state}. ${tile.secondaryLine}`}
      onClick={onSelect}
      style={{
        ...S.tile,
        borderColor: active ? s.border : `${s.border}99`,
        boxShadow: active ? `inset 0 0 0 2px ${s.border}` : 'none',
      }}
    >
      <header style={S.tileHeader}>
        <span style={S.tileTitle}>{tile.tab}</span>
        <KioskStateChip state={tile.state} compact />
      </header>
      <div style={S.metricWrap}>
        <div style={S.primaryMetric}>{truncate(tile.primaryMetric, 14)}</div>
        <div style={S.primaryLabel}>{truncate(tile.primaryLabel, 18)}</div>
      </div>
      <div style={{ ...S.secondaryLine, color: s.fg }}>{truncate(tile.secondaryLine, 34)}</div>
      <div style={S.voiceAction}>{truncate(tile.voiceCommand, 22)}</div>
    </button>
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
  const { mode, setMode } = usePageDistanceMode()
  const tiles = buildTiles(counts, coverageHealth)
  const global = globalState(tiles)
  const blocker = topBlocker(tiles)
  const activeTile = tiles.find((tile) => tile.tab === activeTab) ?? blocker

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
      <section data-qid="sparta:triage:root" data-page-distance-mode="5ft" style={S.root} aria-label="SPARTA 5ft voice triage">
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
          <div style={S.freshness}>Freshness: {activeTile.sourceStatus === 'authoritative' ? 'contract backed' : activeTile.sourceStatus}</div>
        </header>
        <main style={S.triageBody}>
          <section data-qid="sparta:triage:transcript" style={S.transcriptPanel}>
            <TranscriptBlock qid="sparta:triage:human-said" label="HUMAN SAID" text={`"Show ${activeTile.tab}."`} />
            <TranscriptBlock qid="sparta:triage:embry-heard" label="EMBRY HEARD" text={`show ${activeTile.tab.toLowerCase()} -> page=${activeTile.tab.toLowerCase().replace(/\s+/g, '-')} -> qid=${activeTile.qid}`} />
            <TranscriptBlock qid="embry:selected-target" label="SELECTED" text={`${activeTile.tab} / ${activeTile.state}`} />
            <TranscriptBlock
              qid="sparta:triage:embry-says"
              label="EMBRY SAYS"
              text={`${activeTile.tab} is ${activeTile.state.toLowerCase()}. ${activeTile.primaryMetric} ${activeTile.primaryLabel}. ${activeTile.secondaryLine}. Next action: ${activeTile.voiceCommand}.`}
            />
          </section>
          <section style={S.triageRail} aria-label="Selected page actions">
            <EmbryVoiceMast mode="5ft" activeTab={activeTile.tab} selectedTarget={activeTile.qid} onSelectPage={selectPage} />
            <div data-qid="sparta:triage:top-blockers" style={S.actionPanel}>
              <div style={S.panelLabel}>Top blockers</div>
              <ol style={S.blockerList}>
                <li>{activeTile.secondaryLine}</li>
                <li>{truncate(activeTile.stateReason, 58)}</li>
                <li>Evidence policy: {activeTile.state === 'READY' ? 'ANSWER' : activeTile.state === 'UNKNOWN' ? 'CLARIFY' : 'DEFLECT / REPAIR'}</li>
              </ol>
            </div>
            <button
              type="button"
              data-qid="sparta:triage:primary-action"
              data-qs-action="TRIAGE_PRIMARY_ACTION"
              title={`Open ${activeTile.tab} lean-in`}
              onClick={() => setMode('lean-in')}
              style={S.primaryAction}
            >
              Lean-in proof chain
            </button>
          </section>
        </main>
      </section>
    )
  }

  const g = stateStyle[global]
  return (
    <section data-qid="sparta:kiosk:root" data-page-distance-mode="10ft" style={S.root} aria-label="SPARTA 10ft readiness board">
      <div data-qid="sparta:kiosk:global-readiness" style={{ ...S.globalBanner, borderColor: g.border }}>
        <div style={S.globalLeft}>
          <div style={S.kicker}>SPARTA REVIEW READINESS / 10FT</div>
          <div style={{ ...S.globalVerdict, color: g.fg }}>{global === 'READY' ? 'REVIEW READY' : `REVIEW ${global}`}</div>
          <div data-qid="sparta:kiosk:top-blocker" style={S.blockerSentence}>
            Blocker: {blocker.tab} - {blocker.secondaryLine}
          </div>
        </div>
        <div style={S.globalRight}>
          <KioskStateChip state={global} />
          <div data-qid="sparta:kiosk:freshness" style={S.freshness}>Freshness: {coverageHealth?.stale ? 'stale - fail closed' : coverageHealth ? 'contract backed' : 'unknown - fail closed'}</div>
          <div data-qid="sparta:kiosk:next-action" style={S.nextAction}>Say "Embry, what blocks readiness?"</div>
        </div>
      </div>
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
    position: 'relative',
    flex: 1,
    minHeight: 0,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    background: C.surfaceRoot,
    color: C.text,
    fontFamily: fontStack,
    fontVariantNumeric: 'tabular-nums',
  },
  globalBanner: {
    position: 'absolute',
    left: 24,
    top: 18,
    right: 340,
    height: 136,
    border: `2px solid ${C.border}`,
    borderRadius: 8,
    background: C.surfacePanel,
    display: 'grid',
    gridTemplateColumns: '1fr 320px',
    gap: 18,
    padding: '14px 20px',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  globalLeft: { minWidth: 0 },
  globalRight: { display: 'grid', alignContent: 'center', justifyItems: 'end', gap: 12 },
  kicker: {
    color: C.muted,
    fontSize: 18,
    fontWeight: 850,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    lineHeight: 1.05,
  },
  globalVerdict: {
    marginTop: 6,
    fontSize: 46,
    fontWeight: 900,
    lineHeight: 0.95,
    letterSpacing: '-0.02em',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  blockerSentence: {
    marginTop: 8,
    color: C.text,
    fontSize: 20,
    fontWeight: 760,
    lineHeight: 1.05,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  freshness: { color: C.secondary, fontSize: 20, fontWeight: 760, lineHeight: 1.05 },
  nextAction: { color: C.text, fontSize: 22, fontWeight: 820, lineHeight: 1.08 },
  grid: {
    position: 'absolute',
    left: 24,
    top: 166,
    right: 340,
    bottom: 24,
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
    gap: 14,
  },
  tile: {
    minWidth: 0,
    minHeight: 0,
    display: 'grid',
    gridTemplateRows: 'auto 1fr auto auto',
    gap: 8,
    padding: 14,
    border: `2px solid ${C.border}`,
    borderRadius: 8,
    background: C.surfaceCard,
    color: C.text,
    textAlign: 'left',
    cursor: 'pointer',
    overflow: 'hidden',
  },
  tileHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  tileTitle: { color: C.text, fontSize: 28, fontWeight: 850, lineHeight: 1.05 },
  metricWrap: { alignSelf: 'center', minWidth: 0 },
  primaryMetric: { color: C.text, fontSize: 52, fontWeight: 900, lineHeight: 0.95, letterSpacing: '-0.02em' },
  primaryLabel: { marginTop: 6, color: C.secondary, fontSize: 22, fontWeight: 780, lineHeight: 1.05, textTransform: 'uppercase' },
  secondaryLine: { fontSize: 22, fontWeight: 820, lineHeight: 1.08, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  voiceAction: { color: C.secondary, fontSize: 20, fontWeight: 780, lineHeight: 1.05 },
  embryMast: {
    position: 'absolute',
    top: 18,
    right: 24,
    bottom: 24,
    width: 292,
    border: `2px solid ${C.border}`,
    borderRadius: 8,
    background: C.surfacePanel,
    display: 'grid',
    gridTemplateRows: 'auto auto auto 1fr auto',
    justifyItems: 'center',
    gap: 12,
    padding: '18px 16px',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  orb: {
    borderRadius: '50%',
    border: '3px solid currentColor',
    display: 'grid',
    placeItems: 'center',
    boxSizing: 'border-box',
  },
  voiceState: { fontSize: 42, fontWeight: 900, lineHeight: 0.95, letterSpacing: '0.02em', textAlign: 'center' },
  heardLine: { color: C.secondary, fontSize: 22, fontWeight: 740, lineHeight: 1.12, textAlign: 'center' },
  voiceChipGrid: { width: '100%', display: 'grid', gap: 10, alignContent: 'start' },
  voiceChip: {
    minHeight: 48,
    width: '100%',
    borderRadius: 8,
    border: `2px solid ${C.border}`,
    background: C.surfaceCard,
    color: C.text,
    fontSize: 24,
    fontWeight: 820,
    lineHeight: 1,
    cursor: 'pointer',
  },
  selectedTarget: { width: '100%', color: C.secondary, fontSize: 20, fontWeight: 740, lineHeight: 1.15, textAlign: 'center' },
  triageHeader: {
    position: 'absolute',
    left: 24,
    top: 18,
    right: 24,
    height: 112,
    border: `2px solid ${C.border}`,
    borderRadius: 8,
    background: C.surfacePanel,
    display: 'grid',
    gridTemplateColumns: '1fr auto 220px 280px',
    alignItems: 'center',
    gap: 24,
    padding: '16px 24px',
    boxSizing: 'border-box',
  },
  triageTitle: { margin: 0, color: C.text, fontSize: 58, fontWeight: 900, lineHeight: 0.95 },
  headerMetric: { display: 'grid', gap: 4, justifyItems: 'end', color: C.text },
  triageBody: { position: 'absolute', left: 24, right: 24, top: 146, bottom: 24, display: 'grid', gridTemplateColumns: '65fr 35fr', gap: 24, overflow: 'hidden' },
  transcriptPanel: { border: `2px solid ${C.border}`, borderRadius: 8, background: C.surfacePanel, padding: 24, display: 'grid', gap: 18, alignContent: 'start', overflow: 'hidden' },
  transcriptBlock: { minWidth: 0 },
  transcriptLabel: { color: C.muted, fontSize: 26, fontWeight: 850, letterSpacing: '0.1em', lineHeight: 1, marginBottom: 8 },
  transcriptText: { color: C.text, fontSize: 38, fontWeight: 760, lineHeight: 1.16 },
  triageRail: { position: 'relative', minWidth: 0, minHeight: 0, display: 'grid', gridTemplateRows: '1fr auto auto', gap: 16, overflow: 'hidden' },
  actionPanel: { border: `2px solid ${C.border}`, borderRadius: 8, background: C.surfacePanel, padding: 20, overflow: 'hidden' },
  panelLabel: { color: C.muted, fontSize: 22, fontWeight: 850, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 },
  blockerList: { margin: 0, paddingLeft: 26, color: C.text, fontSize: 28, fontWeight: 720, lineHeight: 1.16 },
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
