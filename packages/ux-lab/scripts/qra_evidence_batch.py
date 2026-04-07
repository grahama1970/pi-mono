#!/usr/bin/env python3
"""Nightly evidence case validation for QRA variations.

Fetches variations from sparta_qra, runs each through EvidenceCaseRunner,
compares verdict against the original QRA's evidence case. Tags mismatches.

Usage:
    python qra_evidence_batch.py [LIMIT]         # default 200
    python qra_evidence_batch.py 500 --dry-run   # preview without running
"""
import json
import sys
import time
from pathlib import Path

import httpx
from loguru import logger

SOCKET = "/run/user/1000/embry/memory.sock"
ARANGO = "http://127.0.0.1:8529"
ARANGO_AUTH = ("root", "openSesame")
EVIDENCE_CASE_DIR = Path("/home/graham/workspace/experiments/pi-mono/.pi/skills/create-evidence-case")
TARGET = int(sys.argv[1]) if len(sys.argv) > 1 else 200
DRY_RUN = "--dry-run" in sys.argv


def get_unchecked_variations(limit: int) -> list[dict]:
    """Find QRA variations that haven't been evidence-checked yet."""
    resp = httpx.post(f"{ARANGO}/_db/memory/_api/cursor", json={
        "query": """
        FOR d IN sparta_qra
        FILTER POSITION(d.tags, "qra-variation")
        FILTER !POSITION(d.tags, "evidence-checked")
        FILTER d.question != null AND LENGTH(d.question) > 10
        FILTER d.parent_qra_key != null
        LIMIT @limit
        RETURN {
            _key: d._key,
            question: d.question,
            answer: d.answer,
            control_id: d.control_id,
            parent_qra_key: d.parent_qra_key,
            variation_level: d.variation_level,
            variation_type: d.variation_type
        }
        """,
        "bindVars": {"limit": limit},
    }, auth=ARANGO_AUTH, timeout=120)
    return resp.json().get("result", [])


def get_parent_verdicts(parent_keys: list[str]) -> dict[str, str]:
    """Lookup existing evidence case verdicts for parent QRAs."""
    if not parent_keys:
        return {}
    resp = httpx.post(f"{ARANGO}/_db/memory/_api/cursor", json={
        "query": """
        FOR d IN evidence_case_labels
        FILTER d.source_key IN @keys
        RETURN {source_key: d.source_key, verdict: d.verdict_state}
        """,
        "bindVars": {"keys": parent_keys},
    }, auth=ARANGO_AUTH, timeout=60)
    results = resp.json().get("result", [])
    return {r["source_key"]: r["verdict"] for r in results}


def tag_as_checked(keys: list[str], verdict: str, mismatch: bool) -> int:
    """Tag variations as evidence-checked via /upsert."""
    transport = httpx.HTTPTransport(uds=SOCKET)
    docs = []
    for key in keys:
        tags = ["evidence-checked", f"ec-verdict:{verdict}"]
        if mismatch:
            tags.append("ec-mismatch")
        docs.append({"_key": key, "tags_append": tags})

    # Use AQL to append tags without overwriting existing ones
    updated = 0
    for key in keys:
        tag_list = ["evidence-checked", f"ec-verdict:{verdict}"]
        if mismatch:
            tag_list.append("ec-mismatch")
        resp = httpx.post(f"{ARANGO}/_db/memory/_api/cursor", json={
            "query": """
            LET doc = DOCUMENT(CONCAT("sparta_qra/", @key))
            LET existing = doc.tags || []
            LET new_tags = UNION_DISTINCT(existing, @new_tags)
            UPDATE {_key: @key} WITH {tags: new_tags, evidence_verdict: @verdict, evidence_mismatch: @mismatch} IN sparta_qra
            RETURN 1
            """,
            "bindVars": {"key": key, "new_tags": tag_list, "verdict": verdict, "mismatch": mismatch},
        }, auth=ARANGO_AUTH, timeout=30)
        updated += len(resp.json().get("result", []))
    return updated


def main():
    # Import EvidenceCaseRunner from the skill
    sys.path.insert(0, str(EVIDENCE_CASE_DIR))
    from runner import EvidenceCaseRunner

    variations = get_unchecked_variations(TARGET)
    logger.info("Found {} unchecked QRA variations (target: {})", len(variations), TARGET)
    if not variations:
        logger.info("All variations already evidence-checked. Nothing to do.")
        return

    if DRY_RUN:
        logger.info("DRY RUN: would process {} variations", len(variations))
        for v in variations[:5]:
            logger.info("  {} (parent: {}) — {}", v["_key"], v["parent_qra_key"], v["question"][:60])
        return

    # Get parent verdicts for comparison
    parent_keys = list({v["parent_qra_key"] for v in variations})
    parent_verdicts = get_parent_verdicts(parent_keys)
    logger.info("Found {} parent verdicts for comparison", len(parent_verdicts))

    runner = EvidenceCaseRunner()
    ok, fail, mismatch_count = 0, 0, 0
    start = time.monotonic()

    for i, var in enumerate(variations):
        try:
            result = runner.run(
                claim_text=var["question"],
                category="auto",
                show_progress=False,
            )
            verdict = result.get("verdict", {}).get("state", "unknown")
            parent_verdict = parent_verdicts.get(var["parent_qra_key"], "unknown")
            is_mismatch = (
                parent_verdict != "unknown"
                and verdict != parent_verdict
            )

            tag_as_checked([var["_key"]], verdict, is_mismatch)

            if is_mismatch:
                mismatch_count += 1
                logger.warning(
                    "MISMATCH: {} (variation={}, parent={}): var={}, parent={}",
                    var["_key"], var.get("variation_level", "?"),
                    var["parent_qra_key"], verdict, parent_verdict,
                )
            ok += 1
        except Exception as e:
            logger.error("FAIL on {}: {}", var["_key"], e)
            fail += 1
            time.sleep(2)

        time.sleep(1)  # rate limit
        if (i + 1) % 25 == 0:
            elapsed = time.monotonic() - start
            logger.info(
                "[{}/{}] {} ok, {} fail, {} mismatches ({:.0f}s elapsed)",
                i + 1, len(variations), ok, fail, mismatch_count, elapsed,
            )

    elapsed = time.monotonic() - start
    logger.info(
        "DONE: {} ok, {} fail, {} mismatches out of {} variations ({:.0f}s)",
        ok, fail, mismatch_count, len(variations), elapsed,
    )


if __name__ == "__main__":
    main()
