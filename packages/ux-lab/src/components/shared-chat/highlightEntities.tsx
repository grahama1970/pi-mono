/**
 * Entity highlighting — shared across Embry Terminal + SPARTA Explorer.
 * Detects compliance entities (NIST controls, CWEs, ATT&CK, SPARTA, frameworks)
 * and skill names (/skill-name) in text, returns JSX with colored chips.
 */
import type { EntityType } from './types';

// Patterns for compliance/security entities + skills
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
  'g'
);

const ENTITY_STYLES: Record<EntityType, { color: string; bg: string }> = {
  skill:     { color: '#4a9eff', bg: 'rgba(74,158,255,0.08)' },
  control:   { color: '#00ff88', bg: 'rgba(0,255,136,0.08)' },
  cwe:       { color: '#ff6b6b', bg: 'rgba(255,107,107,0.08)' },
  attack:    { color: '#ffaa00', bg: 'rgba(255,170,0,0.08)' },
  framework: { color: '#c084fc', bg: 'rgba(192,132,252,0.08)' },
  sparta:    { color: '#22d3ee', bg: 'rgba(34,211,238,0.08)' },
};

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
): (string | JSX.Element)[] {
  const parts = text.split(ENTITY_PATTERN);
  return parts.map((part, i) => {
    if (ENTITY_PATTERN.test(part)) {
      ENTITY_PATTERN.lastIndex = 0;
      const type = classifyEntity(part);
      const style = ENTITY_STYLES[type];
      return (
        <span
          key={i}
          onClick={onEntityClick ? (e) => { e.stopPropagation(); onEntityClick(part, type); } : undefined}
          style={{
            color: style.color, fontWeight: 600, fontSize: '0.92em',
            background: style.bg, padding: '1px 5px', borderRadius: 3,
            fontFamily: type === 'skill' ? 'var(--font-mono, monospace)' : 'inherit',
            cursor: onEntityClick ? 'pointer' : 'inherit',
          }}
          data-qid={type === 'skill' ? `skill:${part.slice(1)}:ref` : `entity:${part}`}
          title={type === 'skill' ? `Skill: ${part} — click to invoke` : type === 'control' ? `NIST control: ${part} — click for threat matrix` : type === 'cwe' ? `Common Weakness: ${part} — click for analysis` : type === 'framework' ? `Framework: ${part} — click for details` : `${type}: ${part}`}
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

export { ENTITY_PATTERN, ENTITY_STYLES };
