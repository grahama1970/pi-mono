### React Component Structure

#### 1. **SymbolTree Component**
```jsx
const SymbolTree = ({
  allNodes,
  allEdges,
  selectedNode,
  onSelectNode,
  onExpandInGraph,
  onAddNote,
  onCopyName,
}) => {
  const [expandedNamespaces, setExpandedNamespaces] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState({
    rpc: true,
    event: true,
    schema: true,
    state_machine: true,
    cli_command: true,
    parameter: true,
  });

  const treeData = deriveTreeData(allNodes, allEdges, expandedNamespaces, searchQuery, activeFilters);

  const handleToggleNamespace = (namespace) => {
    const newExpanded = new Set(expandedNamespaces);
    if (newExpanded.has(namespace)) {
      newExpanded.delete(namespace);
    } else {
      newExpanded.add(namespace);
    }
    setExpandedNamespaces(newExpanded);
  };

  const handleSearchChange = (e) => setSearchQuery(e.target.value);

  const handleFilterToggle = (type) => {
    setActiveFilters((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  return (
    <div style={styles.container}>
      <div style={styles.searchAndFilters}>
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={handleSearchChange}
          style={styles.searchInput}
        />
        <div style={styles.filterChips}>
          {Object.keys(activeFilters).map((type) => (
            <button
              key={type}
              style={{
                ...styles.filterChip,
                backgroundColor: activeFilters[type] ? '#7c3aed' : '#334155',
              }}
              onClick={() => handleFilterToggle(type)}
            >
              {type}
            </button>
          ))}
        </div>
      </div>
      <div style={styles.tree}>
        {treeData.map((namespaceNode) => (
          <NamespaceNode
            key={namespaceNode.id}
            node={namespaceNode}
            selectedNode={selectedNode}
            onSelectNode={onSelectNode}
            onToggleNamespace={handleToggleNamespace}
            onExpandInGraph={onExpandInGraph}
            onAddNote={onAddNote}
            onCopyName={onCopyName}
          />
        ))}
      </div>
    </div>
  );
};
```

#### 2. **NamespaceNode Component**
```jsx
const NamespaceNode = ({
  node,
  selectedNode,
  onSelectNode,
  onToggleNamespace,
  onExpandInGraph,
  onAddNote,
  onCopyName,
}) => {
  const isExpanded = expandedNamespaces.has(node.id);

  return (
    <div style={styles.namespaceContainer}>
      <div
        style={styles.namespaceHeader}
        onClick={() => onToggleNamespace(node.id)}
      >
        <span style={styles.expandArrow}>{isExpanded ? '▼' : '▶'}</span>
        <span style={styles.namespaceDot} />
        <span style={styles.namespaceName}>{node.name}</span>
        <span style={styles.connectionCount}>({node.connectionCount})</span>
      </div>
      {isExpanded && (
        <div style={styles.childrenContainer}>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedNode={selectedNode}
              onSelectNode={onSelectNode}
              onExpandInGraph={onExpandInGraph}
              onAddNote={onAddNote}
              onCopyName={onCopyName}
            />
          ))}
        </div>
      )}
    </div>
  );
};
```

#### 3. **TreeNode Component**
```jsx
const TreeNode = ({
  node,
  selectedNode,
  onSelectNode,
  onExpandInGraph,
  onAddNote,
  onCopyName,
}) => {
  const isSelected = selectedNode?.id === node.id;

  const handleContextMenu = (e) => {
    e.preventDefault();
    // Show context menu with options: Expand in Graph, Add Note, Copy Name
  };

  return (
    <div
      style={{
        ...styles.treeNode,
        backgroundColor: isSelected ? '#334155' : 'transparent',
      }}
      onClick={() => onSelectNode(node)}
      onContextMenu={handleContextMenu}
    >
      <span style={{ ...styles.typeDot, backgroundColor: node.color }} />
      <span style={styles.nodeName}>{node.name}</span>
      <span style={styles.connectionCount}>({node.connectionCount})</span>
    </div>
  );
};
```

---

### Inline Styles

```javascript
const styles = {
  container: {
    backgroundColor: '#0b1220',
    color: '#e2e8f0',
    fontFamily: 'JetBrains Mono',
    fontSize: '12px',
    padding: '8px',
    height: '100%',
    overflowY: 'auto',
  },
  searchAndFilters: {
    marginBottom: '12px',
  },
  searchInput: {
    width: '100%',
    padding: '4px 8px',
    backgroundColor: '#1e293b',
    color: '#e2e8f0',
    border: '1px solid #334155',
    borderRadius: '4px',
    marginBottom: '8px',
  },
  filterChips: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
  },
  filterChip: {
    padding: '4px 8px',
    borderRadius: '12px',
    border: 'none',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontSize: '10px',
  },
  tree: {
    paddingLeft: '8px',
  },
  namespaceContainer: {
    marginBottom: '8px',
  },
  namespaceHeader: {
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    padding: '4px 0',
  },
  expandArrow: {
    marginRight: '4px',
  },
  namespaceDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#e2e8f0',
    marginRight: '4px',
  },
  namespaceName: {
    fontWeight: 'bold',
  },
  connectionCount: {
    marginLeft: 'auto',
    color: '#94a3b8',
  },
  childrenContainer: {
    marginLeft: '16px',
  },
  treeNode: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 0',
    cursor: 'pointer',
  },
  typeDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    marginRight: '4px',
  },
  nodeName: {
    flex: 1,
  },
};
```

---

### Integration with BinaryExplorerView

1. **Shared State**: The `selectedNode` is passed as a prop to `SymbolTree` and updated via `onSelectNode`.
2. **Data Panel**: When a node is selected, the `BinaryExplorerView` updates the data panel with the node's details.
3. **Graph Highlighting**: If the graph is visible, the selected node is highlighted using the `onExpandInGraph` callback.

---

### Tree Data Structure Derivation

```javascript
const deriveTreeData = (allNodes, allEdges, expandedNamespaces, searchQuery, activeFilters) => {
  const namespaceMap = new Map();

  // Group nodes by namespace
  allNodes.forEach((node) => {
    if (!namespaceMap.has(node.namespace)) {
      namespaceMap.set(node.namespace, []);
    }
    namespaceMap.get(node.namespace).push(node);
  });

  // Build tree structure
  return Array.from(namespaceMap.entries()).map(([namespace, nodes]) => {
    const children = nodes
      .filter((node) => activeFilters[node.type])
      .filter((node) => node.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .map((node) => ({
        ...node,
        connectionCount: allEdges.filter((edge) => edge.source === node.id || edge.target === node.id).length,
      }));

    return {
      id: namespace,
      name: namespace,
      type: 'namespace',
      children,
      connectionCount: children.reduce((sum, child) => sum + child.connectionCount, 0),
    };
  });
};
```

This structure ensures the tree is dynamically built based on the current filters and search query.
