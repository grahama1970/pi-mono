import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { EMBRY, card, panel, label, heading, body, fwBadge } from '../../common/EmbryStyle';
import { useRegisterAction } from '../../hooks/useRegisterAction';

interface Span {
  entity: string;
  start: number;
  end: number;
  type: "control_id" | "phrase";
  status: "valid" | "not_in_corpus" | "in_corpus" | "not_relevant";
  framework: string | null;
  category: string;
  name: string;
  confidence: number;
}

interface Resolution {
  exists: boolean;
  match_type: "exact" | "aerospace_term" | "corpus_recall" | "domain_term" | "not_in_corpus";
  category?: "sparta" | "aerospace" | "corpus_recall";
  confidence: number;
  name?: string;
  source?: string;
  matched_text?: string;
}

interface ControlMetadata {
  control_id: string;
  name: string;
  description: string;
  framework: string;
  domain: string;
  type: string;
}

interface RelatedPair {
  control_id: string;
  related_id: string;
  related_name: string;
  related_framework: string;
  relationship: string;
}

interface ExtractionResponse {
  entities: Array<{ id: string; name: string; label: string; type: string; framework: string; exists: boolean }>;
  mode: string;
  control_ids: string[];
  spans: Span[];
  resolution_map: Record<string, Resolution>;
  control_metadata: ControlMetadata[];
  not_in_corpus: Array<{ term: string; reason: string }>;
  phrases: string[];
  misspellings: Array<{ word: string; suggestion: string; distance: number }>;
  related_pairs: RelatedPair[];
  recall_items: Array<{ problem?: string; solution?: string; _key?: string }>;
}

interface EntitySpanViewerProps {
  query?: string;
}

/** Five extraction layers mapped to NVIS colors */
const CATEGORIES = {
  SPARTA: { label: 'SPARTA Control', color: '#00ff88', bg: 'rgba(0,255,136,0.12)', layer: 'Layer 1: Flashtext', desc: 'Exact match in sparta_controls', border: 'solid' as const },
  WEAKNESS: { label: 'Weakness (CWE)', color: '#ffaa00', bg: 'rgba(255,170,0,0.12)', layer: 'Layer 1: Flashtext', desc: 'CWE weakness identifier', border: 'double' as const },
  AEROSPACE: { label: 'Aerospace Term', color: '#c084fc', bg: 'rgba(192,132,252,0.12)', layer: 'Layer 1: Flashtext', desc: 'Match in aerospace_terms vocabulary', border: 'dashed' as const },
  RECALL: { label: 'Corpus Recall', color: '#4a9eff', bg: 'rgba(74,158,255,0.12)', layer: 'Layer 2: /recall', desc: 'Fuzzy match against collections', border: 'dotted' as const },
  UNGROUNDED: { label: 'Ungrounded', color: '#ff6b6b', bg: 'rgba(255,107,107,0.12)', layer: 'Layer 3: spaCy', desc: 'Not found in any corpus', border: 'dashed' as const },
};

function getCategoryKey(span: Span): keyof typeof CATEGORIES {
  if (span.status === 'not_in_corpus') return 'UNGROUNDED';
  if (span.category === 'weakness' || (span.framework && span.framework.toUpperCase() === 'CWE')) return 'WEAKNESS';
  if (span.category === 'control') return 'SPARTA';
  if (span.category === 'domain_term') return 'AEROSPACE';
  return 'RECALL';
}

const Tooltip = ({ span, resolution, metadata, category }: {
  span: Span; resolution?: Resolution; metadata?: ControlMetadata;
  category: typeof CATEGORIES['SPARTA'];
}) => (
  <div className="embry-tooltip" style={{
    position: 'absolute', bottom: 'calc(100% + 12px)', left: '50%', transform: 'translateX(-50%)',
    backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 8,
    padding: '12px 16px', width: 320, zIndex: 1000, boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)',
    pointerEvents: 'none', textAlign: 'left',
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ ...label, color: category.color, fontSize: 9 }}>{category.layer}</span>
      {span.framework && <div style={fwBadge(span.framework)}>{span.framework}</div>}
    </div>
    <div style={{ ...heading, marginBottom: 4, color: category.color }}>{metadata?.name || span.name || span.entity}</div>
    <div style={{ ...body, fontSize: 11, opacity: 0.8, marginBottom: 10 }}>{metadata?.description || resolution?.source || category.desc}</div>
    <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 8, display: 'flex', gap: 12 }}>
      <div>
        <div style={{ ...label, fontSize: 8 }}>Confidence</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ height: 4, width: 60, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${span.confidence * 100}%`, backgroundColor: category.color }} />
          </div>
          <span style={{ fontSize: 10, color: EMBRY.white }}>{(span.confidence * 100).toFixed(0)}%</span>
        </div>
      </div>
      <div>
        <div style={{ ...label, fontSize: 8 }}>Status</div>
        <div style={{ fontSize: 10, color: category.color, fontWeight: 700 }}>{span.status.toUpperCase().replace(/_/g, ' ')}</div>
      </div>
    </div>
    <div style={{ position: 'absolute', bottom: -6, left: '50%', marginLeft: -6, width: 12, height: 12,
      backgroundColor: EMBRY.bgDeep, borderRight: `1px solid ${EMBRY.border}`, borderBottom: `1px solid ${EMBRY.border}`,
      transform: 'rotate(45deg)',
    }} />
  </div>
);

export default function EntitySpanViewer({ query: initialQuery }: EntitySpanViewerProps) {
  useRegisterAction('entity-span:input:query', { app: 'sparta-explorer', action: 'ENTITY_SPAN_QUERY_CHANGE', label: 'Entity Query', description: 'Type a compliance question to extract entities from text' });
  useRegisterAction('entity-span:action:edit', { app: 'sparta-explorer', action: 'ENTITY_SPAN_EDIT_TOGGLE', label: 'Edit Spans', description: 'Toggle manual span editing mode' });
  useRegisterAction('entity-span:ref:select', { app: 'sparta-explorer', action: 'ENTITY_SPAN_SELECT', label: 'Select Entity', description: 'Click an entity span to select it for inspection or deletion' });
  useRegisterAction('entity-span:panel:relationships', { app: 'sparta-explorer', action: 'ENTITY_SPAN_RELATIONSHIPS', label: 'View Relationships', description: 'Open relationship mapping panel for selected entity' });
  useRegisterAction('entity-span:action:close-panel', { app: 'sparta-explorer', action: 'ENTITY_SPAN_CLOSE_PANEL', label: 'Close Panel', description: 'Close the relationship mapping panel' });

  const [inputText, setInputText] = useState(initialQuery || "");
  const [data, setData] = useState<ExtractionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [deletedIndices, setDeletedIndices] = useState<Set<number>>(new Set());
  const [panelEntity, setPanelEntity] = useState<string | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const fetchEntities = useCallback(async (text: string) => {
    if (!text.trim()) { setData(null); return; }
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/extract-entities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error('Failed to fetch entity data');
      setData(await response.json());
      setDeletedIndices(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (initialQuery) { setInputText(initialQuery); fetchEntities(initialQuery); }
  }, [initialQuery, fetchEntities]);

  useEffect(() => {
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; setInputText(val);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => fetchEntities(val), 500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { if (debounceTimer.current) clearTimeout(debounceTimer.current); fetchEntities(inputText); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIndex !== null) {
      setDeletedIndices(prev => new Set(prev).add(selectedIndex)); setSelectedIndex(null);
    }
  };

  const renderedContent = useMemo(() => {
    if (!data || !inputText) return inputText;
    const spans = Array.isArray(data.spans) ? data.spans : [];
    const sortedSpans = [...spans].filter((_, idx) => !deletedIndices.has(idx)).sort((a, b) => a.start - b.start);
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    sortedSpans.forEach((span, idx) => {
      if (span.start > lastIndex) elements.push(<span key={`text-${lastIndex}`} style={{ opacity: 0.7 }}>{inputText.substring(lastIndex, span.start)}</span>);
      const catKey = getCategoryKey(span);
      const category = CATEGORIES[catKey];
      const isSelected = selectedIndex === idx;
      elements.push(
        <span key={`span-${idx}`} className="entity-span-wrapper"
          data-qid={`entity-span:ref:${span.entity}`} data-qs-action="ENTITY_SPAN_SELECT" title={`Click to select ${span.entity}`}
          onClick={(e) => { e.stopPropagation(); setSelectedIndex(idx); setPanelEntity(span.entity); }}
          style={{
            position: 'relative', display: 'inline-block', padding: '0 4px', margin: '0 1px', borderRadius: 4,
            backgroundColor: category.bg, color: category.color, fontWeight: 600, cursor: 'pointer',
            border: isSelected ? `2px solid ${EMBRY.accent}` : '2px solid transparent',
            borderBottom: `2px ${category.border} ${category.color}`,
            boxShadow: isSelected ? `0 0 15px ${EMBRY.accent}66` : 'none',
            textDecoration: catKey === 'UNGROUNDED' ? 'underline wavy #ff6b6b' : 'none',
            transition: 'all 0.2s ease', animation: `fadeIn 0.3s ease forwards ${idx * 0.03}s`, opacity: 0,
          }}>
          {inputText.substring(span.start, span.end)}
          <Tooltip span={span} resolution={data.resolution_map[span.entity]} metadata={data.control_metadata.find(m => m.control_id === span.entity)} category={category} />
        </span>
      );
      lastIndex = span.end;
    });
    if (lastIndex < inputText.length) elements.push(<span key="text-end" style={{ opacity: 0.7 }}>{inputText.substring(lastIndex)}</span>);
    return elements;
  }, [data, inputText, selectedIndex, deletedIndices]);

  const filteredPairs = useMemo(() => {
    if (!data || !panelEntity) return [];
    return (data.related_pairs ?? []).filter(p => p.control_id === panelEntity || p.related_id === panelEntity);
  }, [data, panelEntity]);

  const extractionSummary = useMemo(() => {
    if (!data) return '';
    const spans = Array.isArray(data.spans) ? data.spans : [];
    const total = spans.length;
    const ungrounded = spans.filter(s => s.status === 'not_in_corpus').length;
    if (total === 0) return 'No entities found';
    return `${total} entities found${ungrounded > 0 ? `, ${ungrounded} ungrounded` : ''}`;
  }, [data]);

  const closePanel = useCallback(() => setPanelEntity(null), []);

  return (
    <div style={{ ...card, minHeight: 400, display: 'flex', flexDirection: 'column', gap: 20, position: 'relative', overflow: 'hidden' }} onClick={() => { setSelectedIndex(null); }} onKeyDown={(e) => { handleKeyDown(e); if (e.key === 'Escape') closePanel(); }} tabIndex={0}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .skeleton { background: linear-gradient(90deg, ${EMBRY.bgPanel} 25%, ${EMBRY.bgCard} 50%, ${EMBRY.bgPanel} 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 4px; }
        .entity-span-wrapper:focus-visible { outline: 2px solid ${EMBRY.amber}; outline-offset: 2px; }
        input:focus-visible { outline: 2px solid ${EMBRY.amber}; outline-offset: 2px; }
        .entity-span-wrapper .embry-tooltip { opacity: 0; visibility: hidden; transform: translateX(-50%) translateY(10px) scale(0.95); transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
        .entity-span-wrapper:hover .embry-tooltip { opacity: 1; visibility: visible; transform: translateX(-50%) translateY(0) scale(1); }
        .legend-dot-pulse { animation: pulse-dot 2s infinite; }
        @keyframes pulse-dot { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.2); opacity: 0.7; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @media (prefers-reduced-motion: reduce) { .entity-span-wrapper, .skeleton, .legend-dot-pulse { animation: none !important; } .entity-span-wrapper { opacity: 1 !important; } .embry-tooltip { transition: none !important; } [data-qid="entity-span:panel:relationships"] { animation: none !important; } }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><div style={label}>Entity Extraction</div><div style={heading}>Three-Layer Pipeline Viewer</div></div>
        <button data-qid="entity-span:action:edit" data-qs-action="ENTITY_SPAN_EDIT_TOGGLE" title="Manual span editing coming soon"
          disabled style={{ ...label, padding: '6px 12px', borderRadius: 6, border: `1px solid ${EMBRY.border}`, background: 'transparent', opacity: 0.5, cursor: 'not-allowed' }}>
          Edit Spans (Beta)
        </button>
      </div>

      <div style={{ position: 'relative' }}>
        <input data-qid="entity-span:input:query" data-qs-action="ENTITY_SPAN_QUERY_CHANGE" title="Type a compliance question to extract entities"
          aria-label="Entity extraction query" value={inputText} onChange={handleInputChange}
          placeholder="e.g. How does the flight management system affect NIST 800-53 AC-6?"
          style={{ width: '100%', backgroundColor: EMBRY.bgPanel, border: `1px solid ${loading ? EMBRY.accent : EMBRY.border}`, borderRadius: 8, padding: '12px 16px', color: EMBRY.white, fontSize: 15, outline: 'none', transition: 'border-color 0.2s ease' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', padding: '10px 0', borderBottom: `1px solid ${EMBRY.border}` }}>
        {Object.entries(CATEGORIES).map(([key, cat]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="legend-dot-pulse" style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: cat.color }} />
            <span style={{ ...label, fontSize: 9, color: EMBRY.white }}>{cat.label}</span>
          </div>
        ))}
      </div>

      <div style={{ ...panel, flex: 1, position: 'relative', overflow: 'visible' }} aria-live="polite" role="region" aria-label="Extraction results">
        {loading && !data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="skeleton" style={{ height: 24, width: '80%' }} />
            <div className="skeleton" style={{ height: 24, width: '95%' }} />
            <div className="skeleton" style={{ height: 24, width: '60%' }} />
          </div>
        ) : error ? (
          <div style={{ color: EMBRY.red, ...body }}>{error}</div>
        ) : data ? (
          <div style={{ ...body, fontSize: 18, lineHeight: 2.2 }}>{renderedContent}</div>
        ) : (
          <div style={{ ...body, opacity: 0.4, textAlign: 'center', marginTop: 40 }}>Enter a query above to begin extraction pipeline...</div>
        )}
      </div>

      {data && (
        <div style={{ display: 'flex', gap: 24, padding: '12px 16px', backgroundColor: EMBRY.bgDeep, borderRadius: 8, border: `1px solid ${EMBRY.border}` }}>
          <div><div style={label}>Control IDs</div><div style={{ ...body, fontSize: 12, color: EMBRY.green }}>{(data.control_ids ?? []).length > 0 ? data.control_ids.join(', ') : 'None'}</div></div>
          <div><div style={label}>Phrases</div><div style={{ ...body, fontSize: 12, color: EMBRY.blue }}>{(data.phrases ?? []).length > 0 ? data.phrases.join(', ') : 'None'}</div></div>
          <div><div style={label}>Ungrounded</div><div style={{ ...body, fontSize: 12, color: '#ff6b6b' }}>{(data.not_in_corpus ?? []).length > 0 ? data.not_in_corpus.map(n => n.term).join(', ') : '0 items'}</div></div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}><div style={label}>Mode</div><div style={{ ...body, fontSize: 12, fontWeight: 700 }}>{data.mode.toUpperCase()}</div></div>
        </div>
      )}

      {/* Screen reader extraction summary */}
      <div aria-live="polite" role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        {extractionSummary}
      </div>

      <div style={{ ...label, fontSize: 9, opacity: 0.5, marginTop: 'auto' }}>Pipeline: Flashtext (16.4k) → /recall (BM25) → spaCy (Noun Chunks)</div>

      {/* Relationship mapping slide-over panel */}
      {panelEntity && (
        <div
          data-qid="entity-span:panel:relationships"
          data-qs-action="ENTITY_SPAN_RELATIONSHIPS"
          title={`Relationships for ${panelEntity}`}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: 480,
            backgroundColor: EMBRY.bgDeep, borderLeft: `1px solid ${EMBRY.border}`,
            zIndex: 100, display: 'flex', flexDirection: 'column',
            animation: 'slideInRight 0.2s ease-out',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
            <div>
              <div style={label}>Relationship Mapping</div>
              <div style={{ ...heading, color: EMBRY.green }}>{panelEntity}</div>
            </div>
            <button
              data-qid="entity-span:action:close-panel"
              data-qs-action="ENTITY_SPAN_CLOSE_PANEL"
              title="Close relationship panel"
              onClick={(e) => { e.stopPropagation(); closePanel(); }}
              style={{ background: 'none', border: `1px solid ${EMBRY.border}`, borderRadius: 6, color: EMBRY.white, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
            >
              ✕
            </button>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
            {filteredPairs.length === 0 ? (
              <div style={{ ...body, opacity: 0.4, textAlign: 'center', marginTop: 40 }}>No relationships found for this entity</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ ...label, fontSize: 9, marginBottom: 4 }}>{filteredPairs.length} relationship{filteredPairs.length !== 1 ? 's' : ''}</div>
                {filteredPairs.map((pair, i) => {
                  const isSource = pair.control_id === panelEntity;
                  const linkedId = isSource ? pair.related_id : pair.control_id;
                  const fw = pair.related_framework;
                  const fwColor = fw ? (EMBRY.fw as Record<string, string>)[fw] ?? EMBRY.dim : EMBRY.dim;
                  return (
                    <div
                      key={`rel-${i}`}
                      data-qid={`entity-span:ref:relationship:${i}`}
                      data-qs-action="ENTITY_SPAN_VIEW_RELATIONSHIP"
                      title={`${pair.relationship}: ${linkedId}`}
                      style={{
                        padding: '10px 14px', borderRadius: 6,
                        backgroundColor: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`,
                        cursor: 'pointer', transition: 'border-color 0.15s ease',
                      }}
                      onClick={(e) => { e.stopPropagation(); setPanelEntity(linkedId); }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ ...body, fontWeight: 700, color: EMBRY.white, fontSize: 13 }}>{linkedId}</span>
                        {fw && <div style={fwBadge(fw)}>{fw}</div>}
                      </div>
                      <div style={{ ...label, fontSize: 9, color: fwColor, marginBottom: 4 }}>{pair.relationship}</div>
                      <div style={{ ...body, fontSize: 11, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {pair.related_name}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
