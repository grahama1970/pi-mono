/**
 * Embry Terminal — Skills-aware agent control surface
 *
 * iPad-first conversation + artifact UI for Claude/Pi/Codex agents.
 * Mimics Claude Desktop's layout with NVIS MIL-STD-3009 dark theme.
 * Skills (/skill-name) are first-class citizens with inline highlighting.
 * Artifacts render inline by default, right panel on explicit request.
 */
import { useState, useCallback, useRef, useEffect, memo } from 'react';
import {
  Menu, Sparkles, Brain, Cpu, ChevronDown,
  Send, Plus, X, Code, Eye, FileText,
  Search, FolderOpen, GitBranch, Settings, Download,
} from 'lucide-react';
import ReasoningChain from './ReasoningChain';
import { useCommandHistory, useHealthMonitor, exportSession } from './useEmbryFeatures';
import DOMPurify from 'dompurify';
import {
  highlightEntities, MarkdownRenderer, SkillPalette,
  RecallCard as SharedRecallCard, GateChain, ThreatMatrixCard, DeltaReportCard,
  executePrimaryAction, configureDeepLinks,
} from '../shared-chat';
import type {
  RecallItem, RecallResult, ReasoningStep, Artifact, Skill,
  ThreatMatrixSummary, EntityType, DeltaReport,
} from '../shared-chat';

configureDeepLinks({
  // ida: 'ida://open?address={entity}',
  // splunk: 'https://splunk.internal/search?q={entity}',
});

// ── Types ───────────────────────────────────────────────────────────────────

interface Project {
  name: string;
  path: string;
  branch: string;
  exists: boolean;
}

interface AgentConfig {
  id: string;
  name: string;
  icon: typeof Sparkles;
  color: string;
}

// HealthStatus imported from useEmbryFeatures

interface Message {
  id: string;
  role: 'user' | 'assistant';
  agent?: string;
  content: string;
  skillUsed?: string;
  codeBlock?: string;
  recall?: RecallResult;
  artifact?: Artifact;
  reasoningSteps?: ReasoningStep[];
  chainTitle?: string;
  matrixSummary?: ThreatMatrixSummary;
  deltaReport?: DeltaReport;
  timestamp: number;
}

type ConnectionState = 'connected' | 'degraded' | 'reconnecting' | 'offline';

// ── Constants ───────────────────────────────────────────────────────────────

const AGENTS: AgentConfig[] = [
  { id: 'claude', name: 'Claude Code', icon: Sparkles, color: '#7c3aed' },
  { id: 'codex', name: 'Codex', icon: Cpu, color: '#4a9eff' },
  { id: 'pi', name: 'Pi', icon: Brain, color: '#00ff88' },
];

// Embry Terminal backend runs on its own port
// In dev: direct to localhost:8640. In prod: via tailscale serve path.
const BACKEND_URL = import.meta.env.DEV
  ? 'http://127.0.0.1:8640/api'
  : '/embry-terminal/api';

const DEV_TOKEN = 'embry-dev-token';
const AUTH_HEADERS: HeadersInit = { 'Authorization': `Bearer ${DEV_TOKEN}` };

// ── API ─────────────────────────────────────────────────────────────────────

async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${BACKEND_URL}/projects`, { headers: AUTH_HEADERS });
  if (!res.ok) return [];
  return res.json();
}

async function fetchSkills(): Promise<Skill[]> {
  const res = await fetch(`${BACKEND_URL}/skills`, { headers: AUTH_HEADERS });
  if (!res.ok) return [];
  return res.json();
}

// Entity highlighting, RecallCard, ScoreBar, SkillPalette → all from shared-chat/

// ── Tool Action Line (muted, collapsible — "Created 7 files >") ─────────────

const ToolAction = memo(function ToolAction({ label, qid }: { label: string; qid: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      onClick={() => setExpanded(v => !v)}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 13, color: '#64748b', background: 'none', border: 'none',
        cursor: 'pointer', padding: '4px 0', marginBottom: 8,
        fontFamily: 'var(--font-ui)', transition: 'color 0.15s',
      }}
      data-qid={qid}
    >
      {label}
      <ChevronDown size={12} style={{
        color: '#334155',
        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.15s',
      }} />
    </button>
  );
});

// ── Message Component ───────────────────────────────────────────────────────

const MessageItem = memo(function MessageItem({ msg, onEntityClick }: { msg: Message; onEntityClick?: (entity: string, type: EntityType) => void }) {
  const isUser = msg.role === 'user';

  // ── User message: right-aligned bubble (Claude Desktop pattern) ──
  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '24px 0' }}
           data-qid={`chat:message:${msg.id}`}>
        <div style={{
          maxWidth: '85%', padding: '16px 20px', borderRadius: '18px 18px 4px 18px',
          background: '#1e1e24', fontSize: 16, lineHeight: 1.7, color: '#e2e8f0',
          fontFamily: 'var(--font-ui)',
        }}>
          {highlightEntities(msg.content, onEntityClick)}
        </div>
      </div>
    );
  }

  // ── Agent message: left-aligned, plain text, no bubble/avatar ──
  return (
    <div style={{ padding: '16px 0', animation: 'msgIn 0.25s ease' }}
         data-qid={`chat:message:${msg.id}`}>

      {/* 1. ReasoningChain (collapsed by default) — "here is what I did"
             ToolAction lines live here; skill ToolAction suppressed when
             reasoning steps exist (skill is already visible inside the chain) */}
      {(msg.reasoningSteps && msg.reasoningSteps.length > 0) || msg.skillUsed || msg.codeBlock ? (
        <div style={{ marginBottom: 8 }}>
          {msg.skillUsed && !msg.reasoningSteps?.length && (
            <ToolAction label={`Ran /${msg.skillUsed}`} qid={`chat:message:${msg.id}:skill`} />
          )}
          {msg.codeBlock && (
            <ToolAction label="Ran a command" qid={`chat:message:${msg.id}:cmd`} />
          )}
          {msg.reasoningSteps && msg.reasoningSteps.length > 0 && (
            <ReasoningChain steps={msg.reasoningSteps} chainTitle={msg.chainTitle} />
          )}
        </div>
      ) : null}

      {/* 2. RecallCard — "here is the evidence I found" */}
      {msg.recall && (
        <SharedRecallCard
          items={msg.recall.items.map(it => ({ problem: it.problem, solution: it.solution, scores: it.scores }))}
          resultCount={msg.recall.items.length}
          confidence={msg.recall.confidence > 1 ? msg.recall.confidence / 100 : msg.recall.confidence}
        />
      )}

      {/* 3. Visual separator between reasoning/evidence and answer */}
      {(msg.recall || (msg.reasoningSteps && msg.reasoningSteps.length > 0)) && (
        <div style={{ borderTop: '1px dashed rgba(255,255,255,0.08)', margin: '12px 0' }} />
      )}

      {/* 4 & 5. Answer content + inline artifacts (MarkdownRenderer + codeBlock) */}
      <div style={{ fontSize: 16, lineHeight: 1.7, color: '#e2e8f0', fontFamily: 'var(--font-ui)' }}>
        <MarkdownRenderer content={msg.content} onEntityClick={onEntityClick} />

        {msg.codeBlock && (
          <div className="nvis-card" style={{ margin: '12px 0', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid var(--nvis-border-subtle)' }}>
              <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--font-mono)' }}>bash</span>
            </div>
            <pre style={{ margin: 0, padding: 12, fontFamily: 'var(--font-mono)', fontSize: 13, color: '#e2e8f0', overflowX: 'auto', lineHeight: 1.5, background: '#0b1220' }}>
              {msg.codeBlock}
            </pre>
          </div>
        )}
      </div>

      {/* 6. Structured cards — GateChain / ThreatMatrixCard / DeltaReportCard */}
      {msg.verdict && <GateChain gates={msg.verdict.gates} verdict={msg.verdict.state} tier={msg.verdict.tier} />}
      {msg.matrixSummary && <ThreatMatrixCard summary={msg.matrixSummary} />}
      {msg.deltaReport && <DeltaReportCard report={msg.deltaReport} onEntityClick={onEntityClick} />}
    </div>
  );
});

// SkillPalette → imported from shared-chat/

// ── Artifact Panel ──────────────────────────────────────────────────────────

function ArtifactPanel({ artifact, onClose }: { artifact: Artifact | null; onClose: () => void }) {
  const [tab, setTab] = useState<'code' | 'preview'>('preview');
  if (!artifact) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: '#334155' }}>
        <Code size={32} />
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1 }}>No Active Artifact</span>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }} data-qid="artifact:panel">
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--nvis-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Code size={14} style={{ color: '#7c3aed' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', flex: 1 }}>{artifact.title}</span>
        {['preview', 'code'].map(t => (
          <button key={t} onClick={() => setTab(t as 'code' | 'preview')}
            style={{
              padding: '4px 10px', fontSize: 11, fontWeight: 500, border: 'none', borderRadius: 6, cursor: 'pointer',
              background: tab === t ? '#27272a' : 'transparent', color: tab === t ? '#e2e8f0' : '#64748b',
              fontFamily: 'var(--font-ui)', transition: 'all 0.12s',
            }}
            data-qid={`artifact:tab:${t}`}
          >
            {t === 'code' ? <><Code size={11} /> Code</> : <><Eye size={11} /> Preview</>}
          </button>
        ))}
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }} data-qid="artifact:close">
          <X size={16} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'code' ? (
          <pre style={{ margin: 0, padding: 16, fontFamily: 'var(--font-mono)', fontSize: 13, color: '#e2e8f0', lineHeight: 1.6, background: '#0b1220', minHeight: '100%' }}>
            {artifact.content}
          </pre>
        ) : (
          <div style={{ padding: 16 }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(artifact.content) }} />
        )}
      </div>
    </div>
  );
}

// ── Main View ───────────────────────────────────────────────────────────────

export function EmbryTerminalView() {
  const [agent, setAgent] = useState(AGENTS[0]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: 'seed-1', role: 'user', content: '/assess SPARTA posture for CMMC Level 2',
      timestamp: Date.now() - 60000,
    },
    {
      id: 'seed-2', role: 'assistant', agent: 'claude',
      content: 'Based on memory recall and the SPARTA dataset, I\'ve assessed the current CMMC Level 2 posture. The extraction pipeline covers **110 of 171 NIST 800-171 controls** with verified QRAs. Key gaps remain in AC-17 (Remote Access) and SC-28 (Protection of Information at Rest).\n\nThe /dogpile research confirms these are the most commonly cited gaps across aerospace contractors. I recommend running /create-evidence-case for the 61 missing controls.',
      skillUsed: 'assess',
      recall: {
        found: true, confidence: 0.89,
        items: [
          { problem: 'SPARTA extraction fails on nested control hierarchies', solution: 'Flatten hierarchy before QRA generation — applied in batch-quality v2', scores: { bm25: 0.92, graph: 0.70, dense: 0.45, freshness: 0.87 } },
          { problem: 'CMMC Level 2 mapping incomplete for SC family', solution: 'Cross-reference NIST 800-171r3 Appendix D with SPARTA countermeasures', scores: { bm25: 0.85, graph: 0.82, dense: 0.38, freshness: 0.72 } },
          { problem: 'Prior assessment session: SPARTA convergence pipeline', solution: 'Fixed grounding threshold bug, PASS rate now 78%. Skills: assess → dogpile → plan', scores: { bm25: 0.78, graph: 0.65, dense: 0.31, freshness: 0.95 } },
        ],
      },
      reasoningSteps: [
        { id: 'r1', type: 'recall', skill: 'memory', status: 'done', summary: 'Recalled 3 prior SPARTA assessments', duration: 1200, confidence: 0.89 },
        { id: 'r2', type: 'text', status: 'done', summary: 'Based on memory, we\'ve addressed this control family before. Applying both patterns from prior sessions.' },
        { id: 'r3', type: 'skill', skill: 'dogpile', status: 'done', summary: 'Researching CMMC Level 2 aerospace requirements', duration: 4800 },
        { id: 'r4', type: 'skill', skill: 'extract-controls', status: 'done', summary: 'Extracted 110 NIST 800-171 controls from SPARTA dataset', duration: 2100, confidence: 0.94 },
        { id: 'r5', type: 'skill', skill: 'batch-quality', status: 'done', summary: 'Validated QRA quality for extracted controls', duration: 3200, confidence: 0.91 },
        { id: 'r6', type: 'pending', status: 'pending', summary: 'Store assessment results to /memory' },
      ],
      chainTitle: 'CMMC Level 2 Assessment',
      timestamp: Date.now() - 45000,
    },
  ]);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [input, setInput] = useState('');
  const [showPalette, setShowPalette] = useState(false);
  const paletteKeyHandler = useRef<((e: React.KeyboardEvent) => boolean) | null>(null);
  const [skillFilter, setSkillFilter] = useState('');
  const [connection, setConnection] = useState<ConnectionState>('offline');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cmdHistory = useCommandHistory();
  const health = useHealthMonitor(BACKEND_URL, AUTH_HEADERS);

  // Fetch real data (health handled by useHealthMonitor hook)
  useEffect(() => {
    Promise.all([fetchProjects(), fetchSkills()])
      .then(([p, s]) => {
        setProjects(p);
        setSkills(s);
        if (p.length > 0) setActiveProject(p[0]);
        setConnection('connected');
      })
      .catch(() => setConnection('offline'));
  }, []);

  // Scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Input handling
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    const lastWord = val.split(/\s+/).pop() || '';
    if (lastWord.startsWith('/') && lastWord.length > 1) {
      setShowPalette(true);
      setSkillFilter(lastWord.slice(1));
    } else {
      setShowPalette(false);
    }
  }, []);

  const handleSkillSelect = useCallback((name: string) => {
    const words = input.split(/\s+/);
    words[words.length - 1] = `/${name} `;
    setInput(words.join(' '));
    setShowPalette(false);
    inputRef.current?.focus();
  }, [input]);

  const sendMessageRef = useRef<() => void>();

  const sendMessage = useCallback(async () => {
    if (!input.trim()) return;
    cmdHistory.push(input.trim());
    const text = input.trim();
    setCommandHistory(prev => [text, ...prev].slice(0, 50));
    setHistoryIdx(-1);
    setMessages(m => [...m, { id: `u${Date.now()}`, role: 'user', content: text, timestamp: Date.now() }]);
    setInput('');
    setShowPalette(false);

    // Detect if this is a /skill invocation
    const skillMatch = text.match(/^\/([a-z][\w-]*)/);
    const isSkill = !!skillMatch;

    // Memory-first: recall before agent call (real ArangoDB data)
    let recallData: RecallResult | undefined;
    try {
      const recallRes = await fetch(`${BACKEND_URL}/agent/recall`, {
        method: 'POST',
        headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, project: activeProject?.name }),
      });
      if (recallRes.ok) {
        const raw = await recallRes.json();
        if (raw.found && raw.items?.length > 0) {
          recallData = {
            found: true,
            confidence: raw.confidence || 0,
            items: raw.items.slice(0, 3).map((item: { problem?: string; solution?: string; _key?: string; content?: string; scores?: Record<string, number> }) => ({
              problem: item.problem || item._key || 'Unknown',
              solution: item.solution || item.content || '',
              scores: item.scores || { bm25: 0, graph: 0, dense: 0, freshness: 0 },
            })),
          };
        }
      }
    } catch { /* memory unavailable, proceed without recall */ }

    const agentId = `a${Date.now()}`;
    setMessages(m => [...m, {
      id: agentId, role: 'assistant', agent: agent.id,
      content: '', skillUsed: skillMatch?.[1],
      recall: recallData,
      timestamp: Date.now(),
    }]);

    try {
      if (isSkill) {
        // SSE streaming for skill execution
        const res = await fetch(`${BACKEND_URL}/agent/message`, {
          method: 'POST',
          headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, backend: 'skill', skill: skillMatch![1], project: activeProject?.name }),
        });
        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'text' && event.content) {
                setMessages(prev => prev.map(m => m.id === agentId
                  ? { ...m, content: m.content + event.content }
                  : m
                ));
              }
            } catch { /* partial JSON */ }
          }
        }
      } else {
        // Non-streaming scillm call
        const res = await fetch(`${BACKEND_URL}/agent/message`, {
          method: 'POST',
          headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, backend: 'scillm', model: 'text', project: activeProject?.name }),
        });
        const data = await res.json();
        setMessages(prev => prev.map(m => m.id === agentId
          ? { ...m, content: data.content || data.error || 'No response' }
          : m
        ));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setMessages(prev => prev.map(m => m.id === agentId
        ? { ...m, content: `**Error:** ${msg}` }
        : m
      ));
    }
  }, [input, agent, activeProject]);

  sendMessageRef.current = sendMessage;

  // Entity click → deep-link system (SPARTA Explorer, Binary Explorer, IDA Pro, Splunk, etc.)
  const handleEntityClick = useCallback((entity: string, type: EntityType) => {
    executePrimaryAction(entity, type, setInput, () => sendMessageRef.current?.(), () => inputRef.current?.focus());
  }, []);

  const AgentIcon = agent.icon;

  const connectionColor = connection === 'connected' ? '#00ff88' : connection === 'degraded' ? '#ffaa00' : '#ff4444';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#141414', color: '#e2e8f0', overflow: 'hidden' }}>
      {/* Top bar */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.13)', background: '#111111', minHeight: 48 }}>
        <button onClick={() => setSidebarOpen(v => !v)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 6 }} data-qid="topbar:sidebar:toggle">
          <Menu size={18} />
        </button>

        {/* Agent picker */}
        <button style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px',
          background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 8,
          cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#e2e8f0', fontFamily: 'var(--font-ui)',
        }} data-qid="topbar:agent:select">
          <AgentIcon size={15} style={{ color: agent.color }} />
          {agent.name}
          <ChevronDown size={13} style={{ color: '#64748b' }} />
        </button>

        <div style={{ flex: 1 }} />

        {/* Health status — per-service indicators with labels */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} data-qid="topbar:connection:status">
          {[
            { label: 'API', up: health.expressUp },
            { label: 'MEM', up: health.memoryUp },
            { label: 'LLM', up: health.scillmUp },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }} title={`${s.label}: ${s.up ? 'connected' : 'down'}`}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.up ? '#00ff88' : '#ff4444', boxShadow: s.up ? '0 0 4px #00ff8866' : 'none' }} />
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: s.up ? '#64748b' : '#ff4444' }}>{s.label}</span>
            </div>
          ))}
          {health.latencyMs && (
            <span style={{ fontSize: 9, color: '#475569', fontFamily: 'var(--font-mono)', marginLeft: 2 }}>
              {health.latencyMs}ms
            </span>
          )}
        </div>

        {/* Export conversation — dropdown with format options */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowExport(v => !v)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 6 }} title="Export session">
            <Download size={16} />
          </button>
          {showExport && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 50,
              background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 8,
              padding: 4, minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}>
              {(['markdown', 'html', 'pdf'] as const).map(fmt => (
                <button key={fmt} onClick={() => {
                  exportSession(messages, fmt, activeProject?.name || 'none', agent.name);
                  setShowExport(false);
                }} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', width: '100%',
                  background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer',
                  color: '#e2e8f0', fontSize: 12, fontFamily: 'var(--font-ui)', textAlign: 'left',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#64748b', width: 20 }}>
                    {fmt === 'markdown' ? '.md' : fmt === 'html' ? '.html' : '.pdf'}
                  </span>
                  Export as {fmt.charAt(0).toUpperCase() + fmt.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail toggle */}
        <button onClick={() => setDetailOpen(v => !v)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 6, minWidth: 32, minHeight: 32 }}
          data-qid="topbar:detail:toggle"
        >
          {detailOpen ? '✕' : '▣'}
        </button>
      </header>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Sidebar */}
        {sidebarOpen && (
          <aside style={{
            width: 280, background: '#111111', borderRight: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
          }}>
            <div style={{ padding: 12, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#1a1a1a', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }}>
                <Search size={13} style={{ color: '#334155' }} />
                <span style={{ fontSize: 13, color: '#64748b' }}>Search projects…</span>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px' }}>
              <div style={{ fontSize: 9, fontWeight: 600, color: '#334155', padding: '8px 8px 4px', letterSpacing: 1, textTransform: 'uppercase' }}>
                Projects ({projects.length})
              </div>
              {projects.slice(0, 20).map(p => (
                <button key={p.name} onClick={() => setActiveProject(p)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px',
                    border: 'none', cursor: 'pointer', borderRadius: 6, textAlign: 'left',
                    background: activeProject?.name === p.name ? 'rgba(124,58,237,0.08)' : 'transparent',
                    borderLeft: activeProject?.name === p.name ? '2px solid #7c3aed' : '2px solid transparent',
                    fontFamily: 'var(--font-ui)', transition: 'background 0.1s',
                  }}
                  data-qid={`sidebar:project:${p.name}:select`}
                >
                  <FolderOpen size={13} style={{ color: activeProject?.name === p.name ? '#7c3aed' : '#64748b', flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: activeProject?.name === p.name ? '#e2e8f0' : '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <GitBranch size={9} style={{ color: '#334155' }} />
                      <span style={{ fontSize: 9, color: '#334155' }}>{p.branch}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: connectionColor }} />
              <span style={{ fontSize: 10, color: '#64748b', flex: 1 }}>Tailscale</span>
              <Settings size={14} style={{ color: '#334155' }} />
            </div>
          </aside>
        )}

        {/* Chat area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 1, overflow: 'auto', padding: '0 16px', WebkitOverflowScrolling: 'touch' }}>
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              {messages.map(m => <MessageItem key={m.id} msg={m} onEntityClick={handleEntityClick} />)}
              <div ref={chatEndRef} />
            </div>
          </div>

          {/* Composer */}
          <div style={{ padding: '12px 16px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', background: '#111111' }}>
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              <div style={{ position: 'relative' }}>
                {showPalette && <SkillPalette filter={skillFilter} skills={skills} onSelect={handleSkillSelect} onClose={() => setShowPalette(false)} onKeyNav={handler => { paletteKeyHandler.current = handler; }} />}
                <div style={{ background: '#0b1220', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 16, overflow: 'hidden', position: 'relative' }}>
                  {/* Highlight overlay — renders colored skill names behind transparent textarea */}
                  <div aria-hidden style={{
                    position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'none',
                    padding: '16px 18px 8px', fontFamily: 'var(--font-ui)', fontSize: 16, lineHeight: 1.5,
                    whiteSpace: 'pre-wrap', wordWrap: 'break-word',
                  }}>
                    {input ? highlightEntities(input) : <span style={{ color: '#475569' }}>Message {agent.name}…</span>}
                  </div>
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={e => {
                      if (showPalette && paletteKeyHandler.current?.(e)) return;
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setInput('/'); setShowPalette(true); setSkillFilter(''); }
                      if (e.key === 'ArrowUp' && !showPalette) {
                        const prev = cmdHistory.up(input);
                        if (prev !== null) { e.preventDefault(); setInput(prev); }
                      }
                      if (e.key === 'ArrowDown' && !showPalette) {
                        const next = cmdHistory.down();
                        if (next !== null) { e.preventDefault(); setInput(next); }
                      }
                    }}
                    placeholder={`Message ${agent.name}…`}
                    rows={1}
                    style={{
                      width: '100%', border: 'none', outline: 'none', resize: 'none',
                      background: 'transparent', fontFamily: 'var(--font-ui)', fontSize: 16,
                      color: 'transparent', padding: '16px 18px 8px', lineHeight: 1.5,
                      minHeight: 24, maxHeight: 200, position: 'relative', zIndex: 1,
                      caretColor: '#e2e8f0',
                    }}
                    data-qid="input:compose"
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 10px 8px' }}>
                    <button style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', padding: 6 }} data-qid="input:attach">
                      <Plus size={18} />
                    </button>
                    <button onClick={sendMessage} disabled={!input.trim()}
                      style={{
                        width: 44, height: 44, borderRadius: '50%', border: 'none',
                        cursor: input.trim() ? 'pointer' : 'default',
                        background: input.trim() ? '#7c3aed' : '#27272a',
                        color: input.trim() ? '#141414' : '#64748b',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.15s',
                      }}
                      data-qid="input:send"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
                <div style={{ textAlign: 'center', fontSize: 11, color: '#334155', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
                  {agent.name} on {activeProject?.name || 'no project'} · {skills.length} skills · ⌘K skills · ↑↓ history · Tailscale · {messages.filter(m => m.role === 'user').length} queries logged
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Artifact panel */}
        {detailOpen && (
          <aside style={{ width: 420, borderLeft: '1px solid rgba(255,255,255,0.13)', background: '#141414', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            <ArtifactPanel artifact={artifact} onClose={() => setDetailOpen(false)} />
          </aside>
        )}
      </div>
    </div>
  );
}

// ── Seed Messages ───────────────────────────────────────────────────────────

const SEED_MESSAGES: Message[] = [
  {
    id: 'm1', role: 'user',
    content: 'Check memory for SPARTA control extraction failures before scanning the codebase.',
    timestamp: Date.now() - 60000,
  },
  {
    id: 'm2', role: 'assistant', agent: 'pi',
    skillUsed: 'memory',
    content: 'Running recall first per Memory First contract…',
    codeBlock: './run.sh recall --q "SPARTA control extraction failures"',
    recall: {
      found: true, confidence: 0.84,
      items: [
        {
          problem: 'SPARTA extraction fails on controls with nested sub-controls',
          solution: 'Flatten hierarchy before extraction — use recursive CTE in AQL',
          scores: { bm25: 0.92, graph: 0.70, dense: 0.41, freshness: 0.88 },
        },
        {
          problem: 'Timeout on large SPARTA worksheets (>200 controls)',
          solution: 'Batch into chunks of 50, use /upsert with deterministic _keys',
          scores: { bm25: 0.78, graph: 0.50, dense: 0.38, freshness: 0.65 },
        },
      ],
    },
    timestamp: Date.now() - 50000,
  },
  {
    id: 'm3', role: 'assistant', agent: 'pi',
    content: "Based on memory, we've hit this before. The extraction fails when controls have nested sub-controls — the fix is to flatten the hierarchy using a recursive CTE in AQL before running the extraction pipeline.\n\nThe second hit is also relevant: for large worksheets (>200 controls), batch into chunks of 50 and use deterministic `_key` values so re-runs merge via `/upsert` instead of creating duplicates.\n\nShould I apply both patterns to the current batch, or do you want to investigate further?",
    timestamp: Date.now() - 40000,
  },
  {
    id: 'm4', role: 'user',
    content: '/create-evidence-case for CMMC Level 2 compliance',
    timestamp: Date.now() - 30000,
  },
  {
    id: 'm5', role: 'assistant', agent: 'pi',
    skillUsed: 'create-evidence-case',
    content: 'Building evidence case for CMMC Level 2. Decomposing into sub-tasks and running skill chain...',
    chainTitle: '/create-evidence-case for CMMC Level 2',
    reasoningSteps: [
      { id: 's1', type: 'recall', skill: 'memory', status: 'done', summary: 'Searching prior evidence cases...', detail: 'Found 3 prior CMMC assessments in memory.', duration: 1200, confidence: 0.84 },
      { id: 's2', type: 'skill', skill: 'dogpile', status: 'done', summary: 'Researching CMMC Level 2 requirements...', detail: 'Searched Brave, ArXiv, GitHub. Found 12 relevant sources.', duration: 4800 },
      { id: 's3', type: 'skill', skill: 'extract-controls', status: 'done', summary: 'Extracting NIST 800-171 controls...', detail: 'Extracted 110 controls from SP 800-171 Rev 2. Mapped to 14 CMMC domains.', duration: 2100 },
      { id: 's4', type: 'text', skill: undefined, status: 'done', summary: 'Cross-referencing controls against existing SPARTA graph coverage...' },
      { id: 's5', type: 'skill', skill: 'scillm', status: 'running', summary: 'Synthesizing claims from evidence...' },
      { id: 's6', type: 'pending', skill: 'memory', status: 'pending', summary: 'Storing evidence case...' },
    ],
    timestamp: Date.now() - 20000,
  },
];
