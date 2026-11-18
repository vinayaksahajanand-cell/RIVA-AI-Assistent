"""Generate real documents of every supported format for tests."""

from __future__ import annotations

import io


def pdf_bytes(pages: list[list[str]], *, header: str | None = "ACME Corp — Confidential", table: list[list[str]] | None = None,
              heading: str | None = None) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    for page_no, paragraphs in enumerate(pages, start=1):
        y = height - 60
        if header:
            c.setFont("Helvetica", 8)
            c.drawString(50, height - 30, header)
        if heading and page_no == 1:
            c.setFont("Helvetica-Bold", 18)
            c.drawString(50, y, heading)
            y -= 34
        c.setFont("Helvetica", 11)
        for para in paragraphs:
            words = para.split()
            line = ""
            for w in words:
                if c.stringWidth(f"{line} {w}", "Helvetica", 11) > width - 100:
                    c.drawString(50, y, line.strip())
                    y -= 15
                    line = ""
                line += " " + w
            if line.strip():
                c.drawString(50, y, line.strip())
                y -= 15
            y -= 10
        if table and page_no == len(pages):
            y -= 10
            col_w = (width - 100) / len(table[0])
            for row in table:
                for j, cell in enumerate(row):
                    c.rect(50 + j * col_w, y - 4, col_w, 18)
                    c.drawString(54 + j * col_w, y + 1, cell)
                y -= 18
        c.setFont("Helvetica", 8)
        c.drawString(width / 2, 25, f"Page {page_no}")
        c.showPage()
    c.save()
    return buf.getvalue()


def scanned_pdf_bytes(lines: list[str]) -> bytes:
    """An image-only PDF (no text layer) to exercise OCR."""
    from PIL import Image, ImageDraw, ImageFont
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    img = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("arial.ttf", 40)
    except OSError:
        font = ImageFont.load_default(size=40)
    y = 150
    for line in lines:
        draw.text((100, y), line, fill="black", font=font)
        y += 80
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.drawImage(ImageReader(img), 0, 0, width=A4[0], height=A4[1])
    c.showPage()
    c.save()
    return buf.getvalue()


def docx_bytes() -> bytes:
    import docx
    from docx.enum.text import WD_BREAK

    d = docx.Document()
    d.core_properties.title = "Travel Policy"
    d.add_heading("Travel Policy", level=1)
    d.add_heading("Booking", level=2)
    d.add_paragraph("Flights must be booked at least 14 days in advance through the approved travel portal.")
    d.add_paragraph("Business class is permitted only for flights longer than eight hours.")
    p = d.add_paragraph("Hotels are capped at 180 euros per night in major cities.")
    p.add_run().add_break(WD_BREAK.PAGE)
    d.add_heading("Per diem rates", level=2)
    t = d.add_table(rows=3, cols=2)
    for i, (a, b) in enumerate([("Country", "Daily allowance"), ("Germany", "52 EUR"), ("Japan", "7800 JPY")]):
        t.rows[i].cells[0].text, t.rows[i].cells[1].text = a, b
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def pptx_bytes() -> bytes:
    from pptx import Presentation
    from pptx.util import Inches

    prs = Presentation()
    s1 = prs.slides.add_slide(prs.slide_layouts[1])
    s1.shapes.title.text = "Quarterly Roadmap"
    s1.placeholders[1].text = "Launch the Orion analytics module in March"
    s1.notes_slide.notes_text_frame.text = "Mention the beta customers from the pilot."
    s2 = prs.slides.add_slide(prs.slide_layouts[5])
    s2.shapes.title.text = "Budget"
    rows = s2.shapes.add_table(2, 2, Inches(1), Inches(2), Inches(6), Inches(1)).table
    rows.cell(0, 0).text, rows.cell(0, 1).text = "Item", "Cost"
    rows.cell(1, 0).text, rows.cell(1, 1).text = "Cloud hosting", "12,000 USD"
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def xlsx_bytes() -> bytes:
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Inventory"
    ws.append(["SKU", "Product", "Stock"])
    ws.append(["SKU-1001", "Thermal printer", 42])
    ws.append(["SKU-1002", "Barcode scanner", 7])
    ws2 = wb.create_sheet("Suppliers")
    ws2.append(["Supplier", "Country"])
    ws2.append(["Lumen Parts", "Portugal"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


CSV = b"region,manager,revenue\nNorth,Alice Moreau,1.2M\nSouth,Bilal Haddad,0.8M\n"

HTML = b"""<html><head><title>Onboarding Guide</title><script>alert('x')</script></head>
<body><nav>Home | About</nav><h1>Onboarding Guide</h1><h2>First week</h2>
<p>New hires receive their badge from the facilities desk on day one.</p>
<ul><li>Complete security training</li><li>Meet your buddy</li></ul>
<table><tr><th>Day</th><th>Activity</th></tr><tr><td>Monday</td><td>Orientation</td></tr></table>
<footer>Copyright</footer></body></html>"""

MARKDOWN = b"""# Incident Response Runbook

## Severity levels
SEV1 incidents require the on-call engineer to acknowledge within 5 minutes.

```bash
# not a heading
kubectl rollout undo deployment/api
```

## Communication
Status page updates are posted every 30 minutes during a SEV1.
"""

TEXT = b"The warehouse in Rotterdam operates two shifts.\n\nThe night shift ends at 06:00 local time."


def blank_pdf_bytes() -> bytes:
    """A valid PDF whose only page is empty (no text layer and nothing for OCR to read)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.showPage()
    c.save()
    return buf.getvalue()
