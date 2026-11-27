from os import replace
from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph


PATH = Path(
    r"C:\Users\gaily\OneDrive\Desktop\Iliguide\deliverables\Iliguide_Product_Backlog_Functional_Test_Cases.docx"
)
TEMP_PATH = PATH.with_name(PATH.stem + ".updated.docx")


def case_rows(table):
    return {
        row.cells[0].text.strip(): row.cells[1]
        for row in table.rows
        if len(row.cells) > 1
    }


def set_cell(cell, value):
    paragraph = cell.paragraphs[0]
    if paragraph.runs:
        paragraph.runs[0].text = value
        for run in paragraph.runs[1:]:
            run.text = ""
    else:
        paragraph.add_run(value)
    paragraph.paragraph_format.keep_together = True
    for extra in cell.paragraphs[1:]:
        for run in extra.runs:
            run.text = ""


def keep_case_layout(paragraphs, table):
    for paragraph in paragraphs:
        if paragraph.text.startswith("TC-PB-"):
            paragraph.paragraph_format.keep_together = True
            paragraph.paragraph_format.keep_with_next = True
    header = table.rows[0]
    row_properties = header._tr.get_or_add_trPr()
    if row_properties.find(qn("w:cantSplit")) is None:
        row_properties.append(OxmlElement("w:cantSplit"))
    if row_properties.find(qn("w:tblHeader")) is None:
        marker = OxmlElement("w:tblHeader")
        marker.set(qn("w:val"), "true")
        row_properties.append(marker)
    for cell in header.cells:
        for paragraph in cell.paragraphs:
            paragraph.paragraph_format.keep_with_next = True


document = Document(PATH)
cases = {}
for table in document.tables:
    rows = case_rows(table)
    id_cell = rows.get("Test Case ID")
    if id_cell is None:
        continue
    case_id = id_cell.text.strip()
    if case_id.startswith("TC-PB-"):
        if case_id in cases:
            raise ValueError(f"Duplicate case ID: {case_id}")
        cases[case_id] = rows

if len(cases) != 124:
    raise ValueError(f"Expected 124 backlog cases; found {len(cases)}")

intro = next(
    paragraph
    for paragraph in document.paragraphs
    if paragraph.text.startswith("Test cases remain separate")
    or paragraph.text.startswith("Product backlog-based functional test documentation")
)
intro.text = (
    "Test cases remain separate for each of the 28 product backlog items. "
    "Actual results and statuses below record the QA evidence gathered on 2026-11-27."
)

blocks = [
    ("Heading 1", "Execution Results"),
    (
        "Normal",
        "Full QA-copy unit suite: 65/65 pass. Focused actor-route suite: 8/8 pass "
        "after correcting two stale Site Admin route expectations.",
    ),
    (
        "Normal",
        "No product-backlog case completed end-to-end. Local Supabase could not start: "
        "Podman CLI 6.2.1 installed, but machine startup requires WSL 2.5.1 or later; "
        "WSL is absent; the administrator feature-enable prompt was canceled, with no feature change or restart. Static failure: TC-PB-005-01 (separate Sikyop guide fee cannot "
        "be represented). A local migration adds a guard against manual walk-in attendance without "
        "QR verification; its pgTAP regression remains unrun.",
    ),
    (
        "Normal",
        "Route-guard unit checks for TC-PB-026-03 through TC-PB-026-05 pass; API/RLS "
        "scope remains untested. Partial evidence does not make a functional case PASS. "
        "Cases without full-scope execution remain BLOCKED. Evidence: "
        "qa/evidence/test-fixed.log; qa/evidence/actor-route-test-fixed.log; "
        "qa/evidence/docker-install-attempt.md; "
        "supabase/migrations/20261126224632_walkin_attendance_requires_qr.sql; "
        "supabase/tests/qr_attendance_and_live_occupancy.test.sql.",
    ),
]
if not any(p.text == "Execution Results" for p in document.paragraphs):
    pb001 = next(
        paragraph
        for paragraph in document.paragraphs
        if paragraph.style.name == "Heading 1" and paragraph.text.startswith("PB-001")
    )
    for style_name, text in blocks:
        element = OxmlElement("w:p")
        pb001._p.addprevious(element)
        paragraph = Paragraph(element, pb001._parent)
        paragraph.style = document.styles[style_name]
        paragraph.add_run(text)

for case_id, rows in cases.items():
    if len(rows["Actual Result"].paragraphs) != 1 or len(rows["Status"].paragraphs) != 1:
        raise ValueError(f"Unexpected result cell layout: {case_id}")
    set_cell(rows["Actual Result"], "Not run; local Supabase unavailable.")
    rows["Actual Result"].paragraphs[0].paragraph_format.keep_with_next = True
    set_cell(rows["Status"], "BLOCKED")

overrides = {
    "TC-PB-002-01": (
        "UI smoke: public home/discover shell rendered at 390x844 and 1280x800 without "
        "horizontal overflow. Backend disconnected; role-specific unified home not verified.",
        "BLOCKED (partial visual smoke; role flow not run)",
    ),
    "TC-PB-004-01": (
        "Home and Discover shells rendered, but Supabase was disconnected and destination "
        "records were not verified.",
        "BLOCKED (partial UI smoke; data not loaded)",
    ),
    "TC-PB-005-01": (
        "Static review: adult/child entrance fees and PWD discount only; no separate "
        "guide-fee field. Sikyop cannot meet the separate-fee rule; runtime not run.",
        "FAIL (static review; no runtime)",
    ),
    "TC-PB-007-02": (
        "Unit checks pass for booking contact validation, participant payloads, PWD claims, "
        "and total calculation. Reservation submission and database persistence were not run.",
        "BLOCKED (unit evidence only; booking flow not run)",
    ),
    "TC-PB-009-01": (
        "QR ticket eligibility unit check passes. Ticket generation, QR linkage, and "
        "dashboard display were not exercised.",
        "BLOCKED (unit evidence only; ticket flow not run)",
    ),
    "TC-PB-018-04": (
        "Static migration review: local guard rejects manual confirmation for "
        "booking_source='walk_in'. Regression added; pgTAP could not run because "
        "Podman has no WSL/Hyper-V machine.",
        "BLOCKED (fix authored; pgTAP not run)",
    ),
    "TC-PB-026-03": (
        "Role route-guard suite passes 8/8 across Visitor, Gatekeeper, Site Admin, and "
        "Tourism Office. API/RLS permissions were not exercised.",
        "BLOCKED (route unit checks pass; API/RLS not run)",
    ),
    "TC-PB-026-04": (
        "Assigned Site Admin route assertions pass, including Sites and staff and Activity. "
        "Cross-site data scope was not exercised.",
        "BLOCKED (route unit checks pass; API/RLS not run)",
    ),
    "TC-PB-026-05": (
        "Negative route assertions pass for unsupported staff pages. Unauthorized API or "
        "database access was not attempted.",
        "BLOCKED (route unit checks pass; API/RLS not run)",
    ),
}
for case_id, (actual, status) in overrides.items():
    if case_id not in cases:
        raise ValueError(f"Missing expected case: {case_id}")
    set_cell(cases[case_id]["Actual Result"], actual)
    set_cell(cases[case_id]["Status"], status)

case_detail_overrides = {
    "TC-PB-005-01": {
        "Test Steps": (
            "1. Open Discover and select a published destination.\n"
            "2. Open Destination details.\n"
            "3. Compare operating days/hours and adult/child entrance fees with the "
            "Tourism Office-approved schedule for that destination.\n"
            "4. Repeat for Sikyop; verify entrance and guide fees appear as separate "
            "amounts when guide fees are part of the approved schedule.\n"
            "5. Open a destination whose fee information is unconfirmed and verify the "
            "explicit not-confirmed state; do not interpret zero as free admission."
        ),
        "Test Data": (
            "Tourism Office-approved hours and entrance-fee schedule for each published "
            "destination; Sikyop guide-fee amount and billing basis; one destination with "
            "fee_information_confirmed=false. Current repository has no verified fee schedule."
        ),
        "Expected Result": (
            "Each destination shows its approved operating hours and fees. Sikyop entrance "
            "and guide fees appear separately and match the approved billing basis. An "
            "unconfirmed fee schedule is clearly labeled and never presented as free."
        ),
    },
    "TC-PB-018-04": {
        "Scenario": "Manual lookup cannot admit a walk-in without QR verification",
        "Preconditions": (
            "Assigned Gatekeeper account with active duty at the selected site; local "
            "Supabase with current migrations; same-day, paid walk-in booking with a valid "
            "QR ticket and no attendance events."
        ),
        "Test Steps": (
            "1. Record current occupancy and Arrivals Today for the assigned site.\n"
            "2. Open Check-in > Manual reference and search the walk-in booking reference.\n"
            "3. Verify the displayed booking, destination, and current attendance status.\n"
            "4. Attempt manual admission without scanning the QR ticket.\n"
            "5. Verify the attempt is rejected and attendance, occupancy, and arrivals stay "
            "unchanged.\n"
            "6. Scan the valid QR ticket, select the entering visitors, and confirm admission.\n"
            "7. Verify one entry event and the exact occupancy increase; repeat the manual "
            "reference attempt and verify it cannot create another entry."
        ),
        "Test Data": (
            "Synthetic same-day QA_ walk-in booking; matching site and active Gatekeeper "
            "duty; valid QR token; zero prior attendance; captured baseline occupancy and "
            "Arrivals Today."
        ),
        "Expected Result": (
            "Manual reference lookup may display the walk-in but cannot record attendance. "
            "Counts remain unchanged until a valid QR ticket is scanned and the Gatekeeper "
            "confirms admission. Confirmation records one entry only."
        ),
    },
}
for case_id, fields in case_detail_overrides.items():
    for field, value in fields.items():
        set_cell(cases[case_id][field], value)

for table in document.tables:
    rows = case_rows(table)
    if rows.get("Test Case ID"):
        keep_case_layout(document.paragraphs, table)

coverage = next(
    paragraph
    for paragraph in document.paragraphs
    if paragraph.text.startswith("All acceptance criteria have mapped test cases.")
)
coverage.text = (
    "All acceptance criteria have mapped test cases. End-to-end functional execution "
    "remains outstanding; 65/65 unit tests pass, with the Sikyop guide-fee failure and blocked scope "
    "recorded in Execution Results and each case."
)
document.save(TEMP_PATH)

check = Document(TEMP_PATH)
updated = {}
for table in check.tables:
    rows = case_rows(table)
    id_cell = rows.get("Test Case ID")
    if id_cell and id_cell.text.strip().startswith("TC-PB-"):
        updated[id_cell.text.strip()] = (
            rows["Actual Result"].text.strip(),
            rows["Status"].text.strip(),
        )
if len(updated) != 124 or any(not actual or not status for actual, status in updated.values()):
    raise ValueError("Saved case results failed validation")
if any(
    "To be recorded during testing" in actual
    or "to be determined after testing" in status.lower()
    for actual, status in updated.values()
):
    raise ValueError("Unfilled case placeholder remains")
replace(TEMP_PATH, PATH)
print(
    f"Updated {len(updated)} cases; "
    f"static failures={sum(status.startswith('FAIL') for _, status in updated.values())}; "
    f"blocked={sum(status.startswith('BLOCKED') for _, status in updated.values())}."
)
