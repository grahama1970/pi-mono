"""Bridge to pdf_oxide for text extraction and page rendering.

All coordinates output in top-left origin: (x0, y0_top, x1, y1_bottom).
pdf_oxide uses bottom-left origin (x, y, w, h) -- conversion happens HERE only.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Optional

from PIL import Image
import pdf_oxide


@dataclass(slots=True)
class TextElement:
    """A text span with position in top-left coordinates."""
    text: str
    x0: float
    y0: float  # top-left origin: y=0 is top of page
    x1: float
    y1: float  # y1 > y0 always
    font_name: str = ""
    font_size: float = 0.0
    is_bold: bool = False
    is_italic: bool = False


def _open_doc(pdf_path: str, password: Optional[str] = None) -> pdf_oxide.PdfDocument:
    """Open a PDF document, handling passwords."""
    doc = pdf_oxide.PdfDocument(pdf_path)
    if password:
        doc.authenticate(password)
    return doc


def get_page_count(pdf_path: str) -> int:
    """Get number of pages in the PDF."""
    doc = _open_doc(pdf_path)
    return doc.page_count()  # METHOD, not property


def get_page_dimensions(pdf_path: str, page_num: int) -> tuple[float, float]:
    """Get page width and height in PDF points.

    Returns (width, height) tuple.
    """
    doc = _open_doc(pdf_path)
    media_box = doc.page_media_box(page_num)
    # media_box returns (x0, y0, x1, y1) e.g. (0.0, 0.0, 612.0, 792.0)
    x0, y0, x1, y1 = media_box
    width = x1 - x0
    height = y1 - y0
    return (width, height)


def extract_text_elements(
    pdf_path: str, page_num: int, password: Optional[str] = None
) -> list[TextElement]:
    """Extract text elements with top-left coordinates.

    pdf_oxide returns spans with bbox = (x, y, w, h) in bottom-left origin.
    This function converts ALL coordinates to top-left origin.
    """
    doc = _open_doc(pdf_path, password)
    media_box = doc.page_media_box(page_num)
    # media_box: (x0, y0, x1, y1)
    page_h = media_box[3] - media_box[1]

    spans = doc.extract_spans(page_num)
    elements: list[TextElement] = []
    for span in spans:
        # pdf_oxide bbox: (x, y, w, h) in bottom-left origin
        ox, oy, ow, oh = span.bbox

        # Convert to top-left origin (x0, y0_top, x1, y1_bottom)
        x0 = ox
        y0_top = page_h - oy - oh  # flip y, subtract height
        x1 = ox + ow
        y1_bottom = page_h - oy

        font_name = getattr(span, "font_name", "") or ""
        font_size = getattr(span, "font_size", 0.0) or 0.0
        is_bold = getattr(span, "is_bold", False)
        if not is_bold and font_name:
            is_bold = "bold" in font_name.lower()
        is_italic = getattr(span, "is_italic", False)
        if not is_italic and font_name:
            is_italic = "italic" in font_name.lower()

        elements.append(TextElement(
            text=span.text,
            x0=x0,
            y0=y0_top,
            x1=x1,
            y1=y1_bottom,
            font_name=font_name,
            font_size=font_size,
            is_bold=is_bold,
            is_italic=is_italic,
        ))

    return elements


def render_page_image(
    pdf_path: str, page_num: int, dpi: int = 150, password: Optional[str] = None
) -> Image.Image:
    """Render a PDF page as a PIL Image."""
    doc = _open_doc(pdf_path, password)
    img_bytes = doc.render_page(page_num, dpi=dpi)
    return Image.open(io.BytesIO(img_bytes))
