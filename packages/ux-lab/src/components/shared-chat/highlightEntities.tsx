/**
 * Entity highlighting — shared across Embry Terminal + SPARTA Explorer.
 * Detects compliance entities (NIST controls, CWEs, ATT&CK, SPARTA, frameworks)
 * and skill names (/skill-name) in text, returns JSX with colored chips.
 */
import type { ReactNode } from 'react';
import type { EntityType } from './types';

// Patterns for compliance/security entities + skills
// NOTE: Domain phrases come from /create-evidence-case glossary, NOT hardcoded here
const ENTITY_PATTERN = new RegExp(
  '(' + [
    '\\/[a-z][\\w-]*',                      // Skills: /assess, /dogpile
    '\\b[A-Z]{2}-\\d+(?:\\.\\d+)?\\b',      // NIST controls: AC-17, SC-28, AU-6.1
    '\\bCWE-\\d+\\b',                        // CWEs: CWE-79, CWE-502
    '\\b[TS]A?\\d{4}(?:\\.\\d{3})?\\b',     // ATT&CK: T1059, T1059.001, TA0005
    '\\bCM-\\d{4}\\b',                       // SPARTA countermeasures: CM-0001
    '\\bST-\\d{4}\\b',                       // SPARTA techniques: ST-0012
    '\\bNIST (?:SP )?800-\\d+(?:[a-z])?(?:r\\d)?\\b', // NIST pubs: NIST 800-171
    '\\bCMMC (?:Level )?[1-3]\\b',           // CMMC: CMMC Level 2
    '\\bFedRAMP\\b',                         // FedRAMP
    '\\bISO \\d{5}\\b',                      // ISO: ISO 27001
    '\\bD3FEND\\b',                          // D3FEND
    '\\bATT&CK\\b',                          // ATT&CK
    '\\bSTIG\\b',                            // STIG
  ].join('|') + ')',
  'gi'
);

// Glossary term types from /create-evidence-case daemon
export type GlossaryType = 'control' | 'cwe_weakness' | 'attack_technique' | 'attack_mobile_technique' | 'countermeasure' | 'technique' | 'domain_term';

export interface GlossaryTerm {
  term: string;
  type: GlossaryType;
}

// Build regex from daemon glossary for domain phrase highlighting
export function buildGlossaryPattern(glossary: GlossaryTerm[]): RegExp | null {
  if (!glossary.length) return null;
  const escaped = glossary.map(g => g.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp('\\b(' + escaped.join('|') + ')\\b', 'gi');
}

const ENTITY_STYLES: Record<EntityType, { color: string; bg: string }> = {
  skill:     { color: '#4a9eff', bg: 'rgba(74,158,255,0.08)' },
  control:   { color: '#00ff88', bg: 'rgba(0,255,136,0.08)' },
  cwe:       { color: '#ff6b6b', bg: 'rgba(255,107,107,0.08)' },
  attack:    { color: '#ffaa00', bg: 'rgba(255,170,0,0.08)' },
  framework: { color: '#c084fc', bg: 'rgba(192,132,252,0.08)' },
  sparta:    { color: '#22d3ee', bg: 'rgba(34,211,238,0.08)' },
  domain:    { color: '#f472b6', bg: 'rgba(244,114,182,0.08)' },
};

// Map daemon glossary types to UI EntityType
export function glossaryTypeToEntityType(gType: GlossaryType): EntityType {
  switch (gType) {
    case 'control': return 'control';
    case 'cwe_weakness': return 'cwe';
    case 'attack_technique':
    case 'attack_mobile_technique': return 'attack';
    case 'countermeasure': return 'sparta';
    case 'technique': return 'sparta';
    case 'domain_term':
    default: return 'domain';
  }
}

export function classifyEntity(token: string): EntityType {
  if (token.startsWith('/')) return 'skill';
  if (/^CWE-/.test(token)) return 'cwe';
  if (/^[TS]A?\d{4}/.test(token)) return 'attack';
  if (/^(?:CM|ST)-\d{4}$/.test(token)) return 'sparta';
  if (/^[A-Z]{2}-\d+/.test(token)) return 'control';
  return 'framework';
}

export function getEntityStyle(type: EntityType) {
  return ENTITY_STYLES[type];
}

export function highlightEntities(
  text: string,
  onEntityClick?: (entity: string, type: EntityType) => void,
): ReactNode[] {
  const parts = text.split(ENTITY_PATTERN);
  return parts.map((part, i) => {
    if (ENTITY_PATTERN.test(part)) {
      ENTITY_PATTERN.lastIndex = 0;
      const type = classifyEntity(part);
      const style = ENTITY_STYLES[type];
      const tooltip = type === 'skill' ? `Skill: ${part} — click to invoke`
        : type === 'control' ? `NIST control: ${part} — click for threat matrix`
        : type === 'cwe' ? `Common Weakness: ${part} — click for analysis`
        : type === 'framework' ? `Framework: ${part} — click for details`
        : `${type}: ${part}`
      return (
        <span
          key={i}
          onClick={onEntityClick ? (e) => { e.stopPropagation(); onEntityClick(part, type); } : undefined}
          style={{
            color: style.color, fontWeight: 600, fontSize: '0.92em',
            background: style.bg, padding: '8px 12px', borderRadius: 6,
            fontFamily: type === 'skill' ? 'var(--font-mono, monospace)' : 'inherit',
            cursor: onEntityClick ? 'pointer' : 'inherit',
            position: 'relative', display: 'inline-flex', alignItems: 'center',
            minHeight: 44, minWidth: 44, boxSizing: 'border-box',
            transition: 'filter 0.15s, transform 0.1s',
            border: `1px solid transparent`,
          }}
          onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.3)'; e.currentTarget.style.border = `1px solid ${style.color}` }}
          onMouseLeave={e => { e.currentTarget.style.filter = ''; e.currentTarget.style.border = '1px solid transparent' }}
          data-qs-action={type === "skill" ? `SKILL_INVOKE_${part.slice(1).toUpperCase().replace(/-/g,"_")}` : `NAVIGATE_ENTITY_${part.replace(/[^A-Za-z0-9]/g,"_").toUpperCase()}`} data-qid={type === "skill" ? `skill:${part.slice(1)}:ref` : `entity:${part}`}
          title={tooltip}
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

/**
 * Highlight entities using BOTH static patterns AND dynamic glossary from /create-evidence-case daemon.
 * Glossary terms take precedence and use their daemon-provided type for accurate classification.
 */
export function highlightWithGlossary(
  text: string,
  glossary: GlossaryTerm[],
  onEntityClick?: (entity: string, type: EntityType) => void,
): ReactNode[] {
  if (!glossary.length) return highlightEntities(text, onEntityClick);

  // Build lookup map for glossary terms (case-insensitive)
  const glossaryMap = new Map<string, GlossaryType>();
  glossary.forEach(g => glossaryMap.set(g.term.toLowerCase(), g.type));

  // Build combined pattern: glossary terms + static entity patterns
  const glossaryPattern = buildGlossaryPattern(glossary);
  const combinedSource = glossaryPattern
    ? `${glossaryPattern.source}|${ENTITY_PATTERN.source}`
    : ENTITY_PATTERN.source;
  const combinedPattern = new RegExp(combinedSource, 'gi');

  const parts = text.split(combinedPattern);
  return parts.map((part, i) => {
    combinedPattern.lastIndex = 0;
    if (combinedPattern.test(part)) {
      combinedPattern.lastIndex = 0;

      // Check if it's a glossary term first (use daemon classification)
      const glossaryType = glossaryMap.get(part.toLowerCase());
      const type = glossaryType ? glossaryTypeToEntityType(glossaryType) : classifyEntity(part);
      const style = ENTITY_STYLES[type];

      const tooltip = type === 'skill' ? `Skill: ${part} — click to invoke`
        : type === 'control' ? `NIST control: ${part} — click for threat matrix`
        : type === 'cwe' ? `Common Weakness: ${part} — click for analysis`
        : type === 'domain' ? `Domain term: ${part}`
        : type === 'framework' ? `Framework: ${part} — click for details`
        : `${type}: ${part}`;

      return (
        <span
          key={i}
          onClick={onEntityClick ? (e) => { e.stopPropagation(); onEntityClick(part, type); } : undefined}
          style={{
            color: style.color, fontWeight: 600, fontSize: '0.92em',
            background: style.bg, padding: '8px 12px', borderRadius: 6,
            fontFamily: type === 'skill' ? 'var(--font-mono, monospace)' : 'inherit',
            cursor: onEntityClick ? 'pointer' : 'inherit',
            position: 'relative', display: 'inline-flex', alignItems: 'center',
            minHeight: 44, minWidth: 44, boxSizing: 'border-box',
            transition: 'filter 0.15s, transform 0.1s',
            border: `1px solid transparent`,
          }}
          onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.3)'; e.currentTarget.style.border = `1px solid ${style.color}` }}
          onMouseLeave={e => { e.currentTarget.style.filter = ''; e.currentTarget.style.border = '1px solid transparent' }}
          data-qs-action={type === "skill" ? `SKILL_INVOKE_${part.slice(1).toUpperCase().replace(/-/g,"_")}` : `NAVIGATE_ENTITY_${part.replace(/[^A-Za-z0-9]/g,"_").toUpperCase()}`}
          data-qid={type === "skill" ? `skill:${part.slice(1)}:ref` : `entity:${part}`}
          title={tooltip}
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

export { ENTITY_PATTERN, ENTITY_STYLES };
