import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { 
  Play, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Image as ImageIcon, 
  ChevronRight, 
  ChevronDown,
  Terminal,
  Plus,
  Trash2,
  Edit3,
  Search,
  X,
  StopCircle,
  Clock,
  BarChart3,
  Save,
  Activity,
  ChevronUp
} from 'lucide-react';
import { useAgentBus } from './sparta/common/useAgentBus';
import { LeftPane, LeftPaneSection, paneItemStyle } from './common/LeftPane';
import { ContextMenu } from './common/ContextMenu';
import { LightboxImage } from './common/Lightbox';

// --- Types ---

type StepAction = 'click' | 'rightclick' | 'type' | 'clear' | 'hover' | 'drag' | 'scroll' | 'wait' | 'navigate' | 'screenshot' | 'assert' | 'evaluate';
type AssertType = 'exists' | 'not_exists' | 'visible' | 'text_contains' | 'count' | 'style' | 'moved';
type Operator = 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains';

interface TestStep {
  action: StepAction;
  selector?: string;
  text?: string;
  dx?: number;
  dy?: number;
  ms?: number;
  name?: string;
  type?: AssertType;
  property?: string;
  operator?: Operator;
  value?: any;
  script?: string;
  hash?: string;
  url?: string;
}

interface StepResult extends TestStep {
  status: 'PASSED' | 'FAILED' | 'RUNNING' | 'PENDING';
  expected?: string;
  actual?: string;
  screenshotUrl?: string;
  detail?: string;
}

interface TestDefinition {
  id: string;
  group: string;
  label: string;
  steps: TestStep[];
}

interface TestRunResult {
  testId: string;
  status: 'PASSED' | 'FAILED' | 'RUNNING' | 'IDLE' | 'PENDING';
  steps: StepResult[];
  durationMs?: number;
}

interface Manifest {
  version: number;
  baseUrl: string;
  tests: TestDefinition[];
}

// --- Components ---

// Available manifest files
interface ManifestInfo { name: string; file: string; testCount: number; groups: string[] }

export function TestingPanel() {
  const [manifests, setManifests] = useState<ManifestInfo[]>([]);
  const [selectedManifestFile, setSelectedManifestFile] = useState<string>('test-manifest.json');
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [runResults, setRunResults] = useState<Record<string, TestRunResult>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [expandedTests, setExpandedTests] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingTest, setEditingTest] = useState<TestDefinition | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [coverageData, setCoverageData] = useState<{ total: number; tested: number; untested: string[] }>({ total: 0, tested: 0, untested: [] });
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; file: string; name: string } | null>(null);
  const [testSearch, setTestSearch] = useState('');
  // Round tracking for convergence loop
  const [currentRound, setCurrentRound] = useState(0);
  const [roundScores, setRoundScores] = useState<{ round: number; avg: number; passed: number; total: number }[]>([]);

  // Load available manifests list
  const fetchManifests = useCallback(async () => {
    try {
      const res = await fetch('/api/test-runner/manifests');
      if (res.ok) {
        const data = await res.json();
        setManifests(data.manifests || []);
      }
    } catch { /* fallback to single manifest */ }
  }, []);

  // Load selected manifest
  const fetchManifest = useCallback(async () => {
    const res = await fetch(`/api/test-runner/manifest?file=${encodeURIComponent(selectedManifestFile)}`);
    const data = await res.json();
    setManifest(data);
    setRunResults({});

    const groups = Array.from(new Set(data.tests.map((t: any) => t.group))) as string[];
    setExpandedGroups(groups.reduce((acc, g) => ({ ...acc, [g]: true }), {}));
    calculateCoverage(data.tests);
  }, [selectedManifestFile]);

  useEffect(() => { fetchManifests(); }, [fetchManifests]);
  useEffect(() => { fetchManifest(); }, [fetchManifest]);

  // Real-time Updates via WebSocket
  useAgentBus((msg) => {
    const p = msg.payload as Record<string, unknown>;
    switch (msg.type) {
      case 'test-run-start':
        setActiveRunId(p.runId as string);
        // Reset results for fresh run
        setRunResults({});
        break;

      case 'test-step':
        setRunResults(prev => {
          const testId = p.testId as string;
          const current = prev[testId] || { testId, status: 'RUNNING', steps: [] };

          if (p.action === 'START') return { ...prev, [testId]: { ...current, status: 'RUNNING' } };

          const newStep: StepResult = {
            action: p.step as StepAction,
            selector: p.selector as string | undefined,
            url: p.url as string | undefined,
            hash: p.hash as string | undefined,
            status: p.status as 'PASSED' | 'FAILED' | 'RUNNING' | 'PENDING',
            detail: p.detail as string | undefined,
            expected: p.expected as string | undefined,
            actual: p.actual as string | undefined,
            screenshotUrl: p.screenshotUrl as string | undefined
          };

          return {
            ...prev,
            [testId]: {
              ...current,
              steps: [...current.steps, newStep]
            }
          };
        });
        break;

      case 'test-result':
        setRunResults(prev => {
          const testId = p.testId as string;
          return {
            ...prev,
            [testId]: {
              ...(prev[testId] || { steps: [] }),
              testId,
              status: p.status as 'PASSED' | 'FAILED' | 'RUNNING' | 'PENDING',
              durationMs: p.durationMs as number | undefined
            }
          };
        });
        break;

      case 'test-run-done':
        setActiveRunId(null);
        // Auto-record round if this was a persona review manifest
        if (p?.runId && selectedManifestFile.includes('review')) {
          fetch(`/api/test-runner/rounds/record`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId: p.runId }),
          })
            .then(r => r.json())
            .then(summary => {
              if (summary.round) {
                setCurrentRound(summary.round as number);
                setRoundScores(prev => [...prev, { round: summary.round as number, avg: summary.avg as number, passed: summary.passed as number, total: summary.total as number }]);
              }
            })
            .catch(() => {});
        }
        break;
      case 'round-complete':
        setCurrentRound(p.round as number);
        setRoundScores(prev => [...prev, { round: p.round as number, avg: p.avg as number, passed: p.passed as number, total: p.total as number }]);
        break;
    }
  });

  // Coverage Logic
  const calculateCoverage = (tests: TestDefinition[]) => {
    // In a real app, we'd scan the DOM or source. Here we check selectors in manifest.
    const selectors = new Set<string>();
    tests.forEach(t => t.steps.forEach(s => s.selector && selectors.add(s.selector)));
    
    // Fetch real coverage from backend (scans data-qid in source)
    fetch('/api/test-runner/coverage')
      .then(r => r.json())
      .then(covData => {
        setCoverageData({
          total: covData.total,
          tested: covData.tested,
          untested: covData.untested.map((id: string) => `[data-qid="${id}"]`),
        });
      })
      .catch(() => {
        setCoverageData({ total: selectors.size, tested: selectors.size, untested: [] });
      });
  };

  // Actions
  const startRun = (tests?: string[], group?: string) => {
    fetch('/api/test-runner/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tests, group })
    });
  };

  const abortRun = () => fetch('/api/test-runner/abort', { method: 'POST' });

  const deleteTest = async (id: string) => {
    if (!confirm(`Delete test ${id}?`)) return;
    await fetch(`/api/test-runner/manifest/test/${id}`, { method: 'DELETE' });
    fetchManifest();
  };

  const saveTest = async (test: TestDefinition) => {
    await fetch('/api/test-runner/manifest/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(test)
    });
    setIsEditModalOpen(false);
    fetchManifest();
  };

  const openEditor = (test?: TestDefinition) => {
    setEditingTest(test || { id: '', label: '', group: 'sidebar', steps: [] });
    setIsEditModalOpen(true);
  };

  // Grouping
  const groupedManifest = useMemo(() => {
    if (!manifest) return {};
    return manifest.tests.reduce((acc, test) => {
      acc[test.group] = acc[test.group] || [];
      acc[test.group].push(test);
      return acc;
    }, {} as Record<string, TestDefinition[]>);
  }, [manifest]);

  if (!manifest) return <div className="flex items-center justify-center h-full bg-[#141414] text-dim font-mono animate-pulse">BOOTING_TEST_ENGINE...</div>;

  const stats = {
    total: manifest.tests.length,
    passed: Object.values(runResults).filter(r => r.status === 'PASSED').length,
    failed: Object.values(runResults).filter(r => r.status === 'FAILED').length,
  };

  return (
    <div className="flex h-full bg-[#141414] text-[#e2e8f0] font-sans overflow-hidden">

      {/* Manifest Selector (shared LeftPane) */}
      <LeftPane title="Testing" searchable>
        <LeftPaneSection title={`Manifests (${manifests.length || 1})`}>
          {manifests.length > 0 ? manifests.map(m => (
            <div key={m.file}
              onClick={() => setSelectedManifestFile(m.file)}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, file: m.file, name: m.name }) }}
              style={paneItemStyle(m.file === selectedManifestFile)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{m.name}</span>
                <span style={{ fontSize: 9, opacity: 0.5 }}>{m.testCount}</span>
              </div>
            </div>
          )) : (
            <div style={paneItemStyle(true)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>All Tests</span>
                <span style={{ fontSize: 9, opacity: 0.5 }}>{manifest?.tests.length ?? 0}</span>
              </div>
            </div>
          )}
        </LeftPaneSection>
        {manifest && (
          <LeftPaneSection title={`Groups (${Object.keys(groupedManifest).length})`}>
            {Object.entries(groupedManifest).map(([group, tests]) => {
              const passed = tests.filter(t => runResults[t.id]?.status === 'PASSED').length;
              const failed = tests.filter(t => runResults[t.id]?.status === 'FAILED').length;
              return (
                <div key={group}
                  onClick={() => setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }))}
                  style={{ ...paneItemStyle(false), display: 'flex', justifyContent: 'space-between', padding: '5px 16px' }}
                >
                  <span style={{ fontSize: 10 }}>{group}</span>
                  <span style={{ fontSize: 9, fontFamily: '"JetBrains Mono", monospace' }}>
                    {passed > 0 && <span style={{ color: '#00ff88' }}>{passed}</span>}
                    {failed > 0 && <span style={{ color: '#ff4444', marginLeft: 4 }}>{failed}</span>}
                    {passed === 0 && failed === 0 && <span style={{ opacity: 0.3 }}>{tests.length}</span>}
                  </span>
                </div>
              );
            })}
          </LeftPaneSection>
        )}
      </LeftPane>

      {/* Right-click context menu for manifests */}
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} items={[
          { label: 'Rename', onClick: async () => {
            const newName = prompt('New name:', ctxMenu.name);
            if (newName && newName !== ctxMenu.name) {
              await fetch(`/api/test-runner/manifests/${encodeURIComponent(ctxMenu.file)}/rename`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newName: newName.endsWith('.test.json') ? newName : newName + '.test.json' }),
              });
              fetchManifests();
            }
          }},
          { label: 'Duplicate', onClick: async () => {
            const newName = prompt('Duplicate as:', ctxMenu.name + '-copy');
            if (newName) {
              await fetch(`/api/test-runner/manifests/${encodeURIComponent(ctxMenu.file)}/duplicate`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newName: newName.endsWith('.test.json') ? newName : newName + '.test.json' }),
              });
              fetchManifests();
            }
          }},
          { label: 'Delete', danger: true, onClick: async () => {
            if (confirm(`Delete ${ctxMenu.name}?`)) {
              await fetch(`/api/test-runner/manifests/${encodeURIComponent(ctxMenu.file)}`, { method: 'DELETE' });
              if (selectedManifestFile === ctxMenu.file) setSelectedManifestFile('test-manifest.json');
              fetchManifests();
            }
          }},
        ]} />
      )}

      {/* Main Panel */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-white/5">
        
        {/* Toolbar */}
        <div className="flex items-center justify-between p-4 bg-[#111111] border-b border-white/10 shrink-0">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded border border-white/10">
              <Terminal size={14} className="text-[#7c3aed]" />
              <span className="text-[11px] font-black font-mono tracking-widest uppercase">TEST_RUNNER_V2</span>
            </div>
            
            <div className="flex gap-5 font-mono text-[11px]">
              <div className="flex flex-col">
                <span className="text-dim text-[9px] uppercase tracking-tighter">Total</span>
                <span className="text-white font-mono">{stats.total}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-dim text-[9px] uppercase tracking-tighter">Passed</span>
                <span className="text-[#00ff88] font-mono">{stats.passed}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-dim text-[9px] uppercase tracking-tighter">Failed</span>
                <span className="text-[#ff4444] font-mono">{stats.failed}</span>
              </div>
              {/* Round indicator for convergence loop */}
              {currentRound > 0 && (
                <div className="flex flex-col ml-4 pl-4 border-l border-white/10">
                  <span className="text-dim text-[9px] uppercase tracking-tighter">Round</span>
                  <div className="flex items-center gap-1.5">
                    {roundScores.map(rs => (
                      <div key={rs.round} className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold border ${
                        rs.avg >= 8 ? 'bg-green-500/20 border-green-500/50 text-green-400'
                        : rs.avg >= 5 ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                        : 'bg-red-500/20 border-red-500/50 text-red-400'
                      }`} title={`R${rs.round}: ${rs.avg.toFixed(1)}/10 (${rs.passed}/${rs.total} pass)`}>
                        {rs.round}
                      </div>
                    ))}
                    <span className="text-[10px] font-mono text-white/40 ml-1">
                      {roundScores.map(rs => rs.avg.toFixed(0)).join('→')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => openEditor()}
              className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded text-[11px] font-bold transition-all"
            >
              <Plus size={14} /> ADD TEST
            </button>
            {activeRunId ? (
              <button 
                onClick={abortRun}
                className="flex items-center gap-2 px-4 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded text-[11px] font-bold transition-all"
              >
                <StopCircle size={14} /> ABORT
              </button>
            ) : (
              <button 
                onClick={() => startRun()}
                className="flex items-center gap-2 px-4 py-1.5 bg-[#7c3aed]/20 hover:bg-[#7c3aed]/30 text-[#7c3aed] border border-[#7c3aed]/30 rounded text-[11px] font-bold transition-all shadow-[0_0_15px_rgba(124,58,237,0.15)]"
              >
                <Play size={14} fill="currentColor" /> RUN ALL
              </button>
            )}
          </div>
        </div>

        {/* Search + Scrollable Test List */}
        <div className="px-4 pt-3 pb-1 shrink-0">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded border border-white/10">
            <Search size={12} className="text-white/30" />
            <input
              value={testSearch}
              onChange={e => setTestSearch(e.target.value)}
              placeholder="Search tests by name, group, action..."
              className="flex-1 bg-transparent border-none outline-none text-white/80 text-[11px] font-mono placeholder:text-white/20"
            />
            {testSearch && <X size={12} className="text-white/30 cursor-pointer" onClick={() => setTestSearch('')} />}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {Object.entries(groupedManifest).filter(([groupName, tests]) => {
            if (!testSearch) return true;
            const q = testSearch.toLowerCase();
            return groupName.toLowerCase().includes(q) ||
              tests.some(t => t.label.toLowerCase().includes(q) || t.id.toLowerCase().includes(q) ||
                t.steps.some(s => s.action.toLowerCase().includes(q) || (s.text || '').toLowerCase().includes(q)))
          }).map(([groupName, tests]) => (
            <div key={groupName} className="space-y-2">
              <div className="flex items-center justify-between group/header bg-white/[0.02] p-2 rounded-md">
                <button 
                  onClick={() => setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }))}
                  className="flex items-center gap-2 text-left"
                >
                  <div className={`transition-transform duration-200 ${expandedGroups[groupName] ? 'rotate-90' : ''}`}>
                    <ChevronRight size={14} className="text-dim" />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] text-dim group-hover/header:text-white transition-colors">
                    {groupName} <span className="ml-2 text-[9px] font-mono opacity-50">({tests.length})</span>
                  </span>
                </button>
                <button 
                  onClick={() => startRun(undefined, groupName)}
                  disabled={!!activeRunId}
                  className="px-2 py-0.5 rounded text-[9px] font-black font-mono border border-white/10 hover:bg-white/5 text-dim hover:text-white transition-all disabled:opacity-30"
                >
                  RUN_GROUP
                </button>
              </div>

              {expandedGroups[groupName] && (
                <div className="space-y-2 pl-2">
                  {tests.map(test => {
                    const result = runResults[test.id];
                    const isExpanded = expandedTests[test.id];
                    
                    return (
                      <div 
                        key={test.id} 
                        className={`
                          group border rounded-md transition-all
                          ${result?.status === 'RUNNING' ? 'border-[#ffaa00]/40 bg-[#ffaa00]/5' : 'border-white/5 bg-[#1a1a1a] hover:border-white/20'}
                        `}
                      >
                        <div className="flex items-center justify-between p-2.5 cursor-pointer">
                          <div className="flex items-center gap-3 flex-1" onClick={() => setExpandedTests(prev => ({ ...prev, [test.id]: !prev[test.id] }))}>
                            <StatusIndicator status={result?.status || 'IDLE'} />
                            <div className="flex flex-col">
                              <span className="text-[13px] font-medium leading-tight">{test.label}</span>
                              <span className="text-[9px] font-mono text-dim tracking-tight">{test.id}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            {result?.durationMs && (
                              <div className="flex items-center gap-1 text-[10px] font-mono text-dim">
                                <Clock size={10} /> {result.durationMs}ms
                              </div>
                            )}
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={(e) => { e.stopPropagation(); openEditor(test); }} className="p-1.5 hover:bg-white/10 rounded text-dim hover:text-white">
                                <Edit3 size={14} />
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); deleteTest(test.id); }} className="p-1.5 hover:bg-white/10 rounded text-dim hover:text-red-400">
                                <Trash2 size={14} />
                              </button>
                              <div className="w-[1px] h-4 bg-white/10 mx-1" />
                              <button onClick={(e) => { e.stopPropagation(); startRun([test.id]); }} className="p-1.5 hover:bg-[#7c3aed]/20 rounded text-[#7c3aed]">
                                <Play size={14} fill="currentColor" />
                              </button>
                            </div>
                            <div onClick={() => setExpandedTests(prev => ({ ...prev, [test.id]: !prev[test.id] }))}>
                              {isExpanded ? <ChevronUp size={14} className="text-dim" /> : <ChevronDown size={14} className="text-dim" />}
                            </div>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-white/5 bg-[#0b1220]/40 overflow-hidden">
                            <table className="w-full text-left border-collapse table-fixed">
                              <thead className="text-[9px] font-black uppercase text-dim tracking-wider border-b border-white/5">
                                <tr>
                                  <th className="w-8 py-2 px-3">#</th>
                                  <th className="w-24 py-2 px-3">Action</th>
                                  <th className="py-2 px-3">Selector / Target</th>
                                  <th className="py-2 px-3">Expected</th>
                                  <th className="py-2 px-3">Actual</th>
                                  <th className="w-16 py-2 px-3">Img</th>
                                  <th className="w-20 py-2 px-3 text-right">Status</th>
                                </tr>
                              </thead>
                              <tbody className="font-mono text-[11px]">
                                {(result?.steps || test.steps).map((step: any, idx) => (
                                  <React.Fragment key={idx}>
                                    <tr className={`border-b border-white/[0.02] last:border-0 ${step.status === 'FAILED' ? 'bg-red-500/10' : ''}`}>
                                      <td className="py-2 px-3 text-dim opacity-40 font-mono">{idx + 1}</td>
                                      <td className="py-2 px-3">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                          step.action === 'visual_assert' ? 'bg-[#7c3aed]/20 text-[#7c3aed] border border-[#7c3aed]/30'
                                          : step.action === 'persona_review' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                          : 'bg-white/5 text-white/70'
                                        }`}>
                                          {step.action === 'visual_assert' ? '👁 visual' : step.action}
                                        </span>
                                      </td>
                                      <td className="py-2 px-3 truncate text-white/50" title={step.selector || step.url || step.hash}>
                                        {step.selector || step.url || step.hash || '—'}
                                      </td>
                                      <td className="py-2 px-3 truncate text-blue-300/60 max-w-[200px]" title={step.action === 'visual_assert' ? step.text : step.expected}>
                                        {step.action === 'visual_assert' && step.text
                                          ? step.text.substring(0, 50) + (step.text.length > 50 ? '…' : '')
                                          : step.expected || (step.action === 'assert' ? `${step.property || step.type} ${step.operator || ''} ${step.value || ''}` : '—')}
                                      </td>
                                      <td className="py-2 px-3 truncate text-[#00ff88]/60 max-w-[200px]" title={step.actual}>
                                        {step.action === 'persona_review' && step.score
                                          ? <span className="font-mono">{step.score}/10 <span className={step.verdict === 'PASS' ? 'text-green-400' : 'text-red-400'}>{step.verdict}</span></span>
                                          : (step.actual || '—')}
                                      </td>
                                      <td className="py-2 px-3">
                                        {step.screenshotUrl ? (
                                          <LightboxImage src={step.screenshotUrl} alt={step.name || 'screenshot'} thumbWidth={40} thumbHeight={40} />
                                        ) : '—'}
                                      </td>
                                      <td className="py-2 px-3 text-right">
                                        {step.action === 'persona_review' && step.score
                                          ? <span className={`font-mono text-[10px] font-bold ${step.score >= 8 ? 'text-green-400' : step.score >= 5 ? 'text-amber-400' : 'text-red-400'}`}>
                                              {step.score >= 8 ? 'PASS' : 'ITERATE'}
                                            </span>
                                          : <StepStatus status={step.status || 'PENDING'} />
                                        }
                                      </td>
                                    </tr>
                                    {/* Round history sub-row for persona_review steps */}
                                    {step.action === 'persona_review' && step.weaknesses && step.weaknesses.length > 0 && (
                                      <tr className="border-b border-white/[0.02]">
                                        <td colSpan={7} className="px-6 py-3 bg-white/[0.01]">
                                          <div className="flex flex-col gap-2">
                                            <div className="flex items-center gap-3">
                                              <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">Weaknesses</span>
                                              {step.priorWeaknesses && (
                                                <span className="text-[9px] text-amber-400/60">Prior round: {step.priorWeaknesses.length} items</span>
                                              )}
                                            </div>
                                            <div className="flex flex-col gap-1">
                                              {step.weaknesses.slice(0, 3).map((w: string, wi: number) => (
                                                <div key={wi} className="text-[10px] text-white/50 pl-2 border-l-2 border-red-500/30">
                                                  {w.slice(0, 120)}
                                                </div>
                                              ))}
                                            </div>
                                            {step.changes && step.changes.length > 0 && (
                                              <>
                                                <span className="text-[9px] font-bold uppercase tracking-widest text-white/30 mt-1">Changes Requested</span>
                                                {step.changes.slice(0, 2).map((c: string, ci: number) => (
                                                  <div key={ci} className="text-[10px] text-blue-300/50 pl-2 border-l-2 border-blue-500/30">
                                                    {c.slice(0, 120)}
                                                  </div>
                                                ))}
                                              </>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right Sidebar: Coverage & Analytics */}
      <div className="w-72 flex flex-col bg-[#111111] shrink-0">
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={16} className="text-[#00ff88]" />
            <h3 className="text-[11px] font-black uppercase tracking-widest">Analytics_Dashboard</h3>
          </div>

          {/* Coverage Badge */}
          <div className="relative p-6 bg-[#1a1a1a] border border-white/10 rounded-xl overflow-hidden mb-4">
            <div className="relative z-10 flex flex-col items-center">
              <span className="text-4xl font-black font-mono text-white tracking-tighter leading-none">
                {Math.round((coverageData.tested / coverageData.total) * 100)}%
              </span>
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#00ff88] mt-2">TOTAL_COVERAGE</span>
            </div>
            {/* Background decorative chart */}
            <div className="absolute inset-x-0 bottom-0 h-1 bg-[#00ff88]/20">
              <div 
                className="h-full bg-[#00ff88] shadow-[0_0_10px_#00ff88]" 
                style={{ width: `${(coverageData.tested / coverageData.total) * 100}%` }} 
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-6">
            <div className="p-2 bg-white/5 border border-white/10 rounded">
              <div className="text-[9px] text-dim font-bold uppercase mb-1">Elements</div>
              <div className="text-lg font-mono font-bold leading-none">{coverageData.total}</div>
            </div>
            <div className="p-2 bg-white/5 border border-white/10 rounded">
              <div className="text-[9px] text-dim font-bold uppercase mb-1">Tested</div>
              <div className="text-lg font-mono font-bold leading-none text-[#00ff88]">{coverageData.tested}</div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-dim">Untested_Targets</span>
              <span className="text-[9px] px-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded font-mono">
                {coverageData.untested.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {coverageData.untested.map(target => (
                <div key={target} className="group flex items-center justify-between p-2 rounded bg-black/40 border border-white/5 hover:border-white/20 transition-all cursor-crosshair">
                  <span className="text-[10px] font-mono text-dim group-hover:text-white transition-colors truncate">{target}</span>
                  <Plus size={12} className="text-dim group-hover:text-[#7c3aed] shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <div className="flex-1 p-4 bg-[#0a0a0a]">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={14} className="text-[#ffaa00]" />
            <span className="text-[10px] font-black uppercase tracking-widest text-dim">Run_Console</span>
          </div>
          <div className="font-mono text-[10px] space-y-2 opacity-50">
            <div>&gt; initialize engine... <span className="text-[#00ff88]">OK</span></div>
            <div>&gt; connecting bus... <span className="text-[#00ff88]">OK</span></div>
            <div>&gt; ready for command.</div>
            {activeRunId && <div className="text-[#ffaa00] animate-pulse">&gt; running_process: {activeRunId}</div>}
          </div>
        </div>
      </div>

      {/* Screenshot Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-12 animate-[fadeIn_150ms_ease-out]"
          style={{ backgroundColor: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(8px)' }}
          onClick={() => setSelectedImage(null)}
        >
          <button className="absolute top-6 right-6 p-2 text-white/50 hover:text-white z-10"><X size={24} /></button>
          <div
            className="relative max-w-full max-h-full border border-white/10 shadow-[0_0_40px_rgba(124,58,237,0.15)] rounded-lg overflow-hidden bg-[#111111] animate-[scaleIn_200ms_ease-out]"
            onClick={e => e.stopPropagation()}
          >
            <img src={selectedImage} className="max-w-full max-h-[80vh] block" />
            <div className="p-4 flex items-center justify-between bg-[#1a1a1a] border-t border-white/10">
              <div className="flex items-center gap-2">
                <ImageIcon size={16} className="text-[#7c3aed]" />
                <span className="text-xs font-mono font-bold">IMAGE_EVIDENCE_FULL_RESOLVE</span>
              </div>
              <div className="flex gap-2">
                <a href={selectedImage} download className="px-3 py-1 bg-white/5 rounded border border-white/10 text-[11px] font-bold hover:bg-white/10 no-underline text-white">DOWNLOAD</a>
                <button className="px-3 py-1 bg-white/5 rounded border border-white/10 text-[11px] font-bold hover:bg-white/10" onClick={() => setSelectedImage(null)}>CLOSE</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }
      `}</style>

      {/* Editor Modal / Slide-over */}
      {isEditModalOpen && editingTest && (
        <TestEditor 
          test={editingTest} 
          onSave={saveTest} 
          onCancel={() => setIsEditModalOpen(false)} 
        />
      )}
    </div>
  );
}

// --- Sub-components ---

function StatusIndicator({ status }: { status: string }) {
  switch (status) {
    case 'PASSED': return <div className="w-5 h-5 flex items-center justify-center rounded-full bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/20 shadow-[0_0_10px_rgba(0,255,136,0.2)]"><CheckCircle2 size={12} /></div>;
    case 'FAILED': return <div className="w-5 h-5 flex items-center justify-center rounded-full bg-[#ff4444]/10 text-[#ff4444] border border-[#ff4444]/20 shadow-[0_0_10px_rgba(255,68,68,0.2)]"><XCircle size={12} /></div>;
    case 'RUNNING': return <div className="w-5 h-5 flex items-center justify-center rounded-full bg-[#ffaa00]/10 text-[#ffaa00] border border-[#ffaa00]/20"><Loader2 size={12} className="animate-spin" /></div>;
    default: return <div className="w-5 h-5 rounded-full border border-white/10 bg-white/5" />;
  }
}

function StepStatus({ status }: { status: string }) {
  switch (status) {
    case 'PASSED': return <span className="text-[#00ff88] font-black">OK</span>;
    case 'FAILED': return <span className="text-[#ff4444] font-black">ERR</span>;
    case 'RUNNING': return <Loader2 size={12} className="animate-spin text-[#ffaa00] ml-auto" />;
    default: return <span className="text-dim opacity-30">---</span>;
  }
}

function TestEditor({ test, onSave, onCancel }: { test: TestDefinition, onSave: (t: TestDefinition) => void, onCancel: () => void }) {
  const [formData, setFormData] = useState<TestDefinition>({ ...test });

  const addStep = () => {
    const newStep: TestStep = { action: 'click', selector: '' };
    setFormData({ ...formData, steps: [...formData.steps, newStep] });
  };

  const updateStep = (idx: number, updates: Partial<TestStep>) => {
    const newSteps = [...formData.steps];
    newSteps[idx] = { ...newSteps[idx], ...updates };
    setFormData({ ...formData, steps: newSteps });
  };

  const removeStep = (idx: number) => {
    setFormData({ ...formData, steps: formData.steps.filter((_, i) => i !== idx) });
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/60 backdrop-blur-sm">
      <div className="w-[600px] h-full bg-[#111111] border-l border-white/10 flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="p-6 border-b border-white/10 flex items-center justify-between bg-[#1a1a1a]">
          <div className="flex items-center gap-3">
            <Edit3 size={18} className="text-[#7c3aed]" />
            <h2 className="text-lg font-black uppercase tracking-widest">{test.id ? 'Edit_Test' : 'Configure_New_Test'}</h2>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-white/5 rounded-full"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-dim">Test_ID (Immutable)</label>
              <input 
                value={formData.id} 
                onChange={e => setFormData({ ...formData, id: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                disabled={!!test.id}
                className="w-full bg-[#0b1220] border border-white/10 rounded px-3 py-2 font-mono text-sm focus:border-[#7c3aed] transition-colors disabled:opacity-50"
                placeholder="e.g. sidebar_collapse"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-dim">Group</label>
              <input 
                value={formData.group} 
                onChange={e => setFormData({ ...formData, group: e.target.value.toLowerCase() })}
                className="w-full bg-[#0b1220] border border-white/10 rounded px-3 py-2 font-mono text-sm focus:border-[#7c3aed] outline-none"
                placeholder="sidebar"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-dim">Display_Label</label>
            <input 
              value={formData.label} 
              onChange={e => setFormData({ ...formData, label: e.target.value })}
              className="w-full bg-[#0b1220] border border-white/10 rounded px-3 py-2 text-sm focus:border-[#7c3aed] outline-none"
              placeholder="Check if sidebar collapses correctly"
            />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-[#7c3aed]">Execution_Sequence</label>
              <button 
                onClick={addStep}
                className="flex items-center gap-1.5 px-2 py-1 bg-[#7c3aed]/10 text-[#7c3aed] rounded text-[10px] font-black border border-[#7c3aed]/20 hover:bg-[#7c3aed]/20 transition-all"
              >
                <Plus size={12} /> ADD_STEP
              </button>
            </div>

            <div className="space-y-3">
              {formData.steps.map((step, idx) => (
                <div key={idx} className="p-3 bg-white/5 border border-white/5 rounded-lg group/step relative">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-5 h-5 flex items-center justify-center rounded bg-black text-[10px] font-mono font-bold text-dim">{idx + 1}</span>
                    <select 
                      value={step.action} 
                      onChange={e => updateStep(idx, { action: e.target.value as StepAction })}
                      className="bg-black border border-white/10 rounded px-2 py-1 text-[11px] font-bold outline-none uppercase"
                    >
                      {['click', 'rightclick', 'type', 'clear', 'hover', 'drag', 'scroll', 'wait', 'navigate', 'screenshot', 'assert', 'evaluate'].map(a => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                    <button onClick={() => removeStep(idx)} className="ml-auto p-1 text-dim hover:text-red-400 opacity-0 group-hover/step:opacity-100 transition-opacity">
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Dynamic Fields based on Action */}
                    {(step.action !== 'navigate' && step.action !== 'wait' && step.action !== 'screenshot' && step.action !== 'evaluate') && (
                      <input 
                        placeholder="Selector (e.g. [data-qid='component:element'])"
                        value={step.selector || ''}
                        onChange={e => updateStep(idx, { selector: e.target.value })}
                        className="col-span-2 bg-[#0b1220] border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] outline-none"
                      />
                    )}

                    {step.action === 'type' && (
                      <input 
                        placeholder="Text to type"
                        value={step.text || ''}
                        onChange={e => updateStep(idx, { text: e.target.value })}
                        className="col-span-2 bg-[#0b1220] border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none"
                      />
                    )}

                    {step.action === 'wait' && (
                      <input 
                        type="number"
                        placeholder="Milliseconds"
                        value={step.ms || ''}
                        onChange={e => updateStep(idx, { ms: parseInt(e.target.value) })}
                        className="bg-[#0b1220] border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none"
                      />
                    )}

                    {step.action === 'navigate' && (
                      <input 
                        placeholder="URL or #hash"
                        value={step.url || step.hash || ''}
                        onChange={e => updateStep(idx, e.target.value.startsWith('#') ? { hash: e.target.value.substring(1) } : { url: e.target.value })}
                        className="col-span-2 bg-[#0b1220] border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none font-mono"
                      />
                    )}

                    {step.action === 'assert' && (
                      <>
                        <select 
                          value={step.type} 
                          onChange={e => updateStep(idx, { type: e.target.value as AssertType })}
                          className="bg-black border border-white/10 rounded px-2 py-1 text-[11px] outline-none"
                        >
                          {['exists', 'not_exists', 'visible', 'text_contains', 'count', 'style', 'moved'].map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                        {(step.type === 'count' || step.type === 'style') && (
                          <>
                            <select 
                              value={step.operator} 
                              onChange={e => updateStep(idx, { operator: e.target.value as Operator })}
                              className="bg-black border border-white/10 rounded px-2 py-1 text-[11px] outline-none"
                            >
                              {['eq', 'gt', 'lt', 'gte', 'lte', 'contains'].map(o => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                            <input 
                              placeholder="Value"
                              value={step.value || ''}
                              onChange={e => updateStep(idx, { value: e.target.value })}
                              className="bg-[#0b1220] border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none font-mono"
                            />
                            {step.type === 'style' && (
                              <input 
                                placeholder="CSS Property"
                                value={step.property || ''}
                                onChange={e => updateStep(idx, { property: e.target.value })}
                                className="bg-[#0b1220] border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none font-mono"
                              />
                            )}
                          </>
                        )}
                        {step.type === 'text_contains' && (
                          <input 
                            placeholder="Search text..."
                            value={step.text || ''}
                            onChange={e => updateStep(idx, { text: e.target.value })}
                            className="bg-[#0b1220] border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none"
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              
              {formData.steps.length === 0 && (
                <div className="flex flex-col items-center justify-center p-8 border border-dashed border-white/10 rounded-lg text-dim">
                  <Activity size={24} className="mb-2 opacity-20" />
                  <span className="text-[10px] font-black uppercase tracking-widest">No_Steps_Defined</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-white/10 bg-[#1a1a1a] flex gap-3">
          <button 
            onClick={() => onSave(formData)}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#7c3aed] text-white rounded font-black text-xs uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(124,58,237,0.3)] hover:translate-y-[-1px] transition-all"
          >
            <Save size={14} /> COMMIT_MANIFEST
          </button>
          <button 
            onClick={onCancel}
            className="px-6 py-3 border border-white/10 text-dim font-black text-xs uppercase tracking-[0.2em] hover:bg-white/5 transition-all"
          >
            ABORT
          </button>
        </div>
      </div>
    </div>
  );
}
