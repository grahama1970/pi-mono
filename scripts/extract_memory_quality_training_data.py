#!/usr/bin/env python3
"""
Extract training data for memory quality classifier.

Recalls existing persona memories, labels them on two axes:
- content_quality: grounded | thin | ambiguous
- taxonomy_quality: correct | vague | missing | wrong

Outputs JSONL suitable for /create-classifier train-text-multilabel.

Usage:
    python scripts/extract_memory_quality_training_data.py
    python scripts/extract_memory_quality_training_data.py --dry-run
    python scripts/extract_memory_quality_training_data.py --scopes horus-lore,behavioral
"""

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

# Add skill paths
SKILLS_DIR = Path(__file__).resolve().parent.parent / ".pi" / "skills"
sys.path.insert(0, str(SKILLS_DIR))
sys.path.insert(0, str(SKILLS_DIR / "common"))

MEMORY_RUN_SH = SKILLS_DIR / "memory" / "run.sh"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data"

# Bridge names — used to detect literal bridge name matches
BRIDGE_NAMES = {"precision", "resilience", "fragility", "corruption", "loyalty", "stealth", "intimacy"}

# Bridge opposition map
BRIDGE_OPPOSITIONS = {
    "Fragility": "Resilience",
    "Resilience": "Fragility",
    "Corruption": "Loyalty",
    "Loyalty": "Corruption",
    "Stealth": "Precision",
    "Precision": "Stealth",
    "Intimacy": "Stealth",
}

# Default scopes to scan with topic-specific queries
# (memory recall needs real queries, not wildcards)
DEFAULT_SCOPE_QUERIES = {
    "horus-lore": [
        "Horus Emperor Imperium legion primarch",
        "siege battle war loyalty oath duty honor",
        "corruption betrayal chaos fall darkness",
        "Dorn resilience defense endurance survival",
        "Magnus fragility loss broken shattered",
    ],
    "horus-dream-journals": [
        "dream reflection journal memory",
        "sensory touch smell taste vision",
        "contradiction tension bridge",
    ],
    "embry-behavioral": [
        "behavioral emotion cognitive psychology",
        "persona memory experience",
    ],
    "behavioral": [
        "behavioral neuroscience psychology emotion",
        "stress decision memory consolidation",
        "dream sleep REM NREM sensory",
    ],
    "dream-research": [
        "dream sensory touch smell taste proprioception",
        "memory consolidation sleep REM NREM",
        "TMR targeted reactivation olfactory",
        "embodied cognition body dream",
    ],
    "operational": [
        "deployment pipeline build test error",
        "memory skill taxonomy bridge",
        "classifier training inference model",
    ],
    # Also scan the sanity test scope
    "sanity-memory-quality-test": [
        "Prospero Magnus loss grief sorrow",
        "Dorn siege endurance triumph survival",
    ],
}


def recall_memories(scope: str, queries: list[str] | None = None, k: int = 200) -> list[dict]:
    """Recall memories from a scope using multiple queries to get coverage."""
    if not queries:
        queries = ["memory lesson knowledge experience"]

    seen_keys = set()
    all_items = []

    for query in queries:
        cmd = [
            "bash", str(MEMORY_RUN_SH),
            "recall",
            "--q", query,
            "--scope", scope,
        ]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
                cwd=str(MEMORY_RUN_SH.parent),
            )
            stdout = result.stdout.strip()
            if not stdout:
                continue

            # Parse JSON response
            data = None
            for line in stdout.split("\n"):
                line = line.strip()
                if line.startswith("{"):
                    try:
                        data = json.loads(line)
                        break
                    except json.JSONDecodeError:
                        continue
            if not data:
                try:
                    data = json.loads(stdout)
                except json.JSONDecodeError:
                    continue

            for item in data.get("items", []):
                key = item.get("_key", "")
                if key and key not in seen_keys:
                    seen_keys.add(key)
                    all_items.append(item)
        except Exception:
            continue

    return all_items


def has_event_anchor(text: str) -> bool:
    """Check if text references a specific event, entity, or temporal marker."""
    event_patterns = [
        # Named entities (proper nouns — capitalized words)
        r"\b[A-Z][a-z]{2,}\b",
        # Dates and temporal markers
        r"\b(yesterday|today|last\s+\w+|during|when|after|before)\b",
        # Specific locations
        r"\b(at\s+the|in\s+the|on\s+the)\b",
        # Action verbs indicating specific events
        r"\b(watched|built|destroyed|held|broke|completed|deployed|ran|fought)\b",
    ]
    matches = sum(1 for p in event_patterns if re.search(p, text, re.IGNORECASE))
    return matches >= 2  # Need at least 2 event indicators


def has_literal_bridge_name(text: str, bridges: list[str]) -> bool:
    """Check if text contains literal bridge attribute names (bad signal)."""
    text_lower = text.lower()
    for bridge in bridges:
        # Check if the bridge NAME appears in text (not just matched keywords)
        if bridge.lower() in text_lower:
            # Check if it's actually used as a descriptor (bad)
            # vs mentioned in metadata/tags context (acceptable)
            patterns = [
                rf"\bfeel\s+{bridge.lower()}\b",
                rf"\bfelt\s+{bridge.lower()}\b",
                rf"\bis\s+{bridge.lower()}\b",
                rf"\bwas\s+{bridge.lower()}\b",
                rf"\bseems?\s+{bridge.lower()}\b",
                rf"\b{bridge.lower()}\s+today\b",
            ]
            if any(re.search(p, text_lower) for p in patterns):
                return True
    return False


def label_memory(item: dict) -> dict:
    """Label a memory item on content_quality and taxonomy_quality axes."""
    problem = item.get("problem", "")
    solution = item.get("solution", "")
    text = f"{problem} {solution}".strip()
    tags = item.get("tags", [])
    bridge_attrs = item.get("bridge_attributes", [])

    # Import taxonomy functions
    try:
        from taxonomy_core import get_bridge_attributes, extract_sensory_modalities
        extracted_bridges = get_bridge_attributes(text)
        sensory = extract_sensory_modalities(text)
    except ImportError:
        extracted_bridges = []
        sensory = []

    # ── Content Quality ──
    has_event = has_event_anchor(text)
    has_sensory = len(sensory) > 0
    has_bridges = len(extracted_bridges) > 0
    text_length = len(text)

    if has_event and has_sensory and has_bridges and text_length > 80:
        content_label = "grounded"
    elif has_bridges and (has_event or has_sensory) and text_length > 40:
        content_label = "thin"
    else:
        content_label = "ambiguous"

    # ── Taxonomy Quality ──
    if not bridge_attrs and not extracted_bridges:
        taxonomy_label = "missing"
    elif has_literal_bridge_name(text, bridge_attrs or extracted_bridges):
        taxonomy_label = "vague"  # Bridge came from literal name match
    elif bridge_attrs:
        # Verify bridges make sense for the content
        # Check if extracted bridges match stored bridges
        if extracted_bridges and set(extracted_bridges) & set(bridge_attrs):
            taxonomy_label = "correct"
        elif extracted_bridges and not (set(extracted_bridges) & set(bridge_attrs)):
            # Bridges don't match — possible wrong tagging
            taxonomy_label = "wrong"
        else:
            taxonomy_label = "correct"  # Trust stored bridges if we can't re-extract
    else:
        taxonomy_label = "vague"

    # ── Deficits ──
    deficits = []
    if not has_event:
        deficits.append("no_event_anchor")
    if not has_sensory:
        deficits.append("no_sensory")
    if not has_bridges:
        deficits.append("no_bridges")
    if has_literal_bridge_name(text, bridge_attrs or extracted_bridges):
        deficits.append("literal_bridge_name")
    if text_length < 40:
        deficits.append("too_short")

    return {
        "text": text,
        "content_label": content_label,
        "taxonomy_label": taxonomy_label,
        "bridges_found": extracted_bridges,
        "bridges_stored": bridge_attrs,
        "sensory_found": sensory,
        "deficits": deficits,
        "scope": item.get("scope", ""),
        "source": item.get("added_by", "unknown"),
        "has_event": has_event,
        "has_sensory": has_sensory,
        "text_length": text_length,
    }


def main():
    """Extract memory quality training data based on specified scopes."""
    parser = argparse.ArgumentParser(description="Extract memory quality training data")
    parser.add_argument("--scopes", type=str, default=",".join(DEFAULT_SCOPE_QUERIES.keys()),
                        help="Comma-separated scopes to scan")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--output", type=str, default=str(OUTPUT_DIR / "memory_quality_labels.jsonl"))
    args = parser.parse_args()

    scopes = [s.strip() for s in args.scopes.split(",") if s.strip()]

    print("=" * 60)
    print("Memory Quality Training Data Extraction")
    print("=" * 60)
    print(f"Scopes: {scopes}")
    print(f"Output: {args.output}")
    print(f"Dry run: {args.dry_run}")

    all_labeled = []
    content_counts = Counter()
    taxonomy_counts = Counter()
    deficit_counts = Counter()

    for scope in scopes:
        print(f"\n── Scanning scope: {scope} ──")
        queries = DEFAULT_SCOPE_QUERIES.get(scope, ["memory lesson knowledge experience"])
        items = recall_memories(scope, queries=queries)
        print(f"  Retrieved {len(items)} memories")

        for item in items:
            labeled = label_memory(item)
            labeled["scope"] = scope
            all_labeled.append(labeled)

            content_counts[labeled["content_label"]] += 1
            taxonomy_counts[labeled["taxonomy_label"]] += 1
            for d in labeled["deficits"]:
                deficit_counts[d] += 1

    # Report stats
    print("\n" + "=" * 60)
    print("Distribution Stats")
    print("=" * 60)

    print(f"\nTotal memories scanned: {len(all_labeled)}")

    print("\nContent Quality:")
    for label, count in content_counts.most_common():
        pct = (count / len(all_labeled) * 100) if all_labeled else 0
        print(f"  {label:12s}: {count:4d} ({pct:.1f}%)")

    print("\nTaxonomy Quality:")
    for label, count in taxonomy_counts.most_common():
        pct = (count / len(all_labeled) * 100) if all_labeled else 0
        print(f"  {label:12s}: {count:4d} ({pct:.1f}%)")

    print("\nDeficits:")
    for deficit, count in deficit_counts.most_common():
        pct = (count / len(all_labeled) * 100) if all_labeled else 0
        print(f"  {deficit:20s}: {count:4d} ({pct:.1f}%)")

    # Write output
    if not args.dry_run and all_labeled:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, "w") as f:
            for item in all_labeled:
                f.write(json.dumps(item) + "\n")

        print(f"\nWrote {len(all_labeled)} labeled examples to {output_path}")
    elif args.dry_run:
        print(f"\n[DRY RUN] Would write {len(all_labeled)} examples to {args.output}")

        # Show sample
        if all_labeled:
            print("\nSample entries:")
            for i, item in enumerate(all_labeled[:5]):
                print(f"\n  [{i+1}] content={item['content_label']}, taxonomy={item['taxonomy_label']}")
                print(f"      bridges={item['bridges_found']}, sensory={item['sensory_found']}")
                print(f"      deficits={item['deficits']}")
                print(f"      text: {item['text'][:100]}...")
    else:
        print("\nNo memories found — nothing to write.")

    # Exit with success if we got any data
    if len(all_labeled) >= 1 or args.dry_run:
        sys.exit(0)
    else:
        print("\nFAIL: No memories found in any scope")
        sys.exit(1)


if __name__ == "__main__":
    main()
