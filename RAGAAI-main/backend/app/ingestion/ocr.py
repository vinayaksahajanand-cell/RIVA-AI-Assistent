"""OCR for scanned PDF pages using RapidOCR (ONNX Runtime; no system binaries required)."""

from __future__ import annotations

import threading

from app.core.logging import get_logger

log = get_logger(__name__)

_engine = None
_lock = threading.Lock()


def _get_engine():
    global _engine
    with _lock:
        if _engine is None:
            from rapidocr_onnxruntime import RapidOCR

            _engine = RapidOCR()
        return _engine


def ocr_image(image) -> tuple[str, float]:
    """Run OCR on a PIL image. Returns (text, mean_confidence)."""
    import numpy as np

    engine = _get_engine()
    result, _ = engine(np.asarray(image.convert("RGB")))
    if not result:
        return "", 0.0
    # result: [[box(4 points), text, score], ...]; order by top-y then x to rebuild reading order.
    items = []
    for box, text, score in result:
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        items.append((min(ys), min(xs), max(ys) - min(ys), text, float(score)))
    items.sort(key=lambda t: (t[0], t[1]))
    lines: list[list[tuple]] = []
    for item in items:
        if lines and abs(item[0] - lines[-1][0][0]) < max(8.0, 0.5 * item[2]):
            lines[-1].append(item)
        else:
            lines.append([item])
    text = "\n".join(" ".join(t[3] for t in sorted(line, key=lambda t: t[1])) for line in lines)
    confidence = sum(i[4] for i in items) / len(items)
    return text, confidence


def ocr_pdf_page(path: str, page_index: int, dpi: int) -> tuple[str, float]:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(path)
    try:
        page = pdf[page_index]
        image = page.render(scale=dpi / 72).to_pil()
        page.close()
    finally:
        pdf.close()
    return ocr_image(image)
