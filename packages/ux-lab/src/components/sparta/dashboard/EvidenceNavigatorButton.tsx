/**
 * EvidenceNavigatorButton — Tactical HUD button for aerospace compliance analysis.
 *
 * Design: NVIS Cyan (#00D1FF) glassmorphic style with node-graph icon.
 * Placement: Anchored to Posture Score card, not floating.
 */
import React from 'react'
import { motion } from 'framer-motion'

interface EvidenceNavigatorButtonProps {
  contextId?: string
  onClick: (contextId?: string) => void
  label?: string
}

export function EvidenceNavigatorButton({
  contextId,
  onClick,
  label = 'Analyze Proof Chain'
}: EvidenceNavigatorButtonProps) {
  return (
    <motion.button
      data-qid="posture:button:analyze-proof-chain"
      data-qs-action="ANALYZE_PROOF_CHAIN"
      title="Analyze evidence chain gaps and proof obligations"
      whileHover={{
        scale: 1.02,
        boxShadow: '0 0 20px rgba(0, 209, 255, 0.4)'
      }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onClick(contextId)}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        minHeight: 44,
        background: 'rgba(0, 209, 255, 0.06)',
        border: '1px solid rgba(0, 209, 255, 0.25)',
        borderRadius: 6,
        cursor: 'pointer',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        transition: 'all 0.2s ease',
        overflow: 'hidden',
      }}
    >
      {/* Node-Graph Logic Icon */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        style={{
          stroke: 'rgba(0, 209, 255, 0.9)',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          flexShrink: 0,
        }}
      >
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>

      {/* Label with tactical styling */}
      <span style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'rgba(0, 209, 255, 0.9)',
        textShadow: '0 0 8px rgba(0, 209, 255, 0.5)',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>

      {/* Scanning glow effect on hover (CSS handles via parent hover) */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(90deg, transparent, rgba(0, 209, 255, 0.08), transparent)',
        opacity: 0,
        transition: 'opacity 0.3s ease',
        pointerEvents: 'none',
      }} className="scan-glow" />
    </motion.button>
  )
}

export default EvidenceNavigatorButton
