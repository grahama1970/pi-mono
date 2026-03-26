/**
 * S04 LyricsEditor — Notion-style lyrics editor with phonetic timing popover
 * Stitch screen 4b5e9e89 reference implementation
 *
 * Features:
 *   • Colored section left-border (Notion-style blocks)
 *   • Emotional word emphasis per phrase (heart-tag colors)
 *   • Click word → inline phonetic timing popover (syllable boxes)
 *   • Emotion / dynamics / vocal pills — click to cycle via picker
 *   • Convergence round counter in header
 */

import { useState, useRef, useEffect } from 'react'
import { EMBRY, card, panel, heading, label } from '../sparta/common/EmbryStyle'
import type { Phrase, Syllable, RoundResult } from './sampleMusicData'

// ── Design maps ──────────────────────────────────────────────────────────────

const SEC_COL: Record<string, string> = {
  verse: EMBRY.blue,
  chorus: EMBRY.accent,
  bridge: EMBRY.amber,
  outro: EMBRY.dim,
}

const EMO_COL: Record<string, string> = {
  anger: '#ff4444', fear: '#a78bfa', joy: EMBRY.green,
  neutral: EMBRY.white, sadness: '#4a9eff', trust: '#34d399',
  // alias map for raw model values
  melancholic: '#4a9eff', desolate: '#4a9eff', anxious: '#a78bfa',
  resigned: EMBRY.white, hopeful: EMBRY.green, triumphant: EMBRY.green,
  resolute: '#34d399',
}

const DYN_COL: Record<string, string> = {
  pp: '#64748b', p: '#94a3b8', mp: '#cbd5e1',
  mf: EMBRY.amber, f: '#fb923c', ff: '#ff4444',
}

const VOC_COL: Record<string, string> = {
  whisper: '#a78bfa', breathy: '#a78bfa', speak: EMBRY.dim,
  sing: EMBRY.blue, belt: '#fb923c', falsetto: '#4a9eff',
  growl: '#ff4444', rap: EMBRY.amber,
}

const EMOTIONS_LIST = ['anger', 'fear', 'joy', 'neutral', 'sadness', 'trust'] as const
const DYNAMICS_LIST = ['pp', 'p', 'mp', 'mf', 'f', 'ff'] as const
const VOCALS_LIST   = ['whisper', 'speak', 'sing', 'belt', 'falsetto', 'growl'] as const

// ── Syllable → word mapping ──────────────────────────────────────────────────

function syllableCount(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '')
  if (clean.length === 0) return 0
  if (clean.length <= 2) return 1
  const groups = clean.match(/[aeiouy]+/g) ?? []
  let n = groups.length
  if (clean.endsWith('e') && n > 1) n -= 1
  return Math.max(1, n)
}

function mapSyllablesToWords(words: string[], syllables: Syllable[]): Syllable[][] {
  const result: Syllable[][] = []
  let si = 0
  for (const word of words) {
    const need = Math.min(syllableCount(word), syllables.length - si)
    result.push(need > 0 ? syllables.slice(si, si + need) : [])
    si += Math.max(0, need)
  }
  return result
}

// ── PhoneticPopover ──────────────────────────────────────────────────────────

function PhoneticPopover({
  syllables, word, onClose,
}: {
  syllables: Syllable[]
  word: string
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} style={{
      position: 'absolute', top: '100%', left: 0, zIndex: 200, marginTop: 6,
      ...panel, borderRadius: 10, padding: '10px 12px', minWidth: 140,
      boxShadow: `0 12px 32px rgba(0,0,0,0.72), 0 0 0 1px ${EMBRY.accent}33`,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* Popover header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ ...label, fontSize: 8 }}>phonetic · {word}</span>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: EMBRY.dim,
          cursor: 'pointer', fontSize: 10, padding: 0, lineHeight: 1,
        }}>✕</button>
      </div>

      {/* Syllable boxes */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {syllables.length === 0
          ? <span style={{ fontSize: 10, color: EMBRY.dim, fontStyle: 'italic' }}>no timing data</span>
          : syllables.map((s, i) => (
            <div key={i} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              backgroundColor: s.stress ? `${EMBRY.accent}22` : EMBRY.bgDeep,
              border: `1px solid ${s.stress ? EMBRY.accent : EMBRY.border}`,
              borderRadius: 6, padding: '5px 8px', minWidth: 34,
            }}>
              <span style={{
                fontSize: 13, fontFamily: 'monospace',
                fontWeight: s.stress ? 900 : 400,
                color: s.stress ? EMBRY.white : EMBRY.dim,
              }}>{s.text}</span>
              <span style={{ fontSize: 8, color: EMBRY.amber, fontFamily: 'monospace' }}>
                ♩{s.beat.toFixed(2)}
              </span>
              <span style={{ fontSize: 7, color: `${EMBRY.dim}99`, fontFamily: 'monospace' }}>
                +{s.hold_beats.toFixed(2)}
              </span>
              {s.stress && (
                <span style={{ fontSize: 6, color: EMBRY.accent, letterSpacing: '0.1em', fontWeight: 800 }}>
                  STRESS
                </span>
              )}
            </div>
          ))}
      </div>
    </div>
  )
}

// ── WordChip ─────────────────────────────────────────────────────────────────

function WordChip({ word, emoColor, syllables }: {
  word: string; emoColor: string; syllables: Syllable[]
}) {
  const [open, setOpen] = useState(false)
  const hasSyl = syllables.length > 0

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span
        onClick={() => hasSyl && setOpen(v => !v)}
        title={hasSyl ? `${syllables.length} syllable${syllables.length > 1 ? 's' : ''} — click to inspect` : undefined}
        style={{
          display: 'inline-block', cursor: hasSyl ? 'pointer' : 'default',
          color: emoColor,
          backgroundColor: hasSyl ? `${emoColor}12` : 'transparent',
          border: hasSyl ? `1px solid ${emoColor}28` : '1px solid transparent',
          borderRadius: 3, padding: '0 2px',
          fontSize: 14, fontWeight: hasSyl ? 600 : 400, lineHeight: 1.9,
          transition: 'background-color 0.1s',
        }}
      >{word}</span>
      {open && (
        <PhoneticPopover syllables={syllables} word={word} onClose={() => setOpen(false)} />
      )}
    </span>
  )
}

// ── Pill ─────────────────────────────────────────────────────────────────────

function Pill({ value, color, onClick }: { value: string; color: string; onClick?: () => void }) {
  return (
    <span onClick={onClick} style={{
      fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
      color, backgroundColor: `${color}18`, border: `1px solid ${color}40`,
      letterSpacing: '0.06em', textTransform: 'uppercase' as const,
      cursor: onClick ? 'pointer' : 'default', flexShrink: 0,
      whiteSpace: 'nowrap' as const, userSelect: 'none' as const,
    }}>{value}</span>
  )
}

// ── SectionDivider ────────────────────────────────────────────────────────────

function SectionDivider({ section }: { section: string }) {
  const color = SEC_COL[section] ?? EMBRY.dim
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px 4px' }}>
      <div style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: color }} />
      <span style={{
        fontSize: 9, fontWeight: 800, textTransform: 'uppercase' as const,
        letterSpacing: '0.15em', color,
      }}>{section}</span>
      <div style={{ flex: 1, height: 1, backgroundColor: `${color}22` }} />
    </div>
  )
}

// ── ConvergenceCounter ────────────────────────────────────────────────────────

function ConvergenceCounter({ rounds }: { rounds: RoundResult[] }) {
  if (rounds.length === 0) return null
  const last = rounds[rounds.length - 1]
  const agg = last.delta.aggregate
  const color = agg <= 0.2 ? EMBRY.green : agg <= 0.35 ? EMBRY.amber : EMBRY.red
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
      <span style={{ ...label, fontSize: 8 }}>round {last.round}</span>
      <span style={{ fontSize: 9, fontWeight: 700, color }}>
        {agg <= 0.2 ? 'converged' : `Δ${agg.toFixed(2)}`}
      </span>
    </div>
  )
}

// ── PhraseBlock ───────────────────────────────────────────────────────────────

type PillTarget = 'emo' | 'dyn' | 'voc' | null

function PhraseBlock({ phrase, index, emoColor, dynColor, vocColor, onEmoChange, onDynChange, onVocChange }: {
  phrase: Phrase; index: number
  emoColor: string; dynColor: string; vocColor: string
  onEmoChange: (i: number, v: string) => void
  onDynChange: (i: number, v: string) => void
  onVocChange: (i: number, v: string) => void
}) {
  const secColor = SEC_COL[phrase.section] ?? EMBRY.dim
  const words = phrase.text.split(/\s+/).filter(w => w.length > 0)
  const sylGroups = phrase.syllables
    ? mapSyllablesToWords(words, phrase.syllables)
    : words.map(() => [] as Syllable[])

  const [editPill, setEditPill] = useState<PillTarget>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editPill) return
    function handler(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setEditPill(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [editPill])

  function pickerColor(map: Record<string, string>, key: string) {
    return map[key] ?? EMBRY.dim
  }

  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${EMBRY.border}` }}>
      {/* Left section color bar */}
      <div style={{ width: 3, flexShrink: 0, backgroundColor: secColor, borderRadius: '3px 0 0 3px', margin: '3px 0' }} />

      {/* Phrase content */}
      <div style={{ flex: 1, padding: '9px 14px 8px 12px', minWidth: 0 }}>
        {/* Bar + word chips row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ ...label, fontSize: 8, color: EMBRY.dim, flexShrink: 0, paddingTop: 5 }}>
            B{phrase.bar}
          </span>
          <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 3, minWidth: 0 }}>
            {words.map((word, wi) => (
              <WordChip
                key={wi}
                word={word}
                emoColor={emoColor}
                syllables={sylGroups[wi] ?? []}
              />
            ))}
          </div>
        </div>

        {/* Pills row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, flexWrap: 'wrap', position: 'relative' }}>
          <Pill
            value={`♥ ${phrase.emotion}`}
            color={emoColor}
            onClick={() => setEditPill(editPill === 'emo' ? null : 'emo')}
          />
          <Pill
            value={phrase.dynamics}
            color={dynColor}
            onClick={() => setEditPill(editPill === 'dyn' ? null : 'dyn')}
          />
          <Pill
            value={phrase.vocal_direction}
            color={vocColor}
            onClick={() => setEditPill(editPill === 'voc' ? null : 'voc')}
          />
          <span style={{ ...label, fontSize: 7, color: `${EMBRY.dim}66` }}>
            {phrase.duration_beats}b
          </span>

          {/* Pill picker popover */}
          {editPill !== null && (
            <div ref={pickerRef} style={{
              position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
              zIndex: 150, backgroundColor: EMBRY.bgPanel,
              border: `1px solid ${EMBRY.border}`, borderRadius: 8,
              padding: '8px 10px', display: 'flex', gap: 5, flexWrap: 'wrap',
              boxShadow: `0 8px 24px rgba(0,0,0,0.65)`, minWidth: 170,
            }}>
              {editPill === 'emo' && EMOTIONS_LIST.map(e => (
                <span key={e} onClick={() => { onEmoChange(index, e); setEditPill(null) }}
                  style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                    cursor: 'pointer', letterSpacing: '0.06em',
                    textTransform: 'uppercase' as const, userSelect: 'none' as const,
                    color: pickerColor(EMO_COL, e),
                    backgroundColor: `${pickerColor(EMO_COL, e)}18`,
                    border: `1px solid ${pickerColor(EMO_COL, e)}40`,
                  }}>{e}</span>
              ))}
              {editPill === 'dyn' && DYNAMICS_LIST.map(d => (
                <span key={d} onClick={() => { onDynChange(index, d); setEditPill(null) }}
                  style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                    cursor: 'pointer', letterSpacing: '0.06em',
                    textTransform: 'uppercase' as const, userSelect: 'none' as const,
                    color: pickerColor(DYN_COL, d),
                    backgroundColor: `${pickerColor(DYN_COL, d)}18`,
                    border: `1px solid ${pickerColor(DYN_COL, d)}40`,
                  }}>{d}</span>
              ))}
              {editPill === 'voc' && VOCALS_LIST.map(v => (
                <span key={v} onClick={() => { onVocChange(index, v); setEditPill(null) }}
                  style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                    cursor: 'pointer', letterSpacing: '0.06em',
                    textTransform: 'uppercase' as const, userSelect: 'none' as const,
                    color: pickerColor(VOC_COL, v),
                    backgroundColor: `${pickerColor(VOC_COL, v)}18`,
                    border: `1px solid ${pickerColor(VOC_COL, v)}40`,
                  }}>{v}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── LyricsEditor (main export) ────────────────────────────────────────────────

interface Props {
  phrases: Phrase[]
  rounds?: RoundResult[]
  onUpdate?: (phrases: Phrase[]) => void
}

export function LyricsEditor({ phrases, rounds = [], onUpdate }: Props) {
  const [emos, setEmos] = useState(() => phrases.map(p => p.emotion))
  const [dyns, setDyns] = useState(() => phrases.map(p => p.dynamics))
  const [vocs, setVocs] = useState(() => phrases.map(p => p.vocal_direction))

  function handleEmoChange(i: number, v: string) {
    setEmos(prev => { const n = [...prev]; n[i] = v; return n })
    if (onUpdate) onUpdate(phrases.map((p, idx) => idx === i ? { ...p, emotion: v } : p))
  }
  function handleDynChange(i: number, v: string) {
    setDyns(prev => { const n = [...prev]; n[i] = v; return n })
    if (onUpdate) onUpdate(phrases.map((p, idx) => idx === i ? { ...p, dynamics: v } : p))
  }
  function handleVocChange(i: number, v: string) {
    setVocs(prev => { const n = [...prev]; n[i] = v; return n })
    if (onUpdate) onUpdate(phrases.map((p, idx) => idx === i ? { ...p, vocal_direction: v } : p))
  }

  // Pre-compute section divider positions
  const showDividerAt = new Set<number>()
  let prevSection = ''
  for (let i = 0; i < phrases.length; i++) {
    if (phrases[i].section !== prevSection) {
      showDividerAt.add(i)
      prevSection = phrases[i].section
    }
  }

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`,
      }}>
        <span style={{ ...heading, fontSize: 13 }}>Lyrics Editor</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ ...label, fontSize: 8 }}>{phrases.length} phrases</span>
          <ConvergenceCounter rounds={rounds} />
        </div>
      </div>

      {/* Phrase blocks */}
      <div style={{ overflowY: 'auto', maxHeight: 420 }}>
        {phrases.map((p, i) => (
          <div key={i}>
            {showDividerAt.has(i) && <SectionDivider section={p.section} />}
            <PhraseBlock
              phrase={{ ...p, emotion: emos[i] ?? p.emotion, dynamics: dyns[i] ?? p.dynamics, vocal_direction: vocs[i] ?? p.vocal_direction }}
              index={i}
              emoColor={EMO_COL[emos[i] ?? ''] ?? EMBRY.white}
              dynColor={DYN_COL[dyns[i] ?? ''] ?? EMBRY.dim}
              vocColor={VOC_COL[vocs[i] ?? ''] ?? EMBRY.dim}
              onEmoChange={handleEmoChange}
              onDynChange={handleDynChange}
              onVocChange={handleVocChange}
            />
          </div>
        ))}
      </div>

      {/* Footer hint */}
      <div style={{ padding: '7px 16px', borderTop: `1px solid ${EMBRY.border}` }}>
        <span style={{ ...label, fontSize: 7, color: `${EMBRY.dim}88` }}>
          ♥ click pills to change · click word to inspect phonetic timing
        </span>
      </div>
    </div>
  )
}
