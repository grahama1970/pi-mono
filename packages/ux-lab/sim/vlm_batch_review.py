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
PROMPT_TEMPLATE_PATH = (
    Path(os.environ.get("SKILLS_DIR", str(Path(__file__).resolve().parents[3] / ".pi" / "skills")))
    / "prompt-lab" / "prompts" / "persona_review_vlm_v1.txt"
)

SCILLM_URL = os.environ.get("SCILLM_API_BASE", "http://localhost:4001") + "/v1/chat/completions"
SCILLM_KEY = os.environ.get("SCILLM_PROXY_KEY", "sk-dev-proxy-123")

# Use Gemini Flash for VLM — multimodal, 1M context, cheaper than Qwen3-VL
SCILLM_MODEL = os.environ.get("SCILLM_VLM_MODEL", "text-gemini")

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


def crop_region(data: bytes, region: str, viewport: tuple[int, int] = (1440, 900)) -> bytes | None:
    """Crop a known UI region from a full-page screenshot at native resolution.

    Regions based on Binary Explorer's 3-pane layout at 1440x900:
      - sidebar: left 220px
      - graph: center area (220 to ~65% of width), full height
      - detail: below graph (220 to ~65%, bottom ~40%)
      - toolbar: graph pane top bar (220 to ~65%, top 40px)
      - right: right pane (~65% to 100%, full height)
      - table: detail panel area when table tab is active
      - cwe_badges: lower portion of detail panel where CWE tags render
    """
    from PIL import Image
    import io

    img = Image.open(io.BytesIO(data))
    w, h = img.size

    # Scale factors if viewport differs from expected
    sx, sy = w / viewport[0], h / viewport[1]

    # Sidebar is ~220px, graph pane is ~65% of remaining, right pane is rest
    sidebar_w = int(220 * sx)
    graph_end = int(w * 0.65)
    detail_top = int(h * 0.55)  # Detail panel starts ~55% down
    toolbar_h = int(45 * sy)

    regions = {
        "graph": (sidebar_w, 0, graph_end, h),
        "detail": (sidebar_w, detail_top, graph_end, h),
        "toolbar": (sidebar_w, 0, graph_end, toolbar_h),
        "right": (graph_end, 0, w, h),
        "table": (sidebar_w, detail_top + int(30 * sy), graph_end, h),
        "cwe_badges": (sidebar_w, int(h * 0.75), graph_end, h),
        "full": (0, 0, w, h),
    }

    box = regions.get(region)
    if not box:
        return None

    cropped = img.crop(box)
    # Upscale to at least 1200px wide for text readability
    if cropped.width < 1200 and cropped.width > 50:
        scale = 1200 / cropped.width
        cropped = cropped.resize((1200, int(cropped.height * scale)), Image.LANCZOS)

    from PIL import ImageFilter
    cropped = cropped.filter(ImageFilter.SHARPEN)

    out = io.BytesIO()
    cropped.save(out, format="PNG", optimize=True)
    return out.getvalue()


# Map group → which regions to crop and send (in addition to or instead of raw screenshots)
GROUP_REGIONS: dict[str, list[str]] = {
    "node-detail": ["full", "detail"],
    "taxonomy-integration": ["graph", "detail"],
    "code-view": ["full", "detail"],
    "table-view": ["full", "table"],
    "chat-analysis": ["full", "right"],
    "scene-management": ["graph", "toolbar"],
    "investigation-journal": ["full", "right"],
}


def preprocess_screenshot(data: bytes, target_width: int = 1400) -> bytes:
    """Intelligently crop, resize, and sharpen screenshots for VLM readability.

    1. Auto-crop: trim black borders (common in headless Chrome captures)
    2. Upscale: if image is small (panel closeup), resize to target_width
    3. Sharpen: enhance text edges for better VLM OCR
    4. Compress: convert to optimized PNG
    """
    from PIL import Image, ImageFilter, ImageOps
    import io

    img = Image.open(io.BytesIO(data))

    # Auto-crop black borders (threshold: pixel brightness > 15)
    # Convert to grayscale for border detection
    gray = img.convert("L")
    bbox = gray.point(lambda x: 255 if x > 15 else 0).getbbox()
    if bbox:
        # Add small padding back (4px)
        pad = 4
        bbox = (
            max(0, bbox[0] - pad),
            max(0, bbox[1] - pad),
            min(img.width, bbox[2] + pad),
            min(img.height, bbox[3] + pad),
        )
        img = img.crop(bbox)

    # Upscale small images (panel closeups are often 400-600px wide)
    if img.width < target_width and img.width > 100:
        scale = target_width / img.width
        new_h = int(img.height * scale)
        img = img.resize((target_width, new_h), Image.LANCZOS)

    # Sharpen text for better VLM readability
    img = img.filter(ImageFilter.SHARPEN)

    # Cap height at 2000px to avoid huge payloads
    if img.height > 2000:
        scale = 2000 / img.height
        img = img.resize((int(img.width * scale), 2000), Image.LANCZOS)

    # Export as optimized PNG
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue()


def compress_if_needed(data: bytes, max_bytes: int = 500_000) -> bytes:
    """Compress image to JPEG if PNG exceeds max_bytes. VLMs handle JPEG fine."""
    if len(data) <= max_bytes:
        return data
    from PIL import Image
    import io
    img = Image.open(io.BytesIO(data))
    # Try PNG with reduced colors first
    out = io.BytesIO()
    img = img.convert("RGB")  # Drop alpha if present
    img.save(out, format="JPEG", quality=85, optimize=True)
    return out.getvalue()


def load_screenshots(group: str) -> list[tuple[str, bytes]]:
    group_dir = CAPTURES_ROOT / group
    if not group_dir.exists():
        return []
    raw = [(p.name, p.read_bytes()) for p in sorted(group_dir.glob("*.png"))]
    if not raw:
        return []

    # Preprocess raw screenshots (auto-crop, sharpen, upscale, compress)
    processed = [(name, compress_if_needed(preprocess_screenshot(data))) for name, data in raw]

    # If >2 screenshots, stitch into single tall image
    if len(processed) > 2:
        try:
            from PIL import Image
            import io
            images = [Image.open(io.BytesIO(data)) for _, data in processed]
            max_w = max(img.width for img in images)
            normalized = []
            for img in images:
                if img.width < max_w:
                    scale = max_w / img.width
                    img = img.resize((max_w, int(img.height * scale)), Image.LANCZOS)
                normalized.append(img)
            sep = 4
            total_h = sum(img.height for img in normalized) + sep * (len(normalized) - 1)
            if total_h > 3000:
                scale = 3000 / total_h
                normalized = [img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS) for img in normalized]
                total_h = sum(img.height for img in normalized) + sep * (len(normalized) - 1)
                max_w = max(img.width for img in normalized)
            stitched = Image.new("RGB", (max_w, total_h), (20, 20, 20))
            y = 0
            for img in normalized:
                stitched.paste(img, (0, y))
                y += img.height + sep
            out = io.BytesIO()
            stitched.save(out, format="PNG", optimize=True)
            return [("stitched_all.png", compress_if_needed(out.getvalue()))]
        except Exception as e:
            logger.debug("Stitching failed: {}", e)

    return processed


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
    persona: str, group: str, criteria: str,
    prior_weaknesses: list[str], template: str,
) -> dict:
    screenshots = load_screenshots(group)
    if not screenshots:
        return {"error": f"No screenshots for group {group}", "score": 0}
    # Cap at 2 screenshots to avoid Gemini payload limits
    if len(screenshots) > 2:
        screenshots = [screenshots[0], screenshots[-1]]

    prompt = build_prompt(template, persona, criteria, prior_weaknesses)

    # Build content: text prompt + all screenshots as base64
    content: list[dict] = [{"type": "text", "text": prompt}]
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
    parsed["screenshot_count"] = len(screenshots)
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
):
    """Run VLM batch review of all captured screenshots."""
    if not MANIFEST_PATH.exists():
        logger.error("Manifest not found: {}", MANIFEST_PATH)
        raise typer.Exit(1)

    manifest = json.loads(MANIFEST_PATH.read_text())
    target_reviews = manifest["reviews"]
    if persona:
        target_reviews = [r for r in target_reviews if r["persona"] == persona]
    if group:
        target_reviews = [r for r in target_reviews if r["group"] == group]

    available = {d.name for d in CAPTURES_ROOT.iterdir() if d.is_dir()} if CAPTURES_ROOT.exists() else set()
    target_reviews = [r for r in target_reviews if r["group"] in available]

    if not target_reviews:
        logger.error("No reviews with captures"); raise typer.Exit(1)

    logger.info("{} reviews, round {}, model={}", len(target_reviews), round_num, SCILLM_MODEL)

    if dry_run:
        for r in target_reviews:
            ss = load_screenshots(r["group"])
            logger.info("  {} / {} — {} screenshots", r["persona"], r["group"], len(ss))
        raise typer.Exit(0)

    template = load_prompt_template()

    async def run_all():
        sem = asyncio.Semaphore(concurrency)
        async def bounded(r):
            async with sem:
                if votes <= 1:
                    return await review_single(client, r["persona"], r["group"],
                        r["criteria"], r.get("weaknesses", []), template)
                # Median voting: run N times, take median score
                results_list = []
                for v in range(votes):
                    res = await review_single(client, r["persona"], r["group"],
                        r["criteria"], r.get("weaknesses", []), template)
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
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))
    write_report(manifest)

    reviewed = [r for r in manifest["reviews"] if r.get("status") == "reviewed"]
    scores = [r["score"] for r in reviewed if r.get("score")]
    avg = sum(scores) / len(scores) if scores else 0
    if avg < 8.0:
        logger.warning("Gate FAIL: {:.1f} < 8.0", avg); raise typer.Exit(1)
    logger.info("Gate PASS: {:.1f} >= 8.0", avg)


if __name__ == "__main__":
    app()
