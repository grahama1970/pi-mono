/**
 * SkillPalette — Shared fuzzy-search skill dropdown.
 * Used by Embry Terminal and SPARTA Explorer chat input bars.
 */
import { useState, useEffect, useMemo, memo } from 'react';
import Fuse from 'fuse.js';
import type { Skill } from './types';

export interface SkillPaletteProps {
  filter: string;
  skills: Skill[];
  onSelect: (name: string) => void;
  onClose: () => void;
  onKeyNav?: (handler: (e: React.KeyboardEvent) => boolean) => void;
  maxResults?: number;
}

export const SkillPalette = memo(function SkillPalette({ filter, skills, onSelect, onClose, onKeyNav, maxResults = 12 }: SkillPaletteProps) {
  const [index, setIndex] = useState(0);

  // Deduplicate by name
  const uniqueSkills = useMemo(() => {
    const seen = new Set<string>();
    return skills.filter(s => { if (seen.has(s.name)) return false; seen.add(s.name); return true; });
  }, [skills]);

  const fuse = useMemo(
    () => new Fuse(uniqueSkills, { keys: ['name', 'description', 'triggers'], threshold: 0.4 }),
    [uniqueSkills],
  );

  const filtered = filter
    ? fuse.search(filter).slice(0, maxResults).map(r => r.item)
    : uniqueSkills.slice(0, maxResults);

  useEffect(() => setIndex(0), [filter]);

  // Forward keyboard events from textarea
  useEffect(() => {
    if (onKeyNav) {
      onKeyNav((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, filtered.length - 1)); return true; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); return true; }
        if (e.key === 'Enter' && filtered[index]) { e.preventDefault(); onSelect(filtered[index].name); return true; }
        if (e.key === 'Escape') { onClose(); return true; }
        return false;
      });
    }
  }, [filtered, index, onSelect, onClose, onKeyNav]);

  if (filtered.length === 0) return null;

  return (
    <div style={{
      position: 'absolute', bottom: '100%', left: 0, marginBottom: 8,
      width: 320, background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.13)',
      borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 100,
      maxHeight: 280, overflow: 'auto',
    }} data-qid="skill-palette:dropdown">
      {filtered.map((skill, i) => (
        <button key={skill.name} onClick={() => onSelect(skill.name)}
          onMouseEnter={() => setIndex(i)}
          style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px',
            background: i === index ? 'rgba(124,58,237,0.1)' : 'transparent',
            borderLeft: i === index ? '2px solid #7c3aed' : '2px solid transparent',
            border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui, sans-serif)',
            transition: 'background 0.1s',
          }}
          data-qid={`skill-palette:skill:${skill.name}:select`}
        >
          <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, fontWeight: 600, color: '#4a9eff' }}>/{skill.name}</span>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.description}</div>
        </button>
      ))}
    </div>
  );
});
