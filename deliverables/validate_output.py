from pathlib import Path
import csv, re, hashlib
from pypdf import PdfReader
src = Path(r"C:\Users\gaily\OneDrive\Desktop\Iliguide\deliverables\IliGuide_SRS.md")
out = Path(r"C:\Users\gaily\Downloads\IliGuide SRS Documentation")
md = (out / "IliGuide_SRS.md").read_text(encoding="utf-8")
source = src.read_text(encoding="utf-8")
assert hashlib.sha256(md.encode()).digest() == hashlib.sha256(source.encode()).digest(), "Markdown copy differs"
sections = [int(m.group(1)) for line in source.splitlines() if (m := re.match(r"^# (\d+)\.", line))]
assert sections == list(range(1, 28)), sections
assert not re.search(r"^\s*[-*]\s+", source, re.M), "Markdown bullet list found"
ids = set(re.findall(r"\b(?:FR|NFR|SEC)-\d{2}\b", source))
assert len(ids) == 57, len(ids)
with (out / "Requirements_Traceability_Matrix.csv").open(encoding="utf-8-sig", newline="") as f:
    rows = list(csv.DictReader(f))
assert len(rows) == 57, len(rows)
assert {r["Requirement_ID"] for r in rows} == ids
assert all(r["Fit_Criterion"].strip() for r in rows)
with (out / "System_Evidence_Matrix.csv").open(encoding="utf-8-sig", newline="") as f:
    evidence = list(csv.DictReader(f))
pdf = PdfReader(str(out / "IliGuide_SRS.pdf"))
assert len(pdf.pages) == 52, len(pdf.pages)
assert "References and Source Basis" in pdf.pages[-1].extract_text()
assert "Page 52 of 52" in pdf.pages[-1].extract_text()
assert len(evidence) > 0
print(f"27 sections; no bullet lists; {len(ids)} requirements; {len(rows)} traceability rows; {len(evidence)} evidence rows; {len(pdf.pages)} PDF pages; output Markdown matches source.")
