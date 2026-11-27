from pathlib import Path
import csv
import re


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
OUT = Path(r"C:\Users\gaily\Downloads\IliGuide SRS Documentation")
SRS = (ROOT / "IliGuide_SRS.md").read_text(encoding="utf-8")
OUT.mkdir(parents=True, exist_ok=True)


def cells(line):
    return [value.strip() for value in line.strip().strip("|").split("|")]


def requirement_rows():
    lines = SRS.splitlines()
    rows = []
    index = 0
    while index < len(lines):
        if not lines[index].strip().startswith("|"):
            index += 1
            continue
        block = []
        while index < len(lines) and lines[index].strip().startswith("|"):
            block.append(lines[index].strip())
            index += 1
        parsed = [cells(line) for line in block]
        parsed = [row for row in parsed if not all(re.fullmatch(r":?-{3,}:?", value or "") for value in row)]
        if not parsed:
            continue
        header = [value.lower() for value in parsed[0]]
        id_col = next((i for i, value in enumerate(header) if value in ("id", "requirement id")), None)
        fit_col = next((i for i, value in enumerate(header) if "fit criterion" in value), None)
        req_col = next((i for i, value in enumerate(header) if "requirement" in value and "id" not in value), None)
        status_col = next((i for i, value in enumerate(header) if "status" in value), None)
        if id_col is None or fit_col is None or req_col is None:
            continue
        for row in parsed[1:]:
            if len(row) <= max(id_col, fit_col, req_col):
                continue
            identifier = row[id_col].strip()
            if not re.fullmatch(r"(?:FR|NFR|SEC)-\d{2}", identifier):
                continue
            rows.append({
                "id": identifier,
                "requirement": row[req_col],
                "fit": row[fit_col],
                "status": row[status_col] if status_col is not None and status_col < len(row) else "",
            })
    return rows


trace = {
    "FR-01": ("PG-05", "", "BE-06; BE-10", "BUC-06; BUC-10", "PUC-02; PUC-08; PUC-09; PUC-13", "E-01", "OI-09", "Role and site-scope authorization."),
    "FR-02": ("PG-01", "BR-01", "BE-01", "BUC-01", "PUC-01", "E-20", "OI-14", "Scope and approved configuration."),
    "FR-03": ("PG-01", "BR-01", "BE-01", "BUC-01", "PUC-01; PUC-11", "E-02; E-20", "OI-02; OI-03; OI-14", "Public content depends on authorized site data."),
    "FR-04": ("PG-01; PG-02", "BR-04", "BE-01; BE-02", "BUC-01; BUC-02", "PUC-01; PUC-03", "E-03", "OI-04", "Slot and hold rules."),
    "FR-05": ("PG-02", "BR-04", "BE-02", "BUC-02", "PUC-03", "E-04", "OI-10", "Visitor data and booking creation."),
    "FR-06": ("PG-02", "", "BE-02", "BUC-02", "PUC-03", "E-05", "OI-06", "Configured adult, child, and PWD calculation."),
    "FR-07": ("PG-02", "BR-03", "BE-02", "BUC-02", "PUC-03", "E-05; E-06", "OI-02", "Separate Sikyop guide fee is a business rule and current code gap."),
    "FR-08": ("PG-02", "BR-02", "BE-02; BE-03", "BUC-02; BUC-03", "PUC-03; PUC-05", "E-20", "OI-03", "Zero-fee visitor and walk-in handling."),
    "FR-09": ("PG-02", "", "BE-02", "BUC-02", "PUC-03", "E-03; E-14", "OI-04", "Two-stage hold and demo-payment deadline."),
    "FR-10": ("PG-02", "BR-12", "BE-02", "BUC-02", "PUC-03; PUC-04", "E-11", "OI-05", "Free, onsite, and demo-payment states."),
    "FR-11": ("PG-02; PG-03", "BR-04", "BE-02; BE-04", "BUC-02; BUC-04", "PUC-04; PUC-06", "E-06", "OI-14", "Ticket eligibility and validation."),
    "FR-12": ("PG-02", "BR-07", "BE-03", "BUC-03", "PUC-05", "E-10", "OI-03", "Authorized walk-in registration."),
    "FR-13": ("PG-03", "BR-07", "BE-03", "BUC-03", "PUC-05", "E-09; E-10", "OI-01", "Registration versus recorded attendance."),
    "FR-14": ("PG-03", "BR-08", "BE-04", "BUC-04", "PUC-06", "E-07; E-08", "OI-01", "QR validation and Gatekeeper confirmation; manual path is a gap."),
    "FR-15": ("PG-03", "BR-06", "BE-04", "BUC-04", "PUC-06", "E-08", "", "Individual visitor roster and partial group entry."),
    "FR-16": ("PG-03", "BR-09", "BE-05", "BUC-05", "PUC-07", "E-08", "", "Gatekeeper-confirmed checkout."),
    "FR-17": ("PG-03", "", "BE-04; BE-05", "BUC-04; BUC-05", "PUC-06; PUC-07", "E-08", "", "Idempotent attendance transactions."),
    "FR-18": ("PG-03", "BR-10", "BE-04; BE-05", "BUC-04; BUC-05", "PUC-06; PUC-07; PUC-13", "E-09", "OI-16", "Attendance-derived metrics and local date."),
    "FR-19": ("PG-03; PG-04", "BR-11", "BE-07", "BUC-07", "PUC-10; PUC-13", "E-13", "OI-07", "Distinct capacity and attendance measures."),
    "FR-20": ("PG-04", "", "BE-06", "BUC-06", "PUC-08", "E-03; E-13", "OI-09", "Authorized schedules, slots, and closures."),
    "FR-21": ("PG-04", "BR-11", "BE-07", "BUC-07", "PUC-10", "E-13", "OI-07", "Assessment and approved-limit status."),
    "FR-22": ("PG-01; PG-05", "", "BE-01; BE-10", "BUC-01; BUC-10", "PUC-01; PUC-13", "E-15", "OI-11", "Map data availability and freshness."),
    "FR-23": ("PG-01", "", "BE-01", "BUC-01", "PUC-01", "E-14", "", "Optional recommendations do not create bookings."),
    "FR-24": ("PG-01; PG-04", "", "BE-08", "BUC-08", "PUC-11", "E-15", "OI-18", "Published destination information."),
    "FR-25": ("PG-05", "", "BE-09", "BUC-09", "PUC-12", "E-16", "OI-09", "Visitor feedback and moderation."),
    "FR-26": ("PG-02", "BR-12", "BE-02", "BUC-02", "PUC-04", "E-04", "OI-05", "Cancellation decision is distinct from refund."),
    "FR-27": ("PG-05", "BR-10; BR-12", "BE-10", "BUC-10", "PUC-13", "E-17", "OI-16", "Operational report definitions."),
    "FR-28": ("PG-05", "", "BE-10", "BUC-10", "PUC-13", "E-17", "", "CSV export follows report filters."),
    "FR-29": ("PG-04; PG-05", "", "BE-06; BE-10", "BUC-06; BUC-10", "PUC-08; PUC-09; PUC-13", "E-17; E-24", "OI-10", "Audit coverage and retention."),
    "FR-30": ("PG-02", "BR-12", "BE-02", "BUC-02", "PUC-03; PUC-04", "E-11", "OI-05", "Demo status must not imply real payment."),
    "NFR-01": ("PG-01; PG-02; PG-03; PG-04; PG-05", "", "", "", "All applicable PUCs", "E-18", "OI-11; OI-13", "Cross-cutting presentation quality; no single business event."),
    "NFR-02": ("PG-01; PG-02; PG-03; PG-04; PG-05", "BR-04; BR-07; BR-09; BR-10; BR-11; BR-12", "BE-02; BE-04; BE-05; BE-07", "BUC-02; BUC-04; BUC-05; BUC-07", "All applicable PUCs", "E-08; E-09; E-11; E-13", "OI-01; OI-04; OI-05; OI-07", "Cross-cutting status vocabulary."),
    "NFR-03": ("PG-01; PG-02; PG-03; PG-04; PG-05", "", "", "", "All applicable PUCs", "E-18", "OI-13", "Cross-cutting visual and interaction consistency."),
    "NFR-04": ("PG-01; PG-02; PG-03; PG-04", "", "BE-01; BE-02; BE-03; BE-04; BE-05; BE-06", "BUC-01; BUC-02; BUC-03; BUC-04; BUC-05; BUC-06", "PUC-01; PUC-03; PUC-05; PUC-06; PUC-07; PUC-08", "E-06; E-08; E-10", "OI-13", "Usability review is proposed, not completed."),
    "NFR-05": ("PG-01; PG-02; PG-03; PG-04", "", "BE-02; BE-03; BE-04; BE-05; BE-06", "BUC-02; BUC-03; BUC-04; BUC-05; BUC-06", "All affected PUCs", "E-08; E-10", "OI-13; OI-14", "Validation and error handling."),
    "NFR-06": ("PG-02; PG-03; PG-04; PG-05", "", "", "", "Cross-cutting operational support", "E-17", "OI-14", "Role-specific guidance; training not evidenced."),
    "NFR-07": ("PG-01; PG-02; PG-03; PG-04; PG-05", "", "", "", "All applicable PUCs", "E-18", "OI-13", "Cross-cutting accessibility; conformance level open."),
    "NFR-08": ("PG-01; PG-02; PG-03; PG-04; PG-05", "", "", "", "All applicable PUCs", "E-18", "OI-12", "Cross-cutting response-time targets are open."),
    "NFR-09": ("PG-04", "BR-11", "BE-07", "BUC-07", "PUC-10; PUC-13", "E-13", "OI-07", "Capacity values and approval labels."),
    "NFR-10": ("PG-03", "BR-05; BR-08; BR-09", "BE-04; BE-05", "BUC-04; BUC-05", "PUC-06; PUC-07", "E-07; E-08", "OI-01", "Confirmed attendance requires confirmation."),
    "NFR-11": ("PG-03; PG-05", "BR-10", "BE-04; BE-05; BE-10", "BUC-04; BUC-05; BUC-10", "PUC-06; PUC-07; PUC-13", "E-09", "OI-16", "Attendance metrics are derived from records."),
    "NFR-12": ("PG-03; PG-04; PG-05", "BR-10; BR-11", "BE-04; BE-05; BE-07; BE-10", "BUC-04; BUC-05; BUC-07; BUC-10", "PUC-06; PUC-07; PUC-10; PUC-13", "E-09; E-13", "OI-07; OI-16", "Recorded count versus staff estimate."),
    "NFR-13": ("PG-01; PG-02; PG-03; PG-04; PG-05", "", "", "", "Cross-cutting service operation", "E-18", "OI-11", "Availability, backup, and recovery targets open."),
    "NFR-14": ("PG-01; PG-02; PG-03; PG-04", "", "BE-01; BE-02; BE-04; BE-05; BE-07; BE-10", "BUC-01; BUC-02; BUC-04; BUC-05; BUC-07; BUC-10", "PUC-01; PUC-03; PUC-06; PUC-07; PUC-10; PUC-13", "E-03; E-08; E-09; E-13; E-15", "OI-11", "Stale and unavailable backend data."),
    "NFR-15": ("PG-03", "BR-10", "BE-04; BE-05", "BUC-04; BUC-05", "PUC-06; PUC-07", "E-08", "", "Retry-safe attendance."),
    "NFR-16": ("PG-01; PG-02; PG-03; PG-04; PG-05", "", "", "", "Cross-cutting technical capacity", "E-18", "OI-12", "Technical workload and thresholds open."),
    "NFR-17": ("PG-04", "BR-01; BR-11", "BE-06; BE-07", "BUC-06; BUC-07", "PUC-08; PUC-09; PUC-10", "E-01; E-13", "OI-07; OI-09; OI-14", "Extensibility requires approved configuration and scope."),
    "NFR-18": ("PG-05", "", "", "", "Cross-cutting system lifecycle", "E-18", "OI-11", "Service owner and lifecycle policy open."),
    "NFR-19": ("PG-01; PG-04", "BR-01", "BE-01; BE-06; BE-08", "BUC-01; BUC-06; BUC-08", "PUC-01; PUC-08; PUC-11", "E-20", "OI-13; OI-14", "Local naming and terminology approval."),
    "NFR-20": ("PG-01; PG-03; PG-05", "BR-10", "BE-01; BE-04; BE-05; BE-10", "BUC-01; BUC-04; BUC-05; BUC-10", "PUC-01; PUC-03; PUC-06; PUC-07; PUC-13", "E-09", "OI-13", "Currency and Asia/Manila policy."),
    "SEC-01": ("PG-02; PG-03; PG-04; PG-05", "", "BE-03; BE-04; BE-05; BE-06; BE-07; BE-08; BE-09; BE-10", "BUC-03; BUC-04; BUC-05; BUC-06; BUC-07; BUC-08; BUC-09; BUC-10", "All protected PUCs", "E-01; E-24", "OI-09; OI-11", "Cross-cutting server-side authorization."),
    "SEC-02": ("PG-04; PG-05", "", "BE-06", "BUC-06", "PUC-02; PUC-09", "E-01; E-24", "OI-09", "Staff account provisioning."),
    "SEC-03": ("PG-02; PG-03; PG-04", "BR-04; BR-05; BR-07; BR-08; BR-09; BR-10; BR-11", "BE-02; BE-03; BE-04; BE-05; BE-06; BE-07", "BUC-02; BUC-03; BUC-04; BUC-05; BUC-06; BUC-07", "PUC-03; PUC-05; PUC-06; PUC-07; PUC-08; PUC-10", "E-03; E-05; E-07; E-08; E-13", "OI-01; OI-02; OI-03; OI-04; OI-07", "Server-side validation."),
    "SEC-04": ("PG-03; PG-04; PG-05", "BR-10", "BE-04; BE-05; BE-06; BE-10", "BUC-04; BUC-05; BUC-06; BUC-10", "PUC-06; PUC-07; PUC-08; PUC-13", "E-17; E-24", "OI-10", "Actor, site, action, and timestamp."),
    "SEC-05": ("PG-02", "", "BE-02; BE-03", "BUC-02; BUC-03", "PUC-03; PUC-05", "E-12; E-20", "OI-10", "Purpose-limited visitor data collection."),
    "SEC-06": ("PG-02; PG-04", "", "BE-02; BE-03; BE-06", "BUC-02; BUC-03; BUC-06", "PUC-03; PUC-05; PUC-09", "E-12; E-24", "OI-06; OI-10", "PWD and visitor-file access controls."),
    "SEC-07": ("PG-02; PG-04; PG-05", "", "BE-02; BE-03; BE-06; BE-10", "BUC-02; BUC-03; BUC-06; BUC-10", "PUC-03; PUC-05; PUC-09; PUC-13", "E-12; E-24", "OI-06; OI-10", "Retention and deletion by category."),
}


def write_rtm():
    path = OUT / "Requirements_Traceability_Matrix.csv"
    headers = [
        "Requirement_ID", "Requirement", "Project_Goal", "Business_Rule",
        "Business_Event", "Business_Use_Case", "Product_Use_Case",
        "Fit_Criterion", "Verification_Method", "Evidence_ID",
        "Open_Issue", "Traceability_Basis", "Status",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        for item in requirement_rows():
            mapping = trace.get(item["id"])
            if mapping is None:
                raise ValueError(f"Missing traceability map for {item['id']}")
            goal, rule, event, buc, puc, evidence, issue, basis = mapping
            writer.writerow({
                "Requirement_ID": item["id"],
                "Requirement": item["requirement"],
                "Project_Goal": goal,
                "Business_Rule": rule,
                "Business_Event": event,
                "Business_Use_Case": buc,
                "Product_Use_Case": puc,
                "Fit_Criterion": item["fit"],
                "Verification_Method": "Review approved configuration and execute a documented acceptance case against the fit criterion; record results after testing.",
                "Evidence_ID": evidence,
                "Open_Issue": issue,
                "Traceability_Basis": basis,
                "Status": item["status"],
            })
    return path


evidence = [
    ("E-01", "Application roles and scope", "supabase/migrations/20261119122333_ecotrack_initial_schema.sql:7, 20-29, 122-145; src/components/StaffPages.tsx:66-92", "Local source observed", "The schema defines visitor, gatekeeper, site_admin, and tourism_office roles with site-scoped assignments.", "Production role assignments and complete authorization behavior are not verified."),
    ("E-02", "Published destination data", "src/lib/iliguide.ts:193-214", "Local source observed", "The public site loader filters for published destinations.", "Does not prove the four destinations are configured or published in production."),
    ("E-03", "Reservation availability and hold", "src/App.tsx:594-682; supabase/migrations/20261119122333_ecotrack_initial_schema.sql:518-608", "Local source observed", "Booking flow creates a capacity hold and validates slot availability.", "Operational acceptance and final hold policy are unverified."),
    ("E-04", "Visitor and party details", "src/components/VisitorBookingFlow.tsx:65-100; supabase/migrations/20261119122333_ecotrack_initial_schema.sql:150-178", "Local source observed", "The flow collects party and individual visitor data for reservations.", "The organization has not approved all collection purposes and fields."),
    ("E-05", "Adult, child, and PWD pricing", "supabase/migrations/20261120045200_ecotrack_booking_functions.sql:69-89; src/components/VisitorBookingFlow.tsx:29-44, 82-99", "Local source observed", "Pricing uses adult_fee, child_fee, and pwd_discount_percent.", "No legal or destination-policy validation of rates is asserted."),
    ("E-06", "Sikyop guide-fee model gap", "supabase/migrations/20261119122333_ecotrack_initial_schema.sql:50-54; src/components/VisitorBookingFlow.tsx:82-99", "Source review; absence finding", "Inspected fee fields cover adult and child fees and a PWD discount; no separate guide_fee field was found in the inspected current UI and migrations.", "Search absence is limited to the inspected local checkout and does not prove remote schema state."),
    ("E-07", "Confirmed destination scope and fee facts", "Project-team decisions in this conversation, 27 November 2026; original SRS Section 1a", "User-confirmed business facts", "Scope is Tinago Falls, Mimbalot Falls, Timoga Cold Springs, and Sikyop Falls; Mimbalot has no entrance fee; Sikyop has entrance and guide fees; Dodiongan is excluded.", "Current live destination configuration and exact fee amounts remain unverified."),
    ("E-08", "QR scanning, partial check-in, and checkout confirmation", "src/components/StaffPages.tsx:655-699, 704-859; supabase/migrations/20261123130000_qr_attendance_and_live_occupancy.sql:77-180, 234-255, 397-537", "Local source observed", "The scanner asks for Gatekeeper confirmation and supports participant selection and checkout confirmation.", "The manual reference path is a separate conflict documented in E-09."),
    ("E-09", "Manual attendance without QR token", "src/components/StaffPages.tsx:742-789, 818; supabase/migrations/20261123130000_qr_attendance_and_live_occupancy.sql:191-232, 572-595, 782-788", "Confirmed implementation gap", "Manual booking-reference lookup calls confirm_manual_attendance with no QR token requirement.", "Conflicts with the confirmed QR-only walk-in rule; implementation not changed."),
    ("E-10", "Walk-in registration", "src/components/StaffPages.tsx:2149-2255; supabase/migrations/20261123140000_walkin_payment_method_recording.sql:1-63", "Local source observed", "Authorized Gatekeeper workflow registers a walk-in and creates a booking-linked QR credential.", "A registration is not attendance; payment method labels do not prove funds transfer."),
    ("E-11", "Demonstration payment and disabled webhook", "src/components/VisitorPaymentPages.tsx:28-38, 101-124, 146-168, 194-205; supabase/migrations/20261122144219_site_demo_payment_settings.sql:90-118; supabase/functions/paymongo-webhook/index.ts:6", "Local source observed", "Visitor UI generates fictional payment references and demo proof; PayMongo webhook responds disabled.", "README describes different payment availability; current UI and function source take precedence for source-level behavior; production status not verified."),
    ("E-12", "PWD verification files and deletion controls", "supabase/migrations/20261123032313_visitor_pwd_verification.sql:1-91, 180-200; src/components/StaffPages.tsx:383, 422-439, 468-475", "Local source observed", "PWD image bucket is private, scoped policies exist, records use delete_after set thirty days after the visit, and an authorized manual deletion path exists.", "Thirty-day value is not confirmed as organizational policy; automatic deletion was not established."),
    ("E-13", "Capacity assessments and approved limits", "supabase/migrations/20261120045219_ecotrack_gatekeeper_duties_capacity.sql:45-97, 420-475; src/components/StaffPages.tsx:1980-2112", "Local source observed", "Capacity assessments, zones, and approved visitor limits are distinct data concepts and administrator workflows.", "Assessment methodology, approvals, and actual configured values need destination confirmation."),
    ("E-14", "Capacity recommendations", "src/lib/useCapacityRecommendations.ts:7-70", "Local source observed", "The hook filters eligible destinations and scores capacity, proximity, category, and schedule; recommendations do not themselves create bookings.", "Recommendation data quality and stakeholder approval are unverified."),
    ("E-15", "Destination maps and capacity display", "src/components/DestinationLocator.tsx:38-67, 208-243; src/components/OccupancyPanel.tsx:44-126", "Local source observed", "Views distinguish live attendance and planned availability in their labels.", "Map tile availability and production data freshness are not verified."),
    ("E-16", "Reviews and moderation", "src/components/ReviewPages.tsx:1-250; supabase/migrations/20261123063323_visitor_review_submission.sql", "Local source observed", "Visitors submit reviews and authorized staff manage moderation states.", "Moderation policy and deployment behavior require confirmation."),
    ("E-17", "Announcements, reporting, CSV, and audit", "src/components/DestinationAnnouncements.tsx:15-137; src/components/StaffPages.tsx:1503-1560; src/lib/iliguide.ts:418-438", "Local source observed", "The source supports destination updates, reports, CSV export, and audit-log review.", "Email delivery, report definitions, audit completeness, and retention are not verified."),
    ("E-18", "Responsive web application and PWA shell", "package.json:1-33; src/main.tsx:50-51; public/sw.js:1-34", "Local source observed", "The application is a React web application with a service worker that caches shell resources and same-origin assets.", "Cached shell does not establish offline booking, live data, attendance, or synchronization."),
    ("E-19", "Current repository technology stack", "package.json:1-33; src/lib/supabase.ts:1-30", "Local source observed", "Dependencies include React, TypeScript, Supabase client, ZXing, Leaflet, and QR generation.", "Dependency versions may change; deployment package and environment not verified."),
    ("E-20", "Timoga logbook and occasional staff counts", "Project-team clarification in this conversation, 27 November 2026; original SRS Section 1a", "User-confirmed business fact", "Timoga maintains a logbook and staff sometimes count visitors.", "Frequency, exact fields, reconciliation, and departure procedures remain unconfirmed."),
    ("E-21", "Privacy law and accessibility reference", "Official Gazette RA 10173: https://officialgazette.gov.ph/2012/08/15/republic-act-no-10173/; W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/", "Primary reference sources reviewed", "The SRS cites privacy and accessibility sources as review references.", "No legal-compliance or WCAG-conformance result is claimed."),
    ("E-22", "Email integration source", "README.md:43-54; supabase/functions/_shared/email.ts", "Documentation/source reference", "The repository describes Brevo-based transactional email templates.", "Production keys, template IDs, delivery success, and owner are not verified."),
    ("E-23", "Test assets exist; tests not run for this SRS task", "supabase/tests/qr_attendance_and_live_occupancy.test.sql; supabase/tests/site_announcements.test.sql; package.json", "Repository inventory only", "Automated test files and scripts exist.", "No tests, build, database queries, deployment checks, or acceptance exercises were executed during SRS preparation."),
    ("E-24", "Local working-tree condition", "Git checkout e250e21, inspected 27 November 2026; working tree had modified source files and untracked qa/ content", "Environment observation", "Documentation was prepared against the current local checkout without changing application source or migrations.", "Local changes may not be committed or deployed; their production status is unknown."),
]


def write_evidence():
    path = OUT / "System_Evidence_Matrix.csv"
    headers = ["Evidence_ID", "Business_Fact_or_System_Behavior", "Source_File_and_Location", "Verification_Status", "Evidence_Interpretation", "Limitation_or_Open_Question", "Related_SRS_Sections"]
    section_map = {
        "E-01": "2, 3, 8, 9, 15", "E-02": "8, 9", "E-03": "4, 8, 9, 12", "E-04": "7, 8, 9, 15",
        "E-05": "3, 7, 9, 17", "E-06": "3, 5, 9, 18", "E-07": "1, 3, 5, 18", "E-08": "5, 6, 8, 9, 12",
        "E-09": "5, 6, 9, 12, 18", "E-10": "6, 8, 9", "E-11": "3, 5, 8, 9, 18", "E-12": "7, 15, 17, 18",
        "E-13": "1, 5, 7, 8, 9, 12", "E-14": "8, 9", "E-15": "8, 9, 12", "E-16": "8, 9, 18",
        "E-17": "2, 8, 9, 14, 15", "E-18": "3, 10, 11, 12, 13", "E-19": "3, 13, 14", "E-20": "1, 5, 6",
        "E-21": "11, 15, 17", "E-22": "2, 3, 13, 18", "E-23": "18, Review Report", "E-24": "Review Report",
    }
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        for row in evidence:
            writer.writerow([*row, section_map[row[0]]])
    return path


def write_review_report():
    path = OUT / "SRS_Review_Report.md"
    content = """# IliGuide SRS Review Report

## Review scope

The revised specification follows the original IliGuide SRS section sequence and uses the completed student-authored Sections 1–5 as the narrative baseline. The user-provided Final Software Requirements Specification was consulted as a writing and document-presentation example. Its bus-system facts were not transferred into IliGuide. The user-provided master prompt informed the source-evidence method and requirements review. The current local IliGuide repository, including its database migrations and interface source, was inspected on 27 November 2026.

The separate IliGuide System Reference mentioned in the master prompt was not present among the supplied files or the located project materials. The repository and original SRS were therefore used for system analysis. The local working tree had existing modified source files and untracked QA content. No application source, migration, deployment setting, or production data was changed for this documentation task.

## Reconciliation and analysis

The document retains Volere V16 numbering from Section 1 through Section 27 and removes unrelated template instructions, generic examples, and road de-icing material. Sections 1–5 distinguish confirmed project decisions, preliminary observations, source-code behavior, assumptions, and matters requiring approval. Later sections establish business events and business use cases before product use cases and atomic functional requirements. Fit criteria appear beside each functional, quality, and security requirement.

The four in-scope destinations are Tinago Falls, Mimbalot Falls, Timoga Cold Springs, and Sikyop Falls. Dodiongan Falls is excluded. Mimbalot’s no-entrance-fee rule and Sikyop’s separate entrance and guide fees follow the project-team clarifications. Timoga’s logbook and occasional staff count are documented as confirmed practice. The Sikyop guide fee remains a separate business requirement even though the inspected local fee model has no separate guide-fee field.

Attendance requirements distinguish a booking from an arrival and require Gatekeeper confirmation for entry and checkout. Walk-in registration does not count toward Arrivals Today or Current Occupancy until QR scanning and confirmed check-in. The local interface and database also provide a manual booking-reference attendance path that can write attendance without QR validation. The SRS preserves the confirmed business rule and records this source-level implementation gap; it does not claim that current code satisfies the rule.

The payment analysis describes the visitor GCash and Maya flow as a simulation that uses fictional references and proof, not a real transfer. PayMongo-related source exists, but the local webhook returns a disabled response and the inspected visitor workflow uses the demo path. The first booking hold is ten minutes; starting demo payment updates the server deadline to the configured payment window, whose default is fifteen minutes. The SRS asks the project team to approve this two-stage timing and its visitor disclosure.

The capacity analysis keeps visit-slot capacity, expected visitors, current occupancy, visitor headcount, physical estimates, and approved limits distinct. Capacity-assessment and approved-limit records exist in local migrations, but destination approval and source measurements have not been verified. The PWD workflow stores files in a non-public bucket and assigns a delete-after date thirty days after the scheduled visit; the source exposes manual deletion, not an established automatic deletion job. The thirty-day value requires policy approval.

## Traceability and evidence

The Requirements Traceability Matrix contains the functional, non-functional, and security requirements extracted from the SRS, with links to project goals, business rules, events, business use cases, product use cases, fit criteria, evidence, and open issues. Cross-cutting requirements are identified as cross-cutting rather than linked artificially to a single event. The System Evidence Matrix distinguishes user-confirmed facts, local source observations, source gaps, official references, and unverified deployment claims.

The traceability is not yet an approved baseline. Stakeholder confirmation is still needed for the open issues listed in Section 18, particularly attendance enforcement, Sikyop fee representation, privacy and retention, approved capacity data, role ownership, deployment support, and acceptance targets.

## Document quality and rendering

The Word file was generated from an editable Markdown source using the original 27-section structure. The table of contents was updated in Microsoft Word. The document was exported to PDF and all 52 A4 pages were rendered for visual review. The final rendering contains the section sequence, tables, page headers, page numbers, and contents entries. The first visual pass found a source citation alone on a new page; the citation was shortened and the final render places all references with Section 27 without a separate spill page.

No application build, unit test, database test, production query, deployment check, performance measurement, accessibility audit, legal compliance audit, user-acceptance test, or training evaluation was run as part of this documentation task. The presence of repository test files is recorded only as evidence that such files exist.

## Decisions and evidence still required

The client and project team must approve the open business rules, destination configurations, fee amounts, guide-fee calculation, zero-fee walk-in behavior, hold timing, attendance exception policy, and report definitions. They must identify the personal information controller and privacy officer, approve notices and retention periods, review PWD data handling, and establish staff role ownership. They must also set supported devices and browsers, connectivity and outage procedures, support and recovery owners, response-time and availability targets, accessibility level, interface language, deployment date, acceptance criteria, and release status.

No separate IliGuide System Reference was available for comparison, and repository source does not establish current production behavior. The cost figures remain planning estimates; the printer allowance remains in the historical estimate pending formal revision. Until these decisions and verification activities are complete, this SRS should be treated as a detailed draft for stakeholder review rather than an approved requirements baseline.
"""
    path.write_text(content, encoding="utf-8")
    return path


def write_diagrams():
    diagrams = {
        "01_system_context.mmd": """flowchart LR
  V[Visitor] -->|site details and reservation request| I[IliGuide responsive web application]
  I -->|booking status and QR ticket| V
  G[Site Gatekeeper] -->|walk-in registration and confirmed attendance| I
  I -->|assigned bookings and attendance status| G
  A[Site Administrator] -->|site configuration and approvals| I
  T[Authorized Tourism Office Personnel] -->|cross-destination administration and review| I
  I <--> S[Supabase authentication, database, storage, and functions]
  I --> M[External map resources]
  I --> E[Configured email delivery]
  X[TMIS and Treasury records] -. outside current integration scope .-> I
""",
        "02_attendance_business_and_code.mmd": """flowchart LR
  W[Walk-in arrives] --> R[Gatekeeper registers booking]
  R --> Q[System creates booking-linked QR]
  Q --> N[No attendance count yet]
  N --> S[Gatekeeper scans QR]
  S --> C{Ticket eligible?}
  C -->|No| X[No attendance transaction]
  C -->|Yes| G{Gatekeeper confirms actual visitors entering?}
  G -->|Yes| EN[Record selected entry events]
  G -->|No| H[Leave attendance unchanged]
  EN --> O[Update occupancy and arrivals from recorded events]
  EN --> S2[Later valid scan suggests checkout]
  S2 --> G2{Gatekeeper confirms actual departure?}
  G2 -->|Yes| EX[Record exit events]
  G2 -->|No| H2[Leave occupancy unchanged]
  EX --> O
  MR[Current manual booking-reference lookup] -. bypasses QR token .-> MC[Manual attendance RPC]
  MC -. implementation gap against confirmed QR-only rule .-> GAP[Resolve before baseline approval]
""",
        "03_business_data_model.mmd": """erDiagram
  DESTINATION ||--o{ SITE_SLOT : schedules
  DESTINATION ||--o{ BOOKING : receives
  SITE_SLOT ||--o{ BOOKING : reserves
  VISITOR ||--o{ BOOKING : creates
  BOOKING ||--|{ RESERVATION_VISITOR : includes
  BOOKING ||--o{ ATTENDANCE_EVENT : records
  GATEKEEPER ||--o{ ATTENDANCE_EVENT : confirms
  BOOKING ||--o{ PAYMENT_RECORD : has
  DESTINATION ||--o{ STAFF_ASSIGNMENT : scopes
  STAFF ||--o{ STAFF_ASSIGNMENT : receives
  DESTINATION ||--o{ CAPACITY_ASSESSMENT : assesses
  DESTINATION ||--o{ APPROVED_LIMIT : authorizes
  DESTINATION ||--o{ ANNOUNCEMENT : publishes
  DESTINATION ||--o{ REVIEW : receives
  VISITOR ||--o{ REVIEW : submits
  DESTINATION {
    uuid id
    string name
    string status
  }
  BOOKING {
    uuid id
    string reference
    string status
    string source
  }
  ATTENDANCE_EVENT {
    uuid id
    string action
    integer visitor_count
    datetime occurred_at
  }
  CAPACITY_ASSESSMENT {
    uuid id
    integer estimate
    string review_status
  }
  APPROVED_LIMIT {
    uuid id
    integer visitor_limit
    date effective_from
    date effective_to
  }
""",
        "04_product_boundary.mmd": """flowchart LR
  subgraph USERS[Product users]
    V[Visitor]
    G[Site Gatekeeper]
    A[Site Administrator]
    T[Tourism Office Personnel]
  end
  subgraph SCOPE[IliGuide product boundary]
    P[Destination information and mapping]
    B[Reservations and walk-ins]
    Q[QR ticket validation and confirmed attendance]
    C[Schedules and capacity records]
    R[Announcements, feedback, and reports]
  end
  V --> P
  V --> B
  V --> Q
  G --> B
  G --> Q
  A --> C
  A --> R
  T --> C
  T --> R
  S[Supabase services] <--> SCOPE
  EXT[TMIS, treasury, real online payments, ecological assessment, offline synchronization] -. excluded .- SCOPE
""",
    }
    paths = []
    for name, source in diagrams.items():
        path = OUT / "diagrams" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")
        paths.append(path)
    return paths


if __name__ == "__main__":
    rows = requirement_rows()
    if len(rows) != len(trace):
        raise SystemExit(f"Requirement row count {len(rows)} does not match trace map count {len(trace)}")
    rtm = write_rtm()
    matrix = write_evidence()
    report = write_review_report()
    diagrams = write_diagrams()
    for path in (rtm, matrix, report, *diagrams):
        print(f"{path}: {path.stat().st_size} bytes")
