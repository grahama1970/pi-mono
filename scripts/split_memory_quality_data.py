#!/usr/bin/env python3
"""
Split memory_quality_labels.jsonl into train/val sets for each classifier axis.

Reads data/memory_quality_labels.jsonl and outputs:
  data/memory_quality_content_train.jsonl
  data/memory_quality_content_val.jsonl
  data/memory_quality_taxonomy_train.jsonl
  data/memory_quality_taxonomy_val.jsonl

Each output line: {"text": "...", "labels": ["label"]}

Usage:
    python scripts/split_memory_quality_data.py
    python scripts/split_memory_quality_data.py --val-ratio 0.2
"""

import argparse
import json
import random
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def main():
    """Split memory quality data into training and validation sets."""
    parser = argparse.ArgumentParser(description="Split memory quality data")
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--input", type=str, default=str(DATA_DIR / "memory_quality_labels.jsonl"))
    args = parser.parse_args()

    random.seed(args.seed)

    # Load all examples
    examples = []
    with open(args.input) as f:
        for line in f:
            line = line.strip()
            if line:
                examples.append(json.loads(line))

    print(f"Loaded {len(examples)} examples")

    random.shuffle(examples)
    split_idx = int(len(examples) * (1 - args.val_ratio))

    train_examples = examples[:split_idx]
    val_examples = examples[split_idx:]

    print(f"Train: {len(train_examples)}, Val: {len(val_examples)}")

    # Write content quality split
    for suffix, subset in [("train", train_examples), ("val", val_examples)]:
        path = DATA_DIR / f"memory_quality_content_{suffix}.jsonl"
        with open(path, "w") as f:
            for ex in subset:
                f.write(json.dumps({
                    "text": ex["text"],
                    "labels": [ex["content_label"]],
                }) + "\n")
        print(f"  Wrote {len(subset)} → {path.name}")

    # Write taxonomy quality split
    for suffix, subset in [("train", train_examples), ("val", val_examples)]:
        path = DATA_DIR / f"memory_quality_taxonomy_{suffix}.jsonl"
        with open(path, "w") as f:
            for ex in subset:
                f.write(json.dumps({
                    "text": ex["text"],
                    "labels": [ex["taxonomy_label"]],
                }) + "\n")
        print(f"  Wrote {len(subset)} → {path.name}")


if __name__ == "__main__":
    main()
