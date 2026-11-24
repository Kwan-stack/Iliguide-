# IliGuide SRS revision and discrepancy report

## Resolved in the SRS

- **Scope and roles:** Standardized the current scope to Tinago Falls, Mimbalot Falls, Timoga Cold Springs, and the Sikyop destination. Added the four application roles and clarified organization- and destination-scoped administration.
- **Mimbalot admission:** The original observations and BPMN narrative conflict with later project corrections. The SRS follows the user-provided correction that Mimbalot has no entrance fee. Donations and table rentals remain separate from an entrance fee. Confirm current rules and effective dates with the authorized site manager.
- **Sikyop name and fee:** Original materials use “Sikyop Underground Cave”; current application artwork uses that label, while project mapping notes call the research site “Sikyop Agri-Tourism Adventure.” Some source text says free admission, while the user-provided correction says entrance and guide fees. The SRS uses “Sikyop destination” and follows the fee correction; the official name, site identity, and authorized rates still require confirmation.
- **Payments:** The current visitor workflow presents simulated GCash/Maya proof review and onsite payment. It explicitly says no money transfers. The repository’s PayMongo webhook handler is disabled (HTTP 410). The document does not treat demo payment as live processing or a settled financial transaction.
- **Carrying capacity:** The SRS distinguishes physical estimates, approved operational limits, booking-slot capacity, and recorded occupancy. It makes no claim of individual visitor tracking or independent ecological-capacity determination.
- **Research diagrams:** Appendix C retains the four relevant original destination diagrams as preliminary evidence with captions and text descriptions. Their contradictions and unobserved-source notes are explicit; template graphics and road-scheduling examples are excluded.
- **Requirements:** 28 functional requirements connect to goals, use cases, implementation areas, and fit criteria. The traceability matrix is provided separately as CSV.
- **Quality criteria:** Accessibility and performance values are clearly marked proposed and unmeasured. Proposed performance profile: 20 concurrent sessions; p95 ≤3 seconds for read operations and ≤5 seconds for booking creation and QR validation, with at least 30 requests per operation after warm-up. Stakeholder approval and measurement remain pending.
- **References:** Removed an unverified 2026 NCDA administrative-order citation. Corrected the Volere author initials and retained only sources used and verifiable from official or scholarly publishers.

## Open decisions and code or deployment checks

1. **Attendance path:** The user-confirmed rule requires a QR scan and Gatekeeper confirmation for check-in and checkout, and manual lookup must not change occupancy. The current migration also exposes `public.confirm_manual_attendance`, which can create occupancy-counting events. Resolve this code path and verify deployed behavior before claiming QR-only occupancy.
2. **Timoga authority:** The project intends a private Site Admin boundary, and a migration defines a Timoga private-site organization. Confirm the active production assignment and authority with the operator.
3. **Destination records:** Confirm official names, publication state, precise locations, fees, hours, closures, guide charges, admission rules, and responsible approvers for all four sites.
4. **PWD evidence:** Current code uses a private PWD image bucket, JPEG/PNG/WebP and 5 MiB limits, and a deletion date 30 days after the visit. Approve purpose, lawful basis, notice, reviewer, and retention/deletion policy before real ID evidence is collected.
5. **Payment proof limits:** Demo payment uploads are a separate flow, currently limited to 10 MiB for JPG, PNG, or PDF. Do not conflate that limit with the PWD ID upload limit.
6. **Connectivity and offline use:** Project notes report weak reception at the interviewed Timoga operation. Repository evidence does not establish offline booking or attendance synchronization. Measure site connectivity and approve a paper outage process.
7. **Scheduling title:** Current repository evidence supports configured slots, operating rules, and Gatekeeper rosters, not a verified optimization algorithm. Confirm the “Algorithmic Scheduling” title or define, implement, and evaluate such an algorithm.
8. **Budget and timing:** Original figures (₱48,000 one-time, ₱55,680 first-year recurring, ₱114,048 with contingency) are preliminary estimates, not vendor quotes or approved budget. Production schedule and operational ownership remain unset.
9. **Research limitations:** Source notes lack consistent interview dates and sample sizes. Findings are labeled preliminary; no population-level conclusions or completed user-evaluation results are claimed.
10. **Production status:** Repository presence does not prove deployed migrations, service configuration, data accuracy, email delivery, or successful user acceptance. Deployment and operational readiness remain unverified.

No application code, Supabase data, or production configuration was changed during this documentation work.
