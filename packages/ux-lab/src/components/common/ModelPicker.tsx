/**
 * ModelPicker — Provider-colored model chips with capability icons, search, and filters.
 * Shared across LlmEvalLab, PromptLab, and any view that needs model selection.
 */
import { useState, useMemo } from 'react'
import { Brain, Braces, Code, Bot, Plus, X } from 'lucide-react'
import { EMBRY, label, card } from './EmbryStyle'
import { API_ROOT } from '../../lib/apiBase'

const API = API_ROOT
const MONO = '"JetBrains Mono", "SF Mono", monospace'

export interface ModelConfig {
  provider: string; model: string; params_b?: number; local?: boolean
  json_mode?: boolean; quantization?: string; reasoning?: boolean
  thinking_mode?: boolean; coding?: boolean; agentic?: boolean
  [k: string]: unknown
}

type ProviderFilter = 'all' | 'local' | 'chutes' | 'scillm'

const CAP_KEYS = ['reasoning', 'json_mode', 'coding', 'agentic'] as const
const CAP_META: Record<string, { icon: typeof Brain; tip: string; color: string }> = {
  reasoning: { icon: Brain, tip: 'Reasoning / CoT', color: EMBRY.blue },
  json_mode: { icon: Braces, tip: 'JSON mode', color: EMBRY.green },
  coding: { icon: Code, tip: 'Coding', color: '#22d3ee' },
  agentic: { icon: Bot, tip: 'Agentic', color: EMBRY.accent },
}

export function providerColor(config: ModelConfig): string {
  if (config.local || config.provider === 'ollama') return EMBRY.green
  if (config.provider === 'chutes') return EMBRY.blue
  if (config.provider === 'scillm') return EMBRY.amber
  if (config.provider === 'subagent') return EMBRY.red
  return EMBRY.dim
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`,
  borderRadius: 6, color: EMBRY.white, outline: 'none', fontSize: 12,
}

const selectStyle: React.CSSProperties = {
  padding: '6px 10px', background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`,
  borderRadius: 4, color: EMBRY.white, outline: 'none', fontSize: 11, fontFamily: MONO,
}

export function ModelPicker({ allModels, selected, onToggle, onModelsChanged, labelText }: {
  allModels: Record<string, ModelConfig>
  selected: string[]
  onToggle: (alias: string) => void
  onModelsChanged?: () => void
  labelText?: string
}) {
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all')
  const [capFilter, setCapFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newModel, setNewModel] = useState({ alias: '', provider: 'ollama', model: '', params_b: '', reasoning: false, json_mode: false, coding: false, agentic: false })
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    return Object.entries(allModels).filter(([alias, config]) => {
      if (providerFilter === 'local' && !(config.local || config.provider === 'ollama')) return false
      if (providerFilter === 'chutes' && config.provider !== 'chutes') return false
      if (providerFilter === 'scillm' && config.provider !== 'scillm' && config.provider !== 'subagent') return false
      if (capFilter) {
        if (capFilter === 'reasoning') { if (!config.reasoning && !config.thinking_mode) return false }
        else if (!config[capFilter]) return false
      }
      if (search && !alias.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [allModels, providerFilter, capFilter, search])

  const saveNewModel = async () => {
    if (!newModel.alias || !newModel.model) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        alias: newModel.alias, provider: newModel.provider, model: newModel.model,
        params_b: newModel.params_b ? parseFloat(newModel.params_b) : undefined,
        local: newModel.provider === 'ollama',
      }
      if (newModel.reasoning) body.reasoning = true
      if (newModel.json_mode) body.json_mode = true
      if (newModel.coding) body.coding = true
      if (newModel.agentic) body.agentic = true
      await fetch(`${API}/projects/llm-eval-lab/models`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      setShowAddForm(false)
      setNewModel({ alias: '', provider: 'ollama', model: '', params_b: '', reasoning: false, json_mode: false, coding: false, agentic: false })
      onModelsChanged?.()
    } catch { /* */ }
    setSaving(false)
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={label}>{labelText ?? 'Models'} ({selected.length} selected)</div>

        {/* Provider filter */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'local', 'chutes', 'scillm'] as const).map(f => (
            <button key={f} onClick={() => setProviderFilter(f)} aria-label={`Filter by ${f}`}
              style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                background: providerFilter === f ? 'rgba(124,58,237,0.2)' : 'transparent',
                color: providerFilter === f ? EMBRY.accent : EMBRY.dim,
                border: `1px solid ${providerFilter === f ? EMBRY.accent + '44' : EMBRY.border}`,
              }}>
              {f}
            </button>
          ))}
        </div>

        {/* Capability filter */}
        <div style={{ display: 'flex', gap: 4 }}>
          {CAP_KEYS.map(cap => {
            const { icon: Icon, tip, color } = CAP_META[cap]
            const active = capFilter === cap
            return (
              <button key={cap} onClick={() => setCapFilter(active ? null : cap)} title={tip}
                style={{
                  padding: '3px 5px', borderRadius: 3, cursor: 'pointer',
                  background: active ? `${color}20` : 'transparent',
                  color: active ? color : EMBRY.muted,
                  border: `1px solid ${active ? color + '44' : 'transparent'}`,
                  display: 'flex', alignItems: 'center',
                }}>
                <Icon size={12} />
              </button>
            )
          })}
        </div>

        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search..." aria-label="Search models"
          style={{ ...inputStyle, width: 130, fontSize: 10, padding: '4px 8px' }} />

        <div style={{ fontSize: 9, color: EMBRY.muted }}>{filtered.length}/{Object.keys(allModels).length}</div>

        <button onClick={() => setShowAddForm(p => !p)} title="Add new model" aria-label="Add new model"
          style={{
            padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 9, fontWeight: 700,
            background: showAddForm ? EMBRY.accent + '20' : 'transparent',
            color: showAddForm ? EMBRY.accent : EMBRY.dim,
            border: `1px solid ${showAddForm ? EMBRY.accent + '44' : EMBRY.border}`,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
          <Plus size={10} /> ADD
        </button>
      </div>

      {/* Add model form */}
      {showAddForm && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, padding: 12, background: EMBRY.bgCard, borderRadius: 6, border: `1px solid ${EMBRY.border}` }}>
          <input value={newModel.alias} onChange={e => setNewModel(p => ({ ...p, alias: e.target.value }))}
            placeholder="alias" aria-label="Model alias" style={{ ...inputStyle, width: 140, fontSize: 11 }} />
          <select value={newModel.provider} onChange={e => setNewModel(p => ({ ...p, provider: e.target.value }))}
            aria-label="Provider" style={selectStyle}>
            <option value="ollama">ollama</option>
            <option value="chutes">chutes</option>
            <option value="scillm">scillm</option>
            <option value="subagent">subagent</option>
          </select>
          <input value={newModel.model} onChange={e => setNewModel(p => ({ ...p, model: e.target.value }))}
            placeholder="model ID" aria-label="Model ID" style={{ ...inputStyle, width: 180, fontSize: 11 }} />
          <input value={newModel.params_b} onChange={e => setNewModel(p => ({ ...p, params_b: e.target.value }))}
            placeholder="B" aria-label="Params (B)" style={{ ...inputStyle, width: 60, fontSize: 11 }} />
          {CAP_KEYS.map(cap => {
            const { icon: Icon, tip, color } = CAP_META[cap]
            const on = newModel[cap as keyof typeof newModel] as boolean
            return (
              <button key={cap} onClick={() => setNewModel(p => ({ ...p, [cap]: !on }))} title={tip}
                style={{
                  padding: '4px 6px', borderRadius: 3, cursor: 'pointer',
                  background: on ? `${color}20` : 'transparent', color: on ? color : EMBRY.muted,
                  border: `1px solid ${on ? color + '44' : EMBRY.border}`, display: 'flex', alignItems: 'center',
                }}>
                <Icon size={12} />
              </button>
            )
          })}
          <button onClick={saveNewModel} disabled={!newModel.alias || !newModel.model || saving}
            style={{
              padding: '5px 14px', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: (!newModel.alias || !newModel.model) ? EMBRY.muted : EMBRY.green,
              color: '#000', fontWeight: 700, fontSize: 10,
            }}>
            {saving ? '...' : 'SAVE'}
          </button>
          <button onClick={() => setShowAddForm(false)} aria-label="Cancel"
            style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 4 }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Model chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {filtered.map(([alias, config]) => {
          const active = selected.includes(alias)
          const isLocal = config.local || config.provider === 'ollama'
          const pColor = providerColor(config)
          const caps = CAP_KEYS.filter(c => c === 'reasoning' ? (config.reasoning || config.thinking_mode) : config[c])
          return (
            <button key={alias} onClick={() => onToggle(alias)}
              aria-pressed={active} aria-label={`Select model ${alias}`}
              style={{
                padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 5,
                background: active ? `${pColor}12` : EMBRY.bgCard,
                color: active ? EMBRY.white : EMBRY.dim,
                border: `1px solid ${active ? pColor + '66' : EMBRY.border}`,
                transition: 'all 0.15s',
              }}>
              <span>{alias}</span>
              <span style={{ fontSize: 9, fontFamily: MONO, color: EMBRY.muted }}>{config.params_b ?? '?'}B</span>
              <span style={{
                fontSize: 8, padding: '1px 4px', borderRadius: 3,
                background: `${pColor}15`, color: pColor, border: `1px solid ${pColor}33`,
              }}>{isLocal ? 'local' : config.provider}</span>
              {caps.map(c => {
                const { icon: Icon, tip, color } = CAP_META[c]
                return (
                  <span key={c} title={tip}
                    style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 2px', borderRadius: 2, color, background: `${color}15` }}>
                    <Icon size={10} />
                  </span>
                )
              })}
            </button>
          )
        })}
      </div>
    </div>
  )
}
