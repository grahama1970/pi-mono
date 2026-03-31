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
  Search, FolderOpen, GitBranch, Settings,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';
import Fuse from 'fuse.js';
import hljs from 'highlight.js/lib/core';
import go from 'highlight.js/lib/languages/go';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import rust from 'highlight.js/lib/languages/rust';

// Register highlight.js languages
hljs.registerLanguage('go', go);
hljs.registerLanguage('python', python);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('py', python);
hljs.registerLanguage('sh', bash);

// ── Types ───────────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  icon: typeof Sparkles;
  color: string;
}

interface Project {
  name: string;
  path: string;
  branch: string;
  exists: boolean;
}

interface Skill {
  name: string;
  description: string;
  triggers: string[];
}

interface RecallResult {
  found: boolean;
  confidence: number;
  items: Array<{
    problem: string;
    solution: string;
    scores: { bm25: number; graph: number; dense: number; freshness: number };
  }>;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  agent?: string;
  content: string;
  skillUsed?: string;
  codeBlock?: string;
  recall?: RecallResult;
  timestamp: number;
}

interface Artifact {
  id: string;
  title: string;
  type: 'code' | 'html' | 'svg' | 'markdown';
  content: string;
  language?: string;
}

type ConnectionState = 'connected' | 'degraded' | 'reconnecting' | 'offline';

// ── Constants ───────────────────────────────────────────────────────────────

const AGENTS: Agent[] = [
  { id: 'claude', name: 'Claude Code', icon: Sparkles, color: '#7c3aed' },
  { id: 'codex', name: 'Codex', icon: Cpu, color: '#4a9eff' },
  { id: 'pi', name: 'Pi', icon: Brain, color: '#00ff88' },
];

const BACKEND_URL = '/api'; // Proxied to embry-terminal Express server

// ── API ─────────────────────────────────────────────────────────────────────

async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${BACKEND_URL}/projects`);
  if (!res.ok) return [];
  return res.json();
}

async function fetchSkills(): Promise<Skill[]> {
  const res = await fetch(`${BACKEND_URL}/skills`);
  if (!res.ok) return [];
  return res.json();
}

// ── Skill Highlighting ──────────────────────────────────────────────────────

function highlightSkills(text: string): (string | JSX.Element)[] {
  const parts = text.split(/(\/[a-z][\w-]*)/g);
  return parts.map((part, i) => {
    if (/^\/[a-z][\w-]*$/.test(part)) {
      return (
        <span key={i} className="skill-tag" data-qid={`skill:${part.slice(1)}:ref`}>
          {part}
        </span>
      );
    }
    return part;
  });
}

// ── Score Bar (from agent-web-ui.jsx) ───────────────────────────────────────

const ScoreBar = memo(function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span style={{ color: '#64748b', width: 52, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: '#27272a', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${value * 100}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', color: '#a1a1aa', width: 30, fontSize: 10 }}>{value.toFixed(2)}</span>
    </div>
  );
});

// ── Recall Card ─────────────────────────────────────────────────────────────

const RecallCard = memo(function RecallCard({ recall }: { recall: RecallResult }) {
  const [expanded, setExpanded] = useState(0);
  const confColor = recall.confidence > 0.7 ? '#00ff88' : recall.confidence > 0.4 ? '#ffaa00' : '#ff4444';
  const confBg = recall.confidence > 0.7 ? 'rgba(0,255,136,0.08)' : recall.confidence > 0.4 ? 'rgba(255,170,0,0.08)' : 'rgba(255,68,68,0.08)';

  return (
    <div className="nvis-card" style={{ margin: '14px 0', borderLeft: `3px solid ${confColor}`, overflow: 'hidden' }}
         data-qid="chat:recall-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--nvis-border-subtle)' }}>
        <Brain size={14} style={{ color: '#7c3aed' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
          Memory Recall
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: confColor, background: confBg, padding: '2px 9px', borderRadius: 8 }}>
          {(recall.confidence * 100).toFixed(0)}%
        </span>
      </div>
      {recall.items.map((item, i) => (
        <button key={i}
          onClick={() => setExpanded(expanded === i ? -1 : i)}
          style={{
            display: 'block', width: '100%', textAlign: 'left',
            padding: '10px 14px', cursor: 'pointer', border: 'none',
            borderBottom: i < recall.items.length - 1 ? '1px solid var(--nvis-border-subtle)' : 'none',
            background: expanded === i ? 'rgba(124,58,237,0.05)' : 'transparent',
            transition: 'background 0.15s', fontFamily: 'var(--font-ui)',
          }}
          data-qid={`chat:recall:item:${i}:toggle`}
        >
          <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500, marginBottom: 4 }}>{item.problem}</div>
          <div style={{ fontSize: 12, color: '#00ff88', lineHeight: 1.5 }}>→ {item.solution}</div>
          {expanded === i && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <ScoreBar label="BM25" value={item.scores.bm25} color="#7c3aed" />
              <ScoreBar label="Graph" value={item.scores.graph} color="#4a9eff" />
              <ScoreBar label="Dense" value={item.scores.dense} color="#00ff88" />
              <ScoreBar label="Fresh" value={item.scores.freshness} color="#ffaa00" />
            </div>
          )}
        </button>
      ))}
    </div>
  );
});

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

const MessageItem = memo(function MessageItem({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';

  // ── User message: right-aligned bubble (Claude Desktop pattern) ──
  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '24px 0' }}
           data-qid={`chat:message:${msg.id}`}>
        <div style={{
          maxWidth: '85%', padding: '14px 18px', borderRadius: '18px 18px 4px 18px',
          background: '#1e1e24', fontSize: 15, lineHeight: 1.65, color: '#e2e8f0',
          fontFamily: 'var(--font-ui)',
        }}>
          {msg.content}
        </div>
      </div>
    );
  }

  // ── Agent message: left-aligned, plain text, no bubble/avatar ──
  return (
    <div style={{ padding: '16px 0', animation: 'msgIn 0.25s ease' }}
         data-qid={`chat:message:${msg.id}`}>
      {/* Tool-use action line (muted, collapsible — like "Created 7 files >") */}
      {msg.skillUsed && (
        <ToolAction label={`Ran /${msg.skillUsed}`} qid={`chat:message:${msg.id}:skill`} />
      )}
      {msg.codeBlock && (
        <ToolAction label="Ran a command" qid={`chat:message:${msg.id}:cmd`} />
      )}

      {/* Content — plain text flush left, no container */}
      <div style={{ fontSize: 15, lineHeight: 1.65, color: '#e2e8f0', fontFamily: 'var(--font-ui)' }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <p style={{ margin: '4px 0' }}>{typeof children === 'string' ? highlightSkills(children) : children}</p>,
            code: ({ className, children }) => {
              const lang = className?.replace('language-', '') || '';
              const text = String(children).replace(/\n$/, '');
              if (!className) {
                return <code style={{ fontFamily: 'var(--font-mono)', fontSize: 13, background: '#0b1220', padding: '2px 6px', borderRadius: 4, color: '#4a9eff' }}>{text}</code>;
              }
              let highlighted = text;
              try {
                highlighted = lang && hljs.getLanguage(lang) ? hljs.highlight(text, { language: lang }).value : hljs.highlightAuto(text).value;
              } catch { /* fallback */ }
              return (
                <div className="nvis-card" style={{ margin: '12px 0', overflow: 'hidden' }}>
                  {lang && <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--nvis-border-subtle)', fontSize: 11, fontFamily: 'var(--font-mono)', color: '#64748b', textTransform: 'uppercase' }}>{lang}</div>}
                  <pre style={{ margin: 0, padding: 12, fontFamily: 'var(--font-mono)', fontSize: 13, color: '#e2e8f0', overflowX: 'auto', lineHeight: 1.5, background: '#0b1220' }}>
                    <code dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(highlighted) }} />
                  </pre>
                </div>
              );
            },
            table: ({ children }) => (
              <div className="nvis-card" style={{ margin: '12px 0', overflow: 'hidden' }}>
                <table style={{ width: '100%', fontSize: 13, fontFamily: 'var(--font-mono)', borderCollapse: 'collapse' }}>{children}</table>
              </div>
            ),
            th: ({ children }) => <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, background: '#0b1220', borderBottom: '1px solid var(--nvis-border)' }}>{children}</th>,
            td: ({ children }) => {
              const text = String(children || '');
              let color = '#e2e8f0';
              if (text.includes('✅') || text.includes('Pass')) color = '#00ff88';
              else if (text.includes('❌') || text.includes('Fail')) color = '#ff4444';
              else if (text.includes('⚠️') || text.includes('Warn')) color = '#ffaa00';
              return <td style={{ padding: '8px 12px', color, borderBottom: '1px solid var(--nvis-border-subtle)' }}>{children}</td>;
            },
          }}
        >
          {msg.content}
        </ReactMarkdown>

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

        {msg.recall && <RecallCard recall={msg.recall} />}
      </div>
    </div>
  );
});

// ── Skill Palette ───────────────────────────────────────────────────────────

function SkillPaletteDropdown({ filter, skills, onSelect, onClose }: {
  filter: string;
  skills: Skill[];
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const fuse = new Fuse(skills, { keys: ['name', 'description', 'triggers'], threshold: 0.4 });
  const filtered = filter ? fuse.search(filter).slice(0, 12).map(r => r.item) : skills.slice(0, 12);

  useEffect(() => setIndex(0), [filter]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' && filtered[index]) { e.preventDefault(); onSelect(filtered[index].name); }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [filtered, index, onSelect, onClose]);

  if (filtered.length === 0) return null;

  return (
    <div style={{
      position: 'absolute', bottom: '100%', left: 0, marginBottom: 8,
      width: 320, background: '#1a1a1a', border: '1px solid var(--nvis-border)',
      borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 100,
      maxHeight: 280, overflow: 'auto',
    }} data-qid="skill-palette:dropdown">
      {filtered.map((skill, i) => (
        <button key={skill.name} onClick={() => onSelect(skill.name)}
          onMouseEnter={() => setIndex(i)}
          style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px',
            background: i === index ? 'rgba(124,58,237,0.1)' : 'transparent',
            borderLeft: i === index ? '2px solid #7c3aed' : '2px solid transparent',
            border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)',
            transition: 'background 0.1s',
          }}
          data-qid={`skill-palette:skill:${skill.name}:select`}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: '#4a9eff' }}>/{skill.name}</span>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.description}</div>
        </button>
      ))}
    </div>
  );
}

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
  const [messages, setMessages] = useState<Message[]>(SEED_MESSAGES);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [input, setInput] = useState('');
  const [showPalette, setShowPalette] = useState(false);
  const [skillFilter, setSkillFilter] = useState('');
  const [connection, setConnection] = useState<ConnectionState>('offline');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch real data
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

  const sendMessage = useCallback(() => {
    if (!input.trim()) return;
    setMessages(m => [...m, { id: `u${Date.now()}`, role: 'user', content: input.trim(), timestamp: Date.now() }]);
    setInput('');
    setShowPalette(false);
    // TODO: Wire to real agent backend via /code-runner, /subagent-service, /scillm
    setTimeout(() => {
      setMessages(m => [...m, {
        id: `a${Date.now()}`, role: 'assistant', agent: agent.id,
        content: "I'll check memory first, then proceed with the task…",
        skillUsed: 'memory',
        timestamp: Date.now(),
      }]);
    }, 800);
  }, [input, agent]);

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

        {/* Connection status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} data-qid="topbar:connection:status">
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: connectionColor, boxShadow: connection === 'connected' ? `0 0 4px ${connectionColor}` : 'none' }} />
          <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--font-mono)' }}>{connection === 'connected' ? 'Connected' : 'Offline'}</span>
        </div>

        {/* Detail toggle */}
        <button onClick={() => setDetailOpen(v => !v)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 6, fontSize: 16 }}
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
              {messages.map(m => <MessageItem key={m.id} msg={m} />)}
              <div ref={chatEndRef} />
            </div>
          </div>

          {/* Composer */}
          <div style={{ padding: '12px 16px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', background: '#111111' }}>
            <div style={{ maxWidth: 760, margin: '0 auto' }}>
              <div style={{ position: 'relative' }}>
                {showPalette && <SkillPaletteDropdown filter={skillFilter} skills={skills} onSelect={handleSkillSelect} onClose={() => setShowPalette(false)} />}
                <div style={{ background: '#0b1220', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 16, overflow: 'hidden' }}>
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !showPalette) { e.preventDefault(); sendMessage(); } }}
                    placeholder={`Message ${agent.name}…`}
                    rows={1}
                    style={{
                      width: '100%', border: 'none', outline: 'none', resize: 'none',
                      background: 'transparent', fontFamily: 'var(--font-ui)', fontSize: 15,
                      color: '#e2e8f0', padding: '14px 16px 8px', lineHeight: 1.5,
                      minHeight: 24, maxHeight: 200,
                    }}
                    data-qid="input:compose"
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 10px 8px' }}>
                    <button style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', padding: 6 }} data-qid="input:attach">
                      <Plus size={18} />
                    </button>
                    <button onClick={sendMessage} disabled={!input.trim()}
                      style={{
                        width: 32, height: 32, borderRadius: '50%', border: 'none',
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
                  {agent.name} on {activeProject?.name || 'no project'} · {skills.length} skills · via Tailscale
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
];
