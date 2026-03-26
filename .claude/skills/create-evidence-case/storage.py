"""Persistence layer for evidence cases via /memory.

All ArangoDB access goes through /memory learn and /memory recall.
No raw AQL — per CLAUDE.md rules.

Inputs: Node dicts from models.py.
Outputs: Stored/retrieved evidence trees.
Failures: subprocess errors logged, never raised (graceful degradation).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from loguru import logger

MEMORY_SKILL = Path(__file__).parent.parent / "memory" / "run.sh"
STORAGE_ROOT = Path("/mnt/storage12tb/skills/create-evidence-case")
UCT_CACHE = STORAGE_ROOT / "uct_cache"
AUDIT_LOG = STORAGE_ROOT / "audit_logs"

# Fallback if 12TB not mounted
if not STORAGE_ROOT.exists():
    STORAGE_ROOT = Path(__file__).parent / "state"
    UCT_CACHE = STORAGE_ROOT / "uct_cache"
    AUDIT_LOG = STORAGE_ROOT / "audit_logs"
    UCT_CACHE.mkdir(parents=True, exist_ok=True)
    AUDIT_LOG.mkdir(parents=True, exist_ok=True)


def _extract_json_payload(text: str) -> dict[str, Any] | None:
    """Extract first JSON object from mixed stdout/stderr."""
    blob = (text or "").strip()
    if not blob:
        return None
    decoder = json.JSONDecoder()
    idx = blob.find("{")
    if idx < 0:
        return None
    try:
        parsed, _ = decoder.raw_decode(blob[idx:])
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def _run_memory(args: list[str], input_text: str | None = None) -> dict[str, Any]:
    """Run a /memory command and parse JSON output."""
    cmd = [str(MEMORY_SKILL)] + args
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            input=input_text,
        )
        payload = _extract_json_payload(result.stdout) or _extract_json_payload(result.stderr)
        if payload is None:
            err = (result.stderr or result.stdout or "").strip()[:200]
            return {"meta": {"ok": False}, "error": err or "empty output"}
        if result.returncode != 0 and not payload.get("meta", {}).get("ok", False):
            err = (result.stderr or result.stdout or "").strip()[:200]
            return {"meta": {"ok": False}, "error": err or f"memory rc={result.returncode}"}
        return payload
    except (subprocess.TimeoutExpired, OSError) as exc:
        logger.warning("memory command failed: {} — {}", " ".join(args[:3]), exc)
        return {"meta": {"ok": False}, "error": str(exc)}


class EvidenceCaseStore:
    """CRUD for evidence case trees via /memory."""

    @staticmethod
    def learn_node(node: dict, scope: str = "evidence_cases") -> bool:
        """Store a single node via /memory learn.

        /memory learn CLI signature: --problem TEXT --solution TEXT [--scope] [--tag TAG ...]
        We encode the node as JSON in --problem (the searchable field) and
        put a human summary in --solution.
        """
        tags = ["evidence_case", node.get("node_type", "unknown")]
        if node.get("category"):
            tags.append(node["category"])

        node_json = json.dumps(node, default=str)
        node_type = node.get("node_type", "unknown")
        node_id = node.get("id", "?")

        # Use human-readable text as --problem (for taxonomy extraction),
        # structured JSON as --solution (for programmatic recall)
        if node_type == "claim":
            problem = f"Evidence case claim: {node.get('text', '')}"
            solution = node_json
        elif node_type == "strategy":
            problem = f"Evidence strategy: {node.get('name', '')} score={node.get('score', 0):.3f}"
            solution = node_json
        elif node_type == "evidence":
            problem = f"Evidence: {node.get('method', '')} via {node.get('layer', '')} confidence={node.get('confidence', 0):.2f}"
            solution = node_json
        elif node_type == "verdict":
            problem = f"Evidence verdict: {node.get('state', '')} grade={node.get('grade', '')} — {node.get('reasoning', '')[:200]}"
            solution = node_json
        else:
            problem = node_json
            solution = f"{node_type} {node_id}"

        args = ["learn", "--problem", problem, "--solution", solution, "--scope", scope]
        for t in tags:
            args.extend(["--tag", t])

        resp = _run_memory(args)
        ok = resp.get("meta", {}).get("ok", False)
        if not ok:
            logger.warning("learn_node failed for {}: {}", node_id, resp.get("error"))
        return ok

    @staticmethod
    def learn_edge(from_id: str, to_id: str, relation: str, scope: str = "evidence_cases") -> bool:
        """Store an edge via /memory learn."""
        edge_json = json.dumps({"from": from_id, "to": to_id, "relation": relation})
        summary = f"edge: {from_id} --[{relation}]--> {to_id}"
        args = [
            "learn", "--problem", edge_json, "--solution", summary,
            "--scope", scope, "--tag", "evidence_edge", "--tag", relation,
        ]
        resp = _run_memory(args)
        return resp.get("meta", {}).get("ok", False)

    @staticmethod
    def recall_strategies(category: str, scope: str = "evidence_cases") -> list[dict]:
        """Recall UCT history for a category."""
        query = f"evidence strategy node_type:strategy category:{category}"
        args = ["recall", "--q", query, "--scope", scope, "--tags", "evidence_case,strategy"]
        resp = _run_memory(args)

        items = resp.get("items", resp.get("results", []))
        if not items:
            return []

        strategies = []
        for item in items:
            # /memory recall returns items with problem/solution fields
            text = item.get("solution", item.get("problem", item.get("text", item.get("content", ""))))
            try:
                parsed = json.loads(text) if isinstance(text, str) else text
                if isinstance(parsed, dict) and parsed.get("node_type") == "strategy":
                    strategies.append(parsed)
            except (json.JSONDecodeError, TypeError):
                continue
        return strategies

    @staticmethod
    def recall_case(case_id: str, scope: str = "evidence_cases") -> dict | None:
        """Recall a full evidence case by claim ID."""
        args = ["recall", "--q", f"evidence_case claim id:{case_id}", "--scope", scope, "--tags", "evidence_case,claim"]
        resp = _run_memory(args)

        items = resp.get("items", resp.get("results", []))
        for item in items:
            text = item.get("solution", item.get("problem", item.get("text", item.get("content", ""))))
            try:
                parsed = json.loads(text) if isinstance(text, str) else text
                if isinstance(parsed, dict) and parsed.get("id") == case_id:
                    return parsed
            except (json.JSONDecodeError, TypeError):
                continue
        return None

    @staticmethod
    def save_uct_cache(category: str, strategies: list[dict]) -> None:
        """Save UCT state to local disk cache for fast exploit lookups."""
        cache_file = UCT_CACHE / f"{category}.json"
        try:
            cache_file.write_text(json.dumps(strategies, indent=2, default=str))
        except OSError as exc:
            logger.warning("uct cache write failed: {}", exc)

    @staticmethod
    def load_uct_cache(category: str) -> list[dict]:
        """Load UCT state from local disk cache."""
        cache_file = UCT_CACHE / f"{category}.json"
        if not cache_file.exists():
            return []
        try:
            return json.loads(cache_file.read_text())
        except (json.JSONDecodeError, OSError):
            return []

    @staticmethod
    def append_audit(case_id: str, entry: dict) -> None:
        """Append to audit log (append-only JSONL)."""
        log_file = AUDIT_LOG / f"{case_id}.jsonl"
        try:
            with log_file.open("a") as f:
                f.write(json.dumps(entry, default=str) + "\n")
        except OSError as exc:
            logger.warning("audit log write failed: {}", exc)
