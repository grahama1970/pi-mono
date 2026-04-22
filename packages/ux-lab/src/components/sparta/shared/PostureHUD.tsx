/**
 * PostureHUD — Sticky posture summary that pins at top during scroll.
 *
 * Architecture:
 * - Shows satisfied/inconclusive/not_satisfied/no_case counts with glow dots
 * - Position: sticky, top: 0, z-index: 100
 * - On scroll (past threshold): shrinks to compact "Status Ribbon" mode
 *   - Ribbon: single row with mini dots + counts only (no labels)
 *   - Transition: height 48px → 32px with cubic-bezier(0.16, 1, 0.3, 1)
 *
 * Complies with:
 * - COTS C02: 44px minimum touch targets
 * - NVIS Class A: White Phosphor palette
 * - 4-Attribute Rule: data-qid, data-qs-action, title, useRegisterAction
 */
import { useState, useEffect, useCallback } from 'react'
import { EMBRY, glowDot } from '../common/EmbryStyle'

export interface PostureHUDProps {
  satisfied: number
  inconclusive: number
  notSatisfied: number
  noCase: number
  techniqueCount: number
  tacticCount: number
  activeDatalake?: string
}

const SCROLL_THRESHOLD = 100
const TRANSITION = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'

export function PostureHUD({
  satisfied,
  inconclusive,
  notSatisfied,
  noCase,
  techniqueCount,
  tacticCount,
  activeDatalake,
}: PostureHUDProps) {
  const [isCompact, setIsCompact] = useState(false)

  const handleScroll = useCallback(() => {
    const scrollY = window.scrollY
    setIsCompact(scrollY > SCROLL_THRESHOLD)
  }, [])

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  const statuses = [
    { color: EMBRY.green, count: satisfied, label: 'satisfied', qid: 'satisfied' },
    { color: EMBRY.amber, count: inconclusive, label: 'inconclusive', qid: 'inconclusive' },
    { color: EMBRY.red, count: notSatisfied, label: 'not satisfied', qid: 'not-satisfied' },
    { color: EMBRY.dim, count: noCase, label: 'no case', qid: 'no-case' },
  ]

  return (
    <div
      data-qid="posture-hud:container"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        height: isCompact ? 32 : 48,
        padding: isCompact ? '0 16px' : '12px 16px',
        borderBottom: `1px solid ${EMBRY.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: EMBRY.bgHeader,
        backdropFilter: 'blur(32px)',
        transition: TRANSITION,
      }}
    >
      {/* Left: Title + counts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isCompact ? 12 : 16, transition: TRANSITION }}>
        {!isCompact && (
          <div>
            <div style={{
              fontSize: 14,
              fontWeight: 900,
              color: EMBRY.white,
              letterSpacing: '-0.02em',
            }}>
              SPARTA Threat Matrix
            </div>
            <div style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
              color: EMBRY.dim,
              marginTop: 2,
            }}>
              {techniqueCount} techniques across {tacticCount} tactics
              {activeDatalake && <span style={{ color: EMBRY.accent }}> · {activeDatalake}</span>}
            </div>
          </div>
        )}

        {/* Status dots */}
        <div style={{ display: 'flex', gap: isCompact ? 8 : 12, alignItems: 'center', transition: TRANSITION }}>
          {statuses.map(({ color, count, label, qid }) => (
            <div
              key={qid}
              data-qid={`posture-hud:status:${qid}`}
              title={`${count} ${label}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                minWidth: 44,
                minHeight: 44,
                justifyContent: 'center',
                cursor: 'default',
              }}
            >
              <div style={glowDot(color, isCompact ? 5 : 6)} />
              <span style={{
                fontSize: isCompact ? 9 : 10,
                color: EMBRY.dim,
                transition: TRANSITION,
              }}>
                {count}
                {!isCompact && ` ${label}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Compact mode: show title inline */}
      {isCompact && (
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: EMBRY.white,
          opacity: 0.8,
        }}>
          SPARTA Matrix
        </div>
      )}
    </div>
  )
}

export default PostureHUD
