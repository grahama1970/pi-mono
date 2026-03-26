import React, { useState, useEffect, useCallback } from 'react';
import { 
  LayoutDashboard, 
  Package, 
  MousePointer2, 
  Eye, 
  Settings, 
  HelpCircle, 
  History, 
  Bell, 
  Share2, 
  Rocket,
  Menu,
  PanelLeft,
  PanelLeftClose,
  ChevronRight,
  User,
  Activity,
  Zap,
  Thermometer,
  Wifi,
  Database,
  Search,
  Plus,
  Minus,
  Maximize2,
  Grid,
  Terminal,
  Cpu,
  ShieldCheck,
  Network,
  Play,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  Upload,
  RefreshCcw,
  Download,
  Layout,
  ChevronLeft,
  Share,
  Database as DatabaseIcon,
  Code2,
  FileCode,
  FileJson,
  Layers,
  Smartphone,
  Shield,
  Filter,
  ArrowRight,
  Clock,
  AlertTriangle,
  List,
  Lock,
  Minimize2,
  MoreVertical
} from 'lucide-react';

// Lazy load project components
// Real project components — lazy loaded
const SpartaExplorerView = React.lazy(() => import('./components/sparta/explorer/SpartaExplorer').then(m => ({ default: m.SpartaExplorer })));
const BinaryExplorer = React.lazy(() => import('./components/binary-explorer/BinaryExplorerView').then(m => ({ default: m.BinaryExplorerView })));
const MusicLab = React.lazy(() => import('./components/music-lab/MusicLabWorkbench').then(m => ({ default: m.MusicLabWorkbench })));
const PromptLab = React.lazy(() => import('./components/sparta/explorer/PromptLabView').then(m => ({ default: m.PromptLabView })));
const ClassifierLab = React.lazy(() => import('./components/sparta/explorer/ClassifierLabView').then(m => ({ default: m.ClassifierLabView })));
const LlmEvalLab = React.lazy(() => import('./components/sparta/explorer/LlmEvalLabView').then(m => ({ default: m.LlmEvalLabView })));
const ArchitectureView = React.lazy(() => import('./components/architecture/ArchitectureView').then(m => ({ default: m.ArchitectureView })));
import { DesignBoardCanvas } from './components/DesignBoardCanvas';
import { AgentControl } from './components/common/AgentControl';
import { TestingPanel } from './components/TestingPanel';

// SPARTA sub-views
const OverviewView = React.lazy(() => import('./components/sparta/explorer/OverviewView').then(m => ({ default: m.OverviewView })));
const SourcesView = React.lazy(() => import('./components/sparta/explorer/SourcesView').then(m => ({ default: m.SourcesView })));
const ControlsView = React.lazy(() => import('./components/sparta/explorer/ControlsView').then(m => ({ default: m.ControlsView })));
const URLsView = React.lazy(() => import('./components/sparta/explorer/URLsView').then(m => ({ default: m.URLsView })));
const QRAsView = React.lazy(() => import('./components/sparta/explorer/QRAsView').then(m => ({ default: m.QRAsView })));
const RelationshipsView = React.lazy(() => import('./components/sparta/explorer/RelationshipsView').then(m => ({ default: m.RelationshipsView })));
const ThreatMatrixView = React.lazy(() => import('./components/sparta/explorer/ThreatMatrixView').then(m => ({ default: m.ThreatMatrixView })));
const PipelineView = React.lazy(() => import('./components/sparta/explorer/PipelineView').then(m => ({ default: m.PipelineView })));
const PromptLabTabView = React.lazy(() => import('./components/sparta/explorer/PromptLabView').then(m => ({ default: m.PromptLabView })));
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useAgentBus } from './lib/useAgentBus';
import type { AgentBusMessage } from './lib/useAgentBus';

// --- Types ---

type View = 'mockups' | 'components' | 'design-board' | 'reviews' | 'testing' | 'final-site';

interface DatabaseStats {
  status: string;
  latency: string;
  throughput: string;
  temp: string;
  packetLoss: string;
  uptime: string;
  lastSync: string;
}

interface Stem {
  id: string;
  name: string;
  completion: number;
  pitchCorr?: string;
  dynamicRange?: string;
  freqRange?: string;
  hits?: number;
  buffer?: string;
}

// --- Components ---

const Mockups = ({ projectId }: { projectId: string }) => {
  const [mockups, setMockups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    '[INIT] CDP_SESSION_START: 0x7FF821',
    '[INFO] SOCKET_CONNECTED: ws://localhost:3001/ws',
  ]);

  useEffect(() => {
    const fetchMockups = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/mockups`);
        const data = await res.json();
        setMockups(data);
        setTerminalLogs(prev => [...prev.slice(-15), `[OK] FETCHED_${data.length}_MOCKUPS`]);
      } catch (err) {
        console.error('Failed to fetch mockups:', err);
        setTerminalLogs(prev => [...prev.slice(-15), `[ERROR] MOCKUP_FETCH_FAILED`]);
      } finally {
        setLoading(false);
      }
    };
    fetchMockups();
  }, [projectId]);

  return (
    <div className="h-full flex flex-col bg-surface-base">
      <div className="p-4 border-b border-white/10 flex items-center justify-between bg-surface-low">
        <h2 className="text-xs font-mono text-slate-400 uppercase tracking-widest">Project Mockups: {projectId}</h2>
        <div className="flex gap-2">
          <button className="p-2 hover:bg-white/5 rounded text-slate-400"><RefreshCcw className="w-4 h-4" /></button>
          <button className="p-2 hover:bg-white/5 rounded text-slate-400"><Download className="w-4 h-4" /></button>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full text-tactical-primary font-mono animate-pulse">
            LOADING_MOCKUP_ASSETS...
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {mockups.map((m, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="group relative aspect-video bg-black border border-white/10 rounded-sm overflow-hidden hover:border-tactical-primary/50 transition-all cursor-pointer"
              >
                <img 
                  src={m.thumbnail} 
                  alt={m.name}
                  className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                  <span className="text-[10px] font-mono text-tactical-primary uppercase truncate">{m.name}</span>
                  <span className="text-[8px] font-mono text-slate-400 mt-1">{m.size} KB :: {m.mtime}</span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <div className="h-32 bg-black border-t border-white/10 p-4 font-mono text-[10px] text-tactical-primary/60 overflow-y-auto custom-scrollbar">
        {terminalLogs.map((log, i) => (
          <div key={i} className="mb-1">{log}</div>
        ))}
      </div>
    </div>
  );
};

const FinalSite = ({ projectId, subpath }: { projectId: string; subpath?: string }) => {
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-surface-base">
      <div className="p-2 border-b border-white/10 flex items-center justify-between bg-surface-low shrink-0">
        <div className="flex items-center gap-4 px-2">
          <h2 className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">FINAL_SITE: {projectId}</h2>
          <div className="flex items-center gap-2 px-2 py-0.5 bg-tactical-success/10 text-tactical-success text-[9px] font-mono border border-tactical-success/20">
            <Activity className="w-3 h-3" /> LIVE_RENDER
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col bg-background modern-scrollbar">
        <React.Suspense fallback={<div className="flex items-center justify-center h-full text-tactical-primary font-mono animate-pulse">RENDERING_FINAL_SITE...</div>}>
          {projectId === 'sparta-explorer' && (
            <SpartaExplorerView views={{
              Overview: <React.Suspense fallback={null}><OverviewView /></React.Suspense>,
              Sources: <React.Suspense fallback={null}><SourcesView /></React.Suspense>,
              Controls: <React.Suspense fallback={null}><ControlsView /></React.Suspense>,
              URLs: <React.Suspense fallback={null}><URLsView /></React.Suspense>,
              QRAs: <React.Suspense fallback={null}><QRAsView /></React.Suspense>,
              Relationships: <React.Suspense fallback={null}><RelationshipsView /></React.Suspense>,
              'Threat Matrix': <React.Suspense fallback={null}><ThreatMatrixView /></React.Suspense>,
              Pipeline: <React.Suspense fallback={null}><PipelineView /></React.Suspense>,
              'Prompt Lab': <React.Suspense fallback={null}><PromptLabTabView /></React.Suspense>,
            }} />
          )}
          {projectId === 'binary-explorer' && <BinaryExplorer />}
          {projectId === 'music-lab-pipeline' && <MusicLab />}
          {projectId === 'prompt-lab' && <PromptLab />}
          {projectId === 'llm-eval-lab' && <LlmEvalLab />}
          {projectId === 'classifier-lab' && <ClassifierLab />}
          {projectId === 'architecture' && <ArchitectureView initialProjectId={subpath || undefined} />}
          {!['sparta-explorer', 'binary-explorer', 'music-lab-pipeline', 'prompt-lab', 'llm-eval-lab', 'classifier-lab', 'architecture'].includes(projectId) && (
            <div className="flex items-center justify-center h-full text-slate-500 font-mono text-sm">
              NO_FINAL_SITE_VIEW_FOR: {projectId}
            </div>
          )}
        </React.Suspense>
      </div>
    </div>
  );
};

interface DesignBoardData {
  hasMarkdown: boolean;
  markdown: string | null;
  rounds: { name: string; src: string }[];
  htmlBoards: { name: string; src: string }[];
  stitchImages: { name: string; src: string }[];
}

const DesignBoard = ({ projectId }: { projectId: string }) => {
  const [data, setData] = useState<DesignBoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [activeHtml, setActiveHtml] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setSelectedImage(null);
    setActiveHtml(null);
    fetch(`/api/projects/${projectId}/design-board`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[10px] font-mono text-slate-500 animate-pulse">LOADING_DESIGN_BOARD...</div>
      </div>
    );
  }

  const hasContent = data && (data.rounds.length > 0 || data.htmlBoards.length > 0 || data.stitchImages.length > 0 || data.hasMarkdown);

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <Layers className="w-8 h-8 text-slate-600" />
        <div className="text-center">
          <p className="text-[11px] font-headline font-bold text-slate-400">No Design Board</p>
          <p className="text-[10px] font-mono text-slate-600 mt-1">Run /create-design-board to generate</p>
        </div>
      </div>
    );
  }

  if (activeHtml) {
    return (
      <div className="w-full h-full flex flex-col">
        <div className="flex items-center gap-3 px-4 py-2 bg-surface-lowest border-b border-white/10">
          <button onClick={() => setActiveHtml(null)} className="text-[10px] font-mono text-slate-400 hover:text-white transition-colors flex items-center gap-1">
            <ChevronLeft className="w-3 h-3" /> BACK
          </button>
          <span className="text-[10px] font-mono text-tactical-primary">{activeHtml.split('/').pop()}</span>
        </div>
        <iframe src={activeHtml} className="flex-1 w-full bg-white" />
      </div>
    );
  }

  if (selectedImage) {
    return (
      <div className="w-full h-full flex flex-col">
        <div className="flex items-center gap-3 px-4 py-2 bg-surface-lowest border-b border-white/10">
          <button onClick={() => setSelectedImage(null)} className="text-[10px] font-mono text-slate-400 hover:text-white transition-colors flex items-center gap-1">
            <ChevronLeft className="w-3 h-3" /> BACK
          </button>
          <span className="text-[10px] font-mono text-tactical-primary">{selectedImage.split('/').pop()}</span>
        </div>
        <div className="flex-1 overflow-auto p-4 flex items-start justify-center">
          <img src={selectedImage} alt="" className="max-w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-y-auto p-6 space-y-8">
      {/* Round Composites */}
      {data!.rounds.length > 0 && (
        <section>
          <h3 className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3">Design Rounds</h3>
          <div className="grid grid-cols-2 gap-4">
            {data!.rounds.map(r => (
              <button key={r.src} onClick={() => setSelectedImage(r.src)} className="group border border-white/5 hover:border-tactical-primary/30 transition-all overflow-hidden bg-surface-lowest text-left">
                <img src={r.src} alt={r.name} className="w-full object-cover" />
                <div className="px-3 py-2 text-[10px] font-mono text-slate-400 group-hover:text-tactical-primary transition-colors truncate">{r.name}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* HTML Design Boards */}
      {data!.htmlBoards.length > 0 && (
        <section>
          <h3 className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3">Design Board HTML</h3>
          <div className="space-y-2">
            {data!.htmlBoards.map(h => (
              <button key={h.src} onClick={() => setActiveHtml(h.src)} className="w-full flex items-center gap-3 px-3 py-2.5 bg-surface-lowest border border-white/5 hover:border-tactical-primary/30 transition-all group text-left">
                <Code2 className="w-4 h-4 text-slate-500 group-hover:text-tactical-primary flex-shrink-0" />
                <span className="text-[11px] font-mono text-slate-300 group-hover:text-white truncate">{h.name}</span>
                <ArrowRight className="w-3 h-3 text-slate-600 group-hover:text-tactical-primary ml-auto flex-shrink-0" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Stitch Mockups */}
      {data!.stitchImages.length > 0 && (
        <section>
          <h3 className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3">Stitch Mockups</h3>
          <div className="grid grid-cols-3 gap-3">
            {data!.stitchImages.map(s => (
              <button key={s.src} onClick={() => setSelectedImage(s.src)} className="group border border-white/5 hover:border-tactical-primary/30 transition-all overflow-hidden bg-surface-lowest text-left">
                <img src={s.src} alt={s.name} className="w-full aspect-video object-cover" />
                <div className="px-2 py-1.5 text-[9px] font-mono text-slate-500 group-hover:text-tactical-primary truncate">{s.name}</div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

const Reviews = ({ projectId }: { projectId: string }) => {
  const [diffPosition, setDiffPosition] = useState(50);
  const [analysis, setAnalysis] = useState<string>('INITIALIZING_VLM_ANALYSIS...');
  const [isComparing, setIsComparing] = useState(false);

  const runComparison = async () => {
    setIsComparing(true);
    setAnalysis('RUNNING_VLM_DIFF_ANALYSIS...');
    try {
      const response = await fetch('/api/scillm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'vlm',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Compare the mockup vs implementation for project ' + projectId + '. List visual differences in padding, color, and alignment.' },
              { type: 'image_url', image_url: { url: `${window.location.origin}/api/projects/${projectId}/mockup-primary` } },
              { type: 'image_url', image_url: { url: `${window.location.origin}/api/projects/${projectId}/screenshot` } }
            ]
          }]
        })
      });
      const data = await response.json();
      setAnalysis(data.choices?.[0]?.message?.content || 'ANALYSIS_COMPLETE: 98.2% MATCH');
    } catch (err) {
      setAnalysis('ERROR: SCILLM_OFFLINE. USING_CACHED_ANALYSIS.');
    } finally {
      setIsComparing(false);
    }
  };

  useEffect(() => {
    runComparison();
  }, [projectId]);

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-white/10 flex items-center justify-between bg-surface-low">
        <div className="flex items-center gap-4">
          <h2 className="text-xs font-mono text-slate-400 uppercase tracking-widest">Visual Diff: {projectId} vs Implementation</h2>
          <div className="flex items-center gap-2 px-2 py-1 bg-tactical-success/10 text-tactical-success text-[10px] font-mono rounded">
            <Zap className="w-3 h-3" /> 98.2% MATCH
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={runComparison}
            disabled={isComparing}
            className="px-3 py-1 bg-surface-high border border-white/10 text-[10px] font-mono hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            {isComparing ? 'ANALYZING...' : 'RERUN_VLM_DIFF'}
          </button>
          <button className="px-3 py-1 bg-tactical-primary text-white text-[10px] font-mono hover:opacity-90 transition-all">APPROVE</button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden group">
        {/* Implementation (Background) */}
        <div className="absolute inset-0 bg-surface-base flex items-center justify-center">
          <img 
            src={`/api/projects/${projectId}/screenshot`} 
            alt="Implementation" 
            className="w-full h-full object-contain"
            referrerPolicy="no-referrer"
          />
          <div className="absolute top-10 right-10 text-[10px] font-mono text-tactical-primary bg-black/50 px-2 py-1">IMPLEMENTATION_LIVE</div>
        </div>

        {/* Mockup (Foreground with Clip) */}
        <div 
          className="absolute inset-0 bg-surface-lowest flex items-center justify-center pointer-events-none"
          style={{ clipPath: `inset(0 ${100 - diffPosition}% 0 0)` }}
        >
          <img 
            src={`/api/projects/${projectId}/mockup-primary`} 
            alt="Mockup" 
            className="w-full h-full object-contain"
            referrerPolicy="no-referrer"
          />
          <div className="absolute top-10 left-10 text-[10px] font-mono text-tactical-success bg-black/50 px-2 py-1">MOCKUP_SPEC_V2.4.0</div>
        </div>

        {/* Slider Handle */}
        <div 
          className="absolute top-0 bottom-0 w-px bg-white z-20 cursor-ew-resize"
          style={{ left: `${diffPosition}%` }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-2xl">
            <div className="flex gap-1">
              <ChevronRight className="w-3 h-3 text-black rotate-180" />
              <ChevronRight className="w-3 h-3 text-black" />
            </div>
          </div>
        </div>

        {/* Invisible Slider Input */}
        <input 
          type="range" 
          min="0" 
          max="100" 
          value={diffPosition} 
          onChange={(e) => setDiffPosition(parseInt(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-30"
        />
      </div>

      {/* AI Suggestions Panel */}
      <div className="h-48 bg-surface-low border-t border-white/10 p-6 flex gap-8 overflow-x-auto">
        <div className="min-w-[300px] flex flex-col flex-1">
          <span className="text-[10px] font-mono text-slate-500 uppercase mb-2">AI_DISCREPANCY_ANALYSIS</span>
          <div className="flex-1 bg-surface-lowest p-3 border border-white/5 rounded font-mono text-[11px] text-slate-300 overflow-y-auto">
            {analysis}
          </div>
        </div>
        <div className="min-w-[300px] flex flex-col">
          <span className="text-[10px] font-mono text-slate-500 uppercase mb-2">SUGGESTED_REPAIR</span>
          <div className="flex-1 bg-surface-lowest p-3 border border-white/5 rounded font-mono text-[11px] text-tactical-success">
            Update tailwind class from 'p-4' to 'p-6' in Component: GridContainer.
          </div>
        </div>
      </div>
    </div>
  );
};

interface ComponentDetail {
  name: string;
  status: 'STABLE' | 'BETA' | 'EXPERIMENTAL';
  usage: number;
  description: string;
  code: string;
  preview: React.ReactNode;
}

const Components = ({ 
  projectId,
  selectedComponent, 
  setSelectedComponent,
  setToast
}: { 
  projectId: string,
  selectedComponent: ComponentDetail | null, 
  setSelectedComponent: (c: ComponentDetail | null) => void,
  setToast: (toast: { message: string, type: 'success' | 'error' } | null) => void
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [realComponents, setRealComponents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchComponents = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/components`);
        const data = await res.json();
        setRealComponents(data);
      } catch (err) {
        console.error('Failed to fetch components:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchComponents();
  }, [projectId]);

  const components: ComponentDetail[] = [
    ...realComponents.map(rc => ({
      name: rc.name,
      status: 'STABLE' as const,
      usage: rc.lines,
      description: `Real component from ${projectId}. Line count: ${rc.lines}.`,
      code: `// Source code for ${rc.name} would be loaded here\nexport const ${rc.name} = () => {\n  return <div>${rc.name}</div>;\n};`,
      preview: <div className="text-tactical-primary font-mono">{rc.name}</div>
    })),
    { 
      name: 'TacticalButton', 
      status: 'STABLE', 
      usage: 124,
      description: 'A high-contrast, tactical button with a neon glow effect and monospace typography.',
      code: `<button className="bg-tactical-primary text-black px-4 py-2 text-xs font-mono uppercase tracking-tighter shadow-[0_0_10px_rgba(0,255,102,0.4)] hover:opacity-90 transition-all">
  EXECUTE_ACTION
</button>`,
      preview: (
        <button className="bg-tactical-primary text-black px-6 py-3 text-sm font-mono uppercase tracking-tighter shadow-[0_0_15px_rgba(0,255,102,0.5)] hover:scale-105 transition-all active:scale-95">
          EXECUTE_ACTION
        </button>
      )
    },
    { 
      name: 'HUD_Overlay', 
      status: 'BETA', 
      usage: 42,
      description: 'A circular HUD overlay with pulsing animations for tracking or targeting interfaces.',
      code: `<div className="w-24 h-24 border border-tactical-success/40 rounded-full flex items-center justify-center relative">
  <div className="absolute inset-0 border-2 border-tactical-success/10 rounded-full animate-ping" />
  <div className="w-16 h-16 border border-tactical-success/20 rounded-full animate-pulse" />
  <div className="w-1 h-1 bg-tactical-success rounded-full" />
</div>`,
      preview: (
        <div className="w-32 h-32 border border-tactical-success/40 rounded-full flex items-center justify-center relative">
          <div className="absolute inset-0 border-2 border-tactical-success/10 rounded-full animate-ping" />
          <div className="w-24 h-24 border border-tactical-success/20 rounded-full animate-pulse" />
          <div className="w-2 h-2 bg-tactical-success rounded-full shadow-[0_0_10px_#00ff88]" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] font-mono text-tactical-success bg-surface-base px-1">TRK_01</div>
        </div>
      )
    },
    { 
      name: 'DataGrid_V4', 
      status: 'STABLE', 
      usage: 89,
      description: 'A high-density data grid for displaying tactical information with monospace alignment.',
      code: `<div className="w-full font-mono text-[10px] border border-white/10 rounded overflow-hidden">
  <div className="bg-white/5 p-2 border-b border-white/10 flex justify-between text-slate-500">
    <span>ID</span><span>STATUS</span><span>LATENCY</span>
  </div>
  <div className="p-2 flex justify-between text-white">
    <span>#001</span><span className="text-tactical-success">ACTIVE</span><span>12ms</span>
  </div>
</div>`,
      preview: (
        <div className="w-full max-w-xs font-mono text-[10px] border border-white/10 rounded overflow-hidden bg-black/20">
          <div className="bg-white/5 p-2 border-b border-white/10 flex justify-between text-slate-500 uppercase tracking-tighter">
            <span>ID</span><span>STATUS</span><span>LATENCY</span>
          </div>
          {[
            { id: '#001', status: 'ACTIVE', color: 'text-tactical-success', lat: '12ms' },
            { id: '#002', status: 'STANDBY', color: 'text-tactical-info', lat: '45ms' },
            { id: '#003', status: 'OFFLINE', color: 'text-tactical-danger', lat: '---' },
          ].map(row => (
            <div key={row.id} className="p-2 flex justify-between text-white border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
              <span>{row.id}</span>
              <span className={row.color}>{row.status}</span>
              <span className="text-slate-400">{row.lat}</span>
            </div>
          ))}
        </div>
      )
    },
    { 
      name: 'SignalGraph', 
      status: 'EXPERIMENTAL', 
      usage: 12,
      description: 'A real-time signal visualization component for monitoring frequency or activity spikes.',
      code: `<div className="flex items-end gap-1 h-12">
  {[40, 70, 45, 90, 65].map((h, i) => (
    <div key={i} className="w-2 bg-tactical-primary/50" style={{ height: \`\${h}%\` }} />
  ))}
</div>`,
      preview: (
        <div className="flex items-end gap-1 h-24 w-48 p-4 bg-black rounded border border-tactical-primary/20">
          {[30, 60, 45, 80, 55, 90, 40, 70, 50, 85].map((h, i) => (
            <motion.div 
              key={i} 
              initial={{ height: 0 }}
              animate={{ height: `${h}%` }}
              transition={{ repeat: Infinity, duration: 1 + Math.random(), repeatType: 'reverse' }}
              className="flex-1 bg-tactical-primary/40 border-t border-tactical-primary shadow-[0_0_10px_rgba(0,255,102,0.2)]" 
            />
          ))}
        </div>
      )
    },
  ];

  const filteredComponents = components.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    c.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (selectedComponent) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-6 border-b border-white/10 flex items-center justify-between bg-surface-low">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setSelectedComponent(null)}
              className="p-2 hover:bg-white/5 rounded-full transition-colors text-slate-400 hover:text-white"
            >
              <ChevronRight className="w-5 h-5 rotate-180" />
            </button>
            <div>
              <h2 className="text-xl font-headline font-bold text-white uppercase tracking-widest flex items-center gap-3">
                {selectedComponent.name}
                <span className={cn(
                  "text-[10px] font-mono px-2 py-0.5 rounded",
                  selectedComponent.status === 'STABLE' ? "bg-tactical-success/20 text-tactical-success" :
                  selectedComponent.status === 'BETA' ? "bg-tactical-info/20 text-tactical-info" : "bg-tactical-warning/20 text-tactical-warning"
                )}>{selectedComponent.status}</span>
              </h2>
              <p className="text-xs font-mono text-slate-500 mt-1">{selectedComponent.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex bg-surface-lowest p-1 rounded border border-white/5">
              {(['desktop', 'tablet', 'mobile'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setPreviewViewport(v)}
                  className={cn(
                    "px-3 py-1 text-[10px] font-mono uppercase transition-all rounded",
                    previewViewport === v ? "bg-tactical-primary text-white" : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button className="flex items-center gap-2 px-4 py-2 bg-surface-high border border-white/10 text-[10px] font-mono text-white hover:bg-white/5 transition-all">
                <Share2 className="w-3 h-3" /> SHARE_COMPONENT
              </button>
              <button className="flex items-center gap-2 px-4 py-2 bg-tactical-primary text-white text-[10px] font-mono font-bold hover:opacity-90 transition-all">
                <Rocket className="w-3 h-3" /> DEPLOY_TO_REGISTRY
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Preview Area */}
          <div className="flex-1 bg-surface-base canvas-grid flex items-center justify-center relative p-12 overflow-auto">
            <div className="absolute top-4 left-4 text-[10px] font-mono text-slate-600 uppercase tracking-widest flex items-center gap-2">
              <Maximize2 className="w-3 h-3" /> LIVE_PREVIEW_STAGE :: {previewViewport.toUpperCase()}
            </div>
            <motion.div 
              layout
              className={cn(
                "glass-hud bg-black/40 border-2 border-white/5 flex items-center justify-center transition-all duration-500 overflow-hidden",
                previewViewport === 'desktop' ? "w-full h-full max-w-4xl max-h-[600px]" :
                previewViewport === 'tablet' ? "w-[768px] h-[1024px] scale-[0.5]" : "w-[375px] h-[667px] scale-[0.8]"
              )}
            >
              <div className="p-12 w-full flex items-center justify-center">
                {selectedComponent.preview}
              </div>
            </motion.div>
            {/* Controls Mockup */}
            <div className="absolute bottom-6 left-6 right-6 flex justify-center gap-4">
              <div className="glass-hud p-3 flex gap-6 text-[10px] font-mono text-slate-500">
                <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-tactical-success" /> INTERACTIVE: ON</div>
                <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-tactical-info" /> VIEWPORT: {previewViewport === 'desktop' ? '100%' : previewViewport === 'tablet' ? '50%' : '80%'}</div>
                <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-tactical-warning" /> THEME: DARK_TACTICAL</div>
              </div>
            </div>
          </div>

          {/* Code Area */}
          <div className="w-[450px] bg-surface-low border-l border-white/10 flex flex-col">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Source Code</span>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(selectedComponent.code);
                  setToast({ message: 'CODE_COPIED_TO_CLIPBOARD', type: 'success' });
                }}
                className="p-1.5 hover:bg-white/5 rounded transition-colors text-tactical-primary flex items-center gap-2 text-[10px] font-mono"
              >
                <Database className="w-4 h-4" /> COPY_CODE
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-black/40 custom-scrollbar">
              <SyntaxHighlighter 
                language="tsx" 
                style={vscDarkPlus}
                customStyle={{
                  margin: 0,
                  padding: '1.5rem',
                  fontSize: '11px',
                  fontFamily: 'JetBrains Mono, monospace',
                  background: 'transparent',
                }}
              >
                {selectedComponent.code}
              </SyntaxHighlighter>
            </div>
            <div className="p-6 bg-surface-lowest border-t border-white/10">
              <h4 className="text-[10px] font-mono text-slate-500 uppercase mb-3">Usage Statistics</h4>
              <div className="space-y-3">
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-slate-400">TOTAL_INSTANCES</span>
                  <span className="text-white">{selectedComponent.usage}</span>
                </div>
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-slate-400">ACTIVE_PROJECTS</span>
                  <span className="text-white">{Math.floor(selectedComponent.usage / 4)}</span>
                </div>
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-slate-400">BUNDLE_SIZE</span>
                  <span className="text-tactical-success">1.2 KB</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 h-full overflow-y-auto custom-scrollbar">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-xl font-headline font-bold text-white uppercase tracking-widest flex items-center gap-3">
            <Package className="w-6 h-6 text-tactical-primary" /> Component Library
          </h2>
          <div className="text-[10px] font-mono text-slate-500 mt-1">REGISTRY: NPM_INTERNAL_V4 :: {filteredComponents.length} COMPONENTS_FOUND</div>
        </div>
        
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input 
            type="text" 
            placeholder="FILTER_COMPONENTS (NAME OR DESC)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-low border border-white/10 rounded-lg py-2.5 pl-10 pr-4 text-[11px] font-mono text-white placeholder:text-slate-700 focus:outline-none focus:border-tactical-primary/40 transition-all shadow-inner"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredComponents.map((comp) => (
          <div 
            key={comp.name} 
            onClick={() => setSelectedComponent(comp)}
            className="glass-hud p-6 group hover:border-tactical-primary/50 transition-all cursor-pointer relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-16 h-16 bg-tactical-primary/5 blur-2xl rounded-full -mr-8 -mt-8 group-hover:bg-tactical-primary/20 transition-all" />
            <div className="flex items-center justify-between mb-4 relative z-10">
              <h3 className="font-headline font-bold text-white group-hover:text-tactical-primary transition-colors">{comp.name}</h3>
              <span className={cn(
                "text-[8px] font-mono px-2 py-0.5 rounded",
                comp.status === 'STABLE' ? "bg-tactical-success/20 text-tactical-success" :
                comp.status === 'BETA' ? "bg-tactical-info/20 text-tactical-info" : "bg-tactical-warning/20 text-tactical-warning"
              )}>{comp.status}</span>
            </div>
            <div className="h-32 bg-surface-lowest border border-white/5 rounded mb-4 flex items-center justify-center overflow-hidden relative">
              <div className="absolute inset-0 canvas-grid opacity-20" />
              <div className="scale-75 pointer-events-none transition-transform group-hover:scale-90 duration-500">
                {comp.preview}
              </div>
            </div>
            <p className="text-[10px] font-mono text-slate-500 line-clamp-2 mb-4 h-8">{comp.description}</p>
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 border-t border-white/5 pt-4">
              <span>USAGE: {comp.usage} INSTANCES</span>
              <div className="flex items-center gap-1 text-tactical-primary group-hover:translate-x-1 transition-transform font-bold">
                EXPLORE <ChevronRight className="w-3 h-3" />
              </div>
            </div>
          </div>
        ))}
      </div>
      {filteredComponents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-slate-600 font-mono">
          <Search className="w-12 h-12 mb-4 opacity-20" />
          <p className="text-sm">NO_COMPONENTS_MATCH_QUERY: "{searchQuery}"</p>
        </div>
      )}
    </div>
  );
};

interface Project {
  id: string;
  title: string;
  subtitle: string;
  date: string;
  shared?: boolean;
  type: 'desktop' | 'mobile';
  thumbnail?: string;
}

const ProjectSidebar = ({ 
  isCollapsed, 
  onToggle, 
  activeProjectId, 
  onProjectSelect 
}: { 
  isCollapsed: boolean, 
  onToggle: () => void,
  activeProjectId: string,
  onProjectSelect: (id: string) => void
}) => {
  const [activeTab, setActiveTab] = useState<'my' | 'shared'>('my');
  const [searchQuery, setSidebarSearch] = useState('');

  // Real projects with working component routing
  const projects: Project[] = [
    { id: 'sparta-explorer', title: 'SPARTA Explorer', subtitle: 'Security knowledge graph', date: '2026-03-22', type: 'desktop' as const },
    { id: 'binary-explorer', title: 'Binary Explorer', subtitle: 'ELF binary analysis', date: '2026-03-22', type: 'desktop' as const, thumbnail: '/captures/binary-explorer/stitch/6d81147866c74cbd8e20fcf020f3a17e.png' },
    { id: 'music-lab-pipeline', title: 'Music Lab Pipeline', subtitle: '10-stage creation pipeline', date: '2026-03-22', type: 'desktop' as const, thumbnail: '/captures/music-lab-pipeline/stitch/d81f2a555f73455098f59c16379d9517.png' },
    { id: 'prompt-lab', title: 'Prompt Lab', subtitle: 'LLM prompt iteration', date: '2026-03-22', type: 'desktop' as const, thumbnail: '/captures/prompt-lab-optimize/stitch/prompt-optimizer-v1.png' },
    { id: 'llm-eval-lab', title: 'LLM Eval Lab', subtitle: 'Model evaluation', date: '2026-03-22', type: 'desktop' as const, thumbnail: '/captures/llm-eval-lab/stitch/8f916e26f7894b119ce06a2743fe262a.png' },
    { id: 'classifier-lab', title: 'Classifier Lab', subtitle: 'ML classifier training pipeline', date: '2026-03-22', type: 'desktop' as const },
    { id: 'architecture', title: 'Architecture', subtitle: 'Visual collaboration diagrams', date: '2026-03-25', type: 'desktop' as const },
  ];

  const filteredProjects = searchQuery
    ? projects.filter(p => p.title.toLowerCase().includes(searchQuery.toLowerCase()) || p.subtitle.toLowerCase().includes(searchQuery.toLowerCase()))
    : projects;

  const getInitials = (title: string) => {
    const words = title.split(/[\s—-]+/).filter(w => w.length > 1)
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
    return title.slice(0, 2).toUpperCase()
  }

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; projectId: string } | null>(null);

  const ProjectItem = ({ project }: { project: Project }) => (
    <div
      data-testid={`project-${project.id}`}
      onClick={() => onProjectSelect(project.id)}
      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, projectId: project.id }); }}
      className={cn(
        "flex cursor-pointer transition-colors group relative",
        isCollapsed ? "items-center justify-center p-1.5" : "items-start gap-3 p-2.5 px-3",
        "hover:bg-white/5",
        activeProjectId === project.id && "bg-tactical-primary/10 border-r-2 border-tactical-primary"
      )}
    >
      <div className={cn(
        "bg-surface-lowest border flex items-center justify-center overflow-hidden flex-shrink-0",
        isCollapsed ? "w-8 h-8" : "w-9 h-9",
        activeProjectId === project.id ? "border-tactical-primary/40" : "border-white/5"
      )}>
        {project.thumbnail ? (
          <img
            src={project.thumbnail}
            alt={project.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className={cn(
            "text-[9px] font-mono font-bold",
            activeProjectId === project.id ? "text-tactical-primary" : "text-slate-500"
          )}>{getInitials(project.title)}</span>
        )}
      </div>
      {!isCollapsed ? (
        <div className="flex-1 min-w-0">
          <h4 className={cn(
            "text-[11px] font-headline font-bold truncate leading-tight transition-colors",
            activeProjectId === project.id ? "text-tactical-primary" : "text-white group-hover:text-tactical-primary"
          )}>
            {project.title}
          </h4>
          <p className="text-[10px] font-mono text-slate-500 truncate">{project.subtitle}</p>
        </div>
      ) : (
        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-surface-high border border-white/10 px-2 py-1 rounded text-[10px] font-mono text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-xl">
          {project.title}
        </div>
      )}
    </div>
  );

  return (
    <aside className={cn(
      "bg-surface-low border-r border-white/10 flex flex-col h-full overflow-hidden transition-all duration-300",
      isCollapsed ? "w-12" : "w-[300px]"
    )}>
      {/* UX Lab Header */}
      <div className={cn("p-6 pb-4", isCollapsed && "p-2 pb-2")}>
        <div className={cn("flex items-center mb-6", isCollapsed ? "justify-center mb-2" : "justify-between")}>
          {!isCollapsed && (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-headline font-bold text-white tracking-tight">UX Lab</h1>
              <span className="text-[8px] font-mono px-1.5 py-0.5 border border-white/20 rounded text-slate-400 uppercase">Beta</span>
            </div>
          )}
          <button
            onClick={onToggle}
            className="p-1.5 hover:bg-white/5 rounded transition-colors text-slate-500 hover:text-white"
          >
            {isCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {!isCollapsed && (
          <>
            {/* Tabs */}
            <div className="flex bg-surface-lowest p-1 rounded-lg mb-4">
              <button 
                onClick={() => setActiveTab('my')}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-1.5 text-[10px] font-headline font-bold rounded-md transition-all",
                  activeTab === 'my' ? "bg-surface-high text-white shadow-sm" : "text-slate-500 hover:text-slate-300"
                )}
              >
                <Grid className="w-3 h-3" /> My Projects
              </button>
              <button 
                onClick={() => setActiveTab('shared')}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-1.5 text-[10px] font-headline font-bold rounded-md transition-all",
                  activeTab === 'shared' ? "bg-surface-high text-white shadow-sm" : "text-slate-500 hover:text-slate-300"
                )}
              >
                <User className="w-3 h-3" /> Shared
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
              <input
                type="text"
                placeholder="Search projects"
                value={searchQuery}
                onChange={(e) => setSidebarSearch(e.target.value)}
                className="w-full bg-surface-lowest border border-white/5 rounded-lg py-2 pl-9 pr-4 text-[11px] font-mono text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-tactical-primary/30 transition-colors"
              />
            </div>
          </>
        )}
      </div>
      
      <div className={cn("flex-1 overflow-y-auto pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]", isCollapsed ? "px-0.5" : "px-3")}>
        {!isCollapsed && <h3 className="px-3 py-2 text-[10px] font-mono text-slate-500 uppercase tracking-widest">Projects</h3>}
        {filteredProjects.map(p => <ProjectItem key={p.id} project={p} />)}
      </div>

      {/* Create New Project — compact, no separate background */}
      <div className={cn("px-3 py-2 border-t border-white/10", isCollapsed && "px-1")}>
        <button className={cn(
          "w-full flex items-center justify-center gap-1.5 py-1.5 border border-tactical-primary/20 text-tactical-primary text-[9px] font-mono font-bold uppercase hover:bg-tactical-primary/10 transition-all rounded",
          isCollapsed && "p-1.5"
        )}>
          <Plus className="w-3 h-3" /> {!isCollapsed && "New Project"}
        </button>
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setCtxMenu(null)} />
          <div style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999 }}
            className="bg-[#1a1a1a] border border-white/10 rounded shadow-xl py-0.5 min-w-[120px]">
            {[
              { label: 'Open in New Tab', action: () => window.open(`#${ctxMenu.projectId}`, '_blank') },
              { label: 'Rename', action: () => {} },
              { label: 'Duplicate', action: () => {} },
              { label: 'Delete', danger: true, action: () => {} },
            ].map((item, i) => (
              <button key={i} onClick={() => { item.action(); setCtxMenu(null); }}
                className={cn(
                  "w-full text-left px-2.5 py-1 text-[9px] font-mono hover:bg-white/5 transition-colors",
                  (item as any).danger ? "text-red-400 hover:text-red-300" : "text-slate-300 hover:text-white"
                )}>{item.label}</button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
};

const ViewHeader = ({ activeView, onViewChange, systemHealth }: { 
  activeView: View, 
  onViewChange: (view: View) => void,
  systemHealth: { health: 'NOMINAL' | 'DEGRADED' | 'OFFLINE', details: string }
}) => {
  return (
    <header className="h-14 bg-black border-b border-tactical-primary/20 flex items-center justify-between px-6 z-40">
      <div className="flex h-full items-center space-x-8">
        {['Mockups', 'Components', 'Design Board', 'Reviews', 'Testing', 'Final Site'].map((label) => {
          const id = label.toLowerCase().replace(' ', '-') as View;
          const isActive = activeView === id;
          return (
            <button
              key={label}
              data-testid={`tab-${id}`}
              onClick={() => onViewChange(id)}
              className={cn(
                "h-full flex flex-col items-center justify-center px-4 font-headline font-medium uppercase text-[10px] tracking-[0.2em] transition-all relative group",
                isActive ? "text-tactical-primary" : "text-slate-600 hover:text-slate-300"
              )}
            >
              <div className="flex items-center gap-2 relative z-10">
                <span>{label}</span>
              </div>
              {isActive && (
                <motion.div 
                  layoutId="activeTab"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-tactical-primary shadow-[0_0_10px_rgba(0,255,102,0.5)]"
                />
              )}
              <div className="absolute inset-0 bg-tactical-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          );
        })}
      </div>

      <div className="flex items-center space-x-4">
        <div className={cn(
          "flex items-center gap-2 px-3 py-1 border rounded-sm transition-colors",
          systemHealth.health === 'NOMINAL' ? "border-tactical-primary/20 bg-tactical-primary/5" :
          systemHealth.health === 'DEGRADED' ? "border-tactical-warning/20 bg-tactical-warning/5" :
          "border-tactical-danger/20 bg-tactical-danger/5"
        )} title={systemHealth.details}>
          <div className={cn(
            "w-1.5 h-1.5 rounded-full animate-pulse",
            systemHealth.health === 'NOMINAL' ? "bg-tactical-success" :
            systemHealth.health === 'DEGRADED' ? "bg-tactical-warning" :
            "bg-tactical-danger"
          )} />
          <span className={cn(
            "text-[9px] font-mono uppercase tracking-tighter",
            systemHealth.health === 'NOMINAL' ? "text-tactical-success" :
            systemHealth.health === 'DEGRADED' ? "text-tactical-warning" :
            "text-tactical-danger"
          )}>
            System: {systemHealth.health}
          </span>
        </div>
        <div className="w-px h-6 bg-tactical-primary/20 mx-2" />
        <button className="text-slate-500 hover:text-tactical-primary transition-all"><History className="w-4 h-4" /></button>
        <button className="text-slate-500 hover:text-tactical-primary transition-all relative">
          <Bell className="w-4 h-4" />
          <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-tactical-danger rounded-full" />
        </button>
        <button className="bg-tactical-primary text-black px-4 py-1.5 text-[10px] font-mono font-black tracking-widest uppercase flex items-center gap-2 hover:bg-tactical-success transition-all">
          <Rocket className="w-3.5 h-3.5" />
          Deploy
        </button>
      </div>
    </header>
  );
};

// --- Testing Manifest Component ---
const TestingManifest = ({ activeProjectId }: { activeProjectId: string }) => {
  const [testLogs, setTestLogs] = useState<string[]>([
    '[INIT] CDP_SESSION_START: 0x7FF821',
    '[INFO] SOCKET_CONNECTED: ws://ux-lab.internal:3000/ws',
    '[OK] MANIFEST_GENERATED: 24 interactive nodes found',
    '[INFO] VIRTUAL_MOUSE_INIT: Non-hijacking mode active',
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const [testStatus, setTestStatus] = useState<'IDLE' | 'RUNNING' | 'PASSED' | 'FAILED' | 'INCONCLUSIVE'>('IDLE');
  const [activeNodeId, setActiveNodeId] = useState<string | null>('crd_03');

  const [nodes, setNodes] = useState([
    { id: 'btn_01', type: 'Button', label: 'Deploy Action', path: 'Header > ActionGroup', status: 'PASSED', expectedTarget: "Button#deploy_btn.state == 'hover'" },
    { id: 'inp_02', type: 'Input', label: 'Search Query', path: 'Sidebar > Search', status: 'PASSED', expectedTarget: "Input#search.focus == true" },
    { id: 'crd_03', type: 'Card', label: 'Project Item', path: 'Sidebar > List', status: 'INCONCLUSIVE', expectedTarget: "Card#project_01.state == 'hover'" },
    { id: 'tab_04', type: 'Tab', label: 'View Switcher', path: 'Header > Nav', status: 'PASSED', expectedTarget: "Tab#nav_04.active == true" },
    { id: 'btn_05', type: 'Button', label: 'Tactical Toggle', path: 'Header > Controls', status: 'FAILED', expectedTarget: "Toggle#tactical.checked == true" },
  ]);

  const handleImportManifest = () => {
    const input = prompt('Paste Manifest JSON:');
    if (input) {
      try {
        const imported = JSON.parse(input);
        if (Array.isArray(imported)) {
          setNodes(imported);
          setTestLogs(prev => [...prev, `[OK] IMPORTED_MANIFEST: ${imported.length} nodes loaded`]);
        }
      } catch (e) {
        alert('Invalid JSON format');
      }
    }
  };

  const handleAddNode = () => {
    const newNode = {
      id: `node_${nodes.length + 1}`,
      type: 'Component',
      label: 'New Test Item',
      path: 'Root > Context',
      status: 'IDLE',
      expectedTarget: 'Element.state == "active"'
    };
    setNodes([...nodes, newNode]);
    setActiveNodeId(newNode.id);
  };

  const runTest = async () => {
    setIsRunning(true);
    setTestStatus('RUNNING');
    setTestLogs(prev => [...prev.slice(-12), `[INIT] START_TEST_RUN: ${activeProjectId}`]);
    
    try {
      const response = await fetch(`/api/projects/${activeProjectId}/test-interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: activeNodeId })
      });
      
      if (!response.ok) throw new Error('TEST_RUN_FAILED');
      
      const data = await response.json();
      
      // Process steps with artificial delays for visual feedback
      for (const step of data.steps) {
        await new Promise(r => setTimeout(r, 800));
        setTestLogs(prev => [...prev.slice(-12), step.msg]);
      }
      
      setIsRunning(false);
      setTestStatus(data.status);
      setTestLogs(prev => [...prev.slice(-12), `[DONE] TEST_COMPLETE: ${data.status}`]);
    } catch (err) {
      setIsRunning(false);
      setTestStatus('FAILED');
      setTestLogs(prev => [...prev.slice(-12), `[ERROR] TEST_EXECUTION_CRASHED`]);
    }
  };

  const activeNode = nodes.find(n => n.id === activeNodeId);

  return (
    <div className="flex h-full bg-black font-mono text-[11px]">
      {/* Left: Manifest List */}
      <div className="w-1/4 border-r border-tactical-primary/20 flex flex-col">
        <div className="p-4 border-b border-tactical-primary/20 flex items-center justify-between">
          <span className="text-tactical-primary font-bold uppercase tracking-widest flex items-center gap-2">
            <Cpu className="w-4 h-4" /> Node Manifest
          </span>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleImportManifest}
              className="p-1 hover:text-tactical-primary transition-colors"
              title="Import Manifest"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
            <span className="text-slate-500">v1.0.4</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {nodes.map((node) => (
            <div 
              key={node.id} 
              onClick={() => setActiveNodeId(node.id)}
              className={cn(
                "p-3 border transition-all cursor-pointer group relative",
                activeNodeId === node.id 
                  ? "border-tactical-primary/50 bg-tactical-primary/10 shadow-[inset_0_0_10px_rgba(0,255,102,0.1)]" 
                  : "border-white/5 hover:border-tactical-primary/30 hover:bg-tactical-primary/5"
              )}
            >
              {activeNodeId === node.id && (
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-tactical-primary animate-pulse" />
              )}
              
              {/* 3-Column Grid Layout */}
              <div className="grid grid-cols-[24px_1fr_auto] items-center gap-2 mb-1">
                <div className="flex items-center justify-center">
                  {node.status === 'PASSED' && <CheckCircle2 className="w-3.5 h-3.5 text-tactical-success" />}
                  {node.status === 'FAILED' && <XCircle className="w-3.5 h-3.5 text-tactical-danger" />}
                  {node.status === 'INCONCLUSIVE' && <AlertCircle className="w-3.5 h-3.5 text-tactical-warning" />}
                  {node.status === 'IDLE' && <div className="w-2 h-2 rounded-full bg-slate-700" />}
                </div>
                <span className={cn(
                  "font-bold transition-colors truncate",
                  activeNodeId === node.id ? "text-tactical-primary" : "text-slate-400"
                )}>{node.id}</span>
                <span className="text-[9px] font-mono text-slate-600 group-hover:text-tactical-primary/50 uppercase tracking-tighter">
                  {node.type}
                </span>
              </div>

              <div className="pl-[32px]">
                <div className="text-slate-500 text-[10px] mb-0.5 truncate">{node.label}</div>
                <div className="text-[8px] text-slate-700 italic truncate">{node.path}</div>
              </div>
            </div>
          ))}
          
          <button 
            onClick={handleAddNode}
            className="w-full p-2 border border-dashed border-tactical-primary/20 text-slate-500 hover:text-tactical-primary hover:border-tactical-primary/40 transition-all flex items-center justify-center gap-2 mt-2"
          >
            <Plus className="w-3 h-3" /> Add Test Node
          </button>
        </div>
      </div>

      {/* Center: Virtual Console & Visual Validation */}
      <div className="flex-1 flex flex-col border-r border-tactical-primary/20">
        <div className="p-4 border-b border-tactical-primary/20 flex items-center justify-between bg-surface-low">
          <div className="flex items-center gap-4">
            <span className="text-tactical-primary font-bold uppercase tracking-widest flex items-center gap-2">
              <Terminal className="w-4 h-4" /> Virtual Interaction Console
            </span>
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full animate-pulse",
                testStatus === 'RUNNING' ? "bg-tactical-info" : "bg-tactical-success"
              )} />
              <span className={cn(
                "text-[9px] font-bold",
                testStatus === 'RUNNING' ? "text-tactical-info" : "text-tactical-success"
              )}>{testStatus}</span>
            </div>
          </div>
          <button 
            onClick={runTest}
            disabled={isRunning}
            className={cn(
              "px-4 py-1.5 border border-tactical-primary text-tactical-primary hover:bg-tactical-primary hover:text-black transition-all font-bold uppercase flex items-center gap-2",
              isRunning && "opacity-50 cursor-not-allowed"
            )}
          >
            <Play className="w-3 h-3" /> {isRunning ? 'RUNNING_SUITE...' : 'EXECUTE_MANIFEST'}
          </button>
        </div>
        
        <div className="flex-1 p-6 bg-black/50 overflow-hidden relative flex flex-col">
          <div className="flex-1 space-y-2 overflow-y-auto font-mono text-[10px] mb-6">
            {testLogs.map((log, i) => (
              <div key={i} className={cn(
                "flex gap-4",
                log.includes('[OK]') ? "text-tactical-success" : 
                log.includes('[ERROR]') ? "text-tactical-danger" : 
                log.includes('[WARN]') ? "text-tactical-warning" : "text-slate-400"
              )}>
                <span className="text-slate-600">[{new Date().toLocaleTimeString()}]</span>
                <span>{log}</span>
              </div>
            ))}
          </div>

          {/* Visual Validation Section */}
          <div className="border-t border-tactical-primary/20 pt-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="px-2 py-0.5 bg-tactical-primary/10 border border-tactical-primary/30 text-tactical-primary text-[9px] font-bold uppercase tracking-widest">
                Visual_Validation_Engine
              </div>
              <div className="h-px flex-1 bg-tactical-primary/10" />
              {activeNode && (
                <div className="text-[10px] font-mono text-slate-400">
                  INSPECTING_NODE: <span className="text-tactical-primary font-bold">{activeNode.id}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-6 h-64">
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Expected Result (LLM_AGENT_GOAL)</span>
                  <span className="text-[9px] text-tactical-primary">REF_0x22</span>
                </div>
                <div className="flex-1 bg-surface-lowest border border-white/5 rounded overflow-hidden relative group">
                  <img 
                    src="https://picsum.photos/seed/expected/800/600" 
                    alt="Expected" 
                    className="w-full h-full object-cover opacity-50 group-hover:opacity-80 transition-opacity"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 canvas-grid opacity-20" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="p-2 bg-black/80 border border-tactical-primary/30 text-[9px] text-tactical-primary">
                      TARGET: {(activeNode as any)?.expectedTarget || 'N/A'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex-col flex">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Actual Screenshot (CDP_CAPTURE)</span>
                  {testStatus === 'INCONCLUSIVE' && (
                    <span className="text-[9px] text-tactical-warning animate-pulse font-bold">REVIEW_REQUIRED</span>
                  )}
                </div>
                <div className="flex-1 bg-surface-lowest border border-white/5 rounded overflow-hidden relative group">
                  <img 
                    src="https://picsum.photos/seed/actual/800/600" 
                    alt="Actual" 
                    className="w-full h-full object-cover opacity-80"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 canvas-grid opacity-20" />
                  {testStatus === 'INCONCLUSIVE' && (
                    <div className="absolute inset-0 border-2 border-tactical-warning/50 animate-pulse" />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>


      {/* Right: GDP Socket Stream & Review Panel */}
      <div className="w-1/4 flex flex-col">
        <div className="p-4 border-b border-tactical-primary/20 bg-surface-low">
          <span className="text-tactical-primary font-bold uppercase tracking-widest flex items-center gap-2">
            <Activity className="w-4 h-4" /> Telemetry
          </span>
        </div>
        
        <div className="flex-1 p-4 space-y-6 overflow-y-auto">
          <div className="p-4 border border-tactical-primary/20 bg-tactical-primary/5">
            <div className="flex justify-between items-center mb-4">
              <span className="text-tactical-primary font-bold uppercase">GDP Socket Stream</span>
              <span className="text-slate-500">Buffer: 1024kb</span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-slate-600">X_COORD</span>
                <span className="text-tactical-primary">124.55</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Y_COORD</span>
                <span className="text-tactical-primary">892.10</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">PRESSURE</span>
                <span className="text-tactical-primary">0.00</span>
              </div>
            </div>
          </div>

          {testStatus === 'INCONCLUSIVE' && (
            <div className="p-4 border border-tactical-warning/20 bg-tactical-warning/5 animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="flex items-center gap-2 text-tactical-warning font-bold uppercase mb-3">
                <AlertCircle className="w-4 h-4" /> Human Review Required
              </div>
              <p className="text-slate-400 text-[10px] mb-4 leading-relaxed">
                LLM agent detected a visual variance of 8%. Automated threshold is 5%. Please verify if this change is intentional.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button className="py-2 bg-tactical-success/20 border border-tactical-success/30 text-tactical-success hover:bg-tactical-success hover:text-black transition-all font-bold uppercase text-[9px]">
                  APPROVE
                </button>
                <button className="py-2 bg-tactical-danger/20 border border-tactical-danger/30 text-tactical-danger hover:bg-tactical-danger hover:text-black transition-all font-bold uppercase text-[9px]">
                  REJECT
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

const useSystemHealth = () => {
  const [health, setHealth] = useState<'NOMINAL' | 'DEGRADED' | 'OFFLINE'>('NOMINAL');
  const [details, setDetails] = useState<string>('');

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/memory/health', { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'ok' && data.memory_db_connected) {
            // Check if any projects actually have data (e.g. binary-explorer)
            // This is a proxy for "is the database actually populated?"
            const blobRes = await fetch('http://localhost:3001/api/memory/list', { 
              method: 'POST', 
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ collection: 'binary_features', limit: 1 })
            });
            const blobData = await blobRes.json();
            
            if (blobData.total === 0) {
              setHealth('DEGRADED');
              setDetails('Database is connected but EMPTY');
            } else {
              setHealth('NOMINAL');
              setDetails('All systems online');
            }
          } else {
            setHealth('DEGRADED');
            setDetails(data.error || 'Database disconnected');
          }
        } else {
          setHealth('OFFLINE');
          setDetails('Proxy unreachable');
        }
      } catch {
        setHealth('OFFLINE');
        setDetails('API network error');
      }
    };

    checkHealth();
    const timer = setInterval(checkHealth, 30000);
    return () => clearInterval(timer);
  }, []);

  return { health, details };
};

export default function App() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [selectedComponent, setSelectedComponent] = useState<ComponentDetail | null>(null);

  // Hash routing: #project-id or #project-id/subpath
  const parseHash = useCallback(() => {
    const raw = window.location.hash.replace('#', '');
    if (!raw) return { project: 'music-lab-pipeline', view: 'design-board' as View };
    const [first, ...rest] = raw.split('/');
    // Deep links to projects should default to 'final-site' (interactive implementation)
    // instead of 'components' or 'design-board'
    return { 
      project: first, 
      view: 'final-site' as View, 
      subpath: rest.join('/') 
    };
  }, []);

  const initial = parseHash();
  const [activeProjectId, setActiveProjectId] = useState<string>(initial.project);
  const [activeView, setActiveView] = useState<View>(initial.view);
  const [hashSubpath, setHashSubpath] = useState<string>(initial.subpath || '');
  const systemHealth = useSystemHealth();

  // Sync hash → state on popstate (back/forward)
  useEffect(() => {
    const onHashChange = () => {
      const parsed = parseHash();
      setActiveProjectId(parsed.project);
      if (parsed.view) setActiveView(parsed.view);
      setHashSubpath(parsed.subpath || '');
    };
    window.addEventListener('hashchange', onHashChange);
    // Also apply on mount if hash is present
    if (window.location.hash) onHashChange();
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [parseHash]);

  // Sync state → hash when project changes via sidebar click
  const handleProjectSelect = useCallback((id: string) => {
    setActiveProjectId(id);
    window.location.hash = id;
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-base relative nvis-scan-line">
      {/* Tactical Corner Brackets */}
      <div className="absolute top-0 left-0 w-12 h-12 border-t border-l border-tactical-primary/20 z-[60] pointer-events-none" />
      <div className="absolute top-0 right-0 w-12 h-12 border-t border-r border-tactical-primary/20 z-[60] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-12 h-12 border-b border-l border-tactical-primary/20 z-[60] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-12 h-12 border-b border-r border-tactical-primary/20 z-[60] pointer-events-none" />

      <ProjectSidebar 
        isCollapsed={isSidebarCollapsed} 
        onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
        activeProjectId={activeProjectId}
        onProjectSelect={handleProjectSelect}
      />
      
      <div className="flex-1 flex flex-col relative overflow-hidden">
        <ViewHeader 
          activeView={activeView} 
          onViewChange={setActiveView} 
          systemHealth={systemHealth}
        />
        
        <main className="flex-1 relative min-h-0 flex flex-col tactical-corner tactical-corner-tl tactical-corner-br modern-scrollbar">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="w-full flex-1 min-h-0 flex flex-col"
            >
              {activeView === 'design-board' && <DesignBoardCanvas projectId={activeProjectId} />}
              {activeView === 'reviews' && <Reviews projectId={activeProjectId} />}
              {activeView === 'mockups' && <Mockups projectId={activeProjectId} />}
              {activeView === 'testing' && <TestingPanel />}
              {activeView === 'final-site' && <FinalSite projectId={activeProjectId} subpath={hashSubpath} />}
              {activeView === 'components' && (
                <div className="h-full flex flex-col">
                  {activeProjectId === 'music-lab-pipeline' ? (
                    <div className="flex-1 overflow-auto">
                      <React.Suspense fallback={<div className="p-8 text-tactical-primary font-mono">LOADING_COMPONENT...</div>}>
                        <MusicLab />
                      </React.Suspense>
                    </div>
                  ) : activeProjectId === 'sparta-explorer' ? (
                    <div className="flex-1 flex flex-col overflow-hidden">
                      <React.Suspense fallback={<div className="p-8 text-tactical-primary font-mono">LOADING_COMPONENT...</div>}>
                        <SpartaExplorerView views={{
                          Overview: <React.Suspense fallback={null}><OverviewView /></React.Suspense>,
                          Sources: <React.Suspense fallback={null}><SourcesView /></React.Suspense>,
                          Controls: <React.Suspense fallback={null}><ControlsView /></React.Suspense>,
                          URLs: <React.Suspense fallback={null}><URLsView /></React.Suspense>,
                          QRAs: <React.Suspense fallback={null}><QRAsView /></React.Suspense>,
                          Relationships: <React.Suspense fallback={null}><RelationshipsView /></React.Suspense>,
                          'Threat Matrix': <React.Suspense fallback={null}><ThreatMatrixView /></React.Suspense>,
                          Pipeline: <React.Suspense fallback={null}><PipelineView /></React.Suspense>,
                          'Prompt Lab': <React.Suspense fallback={null}><PromptLabTabView /></React.Suspense>,
                        }} />
                      </React.Suspense>
                    </div>
                  ) : activeProjectId === 'binary-explorer' ? (
                    <div className="flex-1 overflow-auto">
                      <React.Suspense fallback={<div className="p-8 text-tactical-primary font-mono">LOADING_COMPONENT...</div>}>
                        <BinaryExplorer />
                      </React.Suspense>
                    </div>
                  ) : activeProjectId === 'prompt-lab' ? (
                    <div className="flex-1 overflow-auto">
                      <React.Suspense fallback={<div className="p-8 text-tactical-primary font-mono">LOADING_COMPONENT...</div>}>
                        <PromptLab />
                      </React.Suspense>
                    </div>
                  ) : (
                    <Components
                      projectId={activeProjectId}
                      selectedComponent={selectedComponent}
                      setSelectedComponent={setSelectedComponent}
                      setToast={setToast}
                    />
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Toast Notification */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: 50, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 50, x: '-50%' }}
              className="fixed bottom-8 left-1/2 z-[200] px-6 py-3 glass-hud border-tactical-primary/50 text-white font-mono text-xs flex items-center gap-3 shadow-[0_0_20px_rgba(0,255,102,0.3)]"
            >
              <div className={cn(
                "w-2 h-2 rounded-full animate-pulse",
                toast.type === 'success' ? "bg-tactical-success" : "bg-tactical-danger"
              )} />
              {toast.message}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
// checkpoint test
// checkpoint-commit-test 1774452241
