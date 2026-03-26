"""Data collection functions for evidence cases.

Calls the embry-memory daemon (Unix socket) for recall/learn,
skill subprocesses for entity extraction and other skills.
NO direct graph_memory imports — always go through the service.

Also includes question decomposition and evidence grouping helpers.
"""

from __future__ import annotations

import json
import os
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any

import httpx
from loguru import logger
from rich.console import Console

console = Console()

SKILLS_DIR = Path(__file__).resolve().parent.parent
ASSISTANT_SKILL = SKILLS_DIR / "assistant" / "run.sh"
EXTRACT_ENTITIES_SKILL = SKILLS_DIR / "extract-entities" / "run.sh"
LEAN4_PROVE_SKILL = SKILLS_DIR / "lean4-prove" / "run.sh"
DOGPILE_SKILL = SKILLS_DIR / "dogpile" / "run.sh"
EDGE_VERIFIER_SKILL = SKILLS_DIR / "edge-verifier" / "run.sh"
CMMC_ASSESSOR_SKILL = SKILLS_DIR / "cmmc-assessor" / "run.sh"

ASSISTANT_DIR = SKILLS_DIR / "assistant"
_assistant_path_added = False

# embry-memory daemon Unix socket
_MEMORY_SOCKET = os.environ.get(
    "EMBRY_MEMORY_SOCKET",
    f"/run/user/{os.getuid()}/embry/memory.sock",
)

# Lazy httpx client for memory daemon
_memory_http: httpx.Client | None = None


def _get_memory_http() -> httpx.Client:
    """Get or create httpx client connected to embry-memory Unix socket."""
    global _memory_http
    if _memory_http is None:
        transport = httpx.HTTPTransport(uds=_MEMORY_SOCKET)
        _memory_http = httpx.Client(
            transport=transport,
            base_url="http://localhost",
            timeout=30.0,
        )
    return _memory_http


def _memory_learn_direct(
    problem: str, solution: str, scope: str, tags: list[str],
) -> bool:
    """Learn to /memory via embry-memory daemon."""
    try:
        client = _get_memory_http()
        resp = client.post("/learn", json={
            "problem": problem,
            "solution": solution,
            "scope": scope,
            "tags": tags,
        })
        return resp.status_code == 200 and resp.json().get("stored", False)
    except Exception as exc:
        logger.warning("memory learn via daemon failed: {}", exc)
        return False


def _ensure_assistant_on_path() -> None:
    """Add /assistant skill directory to sys.path for direct imports.

    Uses importlib to pre-load assistant's models module under an alias,
    avoiding collision with create-evidence-case/models.py in sys.modules.
    """
    global _assistant_path_added
    if not _assistant_path_added and ASSISTANT_DIR.exists():
        import sys
        import importlib.util

        # Pre-load assistant's models.py as 'models' BEFORE gateway imports it,
        # but only if it hasn't been loaded from the wrong location yet.
        assistant_models = ASSISTANT_DIR / "models.py"
        if assistant_models.exists():
            spec = importlib.util.spec_from_file_location("models", str(assistant_models))
            mod = importlib.util.module_from_spec(spec)
            sys.modules["models"] = mod  # Override any cached wrong module
            spec.loader.exec_module(mod)

        if str(ASSISTANT_DIR) not in sys.path:
            sys.path.insert(0, str(ASSISTANT_DIR))
        _assistant_path_added = True


# ---------------------------------------------------------------------------
# Skill invocation (subprocess only — NO direct graph_memory imports)
# ---------------------------------------------------------------------------

def _extract_json_payload(text: str) -> dict | list | None:
    """Extract the first JSON object/array from mixed CLI output."""
    blob = (text or "").strip()
    if not blob:
        return None
    decoder = json.JSONDecoder()
    candidates = [i for i in (blob.find("{"), blob.find("[")) if i >= 0]
    for idx in sorted(candidates):
        try:
            parsed, _ = decoder.raw_decode(blob[idx:])
            if isinstance(parsed, (dict, list)):
                return parsed
        except json.JSONDecodeError:
            continue
    return None


def _invoke_skill(
    run_sh: Path,
    args: list[str],
    timeout: int = 30,
    env: dict[str, str] | None = None,
) -> dict | None:
    """Invoke a sibling skill and parse JSON output. Returns None on failure."""
    if not run_sh.exists():
        logger.debug("skill not found: {}", run_sh)
        return None
    cmd = [str(run_sh)] + args
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
        payload = _extract_json_payload(proc.stdout) or _extract_json_payload(proc.stderr)
        if proc.returncode != 0 and payload is None:
            err = (proc.stderr or proc.stdout or "").strip()[:200]
            logger.warning("skill {} failed rc={} args={} err={}", run_sh.name, proc.returncode, args[:4], err)
            return None
        if isinstance(payload, dict):
            return payload
        return None
    except (subprocess.TimeoutExpired, OSError) as exc:
        logger.debug("skill invocation failed: {} — {}", run_sh.name, exc)
        return None


def _is_meta_item(item: dict) -> bool:
    """Check if a recall item is routing/meta (not substantive content)."""
    tags = item.get("tags", [])
    sol = item.get("solution", "")
    if "RecallResult" in sol:
        return True
    for t in tags:
        if t in ("routing", "global_standard", "pi_harness",
                 "found_false_default", "evidence_case", "skill_route"):
            return True
    return False


def _filter_meta_items(items: list[dict]) -> list[dict]:
    """Remove routing/meta lessons from memory results."""
    filtered = [i for i in items if not _is_meta_item(i)]
    return filtered or items


def _shadow_assistant(task: str, data: dict) -> None:
    """Fire-and-forget /assistant shadow call for training label collection."""
    try:
        if not ASSISTANT_SKILL.exists():
            return
        input_json = json.dumps(data, default=str)[:2000]
        subprocess.Popen(
            [str(ASSISTANT_SKILL), "classify", "--task", task, "--input", input_json],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Data collection — call skills, return raw results for agent reasoning
# ---------------------------------------------------------------------------

def collect_recall(question: str, k: int = 20) -> list[dict]:
    """Call /memory recall via embry-memory daemon (BM25 via ArangoSearch).

    The daemon uses TOKENS() ANY IN on ArangoSearch views with text_en
    analyzer (stop words + Snowball stemming). No substring matching.
    Fails loudly (503) if ArangoDB or views are unavailable.
    """
    try:
        client = _get_memory_http()
        resp = client.post("/recall", json={
            "q": question[:400],
            "collection": "sparta_qra",
            "limit": k,
        })
        if resp.status_code != 200:
            logger.error("memory recall returned {}: {}", resp.status_code, resp.text[:200])
            return []
        data = resp.json()
    except Exception as exc:
        logger.warning("memory recall via daemon failed: {}", exc)
        return []

    raw_items = data.get("results", [])
    if not raw_items:
        return []

    items = _filter_meta_items(raw_items)
    return [
        item for item in items
        if len(item.get("answer", item.get("solution", item.get("text", "")))) > 20
    ]


def collect_entities(question: str) -> dict | None:
    """Extract entities from question text via /extract-entities skill.

    Uses subprocess to call the skill, which connects to ArangoDB via
    the service. No direct graph_memory imports.
    """
    result = _invoke_skill(EXTRACT_ENTITIES_SKILL, [
        "extract", "--json", question[:500],
    ], timeout=20)

    if result and (result.get("all_control_ids") or result.get("control_ids")):
        # Bridge unresolved_terms into warnings list for plausibility gate.
        warnings = []
        for ut in result.get("unresolved_terms", []):
            warnings.append({
                "term": ut.get("term", ""),
                "category": "fabricated_id" if ut.get("type") == "id_like" else "not_in_corpus",
                "type": ut.get("type", "phrase"),
            })
        for ms in result.get("misspellings", []):
            warnings.append({
                "term": ms.get("term", ""),
                "category": "misspelling",
                "type": "misspelling",
                "suggestion": ms.get("suggestion", ""),
            })
        result["warnings"] = warnings
        result["method"] = "extract_entities"
        return result

    # Last resort: derive control IDs from structured recall fields only.
    fallback_items = collect_recall(question, k=8)
    found_ids = sorted({
        item.get("control_id", "")
        for item in fallback_items
        if item.get("control_id")
    })
    return {
        "all_control_ids": found_ids,
        "control_ids": found_ids,
        "phrases": [],
        "related_pairs": [],
        "method": "recall_fallback" if found_ids else "extract_entities_unavailable",
    }


def collect_topic(question: str) -> dict:
    """Classify question topic via keyword heuristic + /assistant."""
    from strategies import auto_categorize

    category = auto_categorize(question)
    if category != "general":
        return {"on_topic": True, "category": category, "method": "keyword_heuristic"}

    try:
        _ensure_assistant_on_path()
        from gateway import classify as assistant_classify
        result = assistant_classify(text=question[:500], task="topic-classifier")
        if result and hasattr(result, "prediction") and result.prediction:
            label = result.prediction
            if label.lower() not in ("off_topic", "unknown", "general"):
                return {"on_topic": True, "category": label, "method": "assistant_classifier"}
    except (ImportError, Exception) as exc:
        logger.debug("direct assistant classify failed: {}", exc)
        resp = _invoke_skill(ASSISTANT_SKILL, [
            "classify", "--task", "topic-classifier", "--text", question[:500],
        ], timeout=15)
        if resp and isinstance(resp, dict):
            label = resp.get("label", resp.get("class", ""))
            if label and label.lower() not in ("off_topic", "unknown", "general"):
                return {"on_topic": True, "category": label, "method": "assistant_classifier"}

    return {"on_topic": False, "category": "general", "method": "no_match"}


def collect_clarify(question: str) -> dict | None:
    """Call /memory clarify via embry-memory daemon."""
    try:
        client = _get_memory_http()
        resp = client.post("/clarify", json={"q": question[:500]})
        if resp.status_code == 200:
            return resp.json()
    except Exception as exc:
        logger.warning("memory clarify via daemon failed: {}", exc)
    return None


def collect_lean4_provable(question: str, control_ids: list[str]) -> dict | None:
    """Check if a question is Lean4-formalizable via the lean4_provable classifier."""
    text = f"Requirement: {question[:400]}"
    if control_ids:
        text += f"\nControl: {', '.join(control_ids[:5])}"

    try:
        _ensure_assistant_on_path()
        from gateway import classify as assistant_classify
        result = assistant_classify(text=text, task="lean4_provable")
        if result and hasattr(result, "prediction"):
            return {
                "prediction": result.prediction,
                "confidence": getattr(result, "confidence", 0.0),
                "tier": getattr(result, "tier", -1),
                "source": getattr(result, "source", "unknown"),
            }
    except (ImportError, Exception) as exc:
        logger.debug("direct lean4_provable classify failed: {}", exc)

    return _invoke_skill(ASSISTANT_SKILL, [
        "classify", "--task", "lean4_provable", "--text", text,
    ], timeout=25)


LEAN4_SERVICE_URL = os.environ.get("LEAN4_SERVICE_URL", "http://127.0.0.1:8604")


def compile_lean4(code: str, timeout: int = 60) -> dict:
    """Compile Lean4 code via the Docker HTTP service.

    The AGENT generates the Lean4 theorem. This function just compiles it.
    No claude -p, no subprocess — just an HTTP POST to the lean_runner container.

    Returns dict with: success, stdout, error, elapsed_ms
    """
    import urllib.request
    import urllib.error

    try:
        req = urllib.request.Request(
            f"{LEAN4_SERVICE_URL}/compile",
            data=json.dumps({"code": code}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.URLError as exc:
        return {"success": False, "error": f"Lean4 service unreachable: {exc}"}
    except Exception as exc:
        return {"success": False, "error": f"Lean4 compile error: {exc}"}


def collect_dogpile(query: str) -> dict | None:
    """Call /dogpile for Tier 3 research when recall is sparse."""
    return _invoke_skill(DOGPILE_SKILL, [
        "search", query[:500], "--auto-preset",
    ], timeout=60)


def collect_cmmc(level: int, family: str) -> dict | None:
    """Call /cmmc-assessor for CMMC compliance mapping."""
    return _invoke_skill(CMMC_ASSESSOR_SKILL, [
        "assess", "--level", str(level), "--family", family,
    ], timeout=30)


def collect_edge_verify(source_id: str, text: str) -> dict | None:
    """Call /edge-verifier to validate cross-component entity relationships."""
    return _invoke_skill(EDGE_VERIFIER_SKILL, [
        "verify", "--source_id", source_id, "--text", text[:500],
    ], timeout=30)


# ---------------------------------------------------------------------------
# Question decomposition and evidence grouping
# ---------------------------------------------------------------------------

def decompose_sentence(question: str, agent_decomposition: dict | None = None) -> dict:
    """Decompose a question into Given/Then components.

    The AGENT should provide the decomposition via agent_decomposition.
    The heuristic fallback below is for the automated question bank ONLY.
    """
    import re

    if agent_decomposition:
        return {
            "question": question,
            "given_components": agent_decomposition.get("given_components", []),
            "then_components": agent_decomposition.get("then_components", []),
            "component_queries": agent_decomposition.get("component_queries", {}),
            "component_entity_types": agent_decomposition.get("component_entity_types", {}),
            "mermaid": "",
            "source": "agent",
        }

    # --- Heuristic fallback for automated question bank ---
    given_components: list[str] = []
    then_components: list[str] = []
    component_queries: dict[str, str] = {}
    component_entity_types: dict[str, str] = {}

    text = question.strip().rstrip("?")

    m = re.match(r"(?i)given\s+(.+?),\s*(which|what|how|where)\s+(.+)", text)
    if m:
        given_components.append(m.group(1).strip())
        then_components.append(m.group(3).strip())
    else:
        parts = re.split(
            r"\b(?:align with|protect.*?from|apply.*?to|defend against|"
            r"comply with|map to|prioritize in|pose to|adjusted? for)\b",
            text, maxsplit=1, flags=re.IGNORECASE,
        )
        if len(parts) == 2:
            given_components.append(parts[0].strip().strip(","))
            then_components.append(parts[1].strip().strip(","))
        else:
            then_components.append(text)

    for comp in given_components:
        component_queries[comp] = comp
        component_entity_types[comp] = "scope"
    for comp in then_components:
        component_queries[comp] = comp
        component_entity_types[comp] = "target"

    return {
        "question": question,
        "given_components": given_components,
        "then_components": then_components,
        "component_queries": component_queries,
        "component_entity_types": component_entity_types,
        "mermaid": "",
        "source": "heuristic_fallback",
    }


def collect_per_component(decomposition: dict) -> dict[str, list[dict]]:
    """Run /memory recall per component and return results keyed by component name."""
    component_results: dict[str, list[dict]] = {}
    all_components = (
        decomposition.get("given_components", []) +
        decomposition.get("then_components", [])
    )
    for comp in all_components:
        query = decomposition.get("component_queries", {}).get(comp, comp)
        items = collect_recall(query)
        component_results[comp] = items
    return component_results


def _grade_item_confidence(item: dict) -> float:
    """Grade evidence confidence based on data quality signals.

    Returns float in [0.0, 1.0].
    """
    score = item.get("score", item.get("recall_score", 0))
    if score and isinstance(score, (int, float)) and score > 0:
        return min(1.0, max(0.0, float(score)))

    conf = 0.1
    if item.get("control_id"):
        conf += 0.3
    tags = item.get("tactical_tags", [])
    if tags and isinstance(tags, list) and any(t for t in tags):
        conf += 0.2
    answer = item.get("answer", item.get("solution", "")) or ""
    if len(answer) > 100:
        conf += 0.2
    if item.get("question"):
        conf += 0.1
    if "hypothesized" not in answer.lower()[:30]:
        conf += 0.1
    return min(1.0, conf)


def group_by_technique(items: list[dict]) -> dict[str, list[dict]]:
    """Group recall items by tactical_tags from the QRA data."""
    groups: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        tags = item.get("tactical_tags", [])
        if tags and isinstance(tags, list) and tags[0]:
            tid = tags[0]
        else:
            tid = item.get("control_id", "UNTAGGED")
        groups[tid].append(item)
    return dict(groups)
