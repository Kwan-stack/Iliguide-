from pathlib import Path
import re
import sys

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Mm, Pt, RGBColor


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=65, start=85, bottom=65, end=85):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for side, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{side}"))
        if node is None:
            node = OxmlElement(f"w:{side}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def mark_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def prevent_row_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    tr_pr.append(cant_split)


def add_field(paragraph, instruction, fallback=""):
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    code = OxmlElement("w:instrText")
    code.set(qn("xml:space"), "preserve")
    code.text = f" {instruction} "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = fallback
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, code, separate, text, end])


def markdown_cells(line):
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def clean_md(value):
    return re.sub(r"\*\*(.*?)\*\*", r"\1", value).replace("<br>", "\n")


def set_run_font(run, size=11, bold=None, color=None):
    run.font.name = "Times New Roman"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Times New Roman")
    run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = RGBColor(*color)


def main(source, target):
    lines = Path(source).read_text(encoding="utf-8").splitlines()
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Mm(210)
    sec.page_height = Mm(297)
    sec.top_margin = Inches(0.82)
    sec.bottom_margin = Inches(0.82)
    sec.left_margin = Inches(0.9)
    sec.right_margin = Inches(0.9)
    sec.header_distance = Inches(0.4)
    sec.footer_distance = Inches(0.4)
    sec.different_first_page_header_footer = True

    normal = doc.styles["Normal"]
    normal.font.name = "Times New Roman"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Times New Roman")
    normal.font.size = Pt(11)
    normal.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    normal.paragraph_format.line_spacing = 1.17
    normal.paragraph_format.space_after = Pt(7)
    normal.paragraph_format.first_line_indent = Inches(0.28)

    for name, size in (("Title", 19), ("Subtitle", 13), ("Heading 1", 15), ("Heading 2", 12.5), ("Heading 3", 11.5)):
        style = doc.styles[name]
        style.font.name = "Times New Roman"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "Times New Roman")
        style.font.size = Pt(size)
        style.font.bold = name != "Subtitle"
        style.font.color.rgb = RGBColor(24, 47, 66)
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.space_before = Pt(13 if name == "Heading 1" else 9)
        style.paragraph_format.space_after = Pt(5)
        style.paragraph_format.first_line_indent = Inches(0)

    header = sec.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    set_run_font(header.add_run("ILIGUIDE  |  SYSTEM REQUIREMENTS SPECIFICATION"), 8, color=(95, 108, 118))
    footer = sec.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run_font(footer.add_run("Draft for stakeholder review  |  Page "), 8, color=(95, 108, 118))
    add_field(footer, "PAGE")
    set_run_font(footer.add_run(" of "), 8, color=(95, 108, 118))
    add_field(footer, "NUMPAGES")
    first_footer = sec.first_page_footer.paragraphs[0]
    first_footer.clear()

    settings = doc.settings.element
    update_fields = OxmlElement("w:updateFields")
    update_fields.set(qn("w:val"), "true")
    settings.append(update_fields)

    i = 0
    body_started = False
    cover = True
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line == "[[TOC]]":
            doc.add_page_break()
            p = doc.add_paragraph("Table of Contents", style="Heading 1")
            p.paragraph_format.first_line_indent = Inches(0)
            toc = doc.add_paragraph()
            toc.paragraph_format.first_line_indent = Inches(0)
            add_field(toc, 'TOC \\o "1-2" \\h \\z \\u', "Open in Word and update the table of contents if it is not populated.")
            doc.add_page_break()
            cover = False
            body_started = True
            i += 1
            continue
        if line.startswith("|"):
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1
            rows = [markdown_cells(x) for x in table_lines if not re.fullmatch(r"\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?", x)]
            if not rows:
                continue
            table = doc.add_table(rows=1, cols=len(rows[0]))
            table.autofit = True
            table.style = "Table Grid"
            for ri, values in enumerate(rows):
                cells = table.rows[0].cells if ri == 0 else table.add_row().cells
                prevent_row_split(table.rows[ri])
                if ri == 0:
                    mark_header(table.rows[0])
                for ci, value in enumerate(values):
                    cell = cells[ci]
                    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                    set_cell_margins(cell)
                    cell.text = clean_md(value)
                    for p in cell.paragraphs:
                        p.paragraph_format.first_line_indent = Inches(0)
                        p.paragraph_format.space_after = Pt(1)
                        p.paragraph_format.space_before = Pt(0)
                        p.paragraph_format.line_spacing = 1.0
                        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
                        for run in p.runs:
                            set_run_font(run, 8.1 if len(rows[0]) >= 4 else 8.7, bold=(ri == 0))
                    if ri == 0:
                        set_cell_shading(cell, "18384F")
                        for p in cell.paragraphs:
                            for run in p.runs:
                                run.font.color.rgb = RGBColor(255, 255, 255)
                    elif ri % 2 == 0:
                        set_cell_shading(cell, "F2F6F8")
            doc.add_paragraph().paragraph_format.space_after = Pt(2)
            continue
        if line.startswith("#"):
            level = len(line) - len(line.lstrip("#"))
            text = line[level:].strip()
            if cover and not body_started and level == 1:
                p = doc.add_paragraph(style="Title")
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.paragraph_format.space_before = Pt(74)
                p.paragraph_format.space_after = Pt(18)
                set_run_font(p.add_run(text), 19, True, (24, 47, 66))
            elif cover and not body_started and level == 2:
                p = doc.add_paragraph(style="Subtitle")
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                set_run_font(p.add_run(text), 13, True, (74, 93, 106))
            else:
                style = "Heading 1" if level == 1 else "Heading 2" if level == 2 else "Heading 3"
                p = doc.add_paragraph(text, style=style)
                if level == 1 and re.match(r"\d+\.", text):
                    p.paragraph_format.page_break_before = True
            i += 1
            continue
        block = []
        while i < len(lines) and lines[i].strip() and not lines[i].strip().startswith("#") and not lines[i].strip().startswith("|") and lines[i].strip() != "[[TOC]]":
            block.append(lines[i].rstrip())
            i += 1
        p = doc.add_paragraph()
        if cover and not body_started:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.first_line_indent = Inches(0)
            p.paragraph_format.space_after = Pt(4)
            for j, text in enumerate(block):
                if j:
                    p.add_run().add_break()
                set_run_font(p.add_run(text.strip()), 11)
        else:
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            p.paragraph_format.first_line_indent = Inches(0.28)
            p.add_run(" ".join(x.strip() for x in block))

    props = doc.core_properties
    props.title = "IliGuide System Requirements Specification"
    props.subject = "Volere V16-structured requirements for the IliGuide project"
    props.author = "IliGuide Project Team"
    props.keywords = "IliGuide, SRS, visitor management, requirements"
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    doc.save(target)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: build_docx.py source.md target.docx")
    main(sys.argv[1], sys.argv[2])
