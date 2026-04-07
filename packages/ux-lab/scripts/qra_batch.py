#!/usr/bin/env python3
"""Nightly QRA variation batch. Finds QRAs without variations, generates 6 per QRA.

Uses /scillm model=text (Chutes DeepSeek V3) for generation.
Writes to sparta_qra via /upsert with parent_qra_key linkage.
Auto-detects offset: skips QRAs that already have variations.
"""
import hashlib
import json
import sys
import time
from pathlib import Path

import httpx

SOCKET = "/run/user/1000/embry/memory.sock"
ARANGO = "http://127.0.0.1:8529"
ARANGO_AUTH = ("root", "openSesame")
SCILLM = "http://localhost:4001/v1/chat/completions"
SCILLM_KEY = "sk-dev-proxy-123"
PROMPT = Path("/home/graham/workspace/experiments/pi-mono/.pi/skills/prompt-lab/prompts/qra_variations_v1.txt").read_text()
TARGET = int(sys.argv[1]) if len(sys.argv) > 1 else 800


def get_qras_without_variations(limit: int) -> list[dict]:
    """Find original QRAs that don't have variations yet."""
    resp = httpx.post(f"{ARANGO}/_db/memory/_api/cursor", json={
        "query": """
        LET parents_done = (FOR d IN sparta_qra FILTER POSITION(d.tags, "qra-variation") COLLECT p = d.parent_qra_key RETURN p)
        FOR d IN sparta_qra
        FILTER !POSITION(d.tags, "qra-variation")
        FILTER d._key NOT IN parents_done
        FILTER d.question != null AND LENGTH(d.question) > 10
        LIMIT @limit
        RETURN {_key: d._key, question: d.question, answer: d.answer, control_id: d.control_id}
        """,
        "bindVars": {"limit": limit},
    }, auth=ARANGO_AUTH, timeout=120)
    return resp.json().get("result", [])


def generate_and_store(qras: list[dict]) -> tuple[int, int, int]:
    ok, fail, stored = 0, 0, 0
    transport = httpx.HTTPTransport(uds=SOCKET)

    for i, qra in enumerate(qras):
        q = qra.get("question", "")
        a = qra.get("answer", "")
        cid = qra.get("control_id", "")
        parent_key = qra.get("_key", "")
        filled = PROMPT.replace("{question}", q).replace("{answer}", a).replace("{control_id}", cid)

        try:
            resp = httpx.post(SCILLM, headers={"Authorization": f"Bearer {SCILLM_KEY}"}, json={
                "model": "text", "messages": [{"role": "user", "content": filled}],
                "temperature": 0.7, "max_tokens": 2000,
            }, timeout=90)
            content = resp.json()["choices"][0]["message"]["content"]
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            variations = json.loads(content.strip()).get("variations", [])

            docs = []
            for v in variations:
                level = v.get("level", "unknown")
                vtype = v.get("type", "unknown")
                vq = v.get("question", "")
                key_hash = hashlib.md5(f"{parent_key}:{level}:{vq[:80]}".encode()).hexdigest()[:16]
                doc_key = f"qra_var__{parent_key}__{key_hash}"
                docs.append({
                    "_key": doc_key,
                    "run_id": f"variation_nightly_{parent_key}",
                    "qra_id": doc_key,
                    "question": vq,
                    "answer": a,
                    "control_id": cid,
                    "parent_qra_key": parent_key,
                    "variation_level": level,
                    "variation_type": vtype,
                    "tags": [f"parent:{parent_key}", f"level:{level}", f"type:{vtype}", f"control:{cid}", "qra-variation"],
                    "source": "qra_variation_nightly",
                })

            if docs:
                with httpx.Client(transport=transport, base_url="http://localhost", timeout=30) as mc:
                    r = mc.post("/upsert", json={"collection": "sparta_qra", "documents": docs}).json()
                stored += r.get("inserted", 0) + r.get("updated", 0)
            ok += 1
        except (json.JSONDecodeError, KeyError, IndexError, httpx.HTTPError) as e:
            fail += 1
            time.sleep(5)

        time.sleep(2)
        if (i + 1) % 50 == 0:
            print(f"  [{i+1}/{len(qras)}] {ok} ok, {fail} fail, {stored} stored", flush=True)

    return ok, fail, stored


def main():
    qras = get_qras_without_variations(TARGET)
    print(f"Found {len(qras)} QRAs without variations (target: {TARGET})", flush=True)
    if not qras:
        print("All QRAs already have variations. Nothing to do.", flush=True)
        return

    ok, fail, stored = generate_and_store(qras)
    print(f"DONE: {ok} ok, {fail} fail, {stored} variations stored in sparta_qra", flush=True)


if __name__ == "__main__":
    main()
