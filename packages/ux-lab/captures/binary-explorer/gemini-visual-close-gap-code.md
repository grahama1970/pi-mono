Here are the complete Canvas 2D implementations for the requested features, tuned to match Neo4j Bloom's visual quality:

---

### **1. Node Rendering (`nodeCanvasObject` callback)**

```tsx
const nodeCanvasObject = useCallback((node: FGNodeObj, ctx: CanvasRenderingContext2D, globalScale: number) => {
  const n = node as FGNodeObj & FGNode;
  if (n.x == null || n.y == null) return;
  const x = n.x, y = n.y;
  const r = n.__radius ?? 6;
  const color = n.__color ?? EMBRY.dim;
  const importance = n.__importance ?? 0.4;
  const selected = selectedRef.current;
  const visited = visitedRef.current;
  const isTarget = n.id === selected;
  const isConnected = selected ? connectedIds.has(n.id) : false;
  const isVisited = visited?.has(n.id) ?? false;
  const hasSelection = !!selected;
  const hasVisibleEdges = shownEdgeKeys.size > 0;

  // Compute opacity
  let opacity: number;
  if (!hasSelection) {
    opacity = isMatched(n.id) ? importance : 0.12;
  } else if (isTarget) {
    opacity = 1;
  } else if (isConnected) {
    opacity = 0.70;
  } else if (isVisited) {
    opacity = 0.50;
  } else {
    opacity = hasVisibleEdges ? 0.30 : 0.70;
  }

  ctx.save();
  ctx.globalAlpha = opacity;

  // Glow filter for selected node
  if (isTarget) {
    ctx.shadowColor = EMBRY.accent;
    ctx.shadowBlur = 12;
  }

  // Main circle with soft shadow
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();

  // Stroke: selected = white, visited = accent, tier dash patterns
  if (isTarget) {
    ctx.strokeStyle = EMBRY.white;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else if (isVisited && hasSelection) {
    ctx.strokeStyle = EMBRY.accent;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = opacity * 0.4;
    ctx.stroke();
    ctx.globalAlpha = opacity;
  } else {
    // Subtle type-color stroke for normal nodes
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = opacity * 0.6;
    if (n.tier === 'T1') ctx.setLineDash([4, 2]);
    else if (n.tier === 'T2') ctx.setLineDash([1, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = opacity;
  }

  ctx.shadowBlur = 0;

  // State machine double-ring
  if (n.nodeType === 'state_machine') {
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, 2 * Math.PI);
    ctx.strokeStyle = NODE_TYPE_COLORS.state_machine;
    ctx.lineWidth = 1;
    ctx.globalAlpha = opacity * 0.4;
    ctx.setLineDash([2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = opacity;
  }

  // Tier badge dot at top-right
  const tierColor = TIER_COLORS[n.tier];
  if (tierColor) {
    ctx.beginPath();
    ctx.arc(x + r - 2, y - (r - 2), 3, 0, 2 * Math.PI);
    ctx.fillStyle = tierColor;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.strokeStyle = EMBRY.bgDeep;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = opacity;
  }

  ctx.restore();
}, [connectedIds, shownEdgeKeys, isMatched, hasFilter, matchedNodeIds]);
```

---

### **2. Edge Rendering (`linkCanvasObject` callback)**

```tsx
const linkCanvasObject = useCallback((link: FGLinkObj, ctx: CanvasRenderingContext2D, globalScale: number) => {
  const l = link as FGLinkObj & FGLink;
  const source = l.source as FGNodeObj;
  const target = l.target as FGNodeObj;
  if (!source?.x || !source?.y || !target?.x || !target?.y) return;

  const sx = source.x, sy = source.y;
  const tx = target.x, ty = target.y;
  const edgeType = l.edgeType;
  const color = EDGE_COLORS[edgeType] ?? EMBRY.dim;
  const baseWidth = EDGE_WIDTHS[edgeType] ?? 1.0;

  // Build edge key for visibility check
  const sId = (source as FGNodeObj & FGNode).id;
  const tId = (target as FGNodeObj & FGNode).id;
  const edgeKey = `${sId}→${tId}→${edgeType}`;
  const isShown = shownEdgeKeys.has(edgeKey);

  ctx.save();
  ctx.globalAlpha = isShown ? 1 : 0.3;

  // Curved path for 'contains' edges
  if (edgeType === 'contains') {
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const cpX = sx + dx * 0.5 + (dy / dist) * 50;
    const cpY = sy + dy * 0.5 - (dx / dist) * 50;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cpX, cpY, tx, ty);
    ctx.strokeStyle = color;
    ctx.lineWidth = baseWidth;
    ctx.stroke();
  } else {
    // Straight path for other edges
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.strokeStyle = color;
    ctx.lineWidth = baseWidth;
    ctx.stroke();
  }

  // Arrowhead at target end
  const angle = Math.atan2(ty - sy, tx - sx);
  const arrowSize = 6;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - arrowSize * Math.cos(angle - Math.PI / 6), ty - arrowSize * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(tx - arrowSize * Math.cos(angle + Math.PI / 6), ty - arrowSize * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  ctx.restore();
}, [shownEdgeKeys]);
```

---

### **3. Label Rendering (`nodeCanvasObjectMode: 'after'`)**

```tsx
const nodeCanvasObjectMode = 'after';

const nodeCanvasObject = useCallback((node: FGNodeObj, ctx: CanvasRenderingContext2D, globalScale: number) => {
  const n = node as FGNodeObj & FGNode;
  if (n.x == null || n.y == null) return;
  const x = n.x, y = n.y;
  const r = n.__radius ?? 6;
  const importance = n.__importance ?? 0.4;

  // Show label based on zoom and importance
  const showLabel = (globalScale * importance) > 0.5;
  if (!showLabel) return;

  const label = n.label.length > 22 ? `${n.label.slice(0, 20)}…` : n.label;
  const fontSize = Math.max(8, 8 / globalScale > 12 ? 12 : 8);
  const padding = 4;
  const textWidth = ctx.measureText(label).width;

  // Dark background pill
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x - textWidth / 2 - padding, y + r + 4 - padding, textWidth + 2 * padding, fontSize + 2 * padding, 8);
  ctx.fillStyle = EMBRY.bgDeep;
  ctx.globalAlpha = 0.8;
  ctx.fill();

  // Text
  ctx.font = `600 ${fontSize}px JetBrains Mono, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = EMBRY.dim;
  ctx.globalAlpha = 1;
  ctx.fillText(label, x, y + r + 4);
  ctx.restore();
}, []);
```

---

### **4. Force Layout Tuning**

```tsx
useEffect(() => {
  const fg = fgRef.current;
  if (!fg) return;

  // Match Bloom-like spread
  const area = dimensions.width * dimensions.height;
  const nodeCount = graphData.nodes.length || 1;
  const chargeStrength = -Math.max(800, area / (nodeCount * 1.2));

  const charge = fg.d3Force('charge');
  if (charge && 'strength' in charge) {
    (charge as any).strength(chargeStrength)
      .distanceMax(Math.max(dimensions.width, dimensions.height) * 1.5);
  }

  const link = fg.d3Force('link');
  if (link && 'distance' in link) {
    (link as any).distance(150).strength(0.35);
  }

  const center = fg.d3Force('center');
  if (center && 'strength' in center) {
    (center as any).strength(0.08);
  }

  // Warmup and cooldown
  fg.d3ReheatSimulation();
  fg.cooldownTicks(300);
}, [graphData.nodes.length, dimensions]);
```

---

These changes will significantly improve the visual quality of your graph explorer to match Neo4j Bloom's polish. Let me know if you need further adjustments!
