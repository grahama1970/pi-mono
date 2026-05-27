import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, Copy, CopyPlus, GitBranch, Maximize2, Play, Save, Trash2, X } from "lucide-react";
import { EMBRY } from "../../common/EmbryStyle";
import type { ExecEvent, ExecGraph, ExecGraphNode, ExecStatus } from "./ScillmExecGraphDebugger";

type EditorView = "form" | "json";

type FormState = {
  id: string;
  type: string;
  displayLabel: string;
  nodeGoal: string;
  dependsOn: string[];
  model: string;
  command: string;
};

type GraphFormState = {
  graphId: string;
  graphGoal: string;
  cwd: string;
  maxConcurrency: string;
};

type TextModalState = {
  field: "graphGoal" | "nodeGoal" | "command";
  title: string;
  value: string;
  mono: boolean;
} | null;

const groupLabels: Record<string, string> = {
  "01_define_contract": "1. Define Contract",
  "02_parallel_model_review": "2. Parallel Model Review",
  "03_build_merge_prompt": "3. Build Merge Prompt",
  "04_merge_outputs": "4. Merge Findings",
};

const groupModes: Record<string, string> = {
  "01_define_contract": "Sequential gate",
  "02_parallel_model_review": "Concurrent group - nodes may run together",
  "03_build_merge_prompt": "Sequential gate",
  "04_merge_outputs": "Sequential gate",
};

const styles = {
  shell: {
    display: "grid",
    gridTemplateColumns: "minmax(580px, 1fr) minmax(390px, 34%)",
    minHeight: 720,
    background: EMBRY.bgPanel,
  },
  canvas: {
    minWidth: 0,
    padding: 16,
    borderRight: `1px solid ${EMBRY.border}`,
    overflow: "auto",
  },
  inspector: {
    minWidth: 0,
    display: "grid",
    gridTemplateRows: "auto auto minmax(0, 1fr) auto",
    background: EMBRY.bgDeep,
    overflow: "hidden",
  },
  label: {
    color: EMBRY.blue,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    marginBottom: 9,
  },
  card: {
    border: `1px solid ${EMBRY.border}`,
    borderRadius: 8,
    background: EMBRY.bgCard,
  },
  codeWell: {
    marginTop: 10,
    maxHeight: 210,
    overflow: "auto",
    background: EMBRY.bgDeep,
    borderRadius: 8,
    padding: 10,
    fontFamily: "SFMono-Regular, Consolas, monospace",
    fontSize: 12,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap" as const,
  },
  button: {
    border: `1px solid ${EMBRY.border}`,
    background: EMBRY.bgCard,
    color: EMBRY.white,
    borderRadius: 7,
    padding: "8px 11px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    cursor: "pointer",
    font: "inherit",
  },
  primaryButton: {
    border: `1px solid ${EMBRY.blue}`,
    background: `${EMBRY.blue}22`,
    color: "#bfdbfe",
    borderRadius: 7,
    padding: "8px 11px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    cursor: "pointer",
    font: "inherit",
    fontWeight: 750,
  },
  iconButton: {
    width: 30,
    height: 30,
    padding: 0,
    border: `1px solid ${EMBRY.border}`,
    background: `${EMBRY.blue}14`,
    color: "#bfdbfe",
    borderRadius: 7,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
};

export function DagContractEditor({
  graph,
  status,
  events,
  baseGraphHash,
  availableModels,
  onRunGraph,
  onDraftGraphChange,
  runGraphDisabled,
  runGraphLabel,
}: {
  graph: ExecGraph;
  status: ExecStatus;
  events: ExecEvent[];
  baseGraphHash: string;
  availableModels: string[];
  onRunGraph: (graph: ExecGraph) => void;
  onDraftGraphChange?: (graph: ExecGraph) => Promise<void> | void;
  runGraphDisabled?: boolean;
  runGraphLabel?: string;
}) {
  const [draftGraph, setDraftGraph] = useState<ExecGraph>(() => cloneGraph(graph));
  const [selectedNodeId, setSelectedNodeId] = useState(() => graph.nodes[0]?.id ?? "");
  const [view, setView] = useState<EditorView>("form");
  const [form, setForm] = useState<FormState>(() => nodeToForm(graph.nodes[0]));
  const [graphForm, setGraphForm] = useState<GraphFormState>(() => graphToForm(graph));
  const [jsonText, setJsonText] = useState(() => JSON.stringify(nodeWithRuntime(graph.nodes[0], status), null, 2));
  const [validation, setValidation] = useState({ tone: "idle", text: "Select a node to edit its contract.", dirty: false });
  const [modal, setModal] = useState<TextModalState>(null);

  useEffect(() => {
    const nextGraph = cloneGraph(graph);
    setDraftGraph(nextGraph);
    const nextSelected = nextGraph.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : nextGraph.nodes[0]?.id ?? "";
    setSelectedNodeId(nextSelected);
    const node = nextGraph.nodes.find((candidate) => candidate.id === nextSelected) ?? nextGraph.nodes[0];
    setForm(nodeToForm(node));
    setGraphForm(graphToForm(nextGraph));
    setJsonText(JSON.stringify(nodeWithRuntime(node, status), null, 2));
    setValidation({ tone: "idle", text: "Selected node JSON is loaded.", dirty: false });
  }, [graph.graph_id, status.run_id]);

  const selectedNode = useMemo(() => draftGraph.nodes.find((node) => node.id === selectedNodeId) ?? draftGraph.nodes[0], [draftGraph, selectedNodeId]);
  const modelOptions = useMemo(() => {
    const values = new Set(availableModels);
    if (form.model) values.add(form.model);
    return [...values].filter(Boolean).sort();
  }, [availableModels, form.model]);

  const graphHeader = useMemo(() => ({
    exec_graph_version: draftGraph.exec_graph_version,
    graph_id: draftGraph.graph_id,
    graph_goal: draftGraph.graph_goal,
    cwd: draftGraph.cwd,
    max_concurrency: draftGraph.max_concurrency,
    base_graph_hash: baseGraphHash,
    runtime: {
      run_id: status.run_id,
      state: status.state ?? "draft",
      running_nodes: status.running_node_ids ?? [],
      event_count: events.length,
    },
  }), [baseGraphHash, draftGraph, events.length, status]);

  function selectNode(id: string) {
    const node = draftGraph.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    setSelectedNodeId(id);
    setForm(nodeToForm(node));
    setJsonText(JSON.stringify(nodeWithRuntime(node, status), null, 2));
    setValidation({ tone: "idle", text: "Selected node JSON is loaded.", dirty: false });
  }

  function markDirty(text = "Draft values changed. Validate or apply before running.") {
    setValidation({ tone: "idle", text, dirty: true });
  }

  function validateForm() {
    if (!selectedNode) return null;
    const next = formToNode(form, selectedNode);
    return validateNode(next, selectedNodeId, draftGraph);
  }

  function validateJson() {
    try {
      const parsed = JSON.parse(jsonText);
      const next = { ...parsed };
      delete next.runtime;
      return validateNode(next, selectedNodeId, draftGraph);
    } catch (error) {
      setValidation({ tone: "error", text: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`, dirty: true });
      return null;
    }
  }

  function validateCurrent() {
    try {
      const node = view === "form" ? validateForm() : validateJson();
      if (node) setValidation({ tone: "ok", text: view === "form" ? "Form values compile to valid node JSON." : "Node JSON is valid.", dirty: validation.dirty });
      return node;
    } catch (error) {
      setValidation({ tone: "error", text: error instanceof Error ? error.message : String(error), dirty: true });
      return null;
    }
  }

  async function persistDraftGraph(nextGraph: ExecGraph, successText: string, dirty: boolean) {
    setDraftGraph(nextGraph);
    if (!onDraftGraphChange) {
      setValidation({ tone: "ok", text: successText, dirty });
      return;
    }
    setValidation({ tone: "idle", text: "Saving draft DAG...", dirty: true });
    try {
      await onDraftGraphChange(nextGraph);
      setValidation({ tone: "ok", text: `${successText} Saved to DAG drafts.`, dirty: false });
    } catch (error) {
      setValidation({ tone: "error", text: `Draft save failed: ${error instanceof Error ? error.message : String(error)}`, dirty: true });
    }
  }

  async function applyGraphFields() {
    const maxConcurrency = Number.parseInt(graphForm.maxConcurrency.trim(), 10);
    if (!graphForm.graphId.trim()) {
      setValidation({ tone: "error", text: "Graph id is required.", dirty: true });
      return;
    }
    if (!graphForm.graphGoal.trim()) {
      setValidation({ tone: "error", text: "Graph goal is required.", dirty: true });
      return;
    }
    if (!Number.isFinite(maxConcurrency) || maxConcurrency < 1) {
      setValidation({ tone: "error", text: "Max concurrency must be a positive integer.", dirty: true });
      return;
    }
    const nextGraph = {
      ...draftGraph,
      graph_id: graphForm.graphId.trim(),
      graph_goal: graphForm.graphGoal.trim(),
      cwd: graphForm.cwd.trim() || undefined,
      max_concurrency: maxConcurrency,
    };
    await persistDraftGraph(nextGraph, "Applied graph metadata.", false);
  }

  async function applyCurrent() {
    const nextNode = validateCurrent();
    if (!nextNode) return;
    const previousId = selectedNodeId;
    const nextGraph = {
      ...draftGraph,
      nodes: draftGraph.nodes.map((node) => node.id === previousId ? nextNode : {
        ...node,
        depends_on: node.depends_on?.map((dep) => dep === previousId ? nextNode.id : dep),
      }),
    };
    setSelectedNodeId(nextNode.id);
    setForm(nodeToForm(nextNode));
    setJsonText(JSON.stringify(nodeWithRuntime(nextNode, status), null, 2));
    await persistDraftGraph(nextGraph, "Applied to draft graph.", false);
  }

  async function duplicateNode() {
    if (!selectedNode) return;
    const copy = cloneNode(selectedNode);
    copy.id = `${selectedNode.id}-copy-${Date.now().toString().slice(-4)}`;
    copy.metadata = { ...(copy.metadata ?? {}), display_label: `${displayLabel(selectedNode)} copy`, draft_only: true };
    const nextGraph = { ...draftGraph, nodes: [...draftGraph.nodes, copy] };
    setSelectedNodeId(copy.id);
    setForm(nodeToForm(copy));
    setJsonText(JSON.stringify(nodeWithRuntime(copy, status), null, 2));
    await persistDraftGraph(nextGraph, "Duplicated node in draft graph.", true);
  }

  async function deleteNode() {
    if (!selectedNode || draftGraph.nodes.length <= 1) return;
    const deleting = selectedNode.id;
    const nextNodes = draftGraph.nodes
      .filter((node) => node.id !== deleting)
      .map((node) => ({ ...node, depends_on: node.depends_on?.filter((dep) => dep !== deleting) }));
    const nextGraph = { ...draftGraph, nodes: nextNodes };
    const nextSelected = nextNodes[0]?.id ?? "";
    setSelectedNodeId(nextSelected);
    setForm(nodeToForm(nextNodes[0]));
    setJsonText(JSON.stringify(nodeWithRuntime(nextNodes[0], status), null, 2));
    await persistDraftGraph(nextGraph, `Deleted ${deleting} from draft graph.`, true);
  }

  return (
    <section style={styles.shell} aria-label="SCILLM DAG contract editor" data-qid="scillm:dag-contract-editor">
      <div style={styles.canvas}>
        <div style={styles.label}>Graph Contract</div>
        <div style={{ ...styles.card, padding: 12, marginBottom: 14 }}>
          <strong>{draftGraph.graph_id}</strong>
          <p style={{ color: EMBRY.dim, margin: "3px 0 0" }}>{draftGraph.graph_goal}</p>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) minmax(280px, 2fr) 110px auto", gap: 8, marginTop: 12, alignItems: "end" }}>
            <Field label="Graph id">
              <input value={graphForm.graphId} onChange={(event) => setGraphForm({ ...graphForm, graphId: event.target.value })} style={inputStyle()} data-qid="scillm:dag-graph-id" />
            </Field>
            <Field label="Graph goal" action={<IconButton label="Expand Graph goal" onClick={() => setModal({ field: "graphGoal", title: "Graph goal", value: graphForm.graphGoal, mono: false })} />}>
              <input value={graphForm.graphGoal} onChange={(event) => setGraphForm({ ...graphForm, graphGoal: event.target.value })} style={inputStyle()} data-qid="scillm:dag-graph-goal" />
            </Field>
            <Field label="Concurrency">
              <input value={graphForm.maxConcurrency} onChange={(event) => setGraphForm({ ...graphForm, maxConcurrency: event.target.value })} style={inputStyle()} data-qid="scillm:dag-max-concurrency" />
            </Field>
            <button type="button" onClick={() => void applyGraphFields()} style={styles.primaryButton} title="Save graph metadata to the draft" data-qid="scillm:dag-apply-graph"><Save size={14} />Apply</button>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Working directory">
                <input value={graphForm.cwd} onChange={(event) => setGraphForm({ ...graphForm, cwd: event.target.value })} style={inputStyle()} data-qid="scillm:dag-cwd" />
              </Field>
            </div>
          </div>
          <HighlightedJson value={graphHeader} />
        </div>

        <div style={styles.label}>Connected DAG</div>
        <div style={{ display: "grid", gap: 14 }}>
          {groupedNodes(draftGraph).map((group, index) => {
            const mode = group.mode;
            return (
              <div key={group.id} style={{ display: "grid", gap: 14 }}>
                {index > 0 ? <div style={{ color: EMBRY.dim, textAlign: "center", fontSize: 18 }}>↓</div> : null}
                <section style={{ ...styles.card, overflow: "hidden", borderColor: mode.startsWith("Concurrent") ? EMBRY.blue : EMBRY.border }}>
                  <header style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderBottom: `1px solid ${EMBRY.border}`, background: EMBRY.bgPanel }}>
                    <strong>{group.label}</strong>
                    <span style={{ color: EMBRY.dim, fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{mode}</span>
                  </header>
                  <div style={{ display: "grid", gridTemplateColumns: mode.startsWith("Concurrent") ? "repeat(2, minmax(250px, 1fr))" : "1fr", gap: 10, padding: 12 }}>
                    {group.nodes.map((node) => {
                      const nodeState = stateForNode(node, status);
                      const selected = node.id === selectedNode?.id;
                      return (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => selectNode(node.id)}
                          title={`Inspect ${node.id}`}
                          style={{
                            border: `1px solid ${selected ? EMBRY.blue : EMBRY.border}`,
                            borderLeft: `5px solid ${stateColor(nodeState)}`,
                            background: nodeState === "running" ? `${EMBRY.blue}1f` : EMBRY.bgDeep,
                            color: EMBRY.white,
                            borderRadius: 8,
                            padding: 11,
                            minHeight: 112,
                            textAlign: "left",
                            display: "grid",
                            gap: 8,
                            boxShadow: selected ? `0 0 0 2px ${EMBRY.blue}55` : "none",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <strong>{displayLabel(node)}</strong>
                            <span style={{ color: EMBRY.dim, fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{nodeState}</span>
                          </div>
                          <div style={{ color: EMBRY.dim, display: "grid", gap: 3, fontSize: 12 }}>
                            <code>{node.id}</code>
                            <span>{node.type} / {nodeModel(node) || "none"}</span>
                            <span>depends: {node.depends_on?.length ? node.depends_on.join(", ") : "root"}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            );
          })}
        </div>

        <div style={{ ...styles.card, padding: 12, marginTop: 14 }}>
          <strong>Run summary</strong>
          <p style={{ color: EMBRY.dim, margin: "4px 0 0" }}>
            {status.run_id ? `${status.state ?? "running"} · ${status.run_id}` : "No run started for this draft view."}
          </p>
        </div>
      </div>

      <aside style={styles.inspector} aria-label="Selected DAG node inspector">
        <div style={{ padding: 14, borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>{selectedNode?.id ?? "No node selected"}</h2>
            <span style={{ color: EMBRY.dim, fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{selectedNode ? stateForNode(selectedNode, status) : "idle"}</span>
          </div>
          <p style={{ color: EMBRY.dim, margin: "5px 0 0" }}>{selectedNode ? `${selectedNode.type} / ${nodeModel(selectedNode) || "none"} / ${selectedNode.depends_on?.length ? `depends on ${selectedNode.depends_on.join(", ")}` : "root node"}` : ""}</p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "12px 14px", borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ display: "flex", gap: 4, padding: 4, border: `1px solid ${EMBRY.border}`, borderRadius: 8, background: EMBRY.bgDeep }}>
            <button type="button" onClick={() => setView("form")} style={view === "form" ? styles.primaryButton : styles.button}>Form</button>
            <button type="button" onClick={() => setView("json")} style={view === "json" ? styles.primaryButton : styles.button}>JSON</button>
          </div>
          <button type="button" onClick={() => void applyCurrent()} style={styles.primaryButton} data-qid="scillm:dag-apply-current">Apply current view</button>
          <button type="button" onClick={validateCurrent} style={styles.button} title="Validate current node" data-qid="scillm:dag-validate-node"><CheckCircle2 size={14} />Validate</button>
          <button type="button" onClick={() => void duplicateNode()} style={styles.button} title="Duplicate selected node"><CopyPlus size={14} />Duplicate</button>
          <button type="button" onClick={() => void deleteNode()} style={{ ...styles.button, color: "#fecdd3", borderColor: EMBRY.red }} title="Delete selected node"><Trash2 size={14} />Delete</button>
          <button type="button" onClick={() => onRunGraph(draftGraph)} disabled={runGraphDisabled} style={styles.primaryButton} title="Run this draft graph through scillm" data-qid="scillm:dag-run-draft"><Play size={14} />{runGraphLabel ?? "Run draft"}</button>
        </div>

        {view === "form" ? (
          <div style={{ overflow: "auto", padding: 14, background: EMBRY.bgDeep, display: "grid", gap: 12 }}>
            <Field label="Node id"><input value={form.id} onChange={(event) => { setForm({ ...form, id: event.target.value }); markDirty(); }} style={inputStyle()} /></Field>
            <Field label="Type">
              <select value={form.type} onChange={(event) => { setForm({ ...form, type: event.target.value }); markDirty(); }} style={inputStyle()}>
                <option value="scillm_call">scillm_call</option>
                <option value="local_command">local_command</option>
                <option value="subagent">subagent</option>
              </select>
            </Field>
            <Field label="Display label"><input value={form.displayLabel} onChange={(event) => { setForm({ ...form, displayLabel: event.target.value }); markDirty(); }} style={inputStyle()} /></Field>
            <Field label="Node goal" action={<IconButton label="Expand Node goal" onClick={() => setModal({ field: "nodeGoal", title: "Node goal", value: form.nodeGoal, mono: false })} />}>
              <textarea value={form.nodeGoal} onChange={(event) => { setForm({ ...form, nodeGoal: event.target.value }); markDirty(); }} style={{ ...inputStyle(), minHeight: 92, resize: "vertical" }} />
            </Field>
            <Field label="Depends on" action={<span title="Edges are generated from selected upstream nodes." style={{ color: EMBRY.dim }}><GitBranch size={14} /></span>}>
              <div style={{ display: "grid", gap: 6, border: `1px solid ${EMBRY.border}`, borderRadius: 7, padding: 8, background: EMBRY.bgPanel }} data-qid="scillm:dag-dependency-picker">
                {draftGraph.nodes.filter((node) => node.id !== selectedNode?.id).length ? draftGraph.nodes.filter((node) => node.id !== selectedNode?.id).map((node) => {
                  const checked = form.dependsOn.includes(node.id);
                  const disabledByCycle = Boolean(selectedNode && !checked && wouldCreateCycle(draftGraph, selectedNode.id, {
                    ...selectedNode,
                    id: form.id.trim() || selectedNode.id,
                    depends_on: [...form.dependsOn, node.id],
                  }));
                  return (
                  <label key={node.id} title={disabledByCycle ? "Disabled because this edge would create a dependency cycle." : undefined} style={{ display: "flex", alignItems: "center", gap: 8, color: disabledByCycle ? EMBRY.dim : EMBRY.white, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabledByCycle}
                      onChange={(event) => {
                        const nextDeps = event.target.checked
                          ? [...form.dependsOn, node.id]
                          : form.dependsOn.filter((dep) => dep !== node.id);
                        setForm({ ...form, dependsOn: nextDeps });
                        markDirty();
                      }}
                    />
                    <code>{node.id}</code>
                    <span style={{ color: EMBRY.dim }}>{displayLabel(node)}</span>
                  </label>
                  );
                }) : <span style={{ color: EMBRY.dim, fontSize: 12 }}>No other nodes are available.</span>}
              </div>
            </Field>
            <Field label="Model">
              {modelOptions.length ? (
                <select value={form.model} onChange={(event) => { setForm({ ...form, model: event.target.value }); markDirty(); }} style={inputStyle()}>
                  <option value="">none</option>
                  {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              ) : (
                <input value={form.model} onChange={(event) => { setForm({ ...form, model: event.target.value }); markDirty(); }} placeholder="oc-kimi, gpt-5.1, none" style={inputStyle()} />
              )}
            </Field>
            <Field label="Local command" action={<IconButton label="Expand Local command" onClick={() => setModal({ field: "command", title: "Local command", value: form.command, mono: true })} />}>
              <textarea value={form.command} onChange={(event) => { setForm({ ...form, command: event.target.value }); markDirty(); }} placeholder="Only used for local_command nodes" style={{ ...inputStyle(), minHeight: 92, resize: "vertical", fontFamily: "SFMono-Regular, Consolas, monospace", fontSize: 12 }} />
            </Field>
          </div>
        ) : (
          <textarea
            value={jsonText}
            onChange={(event) => { setJsonText(event.target.value); markDirty("Draft node JSON changed. Validate or apply before running."); }}
            spellCheck={false}
            aria-label="Selected node JSON editor"
            style={{ width: "100%", height: "100%", minHeight: 420, border: 0, outline: 0, background: EMBRY.bgDeep, color: EMBRY.white, padding: 14, fontFamily: "SFMono-Regular, Consolas, monospace", fontSize: 12, lineHeight: 1.45, resize: "none" }}
          />
        )}

        {selectedNode ? (
          <RuntimeEvidence node={selectedNode} status={status} events={events} />
        ) : null}

        <div style={{ color: validation.tone === "ok" ? EMBRY.green : validation.tone === "error" ? EMBRY.red : EMBRY.dim, borderTop: `1px solid ${EMBRY.border}`, padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>{validation.text}</span>
          <span>{validation.dirty ? "dirty" : "clean"}</span>
        </div>
      </aside>

      {modal ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 40, display: "grid", placeItems: "center", padding: 24, background: "rgba(0,0,0,0.62)" }} onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
          <section role="dialog" aria-modal="true" aria-label={modal.title} style={{ width: "min(920px, 100%)", maxHeight: "calc(100vh - 48px)", display: "grid", gridTemplateRows: "auto minmax(360px, 1fr) auto", border: `1px solid ${EMBRY.border}`, borderRadius: 10, background: EMBRY.bgPanel, overflow: "hidden" }}>
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px", borderBottom: `1px solid ${EMBRY.border}` }}>
              <h2 style={{ margin: 0, fontSize: 15 }}>{modal.title}</h2>
              <button type="button" onClick={() => setModal(null)} aria-label="Close expanded editor" title="Close" style={styles.iconButton}><X size={15} /></button>
            </header>
            <textarea value={modal.value} onChange={(event) => setModal({ ...modal, value: event.target.value })} spellCheck={false} style={{ width: "100%", height: "100%", minHeight: 360, border: 0, outline: 0, background: EMBRY.bgDeep, color: EMBRY.white, padding: 14, fontFamily: modal.mono ? "SFMono-Regular, Consolas, monospace" : "inherit", fontSize: modal.mono ? 12 : 13, lineHeight: modal.mono ? 1.45 : 1.5, resize: "none" }} />
            <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 14px", borderTop: `1px solid ${EMBRY.border}` }}>
              <button type="button" onClick={() => setModal(null)} style={styles.button}>Cancel</button>
              <button type="button" onClick={() => {
                if (modal.field === "graphGoal") setGraphForm({ ...graphForm, graphGoal: modal.value });
                else setForm({ ...form, [modal.field]: modal.value });
                setModal(null);
                markDirty();
              }} style={styles.primaryButton}>Apply text</button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function RuntimeEvidence({ node, status, events }: { node: ExecGraphNode; status: ExecStatus; events: ExecEvent[] }) {
  const result = status.node_results?.[node.id] ?? null;
  const nodeEvents = events.filter((event) => event.node_id === node.id);
  const fields = result ? [
    ["output_hash", result.output_hash],
    ["output_artifact", result.output_artifact],
    ["stdout_path", result.stdout_path],
    ["stderr_path", result.stderr_path],
    ["elapsed_s", result.elapsed_s],
    ["evidence_status", result.evidence_status],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "") : [];
  return (
    <section style={{ borderTop: `1px solid ${EMBRY.border}`, padding: 14, background: EMBRY.bgDeep }} data-qid="scillm:dag-node-runtime-evidence">
      <div style={styles.label}>Runtime Evidence</div>
      {result ? (
        <div style={{ display: "grid", gap: 8 }}>
          {fields.map(([key, value]) => (
            <div key={String(key)} style={{ display: "grid", gridTemplateColumns: "110px minmax(0, 1fr)", gap: 8, fontSize: 12 }}>
              <strong style={{ color: EMBRY.dim }}>{String(key)}</strong>
              <code style={{ overflowWrap: "anywhere", color: EMBRY.white }}>{String(value)}</code>
            </div>
          ))}
          <details>
            <summary style={{ color: EMBRY.blue, cursor: "pointer", fontSize: 12 }}>Resolved result JSON</summary>
            <HighlightedJson value={result} />
          </details>
        </div>
      ) : (
        <p style={{ color: EMBRY.dim, margin: 0, fontSize: 12 }}>No result has been emitted for this node in the current run.</p>
      )}
      <p style={{ color: EMBRY.dim, margin: "8px 0 0", fontSize: 12 }}>
        {nodeEvents.length ? `${nodeEvents.length} runtime event(s) for this node.` : "No node-specific runtime events yet."}
      </p>
    </section>
  );
}

function Field({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: EMBRY.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
        {action}
      </span>
      {children}
    </label>
  );
}

function IconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} style={styles.iconButton}>
      <Maximize2 size={14} />
    </button>
  );
}

function inputStyle() {
  return {
    width: "100%",
    border: `1px solid ${EMBRY.border}`,
    borderRadius: 7,
    background: EMBRY.bgPanel,
    color: EMBRY.white,
    padding: "9px 10px",
    outline: 0,
    font: "inherit",
  };
}

function nodeToForm(node?: ExecGraphNode): FormState {
  return {
    id: node?.id ?? "",
    type: node?.type ?? "scillm_call",
    displayLabel: typeof node?.metadata?.display_label === "string" ? node.metadata.display_label : "",
    nodeGoal: node?.node_goal ?? "",
    dependsOn: node?.depends_on ? [...node.depends_on] : [],
    model: nodeModel(node) ?? "",
    command: Array.isArray(node?.command) ? node.command.join("\n") : node?.command ?? "",
  };
}

function formToNode(form: FormState, current: ExecGraphNode): ExecGraphNode {
  const next: ExecGraphNode = {
    ...cloneNode(current),
    id: form.id.trim(),
    type: form.type,
    node_goal: form.nodeGoal.trim(),
    depends_on: form.dependsOn.map((value) => value.trim()).filter(Boolean),
    metadata: { ...(current.metadata ?? {}) },
  };
  if (!next.depends_on?.length) delete next.depends_on;
  if (form.displayLabel.trim()) next.metadata = { ...(next.metadata ?? {}), display_label: form.displayLabel.trim() };
  else if (next.metadata) delete next.metadata.display_label;
  if (form.type === "local_command") {
    next.command = form.command;
    delete next.model;
    delete (next as ExecGraphNode & { model_config?: unknown }).model_config;
  } else {
    const model = form.model.trim();
    if (model) {
      (next as ExecGraphNode & { model_config?: { model?: string } }).model_config = {
        ...((current as ExecGraphNode & { model_config?: Record<string, unknown> }).model_config ?? {}),
        model,
      };
      next.model = model;
    }
    delete next.command;
  }
  return next;
}

function validateNode(node: ExecGraphNode, selectedNodeId: string, graph: ExecGraph) {
  const missing = ["id", "type", "node_goal"].filter((key) => !node[key as keyof ExecGraphNode]);
  if (missing.length) return nullWithValidation(`Missing required field(s): ${missing.join(", ")}`);
  if (node.depends_on?.includes(node.id)) return nullWithValidation("Node cannot depend on itself.");
  for (const dep of node.depends_on ?? []) {
    if (!graph.nodes.some((candidate) => candidate.id === dep)) return nullWithValidation(`Dependency does not exist: ${dep}`);
  }
  if (node.id !== selectedNodeId && graph.nodes.some((candidate) => candidate.id === node.id)) return nullWithValidation(`Node id already exists: ${node.id}`);
  if (wouldCreateCycle(graph, selectedNodeId, node)) return nullWithValidation("Dependency selection creates a cycle.");
  if (node.type === "scillm_call" && !nodeModel(node)) return nullWithValidation("scillm_call node needs a model.");
  if (node.type === "local_command" && !node.command) return nullWithValidation("local_command node needs a command.");
  return node;
}

function graphToForm(graph: ExecGraph): GraphFormState {
  return {
    graphId: graph.graph_id,
    graphGoal: graph.graph_goal,
    cwd: graph.cwd ?? "",
    maxConcurrency: String(graph.max_concurrency ?? 1),
  };
}

function nullWithValidation(message: string) {
  throw new Error(message);
}

function cloneGraph(graph: ExecGraph): ExecGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(cloneNode),
  };
}

function cloneNode(node: ExecGraphNode): ExecGraphNode {
  return {
    ...node,
    depends_on: node.depends_on ? [...node.depends_on] : undefined,
    messages: node.messages ? node.messages.map((message) => ({ ...message })) : undefined,
    metadata: node.metadata ? { ...node.metadata } : undefined,
    retry_policy: node.retry_policy ? { ...node.retry_policy } : undefined,
    output_schema: node.output_schema ? { ...node.output_schema } : undefined,
  };
}

type DagNodeGroup = {
  id: string;
  label: string;
  mode: string;
  nodes: ExecGraphNode[];
};

function groupedNodes(graph: ExecGraph): DagNodeGroup[] {
  const hasExplicitGroups = graph.nodes.some((node) => typeof node.metadata?.group === "string" && node.metadata.group);
  if (!hasExplicitGroups) return dependencyLayerGroups(graph);
  const groups = new Map<string, ExecGraphNode[]>();
  for (const node of graph.nodes) {
    const group = typeof node.metadata?.group === "string" ? node.metadata.group : "ungrouped";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)?.push(node);
  }
  return [...groups.entries()].map(([group, nodes]) => ({
    id: group,
    label: groupLabels[group] ?? group,
    mode: groupModes[group] ?? (nodes.length > 1 ? "Concurrent group - nodes may run together" : "Sequential gate"),
    nodes,
  }));
}

function dependencyLayerGroups(graph: ExecGraph): DagNodeGroup[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const depthCache = new Map<string, number>();
  const visiting = new Set<string>();
  function depthFor(node: ExecGraphNode): number {
    const cached = depthCache.get(node.id);
    if (cached !== undefined) return cached;
    if (visiting.has(node.id)) return 0;
    visiting.add(node.id);
    const deps = (node.depends_on ?? []).map((dep) => byId.get(dep)).filter(Boolean) as ExecGraphNode[];
    const depth = deps.length ? Math.max(...deps.map(depthFor)) + 1 : 0;
    visiting.delete(node.id);
    depthCache.set(node.id, depth);
    return depth;
  }
  const layers = new Map<number, ExecGraphNode[]>();
  for (const node of graph.nodes) {
    const depth = depthFor(node);
    if (!layers.has(depth)) layers.set(depth, []);
    layers.get(depth)?.push(node);
  }
  return [...layers.entries()].sort(([a], [b]) => a - b).map(([depth, nodes]) => ({
    id: `layer-${depth}`,
    label: depth === 0 ? "1. Root nodes" : `${depth + 1}. Depends on prior layer`,
    mode: nodes.length > 1 ? "Concurrent group - nodes may run together" : "Sequential gate",
    nodes,
  }));
}

function wouldCreateCycle(graph: ExecGraph, selectedNodeId: string, nextNode: ExecGraphNode) {
  const nodes = graph.nodes.map((node) => node.id === selectedNodeId ? nextNode : node);
  const deps = new Map(nodes.map((node) => [node.id, node.depends_on ?? []]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dep of deps.get(id) ?? []) {
      if (deps.has(dep) && visit(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  return nodes.some((node) => visit(node.id));
}

function nodeModel(node?: ExecGraphNode) {
  if (!node) return "";
  const withConfig = node as ExecGraphNode & { model_config?: { model?: unknown } };
  return typeof withConfig.model_config?.model === "string" ? withConfig.model_config.model : node.model ?? "";
}

function displayLabel(node: ExecGraphNode) {
  return typeof node.metadata?.display_label === "string" ? node.metadata.display_label : node.id;
}

function nodeWithRuntime(node: ExecGraphNode | undefined, status: ExecStatus) {
  if (!node) return {};
  return {
    runtime: {
      status: stateForNode(node, status),
      run_id: status.run_id,
      result: status.node_results?.[node.id] ?? null,
    },
    ...node,
  };
}

function stateForNode(node: ExecGraphNode, status: ExecStatus) {
  if (status.running_node_ids?.includes(node.id)) return "running";
  const result = status.node_results?.[node.id];
  if (result?.ok === true || result?.status === "passed") return "passed";
  if (result?.ok === false || result?.status === "failed") return "failed";
  return node.depends_on?.length ? "pending" : "ready";
}

function stateColor(state: string) {
  if (state === "running") return EMBRY.blue;
  if (state === "passed") return EMBRY.green;
  if (state === "failed") return EMBRY.red;
  if (state === "pending") return EMBRY.dim;
  return EMBRY.blue;
}

function HighlightedJson({ value }: { value: unknown }) {
  return (
    <pre
      className="scillm-json-viewer"
      style={styles.codeWell}
      dangerouslySetInnerHTML={{ __html: highlightJson(value) }}
    />
  );
}

function highlightJson(value: unknown) {
  const escaped = escapeHtml(JSON.stringify(value, null, 2));
  return escaped.replace(
    /(&quot;(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\&])*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g,
    (match, stringToken: string | undefined, colon: string | undefined) => {
      if (stringToken) return colon ? `<span class="json-key">${stringToken}</span>${colon}` : `<span class="json-string">${stringToken}</span>`;
      if (match === "true" || match === "false") return `<span class="json-boolean">${match}</span>`;
      if (match === "null") return `<span class="json-null">${match}</span>`;
      return `<span class="json-number">${match}</span>`;
    },
  );
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
