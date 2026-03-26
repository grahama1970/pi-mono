"""
generate-commands.py — Adversarial NL command generator for BinaryExplorer intent training.

Generates 200+ adversarial natural-language commands per binary using
8 variation types × 6 QuerySpec action types × multiple entity seeds.

Prompt template versioned in:
  .pi/skills/prompt-lab/prompts/adversarial_commands_v1.txt

Usage:
    python3 generate-commands.py --dry-run --limit 5
    python3 generate-commands.py --binary droid --output commands.jsonl
    python3 generate-commands.py --novel --limit 50
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path
from typing import Optional

import typer
from loguru import logger

# ── Remove default stderr handler; add clean stderr for logs ──────────────────
logger.remove()
logger.add(sys.stderr, level="INFO", format="<green>{time:HH:mm:ss}</green> | {level} | {message}")

app = typer.Typer(help="Generate adversarial NL commands for BinaryExplorer intent training")

# ── Static binary feature catalog (used in --dry-run and offline mode) ────────

STATIC_FEATURES: dict[str, list[dict]] = {
    "droid": [
        {"_key": "droid:droid", "node_type": "namespace", "name": "droid", "namespace": "droid",
         "cluster": "droid", "label": "droid", "description": "Core droid namespace"},
        {"_key": "droid:session_notification", "node_type": "rpc", "name": "session_notification",
         "namespace": "droid", "cluster": "droid", "label": "Session Notification",
         "description": "Notifies clients of session state changes"},
        {"_key": "droid:request_permission", "node_type": "rpc", "name": "request_permission",
         "namespace": "droid", "cluster": "droid", "label": "Request Permission",
         "description": "Requests user permission for a tool action"},
        {"_key": "droid:automation", "node_type": "namespace", "name": "automation",
         "namespace": "automation", "cluster": "automation", "label": "automation",
         "description": "Browser and UI automation namespace"},
        {"_key": "droid:start_automation", "node_type": "rpc", "name": "start_automation",
         "namespace": "automation", "cluster": "automation", "label": "Start Automation",
         "description": "Initiates a browser automation session"},
        {"_key": "droid:automation_event", "node_type": "event", "name": "automation_event",
         "namespace": "automation", "cluster": "automation", "label": "Automation Event",
         "description": "Emitted when automation step completes"},
        {"_key": "droid:terminal", "node_type": "namespace", "name": "terminal",
         "namespace": "terminal", "cluster": "terminal", "label": "terminal",
         "description": "Terminal session namespace"},
        {"_key": "droid:terminal_output", "node_type": "event", "name": "terminal_output",
         "namespace": "terminal", "cluster": "terminal", "label": "Terminal Output",
         "description": "Stream of terminal stdout/stderr"},
        {"_key": "droid:AgentState", "node_type": "state_machine", "name": "AgentState",
         "namespace": "droid", "cluster": "droid", "label": "Agent State",
         "description": "FSM: idle → orchestrator_turn → paused → completed"},
        {"_key": "droid:SessionSchema", "node_type": "schema", "name": "SessionSchema",
         "namespace": "droid", "cluster": "droid", "label": "Session Schema",
         "fields": ["sessionId", "automationId", "status", "createdAt"],
         "description": "Session document schema"},
        {"_key": "droid:run", "node_type": "cli_command", "name": "run",
         "namespace": "droid", "cluster": "droid", "label": "run",
         "description": "CLI: launch a droid agent session"},
    ],
    "daemon": [
        {"_key": "daemon:daemon", "node_type": "namespace", "name": "daemon", "namespace": "daemon",
         "cluster": "daemon", "label": "daemon", "description": "Orchestration daemon namespace"},
        {"_key": "daemon:schedule_job", "node_type": "rpc", "name": "schedule_job",
         "namespace": "daemon", "cluster": "daemon", "label": "Schedule Job",
         "description": "Schedules a background agent job"},
        {"_key": "daemon:cancel_job", "node_type": "rpc", "name": "cancel_job",
         "namespace": "daemon", "cluster": "daemon", "label": "Cancel Job",
         "description": "Cancels a running or queued job"},
        {"_key": "daemon:worker", "node_type": "namespace", "name": "worker",
         "namespace": "worker", "cluster": "worker", "label": "worker",
         "description": "Worker pool namespace"},
        {"_key": "daemon:worker_started", "node_type": "event", "name": "worker_started",
         "namespace": "worker", "cluster": "worker", "label": "Worker Started",
         "description": "Fires when a worker process is spawned"},
        {"_key": "daemon:worker_notification", "node_type": "event", "name": "worker_notification",
         "namespace": "worker", "cluster": "worker", "label": "Worker Notification",
         "description": "Generic notification from worker to orchestrator"},
        {"_key": "daemon:JobState", "node_type": "state_machine", "name": "JobState",
         "namespace": "daemon", "cluster": "daemon", "label": "Job State",
         "description": "FSM: queued → running → completed | failed | cancelled"},
        {"_key": "daemon:JobSchema", "node_type": "schema", "name": "JobSchema",
         "namespace": "daemon", "cluster": "daemon", "label": "Job Schema",
         "fields": ["jobId", "agentId", "priority", "createdAt", "status"],
         "description": "Scheduled job document schema"},
        {"_key": "daemon:status", "node_type": "cli_command", "name": "status",
         "namespace": "daemon", "cluster": "daemon", "label": "status",
         "description": "CLI: show daemon health and job queue"},
    ],
    "tunnel": [
        {"_key": "tunnel:tunnel", "node_type": "namespace", "name": "tunnel", "namespace": "tunnel",
         "cluster": "tunnel", "label": "tunnel", "description": "Tunnel relay namespace"},
        {"_key": "tunnel:open_connection", "node_type": "rpc", "name": "open_connection",
         "namespace": "tunnel", "cluster": "tunnel", "label": "Open Connection",
         "description": "Opens a reverse proxy tunnel connection"},
        {"_key": "tunnel:relay_message", "node_type": "rpc", "name": "relay_message",
         "namespace": "tunnel", "cluster": "tunnel", "label": "Relay Message",
         "description": "Relays a message through the tunnel"},
        {"_key": "tunnel:stream", "node_type": "namespace", "name": "stream",
         "namespace": "stream", "cluster": "stream", "label": "stream",
         "description": "Streaming data namespace"},
        {"_key": "tunnel:stream_chunk", "node_type": "event", "name": "stream_chunk",
         "namespace": "stream", "cluster": "stream", "label": "Stream Chunk",
         "description": "Emitted on each chunk of streamed data"},
        {"_key": "tunnel:connection_closed", "node_type": "event", "name": "connection_closed",
         "namespace": "tunnel", "cluster": "tunnel", "label": "Connection Closed",
         "description": "Fires when a tunnel connection drops"},
        {"_key": "tunnel:ConnectionState", "node_type": "state_machine", "name": "ConnectionState",
         "namespace": "tunnel", "cluster": "tunnel", "label": "Connection State",
         "description": "FSM: connecting → open → draining → closed"},
        {"_key": "tunnel:MessageSchema", "node_type": "schema", "name": "MessageSchema",
         "namespace": "tunnel", "cluster": "tunnel", "label": "Message Schema",
         "fields": ["messageId", "tunnelId", "payload", "timestamp"],
         "description": "Tunnel message envelope schema"},
        {"_key": "tunnel:connect", "node_type": "cli_command", "name": "connect",
         "namespace": "tunnel", "cluster": "tunnel", "label": "connect",
         "description": "CLI: establish tunnel connection to relay"},
    ],
    "mcp": [
        {"_key": "mcp:mcp", "node_type": "namespace", "name": "mcp", "namespace": "mcp",
         "cluster": "mcp", "label": "mcp", "description": "MCP tool protocol namespace"},
        {"_key": "mcp:list_tools", "node_type": "rpc", "name": "list_tools",
         "namespace": "mcp", "cluster": "mcp", "label": "List Tools",
         "description": "Discovers available tools from MCP server"},
        {"_key": "mcp:call_tool", "node_type": "rpc", "name": "call_tool",
         "namespace": "mcp", "cluster": "mcp", "label": "Call Tool",
         "description": "Invokes a registered MCP tool by name"},
        {"_key": "mcp:registry", "node_type": "namespace", "name": "registry",
         "namespace": "registry", "cluster": "registry", "label": "registry",
         "description": "Tool registry and capability namespace"},
        {"_key": "mcp:tool_registered", "node_type": "event", "name": "tool_registered",
         "namespace": "registry", "cluster": "registry", "label": "Tool Registered",
         "description": "Fires when a new tool is registered with the server"},
        {"_key": "mcp:tool_result", "node_type": "event", "name": "tool_result",
         "namespace": "mcp", "cluster": "mcp", "label": "Tool Result",
         "description": "Emitted when tool execution completes with output"},
        {"_key": "mcp:CapabilityState", "node_type": "state_machine", "name": "CapabilityState",
         "namespace": "mcp", "cluster": "mcp", "label": "Capability State",
         "description": "FSM: uninitialized → negotiating → ready | error"},
        {"_key": "mcp:ToolSchema", "node_type": "schema", "name": "ToolSchema",
         "namespace": "mcp", "cluster": "mcp", "label": "Tool Schema",
         "fields": ["toolId", "name", "inputSchema", "description", "serverId"],
         "description": "MCP tool registration schema"},
        {"_key": "mcp:serve", "node_type": "cli_command", "name": "serve",
         "namespace": "mcp", "cluster": "mcp", "label": "serve",
         "description": "CLI: start MCP server and register tools"},
    ],
}

# ── Perspective and layout values ─────────────────────────────────────────────

PERSPECTIVES = ["security", "data_flow", "protocol", "overview"]
LAYOUTS = ["organic", "stratified", "clustered"]

PERSPECTIVE_ABBREVS = {
    "security": ["sec", "secu", "security"],
    "data_flow": ["df", "data flow", "dataflow", "flow"],
    "protocol": ["proto", "prot", "protocol"],
    "overview": ["over", "ov", "overview"],
}

LAYOUT_ABBREVS = {
    "organic": ["org", "orgnic", "organic"],
    "stratified": ["strat", "stratified", "layers"],
    "clustered": ["clust", "clustered", "groups"],
}

# ── Typo helpers ──────────────────────────────────────────────────────────────

def _make_typo(text: str, rng: random.Random) -> str:
    """Introduce 1-2 realistic typos into a string."""
    if len(text) < 3:
        return text
    ops = ["swap", "drop", "double"]
    result = list(text)
    for _ in range(min(2, max(1, len(text) // 8))):
        op = rng.choice(ops)
        i = rng.randint(0, len(result) - 1)
        if op == "swap" and i + 1 < len(result):
            result[i], result[i + 1] = result[i + 1], result[i]
        elif op == "drop" and len(result) > 3:
            result.pop(i)
        elif op == "double":
            result.insert(i, result[i])
    return "".join(result)


def _abbreviate(name: str) -> str:
    """Generate a plausible abbreviation."""
    parts = name.replace("_", " ").replace(".", " ").split()
    if len(parts) == 1:
        return name[:max(3, len(name) // 2)]
    return " ".join(p[:3] for p in parts)


def _partial(name: str, rng: random.Random) -> str:
    """Return a partial match (first word or first N chars)."""
    parts = name.replace("_", " ").replace(".", " ").split()
    if len(parts) > 1:
        return rng.choice(parts)
    return name[: max(3, len(name) * 2 // 3)]

# ── Command variation generators per action type ──────────────────────────────

def _variations_select_node(
    feature: dict, binary: str, rng: random.Random
) -> list[dict]:
    """Generate 8 SELECT_NODE variations for one feature."""
    label = feature["label"]
    name = feature["name"]
    node_type = feature["node_type"]
    abbrev = _abbreviate(name)
    partial = _partial(name, rng)
    name_typo = _make_typo(name, rng)

    templates = [
        (f"Please select the {label} node in the graph.", "easy"),
        (f"click on {name}", "medium"),
        (f"selct {name_typo}", "hard"),
        (f"Select {label}", "easy"),
        (f"Can you show me the {label}?", "easy"),
        (f"I want see the {name} please", "medium"),
        (f"sel {abbrev}", "hard"),
        (f"I would like you to navigate to and highlight the {label} {node_type} node in {binary}", "medium"),
    ]
    variation_names = ["formal", "casual", "typos", "imperative", "question", "non_native", "abbreviated", "verbose"]
    results = []
    for (cmd, difficulty), variation in zip(templates, variation_names):
        results.append({
            "command": cmd,
            "expected_action": "SELECT_NODE",
            "expected_target": feature["_key"],
            "difficulty": difficulty,
            "variation": variation,
            "binary": binary,
        })

    # Extra challenges: partial name, wrong case, abbreviation
    extra = [
        (f"show me {partial}", "hard", "partial_name"),
        (f"focus {name.upper()}", "medium", "wrong_case"),
        (f"go to {abbrev}", "hard", "abbreviated"),
    ]
    for cmd, difficulty, var in extra:
        results.append({
            "command": cmd,
            "expected_action": "SELECT_NODE",
            "expected_target": feature["_key"],
            "difficulty": difficulty,
            "variation": var,
            "binary": binary,
        })
    return results


def _variations_view_all(binary: str, rng: random.Random) -> list[dict]:
    """Generate 8 VIEW_ALL variations."""
    templates = [
        ("Please reset the graph to show all nodes.", "easy"),
        ("show everything", "easy"),
        ("shwo al nodes", "hard"),
        ("View all", "easy"),
        ("Can you zoom out to show all nodes?", "easy"),
        ("Please show me all things in graph", "medium"),
        ("view all", "easy"),
        ("Please zoom the camera out and deselect everything to show the complete graph", "medium"),
    ]
    variation_names = ["formal", "casual", "typos", "imperative", "question", "non_native", "abbreviated", "verbose"]
    results = []
    for (cmd, difficulty), variation in zip(templates, variation_names):
        results.append({
            "command": cmd,
            "expected_action": "VIEW_ALL",
            "difficulty": difficulty,
            "variation": variation,
            "binary": binary,
        })
    extra = [
        ("reset view", "easy", "imperative"),
        ("zoom out", "easy", "casual"),
        ("sho all nods", "hard", "typos"),
        ("deselect + fit", "hard", "abbreviated"),
    ]
    for cmd, difficulty, var in extra:
        results.append({
            "command": cmd,
            "expected_action": "VIEW_ALL",
            "difficulty": difficulty,
            "variation": var,
            "binary": binary,
        })
    return results


def _variations_set_perspective(binary: str, rng: random.Random) -> list[dict]:
    """Generate perspective-switching commands for all 4 perspectives × 8 variations."""
    results = []
    for perspective in PERSPECTIVES:
        abbrevs = PERSPECTIVE_ABBREVS[perspective]
        abbrev = abbrevs[0]
        p_typo = _make_typo(perspective, rng)
        templates = [
            (f"Please switch to the {perspective} perspective.", "easy"),
            (f"change to {perspective} view", "easy"),
            (f"swith to {p_typo} perpective", "hard"),
            (f"Set {perspective} perspective", "easy"),
            (f"Can you switch the perspective to {perspective}?", "easy"),
            (f"I want perspective {perspective} please change", "medium"),
            (f"{abbrev} view", "medium"),
            (f"I would like to switch the graph visualization lens to the {perspective} perspective mode", "medium"),
        ]
        variation_names = ["formal", "casual", "typos", "imperative", "question", "non_native", "abbreviated", "verbose"]
        for (cmd, difficulty), variation in zip(templates, variation_names):
            results.append({
                "command": cmd,
                "expected_action": "SET_PERSPECTIVE",
                "expected_target": perspective,
                "difficulty": difficulty,
                "variation": variation,
                "binary": binary,
            })
    return results


def _variations_set_layout(binary: str, rng: random.Random) -> list[dict]:
    """Generate layout-change commands for all 3 layouts × 8 variations."""
    results = []
    for layout in LAYOUTS:
        abbrevs = LAYOUT_ABBREVS[layout]
        abbrev = abbrevs[0]
        l_typo = _make_typo(layout, rng)
        templates = [
            (f"Please change the layout to {layout} mode.", "easy"),
            (f"use {layout} layout", "easy"),
            (f"lauout {l_typo}", "hard"),
            (f"Set {layout} layout", "easy"),
            (f"How do I use {layout} layout?", "medium"),
            (f"Please make layout {layout}", "medium"),
            (f"{abbrev} lyt", "hard"),
            (f"Please reconfigure the graph layout algorithm to use the {layout} arrangement strategy", "medium"),
        ]
        variation_names = ["formal", "casual", "typos", "imperative", "question", "non_native", "abbreviated", "verbose"]
        for (cmd, difficulty), variation in zip(templates, variation_names):
            results.append({
                "command": cmd,
                "expected_action": "SET_LAYOUT",
                "expected_target": layout,
                "difficulty": difficulty,
                "variation": variation,
                "binary": binary,
            })
    return results


def _variations_expand(
    feature: dict, binary: str, rng: random.Random
) -> list[dict]:
    """Generate EXPAND variations for namespace nodes."""
    ns = feature["name"]
    abbrev = _abbreviate(ns)
    ns_typo = _make_typo(ns, rng)

    templates = [
        (f"Please expand the {ns} namespace cluster.", "easy"),
        (f"open up {ns}", "easy"),
        (f"exapnd {ns_typo}", "hard"),
        (f"Expand {ns}", "easy"),
        (f"Can you expand the {ns} cluster?", "easy"),
        (f"Show me inside {ns} please expand", "medium"),
        (f"exp {abbrev}", "hard"),
        (f"Please expand the {ns} namespace node to reveal all of its child RPC methods and events", "medium"),
    ]
    variation_names = ["formal", "casual", "typos", "imperative", "question", "non_native", "abbreviated", "verbose"]
    results = []
    for (cmd, difficulty), variation in zip(templates, variation_names):
        results.append({
            "command": cmd,
            "expected_action": "EXPAND",
            "expected_target": feature["_key"],
            "difficulty": difficulty,
            "variation": variation,
            "binary": binary,
        })
    return results


def _variations_query(
    feature: dict, binary: str, rng: random.Random
) -> list[dict]:
    """Generate QUERY (conceptual question) variations."""
    concept = feature["label"]
    name = feature["name"]
    abbrev = _abbreviate(name)
    concept_typo = _make_typo(concept.lower().replace(" ", "_"), rng)

    templates = [
        (f"What RPC methods relate to {concept}?", "easy"),
        (f"what does {name} do", "easy"),
        (f"wat dose {concept_typo} do", "hard"),
        (f"Explain {concept}", "easy"),
        (f"How does {concept} work in {binary}?", "easy"),
        (f"Tell me about {name} how it working", "medium"),
        (f"{abbrev} ?", "hard"),
        (f"Could you provide a detailed explanation of how {concept} is implemented and what nodes it connects to in {binary}?", "medium"),
    ]
    variation_names = ["formal", "casual", "typos", "imperative", "question", "non_native", "abbreviated", "verbose"]
    results = []
    for (cmd, difficulty), variation in zip(templates, variation_names):
        results.append({
            "command": cmd,
            "expected_action": "QUERY",
            "expected_target": feature["_key"],
            "difficulty": difficulty,
            "variation": variation,
            "binary": binary,
        })
    return results


# ── Clarify trigger commands (hard difficulty) ─────────────────────────────────

def _clarify_triggers(binary: str, features: list[dict], rng: random.Random) -> list[dict]:
    """Generate commands that should trigger /memory clarify."""
    results = []

    # 1. Non-existent node names
    fake_names = [
        f"{binary}.auth_token",
        f"{binary}.debug_mode",
        f"encryption_key",
        f"ping_endpoint",
        f"health_check",
    ]
    for fake in fake_names:
        results.append({
            "command": f"show me {fake}",
            "expected_action": "SELECT_NODE",
            "expected_target": None,
            "difficulty": "hard",
            "variation": "non_existent",
            "binary": binary,
            "clarify_trigger": True,
        })
        results.append({
            "command": f"Can you expand {fake}?",
            "expected_action": "EXPAND",
            "expected_target": None,
            "difficulty": "hard",
            "variation": "non_existent",
            "binary": binary,
            "clarify_trigger": True,
        })

    # 2. Ambiguous names that match multiple nodes
    ambiguous = [
        ("notification", "matches session_notification AND worker_notification"),
        ("state", "matches AgentState AND JobState AND ConnectionState"),
        ("schema", "matches multiple schema nodes"),
        ("start", "could be start_automation or other starts"),
    ]
    for ambi_term, reason in ambiguous:
        results.append({
            "command": f"select the {ambi_term} node",
            "expected_action": "SELECT_NODE",
            "expected_target": None,
            "difficulty": "hard",
            "variation": "ambiguous",
            "binary": binary,
            "clarify_trigger": True,
            "clarify_reason": reason,
        })

    # 3. Misspelled entity with edit distance ≤ 2
    for feature in rng.sample(features, min(4, len(features))):
        name = feature["name"]
        if len(name) > 4:
            typo_name = _make_typo(name, rng)
            if typo_name != name:
                results.append({
                    "command": f"show me {typo_name}",
                    "expected_action": "SELECT_NODE",
                    "expected_target": feature["_key"],
                    "difficulty": "hard",
                    "variation": "misspelling",
                    "binary": binary,
                    "clarify_trigger": True,
                    "clarify_reason": f"misspelling of {name}",
                })

    return results


# ── Novel-mode extra variety ───────────────────────────────────────────────────

NOVEL_TEMPLATES = [
    ("trace the execution path of {label}", "QUERY", "medium"),
    ("what calls {name}?", "QUERY", "easy"),
    ("find all schemas used by {name}", "QUERY", "medium"),
    ("highlight {label} and its neighbors", "SELECT_NODE", "medium"),
    ("{name} connections", "SELECT_NODE", "medium"),
    ("drill into {name}", "EXPAND", "medium"),
    ("inspect {name}", "SELECT_NODE", "easy"),
    ("open {label}", "EXPAND", "easy"),
    ("navigate to {name}", "SELECT_NODE", "easy"),
    ("where does {name} send events?", "QUERY", "easy"),
    ("what schema does {name} use?", "QUERY", "easy"),
    ("how is {label} connected?", "QUERY", "easy"),
    ("click {name}", "SELECT_NODE", "easy"),
    ("show {name} details", "SELECT_NODE", "easy"),
    ("pull up {label}", "SELECT_NODE", "medium"),
    ("{abbrev} info", "QUERY", "hard"),
    ("{abbrev} node", "SELECT_NODE", "hard"),
]


def _novel_commands(features: list[dict], binary: str) -> list[dict]:
    """Generate novel (held-out) commands not in standard templates."""
    results = []
    for feature in features:
        label = feature["label"]
        name = feature["name"]
        abbrev = _abbreviate(name)
        for template, action, difficulty in NOVEL_TEMPLATES:
            cmd = template.format(label=label, name=name, abbrev=abbrev)
            entry: dict = {
                "command": cmd,
                "expected_action": action,
                "difficulty": difficulty,
                "variation": "novel",
                "binary": binary,
            }
            if action in ("SELECT_NODE", "EXPAND", "QUERY"):
                entry["expected_target"] = feature["_key"]
            results.append(entry)
    return results


# ── ArangoDB fetch via memory daemon ──────────────────────────────────────────

def _fetch_features_from_arango(binary: str) -> list[dict]:
    """Fetch binary_features from ArangoDB via memory daemon Unix socket."""
    import httpx  # local import — only used in live mode

    MEMORY_SOCK = "/run/user/1000/embry/memory.sock"
    MEMORY_URL = "http://127.0.0.1:8601"

    features = []
    try:
        # Try Unix socket first
        transport = httpx.HTTPTransport(uds=MEMORY_SOCK)
        client = httpx.Client(transport=transport, base_url="http://localhost", timeout=10.0)
        resp = client.post(
            "/list",
            json={"collection": "binary_features", "filters": {"binary_name": binary}, "limit": 500},
        )
        resp.raise_for_status()
        data = resp.json()
        features = data.get("documents", data.get("items", []))
        logger.info(f"Fetched {len(features)} features for {binary} from Unix socket")
    except Exception as exc:
        logger.debug(f"Unix socket failed ({exc}), trying TCP...")
        try:
            resp = httpx.post(
                f"{MEMORY_URL}/list",
                json={"collection": "binary_features", "filters": {"binary_name": binary}, "limit": 500},
                timeout=10.0,
            )
            resp.raise_for_status()
            data = resp.json()
            features = data.get("documents", data.get("items", []))
            logger.info(f"Fetched {len(features)} features for {binary} from TCP")
        except Exception as exc2:
            logger.warning(f"ArangoDB unavailable ({exc2}), falling back to static features for {binary}")
            features = STATIC_FEATURES.get(binary, [])
    return features


# ── Main generator ────────────────────────────────────────────────────────────

def _generate_for_binary(
    binary: str,
    features: list[dict],
    novel: bool = False,
    rng: random.Random = random.Random(42),
) -> list[dict]:
    """Generate all commands for one binary."""
    commands: list[dict] = []

    # Group features by node_type
    namespaces = [f for f in features if f.get("node_type") == "namespace"]
    rpcs = [f for f in features if f.get("node_type") == "rpc"]
    events = [f for f in features if f.get("node_type") == "event"]
    schemas = [f for f in features if f.get("node_type") == "schema"]
    state_machines = [f for f in features if f.get("node_type") == "state_machine"]
    cli_cmds = [f for f in features if f.get("node_type") == "cli_command"]

    selectable = rpcs + events + schemas + state_machines + cli_cmds + namespaces

    # 1. SELECT_NODE — for each selectable feature
    for feat in selectable:
        commands.extend(_variations_select_node(feat, binary, rng))

    # 2. VIEW_ALL — global commands
    commands.extend(_variations_view_all(binary, rng))

    # 3. SET_PERSPECTIVE — all 4 perspectives
    commands.extend(_variations_set_perspective(binary, rng))

    # 4. SET_LAYOUT — all 3 layouts
    commands.extend(_variations_set_layout(binary, rng))

    # 5. EXPAND — for namespace nodes
    for feat in namespaces:
        commands.extend(_variations_expand(feat, binary, rng))

    # 6. QUERY — for rpcs, events, state machines
    query_targets = rpcs + events + state_machines + namespaces
    for feat in query_targets:
        commands.extend(_variations_query(feat, binary, rng))

    # 7. Clarify triggers (hard difficulty edge cases)
    commands.extend(_clarify_triggers(binary, features, rng))

    # 8. Novel-mode extra commands
    if novel:
        commands.extend(_novel_commands(selectable, binary))

    return commands


# ── CLI ────────────────────────────────────────────────────────────────────────

BINARIES = list(STATIC_FEATURES.keys())  # droid, daemon, tunnel, mcp


@app.command()
def main(
    binary: Optional[str] = typer.Option(None, "--binary", "-b", help="Single binary to generate (droid|daemon|tunnel|mcp). Default: all"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Use static hardcoded features, no ArangoDB connection"),
    novel: bool = typer.Option(False, "--novel", help="Include novel (held-out) command templates"),
    limit: Optional[int] = typer.Option(None, "--limit", "-n", help="Limit total output lines"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Output JSONL file (default: stdout)"),
    seed: int = typer.Option(42, "--seed", help="Random seed for reproducibility"),
    stats: bool = typer.Option(False, "--stats", help="Print stats summary to stderr after generation"),
) -> None:
    """Generate adversarial NL commands for BinaryExplorer intent training.

    Outputs JSONL: {command, expected_action, expected_target?, difficulty, variation, binary}

    Prompt template: .pi/skills/prompt-lab/prompts/adversarial_commands_v1.txt
    """
    rng = random.Random(seed)
    target_binaries = [binary] if binary else BINARIES

    all_commands: list[dict] = []

    for bin_name in target_binaries:
        if bin_name not in STATIC_FEATURES and bin_name not in BINARIES:
            logger.error(f"Unknown binary: {bin_name}. Valid: {BINARIES}")
            raise typer.Exit(1)

        if dry_run:
            features = STATIC_FEATURES.get(bin_name, [])
            logger.info(f"[dry-run] {bin_name}: using {len(features)} static features")
        else:
            features = _fetch_features_from_arango(bin_name)
            if not features:
                logger.warning(f"No features found for {bin_name}, using static fallback")
                features = STATIC_FEATURES.get(bin_name, [])

        cmds = _generate_for_binary(bin_name, features, novel=novel, rng=rng)
        logger.info(f"{bin_name}: generated {len(cmds)} commands")
        all_commands.extend(cmds)

    # Shuffle for diverse sampling
    rng.shuffle(all_commands)

    # Apply limit
    if limit is not None:
        all_commands = all_commands[:limit]

    # Stats
    if stats:
        from collections import Counter
        action_counts = Counter(c["expected_action"] for c in all_commands)
        difficulty_counts = Counter(c["difficulty"] for c in all_commands)
        binary_counts = Counter(c["binary"] for c in all_commands)
        logger.info(f"Total commands: {len(all_commands)}")
        logger.info(f"By action: {dict(action_counts)}")
        logger.info(f"By difficulty: {dict(difficulty_counts)}")
        logger.info(f"By binary: {dict(binary_counts)}")

    # Output
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("w") as fh:
            for cmd in all_commands:
                fh.write(json.dumps(cmd) + "\n")
        logger.info(f"Written {len(all_commands)} commands to {output}")
    else:
        for cmd in all_commands:
            sys.stdout.write(json.dumps(cmd) + "\n")


if __name__ == "__main__":
    app()
