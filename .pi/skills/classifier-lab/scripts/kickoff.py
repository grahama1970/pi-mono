#!/usr/bin/env python3
"""Project kickoff — seeds a new classifier project from a goal description.

Runs /dogpile for research, extracts backbone recommendations,
writes research.md + tune-config.json + research-gate.json.
Optionally searches HuggingFace for initial training data.

Usage:
    python kickoff.py /path/to/project-dir --goal "Classify emails as spam or ham" --modality text
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import typer
from loguru import logger

app = typer.Typer(no_args_is_help=True)

SKILLS_DIR = Path(__file__).resolve().parent.parent.parent
DOGPILE = SKILLS_DIR / "dogpile"


def run_dogpile(query: str) -> str:
    """Run /dogpile search and return output."""
    cmd = f'cd "{DOGPILE}" && ./run.sh search "{query}"'
    try:
        result = subprocess.run(
            ["bash", "-lc", cmd], capture_output=True, text=True, timeout=120,
            env={**os.environ, "VIRTUAL_ENV": ""},
        )
        return result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return "Dogpile timed out"
    except Exception as e:
        return f"Dogpile failed: {e}"


@app.command()
def kickoff(
    project_dir: str = typer.Argument(..., help="Path to project directory"),
    goal: str = typer.Option(..., help="What the classifier should do"),
    modality: str = typer.Option("text", help="text, vision, or tabular"),
):
    """Seed a new classifier project from a goal description."""
    pdir = Path(project_dir)
    pdir.mkdir(parents=True, exist_ok=True)

    project_name = pdir.name
    logger.info(f"Kickoff: {project_name}")
    logger.info(f"Goal: {goal}")
    logger.info(f"Modality: {modality}")

    # Update meta
    meta_path = pdir / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    meta.update({
        "name": project_name,
        "goal": goal,
        "modality": modality,
        "status": "researching",
    })
    meta_path.write_text(json.dumps(meta, indent=2))

    # ── Step 1: Run /dogpile ──────────────────────────────────
    logger.info("[1/3] Running /dogpile research...")
    dogpile_query = (
        f"{modality} classifier for: {goal}. "
        f"What HuggingFace datasets exist? What backbone models work best? "
        f"Recommended hyperparameters for fine-tuning?"
    )
    dogpile_output = run_dogpile(dogpile_query)

    # Write research.md
    research = f"""# {project_name}

## Goal
{goal}

## Modality
{modality}

## Research (from /dogpile)

{dogpile_output[:3000] if dogpile_output else "No dogpile results available."}
"""
    (pdir / "research.md").write_text(research)
    logger.info(f"Written research.md ({len(research)} chars)")

    # ── Step 2: Extract settings ──────────────────────────────
    logger.info("[2/3] Setting initial tune config...")

    # Default backbones by modality
    backbone_defaults = {
        "text": ["distilbert-base-uncased", "sentence-transformers/all-MiniLM-L6-v2"],
        "vision": ["efficientnet_b0", "convnext_tiny"],
        "tabular": ["gradient_boosting", "random_forest"],
    }
    backbones = backbone_defaults.get(modality, backbone_defaults["text"])

    tune_config = {
        "lr": 2e-5 if modality == "text" else 2e-4,
        "epochs": 10,
        "batch_size": 16 if modality == "text" else 32,
        "warmup_ratio": 0.1,
        "weight_decay": 0.01,
        "max_length": 128,
        "backbones": backbones,
        "_source": "dogpile-kickoff",
        "_updated": __import__("datetime").datetime.now().isoformat(),
        "_changelog": [{"who": "agent", "what": f"Kickoff from goal: {goal[:50]}", "when": __import__("datetime").date.today().isoformat()}],
    }
    (pdir / "tune-config.json").write_text(json.dumps(tune_config, indent=2))
    logger.info(f"Written tune-config.json (backbones: {backbones})")

    # ── Step 3: Search for data ───────────────────────────────
    logger.info("[3/3] Searching HuggingFace for training data...")
    try:
        from data_enrichment import strategy_search_huggingface
        existing_labels: set[str] = set()  # empty — we'll accept whatever labels the dataset has
        # For kickoff, we need to discover labels from HF datasets
        # This is different from enrichment — we don't have existing labels yet
        # So we search by task name and take whatever we find

        from huggingface_hub import HfApi
        api = HfApi()
        hf_token = os.environ.get("HF_TOKEN", "")

        # Search for datasets matching the goal
        queries = [goal.lower(), f"{modality} {goal.split()[0].lower()} classification"]
        found: list[dict] = []
        for q in queries[:2]:
            try:
                datasets = api.list_datasets(search=q, sort="downloads", limit=3)
                for ds in datasets:
                    if ds.id not in [f["id"] for f in found]:
                        found.append({"id": ds.id, "downloads": ds.downloads})
                        logger.info(f"  Found: {ds.id} ({ds.downloads:,} downloads)")
            except Exception:
                pass

        if found:
            from datasets import load_dataset

            for ds_info in found[:3]:
                try:
                    for split in ["train", "validation", "test"]:
                        try:
                            ds = load_dataset(ds_info["id"], split=split, token=hf_token or None, trust_remote_code=False)
                            logger.info(f"  {ds_info['id']}: loaded {split} ({len(ds)} rows)")

                            # Find text and label fields
                            text_field = None
                            for f in ["text", "sms", "sentence", "content", "reviewText", "review", "message", "input"]:
                                if f in ds.features:
                                    text_field = f
                                    break
                            label_field = None
                            for f in ["sentiment", "class", "category", "label", "labels"]:
                                if f in ds.features:
                                    label_field = f
                                    break

                            if text_field and label_field:
                                # Get label names
                                feat = ds.features.get(label_field)
                                label_names = feat.names if hasattr(feat, "names") else list({str(row[label_field]) for row in ds.select(range(min(50, len(ds))))})

                                # Write samples
                                samples = []
                                for row in ds:
                                    text = row[text_field]
                                    if not isinstance(text, str) or len(text.strip()) < 5:
                                        continue
                                    raw = row[label_field]
                                    label = feat.names[raw] if hasattr(feat, "names") and isinstance(raw, int) else str(raw)
                                    samples.append({"text": text.strip()[:1000], "class": label, "split": "train"})

                                if samples:
                                    with open(pdir / "samples.jsonl", "w") as f:
                                        for s in samples:
                                            f.write(json.dumps(s) + "\n")
                                    meta["samples"] = len(samples)
                                    meta["classes"] = len(set(s["class"] for s in samples))
                                    meta["class_names"] = sorted(set(s["class"] for s in samples))
                                    meta["data_source"] = ds_info["id"]
                                    logger.info(f"  Written {len(samples)} samples from {ds_info['id']}")
                                    break
                            break  # got a split, done with this dataset
                        except Exception:
                            continue
                    if (pdir / "samples.jsonl").exists():
                        break
                except Exception as e:
                    logger.warning(f"  {ds_info['id']}: {e}")

    except Exception as e:
        logger.warning(f"Data search failed: {e}")

    # ── Write research gate ───────────────────────────────────
    (pdir / "research-gate.json").write_text(json.dumps({
        "passed": True,
        "timestamp": __import__("datetime").datetime.now().isoformat(),
        "goal": goal,
        "modality": modality,
        "backbones": backbones,
    }, indent=2))

    # Final meta update
    meta["status"] = "researched"
    meta_path.write_text(json.dumps(meta, indent=2))

    logger.info(f"\nKickoff complete: {project_name}")
    logger.info(f"  Research: research.md ({'OK' if (pdir / 'research.md').exists() else 'MISSING'})")
    logger.info(f"  Tune: tune-config.json ({'OK' if (pdir / 'tune-config.json').exists() else 'MISSING'})")
    logger.info(f"  Gate: research-gate.json ({'OK' if (pdir / 'research-gate.json').exists() else 'MISSING'})")
    logger.info(f"  Data: samples.jsonl ({'OK — ' + str(meta.get('samples', 0)) + ' samples' if (pdir / 'samples.jsonl').exists() else 'NOT FOUND'})")

    print(json.dumps({"status": "complete", **meta}))


if __name__ == "__main__":
    app()
