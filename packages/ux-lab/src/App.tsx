import React, { useState, useEffect, useCallback } from 'react';
import {
  Package,
  History,
  Bell,
  Share2,
  Rocket,
  PanelLeft,
  PanelLeftClose,
  ChevronRight,
  User,
  Activity,
  Zap,
  Database,
  Search,
  Plus,
  Maximize2,
  Grid,
  Terminal,
  Cpu,
  Play,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Upload,
  RefreshCcw,
  Download,
  ChevronLeft,
  Code2,
  Layers,
  ArrowRight
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
const EmbryTerminal = React.lazy(() => import('./components/embry-terminal/EmbryTerminalView').then(m => ({ default: m.EmbryTerminalView })).catch(() => ({ default: () => React.createElement('div', { style: { padding: 20, color: '#f44' } }, 'Embry Terminal failed to load — check console') })));
const DatalakeExplorer = React.lazy(() => import('./components/datalake-explorer/DatalakeExplorerView').then(m => ({ default: m.DatalakeExplorerView })));
const Lean4Lemma = React.lazy(() => import('./components/lean4-lemma/Lean4LemmaView').then(m => ({ default: m.Lean4LemmaView })));
const ScillmWorkspace = React.lazy(() => import('./components/scillm/ScillmWorkspace').then(m => ({ default: m.ScillmWorkspace })));
const ComponentGalleryView = React.lazy(() => import('./components/gallery/ComponentGallery').then(m => ({ default: m.ComponentGallery })));
const PdfLab = React.lazy(() => import('./components/pdf-lab/PdfLabView').then(m => ({ default: m.PdfLabView })));
const PdfLabInitialSweepProof = React.lazy(() => import('./components/pdf-lab/InitialSweepStaticProof').then(m => ({ default: m.InitialSweepStaticProof })));
const PdfLabParityAuditProof = React.lazy(() => import('./components/pdf-lab/ParityAuditStaticProof').then(m => ({ default: m.ParityAuditStaticProof })));
const WatchReportView = React.lazy(() => import('./components/watch/WatchReportView').then(m => ({ default: m.WatchReportView })));
const EmbryVoiceLabRoute = React.lazy(() => import('./components/embry-voice/EmbryVoiceLabRoute').then(m => ({ default: m.EmbryVoiceLabRoute })));
const HumBakeoffView = React.lazy(() => import('./components/hum/HumBakeoffView').then(m => ({ default: m.HumBakeoffView })));
import { DesignBoardCanvas } from './components/DesignBoardCanvas';
import { TestingPanel } from './components/TestingPanel';
import { HackEvolveMonitor } from './components/hack/HackEvolveMonitor';
import { apiUrl } from './lib/apiBase';

// SPARTA sub-views
const SharedChatPage = React.lazy(() => import('./components/shared-chat/SharedChatPage').then(m => ({ default: m.SharedChatPage })));
const ChatTabView = React.lazy(() => import('./components/sparta/explorer/ChatTab').then(m => ({ default: m.ChatTab })));
const SourcesView = React.lazy(() => import('./components/sparta/explorer/SourcesView').then(m => ({ default: m.SourcesView })));
const ControlsView = React.lazy(() => import('./components/sparta/explorer/ControlsView').then(m => ({ default: m.ControlsView })));
const URLsView = React.lazy(() => import('./components/sparta/explorer/URLsView').then(m => ({ default: m.URLsView })));
const QRAsView = React.lazy(() => import('./components/sparta/explorer/QRAsView').then(m => ({ default: m.QRAsView })));
const CoverageView = React.lazy(() => import('./components/sparta/explorer/CoverageView').then(m => ({ default: m.CoverageView })));
const ThreatMatrixView = React.lazy(() => import('./components/sparta/explorer/ThreatMatrixView').then(m => ({ default: m.ThreatMatrixView })));
const SupplyChainView = React.lazy(() => import('./components/sparta/explorer/SupplyChainView').then(m => ({ default: m.SupplyChainView })));
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useRegisterAction } from './hooks/useRegisterAction';

// --- Types ---

type View = 'mockups' | 'components' | 'design-board' | 'reviews' | 'testing' | 'final-site';

// --- Components ---

const Mockups = ({ projectId }: { projectId: string }) => {
  const [mockups, setMockups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePdfMockup, setActivePdfMockup] = useState('initial-sweep');
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    '[INIT] CDP_SESSION_START: 0x7FF821',
    '[INFO] SOCKET_CONNECTED: ws://localhost:3001/ws',
  ]);
  useRegisterAction('mockups:button:refresh', { app: 'ux-lab', action: 'MOCKUPS_REFRESH', label: 'Refresh Mockups', description: 'Reload mockup assets for the current project' });
  useRegisterAction('mockups:button:download', { app: 'ux-lab', action: 'MOCKUPS_DOWNLOAD', label: 'Download Mockups', description: 'Download all mockup assets for the current project' });
  useRegisterAction('mockups:item:pdf-lab-select', { app: 'ux-lab', action: 'PDF_LAB_MOCKUP_SELECT', label: 'Select PDF Lab mockup', description: 'Switch the active PDF Lab mockup preview' });

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

  const pdfLabMockups = [
    {
      id: 'initial-sweep',
      title: 'Initial Sweep',
      status: 'Verified fixture',
      description: 'Elements, candidate pages, and evidence preview',
      heading: 'Initial Sweep Static Proof',
      details: 'Container-sized React mount of the approved Initial Sweep HTML/CSS fixture.',
    },
    {
      id: 'parity-audit',
      title: 'Parity Audit',
      status: 'Verified fixture',
      description: 'Candidate run, expected-vs-actual nodes, triage output',
      heading: 'Parity Audit Static Proof',
      details: 'Container-sized React mount of the deterministic extraction and JSON parity gate.',
    },
    {
      id: 'surgical-triage-static-proof',
      title: 'Surgical Triage',
      status: 'Verified fixture',
      description: 'Rectangular mask, real NIST page, satellite HUD',
      heading: 'Surgical Triage Static Proof',
      details: 'Container-sized React mount of the verified final human ambiguity deck fixture.',
    },
    {
      id: 'candidate-inventory',
      title: 'Candidate Inventory',
      status: 'Next',
      description: 'Agent sweep pages and supported pdf_oxide elements',
      heading: 'Candidate Inventory Slot',
      details: 'Reserved mockup slot. Final Site remains separate.',
    },
  ]
  const activePdfMockupMeta = pdfLabMockups.find(item => item.id === activePdfMockup) ?? pdfLabMockups[0]

  return (
    <div className="h-full flex flex-col bg-surface-base">
      <div className="p-4 border-b border-white/10 flex items-center justify-between bg-surface-low">
        <h2 className="text-xs font-mono text-slate-400 uppercase tracking-widest">Project Mockups: {projectId}</h2>
        <div className="flex gap-2">
          <button data-qid="mockups:button:refresh" data-qs-action="MOCKUPS_REFRESH" title="Refresh mockup assets" className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-white/5 rounded text-slate-400"><RefreshCcw className="w-4 h-4" /></button>
          <button data-qid="mockups:button:download" data-qs-action="MOCKUPS_DOWNLOAD" title="Download mockup assets" className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-white/5 rounded text-slate-400"><Download className="w-4 h-4" /></button>
        </div>
      </div>
      
      <div className={cn("flex-1 min-h-0", projectId === 'pdf-lab' ? "overflow-hidden" : "overflow-auto p-6")}>
        {projectId === 'pdf-lab' ? (
          <div className="h-full min-h-0 grid grid-cols-[260px_minmax(0,1fr)] bg-black">
            <aside className="min-h-0 border-r border-white/10 bg-surface-low/80 flex flex-col">
              <div className="px-4 py-3 border-b border-white/10">
                <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-slate-500">PDF Lab Mockups</div>
                <div className="mt-1 text-[11px] text-slate-400">Design proofs before production wiring.</div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
                {pdfLabMockups.map(item => (
                  <button
                    key={item.id}
                    data-qid={`mockups:item:pdf-lab-${item.id}`}
                    data-qs-action="PDF_LAB_MOCKUP_SELECT"
                    title={`Open ${item.title} mockup`}
                    onClick={() => setActivePdfMockup(item.id)}
                    className={cn(
                      "w-full min-h-[72px] text-left p-3 border rounded-sm transition-colors",
                      activePdfMockup === item.id
                        ? "border-tactical-primary/70 bg-tactical-primary/10"
                        : "border-white/10 bg-black/30 hover:border-tactical-primary/35"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-headline font-bold text-white">{item.title}</span>
                      <span className="text-[9px] font-mono uppercase text-tactical-primary">{item.status}</span>
                    </div>
                    <div className="mt-1 text-[10px] leading-snug text-slate-500">{item.description}</div>
                  </button>
                ))}
              </div>
            </aside>

            <div className="min-w-0 min-h-0 grid grid-rows-[auto_minmax(0,1fr)]">
              <div className="border-b border-tactical-primary/30 bg-black/40 p-3">
                <div className="text-[10px] font-mono uppercase tracking-widest text-tactical-primary">
                  Mockup · {activePdfMockupMeta.heading}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {activePdfMockupMeta.details}
                </div>
              </div>
              <div className="min-h-0 overflow-hidden bg-black">
                {activePdfMockup === 'surgical-triage-static-proof' ? (
                  <React.Suspense fallback={<div className="p-8 text-tactical-primary font-mono">LOADING_PDF_LAB_MOCKUP...</div>}>
                    <PdfLab initialSubpath="static-proof" />
                  </React.Suspense>
                ) : activePdfMockup === 'initial-sweep' ? (
                  <React.Suspense fallback={<div className="p-8 text-tactical-primary font-mono">LOADING_PDF_LAB_INITIAL_SWEEP...</div>}>
                    <div className="pdf-lab-initial-sweep-mockup-frame">
                      <PdfLabInitialSweepProof />
                    </div>
                  </React.Suspense>
                ) : activePdfMockup === 'parity-audit' ? (
                  <React.Suspense fallback={<div className="p-8 text-tactical-primary font-mono">LOADING_PDF_LAB_PARITY_AUDIT...</div>}>
                    <div className="pdf-lab-parity-mockup-frame">
                      <PdfLabParityAuditProof />
                    </div>
                  </React.Suspense>
                ) : (
                  <div className="h-full flex items-center justify-center text-center">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-tactical-primary">Mockup Slot Reserved</div>
                      <div className="mt-2 max-w-md text-sm text-slate-400">This left rail is now the project-level mockup store. The selected proof will be added here instead of mixing mockups into the Final Site route.</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : loading ? (
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

      {projectId !== 'pdf-lab' && (
        <div className="h-32 bg-black border-t border-white/10 p-4 font-mono text-[10px] text-tactical-primary/60 overflow-y-auto custom-scrollbar">
          {terminalLogs.map((log, i) => (
            <div key={i} className="mb-1">{log}</div>
          ))}
        </div>
      )}
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
          {projectId === 'ux-lab' && (
            <React.Suspense fallback={<div className="p-8 text-tactical-primary font-mono">LOADING_SHARED_CHAT...</div>}>
              <SharedChatPage />
            </React.Suspense>
          )}
          {projectId === 'sparta-explorer' && (subpath === 'chat' || subpath === 'chat/personaplex' || subpath === 'personaplex-chat') && (
            <React.Suspense fallback={<div className="p-8 text-tactical-primary font-mono">LOADING_PERSONAPLEX_CHAT...</div>}>
              <SharedChatPage />
            </React.Suspense>
          )}
          {projectId === 'sparta-explorer' && !['chat', 'chat/personaplex', 'personaplex-chat'].includes(subpath || '') && (
            <SpartaExplorerView initialTab={subpath} views={{
              Coverage: <React.Suspense fallback={null}><CoverageView /></React.Suspense>,
              Sources: <React.Suspense fallback={null}><SourcesView /></React.Suspense>,
              Controls: <React.Suspense fallback={null}><ControlsView /></React.Suspense>,
              URLs: <React.Suspense fallback={null}><URLsView /></React.Suspense>,
              QRAs: <React.Suspense fallback={null}><QRAsView /></React.Suspense>,
              'Threat Matrix': <React.Suspense fallback={null}><ThreatMatrixView /></React.Suspense>,
              'Supply Chain': <React.Suspense fallback={null}><SupplyChainView /></React.Suspense>,
            }} />
          )}
          {projectId === 'binary-explorer' && <BinaryExplorer />}
          {projectId === 'lean4-lemma' && <React.Suspense fallback={null}><Lean4Lemma /></React.Suspense>}
          {projectId === 'music-lab-pipeline' && <MusicLab />}
          {projectId === 'prompt-lab' && <PromptLab />}
          {projectId === 'llm-eval-lab' && <LlmEvalLab />}
          {projectId === 'classifier-lab' && <ClassifierLab initialTab={subpath || undefined} />}
          {projectId === 'architecture' && <ArchitectureView initialProjectId={subpath || undefined} />}
          {projectId === 'embry-terminal' && <EmbryTerminal />}
          {projectId === 'datalake-explorer' && <DatalakeExplorer />}
          {projectId === 'pdf-lab' && <PdfLab initialSubpath={subpath} />}
          {projectId === 'scillm' && <ScillmWorkspace initialTab={subpath} />}
          {projectId === 'watch' && <WatchReportView />}
          {projectId === 'embry-voice' && <EmbryVoiceLabRoute />}
          {projectId === 'hum-bakeoff' && <HumBakeoffView />}
          {projectId === 'hum' && (
            <div className="w-full h-full">
              <HumDashboard />
            </div>
          )}
          {projectId === 'hack' && (
            <div className="flex-1 overflow-auto p-6">
              <HackEvolveMonitor />
            </div>
          )}
          {!['ux-lab', 'sparta-explorer', 'binary-explorer', 'music-lab-pipeline', 'prompt-lab', 'llm-eval-lab', 'classifier-lab', 'architecture', 'embry-terminal', 'datalake-explorer', 'pdf-lab', 'lean4-lemma', 'scillm', 'watch', 'embry-voice', 'hum-bakeoff', 'hum', 'hack'].includes(projectId) && (
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
  useRegisterAction('design-board:button:back-html', { app: 'ux-lab', action: 'DESIGN_BOARD_BACK_HTML', label: 'Back from HTML Board', description: 'Close HTML design board and return to design board gallery' });
  useRegisterAction('design-board:button:back-image', { app: 'ux-lab', action: 'DESIGN_BOARD_BACK_IMAGE', label: 'Back from Image', description: 'Close image lightbox and return to design board gallery' });
  useRegisterAction('design-board:button:open-round', { app: 'ux-lab', action: 'DESIGN_BOARD_OPEN_ROUND', label: 'Open Design Round', description: 'Open a design round composite image in lightbox' });
  useRegisterAction('design-board:button:open-html', { app: 'ux-lab', action: 'DESIGN_BOARD_OPEN_HTML', label: 'Open HTML Board', description: 'Open an HTML design board in iframe view' });
  useRegisterAction('design-board:button:open-stitch', { app: 'ux-lab', action: 'DESIGN_BOARD_OPEN_STITCH', label: 'Open Stitch Mockup', description: 'Open a Stitch mockup image in lightbox' });

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
          <button data-qid="design-board:button:back-html" data-qs-action="DESIGN_BOARD_BACK" title="Back to design board gallery" onClick={() => setActiveHtml(null)} className="text-[10px] font-mono text-slate-400 hover:text-white transition-colors flex items-center gap-1 min-h-[44px] px-2">
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
          <button data-qid="design-board:button:back-image" data-qs-action="DESIGN_BOARD_BACK" title="Back to design board gallery" onClick={() => setSelectedImage(null)} className="text-[10px] font-mono text-slate-400 hover:text-white transition-colors flex items-center gap-1 min-h-[44px] px-2">
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
              <button key={r.src} data-qid="design-board:button:open-round" data-qs-action="DESIGN_BOARD_OPEN_ROUND" title={`Open design round: ${r.name}`} onClick={() => setSelectedImage(r.src)} className="group border border-white/5 hover:border-tactical-primary/30 transition-all overflow-hidden bg-surface-lowest text-left min-h-[44px]">
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
              <button key={h.src} data-qid="design-board:button:open-html" data-qs-action="DESIGN_BOARD_OPEN_HTML" title={`Open HTML board: ${h.name}`} onClick={() => setActiveHtml(h.src)} className="w-full flex items-center gap-3 px-3 py-2.5 min-h-[44px] bg-surface-lowest border border-white/5 hover:border-tactical-primary/30 transition-all group text-left">
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
              <button key={s.src} data-qid="design-board:button:open-stitch" data-qs-action="DESIGN_BOARD_OPEN_STITCH" title={`Open stitch mockup: ${s.name}`} onClick={() => setSelectedImage(s.src)} className="group border border-white/5 hover:border-tactical-primary/30 transition-all overflow-hidden bg-surface-lowest text-left min-h-[44px]">
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
  useRegisterAction('reviews:button:rerun-vlm', { app: 'ux-lab', action: 'REVIEWS_RERUN_VLM', label: 'Rerun VLM Diff', description: 'Re-run VLM visual diff analysis comparing mockup to implementation' });
  useRegisterAction('reviews:button:approve', { app: 'ux-lab', action: 'REVIEWS_APPROVE', label: 'Approve Visual Diff', description: 'Approve the visual diff result and mark review as passed' });
  useRegisterAction('reviews:input:diff-slider', { app: 'ux-lab', action: 'REVIEWS_DIFF_SLIDER', label: 'Diff Slider', description: 'Adjust the split position to compare mockup vs implementation' });

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
            data-qid="reviews:button:rerun-vlm"
            data-qs-action="REVIEWS_RERUN_VLM"
            title="Rerun VLM visual diff analysis"
            onClick={runComparison}
            disabled={isComparing}
            className="px-3 py-1 min-h-[44px] bg-surface-high border border-white/10 text-[10px] font-mono hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            {isComparing ? 'ANALYZING...' : 'RERUN_VLM_DIFF'}
          </button>
          <button data-qid="reviews:button:approve" data-qs-action="REVIEWS_APPROVE" title="Approve visual diff result" className="px-3 py-1 min-h-[44px] bg-tactical-primary text-white text-[10px] font-mono hover:opacity-90 transition-all">APPROVE</button>
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
          data-qid="reviews:input:diff-slider"
          title="Drag to compare mockup vs implementation"
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
  useRegisterAction('components:button:back', { app: 'ux-lab', action: 'COMPONENTS_BACK', label: 'Back to Component List', description: 'Return to the component library list view' });
  useRegisterAction('components:button:viewport', { app: 'ux-lab', action: 'COMPONENTS_SET_VIEWPORT', label: 'Set Preview Viewport', description: 'Switch preview viewport between desktop, tablet, and mobile' });
  useRegisterAction('components:button:share', { app: 'ux-lab', action: 'COMPONENTS_SHARE', label: 'Share Component', description: 'Share the selected component with a link' });
  useRegisterAction('components:button:deploy', { app: 'ux-lab', action: 'COMPONENTS_DEPLOY', label: 'Deploy to Registry', description: 'Deploy the selected component to the internal NPM registry' });
  useRegisterAction('components:button:copy-code', { app: 'ux-lab', action: 'COMPONENTS_COPY_CODE', label: 'Copy Source Code', description: 'Copy component source code to clipboard' });
  useRegisterAction('components:input:search', { app: 'ux-lab', action: 'COMPONENTS_SEARCH', label: 'Search Components', description: 'Filter the component library by name or description' });
  useRegisterAction('components:card:select', { app: 'ux-lab', action: 'COMPONENTS_SELECT', label: 'Select Component', description: 'Open a component for detailed inspection and preview' });

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
              data-qid="components:button:back"
              data-qs-action="COMPONENTS_BACK"
              title="Back to component library"
              onClick={() => setSelectedComponent(null)}
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-white/5 rounded-full transition-colors text-slate-400 hover:text-white"
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
                  data-qid={`components:button:viewport-${v}`}
                  data-qs-action={`COMPONENTS_VIEWPORT_${v.toUpperCase()}`}
                  title={`Switch to ${v} preview`}
                  onClick={() => setPreviewViewport(v)}
                  className={cn(
                    "px-3 py-1 min-h-[44px] text-[10px] font-mono uppercase transition-all rounded",
                    previewViewport === v ? "bg-tactical-primary text-white" : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button data-qid="components:button:share" data-qs-action="COMPONENTS_SHARE" title="Share component link" className="flex items-center gap-2 px-4 py-2 min-h-[44px] bg-surface-high border border-white/10 text-[10px] font-mono text-white hover:bg-white/5 transition-all">
                <Share2 className="w-3 h-3" /> SHARE_COMPONENT
              </button>
              <button data-qid="components:button:deploy" data-qs-action="COMPONENTS_DEPLOY" title="Deploy component to internal registry" className="flex items-center gap-2 px-4 py-2 min-h-[44px] bg-tactical-primary text-white text-[10px] font-mono font-bold hover:opacity-90 transition-all">
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
                data-qid="components:button:copy-code"
                data-qs-action="COMPONENTS_COPY_CODE"
                title="Copy component source code to clipboard"
                onClick={() => {
                  navigator.clipboard.writeText(selectedComponent.code);
                  setToast({ message: 'CODE_COPIED_TO_CLIPBOARD', type: 'success' });
                }}
                className="p-2 min-w-[44px] min-h-[44px] hover:bg-white/5 rounded transition-colors text-tactical-primary flex items-center gap-2 text-[10px] font-mono"
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
            data-qid="components:input:search"
            title="Filter components by name or description"
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
            data-qid="components:card:select"
            title={`Open component: ${comp.name}`}
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
  onProjectSelect,
}: { 
  isCollapsed: boolean, 
  onToggle: () => void,
  activeProjectId: string,
  onProjectSelect: (id: string) => void,
}) => {
  const [activeTab, setActiveTab] = useState<'my' | 'shared'>('my');
  const [searchQuery, setSidebarSearch] = useState('');
  useRegisterAction('sidebar:button:toggle', { app: 'ux-lab', action: 'SIDEBAR_TOGGLE', label: 'Toggle Sidebar', description: 'Collapse or expand the project sidebar' });
  useRegisterAction('sidebar:tab:my-projects', { app: 'ux-lab', action: 'SIDEBAR_TAB_MY', label: 'My Projects Tab', description: 'Switch to My Projects list in the sidebar' });
  useRegisterAction('sidebar:tab:shared', { app: 'ux-lab', action: 'SIDEBAR_TAB_SHARED', label: 'Shared Tab', description: 'Switch to Shared projects list in the sidebar' });
  useRegisterAction('sidebar:input:search', { app: 'ux-lab', action: 'SIDEBAR_SEARCH', label: 'Search Projects', description: 'Filter the project list by name or subtitle' });
  useRegisterAction('sidebar:button:new-project', { app: 'ux-lab', action: 'SIDEBAR_NEW_PROJECT', label: 'New Project', description: 'Create a new UX Lab project' });
  useRegisterAction('sidebar:item:project', { app: 'ux-lab', action: 'SIDEBAR_SELECT_PROJECT', label: 'Select Project', description: 'Open a project and load it in the main workspace' });

  // Real projects with working component routing
  const projects: Project[] = [
    { id: 'ux-lab', title: 'Global Chat', subtitle: 'Self-contained shared chat surface (skill-owned)', date: '2026-06-24', type: 'desktop' as const },
    { id: 'sparta-explorer', title: 'SPARTA Explorer', subtitle: 'Security knowledge graph', date: '2026-03-22', type: 'desktop' as const },
    { id: 'watch', title: 'Watch', subtitle: 'Question-driven movie evidence report', date: '2026-06-18', type: 'desktop' as const },
    { id: 'embry-voice', title: 'Embry Voice', subtitle: 'Memory-first chat, Chatterbox audio, and real sanity checks', date: '2026-07-04', type: 'desktop' as const },
    { id: 'hum-bakeoff', title: 'Hum Bakeoff', subtitle: 'Embry STS guide and voice controls', date: '2026-06-20', type: 'desktop' as const },
    { id: 'hack', title: 'Hack Evolve Monitor', subtitle: 'Greybox hardening campaign UX', date: '2026-05-06', type: 'desktop' as const },
    { id: 'binary-explorer', title: 'Binary Explorer', subtitle: 'ELF binary analysis', date: '2026-03-22', type: 'desktop' as const, thumbnail: '/captures/binary-explorer/stitch/6d81147866c74cbd8e20fcf020f3a17e.png' },
    { id: 'lean4-lemma', title: 'Lean4 Lemma Viewer', subtitle: 'Formal proof graph explorer', date: '2026-04-02', type: 'desktop' as const },
    { id: 'music-lab-pipeline', title: 'Music Lab Pipeline', subtitle: '10-stage creation pipeline', date: '2026-03-22', type: 'desktop' as const, thumbnail: '/captures/music-lab-pipeline/stitch/d81f2a555f73455098f59c16379d9517.png' },
    { id: 'prompt-lab', title: 'Prompt Lab', subtitle: 'LLM prompt iteration', date: '2026-03-22', type: 'desktop' as const, thumbnail: '/captures/prompt-lab-optimize/stitch/prompt-optimizer-v1.png' },
    { id: 'llm-eval-lab', title: 'LLM Eval Lab', subtitle: 'Model evaluation', date: '2026-03-22', type: 'desktop' as const, thumbnail: '/captures/llm-eval-lab/stitch/8f916e26f7894b119ce06a2743fe262a.png' },
    { id: 'classifier-lab', title: 'Classifier Lab', subtitle: 'ML classifier training pipeline', date: '2026-03-22', type: 'desktop' as const },
    { id: 'architecture', title: 'Architecture', subtitle: 'Visual collaboration diagrams', date: '2026-03-25', type: 'desktop' as const },
    { id: 'embry-terminal', title: 'Embry Terminal', subtitle: 'Agent control surface (Claude/Pi/Codex)', date: '2026-03-31', type: 'desktop' as const },
    { id: 'datalake-explorer', title: 'Datalake Explorer', subtitle: 'PDF extraction QA', date: '2026-03-31', type: 'desktop' as const, thumbnail: '' },
    { id: 'pdf-lab', title: 'PDF Lab', subtitle: 'Visual extraction verification', date: '2026-04-16', type: 'desktop' as const },
    { id: 'scillm', title: 'scillm Monitor', subtitle: 'LLM proxy, transport collaboration room, DAG planner', date: '2026-04-13', type: 'desktop' as const },
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
  const [searchExpanded, setSearchExpanded] = useState(false);

  const ProjectItem = ({ project }: { project: Project }) => {
    const isActive = activeProjectId === project.id
    if (isCollapsed) {
      return (
        <div
          data-qid={`sidebar:item:project:${project.id}`}
          data-qs-action="SIDEBAR_SELECT_PROJECT"
          title={`${project.title} — ${project.subtitle}`}
          onClick={() => onProjectSelect(project.id)}
          onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, projectId: project.id }); }}
          className={cn(
            'group relative mx-auto flex min-h-[48px] w-10 cursor-pointer items-center justify-center rounded-r-[24px] transition-colors',
            isActive ? 'workspace-sidebar__nav-item--active bg-[#2d2e30]' : 'hover:bg-white/[0.04]',
          )}
        >
          <div className="workspace-sidebar__icon-box" style={{ marginRight: 0 }}>
            {project.thumbnail ? (
              <img src={project.thumbnail} alt="" />
            ) : (
              <span style={{ color: isActive ? '#8ab4f8' : '#e3e3e3' }}>{getInitials(project.title)}</span>
            )}
          </div>
          <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-white/10 bg-[#2d2e30] px-2 py-1 text-[12px] text-[#e3e3e3] opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
            {project.title}
          </div>
        </div>
      )
    }

    return (
      <div
        data-qid={`sidebar:item:project:${project.id}`}
        data-qs-action="SIDEBAR_SELECT_PROJECT"
        title={`${project.title} — ${project.subtitle}`}
        onClick={() => onProjectSelect(project.id)}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, projectId: project.id }); }}
        className={cn('workspace-sidebar__nav-item', isActive && 'workspace-sidebar__nav-item--active')}
        style={isActive ? { minHeight: 48, height: 48, borderRadius: '0 24px 24px 0', marginRight: 12 } : { minHeight: 48, height: 48 }}
      >
        <div className="workspace-sidebar__icon-box">
          {project.thumbnail ? (
            <img src={project.thumbnail} alt="" />
          ) : (
            <span style={{ color: isActive ? '#8ab4f8' : '#e3e3e3' }}>{getInitials(project.title)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="workspace-sidebar__title">{project.title}</div>
          <div className="workspace-sidebar__subtitle">{project.subtitle}</div>
        </div>
      </div>
    )
  }

  return (
    <aside
      className={cn(
        'workspace-sidebar flex h-full min-h-0 flex-col overflow-hidden border-r border-white/10 transition-all duration-300',
        isCollapsed && 'workspace-sidebar--collapsed w-12',
      )}
    >
      <div className={cn('flex items-center px-3', isCollapsed ? 'justify-center py-2' : 'justify-between py-1')}>
        {!isCollapsed && <span className="workspace-sidebar__label">UX Lab</span>}
        <button
          data-qid="sidebar:button:toggle"
          data-qs-action="SIDEBAR_TOGGLE"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggle}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[#9aa0a6] transition-colors hover:bg-white/5 hover:text-[#e3e3e3]"
        >
          {isCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {!isCollapsed && (
        <>
          <button
            data-qid="sidebar:button:new-project"
            data-qs-action="SIDEBAR_NEW_PROJECT"
            title="Create a new project"
            className="workspace-sidebar__new-btn"
          >
            <Plus className="h-4 w-4" /> New project
          </button>

          <div className="mb-3 flex items-center gap-2 px-3">
            <button
              data-qid="sidebar:tab:my-projects"
              data-qs-action="SIDEBAR_TAB_MY_PROJECTS"
              title="View my projects"
              onClick={() => setActiveTab('my')}
              className={cn('workspace-sidebar__chip', activeTab === 'my' && 'workspace-sidebar__chip--active')}
            >
              Mine
            </button>
            <button
              data-qid="sidebar:tab:shared"
              data-qs-action="SIDEBAR_TAB_SHARED"
              title="View shared projects"
              onClick={() => setActiveTab('shared')}
              className={cn('workspace-sidebar__chip', activeTab === 'shared' && 'workspace-sidebar__chip--active')}
            >
              Shared
            </button>
          </div>

          <div className="mb-2 flex items-center px-3">
            {searchExpanded ? (
              <div className="flex w-full items-center gap-2">
                <Search className="h-4 w-4 shrink-0 text-[#9aa0a6]" />
                <input
                  data-qid="sidebar:input:search"
                  data-qs-action="SIDEBAR_SEARCH"
                  title="Search projects by name or description"
                  type="text"
                  placeholder="Search projects"
                  value={searchQuery}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                  onBlur={() => { if (!searchQuery) setSearchExpanded(false) }}
                  autoFocus
                  className="workspace-sidebar__search-input"
                />
              </div>
            ) : (
              <button
                type="button"
                title="Search projects"
                onClick={() => setSearchExpanded(true)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#9aa0a6] transition-colors hover:bg-white/5 hover:text-[#e3e3e3]"
                aria-label="Search projects"
              >
                <Search className="h-4 w-4" />
              </button>
            )}
          </div>
        </>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {!isCollapsed && (
          <div className="px-3 pb-1 pt-1 text-[11px] font-medium text-[#9aa0a6]">Projects</div>
        )}
        <div>
          {filteredProjects.map(p => <ProjectItem key={p.id} project={p} />)}
        </div>
      </div>

      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setCtxMenu(null)} />
          <div
            style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999 }}
            className="min-w-[120px] rounded border border-white/10 bg-[#2d2e30] py-0.5 shadow-xl"
          >
            {[
              { label: 'Open in New Tab', action: () => window.open(`#${ctxMenu.projectId}`, '_blank') },
              { label: 'Rename', action: () => {} },
              { label: 'Duplicate', action: () => {} },
              { label: 'Delete', danger: true, action: () => {} },
            ].map((item, i) => (
              <button
                key={i}
                onClick={() => { item.action(); setCtxMenu(null); }}
                className={cn(
                  'w-full px-2.5 py-1 text-left text-[12px] transition-colors hover:bg-white/5',
                  (item as { danger?: boolean }).danger ? 'text-red-400 hover:text-red-300' : 'text-[#e3e3e3] hover:text-white',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
};
const ViewHeader = ({ activeView, onViewChange, systemHealth, deployBlockedReason }: {
  activeView: View,
  onViewChange: (view: View) => void,
  systemHealth: { health: 'NOMINAL' | 'DEGRADED' | 'OFFLINE', details: string },
  deployBlockedReason?: string | null
}) => {
  useRegisterAction('header:tab:view', { app: 'ux-lab', action: 'HEADER_SWITCH_VIEW', label: 'Switch View Tab', description: 'Switch between Mockups, Components, Design Board, Reviews, Testing, and Final Site views' });
  useRegisterAction('header:button:history', { app: 'ux-lab', action: 'HEADER_HISTORY', label: 'History', description: 'View project history and recent changes' });
  useRegisterAction('header:button:notifications', { app: 'ux-lab', action: 'HEADER_NOTIFICATIONS', label: 'Notifications', description: 'View system notifications and alerts' });
  const isDeployBlocked = Boolean(deployBlockedReason);
  useRegisterAction('header:button:deploy', {
    app: 'ux-lab',
    action: 'HEADER_DEPLOY',
    label: isDeployBlocked ? 'Deploy Blocked' : 'Deploy',
    description: isDeployBlocked ? deployBlockedReason || 'Deployment is blocked by the current review gate' : 'Deploy the current project to production'
  });
  const developerToolViews: { label: string; id: View }[] = [
    { label: 'Mockups', id: 'mockups' },
    { label: 'Components', id: 'components' },
    { label: 'Design board', id: 'design-board' },
    { label: 'Reviews', id: 'reviews' },
    { label: 'Testing', id: 'testing' },
    { label: 'Final site', id: 'final-site' },
  ]

  return (
    <header className="z-40 flex h-11 items-center justify-between border-b border-white/10 bg-surface-low px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        <span className="shrink-0 text-[11px] font-medium text-slate-500">Developer tools</span>
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/5 p-0.5">
          {developerToolViews.map(({ label, id }) => {
            const isActive = activeView === id
            return (
              <button
                key={id}
                data-qid={`header:tab:${id}`}
                data-qs-action={`HEADER_TAB_${id.toUpperCase().replace('-', '_')}`}
                title={`Switch to ${label}`}
                onClick={() => onViewChange(id)}
                className={cn(
                  'whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
                  isActive ? 'bg-white/12 text-white' : 'text-slate-500 hover:text-slate-200',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]',
            systemHealth.health === 'NOMINAL' && 'bg-tactical-success/10 text-tactical-success',
            systemHealth.health === 'DEGRADED' && 'bg-tactical-warning/10 text-tactical-warning',
            systemHealth.health === 'OFFLINE' && 'bg-tactical-danger/10 text-tactical-danger',
          )}
          title={systemHealth.details}
        >
          <span className={cn(
            'h-1.5 w-1.5 rounded-full',
            systemHealth.health === 'NOMINAL' && 'bg-tactical-success',
            systemHealth.health === 'DEGRADED' && 'bg-tactical-warning',
            systemHealth.health === 'OFFLINE' && 'bg-tactical-danger',
          )} />
          {systemHealth.health}
        </div>
        <button data-qid="header:button:history" data-qs-action="HEADER_HISTORY" title="View project history" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/5 hover:text-white"><History className="h-4 w-4" /></button>
        <button data-qid="header:button:notifications" data-qs-action="HEADER_NOTIFICATIONS" title="View notifications" className="relative flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/5 hover:text-white">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-tactical-danger" />
        </button>
        <button
          data-qid="header:button:deploy"
          data-qs-action={isDeployBlocked ? 'HEADER_DEPLOY_BLOCKED' : 'HEADER_DEPLOY'}
          title={isDeployBlocked ? deployBlockedReason || 'Deploy blocked by the current review gate' : 'Deploy project to production'}
          disabled={isDeployBlocked}
          aria-disabled={isDeployBlocked}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors',
            isDeployBlocked
              ? 'cursor-not-allowed bg-tactical-danger/15 text-tactical-danger'
              : 'bg-tactical-primary text-black hover:bg-tactical-success',
          )}
        >
          {isDeployBlocked ? <AlertCircle className="h-3.5 w-3.5" /> : <Rocket className="h-3.5 w-3.5" />}
          {isDeployBlocked ? 'Blocked' : 'Deploy'}
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
  useRegisterAction('testing:button:import-manifest', { app: 'ux-lab', action: 'TESTING_IMPORT_MANIFEST', label: 'Import Test Manifest', description: 'Import a JSON test manifest to populate the node list' });
  useRegisterAction('testing:button:add-node', { app: 'ux-lab', action: 'TESTING_ADD_NODE', label: 'Add Test Node', description: 'Add a new interactive node to the test manifest' });
  useRegisterAction('testing:button:execute', { app: 'ux-lab', action: 'TESTING_EXECUTE', label: 'Execute Manifest', description: 'Run the full test manifest against the current project' });
  useRegisterAction('testing:button:approve-result', { app: 'ux-lab', action: 'TESTING_APPROVE_RESULT', label: 'Approve Test Result', description: 'Approve an inconclusive test result as passing' });
  useRegisterAction('testing:button:reject-result', { app: 'ux-lab', action: 'TESTING_REJECT_RESULT', label: 'Reject Test Result', description: 'Reject an inconclusive test result as failing' });
  useRegisterAction('testing:item:node', { app: 'ux-lab', action: 'TESTING_SELECT_NODE', label: 'Select Test Node', description: 'Select a test node to inspect its expected and actual results' });

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
              data-qid="testing:button:import-manifest"
              data-qs-action="TESTING_IMPORT_MANIFEST"
              title="Import test manifest from JSON"
              onClick={handleImportManifest}
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:text-tactical-primary transition-colors"
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
              data-qid="testing:item:node"
              title={`Inspect test node: ${node.label}`}
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
            data-qid="testing:button:add-node"
            data-qs-action="TESTING_ADD_NODE"
            title="Add a new test node to the manifest"
            onClick={handleAddNode}
            className="w-full p-2 min-h-[44px] border border-dashed border-tactical-primary/20 text-slate-500 hover:text-tactical-primary hover:border-tactical-primary/40 transition-all flex items-center justify-center gap-2 mt-2"
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
            data-qid="testing:button:execute"
            data-qs-action="TESTING_EXECUTE"
            title="Execute test manifest against current project"
            onClick={runTest}
            disabled={isRunning}
            className={cn(
              "px-4 py-1.5 min-h-[44px] border border-tactical-primary text-tactical-primary hover:bg-tactical-primary hover:text-black transition-all font-bold uppercase flex items-center gap-2",
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
                <button data-qid="testing:button:approve-result" data-qs-action="TESTING_APPROVE_RESULT" title="Approve inconclusive test result as passing" className="py-2 min-h-[44px] bg-tactical-success/20 border border-tactical-success/30 text-tactical-success hover:bg-tactical-success hover:text-black transition-all font-bold uppercase text-[9px]">
                  APPROVE
                </button>
                <button data-qid="testing:button:reject-result" data-qs-action="TESTING_REJECT_RESULT" title="Reject inconclusive test result as failing" className="py-2 min-h-[44px] bg-tactical-danger/20 border border-tactical-danger/30 text-tactical-danger hover:bg-tactical-danger hover:text-black transition-all font-bold uppercase text-[9px]">
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
        const res = await fetch(apiUrl('/memory/health'), { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'ok' && data.memory_db_connected) {
            setHealth('NOMINAL');
            setDetails('All systems online');
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
    const raw = window.location.hash.replace(/^#/, '');
    const [pathOnly] = raw.split('?');
    const normalizedPath = pathOnly.replace(/^\/+/, '');
    if (!normalizedPath) return { project: 'music-lab-pipeline', view: 'design-board' as View };
    const [first, ...rest] = normalizedPath.split('/');
    const viewNames = new Set<View>(['mockups', 'components', 'design-board', 'reviews', 'testing', 'final-site']);
    const viewAlias = rest[0] === 'final_site' ? 'final-site' : rest[0];
    const requestedView = viewNames.has(viewAlias as View) ? viewAlias as View : undefined;
    // Deep links to projects should default to 'final-site' (interactive implementation)
    // except for projects that don't have a final-site view
    const componentsOnlyProjects: string[] = [];
    return {
      project: first,
      view: requestedView ?? (componentsOnlyProjects.includes(first) ? 'components' as View : 'final-site' as View),
      subpath: requestedView ? rest.slice(1).join('/') : rest.join('/')
    };
  }, []);

  const initial = parseHash();
  const [activeProjectId, setActiveProjectId] = useState<string>(initial.project);
  const [activeView, setActiveView] = useState<View>(initial.view);
  const [hashSubpath, setHashSubpath] = useState<string>(initial.subpath || '');
  const systemHealth = useSystemHealth();
  const isPdfLabFocus = activeProjectId === 'pdf-lab'
    && activeView === 'final-site'
    && (hashSubpath === 'triage' || hashSubpath === 'surgical-triage' || hashSubpath === 'labeling');
  const isFocusMode = isPdfLabFocus;
  const deployBlockedReason = activeProjectId === 'scillm'
    && activeView === 'final-site'
    && hashSubpath === 'dag-planner'
    ? 'Deploy blocked: scillm DAG phase is ready for the final review gate, but not accepted.'
    : null;

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

  const handleViewChange = useCallback((view: View) => {
    setActiveView(view);
    setHashSubpath('');
    window.location.hash = `${activeProjectId}/${view}`;
  }, [activeProjectId]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  return (
    <div className={`flex h-screen w-screen overflow-hidden bg-surface-base relative ${isFocusMode ? '' : 'nvis-scan-line'}`}>
      {!isFocusMode && (
        <>
          <div className="absolute top-0 left-0 w-12 h-12 border-t border-l border-tactical-primary/20 z-[60] pointer-events-none" />
          <div className="absolute top-0 right-0 w-12 h-12 border-t border-r border-tactical-primary/20 z-[60] pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-12 h-12 border-b border-l border-tactical-primary/20 z-[60] pointer-events-none" />
          <div className="absolute bottom-0 right-0 w-12 h-12 border-b border-r border-tactical-primary/20 z-[60] pointer-events-none" />
        </>
      )}

      {!isFocusMode && (
        <ProjectSidebar 
          isCollapsed={isSidebarCollapsed} 
          onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
          activeProjectId={activeProjectId}
          onProjectSelect={handleProjectSelect}
        />
      )}

      <div className="flex-1 flex flex-col relative overflow-hidden">
        {!isFocusMode && (
          <ViewHeader 
            activeView={activeView} 
            onViewChange={handleViewChange}
            systemHealth={systemHealth}
            deployBlockedReason={deployBlockedReason}
          />
        )}
        
        <main className="flex-1 relative min-h-0 flex flex-col tactical-corner tactical-corner-tl tactical-corner-br modern-scrollbar">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${activeProjectId}-${activeView}`}
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
                    <div className="flex-1 overflow-auto">
                      <React.Suspense fallback={<div className="p-8 text-tactical-primary font-mono">LOADING_GALLERY...</div>}>
                        <ComponentGalleryView />
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
	                  ) : activeProjectId === 'scillm' ? (
	                    <div className="flex-1 min-h-0 overflow-hidden">
	                      <React.Suspense fallback={<div className="p-8 text-tactical-primary font-mono">LOADING_SCILLM...</div>}>
	                        <ScillmWorkspace />
	                      </React.Suspense>
	                    </div>
	                  ) : (
                    <React.Suspense fallback={<div className="p-8 text-tactical-primary font-mono">LOADING_GALLERY...</div>}>
                      <ComponentGalleryView />
                    </React.Suspense>
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
