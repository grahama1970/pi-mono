#!/usr/bin/env python3
"""Generate QRA expertise-level + reversal-curse variations via /scillm.

Pulls QRAs from sparta_qra, sends each through DeepSeek V3 via /scillm
using the qra_variations_v1 prompt, stores results back in sparta_qra
with parent_id linking to the original.

Usage:
    python generate_qra_variations.py [--limit 100] [--dry-run] [--offset 0]
"""

import json
import sys
import time
import hashlib
from pathlib import Path

import httpx

MEMORY_SOCKET = "/run/user/1000/embry/memory.sock"
SCILLM_URL = "http://localhost:4001"
SCILLM_API_KEY = "sk-dev-proxy-123"
PROMPT_PATH = Path("/home/graham/workspace/experiments/pi-mono/.pi/skills/prompt-lab/prompts/qra_variations_v1.txt")
MODEL = "deepseek-chat"  # DeepSeek V3 via Chutes


def memory_post(path: str, body: dict) -> dict:
    transport = httpx.HTTPTransport(uds=MEMORY_SOCKET)
    with httpx.Client(transport=transport, timeout=30) as client:
        resp = client.post(f"http://localhost{path}", json=body)
        resp.raise_for_status()
        return resp.json()


def scillm_chat(prompt: str) -> str | None:
    try:
        resp = httpx.post(
            f"{SCILLM_URL}/v1/chat/completions",
            headers={"Authorization": f"Bearer {SCILLM_API_KEY}"},
            json={
                "model": MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.7,
                "max_tokens": 2000,
            },
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"  WARN: scillm call failed: {e}", file=sys.stderr)
        return None


def fetch_qras(limit: int, offset: int) -> list[dict]:
    result = memory_post("/list", {
        "collection": "sparta_qra",
        "k": limit,
        "offset": offset,
        "return_fields": ["question", "answer", "control_id"],
        "sort_field": "_key",
        "sort_order": "ASC",
    })
    return result.get("documents", [])


def already_has_variations(parent_key: str) -> bool:
    """Check if this QRA already has variations stored."""
    try:
        result = memory_post("/recall", {
            "q": f"parent:{parent_key}",
            "collection": "sparta_qra",
            "k": 1,
        })
        for item in result.get("items", []):
            if f"parent:{parent_key}" in (item.get("tags") or []):
                return True
    except Exception:
        pass
    return False


def generate_variations(qra: dict) -> list[dict] | None:
    prompt_template = PROMPT_PATH.read_text()
    prompt = prompt_template.replace("{question}", qra.get("question", ""))
    prompt = prompt.replace("{answer}", qra.get("answer", ""))
    prompt = prompt.replace("{control_id}", qra.get("control_id", ""))

    response = scillm_chat(prompt)
    if not response:
        return None

    # Extract JSON from response
    try:
        # Handle markdown code blocks
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0]
        elif "```" in response:
            response = response.split("```")[1].split("```")[0]
        data = json.loads(response.strip())
        return data.get("variations", [])
    except (json.JSONDecodeError, IndexError) as e:
        print(f"  WARN: JSON parse failed: {e}", file=sys.stderr)
        return None


def store_variation(original_key: str, qra: dict, variation: dict, dry_run: bool) -> bool:
    question = variation.get("question", "")
    level = variation.get("level", "unknown")
    vtype = variation.get("type", "unknown")
    answer = qra.get("answer", "")
    control_id = qra.get("control_id", "")

    var_key = hashlib.md5(f"{original_key}:{level}:{question[:50]}".encode()).hexdigest()

    if dry_run:
        print(f"    DRY [{level}]: {question[:80]}")
        return True

    try:
        memory_post("/learn", {
            "collection": "sparta_qra",
            "problem": question,
            "solution": answer,
            "scope": "qra_variation",
            "tags": [
                f"parent:{original_key}",
                f"level:{level}",
                f"type:{vtype}",
                f"control:{control_id}",
                "qra-variation",
            ],
            "key": var_key,
        })
        return True
    except Exception as e:
        print(f"  WARN: store failed: {e}", file=sys.stderr)
        return False


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100, help="QRAs to process")
    parser.add_argument("--offset", type=int, default=0, help="Skip first N QRAs")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    qras = fetch_qras(args.limit, args.offset)
    print(f"Fetched {len(qras)} QRAs (offset={args.offset})")

    total_variations = 0
    total_stored = 0
    total_skipped = 0
    start = time.time()

    for i, qra in enumerate(qras):
        key = qra.get("_key", "")
        question = qra.get("question", "")[:60]
        control = qra.get("control_id", "")

        print(f"\n[{i+1}/{len(qras)}] {control} | {question}...")

        if already_has_variations(key):
            print("  SKIP (already has variations)")
            total_skipped += 1
            continue

        variations = generate_variations(qra)
        if not variations:
            print("  FAIL (no variations generated)")
            continue

        print(f"  Got {len(variations)} variations")
        total_variations += len(variations)

        for var in variations:
            if store_variation(key, qra, var, args.dry_run):
                total_stored += 1

    elapsed = time.time() - start
    calls_used = len(qras) - total_skipped
    print(f"\n{'='*60}")
    print(f"Done: {len(qras)} QRAs, {total_variations} variations, {total_stored} stored, {total_skipped} skipped")
    print(f"Scillm calls: {calls_used} | Time: {elapsed:.1f}s")
    if args.dry_run:
        print("(dry run — nothing written)")


if __name__ == "__main__":
    main()
