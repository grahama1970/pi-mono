This redesign moves the model selection from a cluttered inline chip-wall to a professional, top-bar-integrated system.

### Common Hook Mock
Since `useRegisterAction` is required but the implementation wasn't provided, we assume this standard signature:
```tsx
const useRegisterAction = (qid: string, config: { 
  app: string; action: string; label: string; description: string 
}) => { /* registers to ArangoDB */ };
```

---

## Take 1: The "Arena" (FastChat Inspired)
**Approach**: This design replicates the FastChat Arena "Tab-style" buttons in the sticky header. It uses a clean, categorized popover list with search. It is optimized for comparing 2-3 specific models while allowing easy access to the full catalog.

```tsx
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check, Brain, Code, Eye, Bot, Cpu } from 'lucide-react';
import { EMBRY } from './EmbryStyle';

// Mock hook for QuerySpec
const useRegisterAction = (id: string, cfg: any) => {};

export function ArenaModelSelector({ allModels, selected, onToggle, mode = 'multi' }: any) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'reasoning' | 'coding' | 'agentic'>('all');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useRegisterAction('model-selector:dropdown:toggle', {
    app: 'llm-eval-lab', action: 'MODEL_SELECTOR_TOGGLE',
    label: 'Toggle Model Selector', description: 'Open/close the model browser'
  });

  const filteredModels = useMemo(() => {
    return Object.entries(allModels).filter(([alias, config]: [string, any]) => {
      const matchesSearch = alias.toLowerCase().includes(search.toLowerCase());
      const matchesTab = activeTab === 'all' || 
                        (activeTab === 'reasoning' && (config.reasoning || config.thinking_mode)) ||
                        (activeTab === 'coding' && config.coding) ||
                        (activeTab === 'agentic' && config.agentic);
      return matchesSearch && matchesTab;
    });
  }, [allModels, search, activeTab]);

  const getProviderColor = (provider: string) => {
    if (provider === 'ollama') return EMBRY.green;
    if (provider === 'chutes') return EMBRY.blue;
    if (provider === 'scillm') return EMBRY.amber;
    if (provider === 'subagent') return EMBRY.red;
    return EMBRY.dim;
  };

  return (
    <div style={{ position: 'relative', display: 'flex', gap: 8 }} ref={dropdownRef}>
      {/* Selected Model Chips in Header */}
      {selected.length === 0 ? (
        <button
          data-qid="model-selector:trigger:empty"
          data-qs-action="MODEL_SELECTOR_TOGGLE"
          title="Select models to run"
          onClick={() => setIsOpen(!isOpen)}
          style={styles.triggerButton}
        >
          Select Models <ChevronDown size={14} />
        </button>
      ) : (
        selected.map((alias: string) => (
          <button
            key={alias}
            data-qid={`model-selector:trigger:${alias}`}
            data-qs-action="MODEL_SELECTOR_TOGGLE"
            title={`Change model: ${alias}`}
            onClick={() => setIsOpen(!isOpen)}
            style={{ ...styles.triggerButton, borderColor: getProviderColor(allModels[alias]?.provider) }}
          >
            <span style={{ color: getProviderColor(allModels[alias]?.provider) }}>●</span>
            {alias}
            <ChevronDown size={12} />
          </button>
        ))
      )}

      {isOpen && (
        <div style={styles.popover}>
          <div style={styles.searchContainer}>
            <Search size={16} color={EMBRY.dim} />
            <input
              data-qid="model-selector:search:input"
              data-qs-action="MODEL_SELECTOR_SEARCH"
              title="Search through available models"
              autoFocus
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={styles.searchInput}
            />
          </div>

          <div style={styles.tabRow}>
            {(['all', 'reasoning', 'coding', 'agentic'] as const).map(tab => (
              <button
                key={tab}
                data-qid={`model-selector:tab:${tab}`}
                data-qs-action="MODEL_SELECTOR_TAB_CHANGE"
                title={`Filter by ${tab}`}
                onClick={() => setActiveTab(tab)}
                style={{ ...styles.tab, borderBottomColor: activeTab === tab ? EMBRY.accent : 'transparent' }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <div style={styles.list}>
            {filteredModels.map(([alias, config]: [string, any]) => (
              <div
                key={alias}
                data-qid={`model-selector:item:${alias}`}
                data-qs-action="MODEL_SELECT_TOGGLE"
                title={`Toggle selection for ${alias}`}
                onClick={() => onToggle(alias)}
                style={{
                  ...styles.listItem,
                  backgroundColor: selected.includes(alias) ? 'rgba(124, 58, 237, 0.1)' : 'transparent'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: getProviderColor(config.provider) }} />
                  <div style={styles.modelName}>{alias}</div>
                  {config.params_b && <div style={styles.params}>{config.params_b}B</div>}
                </div>
                <div style={styles.capBadges}>
                  {config.reasoning && <Brain size={12} title="Reasoning" color={EMBRY.blue} />}
                  {config.coding && <Code size={12} title="Coding" color={EMBRY.green} />}
                  {selected.includes(alias) && <Check size={16} color={EMBRY.green} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  triggerButton: {
    height: 32, padding: '0 12px', borderRadius: 6, border: `1px solid ${EMBRY.border}`,
    backgroundColor: EMBRY.bgCard, color: EMBRY.white, display: 'flex', alignItems: 'center',
    gap: 8, fontSize: 13, cursor: 'pointer', transition: 'all 0.2s'
  },
  popover: {
    position: 'absolute' as const, top: 40, left: 0, width: 320, maxHeight: 480,
    backgroundColor: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`, borderRadius: 8,
    boxShadow: '0 10px 25px rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', flexDirection: 'column' as const
  },
  searchContainer: {
    padding: '12px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 8
  },
  searchInput: {
    background: 'transparent', border: 'none', color: EMBRY.white, fontSize: 14, outline: 'none', width: '100%'
  },
  tabRow: {
    display: 'flex', padding: '0 8px', borderBottom: `1px solid ${EMBRY.border}`, background: EMBRY.bgPanel
  },
  tab: {
    padding: '8px 12px', background: 'none', border: 'none', borderBottom: '2px solid transparent',
    color: EMBRY.dim, fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'uppercase' as const
  },
  list: { overflowY: 'auto' as const, padding: '4px 0' },
  listItem: {
    padding: '10px 16px', display: 'flex', alignItems: 'center', cursor: 'pointer',
    borderBottom: `1px solid rgba(255,255,255,0.03)`
  },
  modelName: { fontSize: 13, color: EMBRY.white, fontWeight: 500 },
  params: { fontSize: 10, color: EMBRY.dim, background: 'rgba(255,255,255,0.05)', padding: '1px 4px', borderRadius: 4 },
  capBadges: { display: 'flex', gap: 8, alignItems: 'center' }
};
```

---

## Take 2: The "Command Palette"
**Approach**: A search-first modal experience inspired by VS Code and Vercel. Instead of multiple small buttons, the header has a single "Models: (N selected)" button. Clicking it (or Cmd+K) opens a centered overlay. This is ideal for power users navigating a massive (46+) model list.

```tsx
import React, { useState, useMemo } from 'react';
import { Command, Search, Cpu, Globe, Zap, Settings } from 'lucide-react';
import { EMBRY } from './EmbryStyle';

export function CommandModelSelector({ allModels, selected, onToggle }: any) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  // useRegisterAction calls here...

  const groups = useMemo(() => {
    const list = Object.entries(allModels);
    return {
      Selected: list.filter(([a]) => selected.includes(a)),
      Recent: list.filter(([a]) => !selected.includes(a)).slice(0, 3), // Mock recents
      All: list.filter(([a]) => !selected.includes(a) && a.toLowerCase().includes(query.toLowerCase()))
    };
  }, [allModels, selected, query]);

  if (!isOpen) return (
    <button 
      data-qid="cmd:trigger" data-qs-action="CMD_OPEN" title="Manage model configuration"
      onClick={() => setIsOpen(true)}
      style={cmdStyles.trigger}
    >
      <Command size={14} />
      <span>{selected.length || 'No'} Models Active</span>
      <kbd style={cmdStyles.kbd}>⌘K</kbd>
    </button>
  );

  return (
    <div style={cmdStyles.overlay} onClick={() => setIsOpen(false)}>
      <div style={cmdStyles.modal} onClick={e => e.stopPropagation()}>
        <div style={cmdStyles.header}>
          <Search size={20} color={EMBRY.accent} />
          <input 
            data-qid="cmd:input" data-qs-action="CMD_SEARCH" title="Search models..."
            autoFocus placeholder="Search models, providers, or capabilities..." 
            value={query} onChange={e => setQuery(e.target.value)}
            style={cmdStyles.input}
          />
        </div>
        <div style={cmdStyles.results}>
          {Object.entries(groups).map(([groupName, items]) => items.length > 0 && (
            <div key={groupName}>
              <div style={cmdStyles.groupHeader}>{groupName}</div>
              {items.map(([alias, config]: [string, any]) => (
                <div 
                  key={alias} data-qid={`cmd:item:${alias}`} data-qs-action="CMD_SELECT" title={`Toggle ${alias}`}
                  onClick={() => onToggle(alias)}
                  style={{...cmdStyles.item, borderLeft: selected.includes(alias) ? `3px solid ${EMBRY.accent}` : '3px solid transparent'}}
                >
                  <div style={cmdStyles.itemIcon}>
                    {config.provider === 'ollama' ? <Cpu size={14} /> : <Globe size={14} />}
                  </div>
                  <div style={{flex: 1}}>
                    <div style={cmdStyles.itemName}>{alias}</div>
                    <div style={cmdStyles.itemMeta}>{config.provider} • {config.params_b || '?'}B</div>
                  </div>
                  {selected.includes(alias) && <Zap size={14} color={EMBRY.green} />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const cmdStyles = {
  trigger: {
    height: 36, padding: '0 16px', background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`,
    borderRadius: 20, color: EMBRY.white, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer'
  },
  kbd: { fontSize: 10, background: 'rgba(255,255,255,0.1)', padding: '2px 4px', borderRadius: 4, opacity: 0.7 },
  overlay: {
    position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.8)', 
    backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', paddingTop: '10vh', zIndex: 1000
  },
  modal: {
    width: 600, background: EMBRY.bgPanel, borderRadius: 12, border: `1px solid ${EMBRY.border}`,
    display: 'flex', flexDirection: 'column' as const, maxHeight: '70vh', overflow: 'hidden'
  },
  header: { padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${EMBRY.border}` },
  input: { background: 'none', border: 'none', color: EMBRY.white, fontSize: 18, width: '100%', outline: 'none' },
  results: { overflowY: 'auto' as const, padding: 8 },
  groupHeader: { padding: '12px 12px 4px 12px', fontSize: 11, color: EMBRY.dim, textTransform: 'uppercase' as const, fontWeight: 700 },
  item: { padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', borderRadius: 6, transition: 'background 0.1s' },
  itemIcon: { width: 28, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  itemName: { fontSize: 14, color: EMBRY.white },
  itemMeta: { fontSize: 12, color: EMBRY.dim }
};
```

---

## Take 3: The "Capability Matrix"
**Approach**: This is the most innovative take. It uses a multi-column visual matrix that groups models by their "Role" (e.g., General, Specialist, Local) rather than just a flat list. It stays in the header but expands into a full-width "Mega Menu."

```tsx
import React, { useState } from 'react';
import { LayoutGrid, Layers, Database, Sparkles } from 'lucide-react';
import { EMBRY } from './EmbryStyle';

export function MatrixModelSelector({ allModels, selected, onToggle }: any) {
  const [isOpen, setIsOpen] = useState(false);

  // useRegisterAction calls...

  const categories = {
    'Powerhouse (Reasoning)': Object.entries(allModels).filter(([_, c]: any) => c.reasoning),
    'Coders & Builders': Object.entries(allModels).filter(([_, c]: any) => c.coding),
    'Local & Fast': Object.entries(allModels).filter(([_, c]: any) => c.provider === 'ollama' && !c.coding),
    'Infrastructure (Chutes)': Object.entries(allModels).filter(([_, c]: any) => c.provider === 'chutes' && !c.reasoning)
  };

  return (
    <div>
      <button 
        data-qid="matrix:trigger" data-qs-action="MATRIX_OPEN" title="Open capability matrix"
        onClick={() => setIsOpen(!isOpen)}
        style={{ ...mxStyles.trigger, background: isOpen ? EMBRY.accent : 'transparent' }}
      >
        <LayoutGrid size={16} />
        Browse Capabilities
      </button>

      {isOpen && (
        <div style={mxStyles.megaMenu}>
          <div style={mxStyles.grid}>
            {Object.entries(categories).map(([name, models]) => (
              <div key={name} style={mxStyles.column}>
                <div style={mxStyles.colTitle}>{name}</div>
                <div style={mxStyles.colList}>
                  {models.map(([alias, config]: [string, any]) => (
                    <div 
                      key={alias} data-qid={`mx:item:${alias}`} data-qs-action="MX_TOGGLE" title={`Select ${alias}`}
                      onClick={() => onToggle(alias)}
                      style={{
                        ...mxStyles.card,
                        borderColor: selected.includes(alias) ? EMBRY.green : 'transparent',
                        background: selected.includes(alias) ? 'rgba(0, 255, 136, 0.05)' : EMBRY.bgCard
                      }}
                    >
                      <div style={mxStyles.cardMain}>
                        <span style={mxStyles.alias}>{alias}</span>
                        {config.params_b && <span style={mxStyles.paramTag}>{config.params_b}B</span>}
                      </div>
                      <div style={mxStyles.providerLabel}>{config.provider}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const mxStyles = {
  trigger: {
    height: 32, padding: '0 12px', border: `1px solid ${EMBRY.border}`, borderRadius: 4,
    color: EMBRY.white, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer'
  },
  megaMenu: {
    position: 'absolute' as const, top: 52, left: 0, right: 0, height: '60vh',
    background: EMBRY.bgHeader, borderBottom: `1px solid ${EMBRY.border}`,
    zIndex: 100, padding: '24px 40px', overflowY: 'auto' as const
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 32 },
  column: { display: 'flex', flexDirection: 'column' as const, gap: 16 },
  colTitle: { fontSize: 11, fontWeight: 800, color: EMBRY.dim, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  colList: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  card: {
    padding: '12px', borderRadius: 8, border: '1px solid transparent', 
    cursor: 'pointer', transition: 'all 0.15s ease'
  },
  cardMain: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  alias: { fontSize: 13, fontWeight: 600, color: EMBRY.white },
  paramTag: { fontSize: 9, background: EMBRY.bgDeep, padding: '2px 6px', borderRadius: 10, color: EMBRY.accent },
  providerLabel: { fontSize: 10, color: EMBRY.muted }
};
```

### Summary of Integration
To implement this, you should replace the manual mapping in `LlmEvalLabView` with one of these components placed next to the tabs:

```tsx
<div style={{ height: 52, position: 'sticky', ... }}>
  {/* Tabs on Left */}
  <div style={{ display: 'flex', gap: 24 }}>...tabs...</div>
  
  {/* Spacing */}
  <div style={{ flex: 1 }} />
  
  {/* New Model Selector on Right */}
  <ArenaModelSelector 
    allModels={allModels} 
    selected={selected} 
    onToggle={handleToggle} 
  />
</div>
```