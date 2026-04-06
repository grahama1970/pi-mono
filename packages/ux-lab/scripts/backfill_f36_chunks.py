#!/usr/bin/env python3
"""Backfill F-36 HTML documents into datalake_chunks via /extractor.

Runs the extractor on each F-36 HTML file, then ingests the structured
blocks (text, tables, headings, paragraphs) into datalake_chunks with
component tags derived from the source directory.

Usage:
    python backfill_f36_chunks.py [--dry-run] [--limit N] [--component 03_weapons]
"""

import json
import subprocess
import sys
import hashlib
import time
from pathlib import Path

import httpx

F36_ROOT = Path("/mnt/storage12tb/f36_datalake")
EXTRACTOR = Path("/home/graham/workspace/experiments/pi-mono/.pi/skills/extractor/run.sh")
MEMORY_SOCKET = "/run/user/1000/embry/memory.sock"

COMPONENT_DIRS = [
    "01_avionics", "02_microprocessors", "03_weapons", "04_display_ux",
    "05_space_hardening", "06_dual_engine", "07_cybersecurity", "08_requirements",
    "09_flight_software", "10_test_evaluation", "11_program_management",
    "12_standards", "13_f35_legacy", "14_vendor_deliverables", "15_machine_test_logs",
    "16_legacy_lineage",
]


def memory_post(path: str, body: dict) -> dict:
    transport = httpx.HTTPTransport(uds=MEMORY_SOCKET)
    with httpx.Client(transport=transport, timeout=30) as client:
        resp = client.post(f"http://localhost{path}", json=body)
        resp.raise_for_status()
        return resp.json()


def extract_html(html_path: Path) -> dict | None:
    try:
        result = subprocess.run(
            [str(EXTRACTOR), str(html_path), "--fast", "--no-interactive", "--json"],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            print(f"  WARN: extractor failed for {html_path.name}: {result.stderr[:200]}", file=sys.stderr)
            return None
        return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        print(f"  WARN: {html_path.name}: {e}", file=sys.stderr)
        return None


def build_chunks(doc: dict, component: str, source_file: str) -> list[dict]:
    chunks = []
    doc_id = doc.get("id", "")
    title = doc.get("metadata", {}).get("title", source_file)
    hierarchy = doc.get("hierarchy", {})

    section_map: dict[str, list[str]] = {}

    def walk_hierarchy(node: dict, breadcrumb: list[str]):
        node_title = node.get("title", "")
        current = breadcrumb + ([node_title] if node_title else [])
        node_id = node.get("id", node.get("block_id", ""))
        if node_id:
            section_map[node_id] = current
        for child in node.get("children", []):
            walk_hierarchy(child, current)

    walk_hierarchy(hierarchy, [])

    for block in doc.get("blocks", []):
        block_type = block.get("type", "unknown")
        parent_id = block.get("parent_id", "root")
        breadcrumb = section_map.get(parent_id, [title])

        if block_type == "table":
            cells = block.get("cells", [])
            text = " | ".join(c.get("content", "") for c in cells[:20])
        else:
            text = block.get("text", block.get("content", ""))
            if isinstance(text, dict):
                text = str(text)

        if not text or len(str(text).strip()) < 5:
            continue

        text = str(text).strip()
        chunk_key = hashlib.md5(f"{source_file}:{block.get('id', '')}:{text[:100]}".encode()).hexdigest()

        chunk = {
            "_key": chunk_key,
            "doc_id": doc_id,
            "text": text,
            "asset_type": block_type.capitalize(),
            "source": source_file,
            "source_meta": {
                "text": text[:500],
                "section_id": parent_id,
                "section_title": breadcrumb[-1] if breadcrumb else "",
                "section_breadcrumb": breadcrumb,
                "component": component,
                "source_file": source_file,
                "block_type": block_type,
            },
            "content_type": "f36_datalake",
            "scope": "fort_worth_f36",
            "tags": [
                f"component:{component}",
                f"source:{source_file}",
                f"block_type:{block_type}",
                "f36-backfill",
            ],
        }

        if block_type == "table":
            chunk["source_meta"]["rows"] = block.get("rows", 0)
            chunk["source_meta"]["cols"] = block.get("cols", 0)
            chunk["source_meta"]["headers"] = block.get("headers", [])

        chunks.append(chunk)

    return chunks


def ingest_chunks(chunks: list[dict], dry_run: bool = False) -> int:
    ingested = 0
    for chunk in chunks:
        if dry_run:
            ingested += 1
            continue
        try:
            memory_post("/learn", {
                "collection": "datalake_chunks",
                "problem": chunk["text"][:500],
                "solution": json.dumps(chunk["source_meta"]),
                "scope": "fort_worth_f36",
                "tags": chunk["tags"],
                "key": chunk["_key"],
            })
            ingested += 1
        except Exception as e:
            print(f"  WARN: ingest failed for {chunk['_key']}: {e}", file=sys.stderr)
    return ingested


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Backfill F-36 HTML into datalake_chunks")
    parser.add_argument("--dry-run", action="store_true", help="Extract but don't ingest")
    parser.add_argument("--limit", type=int, default=0, help="Max files to process (0=all)")
    parser.add_argument("--component", type=str, default="", help="Only process this component dir")
    args = parser.parse_args()

    dirs = [args.component] if args.component else COMPONENT_DIRS
    total_files = 0
    total_chunks = 0
    total_ingested = 0
    start = time.time()

    for comp_dir in dirs:
        comp_path = F36_ROOT / comp_dir
        if not comp_path.is_dir():
            continue

        html_files = sorted(comp_path.glob("*.html"))
        if not html_files:
            continue

        component = comp_dir.split("_", 1)[-1] if "_" in comp_dir else comp_dir
        print(f"\n{'='*60}")
        print(f"Component: {comp_dir} ({len(html_files)} HTML files)")
        print(f"{'='*60}")

        for html_file in html_files:
            if args.limit and total_files >= args.limit:
                break

            total_files += 1
            print(f"  [{total_files}] {html_file.name}...", end=" ", flush=True)

            extracted = extract_html(html_file)
            if not extracted or "document" not in extracted:
                print("SKIP (no output)")
                continue

            chunks = build_chunks(extracted["document"], component, html_file.name)
            print(f"{len(chunks)} chunks...", end=" ", flush=True)
            total_chunks += len(chunks)

            ingested = ingest_chunks(chunks, dry_run=args.dry_run)
            total_ingested += ingested
            print(f"{'DRY' if args.dry_run else 'OK'} ({ingested} ingested)")

        if args.limit and total_files >= args.limit:
            break

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"Done: {total_files} files, {total_chunks} chunks, {total_ingested} ingested in {elapsed:.1f}s")
    if args.dry_run:
        print("(dry run — nothing was written to memory)")


if __name__ == "__main__":
    main()
