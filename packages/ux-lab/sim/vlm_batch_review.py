#!/usr/bin/env python3
"""VLM batch reviewer for persona review pipeline.

Reads captures from captures/persona-reviews/{group}/, sends screenshots
to scillm Gemini Flash VLM with persona-specific prompts (from /prompt-lab),
collects structured JSON scores, writes results to persona-review-manifest.json
and persona-review-report.md.

Usage:
    python sim/vlm_batch_review.py review                          # all reviews
    python sim/vlm_batch_review.py review --persona tim-blazytko   # one persona
    python sim/vlm_batch_review.py review --group first-impressions # one group
    python sim/vlm_batch_review.py review --round 2                # mark as round 2
    python sim/vlm_batch_review.py review --dry-run                # show what would run
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import sys
import time
from pathlib import Path

import httpx
import typer
from loguru import logger

app = typer.Typer(no_args_is_help=True)

UX_LAB = Path(__file__).resolve().parent.parent
MANIFEST_PATH = UX_LAB / "persona-review-manifest.json"
CAPTURES_ROOT = UX_LAB / "captures" / "persona-reviews"
REPORT_PATH = UX_LAB / "persona-review-report.md"
COMPONENTS_ROOT = UX_LAB / "src" / "components" / "binary-explorer"
_SKILLS_DIR = Path(os.environ.get("SKILLS_DIR", str(Path(__file__).resolve().parents[3] / ".pi" / "skills")))
PROMPT_TEMPLATE_PATH = _SKILLS_DIR / "prompt-lab" / "prompts" / "persona_review_vlm_v1.txt"
PROMPT_CODE_TEMPLATE_PATH = _SKILLS_DIR / "prompt-lab" / "prompts" / "persona_review_code_vlm_v1.txt"

SCILLM_URL = os.environ.get("SCILLM_API_BASE", "http://localhost:4001") + "/v1/chat/completions"
SCILLM_KEY = os.environ.get("SCILLM_PROXY_KEY", "sk-dev-proxy-123")

# Use Gemini Flash for VLM — multimodal, 1M context, cheaper than Qwen3-VL
# Gemini 3 Flash Preview (thinking model, 1M context) — more critical than Gemini 2.5
SCILLM_MODEL = os.environ.get("SCILLM_VLM_MODEL", "text-gemini-3")

PERSONA_CONTEXT = {
    "tim-blazytko": (
        "Tim Blazytko — RE expert: binary analysis, malware, deobfuscation, agentic RE. "
        "Builds automated pipelines. Compares against IDA Pro, Binary Ninja. "
        "Values: automation, API access, pipeline integration."
    ),
    "gynvael-coldwind": (
        "Gynvael Coldwind — Google security, low-level systems, CTF veteran. "
        "Parses binaries byte-by-byte, reads x86/ARM daily. "
        "Values: information density, hex formatting, raw data, performance at scale."
    ),
    "liveoverflow": (
        "LiveOverflow — Security educator, CTF, YouTube. Explains exploitation to broad audiences. "
        "Values: beginner accessibility, intuitive interactions, progressive disclosure, visual clarity."
    ),
}


def load_prompt_template() -> str:
    if not PROMPT_TEMPLATE_PATH.exists():
        logger.error("Prompt template not found: {}", PROMPT_TEMPLATE_PATH)
        sys.exit(1)
    return PROMPT_TEMPLATE_PATH.read_text()


def build_prompt(template: str, persona: str, criteria: str,
                 prior_weaknesses: list[str]) -> str:
    context = PERSONA_CONTEXT.get(persona, f"Reverse engineering professional: {persona}")
    prior_text = "\n".join(f"- {w}" for w in prior_weaknesses) if prior_weaknesses else "None — this is the first review round."
    return (
        template
        .replace("{persona_name}", persona.replace("-", " ").title())
        .replace("{persona_context}", context)
        .replace("{review_criteria}", criteria)
        .replace("{prior_weaknesses}", prior_text)
    )


# Import shared VLM image preprocessing from common/
import sys as _sys
_sys.path.insert(0, str(Path(__file__).resolve().parents[3] / ".pi" / "skills"))
from common.vlm_image import prepare_for_vlm, stitch_vertical, compress, smart_crop  # noqa: E402


def load_screenshots(group: str) -> list[tuple[str, bytes]]:
    """Load and preprocess screenshots for VLM review using common/vlm_image."""
    group_dir = CAPTURES_ROOT / group
    if not group_dir.exists():
        return []
    raw = [(p.name, p.read_bytes()) for p in sorted(group_dir.glob("*.png"))]
    if not raw:
        return []

    # For taxonomy-integration: zoom into graph area to show CWE node coloring
    if group == "taxonomy-integration":
        result = []
        for name, data in raw:
            if "security-graph" in name or "initial" in name:
                result.append((name, smart_crop(data, region="graph", upscale_to=1600)))
            else:
                result.append((name, prepare_for_vlm(data)))
        return result

    # Preprocess all screenshots
    processed = [(name, prepare_for_vlm(data)) for name, data in raw]

    # If >2 screenshots, stitch into single image so VLM sees all context
    if len(processed) > 2:
        stitched = stitch_vertical([data for _, data in processed])
        if stitched:
            return [("stitched_all.png", compress(stitched))]

    return processed


def load_source_code(source_spec: str) -> str:
    sections: list[str] = []
    for raw_spec in source_spec.split(","):
        spec = raw_spec.strip()
        if not spec:
            continue

        filename = spec
        start_line: int | None = None
        end_line: int | None = None
        range_match = re.match(r"^(.*?):(\d+)-(\d+)$", spec)
        if range_match:
            filename = range_match.group(1)
            start_line = int(range_match.group(2))
            end_line = int(range_match.group(3))

        file_path = (COMPONENTS_ROOT / filename).resolve()
        try:
            file_path.relative_to(COMPONENTS_ROOT.resolve())
        except ValueError:
            logger.warning("Skipping source outside component directory: {}", spec)
            continue

        if not file_path.exists() or not file_path.is_file():
            logger.warning("Source file not found: {}", file_path)
            continue

        lines = file_path.read_text().splitlines()
        total_lines = len(lines)
        if start_line is None or end_line is None:
            selected_start = 1
            selected_end = total_lines
        else:
            selected_start = max(1, min(start_line, total_lines))
            selected_end = max(selected_start, min(end_line, total_lines))

        selected_lines = lines[selected_start - 1:selected_end]
        header = f"# FILE: {filename} (lines {selected_start}-{selected_end})"
        sections.append(header)
        sections.append("\n".join(selected_lines))

    combined = "\n\n".join(sections)
    return combined[:50000]


def extract_json(text: str) -> dict | None:
    """3-level JSON extraction: whole text -> markdown fence -> brace match."""
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        try:
            return json.loads(fence.group(1))
        except json.JSONDecodeError:
            pass
    first, last = text.find("{"), text.rfind("}")
    if first >= 0 and last > first:
        try:
            return json.loads(text[first:last + 1])
        except json.JSONDecodeError:
            pass
    return None


async def review_single(
    client: httpx.AsyncClient,
    entry: dict,
    persona: str, group: str, criteria: str,
    prior_weaknesses: list[str], template: str,
) -> dict:
    prompt = build_prompt(template, persona, criteria, prior_weaknesses)
    mode = entry.get("mode", "screenshot")
    screenshot_count = 0

    if mode == "code":
        source_spec = entry.get("source", "")
        source_code = load_source_code(source_spec)
        if not source_code:
            return {"error": f"No source loaded for spec {source_spec}", "score": 0}
        content: list[dict] = [
            {"type": "text", "text": prompt},
            {"type": "text", "text": f"```tsx\n{source_code}\n```"},
        ]
    else:
        screenshots = load_screenshots(group)
        if not screenshots:
            return {"error": f"No screenshots for group {group}", "score": 0}
        # Cap at 2 screenshots to avoid Gemini payload limits
        if len(screenshots) > 2:
            screenshots = [screenshots[0], screenshots[-1]]
        screenshot_count = len(screenshots)

        # Build content: text prompt + all screenshots as base64
        content = [{"type": "text", "text": prompt}]
        for name, data in screenshots:
            b64 = base64.b64encode(data).decode()
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{b64}"},
            })

    t0 = time.time()
    payload = {
        "model": SCILLM_MODEL,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.0,
        "max_tokens": 1024,
        "response_format": {"type": "json_object"},
    }
    # Retry up to 2 times on timeout (Gemini Flash 1M context handles large payloads)
    resp = None
    for attempt in range(3):
        try:
            resp = await client.post(
                SCILLM_URL,
                headers={"Authorization": f"Bearer {SCILLM_KEY}"},
                json=payload,
                timeout=180.0,
            )
            resp.raise_for_status()
            break
        except httpx.HTTPError as e:
            if attempt < 2:
                logger.warning("[{}/{}] attempt {} failed: {}, retrying...", persona, group, attempt + 1, e)
                await asyncio.sleep(2)
            else:
                logger.error("[{}/{}] scillm error after 3 attempts: {}", persona, group, e)
                return {"error": str(e), "score": 0, "latency_ms": int((time.time() - t0) * 1000)}
    if resp is None:
        return {"error": "no response", "score": 0, "latency_ms": int((time.time() - t0) * 1000)}

    latency_ms = int((time.time() - t0) * 1000)
    raw_text = resp.json()["choices"][0]["message"]["content"]
    parsed = extract_json(raw_text)

    if not parsed:
        logger.warning("[{}/{}] JSON parse failure", persona, group)
        return {"error": "JSON parse failure", "raw_text": raw_text[:500], "score": 0, "latency_ms": latency_ms}

    parsed["latency_ms"] = latency_ms
    parsed["screenshot_count"] = screenshot_count
    return parsed


def update_manifest(manifest: dict, persona: str, group: str,
                    review: dict, round_num: int) -> None:
    for entry in manifest["reviews"]:
        if entry["persona"] == persona and entry["group"] == group:
            entry["score"] = review.get("score")
            entry["verdict"] = review.get("verdict")
            entry["weaknesses"] = review.get("weaknesses", [])
            entry["strengths"] = review.get("strengths", [])
            entry["changes"] = review.get("changes", [])
            entry["status"] = "reviewed"
            entry["round"] = round_num
            entry["latency_ms"] = review.get("latency_ms")
            entry["reviewed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            break


def write_report(manifest: dict) -> None:
    lines = [
        "# Persona Review Report", "",
        f"Generated: {time.strftime('%Y-%m-%d %H:%M')}", "",
        "| Round | Persona | Group | Score | Verdict | Top Weakness | Latency |",
        "|-------|---------|-------|-------|---------|-------------|---------|",
    ]
    for r in manifest["reviews"]:
        if r.get("status") != "reviewed":
            continue
        weakness = (r.get("weaknesses", ["---"])[0][:60]) if r.get("weaknesses") else "---"
        lines.append(
            f"| {r.get('round', 1)} "
            f"| {r['persona']} "
            f"| {r['group']} "
            f"| {r.get('score', '?')} "
            f"| {r.get('verdict', '?')} "
            f"| {weakness} "
            f"| {r.get('latency_ms', '?')}ms |"
        )
    reviewed = [r for r in manifest["reviews"] if r.get("status") == "reviewed"]
    if reviewed:
        scores = [r["score"] for r in reviewed if r.get("score")]
        avg = sum(scores) / len(scores) if scores else 0
        passed = sum(1 for s in scores if s >= 8)
        lines.extend(["", "## Summary",
            f"- Reviewed: {len(reviewed)}/{manifest['total']}",
            f"- Average score: {avg:.1f}/10",
            f"- Passed (>=8): {passed}/{len(scores)}",
            f"- Gate: {'PASS' if avg >= 8.0 else 'FAIL'} (target: 8.0)"])
    REPORT_PATH.write_text("\n".join(lines) + "\n")
    logger.info("Report: {}", REPORT_PATH)


@app.command()
def review(
    persona: str = typer.Option(None, help="Filter to one persona"),
    group: str = typer.Option(None, help="Filter to one group"),
    round_num: int = typer.Option(1, "--round", help="Round number"),
    concurrency: int = typer.Option(4, help="Max concurrent VLM calls"),
    votes: int = typer.Option(1, help="Number of VLM calls per review, take median score"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Show plan without calling VLM"),
    manifest_file: str = typer.Option(None, "--manifest", help="Path to manifest JSON (default: persona-review-manifest.json)"),
):
    """Run VLM batch review of all captured screenshots."""
    manifest_path = Path(manifest_file) if manifest_file else MANIFEST_PATH
    if not manifest_path.exists():
        logger.error("Manifest not found: {}", manifest_path)
        raise typer.Exit(1)

    manifest = json.loads(manifest_path.read_text())
    target_reviews = manifest["reviews"]
    if persona:
        target_reviews = [r for r in target_reviews if r["persona"] == persona]
    if group:
        target_reviews = [r for r in target_reviews if r["group"] == group]

    # Use captures_dir from manifest if specified, otherwise default
    captures_root = UX_LAB / manifest.get("captures_dir", "captures/persona-reviews")
    available = {d.name for d in captures_root.iterdir() if d.is_dir()} if captures_root.exists() else set()
    target_reviews = [
        r for r in target_reviews
        if r.get("mode", "screenshot") == "code" or r["group"] in available
    ]

    if not target_reviews:
        logger.error("No reviews with captures"); raise typer.Exit(1)

    logger.info("{} reviews, round {}, model={}", len(target_reviews), round_num, SCILLM_MODEL)

    if dry_run:
        for r in target_reviews:
            if r.get("mode", "screenshot") == "code":
                source_code = load_source_code(r.get("source", ""))
                logger.info("  {} / {} — code mode, {} chars", r["persona"], r["group"], len(source_code))
            else:
                ss = load_screenshots(r["group"])
                logger.info("  {} / {} — {} screenshots", r["persona"], r["group"], len(ss))
        raise typer.Exit(0)

    screenshot_template = load_prompt_template()
    code_template = PROMPT_CODE_TEMPLATE_PATH.read_text() if PROMPT_CODE_TEMPLATE_PATH.exists() else screenshot_template

    async def run_all():
        sem = asyncio.Semaphore(concurrency)
        async def bounded(r):
            tpl = code_template if r.get("mode") == "code" else screenshot_template
            async with sem:
                if votes <= 1:
                    return await review_single(client, r, r["persona"], r["group"],
                        r["criteria"], r.get("weaknesses", []), tpl)
                # Median voting: run N times, take median score
                results_list = []
                for v in range(votes):
                    res = await review_single(client, r, r["persona"], r["group"],
                        r["criteria"], r.get("weaknesses", []), tpl)
                    if res.get("score", 0) > 0:
                        results_list.append(res)
                if not results_list:
                    return {"error": "all votes failed", "score": 0}
                results_list.sort(key=lambda x: x.get("score", 0))
                median = results_list[len(results_list) // 2]
                median["votes"] = [r.get("score", 0) for r in results_list]
                logger.debug("[{}/{}] votes: {}", r["persona"], r["group"], median["votes"])
                return median
        async with httpx.AsyncClient() as client:
            results = await asyncio.gather(*[bounded(r) for r in target_reviews], return_exceptions=True)
        for r, result in zip(target_reviews, results):
            if isinstance(result, Exception):
                logger.error("[{}/{}] {}", r["persona"], r["group"], result); continue
            logger.info("[{}/{}] score={} verdict={} {}ms{}",
                r["persona"], r["group"], result.get("score",0), result.get("verdict","?"),
                result.get("latency_ms","?"),
                f" votes={result['votes']}" if "votes" in result else "")
            update_manifest(manifest, r["persona"], r["group"], result, round_num)

    asyncio.run(run_all())
    manifest_path.write_text(json.dumps(manifest, indent=2))
    write_report(manifest)

    reviewed = [r for r in manifest["reviews"] if r.get("status") == "reviewed"]
    scores = [r["score"] for r in reviewed if r.get("score")]
    avg = sum(scores) / len(scores) if scores else 0
    if avg < 8.0:
        logger.warning("Gate FAIL: {:.1f} < 8.0", avg); raise typer.Exit(1)
    logger.info("Gate PASS: {:.1f} >= 8.0", avg)


if __name__ == "__main__":
    app()
