"""Lattice table parser: detects tables with visible borders/gridlines.

Pipeline: render_page -> adaptive_threshold -> find_lines -> find_contours
          -> find_joints -> build_cells -> assign_text

All output bboxes use top-left origin: (x0, y0_top, x1, y1_bottom) where y=0 is top of page.
"""
from __future__ import annotations

import io
import logging
from typing import Optional

import numpy as np
from PIL import Image

from ..models import Cell, Table
from ..pdf_bridge import TextElement, extract_text_elements, get_page_dimensions, render_page_image

logger = logging.getLogger("extract_tables.lattice")

# ---------------------------------------------------------------------------
# Try to import Rust accelerated functions; fall back to pure Python
# ---------------------------------------------------------------------------

try:
    import extract_tables_rs as _rs

    def _adaptive_threshold(png_bytes: bytes, block_radius: int, delta: int) -> bytes:
        return _rs.adaptive_threshold_image(png_bytes, block_radius, delta)

    def _find_lines(png_bytes: bytes, direction: str, line_scale: int, iterations: int):
        return _rs.find_lines(png_bytes, direction, line_scale, iterations)

    def _morphological_open(png_bytes: bytes, direction: str, line_scale: int, iterations: int) -> bytes:
        return _rs.morphological_open_image(png_bytes, direction, line_scale, iterations)

    def _find_contours(png_bytes: bytes):
        return _rs.find_contours_in_image(png_bytes)

    def _find_joints(h_mask_bytes: bytes, v_mask_bytes: bytes):
        return _rs.find_joints(h_mask_bytes, v_mask_bytes)

    def _merge_close_lines(lines: list[float], tol: float) -> list[float]:
        return _rs.merge_close_lines(lines, tol)

    _HAS_RUST = True
except ImportError:
    _HAS_RUST = False

    def _adaptive_threshold(png_bytes: bytes, block_radius: int, delta: int) -> bytes:
        """Pure-Python fallback using OpenCV."""
        import cv2
        arr = np.frombuffer(png_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
        blocksize = 2 * block_radius + 1
        thresh = cv2.adaptiveThreshold(
            img, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, blocksize, delta
        )
        _, buf = cv2.imencode(".png", thresh)
        return buf.tobytes()

    def _find_lines(png_bytes: bytes, direction: str, line_scale: int, iterations: int):
        import cv2
        arr = np.frombuffer(png_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
        h, w = img.shape
        if direction == "horizontal":
            size = max(w // max(line_scale, 1), 1)
            el = cv2.getStructuringElement(cv2.MORPH_RECT, (size, 1))
        else:
            size = max(h // max(line_scale, 1), 1)
            el = cv2.getStructuringElement(cv2.MORPH_RECT, (1, size))
        result = cv2.erode(img, el)
        result = cv2.dilate(result, el)
        for _ in range(max(iterations, 1) - 1):
            result = cv2.erode(result, el)
            result = cv2.dilate(result, el)
        contours, _ = cv2.findContours(result.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        lines = []
        for c in contours:
            x, y, cw, ch = cv2.boundingRect(c)
            if direction == "horizontal":
                y_mid = y + ch / 2.0
                lines.append((float(x), y_mid, float(x + cw), y_mid))
            else:
                x_mid = x + cw / 2.0
                lines.append((x_mid, float(y), x_mid, float(y + ch)))
        return lines

    def _morphological_open(png_bytes: bytes, direction: str, line_scale: int, iterations: int) -> bytes:
        import cv2
        arr = np.frombuffer(png_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
        h, w = img.shape
        if direction == "horizontal":
            size = max(w // max(line_scale, 1), 1)
            el = cv2.getStructuringElement(cv2.MORPH_RECT, (size, 1))
        else:
            size = max(h // max(line_scale, 1), 1)
            el = cv2.getStructuringElement(cv2.MORPH_RECT, (1, size))
        result = img
        for _ in range(max(iterations, 1)):
            result = cv2.erode(result, el)
            result = cv2.dilate(result, el)
        _, buf = cv2.imencode(".png", result)
        return buf.tobytes()

    def _find_contours(png_bytes: bytes):
        import cv2
        arr = np.frombuffer(png_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
        contours, _ = cv2.findContours(img.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        bboxes = []
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            if w > 0 and h > 0:
                bboxes.append((float(x), float(y), float(w), float(h)))
        return bboxes

    def _find_joints(h_mask_bytes: bytes, v_mask_bytes: bytes):
        import cv2
        arr_h = np.frombuffer(h_mask_bytes, np.uint8)
        arr_v = np.frombuffer(v_mask_bytes, np.uint8)
        h_img = cv2.imdecode(arr_h, cv2.IMREAD_GRAYSCALE)
        v_img = cv2.imdecode(arr_v, cv2.IMREAD_GRAYSCALE)
        joint = cv2.bitwise_and(h_img, v_img)
        contours, _ = cv2.findContours(joint, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        joints = []
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            joints.append(((2 * x + w) / 2.0, (2 * y + h) / 2.0))
        return joints

    def _merge_close_lines(lines: list[float], tol: float) -> list[float]:
        if not lines:
            return []
        merged = [lines[0]]
        for val in lines[1:]:
            if abs(val - merged[-1]) <= tol:
                merged[-1] = (merged[-1] + val) / 2.0
            else:
                merged.append(val)
        return merged


# ---------------------------------------------------------------------------
# Helper: image <-> PNG bytes conversion
# ---------------------------------------------------------------------------

def _pil_to_png_bytes(img: Image.Image) -> bytes:
    """Convert a PIL Image to PNG bytes (grayscale)."""
    gray = img.convert("L")
    buf = io.BytesIO()
    gray.save(buf, format="PNG")
    return buf.getvalue()


def _png_bytes_to_array(png_bytes: bytes) -> np.ndarray:
    """Decode PNG bytes to numpy array."""
    img = Image.open(io.BytesIO(png_bytes))
    return np.array(img)


# ---------------------------------------------------------------------------
# Scale helpers (image coords <-> PDF coords, all top-left origin)
# ---------------------------------------------------------------------------

def _scale_image_to_pdf(
    img_x: float, img_y: float, pdf_w: float, pdf_h: float, img_w: float, img_h: float
) -> tuple[float, float]:
    """Convert image pixel coords (top-left origin) to PDF points (top-left origin)."""
    return img_x * (pdf_w / img_w), img_y * (pdf_h / img_h)


def _scale_segment_to_pdf(
    seg: tuple[float, float, float, float],
    pdf_w: float, pdf_h: float, img_w: float, img_h: float,
) -> tuple[float, float, float, float]:
    """Scale a line segment from image coords to PDF coords (both top-left origin)."""
    x1, y1, x2, y2 = seg
    sx = pdf_w / img_w
    sy = pdf_h / img_h
    return (x1 * sx, y1 * sy, x2 * sx, y2 * sy)


# ---------------------------------------------------------------------------
# Core: build table grid from joints
# ---------------------------------------------------------------------------

def _joints_to_grid(
    joints: list[tuple[float, float]], line_tol: float = 2.0
) -> tuple[list[float], list[float]]:
    """Extract sorted, merged column (x) and row (y) coordinates from joints.

    Returns (cols, rows) where:
    - cols: sorted ascending x coordinates
    - rows: sorted ascending y coordinates (top-to-bottom in top-left origin)
    """
    if not joints:
        return [], []

    xs = sorted(set(j[0] for j in joints))
    ys = sorted(set(j[1] for j in joints))

    cols = _merge_close_lines(xs, line_tol)
    rows = _merge_close_lines(ys, line_tol)

    return cols, rows


def _build_cells_from_grid(
    cols: list[float], rows: list[float],
) -> list[Cell]:
    """Build Cell objects from column and row boundaries.

    cols and rows are in top-left-origin PDF coordinates.
    Each cell spans from cols[i] to cols[i+1] and rows[j] to rows[j+1].
    """
    cells = []
    for j in range(len(rows) - 1):
        for i in range(len(cols) - 1):
            x0 = cols[i]
            x1 = cols[i + 1]
            y0 = rows[j]        # top of cell (smaller y = higher on page)
            y1 = rows[j + 1]    # bottom of cell
            cells.append(Cell(x1=x0, y1=y0, x2=x1, y2=y1))
    return cells


def _assign_text_to_cells(
    cells: list[Cell],
    text_elements: list[TextElement],
    strip_text: str = "",
) -> None:
    """Assign text elements to cells based on center-point containment."""
    for elem in text_elements:
        cx = (elem.x0 + elem.x1) / 2.0
        cy = (elem.y0 + elem.y1) / 2.0
        text = elem.text.strip()
        if not text:
            continue
        # Find the cell whose bbox contains the text center
        best = None
        best_area = float("inf")
        for cell in cells:
            # Cell bbox: (x1, y1, x2, y2) = (left, top, right, bottom)
            if cell.x1 <= cx <= cell.x2 and cell.y1 <= cy <= cell.y2:
                area = (cell.x2 - cell.x1) * (cell.y2 - cell.y1)
                if area < best_area:
                    best = cell
                    best_area = area
        if best is not None:
            if best.text:
                best.text += " " + text
            else:
                best.text = text

    # Apply strip_text
    if strip_text:
        for cell in cells:
            if cell.text:
                for ch in strip_text:
                    cell.text = cell.text.replace(ch, "")


def _build_data_grid(
    cells: list[Cell], cols: list[float], rows: list[float]
) -> list[list[str]]:
    """Build a 2D string grid from cells, matching row/col order."""
    n_rows = len(rows) - 1
    n_cols = len(cols) - 1
    grid = [[""] * n_cols for _ in range(n_rows)]

    for cell in cells:
        # Find column index
        ci = None
        for i in range(n_cols):
            if abs(cell.x1 - cols[i]) < 2.0:
                ci = i
                break
        # Find row index
        ri = None
        for j in range(n_rows):
            if abs(cell.y1 - rows[j]) < 2.0:
                ri = j
                break
        if ci is not None and ri is not None:
            grid[ri][ci] = cell.text or ""

    return grid


# ---------------------------------------------------------------------------
# LatticeParser
# ---------------------------------------------------------------------------

class LatticeParser:
    """Extract tables using line detection (lattice/bordered tables).

    Parameters
    ----------
    line_scale : int
        Factor for morphological kernel size. Larger = detect shorter lines.
    line_tol : float
        Tolerance for merging close lines.
    joint_tol : float
        Tolerance for merging close joints.
    threshold_block_radius : int
        Block radius for adaptive thresholding.
    threshold_constant : int
        Constant offset for adaptive thresholding.
    iterations : int
        Morphological operation iterations.
    resolution : int
        DPI for rendering the PDF page.
    process_background : bool
        Invert image before thresholding (for dark backgrounds).
    strip_text : str
        Characters to strip from cell text.
    min_table_joints : int
        Minimum number of joints to qualify as a table.
    """

    def __init__(
        self,
        line_scale: int = 15,
        line_tol: float = 2.0,
        joint_tol: float = 2.0,
        threshold_block_radius: int = 7,
        threshold_constant: int = -2,
        iterations: int = 1,
        resolution: int = 150,
        process_background: bool = False,
        strip_text: str = "",
        min_table_joints: int = 4,
    ):
        self.line_scale = line_scale
        self.line_tol = line_tol
        self.joint_tol = joint_tol
        self.threshold_block_radius = threshold_block_radius
        self.threshold_constant = threshold_constant
        self.iterations = max(iterations, 1)
        self.resolution = resolution
        self.process_background = process_background
        self.strip_text = strip_text
        self.min_table_joints = min_table_joints

    def extract_tables(
        self,
        pdf_path: str,
        page_num: int,
        password: Optional[str] = None,
        **params,
    ) -> list[Table]:
        """Extract tables from a single PDF page using line detection.

        Parameters
        ----------
        pdf_path : str
            Path to the PDF file.
        page_num : int
            0-indexed page number.
        password : str, optional
            PDF password if encrypted.

        Returns
        -------
        list[Table]
            List of extracted tables with top-left-origin bboxes.
        """
        # Override defaults with any kwargs
        line_scale = params.get("line_scale", self.line_scale)
        line_tol = params.get("line_tol", self.line_tol)
        iterations = max(params.get("iterations", self.iterations), 1)
        resolution = params.get("resolution", self.resolution)
        strip_text = params.get("strip_text", self.strip_text)
        min_joints = params.get("min_table_joints", self.min_table_joints)

        # 1. Get page dimensions and text
        pdf_w, pdf_h = get_page_dimensions(pdf_path, page_num)
        text_elements = extract_text_elements(pdf_path, page_num, password)

        # 2. Render page to image
        pil_img = render_page_image(pdf_path, page_num, dpi=resolution, password=password)
        img_w, img_h = pil_img.size

        # 3. Convert to grayscale PNG bytes
        png_bytes = _pil_to_png_bytes(pil_img)

        # 4. Optionally invert for process_background
        if self.process_background:
            gray_arr = _png_bytes_to_array(png_bytes)
            gray_arr = 255 - gray_arr
            inv_img = Image.fromarray(gray_arr)
            png_bytes = _pil_to_png_bytes(inv_img)

        # 5. Adaptive threshold
        thresh_bytes = _adaptive_threshold(
            png_bytes, self.threshold_block_radius, self.threshold_constant
        )

        # 6. Find line masks (morphological open)
        h_mask_bytes = _morphological_open(thresh_bytes, "horizontal", line_scale, iterations)
        v_mask_bytes = _morphological_open(thresh_bytes, "vertical", line_scale, iterations)

        # 7. Find line segments (for edge assignment)
        h_segments_img = _find_lines(thresh_bytes, "horizontal", line_scale, iterations)
        v_segments_img = _find_lines(thresh_bytes, "vertical", line_scale, iterations)

        # 8. Find contours (table boundaries) from combined mask
        h_arr = _png_bytes_to_array(h_mask_bytes)
        v_arr = _png_bytes_to_array(v_mask_bytes)
        combined = np.maximum(h_arr, v_arr).astype(np.uint8)
        combined_img = Image.fromarray(combined)
        combined_bytes = _pil_to_png_bytes(combined_img)
        contour_bboxes = _find_contours(combined_bytes)

        # Sort contours by area descending, take top 10
        contour_bboxes.sort(key=lambda c: c[2] * c[3], reverse=True)
        contour_bboxes = contour_bboxes[:10]

        # 9. For each contour, find joints
        table_data = {}  # bbox_img -> joints_img
        all_joints = _find_joints(h_mask_bytes, v_mask_bytes)

        for cx, cy, cw, ch in contour_bboxes:
            # Filter joints that fall within this contour
            joints_in_bbox = [
                (jx, jy) for jx, jy in all_joints
                if cx - 2 <= jx <= cx + cw + 2 and cy - 2 <= jy <= cy + ch + 2
            ]
            if len(joints_in_bbox) <= min_joints:
                continue
            # Table bbox in image coords (top-left origin, x0,y0,x1,y1)
            bbox_img = (cx, cy, cx + cw, cy + ch)
            table_data[bbox_img] = joints_in_bbox

        # 10. Build tables
        tables = []
        for bbox_img, joints_img in table_data.items():
            # Scale joints from image coords to PDF coords (both top-left)
            joints_pdf = [
                _scale_image_to_pdf(jx, jy, pdf_w, pdf_h, img_w, img_h)
                for jx, jy in joints_img
            ]

            # Scale bbox to PDF coords
            bx0, by0, bx1, by1 = bbox_img
            pdf_bx0, pdf_by0 = _scale_image_to_pdf(bx0, by0, pdf_w, pdf_h, img_w, img_h)
            pdf_bx1, pdf_by1 = _scale_image_to_pdf(bx1, by1, pdf_w, pdf_h, img_w, img_h)

            # Build col/row grid from joints
            cols, rows = _joints_to_grid(joints_pdf, line_tol)

            # Ensure bbox edges are included
            if cols:
                if abs(cols[0] - pdf_bx0) > line_tol:
                    cols.insert(0, pdf_bx0)
                if abs(cols[-1] - pdf_bx1) > line_tol:
                    cols.append(pdf_bx1)
            else:
                cols = [pdf_bx0, pdf_bx1]

            if rows:
                if abs(rows[0] - pdf_by0) > line_tol:
                    rows.insert(0, pdf_by0)
                if abs(rows[-1] - pdf_by1) > line_tol:
                    rows.append(pdf_by1)
            else:
                rows = [pdf_by0, pdf_by1]

            if len(cols) < 2 or len(rows) < 2:
                continue

            # Build cells
            cells = _build_cells_from_grid(cols, rows)

            # Filter text elements within table bbox (with tolerance)
            bbox_pdf = (pdf_bx0, pdf_by0, pdf_bx1, pdf_by1)
            table_text = [
                e for e in text_elements
                if (pdf_bx0 - 2 <= (e.x0 + e.x1) / 2 <= pdf_bx1 + 2
                    and pdf_by0 - 2 <= (e.y0 + e.y1) / 2 <= pdf_by1 + 2)
            ]

            # Assign text to cells
            _assign_text_to_cells(cells, table_text, strip_text)

            # Build data grid
            data = _build_data_grid(cells, cols, rows)

            n_rows = len(rows) - 1
            n_cols = len(cols) - 1

            table = Table(
                cells=cells,
                page_number=page_num + 1,  # 1-indexed
                page_index=page_num,        # 0-indexed
                bbox=bbox_pdf,
                strategy="lattice",
                _data=data,
                _rows=n_rows,
                _cols=n_cols,
            )

            # Compute accuracy/whitespace
            try:
                from metrics import compute_accuracy, compute_whitespace
                table.accuracy = compute_accuracy(table)
                table.whitespace = compute_whitespace(table)
            except ImportError:
                pass

            tables.append(table)

        # Sort by position on page (top-to-bottom, then left-to-right)
        tables.sort(key=lambda t: (t.bbox[1], t.bbox[0]))

        return tables
