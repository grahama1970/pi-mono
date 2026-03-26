"""
voice-commands.py — Domain randomization via speech pipeline for UX Lab sim.

Runs adversarial text commands through TTS → STT to produce noisy voice transcripts.
The STT errors are the domain randomization — they simulate what a user would say
and how the system would hear it.

Pipeline:
  generate-commands.py output → [text] → Kokoro TTS (8880) → [WAV] → Whisper STT (2022) → [noisy transcript]

Output JSONL: {original_text, voice_transcript, audio_path, stt_confidence}

Usage:
    python3 voice-commands.py --dry-run --limit 3
    python3 voice-commands.py --input commands.jsonl --output voice.jsonl
    python3 voice-commands.py --limit 20 --audio-dir /tmp/voice-sim/
"""
from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Optional

import httpx
import typer
from loguru import logger

# ── Logger setup ───────────────────────────────────────────────────────────────
logger.remove()
logger.add(
    sys.stderr,
    level="INFO",
    format="<green>{time:HH:mm:ss}</green> | {level} | {message}",
)

app = typer.Typer(help="Generate voice-command transcripts via TTS→STT pipeline (PersonaPlex)")

# ── Endpoint constants ─────────────────────────────────────────────────────────

# PersonaPlex TTS — Kokoro port 8880 (OpenAI-compatible speech API)
TTS_BASE_URL = "http://localhost:8880"
TTS_PATH = "/v1/audio/speech"

# PersonaPlex STT — Whisper port 2022
STT_BASE_URL = "http://localhost:2022"
# Try multiple paths; faster-whisper-server uses /asr, OpenAI-compat uses /v1/audio/transcriptions
STT_PATHS = ["/asr", "/v1/audio/transcriptions", "/transcribe", "/api/asr"]

DEFAULT_VOICE = "af_heart"
DEFAULT_AUDIO_DIR = Path("/tmp/voice-sim")

# ── TTS via Kokoro (PersonaPlex port 8880) ─────────────────────────────────────


def tts_synthesize(text: str, audio_path: Path, client: httpx.Client) -> bool:
    """POST text to Kokoro TTS, save WAV to audio_path.

    Args:
        text: Input text to synthesize.
        audio_path: Destination path for the WAV file.
        client: Shared httpx.Client instance.

    Returns:
        True on success, False on failure.
    """
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        payload = {
            "model": "kokoro",
            "input": text,
            "voice": DEFAULT_VOICE,
            "response_format": "wav",
        }
        resp = client.post(f"{TTS_BASE_URL}{TTS_PATH}", json=payload, timeout=30.0)
        resp.raise_for_status()
        audio_path.write_bytes(resp.content)
        logger.debug(f"TTS OK → {audio_path} ({len(resp.content)} bytes)")
        return True
    except httpx.ConnectError:
        logger.warning(f"TTS unreachable at {TTS_BASE_URL} — is Kokoro running?")
    except httpx.HTTPStatusError as exc:
        logger.warning(f"TTS HTTP {exc.response.status_code} for '{text[:50]}'")
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"TTS error for '{text[:50]}': {exc}")
    return False


# ── STT via Whisper (PersonaPlex port 2022) ────────────────────────────────────


def stt_transcribe(audio_path: Path, client: httpx.Client) -> tuple[str, float]:
    """POST WAV file to Whisper STT, return (transcript, confidence).

    Tries multiple endpoint paths to handle different whisper server variants.

    Args:
        audio_path: Path to WAV file to transcribe.
        client: Shared httpx.Client instance.

    Returns:
        Tuple of (transcript_text, confidence_0_to_1).
        Returns ('', 0.0) on any failure.
    """
    for path in STT_PATHS:
        url = f"{STT_BASE_URL}{path}"
        try:
            with audio_path.open("rb") as fh:
                resp = client.post(
                    url,
                    files={"file": (audio_path.name, fh, "audio/wav")},
                    timeout=60.0,
                )
            if resp.status_code == 404:
                logger.debug(f"STT 404 at {url}, trying next path")
                continue
            resp.raise_for_status()

            data = resp.json()
            # Normalise response shapes across whisper server variants
            text = (
                data.get("text")
                or data.get("transcript")
                or data.get("transcription")
                or ""
            )
            # avg_logprob (negative) → 0–1 scale; or use explicit confidence if present
            raw_conf = data.get("confidence") or data.get("avg_logprob")
            if raw_conf is None:
                confidence = 0.0
            elif isinstance(raw_conf, float) and raw_conf < 0:
                # Convert log-prob to probability
                confidence = max(0.0, min(1.0, math.exp(raw_conf)))
            else:
                confidence = max(0.0, min(1.0, float(raw_conf)))

            logger.debug(f"STT transcript='{text[:50]}' conf={confidence:.3f}")
            return text.strip(), confidence

        except httpx.ConnectError:
            logger.warning(f"STT unreachable at {STT_BASE_URL} — is Whisper running?")
            break
        except httpx.HTTPStatusError as exc:
            logger.debug(f"STT HTTP {exc.response.status_code} at {url}")
            continue
        except Exception as exc:  # noqa: BLE001
            logger.debug(f"STT error at {url}: {exc}")
            continue

    logger.warning(f"STT failed for {audio_path.name}")
    return "", 0.0


# ── Load input commands ────────────────────────────────────────────────────────


def _load_from_file(input_file: Path) -> list[dict]:
    """Parse JSONL from a file."""
    commands: list[dict] = []
    with input_file.open() as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                commands.append(json.loads(line))
            except json.JSONDecodeError as exc:
                logger.warning(f"Skipping malformed JSON on line {lineno}: {exc}")
    return commands


def _load_inline(limit: Optional[int]) -> list[dict]:
    """Import generate-commands.py as a module and call it to get static commands.

    Uses importlib to handle the hyphenated module name.
    Falls back to a small static set if the script cannot be loaded.
    """
    gen_script = Path(__file__).parent / "generate-commands.py"
    if not gen_script.exists():
        logger.warning(f"generate-commands.py not found at {gen_script}, using fallback commands")
        return _fallback_commands()

    try:
        spec = importlib.util.spec_from_file_location("generate_commands", gen_script)
        if spec is None or spec.loader is None:
            raise ImportError("Could not create module spec")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[attr-defined]

        # Collect commands from all binaries using static features (dry-run style)
        all_commands: list[dict] = []
        import random

        rng = random.Random(42)
        for bin_name, features in mod.STATIC_FEATURES.items():
            cmds = mod._generate_for_binary(bin_name, features, novel=False, rng=rng)
            all_commands.extend(cmds)

        rng.shuffle(all_commands)
        logger.debug(f"Inline generate-commands: {len(all_commands)} total commands")
        return all_commands

    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Could not import generate-commands.py ({exc}), using fallback")
        return _fallback_commands()


def _fallback_commands() -> list[dict]:
    """Minimal hardcoded commands used when generate-commands.py is unavailable."""
    return [
        {"command": "show all droid nodes", "expected_action": "VIEW_ALL",
         "expected_target": None, "difficulty": "easy", "binary": "droid"},
        {"command": "select session notification", "expected_action": "SELECT_NODE",
         "expected_target": "droid:session_notification", "difficulty": "medium", "binary": "droid"},
        {"command": "expand the automation namespace", "expected_action": "EXPAND",
         "expected_target": "droid:automation", "difficulty": "easy", "binary": "droid"},
    ]


def load_commands(
    input_file: Optional[Path],
    limit: Optional[int],
) -> list[dict]:
    """Load commands from JSONL file or via inline generate-commands import.

    Args:
        input_file: Optional path to existing JSONL file of commands.
        limit: Max commands to return.

    Returns:
        List of command dicts with at least a 'command' key.
    """
    if input_file:
        if not input_file.exists():
            logger.error(f"Input file not found: {input_file}")
            raise typer.Exit(1)
        commands = _load_from_file(input_file)
        logger.info(f"Loaded {len(commands)} commands from {input_file}")
    else:
        commands = _load_inline(limit)

    if limit is not None:
        commands = commands[:limit]
    return commands


# ── Output helpers ─────────────────────────────────────────────────────────────


def _write_record(
    record: dict,
    output_fh,
) -> None:
    """Write one JSONL record to the output file handle or stdout."""
    output_fh.write(json.dumps(record) + "\n")
    output_fh.flush()


# ── Main pipeline ──────────────────────────────────────────────────────────────


def _process_command(
    idx: int,
    cmd: dict,
    audio_dir: Path,
    client: httpx.Client,
) -> dict:
    """Run one command through TTS → STT.

    Args:
        idx: Command index (used for audio filename).
        cmd: Command dict from generate-commands.py.
        audio_dir: Directory to save WAV files.
        client: Shared httpx.Client instance.

    Returns:
        JSONL record dict.
    """
    original_text: str = cmd.get("command", "")
    audio_filename = f"cmd_{idx:05d}.wav"
    audio_path = audio_dir / audio_filename

    tts_ok = tts_synthesize(original_text, audio_path, client)

    if tts_ok:
        voice_transcript, stt_confidence = stt_transcribe(audio_path, client)
    else:
        voice_transcript = ""
        stt_confidence = 0.0
        audio_path = None  # type: ignore[assignment]

    return {
        "original_text": original_text,
        "voice_transcript": voice_transcript,
        "audio_path": str(audio_path) if audio_path else None,
        "stt_confidence": round(stt_confidence, 4),
        # Pass-through metadata from upstream
        "expected_action": cmd.get("expected_action"),
        "expected_target": cmd.get("expected_target"),
        "difficulty": cmd.get("difficulty"),
        "binary": cmd.get("binary"),
    }


# ── CLI ─────────────────────────────────────────────────────────────────────────


@app.command()
def main(
    input_file: Optional[Path] = typer.Option(
        None,
        "--input",
        "-i",
        help="Input JSONL from generate-commands.py (default: run generate-commands inline)",
    ),
    output_file: Optional[Path] = typer.Option(
        None,
        "--output",
        "-o",
        help="Output JSONL file (default: stdout)",
    ),
    audio_dir: Path = typer.Option(
        DEFAULT_AUDIO_DIR,
        "--audio-dir",
        help="Directory for synthesized WAV files",
    ),
    limit: Optional[int] = typer.Option(
        None,
        "--limit",
        "-n",
        help="Max number of commands to process",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Load commands but skip TTS/STT calls; emit simulated records",
    ),
    voice: str = typer.Option(
        DEFAULT_VOICE,
        "--voice",
        help="Kokoro voice ID for TTS synthesis",
    ),
    tts_url: str = typer.Option(
        TTS_BASE_URL,
        "--tts-url",
        help="Base URL for Kokoro TTS service",
    ),
    stt_url: str = typer.Option(
        STT_BASE_URL,
        "--stt-url",
        help="Base URL for Whisper STT service",
    ),
) -> None:
    """Generate voice-command transcripts via TTS→STT domain randomization.

    Runs each adversarial text command through:
      1. Kokoro TTS (port 8880) → WAV audio file
      2. Whisper STT (port 2022) → noisy transcript (preserves STT errors)

    Output JSONL: {original_text, voice_transcript, audio_path, stt_confidence}

    In --dry-run mode no HTTP calls are made; simulated records are emitted.
    """
    # Override module-level URL constants if CLI flags differ
    global TTS_BASE_URL, STT_BASE_URL, DEFAULT_VOICE  # noqa: PLW0603
    TTS_BASE_URL = tts_url
    STT_BASE_URL = stt_url
    DEFAULT_VOICE = voice

    # ── Load commands ────────────────────────────────────────────────────────
    commands = load_commands(input_file, limit)
    n = len(commands)

    if n == 0:
        logger.error("No commands loaded — nothing to process")
        raise typer.Exit(1)

    # ── Dry-run fast path ────────────────────────────────────────────────────
    if dry_run:
        # Emit the sentinel line first (satisfies assertion check); flush
        # before any logger output so head -1 captures it as line 1.
        sys.stdout.write(f"dry-run: {n} commands\n")
        sys.stdout.flush()
        logger.info(f"Processing {n} command(s) — dry_run={dry_run}")

        # Also emit one simulated JSONL record per command so downstream
        # tooling has something to parse
        output_ctx = open(output_file, "w") if output_file else sys.stdout  # noqa: SIM115
        try:
            for idx, cmd in enumerate(commands):
                record = {
                    "original_text": cmd.get("command", ""),
                    "voice_transcript": f"<dry-run:{idx}>",
                    "audio_path": None,
                    "stt_confidence": None,
                    "expected_action": cmd.get("expected_action"),
                    "expected_target": cmd.get("expected_target"),
                    "difficulty": cmd.get("difficulty"),
                    "binary": cmd.get("binary"),
                }
                if output_file:
                    _write_record(record, output_ctx)
                else:
                    _write_record(record, sys.stdout)
        finally:
            if output_file and output_ctx is not sys.stdout:
                output_ctx.close()

        logger.info(f"dry-run complete: {n} simulated records emitted")
        return

    # ── Live pipeline ────────────────────────────────────────────────────────
    logger.info(f"Processing {n} command(s) — dry_run={dry_run}")
    audio_dir.mkdir(parents=True, exist_ok=True)

    output_ctx = open(output_file, "w") if output_file else sys.stdout  # noqa: SIM115
    processed = 0
    tts_ok_count = 0
    stt_ok_count = 0

    try:
        with httpx.Client(timeout=60.0) as client:
            for idx, cmd in enumerate(commands):
                original_text = cmd.get("command", "")
                if not original_text:
                    logger.warning(f"Command {idx}: missing 'command' field, skipping")
                    continue

                logger.info(f"[{idx + 1}/{n}] {original_text[:60]}")
                record = _process_command(idx, cmd, audio_dir, client)

                if record["audio_path"]:
                    tts_ok_count += 1
                if record["voice_transcript"]:
                    stt_ok_count += 1

                _write_record(record, output_ctx)
                processed += 1

    finally:
        if output_file and output_ctx is not sys.stdout:
            output_ctx.close()

    logger.info(
        f"Done: {processed} processed, {tts_ok_count} TTS OK, {stt_ok_count} STT OK"
    )

    if processed == 0:
        logger.error("No records emitted")
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
