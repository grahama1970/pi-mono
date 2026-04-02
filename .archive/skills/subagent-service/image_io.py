"""Image I/O helpers for subagent-service.

Handles base64 decode/encode of images for bidirectional image support:
- Input: decode base64 → temp files → pass to CLI backends
- Output: scan output dir → encode to base64 → return in response
"""
from __future__ import annotations

import base64
import re
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ImageInput(BaseModel):
    """Base64-encoded image to pass to the subagent."""
    data: str = Field(..., description="Base64-encoded image data (no data URI prefix)")
    media_type: str = Field("image/png", description="MIME type: image/png, image/jpeg, image/webp")
    filename: Optional[str] = Field(None, description="Optional filename hint")


class OutputImage(BaseModel):
    """Base64-encoded image produced by the subagent."""
    data: str
    media_type: str
    filename: str


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MIME_TO_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
EXT_TO_MIME = {v: k for k, v in MIME_TO_EXT.items()}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def write_input_images(images: list[ImageInput], work_dir: Path) -> list[Path]:
    """Decode base64 images to temp files. Returns list of written file paths."""
    img_dir = work_dir / "input_images"
    img_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for i, img in enumerate(images):
        ext = MIME_TO_EXT.get(img.media_type, ".png")
        fname = img.filename or f"image_{i}{ext}"
        fname = re.sub(r"[^\w.\-]", "_", fname)
        p = img_dir / fname
        p.write_bytes(base64.b64decode(img.data))
        paths.append(p)
    return paths


def collect_output_images(output_dir: Path) -> list[OutputImage]:
    """Scan a directory for image files and return as base64-encoded OutputImage list."""
    results: list[OutputImage] = []
    if not output_dir.is_dir():
        return results
    for ext, mime in EXT_TO_MIME.items():
        for p in sorted(output_dir.glob(f"*{ext}")):
            if p.stat().st_size > 20 * 1024 * 1024:  # Skip >20MB
                continue
            data = base64.b64encode(p.read_bytes()).decode()
            results.append(OutputImage(data=data, media_type=mime, filename=p.name))
    return results


def inject_image_refs(prompt: str, image_paths: list[Path]) -> str:
    """Prepend image file references to the prompt text.

    All CLI agents (Claude, Codex, Gemini) read local files when referenced
    in the prompt via their built-in file-reading tools. No backend has a
    dedicated image attachment flag — prompt injection is the universal method.
    """
    if not image_paths:
        return prompt
    refs = "\n".join(f"[Image: {p}]" for p in image_paths)
    return f"{refs}\n\n{prompt}"


def build_image_flags(image_flag: str | None, image_paths: list[Path]) -> list[str]:
    """Return backend-specific CLI flags for image file attachments.

    Args:
        image_flag: The CLI flag for attaching files (e.g. "-f"), or None.
        image_paths: List of image file paths.
    """
    if not image_flag or not image_paths:
        return []
    flags: list[str] = []
    for p in image_paths:
        flags.extend([image_flag, str(p)])
    return flags
