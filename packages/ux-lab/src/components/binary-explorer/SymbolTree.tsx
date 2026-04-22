/**
 * SymbolTree — Ghidra-style hierarchy view for Binary Explorer.
 * Collapsible tree: binary root → namespaces → type groups → symbols.
 * Click selects (updates data panel). Right-click for context menu.
 * Shared component pattern — same selectedNode/onSelect as graph.
 *
 * v3: Proper RE hierarchy (binary → namespaces → type groups → symbols),
 *     type icons (not just dots), sort controls (alpha/tier/connections),
 *     sticky namespace headers, fuzzy search, peek preview on hover,
 *     relationship grouping (JetBrains logical view pattern).
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import {
  ChevronRight, ChevronDown, Search, X,
  Code2, Zap, Database, GitBranch, Terminal, Hash, Package, Radio, Braces,
  ArrowUpAZ, Layers, Activity,
} from 'lucide-react'
import { EMBRY } from '../common/EmbryStyle'
import { NODE_TYPE_COLORS } from '../../hooks/useBinaryData'
import type { BinaryGraphNode } from '../../hooks/useBinaryData'
import { ContextMenu } from '../common/ContextMenu'

interface SymbolTreeProps {
  graphNodes: BinaryGraphNode[]
  allEdges: { _from: string; _to: string; edge_type: string }[]
  selectedNode: BinaryGraphNode | null
  onSelectNode: (node: BinaryGraphNode) => void
  onExpandInGraph?: (nodeId: string) => void
}

interface TreeNamespace {
  name: string
  id: string
  node: BinaryGraphNode
  children: Map<string, BinaryGraphNode[]> // type → nodes
  // Relationship groups: group by what edges connect to
  relationGroups: Map<string, { edgeType: string; nodes: BinaryGraphNode[] }>
  totalCount: number
  section: string // .text / .data / .events / .bss
}

interface TreeSection {
  name: string // .text, .data, .events, .bss
  namespaces: TreeNamespace[]
  totalCount: number
}

/** Simple fuzzy match: characters must appear in order */
function fuzzyMatch(query: string, target: string): { match: boolean; score: number } {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (!q) return { match: true, score: 1 }
  if (t.includes(q)) return { match: true, score: 1 } // exact substring = best

  let qi = 0
  let consecutive = 0
  let maxConsecutive = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++
      consecutive++
      maxConsecutive = Math.max(maxConsecutive, consecutive)
    } else {
      consecutive = 0
    }
  }
  if (qi < q.length) return { match: false, score: 0 }
  return { match: true, score: maxConsecutive / q.length }
}

export function SymbolTree({ graphNodes, allEdges, selectedNode, onSelectNode, onExpandInGraph }: SymbolTreeProps) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set())
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set(['rpc', 'event', 'schema', 'state_machine', 'cli_command', 'parameter', 'function']))
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: BinaryGraphNode } | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const [focusIdx, setFocusIdx] = useState(-1)
  const [peekNode, setPeekNode] = useState<BinaryGraphNode | null>(null)
  const [peekPos, setPeekPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [viewMode, setViewMode] = useState<'type' | 'relationship'>('type')
  // Sort mode: alpha = name, address = VA order (mirrors disasm view), size = largest first
  const [sortBy, setSortBy] = useState<'alpha' | 'address' | 'size'>('alpha')
  const [binaryExpanded, setBinaryExpanded] = useState(true)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['.text', '.data', '.events', '.bss']))

  // Build tree structure
  const tree = useMemo(() => {
    const namespaces = graphNodes.filter(n => n.nodeType === 'namespace')
    const edgeMap = new Map<string, string[]>() // parent → children
    allEdges.filter(e => e.edge_type === 'contains').forEach(e => {
      const arr = edgeMap.get(e._from) || []
      arr.push(e._to)
      edgeMap.set(e._from, arr)
    })

    // Build degree map locally so sort-by-connections works
    const localDegree = new Map<string, number>()
    allEdges.forEach(e => {
      localDegree.set(e._from, (localDegree.get(e._from) ?? 0) + 1)
      localDegree.set(e._to, (localDegree.get(e._to) ?? 0) + 1)
    })

    const q = search.toLowerCase()
    const result: TreeNamespace[] = []

    for (const ns of namespaces) {
      const childIds = edgeMap.get(ns.id) || []
      const children = new Map<string, BinaryGraphNode[]>()
      const relationGroups = new Map<string, { edgeType: string; nodes: BinaryGraphNode[] }>()
      let totalCount = 0

      const allChildNodes: BinaryGraphNode[] = []

      for (const childId of childIds) {
        const child = graphNodes.find(n => n.id === childId)
        if (!child) continue
        if (!typeFilter.has(child.nodeType)) continue
        if (q) {
          const fm = fuzzyMatch(q, child.label)
          if (!fm.match && !child.nodeType.includes(q)) continue
        }

        const arr = children.get(child.nodeType) || []
        arr.push(child)
        children.set(child.nodeType, arr)
        allChildNodes.push(child)
        totalCount++
      }

      // Also find children not connected by edges (orphans in this namespace's cluster)
      const clusterName = ns.label.replace('.* namespace', '').replace('.*', '').trim()
      for (const n of graphNodes) {
        if (n.nodeType === 'namespace') continue
        if (n.cluster === clusterName && !childIds.includes(n.id)) {
          if (!typeFilter.has(n.nodeType)) continue
          if (q) {
            const fm = fuzzyMatch(q, n.label)
            if (!fm.match && !n.nodeType.includes(q)) continue
          }
          const arr = children.get(n.nodeType) || []
          if (!arr.find(c => c.id === n.id)) {
            arr.push(n)
            children.set(n.nodeType, arr)
            allChildNodes.push(n)
            totalCount++
          }
        }
      }

      // Build relationship groups (JetBrains logical view)
      for (const child of allChildNodes) {
        const edges = allEdges.filter(e => e._from === child.id || e._to === child.id)
        for (const edge of edges) {
          if (edge.edge_type === 'contains') continue // skip hierarchy edges
          const groupKey = edge.edge_type
          const group = relationGroups.get(groupKey) || { edgeType: edge.edge_type, nodes: [] }
          if (!group.nodes.find(n => n.id === child.id)) {
            group.nodes.push(child)
          }
          relationGroups.set(groupKey, group)
        }
      }

      // Sort children within each type: alpha, address (VA order = disasm view), or size (largest first)
      const nodeCmp = (a: BinaryGraphNode, b: BinaryGraphNode): number => {
        if (sortBy === 'address') {
          const addrA = (a as any).address ?? (a as any).va ?? Infinity
          const addrB = (b as any).address ?? (b as any).va ?? Infinity
          return addrA - addrB || a.label.localeCompare(b.label)
        }
        if (sortBy === 'size') {
          const sizeA = (a as any).size ?? (a as any).byte_count ?? 0
          const sizeB = (b as any).size ?? (b as any).byte_count ?? 0
          return sizeB - sizeA || a.label.localeCompare(b.label)
        }
        return a.label.localeCompare(b.label)
      }
      for (const [, arr] of children) arr.sort(nodeCmp)
      for (const [, group] of relationGroups) group.nodes.sort(nodeCmp)

      // Determine section: .text = code, .data = data/schema, .events = events, .bss = mixed
      const codeTypes = ['rpc', 'cli_command', 'state_machine', 'function']
      const dataTypes = ['schema', 'parameter']
      let codeCount = 0, dataCount = 0, eventCount = 0
      for (const [type, nodes] of children) {
        if (codeTypes.includes(type)) codeCount += nodes.length
        if (dataTypes.includes(type)) dataCount += nodes.length
        if (type === 'event') eventCount += nodes.length
      }
      let section = '.bss'
      if (eventCount > 0 && eventCount >= codeCount && eventCount >= dataCount) section = '.events'
      else if (dataCount > codeCount) section = '.data'
      else if (codeCount > 0) section = '.text'

      if (totalCount > 0 || !q) {
        result.push({ name: ns.label, id: ns.id, node: ns, children, relationGroups, totalCount, section })
      }
    }

    // Auto-expand all when searching
    if (q) {
      setExpanded(new Set(result.map(r => r.id)))
      setExpandedTypes(new Set(result.flatMap(r => [...r.children.keys()].map(t => `${r.id}:${t}`))))
    }

    // Sort namespaces: address order mirrors disasm view, size = largest ns first, alpha = name
    if (sortBy === 'address') {
      result.sort((a, b) => {
        const addrA = (a.node as any).address ?? (a.node as any).va ?? Infinity
        const addrB = (b.node as any).address ?? (b.node as any).va ?? Infinity
        return addrA - addrB || a.name.localeCompare(b.name)
      })
    } else if (sortBy === 'size') {
      result.sort((a, b) => b.totalCount - a.totalCount || a.name.localeCompare(b.name))
    } else {
      result.sort((a, b) => a.name.localeCompare(b.name))
    }

    // Group into sections — binary → sections (.text/.data/.events/.bss) → namespaces → symbols
    const sectionOrder = ['.text', '.data', '.events', '.bss']
    const sectionMap = new Map<string, TreeNamespace[]>()
    for (const ns of result) {
      const arr = sectionMap.get(ns.section) || []
      arr.push(ns)
      sectionMap.set(ns.section, arr)
    }
    return sectionOrder
      .filter(s => sectionMap.has(s))
      .map(s => {
        const namespaces = sectionMap.get(s)!
        return { name: s, namespaces, totalCount: namespaces.reduce((sum, ns) => sum + ns.totalCount, 0) } as TreeSection
      })
  }, [graphNodes, allEdges, search, typeFilter, sortBy])

  // Degree lookup for connection count
  const degreeMap = useMemo(() => {
    const m = new Map<string, number>()
    allEdges.forEach(e => {
      m.set(e._from, (m.get(e._from) ?? 0) + 1)
      m.set(e._to, (m.get(e._to) ?? 0) + 1)
    })
    return m
  }, [allEdges])

  const toggleNs = (id: string) => setExpanded(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const toggleType = (key: string) => setExpandedTypes(prev => {
    const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next
  })

  const toggleSection = (name: string) => setExpandedSections(prev => {
    const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next
  })

  // Flat list of visible items for keyboard navigation
  const flatItems = useMemo(() => {
    const items: BinaryGraphNode[] = []
    if (!binaryExpanded) return items
    for (const section of tree) {
      if (!expandedSections.has(section.name)) continue
      for (const ns of section.namespaces) {
        items.push(ns.node)
        if (expanded.has(ns.id)) {
          for (const [type, nodes] of ns.children) {
            const key = `${ns.id}:${type}`
            if (expandedTypes.has(key)) {
              items.push(...nodes)
            }
          }
        }
      }
    }
    return items
  }, [tree, binaryExpanded, expandedSections, expanded, expandedTypes])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!treeRef.current?.contains(document.activeElement) && document.activeElement !== treeRef.current) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx(i => Math.min(i + 1, flatItems.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx(i => Math.max(i - 1, 0)) }
      if (e.key === 'Enter' && focusIdx >= 0 && focusIdx < flatItems.length) {
        onSelectNode(flatItems[focusIdx])
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [flatItems, focusIdx, onSelectNode])

  // Peek preview handlers
  const handlePeekEnter = (node: BinaryGraphNode, e: React.MouseEvent) => {
    if (peekTimerRef.current) clearTimeout(peekTimerRef.current)
    peekTimerRef.current = setTimeout(() => {
      setPeekNode(node)
      setPeekPos({ x: e.clientX + 16, y: e.clientY - 10 })
    }, 400) // 400ms delay before showing peek
  }
  const handlePeekLeave = () => {
    if (peekTimerRef.current) clearTimeout(peekTimerRef.current)
    setPeekNode(null)
  }

  const typeOrder = ['function', 'rpc', 'event', 'schema', 'state_machine', 'cli_command', 'parameter']
  const edgeTypeColors: Record<string, string> = {
    triggers: '#4CAF50', emits: '#FF9800', payload: '#2196F3',
    has_parameter: '#9C27B0', contains: '#64748b',
  }

  // Icons that map to RE-meaningful node types — icons beat colored dots for quick scanning
  const NODE_TYPE_ICONS: Record<string, React.ReactNode> = {
    function:      <Braces   size={10} />,
    rpc:           <Code2    size={10} />,
    event:         <Radio    size={10} />,
    schema:        <Database size={10} />,
    state_machine: <GitBranch size={10} />,
    cli_command:   <Terminal size={10} />,
    parameter:     <Hash     size={10} />,
    namespace:     <Package  size={10} />,
  }

  const renderFeatureRow = (node: BinaryGraphNode, indent: number) => {
    const iconColor = NODE_TYPE_COLORS[node.nodeType] || EMBRY.dim
    const tierLabel = node.tier !== 'T2' ? node.tier : null // T0/T1 shown, T2 omitted (noise)
    return (
      <div key={node.id}
        onClick={() => onSelectNode(node)}
        onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, node }) }}
        onMouseEnter={e => handlePeekEnter(node, e)}
        onMouseLeave={handlePeekLeave}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: `2px 8px 2px ${indent}px`, cursor: 'pointer',
          background: selectedNode?.id === node.id ? `${EMBRY.accent}10` : 'transparent',
          borderLeft: selectedNode?.id === node.id ? `2px solid ${EMBRY.accent}` : '2px solid transparent',
        }}
        onMouseOver={e => { if (selectedNode?.id !== node.id) (e.currentTarget as HTMLDivElement).style.background = '#111' }}
        onMouseOut={e => { if (selectedNode?.id !== node.id) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
      >
        <span style={{ color: iconColor, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {NODE_TYPE_ICONS[node.nodeType] ?? <Zap size={10} />}
        </span>
        <span style={{ fontSize: 10, color: EMBRY.white, flex: 1, fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {search ? highlightMatch(node.label, search) : node.label}
        </span>
        {tierLabel && <span style={{ fontSize: 7, color: EMBRY.muted, padding: '0 2px', borderRadius: 2, border: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>{tierLabel}</span>}
        {/* Address (VA) when available — mirrors disasm view column */}
        {(node as any).address != null && (
          <span style={{ fontSize: 7, color: EMBRY.muted, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
            {`0x${((node as any).address as number).toString(16).padStart(8, '0')}`}
          </span>
        )}
        {/* Size in bytes when available */}
        {(node as any).size != null && (
          <span style={{ fontSize: 7, color: EMBRY.dim, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
            {`${(node as any).size}B`}
          </span>
        )}
        <span style={{ fontSize: 8, color: EMBRY.muted, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>{degreeMap.get(node.id) ?? 0}</span>
      </div>
    )
  }

  return (
    <div ref={treeRef} tabIndex={0} style={{ display: 'flex', flexDirection: 'column', height: '100%', outline: 'none' }}>
      {/* Search + type filter + view mode */}
      <div style={{ padding: '8px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: '#0a0a0a', borderRadius: 3, border: `1px solid ${EMBRY.border}` }}>
          <Search size={11} color={EMBRY.dim} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Fuzzy search features..."
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: EMBRY.white, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }} />
          {search && <X size={10} color={EMBRY.dim} style={{ cursor: 'pointer' }} onClick={() => setSearch('')} />}
        </div>
        <div style={{ display: 'flex', gap: 3, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {typeOrder.map(type => (
            <button key={type} onClick={() => setTypeFilter(prev => {
              const next = new Set(prev); next.has(type) ? next.delete(type) : next.add(type); return next
            })} style={{
              fontSize: 8, padding: '1px 5px', borderRadius: 2, cursor: 'pointer',
              border: `1px solid ${typeFilter.has(type) ? (NODE_TYPE_COLORS[type] || EMBRY.dim) + '66' : EMBRY.border}`,
              background: typeFilter.has(type) ? (NODE_TYPE_COLORS[type] || EMBRY.dim) + '15' : 'transparent',
              color: typeFilter.has(type) ? NODE_TYPE_COLORS[type] || EMBRY.dim : EMBRY.muted,
            }}>{type.replace('_', ' ')}</button>
          ))}
          <span style={{ flex: 1 }} />
          {/* Sort control: alpha → address (VA order) → size — all RE-meaningful orderings */}
          <button
            onClick={() => setSortBy(s => s === 'alpha' ? 'address' : s === 'address' ? 'size' : 'alpha')}
            title={sortBy === 'alpha' ? 'A→Z (click for address order)' : sortBy === 'address' ? 'By VA address (click for size)' : 'By size, largest first (click for A→Z)'}
            style={{ fontSize: 7, padding: '1px 4px', borderRadius: 2, cursor: 'pointer', border: `1px solid ${EMBRY.border}`, background: 'transparent', color: EMBRY.dim, display: 'flex', alignItems: 'center', gap: 2 }}>
            {sortBy === 'alpha'   && <><ArrowUpAZ size={8} /> AZ</>}
            {sortBy === 'address' && <><Hash      size={8} /> ADDR</>}
            {sortBy === 'size'    && <><Activity  size={8} /> SIZE</>}
          </button>
          {/* View mode toggle: by type vs by relationship */}
          <button onClick={() => setViewMode(v => v === 'type' ? 'relationship' : 'type')}
            title={viewMode === 'type' ? 'Group by relationship' : 'Group by type'}
            style={{ fontSize: 7, padding: '1px 4px', borderRadius: 2, cursor: 'pointer', border: `1px solid ${EMBRY.border}`, background: 'transparent', color: EMBRY.muted }}>
            {viewMode === 'type' ? 'BY TYPE' : 'BY EDGE'}
          </button>
        </div>
      </div>

      {/* Tree: binary → sections → namespaces → type groups → symbols */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {/* Binary root — collapsible, mirrors Ghidra program tree root */}
        {tree.length > 0 && (
          <div
            onClick={() => setBinaryExpanded(b => !b)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#0d0d0d', borderBottom: `1px solid ${EMBRY.border}`, cursor: 'pointer' }}>
            {binaryExpanded ? <ChevronDown size={11} color={EMBRY.dim} /> : <ChevronRight size={11} color={EMBRY.dim} />}
            <span style={{ color: EMBRY.dim, display: 'flex', alignItems: 'center' }}><Layers size={11} /></span>
            <span style={{ fontSize: 10, fontWeight: 700, color: EMBRY.dim, fontFamily: 'JetBrains Mono, monospace', flex: 1 }}>binary</span>
            <span style={{ fontSize: 8, color: EMBRY.muted }}>
              {tree.reduce((s, sec) => s + sec.namespaces.length, 0)} ns · {tree.reduce((s, sec) => s + sec.totalCount, 0)} sym
            </span>
          </div>
        )}
        {binaryExpanded && tree.map(section => (
          <div key={section.name}>
            {/* Section header (.text / .data / .events / .bss) — ELF/PE section analogue */}
            <div
              onClick={() => toggleSection(section.name)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px 3px 20px', cursor: 'pointer',
                background: '#0b0b0b', borderBottom: `1px solid ${EMBRY.border}`,
                position: 'sticky', top: 0, zIndex: 3,
              }}>
              {expandedSections.has(section.name) ? <ChevronDown size={10} color={EMBRY.dim} /> : <ChevronRight size={10} color={EMBRY.dim} />}
              <span style={{ fontSize: 9, fontWeight: 700, color: EMBRY.accent, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.05em' }}>{section.name}</span>
              <span style={{ fontSize: 7, color: EMBRY.muted, marginLeft: 4, fontStyle: 'italic' }}>logical</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 8, color: EMBRY.muted }}>{section.namespaces.length} ns · {section.totalCount} sym</span>
            </div>

            {expandedSections.has(section.name) && section.namespaces.map(ns => (
              <div key={ns.id}>
                {/* Sticky namespace header */}
                <div
                  onClick={() => { toggleNs(ns.id); onSelectNode(ns.node) }}
                  onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, node: ns.node }) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px 4px 28px', cursor: 'pointer',
                    background: selectedNode?.id === ns.id ? `${EMBRY.accent}15` : '#0a0a0a',
                    borderLeft: selectedNode?.id === ns.id ? `2px solid ${EMBRY.accent}` : '2px solid transparent',
                    position: 'sticky', top: 24, zIndex: 2,
                    borderBottom: `1px solid ${EMBRY.border}`,
                  }}
                >
                  {expanded.has(ns.id) ? <ChevronDown size={12} color={EMBRY.dim} /> : <ChevronRight size={12} color={EMBRY.dim} />}
                  <span style={{ color: NODE_TYPE_COLORS.namespace, display: 'flex', alignItems: 'center', flexShrink: 0 }}><Package size={11} /></span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: EMBRY.white, flex: 1, fontFamily: 'JetBrains Mono, monospace' }}>{ns.name}</span>
                  <span style={{ fontSize: 9, color: EMBRY.muted, fontFamily: 'JetBrains Mono, monospace' }}>{ns.totalCount}</span>
                </div>

                {/* Type groups (default view) */}
                {expanded.has(ns.id) && viewMode === 'type' && typeOrder.map(type => {
                  const nodes = ns.children.get(type)
                  if (!nodes || nodes.length === 0) return null
                  const typeKey = `${ns.id}:${type}`
                  return (
                    <div key={typeKey}>
                      <div onClick={() => toggleType(typeKey)}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px 2px 44px', cursor: 'pointer' }}>
                        {expandedTypes.has(typeKey) ? <ChevronDown size={10} color={EMBRY.muted} /> : <ChevronRight size={10} color={EMBRY.muted} />}
                        <span style={{ color: NODE_TYPE_COLORS[type] || EMBRY.dim, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                          {NODE_TYPE_ICONS[type] ?? <Zap size={10} />}
                        </span>
                        <span style={{ fontSize: 9, color: NODE_TYPE_COLORS[type] || EMBRY.dim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{type.replace('_', ' ')}</span>
                        <span style={{ fontSize: 8, color: EMBRY.muted }}>{nodes.length}</span>
                      </div>
                      {expandedTypes.has(typeKey) && nodes.map(node => renderFeatureRow(node, 60))}
                    </div>
                  )
                })}

                {/* Relationship groups (logical view) */}
                {expanded.has(ns.id) && viewMode === 'relationship' && [...ns.relationGroups.entries()].map(([edgeType, group]) => {
                  const groupKey = `${ns.id}:rel:${edgeType}`
                  return (
                    <div key={groupKey}>
                      <div onClick={() => toggleType(groupKey)}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px 2px 44px', cursor: 'pointer' }}>
                        {expandedTypes.has(groupKey) ? <ChevronDown size={10} color={EMBRY.muted} /> : <ChevronRight size={10} color={EMBRY.muted} />}
                        <span style={{ width: 8, height: 2, backgroundColor: edgeTypeColors[edgeType] || EMBRY.dim, flexShrink: 0, borderRadius: 1 }} />
                        <span style={{ fontSize: 9, color: edgeTypeColors[edgeType] || EMBRY.dim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{edgeType.replace('_', ' ')}</span>
                        <span style={{ fontSize: 8, color: EMBRY.muted }}>{group.nodes.length}</span>
                      </div>
                      {expandedTypes.has(groupKey) && group.nodes.map(node => renderFeatureRow(node, 60))}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Peek preview tooltip */}
      {peekNode && (
        <div style={{
          position: 'fixed', left: peekPos.x, top: peekPos.y,
          background: '#111', border: `1px solid ${EMBRY.border}`, borderRadius: 4,
          padding: '8px 10px', maxWidth: 280, zIndex: 100, pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: NODE_TYPE_COLORS[peekNode.nodeType] || EMBRY.dim }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: EMBRY.white, fontFamily: 'JetBrains Mono, monospace' }}>{peekNode.label}</span>
          </div>
          <div style={{ fontSize: 8, color: EMBRY.dim, textTransform: 'uppercase', marginBottom: 3 }}>{peekNode.nodeType.replace('_', ' ')} · {peekNode.cluster}</div>
          {peekNode.description && (
            <div style={{ fontSize: 9, color: EMBRY.muted, lineHeight: 1.4 }}>{peekNode.description.slice(0, 150)}{peekNode.description.length > 150 ? '...' : ''}</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 8, color: EMBRY.accent }}>{degreeMap.get(peekNode.id) ?? 0} connections</span>
            {peekNode.confidence != null && <span style={{ fontSize: 8, color: EMBRY.dim }}>{Math.round(peekNode.confidence * 100)}% conf</span>}
          </div>
          {(peekNode.fields?.length ?? 0) > 0 && (
            <div style={{ fontSize: 8, color: EMBRY.muted, marginTop: 3 }}>Fields: {peekNode.fields?.slice(0, 3).map((f: any) => f.name || f).join(', ')}{(peekNode.fields?.length ?? 0) > 3 ? ` +${(peekNode.fields?.length ?? 0) - 3}` : ''}</div>
          )}
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} items={[
          { label: 'Show in Graph', onClick: () => { onSelectNode(ctxMenu.node); onExpandInGraph?.(ctxMenu.node.id) } },
          { label: 'Copy Name', onClick: () => navigator.clipboard.writeText(ctxMenu.node.label) },
          { label: 'Peek Details', onClick: () => { onSelectNode(ctxMenu.node) } },
        ]} />
      )}
    </div>
  )
}

/** Highlight matching characters in search results */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  const qLower = query.toLowerCase()

  // Try exact substring first
  const idx = lower.indexOf(qLower)
  if (idx >= 0) {
    return (
      <>
        {text.slice(0, idx)}
        <span style={{ background: `${EMBRY.accent}30`, color: EMBRY.accent }}>{text.slice(idx, idx + query.length)}</span>
        {text.slice(idx + query.length)}
      </>
    )
  }

  // Fuzzy: highlight each matching character
  const parts: React.ReactNode[] = []
  let qi = 0
  for (let i = 0; i < text.length; i++) {
    if (qi < qLower.length && lower[i] === qLower[qi]) {
      parts.push(<span key={i} style={{ color: EMBRY.accent }}>{text[i]}</span>)
      qi++
    } else {
      parts.push(text[i])
    }
  }
  return <>{parts}</>
}
