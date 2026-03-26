import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  MousePointer2,
  Hand,
  Layers,
  Image as ImageIcon,
  Grid3X3,
  Minus,
  Plus,
  Maximize,
  Trash2,
  RefreshCw,
  ArrowUpRight,
  PlusCircle,
  Link as LinkIcon,
  Info,
  MessageSquare,
  Clock,
  Search,
  Settings,
  Palette,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

type ActivityTab = 'details' | 'inspirations' | 'tokens' | 'rationale' | 'history' | 'search';

interface Card {
  id: string;
  name: string;
  src: string;
  x: number;
  y: number;
  zIndex: number;
  width: number;
  height: number;
}

interface DesignBoardData {
  rounds: { name: string; src: string }[];
  stitchImages: { name: string; src: string }[];
}

interface ContextMenu {
  x: number;
  y: number;
  type: 'card' | 'canvas';
  cardId?: string;
}

const cn = (...classes: string[]) => classes.filter(Boolean).join(' ');

export function DesignBoardCanvas({ projectId }: { projectId: string }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [showGrid, setShowGrid] = useState(true);
  const [loading, setLoading] = useState(true);

  const [isPanning, setIsPanning] = useState(false);
  const [draggingCard, setDraggingCard] = useState<{ id: string; startX: number; startY: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

  const [activeTab, setActiveTab] = useState<ActivityTab>('details');
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // Click-away to dismiss context menu
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [contextMenu]);

  const containerRef = useRef<HTMLDivElement>(null);
  const lastMousePos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch(`/api/projects/${projectId}/design-board`);
        const data: DesignBoardData = await res.json();

        const allImages = [...data.rounds, ...data.stitchImages];

        const initialCards: Card[] = allImages.map((img, i) => ({
          id: `card-${i}-${Date.now()}`,
          name: img.name,
          src: img.src,
          x: (i % 3) * 450 + 100,
          y: Math.floor(i / 3) * 350 + 100,
          zIndex: i + 1,
          width: 320,
          height: 200,
        }));

        setCards(initialCards);
      } catch (err) {
        console.error("Failed to load design board:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [projectId]);

  const toCanvasCoords = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - offset.x) / scale,
      y: (clientY - rect.top - offset.y) / scale
    };
  }, [offset, scale]);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY;
      const factor = Math.pow(1.1, delta / 100);
      const newScale = Math.min(Math.max(scale * factor, 0.1), 5);

      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const newOffsetX = mouseX - (mouseX - offset.x) * (newScale / scale);
        const newOffsetY = mouseY - (mouseY - offset.y) * (newScale / scale);

        setScale(newScale);
        setOffset({ x: newOffsetX, y: newOffsetY });
      }
    } else {
      setOffset(prev => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || tool === 'pan') {
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      startWindowDrag();
      return;
    }

    if (e.target === containerRef.current) {
      setSelectedId(null);
      setContextMenu(null);
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const dx = e.clientX - lastMousePos.current.x;
    const dy = e.clientY - lastMousePos.current.y;
    lastMousePos.current = { x: e.clientX, y: e.clientY };

    if (isPanning) {
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    } else if (draggingCard) {
      setCards(prev => prev.map(c =>
        c.id === draggingCard.id
          ? { ...c, x: c.x + dx / scale, y: c.y + dy / scale }
          : c
      ));
    }
  };

  const onMouseUp = useCallback(() => {
    setIsPanning(false);
    setDraggingCard(null);
  }, []);

  // Use refs for drag state so window listeners always see current values
  const draggingRef = useRef(draggingCard);
  const scaleRef = useRef(scale);
  const panningRef = useRef(isPanning);
  draggingRef.current = draggingCard;
  scaleRef.current = scale;
  panningRef.current = isPanning;

  const startWindowDrag = useCallback(() => {
    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      lastMousePos.current = { x: e.clientX, y: e.clientY };

      if (panningRef.current) {
        setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      } else if (draggingRef.current) {
        const s = scaleRef.current;
        const did = draggingRef.current.id;
        setCards(prev => prev.map(c =>
          c.id === did ? { ...c, x: c.x + dx / s, y: c.y + dy / s } : c
        ));
      }
    };
    const handleUp = () => {
      setIsPanning(false);
      setDraggingCard(null);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, []);

  const handleCardMouseDown = (e: React.MouseEvent, card: Card) => {
    if (tool === 'pan') return;
    e.stopPropagation();
    setSelectedId(card.id);
    setDraggingCard({ id: card.id, startX: card.x, startY: card.y });
    lastMousePos.current = { x: e.clientX, y: e.clientY };
    startWindowDrag();
  };

  const handleBringForward = (id: string) => {
    const maxZ = Math.max(...cards.map(c => c.zIndex), 0);
    setCards(prev => prev.map(c => c.id === id ? { ...c, zIndex: maxZ + 1 } : c));
    setContextMenu(null);
  };

  const handleDelete = (id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
    setContextMenu(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const coords = toCanvasCoords(e.clientX, e.clientY);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        const newCard: Card = {
          id: `file-${Date.now()}`,
          name: file.name,
          src: event.target?.result as string,
          x: coords.x - 160,
          y: coords.y - 100,
          zIndex: cards.length + 1,
          width: 320,
          height: 200,
        };
        setCards(prev => [...prev, newCard]);
      };
      reader.readAsDataURL(file);
    }

    const url = e.dataTransfer.getData('url') || e.dataTransfer.getData('text/plain');
    if (url && url.startsWith('http')) {
       const newCard: Card = {
          id: `url-${Date.now()}`,
          name: 'Imported Asset',
          src: url,
          x: coords.x - 160,
          y: coords.y - 100,
          zIndex: cards.length + 1,
          width: 320,
          height: 200,
        };
        setCards(prev => [...prev, newCard]);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, type: 'card' | 'canvas', cardId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, type, cardId });
  };

  const gridStyle = useMemo(() => ({
    backgroundImage: showGrid ? 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 0)' : 'none',
    backgroundSize: `${20 * scale}px ${20 * scale}px`,
    backgroundPosition: `${offset.x}px ${offset.y}px`
  }), [scale, offset, showGrid]);

  const selectedCard = cards.find(c => c.id === selectedId);

  const activityIcons: { id: ActivityTab; icon: React.ReactNode; label: string }[] = [
    { id: 'details', icon: <Info size={20} strokeWidth={1.5} />, label: 'Details' },
    { id: 'inspirations', icon: <ImageIcon size={20} strokeWidth={1.5} />, label: 'Inspirations' },
    { id: 'tokens', icon: <Palette size={20} strokeWidth={1.5} />, label: 'Tokens' },
    { id: 'rationale', icon: <MessageSquare size={20} strokeWidth={1.5} />, label: 'Rationale' },
    { id: 'history', icon: <Clock size={20} strokeWidth={1.5} />, label: 'History' },
    { id: 'search', icon: <Search size={20} strokeWidth={1.5} />, label: 'Search' },
  ];

  return (
    <div className="flex w-full h-full">
    {/* ═══ CANVAS AREA ═══ */}
    <div
      ref={containerRef}
      data-testid="design-board-canvas"
      className="relative flex-1 bg-black overflow-hidden cursor-default select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onWheel={handleWheel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onContextMenu={(e) => handleContextMenu(e, 'canvas')}
    >
      {/* Background Grid */}
      <div className="absolute inset-0 pointer-events-none" style={gridStyle} />

      {/* Canvas Content */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: '0 0'
        }}
      >
        {cards.map(card => (
          <div
            key={card.id}
            data-testid={`canvas-card-${card.id}`}
            onMouseDown={(e) => handleCardMouseDown(e, card)}
            onContextMenu={(e) => handleContextMenu(e, 'card', card.id)}
            className={cn(
              "absolute pointer-events-auto group cursor-grab active:cursor-grabbing transition-shadow duration-300",
              selectedId === card.id ? "z-[999]" : ""
            )}
            style={{
              left: card.x,
              top: card.y,
              zIndex: card.zIndex,
              width: card.width,
              height: card.height
            }}
          >
            <div className={cn(
              "w-full h-full rounded-xl border overflow-hidden transition-all duration-200 bg-[#1a1a1a]",
              selectedId === card.id
                ? "border-[#7c3aed]/50 shadow-[0_0_24px_rgba(124,58,237,0.2)]"
                : "border-white/10 group-hover:border-[#7c3aed]/30"
            )}>
              <img
                src={card.src}
                alt={card.name}
                className={cn(
                  "w-full h-full object-cover transition-opacity duration-300",
                  selectedId === card.id ? "opacity-100" : "opacity-70 group-hover:opacity-100"
                )}
              />
            </div>
            <div className="mt-3 flex items-center gap-2 font-mono text-[10px] tracking-wider uppercase">
              <span className={cn(
                selectedId === card.id ? "text-[#d2bbff]" : "text-slate-500"
              )}>
                {card.name}
              </span>
              {selectedId === card.id && (
                <span className="text-[#7c3aed] flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-[#7c3aed] animate-pulse" />
                  ACTIVE
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Left Toolbar */}
      <aside data-testid="canvas-toolbar" className="fixed left-6 top-1/2 -translate-y-1/2 flex flex-col gap-2 p-1.5 z-50 bg-[#201f1f]/80 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl">
        <button
          data-testid="tool-select"
          onClick={() => setTool('select')}
          className={cn(
            "p-3 rounded-xl transition-all flex flex-col items-center gap-1",
            tool === 'select' ? "bg-[#7c3aed]/20 text-[#d2bbff] border-l-2 border-[#7c3aed]" : "text-slate-500 hover:bg-white/5"
          )}
        >
          <MousePointer2 size={18} />
          <span className="font-mono text-[8px] uppercase font-bold">Select</span>
        </button>
        <button
          data-testid="tool-pan"
          onClick={() => setTool('pan')}
          className={cn(
            "p-3 rounded-xl transition-all flex flex-col items-center gap-1",
            tool === 'pan' ? "bg-[#7c3aed]/20 text-[#d2bbff] border-l-2 border-[#7c3aed]" : "text-slate-500 hover:bg-white/5"
          )}
        >
          <Hand size={18} />
          <span className="font-mono text-[8px] uppercase font-bold">Pan</span>
        </button>
        <div className="h-px bg-white/5 mx-2 my-1" />
        <button className="p-3 text-slate-500 hover:bg-white/5 rounded-xl flex flex-col items-center gap-1">
          <Layers size={18} />
          <span className="font-mono text-[8px] uppercase font-bold">Layers</span>
        </button>
        <button className="p-3 text-slate-500 hover:bg-white/5 rounded-xl flex flex-col items-center gap-1">
          <ImageIcon size={18} />
          <span className="font-mono text-[8px] uppercase font-bold">Assets</span>
        </button>
        <div className="h-px bg-white/5 mx-2 my-1" />
        <button
          data-testid="tool-grid"
          onClick={() => setShowGrid(!showGrid)}
          className={cn(
            "p-3 rounded-xl transition-all",
            showGrid ? "text-[#d2bbff]" : "text-slate-600"
          )}
        >
          <Grid3X3 size={18} />
        </button>
      </aside>

      {/* Zoom Controls */}
      <div data-testid="zoom-controls" className="fixed bottom-8 left-8 flex items-center bg-[#201f1f]/80 backdrop-blur-md border border-white/10 rounded-full p-1 shadow-2xl z-50">
        <button
          data-testid="zoom-out"
          onClick={() => setScale(s => Math.max(s - 0.1, 0.1))}
          className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white"
        >
          <Minus size={14} />
        </button>
        <div data-testid="zoom-level" className="px-3 border-x border-white/5 font-mono text-[10px] text-slate-300 min-w-[50px] text-center">
          {Math.round(scale * 100)}%
        </div>
        <button
          data-testid="zoom-in"
          onClick={() => setScale(s => Math.min(s + 0.1, 5))}
          className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white"
        >
          <Plus size={14} />
        </button>
        <div className="w-px h-4 bg-white/10 mx-1" />
        <button
          data-testid="zoom-reset"
          onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}
          className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white"
        >
          <Maximize size={14} />
        </button>
      </div>

      {/* Status Indicator */}
      <div data-testid="canvas-status" className="fixed bottom-8 right-8 flex items-center gap-4 bg-black/40 backdrop-blur-sm px-4 py-2 rounded-full border border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse shadow-[0_0_8px_#00ff88]" />
          <span className="font-mono text-[9px] text-[#00ff88] uppercase tracking-[0.2em]">System Nominal</span>
        </div>
        <div className="w-px h-3 bg-white/10" />
        <span className="font-mono text-[9px] text-slate-500 uppercase tracking-[0.2em]">
          {cards.length} ITEMS
        </span>
      </div>

      {/* Empty State */}
      {!loading && cards.length === 0 && (
        <div data-testid="canvas-empty" className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 pointer-events-none">
          <PlusCircle size={48} strokeWidth={1} className="mb-4 opacity-20" />
          <p className="font-mono text-xs tracking-widest uppercase opacity-40">
            Drop images here or right-click to add
          </p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div data-testid="canvas-loading" className="absolute inset-0 flex items-center justify-center bg-black z-[100]">
          <div className="flex flex-col items-center gap-4">
            <RefreshCw size={24} className="text-[#7c3aed] animate-spin" />
            <span className="font-mono text-[10px] tracking-[0.3em] text-[#7c3aed]">INITIALIZING CANVAS</span>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          data-testid="context-menu"
          className="fixed z-[1000] bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl py-1 backdrop-blur-md min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'card' ? (
            <>
              <button
                data-testid="ctx-delete"
                onClick={() => handleDelete(contextMenu.cardId!)}
                className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-sans text-slate-300 hover:bg-[#7c3aed]/20 hover:text-[#d2bbff] transition-colors"
              >
                Delete <Trash2 size={12} />
              </button>
              <button data-testid="ctx-replace" className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-sans text-slate-300 hover:bg-[#7c3aed]/20 hover:text-[#d2bbff] transition-colors">
                Replace <RefreshCw size={12} />
              </button>
              <div className="h-px bg-white/5 my-1" />
              <button
                data-testid="ctx-bring-forward"
                onClick={() => handleBringForward(contextMenu.cardId!)}
                className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-sans text-slate-300 hover:bg-[#7c3aed]/20 hover:text-[#d2bbff] transition-colors"
              >
                Bring Forward <Layers size={12} />
              </button>
            </>
          ) : (
            <>
              <button data-testid="ctx-add-image" className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-sans text-slate-300 hover:bg-[#7c3aed]/20 hover:text-[#d2bbff] transition-colors">
                Add Image <ArrowUpRight size={12} />
              </button>
              <button data-testid="ctx-paste-url" className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-sans text-slate-300 hover:bg-[#7c3aed]/20 hover:text-[#d2bbff] transition-colors">
                Paste URL <LinkIcon size={12} />
              </button>
            </>
          )}
        </div>
      )}
    </div>

    {/* ═══ RIGHT PANEL (collapsible, content from Activity Bar) ═══ */}
    {!panelCollapsed && (
      <div data-testid="right-panel" className="w-[280px] bg-[#111111] border-l border-white/[0.13] flex flex-col overflow-hidden shrink-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.13]">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500" style={{ fontFamily: 'Inter, sans-serif' }}>
            {activeTab.toUpperCase()}
          </span>
          <button onClick={() => setPanelCollapsed(true)} className="text-slate-500 hover:text-white">
            <ChevronRight size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'details' && (
            selectedCard ? (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="text-[14px] font-bold text-[#e2e8f0]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{selectedCard.name}</div>
                  <div className="text-[11px] text-slate-500 mt-1 font-mono">{selectedCard.width} × {selectedCard.height}</div>
                </div>
                <div className="flex flex-col gap-1 text-[11px] text-slate-500">
                  <div className="flex justify-between"><span>Position</span><span className="font-mono text-slate-400">{Math.round(selectedCard.x)}, {Math.round(selectedCard.y)}</span></div>
                  <div className="flex justify-between"><span>Z-Index</span><span className="font-mono text-slate-400">{selectedCard.zIndex}</span></div>
                </div>
                <div className="h-px bg-white/[0.08]" />
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-2">ANNOTATIONS</div>
                  <div className="text-[10px] text-slate-600 italic">No annotations yet. Right-click card to add.</div>
                </div>
                <div className="h-px bg-white/[0.08]" />
                <div className="flex flex-col gap-2">
                  <button className="w-full py-2 px-3 bg-[#7c3aed] text-white text-[11px] font-semibold rounded-md hover:bg-[#6d28d9] transition-colors">Send to Gemini</button>
                  <button className="w-full py-2 px-3 border border-white/[0.13] text-[#e2e8f0] text-[11px] rounded-md hover:border-white/25 transition-colors">Copy HTML</button>
                  <button className="w-full py-2 px-3 bg-[#00ff88] text-[#141414] text-[11px] font-semibold rounded-md hover:bg-[#00e67a] transition-colors">Approve</button>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-600 text-center py-8">Select a card to view details</div>
            )
          )}

          {activeTab === 'tokens' && (
            <div className="flex flex-col gap-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-1">COLORS</div>
              {[
                { name: 'green', hex: '#00ff88' }, { name: 'red', hex: '#ff4444' },
                { name: 'amber', hex: '#ffaa00' }, { name: 'blue', hex: '#4a9eff' },
                { name: 'accent', hex: '#7c3aed' }, { name: 'white', hex: '#e2e8f0' },
                { name: 'dim', hex: '#64748b' }, { name: 'muted', hex: '#334155' },
              ].map(c => (
                <div key={c.name} className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-sm border border-white/10 shrink-0" style={{ backgroundColor: c.hex }} />
                  <span className="text-[11px] text-slate-400 flex-1">{c.name}</span>
                  <span className="text-[10px] font-mono text-slate-500">{c.hex}</span>
                </div>
              ))}
              <div className="h-px bg-white/[0.08] mt-2" />
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-1">TYPOGRAPHY</div>
              <div className="text-[14px] font-bold text-slate-300" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Space Grotesk</div>
              <div className="text-[13px] text-slate-400" style={{ fontFamily: 'Inter, sans-serif' }}>Inter — Body text</div>
              <div className="text-[11px] text-slate-400 font-mono">JetBrains Mono — Code</div>
            </div>
          )}

          {activeTab === 'inspirations' && (
            <div className="text-[11px] text-slate-600 text-center py-8">
              Drop reference screenshots here or use /dogpile to find inspiration.
            </div>
          )}

          {activeTab === 'rationale' && (
            <div className="text-[11px] text-slate-600 text-center py-8">
              Run /create-design-board with persona rationale to populate.
            </div>
          )}

          {activeTab === 'history' && (
            <div className="flex flex-col gap-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-1">ROUNDS</div>
              {cards.map((c, i) => (
                <div key={c.id} className="flex items-center gap-2 text-[10px] text-slate-400 py-1 border-l-2 border-[#7c3aed]/30 pl-3">
                  <span className="font-mono text-[#7c3aed]">R{i + 1}</span>
                  <span>{c.name}</span>
                </div>
              ))}
              {cards.length === 0 && <div className="text-[11px] text-slate-600 italic">No rounds yet.</div>}
            </div>
          )}

          {activeTab === 'search' && (
            <div className="flex flex-col gap-3">
              <input type="text" placeholder="Search cards, annotations..." className="w-full bg-[#0b1220] border border-white/[0.13] rounded-md px-3 py-2 text-[11px] text-[#e2e8f0] outline-none focus:border-[#7c3aed]/50" />
              <div className="text-[10px] text-slate-600 italic">Type to search across all project assets.</div>
            </div>
          )}
        </div>
      </div>
    )}

    {/* ═══ ACTIVITY BAR (far right, 48px, VS Code style) ═══ */}
    <div data-testid="activity-bar" className="w-12 bg-[#0b1220] border-l border-white/[0.13] flex flex-col items-center py-4 gap-1 shrink-0">
      {panelCollapsed && (
        <button onClick={() => setPanelCollapsed(false)} className="mb-2 text-slate-500 hover:text-white">
          <ChevronLeft size={14} />
        </button>
      )}
      {activityIcons.map((item) => (
        <button
          key={item.id}
          data-testid={`activity-${item.id}`}
          onClick={() => { setActiveTab(item.id); if (panelCollapsed) setPanelCollapsed(false); }}
          title={item.label}
          className={cn(
            "w-12 h-12 flex items-center justify-center transition-all relative",
            activeTab === item.id && !panelCollapsed
              ? "text-[#e2e8f0] bg-[#7c3aed]/8"
              : "text-slate-500 hover:text-slate-300"
          )}
        >
          {activeTab === item.id && !panelCollapsed && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-[#7c3aed] rounded-r" />
          )}
          {item.icon}
        </button>
      ))}
      <div className="flex-1" />
      <div className="h-px w-6 bg-white/[0.08] my-2" />
      <button className="w-12 h-12 flex items-center justify-center text-slate-600 hover:text-slate-400">
        <Settings size={20} strokeWidth={1.5} />
      </button>
    </div>
    </div>
  );
}
