"""Extraction (all formats incl. OCR) and chunking strategy tests on real generated files."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.chunking.strategies import chunk_blocks, count_tokens
from app.ingestion.extractors import ExtractionError, extract
from app.schemas.settings import ChunkingSettings
from tests import docgen

LOREM = ("Retrieval augmented generation combines a search step with a language model so that answers are "
         "grounded in source documents and can cite their evidence. ")


def write(tmp_path: Path, name: str, data: bytes) -> Path:
    p = tmp_path / name
    p.write_bytes(data)
    return p


def test_pdf_pages_headings_tables_and_header_removal(tmp_path):
    pages = [[f"Section text for page {i}. " + LOREM * 3] for i in range(1, 5)]
    path = write(tmp_path, "report.pdf", docgen.pdf_bytes(
        pages, heading="Annual Security Review", table=[["Control", "Status"], ["MFA", "Enabled"], ["SSO", "Pending"]]))
    doc = extract(path, ".pdf")
    assert doc.page_count == 4
    assert {b.page for b in doc.blocks if b.kind == "text"} == {1, 2, 3, 4}
    headings = [b for b in doc.blocks if b.kind == "heading"]
    assert headings and headings[0].text == "Annual Security Review"
    tables = [b for b in doc.blocks if b.kind == "table"]
    assert tables and "| MFA | Enabled |" in tables[0].text and tables[0].page == 4
    full = " ".join(b.text for b in doc.blocks)
    assert "ACME Corp" not in full, "running header should be removed"
    assert "Page 2" not in full, "page-number footer should be removed"


def test_scanned_pdf_uses_ocr(tmp_path):
    path = write(tmp_path, "scan.pdf", docgen.scanned_pdf_bytes(
        ["INVOICE NUMBER 88213", "Total amount due 4250 EUR", "Payment within 30 days"]))
    doc = extract(path, ".pdf")
    text = " ".join(b.text for b in doc.blocks).upper()
    assert doc.metadata["ocr_pages"] == [1]
    assert "88213" in text and "4250" in text


def test_docx_headings_tables_and_page_breaks(tmp_path):
    doc = extract(write(tmp_path, "travel.docx", docgen.docx_bytes()), ".docx")
    assert doc.title == "Travel Policy"
    assert any(b.kind == "heading" and b.text == "Booking" and b.level == 2 for b in doc.blocks)
    table = next(b for b in doc.blocks if b.kind == "table")
    assert "| Japan | 7800 JPY |" in table.text and table.page == 2


def test_pptx_slides_tables_and_notes(tmp_path):
    doc = extract(write(tmp_path, "deck.pptx", docgen.pptx_bytes()), ".pptx")
    assert doc.page_count == 2
    text = "\n".join(b.text for b in doc.blocks)
    assert "Slide 1: Quarterly Roadmap" in text and "Orion analytics" in text
    assert "Speaker notes: Mention the beta customers" in text
    assert any(b.kind == "table" and "12,000 USD" in b.text and b.page == 2 for b in doc.blocks)


def test_xlsx_and_csv_rows_become_records(tmp_path):
    x = extract(write(tmp_path, "inv.xlsx", docgen.xlsx_bytes()), ".xlsx")
    text = "\n".join(b.text for b in x.blocks)
    assert "SKU: SKU-1002; Product: Barcode scanner; Stock: 7" in text and "Lumen Parts" in text
    c = extract(write(tmp_path, "sales.csv", docgen.CSV), ".csv")
    assert any("manager: Bilal Haddad" in b.text for b in c.blocks)


def test_html_strips_scripts_and_navigation(tmp_path):
    doc = extract(write(tmp_path, "guide.html", docgen.HTML), ".html")
    text = "\n".join(b.text for b in doc.blocks)
    assert doc.title == "Onboarding Guide"
    assert "badge from the facilities desk" in text and "| Monday | Orientation |" in text
    assert "alert(" not in text and "Home | About" not in text


def test_markdown_ignores_hash_inside_code_fences(tmp_path):
    doc = extract(write(tmp_path, "runbook.md", docgen.MARKDOWN), ".md")
    headings = [b.text for b in doc.blocks if b.kind == "heading"]
    assert headings == ["Incident Response Runbook", "Severity levels", "Communication"]


def test_txt_and_empty_document_error(tmp_path):
    assert "Rotterdam" in extract(write(tmp_path, "a.txt", docgen.TEXT), ".txt").blocks[0].text
    with pytest.raises(ExtractionError):
        extract(write(tmp_path, "blank.txt", b"   \n  "), ".txt")


@pytest.fixture
def long_blocks(tmp_path):
    pages = [[f"Chapter {i} discussion. " + LOREM * 12] for i in range(1, 7)]
    path = write(tmp_path, "long.pdf", docgen.pdf_bytes(pages, heading="Research Handbook"))
    return extract(path, ".pdf").blocks


@pytest.mark.parametrize("strategy", ["recursive", "token", "structure", "parent_child"])
def test_chunking_strategies_respect_size_and_keep_pages(long_blocks, strategy):
    settings = ChunkingSettings(strategy=strategy, chunk_size=200, chunk_overlap=30, parent_chunk_size=600,
                                child_chunk_size=150)
    drafts = chunk_blocks(long_blocks, settings)
    searchable = [d for d in drafts if d.chunk_type != "parent"]
    assert len(searchable) > 5
    limit = settings.child_chunk_size if strategy == "parent_child" else settings.chunk_size
    assert all(d.token_count <= limit + 5 for d in searchable)
    assert all(d.page_number is not None and 1 <= d.page_number <= 6 for d in drafts)
    assert all(d.page_end >= d.page_number for d in drafts)
    pages = {d.page_number for d in searchable}
    assert len(pages) >= 5, "chunks should map back to many different pages"
    if strategy == "parent_child":
        parents = [i for i, d in enumerate(drafts) if d.chunk_type == "parent"]
        children = [d for d in drafts if d.chunk_type == "child"]
        assert parents and children and all(d.parent_ref in parents for d in children)
    if strategy == "structure":
        assert all(d.section_title == "Research Handbook" for d in searchable)


def test_structure_chunking_never_crosses_large_sections_and_keeps_tables():
    from app.ingestion.extractors import Block

    blocks = [Block("Alpha", kind="heading", level=1), Block(LOREM * 20, page=1),
              Block("Beta", kind="heading", level=1), Block(LOREM * 20, page=2),
              Block("| a | b |\n| --- | --- |\n| 1 | 2 |", page=2, kind="table")]
    drafts = chunk_blocks(blocks, ChunkingSettings(strategy="structure", chunk_size=300, chunk_overlap=20))
    for d in drafts:
        assert d.section_title in ("Alpha", "Beta")
        assert not ("Alpha" in d.content and "Beta" in d.content)
    table = [d for d in drafts if d.metadata.get("content_type") == "table"]
    assert len(table) == 1 and table[0].content.startswith("| a | b |")


def test_tiny_sections_merge_under_common_parent_title():
    from app.ingestion.extractors import Block

    blocks = [Block("Policy", kind="heading", level=1), Block("Eligibility", kind="heading", level=2),
              Block("Short rule one."), Block("Equipment", kind="heading", level=2), Block("Short rule two.")]
    drafts = chunk_blocks(blocks, ChunkingSettings(strategy="structure", chunk_size=400, chunk_overlap=20))
    assert len(drafts) == 1
    assert drafts[0].section_title == "Policy"
    assert "Equipment" in drafts[0].content


def test_semantic_chunking_with_real_embeddings():
    from app.embeddings.provider import get_embeddings
    from app.ingestion.extractors import Block

    text = ("Cats are small domesticated felines. They purr and groom themselves. "
            "Kittens are playful and curious. " * 3 +
            "The stock market fell sharply today. Investors sold technology shares. Bond yields rose. " * 3)
    drafts = chunk_blocks([Block(text, page=1)], ChunkingSettings(strategy="semantic", chunk_size=300,
                                                                  chunk_overlap=20), get_embeddings())
    assert len(drafts) >= 2
    assert all(count_tokens(d.content) <= 305 for d in drafts)
