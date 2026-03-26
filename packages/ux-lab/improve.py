#!/usr/bin/env python3
"""Self-improvement loop: screenshot → persona review → designer remediation → re-test.

Orchestrates a two-persona feedback loop between Nico Bailon (client/QA)
and Steve Schoger (designer). Each round:

1. Run interaction manifest (capture screenshots + DOM assertions)
2. Nico reviews and produces severity-graded findings
3. Steve reads Nico's findings and either:
   a. FIXES the HTML mockup (agrees with critique)
   b. PUSHES BACK with design rationale (disagrees)
4. Nico evaluates Steve's pushbacks — accepts rationale or escalates
5. If remaining high/medium findings are below threshold → CONVERGED
6. Otherwise → next round with Steve's fixes applied

The dialogue between Nico and Steve is the improvement loop. Neither
persona has unilateral authority — they must reach agreement.
"""

import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

try:
    from loguru import logger
except ImportError:
    import logging
    logger = logging.getLogger(__name__)

try:
    from converge_personas import load_designer, load_persona
except ImportError:
    load_designer = None
    load_persona = None

try:
    from designer_dialogue import run_designer_remediation, DesignerResponse
except ImportError:
    run_designer_remediation = None
    DesignerResponse = None

SKILL_DIR = Path(__file__).parent
SKILLS_ROOT = SKILL_DIR.parent.parent / ".pi" / "skills"
TEST_INTERACTIONS = SKILLS_ROOT / "test-interactions" / "run.sh"
REVIEW_DESIGN = SKILLS_ROOT / "review-design" / "run.sh"

PERSONA_MANIFESTS = {
    "brandon-bailey": SKILL_DIR / "fixtures" / "brandon-bailey-manifest.json",
    "rob-armstrong": SKILL_DIR / "fixtures" / "rob-armstrong-manifest.json",
    "nico-bailon": SKILL_DIR / "fixtures" / "nico-bailon-manifest.json",
}

# Convergence: stop when high/medium findings drop below this
CONVERGENCE_THRESHOLD = {
    "high": 0,
    "medium": 2,
}


@dataclass
class RoundResult:
    """Result of a single improvement round."""
    round_num: int
    persona: str
    test_passed: bool
    test_failures: int
    review_findings: list = field(default_factory=list)
    high_count: int = 0
    medium_count: int = 0
    low_count: int = 0
    converged: bool = False
    duration_s: float = 0.0
    review_file: str = ""
    captures_dir: str = ""


def _find_persona_manifest(persona: str, custom_manifest: Optional[Path] = None) -> Path:
    """Find the persona-specific interaction manifest."""
    if custom_manifest and custom_manifest.exists():
        return custom_manifest
    if persona in PERSONA_MANIFESTS and PERSONA_MANIFESTS[persona].exists():
        return PERSONA_MANIFESTS[persona]
    # Fall back to generic manifest
    generic = SKILL_DIR / "fixtures" / "interaction-manifest.json"
    if generic.exists():
        logger.warning("No persona-specific manifest for '{}', using generic", persona)
        return generic
    raise FileNotFoundError(f"No manifest found for persona '{persona}'")


def _run_test_interactions(manifest: Path, output_dir: Path, surface: Optional[str] = None) -> dict:
    """Run /test-interactions and return results."""
    cmd = [
        str(TEST_INTERACTIONS), "run",
        "--manifest", str(manifest),
        "--output-dir", str(output_dir),
    ]
    if surface:
        cmd.extend(["--surface", surface])

    logger.info("Running /test-interactions: {}", " ".join(cmd[-4:]))
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

    results_file = output_dir / "results.json"
    if results_file.exists():
        return json.loads(results_file.read_text())
    return {"passed": 0, "failed": 0, "total": 0, "interactions": []}


def _run_persona_review(
    captures_dir: Path,
    persona: str,
    tokens_path: Optional[Path] = None,
    provider: str = "gemini",
    round_num: int = 1,
) -> Optional[Path]:
    """Run /review-design with persona and return path to final review file."""
    cmd = [
        str(REVIEW_DESIGN), "review",
        "--screenshots", str(captures_dir),
        "--persona", persona,
        "--provider", provider,
        "--title", f"Round {round_num} — {persona} improvement loop",
    ]
    if tokens_path and tokens_path.exists():
        cmd.extend(["--tokens", str(tokens_path)])

    logger.info("Running /review-design --persona {} (round {})", persona, round_num)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)

    if result.returncode != 0:
        logger.error("review-design failed (exit {}): {}", result.returncode,
                      result.stderr[:300] if result.stderr else "no stderr")
        return None

    # Find the final review output
    review_dir = captures_dir / "review_output"
    if not review_dir.exists():
        # Check common alternative locations
        for alt in [Path("review_output"), SKILL_DIR / "review_output"]:
            if alt.exists():
                review_dir = alt
                break

    if review_dir.exists():
        finals = sorted(review_dir.glob("*_final.md"))
        if finals:
            return finals[-1]

    logger.warning("No review output found after /review-design")
    return None


def _parse_review_findings(review_file: Path) -> list[dict]:
    """Parse findings from a review markdown file.

    Extracts severity, title, and description from ### headers in the review.
    """
    findings = []
    content = review_file.read_text()

    # Match "### N. Title (Severity: high/medium/low)"
    pattern = re.compile(
        r"###\s+\d+\.\s+(.+?)\s*\(Severity:\s*(high|medium|low)\)",
        re.IGNORECASE,
    )
    for match in pattern.finditer(content):
        title = match.group(1).strip()
        severity = match.group(2).lower()
        findings.append({"title": title, "severity": severity})

    if not findings:
        # Fallback: count severity mentions
        for sev in ["high", "medium", "low"]:
            count = len(re.findall(rf"\bSeverity:\s*{sev}\b", content, re.IGNORECASE))
            for i in range(count):
                findings.append({"title": f"Finding {i+1}", "severity": sev})

    return findings


def _check_convergence(findings: list[dict]) -> bool:
    """Check if findings are below convergence threshold."""
    high = sum(1 for f in findings if f["severity"] == "high")
    medium = sum(1 for f in findings if f["severity"] == "medium")
    return (high <= CONVERGENCE_THRESHOLD["high"] and
            medium <= CONVERGENCE_THRESHOLD["medium"])


def run_improvement_loop(
    persona: str,
    max_rounds: int = 5,
    manifest: Optional[Path] = None,
    tokens: Optional[Path] = None,
    provider: str = "gemini",
    surface: Optional[str] = None,
    output_base: Optional[Path] = None,
    designer: Optional[dict] = None,
    mockup_dir: Optional[Path] = None,
    client_persona: Optional[dict] = None,
) -> list[RoundResult]:
    """Run the self-improvement loop until convergence or max_rounds.

    Args:
        persona: Persona agent name (e.g. brandon-bailey, nico-bailon). NON-NEGOTIABLE.
        max_rounds: Maximum iteration rounds before stopping.
        manifest: Custom interaction manifest (defaults to persona-specific).
        tokens: Design tokens JSON file.
        provider: Vision LLM provider for /review-design.
        surface: Specific surface to test (optional).
        output_base: Base directory for round outputs.
        designer: Steve Schoger's persona dict (loaded from YAML). If provided,
            Steve actively remediates findings — fixing HTML or pushing back.
        mockup_dir: Directory containing HTML mockup files that Steve can edit.
        client_persona: Nico's persona dict for evaluating Steve's pushbacks.

    Returns:
        List of RoundResult for each completed round.
    """
    if not persona:
        logger.error("No persona specified — self-improvement without a persona is pointless")
        sys.exit(1)

    manifest_path = _find_persona_manifest(persona, manifest)
    output_base = output_base or (SKILL_DIR / "improvement-runs" / persona)
    output_base.mkdir(parents=True, exist_ok=True)

    tokens_path = tokens or (SKILL_DIR / "design-tokens.json")
    results = []

    logger.info("=" * 70)
    logger.info("IMPROVEMENT LOOP: persona={}, max_rounds={}", persona, max_rounds)
    logger.info("Manifest: {}", manifest_path)
    logger.info("Output: {}", output_base)
    logger.info("=" * 70)

    for round_num in range(1, max_rounds + 1):
        t0 = time.time()
        round_dir = output_base / f"round{round_num}"
        captures_dir = round_dir / "captures"
        captures_dir.mkdir(parents=True, exist_ok=True)

        logger.info("")
        logger.info("-" * 60)
        logger.info("ROUND {}/{}", round_num, max_rounds)
        logger.info("-" * 60)

        # Step 1: Run interaction tests
        logger.info("Step 1/3: Running interaction tests")
        test_data = _run_test_interactions(manifest_path, captures_dir, surface)
        test_passed = test_data.get("failed", 0) == 0
        test_failures = test_data.get("failed", 0)

        if not test_passed:
            logger.warning("  {} test failures detected", test_failures)
        else:
            logger.info("  All {} interactions passed", test_data.get("total", 0))

        # Step 2: Persona-driven review (Nico critiques)
        logger.info("Step 2/4: Running persona review ({})", persona)
        review_file = _run_persona_review(
            captures_dir, persona, tokens_path, provider, round_num
        )

        findings = []
        if review_file:
            findings = _parse_review_findings(review_file)
            logger.info("  {} findings: {} high, {} medium, {} low",
                        len(findings),
                        sum(1 for f in findings if f["severity"] == "high"),
                        sum(1 for f in findings if f["severity"] == "medium"),
                        sum(1 for f in findings if f["severity"] == "low"))

        # Step 3: Designer remediation (Steve responds to Nico)
        if designer and mockup_dir and findings:
            high_medium = [f for f in findings if f["severity"] in ("high", "medium")]
            if high_medium:
                logger.info("Step 3/4: Steve Schoger responding to {} findings", len(high_medium))
                dialogue = run_designer_remediation(
                    findings=findings,
                    mockup_dir=mockup_dir,
                    designer=designer,
                    client_persona=client_persona,
                    round_dir=round_dir,
                )
                # Update findings with post-dialogue severities
                dialogue_map = {d.finding_title: d for d in dialogue}
                for f in findings:
                    dr = dialogue_map.get(f["title"])
                    if dr and dr.final_severity:
                        f["original_severity"] = f["severity"]
                        f["severity"] = dr.final_severity
                        f["steve_disposition"] = dr.disposition
                        f["nico_verdict"] = dr.nico_verdict

                resolved = sum(1 for d in dialogue if d.final_severity == "resolved")
                accepted = sum(1 for d in dialogue if d.nico_verdict == "accept")
                rejected = sum(1 for d in dialogue if d.nico_verdict == "reject")
                logger.info("  Dialogue: {} resolved, {} pushbacks accepted, {} rejected",
                            resolved, accepted, rejected)
            else:
                logger.info("Step 3/4: No high/medium findings — Steve has nothing to fix")
        elif not designer:
            logger.warning("Step 3/4: No designer loaded — remediation DISABLED")

        # Step 4: Check convergence (using post-dialogue severities)
        converged = _check_convergence(findings)
        duration = time.time() - t0

        round_result = RoundResult(
            round_num=round_num,
            persona=persona,
            test_passed=test_passed,
            test_failures=test_failures,
            review_findings=findings,
            high_count=sum(1 for f in findings if f["severity"] == "high"),
            medium_count=sum(1 for f in findings if f["severity"] == "medium"),
            low_count=sum(1 for f in findings if f["severity"] == "low"),
            converged=converged,
            duration_s=round(duration, 1),
            review_file=str(review_file) if review_file else "",
            captures_dir=str(captures_dir),
        )
        results.append(round_result)

        # Write round summary
        _write_round_summary(round_result, round_dir)

        if converged:
            logger.info("")
            logger.info("CONVERGED after {} rounds — {} is satisfied", round_num, persona)
            logger.info("  High: {}, Medium: {}, Low: {}",
                        round_result.high_count, round_result.medium_count, round_result.low_count)
            break

        if round_num < max_rounds:
            logger.info("  Not converged. High={} (need <={}), Medium={} (need <={})",
                        round_result.high_count, CONVERGENCE_THRESHOLD["high"],
                        round_result.medium_count, CONVERGENCE_THRESHOLD["medium"])
            if designer:
                logger.info("  Steve's fixes applied — re-testing with updated mockups")
            else:
                logger.info("  Apply fixes from {} before next round", review_file)

    # Write overall summary
    _write_loop_summary(results, output_base, persona)
    return results


def _write_round_summary(result: RoundResult, round_dir: Path):
    """Write a round summary markdown file."""
    lines = [
        f"# Round {result.round_num} Summary — {result.persona}",
        f"",
        f"**Duration**: {result.duration_s}s",
        f"**Tests**: {'PASS' if result.test_passed else f'FAIL ({result.test_failures} failures)'}",
        f"**Findings**: {result.high_count} high, {result.medium_count} medium, {result.low_count} low",
        f"**Converged**: {'Yes' if result.converged else 'No'}",
        f"",
    ]
    if result.review_findings:
        lines.append("## Findings")
        lines.append("")
        for f in result.review_findings:
            icon = {"high": "!!!", "medium": "!!", "low": "!"}.get(f["severity"], "?")
            lines.append(f"- [{icon}] **{f['severity'].upper()}**: {f['title']}")
        lines.append("")

    if result.review_file:
        lines.append(f"## Full Review")
        lines.append(f"See: {result.review_file}")

    (round_dir / "ROUND_SUMMARY.md").write_text("\n".join(lines))


def _write_loop_summary(results: list[RoundResult], output_base: Path, persona: str):
    """Write overall loop summary with progression across rounds."""
    lines = [
        f"# Improvement Loop Summary — {persona}",
        f"",
        f"**Rounds**: {len(results)}",
        f"**Converged**: {'Yes' if results[-1].converged else 'No'}",
        f"**Total Duration**: {sum(r.duration_s for r in results):.1f}s",
        f"",
        "## Progression",
        "",
        "| Round | Tests | High | Medium | Low | Converged | Duration |",
        "|-------|-------|------|--------|-----|-----------|----------|",
    ]
    for r in results:
        test_status = "PASS" if r.test_passed else f"FAIL({r.test_failures})"
        conv = "Yes" if r.converged else "No"
        lines.append(f"| {r.round_num} | {test_status} | {r.high_count} | {r.medium_count} | {r.low_count} | {conv} | {r.duration_s}s |")

    lines.extend(["", "## Round Details", ""])
    for r in results:
        lines.append(f"### Round {r.round_num}")
        if r.review_findings:
            for f in r.review_findings:
                lines.append(f"- **{f['severity'].upper()}**: {f['title']}")
        else:
            lines.append("- No findings")
        if r.review_file:
            lines.append(f"- Full review: {r.review_file}")
        lines.append("")

    summary_path = output_base / "LOOP_SUMMARY.md"
    summary_path.write_text("\n".join(lines))

    # Also write machine-readable JSON
    json_data = {
        "persona": persona,
        "rounds": len(results),
        "converged": results[-1].converged,
        "total_duration_s": round(sum(r.duration_s for r in results), 1),
        "final_severity": {
            "high": results[-1].high_count,
            "medium": results[-1].medium_count,
            "low": results[-1].low_count,
        },
        "progression": [
            {
                "round": r.round_num,
                "test_passed": r.test_passed,
                "high": r.high_count,
                "medium": r.medium_count,
                "low": r.low_count,
                "converged": r.converged,
            }
            for r in results
        ],
    }
    (output_base / "loop_results.json").write_text(json.dumps(json_data, indent=2))

    logger.info("")
    logger.info("Loop summary: {}", summary_path)
    logger.info("Loop results: {}", output_base / "loop_results.json")


# --- CLI ---

def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="Self-improvement loop: persona-driven test + review iteration"
    )
    parser.add_argument("--persona", required=True,
                        help="Persona agent name (e.g. brandon-bailey, rob-armstrong). NON-NEGOTIABLE.")
    parser.add_argument("--max-rounds", type=int, default=5,
                        help="Maximum improvement rounds (default: 5)")
    parser.add_argument("--manifest", type=Path, default=None,
                        help="Custom interaction manifest (defaults to persona-specific)")
    parser.add_argument("--tokens", type=Path, default=None,
                        help="Design tokens JSON file")
    parser.add_argument("--provider", default="gemini",
                        help="Vision LLM provider (default: gemini)")
    parser.add_argument("--surface", default=None,
                        help="Test only this surface")
    parser.add_argument("--output", type=Path, default=None,
                        help="Output directory for improvement runs")
    parser.add_argument("--mockup-dir", type=Path, default=None,
                        help="Directory containing HTML mockup files for Steve to edit")
    parser.add_argument("--no-designer", action="store_true",
                        help="Disable designer remediation (Steve Schoger)")

    args = parser.parse_args()

    # Load designer persona (Steve Schoger) unless disabled
    designer_persona = None
    client_persona_dict = None
    if not args.no_designer and load_designer:
        designer_persona = load_designer()
        if designer_persona:
            logger.info("Loaded designer: {}", designer_persona.get("name", "unknown"))
        if load_persona:
            client_persona_dict = load_persona(args.persona)

    results = run_improvement_loop(
        persona=args.persona,
        max_rounds=args.max_rounds,
        manifest=args.manifest,
        tokens=args.tokens,
        provider=args.provider,
        surface=args.surface,
        output_base=args.output,
        designer=designer_persona,
        mockup_dir=args.mockup_dir,
        client_persona=client_persona_dict,
    )

    # Exit with failure if not converged
    if not results[-1].converged:
        sys.exit(1)


if __name__ == "__main__":
    main()
