/**
 * Lean4LemmaView — Formal verification compliance viewer.
 *
 * NOT for writing proofs — for reviewing autonomous proof results, running
 * what-if compliance cascades, and presenting evidence to CMMC auditors.
 *
 * Features:
 * 1. What-if cascade: toggle proved→sorry, watch downstream controls break
 * 2. Compliance impact summary: "changing X breaks N CMMC controls"
 * 3. Evidence tier badges: formal proof vs test vs attestation
 * 4. Live proof status: lean4-prove :8604 compilation progress
 * 5. Requirement change workflow: edit → cascade → re-prove
 * 6. Contextual suggested queries
 *
 * Shared components: GraphExplorer (via LemmaGraph), LeftPane, EmbryStyle, ChatMessage
 */
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { EMBRY, card, heading, label, glowDot } from "../common/EmbryStyle";
import { LeftPane, LeftPaneSection, paneItemStyle, useLeftPaneSearch } from "../common/LeftPane";
import { LemmaGraph } from "../sparta/lemma-graph/LemmaGraph";
import type { GraphNode, GraphEdge } from "../sparta/lemma-graph/LemmaGraph";
import { ProofDetail } from "./ProofDetail";
import { useLean4Data } from "./useLean4Data";
import type { ChatMessage } from "../shared-chat";

const API = "http://localhost:3001";
const LEAN4_SERVICE = "http://localhost:8604";

// ── Evidence tiers ──────────────────────────────────────────────────────

type EvidenceTier = 'formal' | 'test' | 'attestation' | 'none'
const TIER_LABELS: Record<EvidenceTier, string> = { formal: 'Formal Proof', test: 'Automated Test', attestation: 'Self-Attestation', none: 'No Evidence' }
const TIER_COLORS: Record<EvidenceTier, string> = { formal: '#00ff88', test: '#4a9eff', attestation: '#FF9800', none: '#ef4444' }

function getEvidenceTier(proof: { lean_code?: string } | null): EvidenceTier {
  if (!proof) return 'none'
  if (proof.lean_code?.includes('sorry')) return 'attestation'
  if (proof.lean_code?.includes('trivial') || proof.lean_code?.includes('True')) return 'test'
  return 'formal'
}

// ── Component ───────────────────────────────────────────────────────────

export function Lean4LemmaView() {
  const data = useLean4Data();
  const [selectedProofKey, setSelectedProofKey] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<"proof" | "chat" | "cascade">("proof");
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // ── What-if cascade state ───────────────────────────────────────────
  const [whatIfActive, setWhatIfActive] = useState(false);
  const [forcedSorry, setForcedSorry] = useState<Set<string>>(new Set());
  const [liveProofStatus, setLiveProofStatus] = useState<Record<string, string>>({});

  const { query: lpQuery, setQuery: setLpQuery, matches: lpMatches } = useLeftPaneSearch(
    data.proofs.map((p) => ({ id: p._key, label: p.theorem_name, searchText: `${p.theorem_name} ${p.problem_description ?? ""} ${(p.tactics ?? []).join(" ")}` })),
  );

  const selectedProof = data.proofs.find((p) => p._key === selectedProofKey) ?? null;

  // ── What-if BFS cascade computation ─────────────────────────────────
  const cascadeResult = useMemo(() => {
    if (!whatIfActive || forcedSorry.size === 0) return { cascaded: new Set<string>(), impactedControls: [] as string[] }
    const cascaded = new Set<string>()
    const queue = [...forcedSorry]
    const visited = new Set<string>(forcedSorry)
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const edge of data.graphEdges) {
        const src = typeof edge.source === 'string' ? edge.source : edge.source
        const tgt = typeof edge.target === 'string' ? edge.target : edge.target
        if (src === current && !visited.has(tgt)) {
          visited.add(tgt)
          cascaded.add(tgt)
          queue.push(tgt)
        }
      }
    }
    // Find impacted SPARTA controls (nodes that are requirements, not proofs)
    const impactedControls = [...cascaded].filter(id => id.includes('sparta_controls') || id.includes('ctrl_'))
    return { cascaded, impactedControls }
  }, [whatIfActive, forcedSorry, data.graphEdges])

  // ── Modify graph nodes for what-if visualization ────────────────────
  const displayNodes: GraphNode[] = useMemo(() => {
    if (!whatIfActive) return data.graphNodes
    return data.graphNodes.map(n => {
      if (forcedSorry.has(n.id)) return { ...n, proofStatus: 'sorry' as const, confidence: 0 }
      if (cascadeResult.cascaded.has(n.id)) return { ...n, proofStatus: 'partial' as const, confidence: 0.2 }
      return n
    })
  }, [data.graphNodes, whatIfActive, forcedSorry, cascadeResult])

  // ── Graph node click (what-if mode toggles sorry, normal mode selects) ──
  const handleNodeClick = useCallback((node: GraphNode) => {
    if (whatIfActive) {
      setForcedSorry(prev => {
        const next = new Set(prev)
        if (next.has(node.id)) next.delete(node.id)
        else next.add(node.id)
        return next
      })
      return
    }
    const proof = data.proofs.find(p => p._id === node.id || p._key === node.id.split("/").pop());
    if (proof) { setSelectedProofKey(proof._key); setDetailTab("proof") }
  }, [data.proofs, whatIfActive]);

  // ── Live proof status polling ───────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${LEAN4_SERVICE}/status`, { signal: AbortSignal.timeout(2000) })
        if (res.ok) {
          const status = await res.json()
          setLiveProofStatus(status.active_proofs ?? {})
        }
      } catch { /* service may not be running */ }
    }
    poll()
    const interval = setInterval(poll, 10000)
    return () => clearInterval(interval)
  }, [])

  // ── Chat submit ─────────────────────────────────────────────────────
  const handleChatSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;
    const userMsg: ChatMessage = { role: "user", content: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput(""); setChatLoading(true);
    try {
      const cascadeCtx = whatIfActive && forcedSorry.size > 0
        ? `\nWHAT-IF ACTIVE: ${forcedSorry.size} lemmas forced to sorry, ${cascadeResult.cascaded.size} downstream affected, ${cascadeResult.impactedControls.length} controls impacted`
        : ''
      const context = selectedProof
        ? `Theorem: ${selectedProof.theorem_name}\nEvidence Tier: ${TIER_LABELS[getEvidenceTier(selectedProof)]}\nTactics: ${(selectedProof.tactics ?? []).join(", ")}\nCode:\n${selectedProof.lean_code?.slice(0, 500)}${cascadeCtx}`
        : `Lean4 proof library: ${data.stats.totalProofs} proofs, ${data.stats.compiledCount} compiled, ${data.stats.sorryCount} sorry. Evidence tiers: ${data.stats.compiledCount} formal, ${data.stats.sorryCount} attestation-level.${cascadeCtx}`
      const res = await fetch("http://localhost:4001/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer sk-dev-proxy-123" },
        body: JSON.stringify({
          model: "text",
          messages: [
            { role: "system", content: `You are a formal verification compliance analyst. Help the user understand proof soundness, compliance cascades, and CMMC/NIST control verification. When discussing what-if analysis, explain which controls lose formal assurance and why. Be concise.\n\nContext:\n${context}` },
            ...chatMessages.slice(-6).map(m => ({ role: m.role, content: m.content })),
            { role: "user", content: chatInput },
          ],
          temperature: 0.3, max_tokens: 600,
        }),
      });
      const json = await res.json();
      setChatMessages(prev => [...prev, { role: "assistant", content: json.choices?.[0]?.message?.content ?? "No response" }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: "assistant", content: `Error: ${String(err)}` }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" }), 100);
    }
  }, [chatInput, chatLoading, chatMessages, selectedProof, data.stats, whatIfActive, forcedSorry, cascadeResult]);

  // ── Trigger re-prove ────────────────────────────────────────────────
  const triggerReprove = useCallback(async (theoremName: string) => {
    const proof = data.proofs.find(p => p.theorem_name === theoremName)
    if (!proof) return
    setChatMessages(prev => [...prev, { role: "assistant", content: `🔄 Triggering autonomous re-proof of **${theoremName}**...` }])
    try {
      const res = await fetch(`${LEAN4_SERVICE}/prove`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement: proof.problem_description, tactics: proof.tactics, model: "text", max_retries: 3 }),
      })
      const result = await res.json()
      setChatMessages(prev => [...prev, { role: "assistant", content: result.success ? `✅ **${theoremName}** re-proved successfully. Tactics: ${result.tactics?.join(', ')}` : `❌ Re-proof failed: ${result.error ?? 'Unknown error'}. ${result.attempts ?? 0} attempts.` }])
    } catch (err) {
      setChatMessages(prev => [...prev, { role: "assistant", content: `❌ lean4-prove service unavailable: ${String(err)}` }])
    }
  }, [data.proofs])

  // ── Suggested queries (context-aware) ───────────────────────────────
  const suggestedQueries = useMemo(() => {
    if (whatIfActive && forcedSorry.size > 0) return [
      `What CMMC controls are affected by this cascade?`,
      `Which of the ${cascadeResult.cascaded.size} tainted lemmas are most critical?`,
      `What is the fastest path to re-establish formal compliance?`,
      `Generate a compliance impact report for the auditor`,
    ]
    if (selectedProof) {
      const tier = getEvidenceTier(selectedProof)
      return [
        `Explain the tactics used in ${selectedProof.theorem_name}`,
        `What NIST controls does this proof satisfy?`,
        tier === 'formal' ? `What would break if this proof's assumptions changed?` : `Why does this proof have sorry gaps?`,
        `What Mathlib lemmas does ${selectedProof.theorem_name} depend on?`,
        tier !== 'formal' ? `Re-prove ${selectedProof.theorem_name} autonomously` : `Trace the dependency chain of this proof`,
      ]
    }
    return [
      `What percentage of CMMC Level 3 controls have formal proofs?`,
      `Which proofs use sorry? What requirements are at risk?`,
      `Run a what-if analysis: what breaks if network segmentation proof fails?`,
      `Show me the weakest evidence tiers in our compliance posture`,
      `Explain the difference between formal proof and self-attestation evidence`,
      `Which tactics are most commonly used across all proofs?`,
    ]
  }, [selectedProof, whatIfActive, forcedSorry, cascadeResult])

  if (data.loading) return <div style={{ padding: 40, color: EMBRY.muted, fontSize: 12 }}>Loading Lean4 proofs from ArangoDB...</div>
  if (data.error) return <div style={{ padding: 40, color: EMBRY.red, fontSize: 12 }}>Error: {data.error}</div>

  return (
    <div style={{ display: "flex", height: "100%", background: EMBRY.bgDeep, color: EMBRY.white, fontFamily: "JetBrains Mono, monospace" }}>
      {/* Left Pane */}
      <LeftPane search={lpQuery} onSearchChange={setLpQuery} searchPlaceholder="Filter theorems...">
        <LeftPaneSection title={`Proofs (${data.proofs.length})`} defaultOpen>
          {(lpMatches.length > 0 ? lpMatches : data.proofs).slice(0, 100).map((p) => {
            const proof = "theorem_name" in p ? p : data.proofs.find(pr => pr._key === p.id);
            if (!proof || !("theorem_name" in proof)) return null;
            const isSelected = proof._key === selectedProofKey;
            const tier = getEvidenceTier(proof);
            const isForced = forcedSorry.has(proof._id ?? `lean4_proofs/${proof._key}`);
            return (
              <div key={proof._key} data-qid={`lean4-proof-${proof._key} data-qs-action="SELECT_PROOF"`} onClick={() => { setSelectedProofKey(proof._key); setDetailTab("proof") }}
                style={{ ...paneItemStyle, background: isSelected ? `${EMBRY.accent}15` : isForced ? '#dc262615' : 'transparent', borderLeft: isSelected ? `2px solid ${EMBRY.accent}` : isForced ? '2px solid #ef4444' : '2px solid transparent' }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={glowDot(TIER_COLORS[tier], 5)} />
                  <span style={{ fontSize: 10, color: isSelected ? EMBRY.white : EMBRY.dim, flex: 1 }}>
                    {proof.theorem_name.length > 22 ? `${proof.theorem_name.slice(0, 20)}…` : proof.theorem_name}
                  </span>
                  <span style={{ fontSize: 7, color: TIER_COLORS[tier], opacity: 0.7 }}>{tier === 'formal' ? 'T1' : tier === 'test' ? 'T2' : tier === 'attestation' ? 'T3' : '—'}</span>
                </div>
              </div>
            );
          })}
        </LeftPaneSection>
        <LeftPaneSection title="Evidence Tiers">
          <div style={{ padding: "4px 8px", fontSize: 9 }}>
            {(['formal', 'test', 'attestation', 'none'] as EvidenceTier[]).map(tier => {
              const count = data.proofs.filter(p => getEvidenceTier(p) === tier).length
              if (count === 0) return null
              return <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                <div style={glowDot(TIER_COLORS[tier], 4)} />
                <span style={{ color: TIER_COLORS[tier] }}>{count}</span>
                <span style={{ color: EMBRY.dim }}>{TIER_LABELS[tier]}</span>
              </div>
            })}
          </div>
        </LeftPaneSection>
        <LeftPaneSection title="Live Status">
          <div style={{ padding: "4px 8px", fontSize: 9, color: EMBRY.dim }}>
            {Object.keys(liveProofStatus).length > 0
              ? Object.entries(liveProofStatus).map(([k, v]) => <div key={k} style={{ color: EMBRY.accent }}>⟳ {k}: {v}</div>)
              : <div>No active compilations</div>}
          </div>
        </LeftPaneSection>
      </LeftPane>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* What-If toolbar */}
        <div style={{ padding: '6px 12px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 10, fontSize: 10 }}>
          <button data-qid="lean4-whatif-toggle" data-qs-action="TOGGLE_WHATIF" onClick={() => { setWhatIfActive(!whatIfActive); if (whatIfActive) { setForcedSorry(new Set()); } }}
            style={{ padding: '3px 10px', fontSize: 9, fontWeight: 700, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase',
              border: `1px solid ${whatIfActive ? '#ef4444' : EMBRY.border}`, background: whatIfActive ? '#ef444422' : 'transparent',
              color: whatIfActive ? '#ef4444' : EMBRY.muted, borderRadius: 4 }}>
            {whatIfActive ? '⚠ WHAT-IF ACTIVE' : 'What-If Analysis'}
          </button>
          {whatIfActive && <>
            <span style={{ color: EMBRY.dim }}>{forcedSorry.size} forced sorry</span>
            <span style={{ color: '#ef4444' }}>{cascadeResult.cascaded.size} cascaded</span>
            {cascadeResult.impactedControls.length > 0 && <span style={{ color: '#FF9800', fontWeight: 700 }}>{cascadeResult.impactedControls.length} controls impacted</span>}
            <button data-qid="lean4-whatif-reset" data-qs-action="RESET_WHATIF" onClick={() => setForcedSorry(new Set())} style={{ padding: '2px 8px', fontSize: 8, cursor: 'pointer', border: `1px solid ${EMBRY.border}`, background: 'transparent', color: EMBRY.dim, borderRadius: 2 }}>Reset</button>
            <button data-qid="lean4-impact-report" data-qs-action="SHOW_IMPACT_REPORT" onClick={() => setDetailTab('cascade')} style={{ padding: '2px 8px', fontSize: 8, cursor: 'pointer', border: `1px solid #FF9800`, background: '#FF980015', color: '#FF9800', borderRadius: 2 }}>Impact Report</button>
          </>}
          {whatIfActive && <span style={{ fontSize: 8, color: EMBRY.dim, marginLeft: 'auto' }}>Click graph nodes to toggle sorry</span>}
        </div>

        {/* Graph */}
        <div style={{ flex: "1 1 50%", minHeight: 200 }}>
          <LemmaGraph nodes={displayNodes} edges={data.graphEdges} onNodeClick={handleNodeClick} />
        </div>

        {/* Detail/Chat/Cascade tabs */}
        <div style={{ flex: "1 1 50%", borderTop: `1px solid ${EMBRY.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex", borderBottom: `1px solid ${EMBRY.border}`, fontSize: 10 }}>
            {(["proof", "chat", "cascade"] as const).map(tab => (
              <button key={tab} data-qid={`lean4-tab-${tab} data-qs-action="SET_TAB"`} onClick={() => setDetailTab(tab)}
                style={{ padding: "6px 16px", cursor: "pointer", border: "none", borderBottom: detailTab === tab ? `2px solid ${EMBRY.accent}` : "2px solid transparent", background: "transparent", color: detailTab === tab ? EMBRY.white : EMBRY.dim, fontWeight: detailTab === tab ? 700 : 400, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase" }}>
                {tab === 'cascade' ? `Impact (${cascadeResult.impactedControls.length})` : tab === 'proof' ? 'Proof Detail' : 'Chat'}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: "auto" }}>
            {detailTab === "proof" && <ProofDetail proof={selectedProof} onTacticClick={t => { setChatInput(`What does the ${t} tactic do in Lean4?`); setDetailTab("chat") }} />}

            {detailTab === "cascade" && (
              <div style={{ padding: 16 }}>
                <div style={heading}>Compliance Impact Analysis</div>
                {forcedSorry.size === 0
                  ? <div style={{ color: EMBRY.muted, fontSize: 11, marginTop: 8 }}>Enable What-If mode and click graph nodes to force them to sorry. The cascade shows downstream impact.</div>
                  : <>
                    <div style={{ ...label, marginTop: 8, marginBottom: 12 }}>
                      {forcedSorry.size} lemma{forcedSorry.size > 1 ? 's' : ''} forced to sorry → {cascadeResult.cascaded.size} downstream tainted → {cascadeResult.impactedControls.length} controls lose formal assurance
                    </div>
                    {/* Forced sorry lemmas */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', marginBottom: 4 }}>FORCED SORRY ({forcedSorry.size})</div>
                      {[...forcedSorry].map(id => {
                        const node = data.graphNodes.find(n => n.id === id)
                        return <div key={id} style={{ fontSize: 10, color: '#ef4444', padding: '2px 6px', background: '#ef444410', borderRadius: 2, marginBottom: 2 }}>⚠ {node?.label ?? id.split('/').pop()}</div>
                      })}
                    </div>
                    {/* Cascaded tainted */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: EMBRY.amber, textTransform: 'uppercase', marginBottom: 4 }}>CASCADED TAINT ({cascadeResult.cascaded.size})</div>
                      {[...cascadeResult.cascaded].slice(0, 20).map(id => {
                        const node = data.graphNodes.find(n => n.id === id)
                        return <div key={id} style={{ fontSize: 9, color: EMBRY.amber, padding: '2px 6px', marginBottom: 1 }}>◧ {node?.label ?? id.split('/').pop()}</div>
                      })}
                      {cascadeResult.cascaded.size > 20 && <div style={{ fontSize: 8, color: EMBRY.dim }}>...and {cascadeResult.cascaded.size - 20} more</div>}
                    </div>
                    {/* Impacted controls */}
                    {cascadeResult.impactedControls.length > 0 && <div>
                      <div style={{ fontSize: 8, fontWeight: 700, color: '#FF9800', textTransform: 'uppercase', marginBottom: 4 }}>CMMC CONTROLS IMPACTED ({cascadeResult.impactedControls.length})</div>
                      {cascadeResult.impactedControls.map(id => (
                        <div key={id} style={{ fontSize: 10, color: '#FF9800', padding: '3px 8px', background: '#FF980010', border: '1px solid #FF980033', borderRadius: 3, marginBottom: 3 }}>
                          🛡️ {id.split('/').pop()?.replace('ctrl__', '')} — evidence downgraded from Tier 1 (Formal) to Tier 3 (Attestation)
                        </div>
                      ))}
                    </div>}
                    {/* Re-prove button */}
                    <button data-qid="lean4-reprove-all" data-qs-action="REPROVE_ALL" onClick={() => {
                      [...forcedSorry].forEach(id => { const n = data.graphNodes.find(n => n.id === id); if (n) triggerReprove(n.label) })
                      setDetailTab('chat')
                    }} style={{ marginTop: 12, padding: '6px 16px', fontSize: 10, fontWeight: 700, cursor: 'pointer', border: `1px solid ${EMBRY.accent}`, background: `${EMBRY.accent}15`, color: EMBRY.accent, borderRadius: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                      🔄 Trigger Autonomous Re-Proof ({forcedSorry.size} lemmas)
                    </button>
                  </>}
              </div>
            )}

            {detailTab === "chat" && (
              <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                <div ref={chatScrollRef} style={{ flex: 1, overflow: "auto", padding: 10 }}>
                  {chatMessages.length === 0 && (
                    <div style={{ padding: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 900, color: EMBRY.white, marginBottom: 4 }}>LEAN4 COMPLIANCE ANALYST</div>
                      <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 12 }}>
                        {data.stats.totalProofs} proofs · {data.stats.compiledCount} compiled · {data.stats.sorryCount} sorry gaps
                      </div>
                      <div style={{ fontSize: 8, color: EMBRY.dim, marginBottom: 6, fontWeight: 800 }}>SUGGESTED QUERIES <span style={{ fontWeight: 400, opacity: 0.6 }}>— click to ask</span></div>
                      {suggestedQueries.map((q, i) => (
                        <div key={i} data-qid={`lean4-suggest-${i} data-qs-action="SUBMIT_QUERY"`} role="button" tabIndex={0}
                          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.click() }}
                          onClick={() => { setChatInput(q); setTimeout(() => { const form = document.querySelector('#lean4-chat-input')?.closest('form'); if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }, 100) }}
                          style={{ fontSize: 10, color: EMBRY.accent, padding: '5px 10px', background: `${EMBRY.accent}08`, border: `1px solid ${EMBRY.accent}22`, borderRadius: 4, cursor: 'pointer', marginBottom: 4, transition: 'background 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = `${EMBRY.accent}18`)} onMouseLeave={e => (e.currentTarget.style.background = `${EMBRY.accent}08`)}>
                          <span style={{ marginRight: 4, fontSize: 12 }}>→</span>{q}
                        </div>
                      ))}
                    </div>
                  )}
                  {chatMessages.map((m, i) => (
                    <div key={i} style={{ marginBottom: 10, padding: "6px 10px", borderRadius: 6, background: m.role === "user" ? `${EMBRY.accent}10` : "#0a0a0a", border: `1px solid ${m.role === "user" ? `${EMBRY.accent}22` : EMBRY.border}`, fontSize: 11, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      <div style={{ fontSize: 8, color: EMBRY.dim, marginBottom: 4, fontWeight: 700 }}>{m.role === "user" ? "YOU" : "COMPLIANCE ANALYST"}</div>
                      {m.content}
                    </div>
                  ))}
                  {chatLoading && <div style={{ fontSize: 10, color: EMBRY.accent, padding: 6 }}>Analyzing...</div>}
                </div>
                <form data-qid="lean4-chat-form" data-qs-action="SUBMIT_CHAT" onSubmit={handleChatSubmit} style={{ padding: "6px 10px", borderTop: `1px solid ${EMBRY.border}`, display: "flex", gap: 6 }}>
                  <input data-qid="lean4-chat-input" data-qs-action="CHAT_INPUT" id="lean4-chat-input" value={chatInput} onChange={e => setChatInput(e.target.value)}
                    placeholder="Ask about proofs, compliance, cascades..."
                    style={{ flex: 1, background: "#0a0a0a", border: `1px solid ${EMBRY.border}`, borderRadius: 4, padding: "5px 8px", color: EMBRY.white, fontSize: 10, fontFamily: "JetBrains Mono, monospace", outline: "none" }} />
                  <button data-qid="lean4-chat-submit" data-qs-action="SUBMIT_CHAT" type="submit" disabled={chatLoading} style={{ padding: "5px 12px", background: EMBRY.accent, border: "none", borderRadius: 4, color: "#000", fontSize: 10, fontWeight: 700, cursor: chatLoading ? "wait" : "pointer" }}>Ask</button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
